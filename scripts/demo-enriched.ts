import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ingestPlaywrightJson, isPlaywrightJsonReport } from '../src/ingest/playwright-json.js';
import { loadHistory } from '../src/history/store.js';
import { runTriage } from '../src/pipeline.js';
import { parseEnrichment, parseSynthesis } from '../src/ai/enrich.js';
import { clusterMarkdown, runSummaryMarkdown, reportFileName } from '../src/output/markdown.js';
import { triageHtml } from '../src/output/html.js';

/**
 * Builds the published demo of the AI-enriched output without an API key:
 * the deterministic pipeline runs for real on the bundled sample report,
 * then each cluster gets a *recorded* model response from
 * fixtures/recorded-ai.json — validated by the same parser that guards live
 * responses, so the demo exercises every code path except the network call.
 *
 * Fails loudly if the fixture and the recordings drift apart.
 */
const NOTE =
  'Demo of the AI-enriched output. The pipeline, validation and rendering are the real code; ' +
  'the model responses are recorded (fixtures/recorded-ai.json) so this page builds deterministically ' +
  'in CI without an API key.';

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
  // Fixed runId so the published page is stable across builds.
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
  const footer = `\n> _${NOTE}_\n`;
  for (const report of result.reports) {
    writeFileSync(join(outDir, reportFileName(report)), clusterMarkdown(report, result.stats.runId) + '\n' + footer);
  }
  writeFileSync(join(outDir, 'summary.md'), runSummaryMarkdown(result) + '\n' + footer);

  const banner =
    `<p class="meta">${NOTE} ` +
    '<a href="deterministic/">See the deterministic-only output</a> — what the pipeline produces with AI disabled. ' +
    '<a href="jira-preview.html">See the Jira preview</a> — the same reports as they\'d appear synced to Jira.</p>';
  writeFileSync(join(outDir, 'triage.html'), triageHtml(result).replace('</h1>', '</h1>\n' + banner));

  console.log(`Enriched demo written to ${outDir}/ (${result.reports.length} recorded cluster report(s)).`);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
