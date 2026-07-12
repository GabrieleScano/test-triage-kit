#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from './load-env.js';
import { ingestPlaywrightJson, isPlaywrightJsonReport, type IngestedRun } from './ingest/playwright-json.js';
import type { TriageInputFile } from './reporter.js';
import { loadHistory, appendRun, saveHistory, resolvedFingerprints } from './history/store.js';
import { runTriage } from './pipeline.js';
import { clusterMarkdown, runSummaryMarkdown, reportFileName } from './output/markdown.js';
import { triageHtml } from './output/html.js';
import { githubConfigFromEnv, syncIssues } from './output/github.js';
import { jiraConfigFromEnv, syncJiraIssues } from './output/jira.js';
import { notifySlack } from './output/notify.js';

const USAGE = `Usage: triage <report.json> [options]

  <report.json>       Playwright JSON report (--reporter=json) or the
                      triage-input.json written by test-triage-kit/reporter.

Options:
  --out <dir>         Output directory (default: triage-output)
  --history <file>    Run-history JSON file for flaky detection
                      (default: <out>/history.json)
  --no-ai             Skip AI enrichment even if an API key is configured
  --github            Sync GitHub issues (needs GITHUB_TOKEN + GITHUB_REPOSITORY)
  --jira              Sync Jira issues (needs JIRA_BASE_URL + JIRA_EMAIL +
                      JIRA_API_TOKEN + JIRA_PROJECT_KEY)
  --dry-run           With --github/--jira: log actions instead of performing them
  --slack             Post a digest to SLACK_WEBHOOK_URL
`;

async function main(): Promise<number> {
  loadEnv();
  const args = process.argv.slice(2);
  const inputPath = args.find((a) => !a.startsWith('--'));
  if (!inputPath || args.includes('--help')) {
    console.log(USAGE);
    return inputPath ? 0 : 1;
  }

  const outDir = valueOf(args, '--out') ?? 'triage-output';
  const historyPath = valueOf(args, '--history') ?? join(outDir, 'history.json');

  const ingested = ingest(inputPath);
  const history = loadHistory(historyPath);

  console.log(
    `Run ${ingested.stats.runId}: ${ingested.stats.failed} failed, ${ingested.stats.flaky} flaky — triaging ${ingested.failures.length} failure record(s)…`,
  );

  const result = await runTriage(ingested, history, {
    ai: !args.includes('--no-ai'),
    log: (m) => console.warn(`  ! ${m}`),
  });

  // --- write outputs -------------------------------------------------------
  mkdirSync(outDir, { recursive: true });
  for (const report of result.reports) {
    writeFileSync(join(outDir, reportFileName(report)), clusterMarkdown(report, result.stats.runId) + '\n');
  }
  const summary = runSummaryMarkdown(result);
  writeFileSync(join(outDir, 'summary.md'), summary + '\n');
  writeFileSync(join(outDir, 'triage.html'), triageHtml(result));
  console.log(`\n${summary}\n`);
  console.log(`Reports written to ${outDir}/`);

  // --- fingerprints green long enough to propose closing their issues -----
  const currentFps = result.reports.map((r) => r.cluster.fingerprint);
  const knownFps = [...new Set(history.runs.flatMap((r) => r.failedFingerprints))].filter(
    (fp) => !currentFps.includes(fp),
  );
  const preUpdateResolved = resolvedFingerprints(history, knownFps);

  // --- persist history AFTER computing insights about past runs -----------
  saveHistory(
    historyPath,
    appendRun(history, {
      runId: result.stats.runId,
      at: new Date().toISOString(),
      failedFingerprints: currentFps,
    }),
  );

  // --- integrations --------------------------------------------------------
  if (args.includes('--github')) {
    const config = githubConfigFromEnv(args.includes('--dry-run'));
    if (!config) {
      console.error('--github requires GITHUB_TOKEN and GITHUB_REPOSITORY.');
      return 1;
    }
    const outcome = await syncIssues(config, result.reports, result.stats.runId, preUpdateResolved);
    console.log(
      `GitHub: ${outcome.created.length} issue(s) created, ${outcome.commented.length} commented, ` +
        `${outcome.closeProposed.length} close proposal(s), ${outcome.skipped.length} skipped (flaky/infra).`,
    );
  }

  if (args.includes('--jira')) {
    const config = jiraConfigFromEnv(args.includes('--dry-run'));
    if (!config) {
      console.error('--jira requires JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN and JIRA_PROJECT_KEY.');
      return 1;
    }
    const outcome = await syncJiraIssues(config, result.reports, result.stats.runId, preUpdateResolved);
    console.log(
      `Jira: ${outcome.created.length} issue(s) created, ${outcome.commented.length} commented, ` +
        `${outcome.closeProposed.length} close proposal(s), ${outcome.skipped.length} skipped (flaky/infra).`,
    );
  }

  if (args.includes('--slack')) {
    const webhook = process.env.SLACK_WEBHOOK_URL;
    if (!webhook) {
      console.error('--slack requires SLACK_WEBHOOK_URL.');
      return 1;
    }
    try {
      await notifySlack(webhook, result);
      console.log('Slack digest sent.');
    } catch (error) {
      console.warn(`  ! Slack notification failed: ${String(error)}`);
    }
  }

  return 0;
}

function ingest(path: string): IngestedRun {
  const data: unknown = JSON.parse(readFileSync(path, 'utf-8'));

  if (isTriageInput(data)) {
    return { stats: data.stats, failures: data.failures };
  }
  if (isPlaywrightJsonReport(data)) {
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    return ingestPlaywrightJson(data, runId);
  }
  throw new Error(`${path} is neither a Playwright JSON report nor a triage-input file.`);
}

function isTriageInput(data: unknown): data is TriageInputFile {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as TriageInputFile).triageFormat === 1 &&
    Array.isArray((data as TriageInputFile).failures)
  );
}

function valueOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
