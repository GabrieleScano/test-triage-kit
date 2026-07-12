import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ingestPlaywrightJson, isPlaywrightJsonReport } from '../src/ingest/playwright-json.js';
import { loadHistory } from '../src/history/store.js';
import { runTriage } from '../src/pipeline.js';
import { parseEnrichment, parseSynthesis } from '../src/ai/enrich.js';
import { jiraPreviewHtml } from '../src/output/jira-html.js';

/**
 * Builds a static preview of the Jira sync output, same recorded-fixture
 * approach as demo-enriched.ts: the real pipeline and the real ADF builder
 * run for real, only the AI network call is replaced by a validated
 * recording. Jira Cloud's free tier has no public anonymous issue view, so
 * this page is what stands in for a live link.
 */
interface Recorded {
  clusters: Record<string, unknown>;
  synthesis: unknown;
}

async function main(): Promise<void> {
  const outDir = process.argv[2] ?? 'triage-output-enriched';

  const data: unknown = JSON.parse(readFileSync('fixtures/sample-report.json', 'utf-8'));
  if (!isPlaywrightJsonReport(data)) {
    throw new Error('fixtures/sample-report.json is not a Playwright JSON report.');
  }
  const ingested = ingestPlaywrightJson(data, 'demo-fixture-run');

  const result = await runTriage(ingested, loadHistory(join(outDir, 'history.json')), {
    ai: false,
  });

  const recorded = JSON.parse(readFileSync('fixtures/recorded-ai.json', 'utf-8')) as Recorded;
  for (const report of result.reports) {
    const fp = report.cluster.fingerprint;
    const response = recorded.clusters[fp];
    if (!response) {
      throw new Error(`No recorded AI response for fingerprint ${fp} — update fixtures/recorded-ai.json.`);
    }
    report.ai = parseEnrichment(JSON.stringify(response));
  }
  result.synthesis = parseSynthesis(JSON.stringify(recorded.synthesis));

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'jira-preview.html'), jiraPreviewHtml(result, 'QA'));

  const bugCount = result.reports.filter((r) => r.verdict.type === 'likely-bug').length;
  console.log(`Jira preview written to ${outDir}/jira-preview.html (${bugCount} issue card(s)).`);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
