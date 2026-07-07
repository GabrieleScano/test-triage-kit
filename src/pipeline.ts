import type { IngestedRun } from './ingest/playwright-json.js';
import type { ClusterReport, TriageResult } from './types.js';
import { classifyAll, clusterFailures } from './classify/cluster.js';
import { insightFor, type HistoryFile } from './history/store.js';
import { verdictFor } from './verdict.js';
import { aiAvailable, enrichCluster, synthesizeRun } from './ai/enrich.js';

export interface PipelineOptions {
  /** Set false to skip the AI layer even when a key is configured. */
  ai?: boolean;
  log?: (message: string) => void;
}

/**
 * The full triage pipeline: classify → cluster → history → verdict, then
 * the optional AI enrichment on top. The deterministic part always
 * completes; every AI failure degrades to a warning.
 */
export async function runTriage(
  ingested: IngestedRun,
  history: HistoryFile,
  options: PipelineOptions = {},
): Promise<TriageResult> {
  const log = options.log ?? (() => {});
  const classified = classifyAll(ingested.failures);
  const clusters = clusterFailures(classified);

  const reports: ClusterReport[] = clusters.map((cluster) => {
    const insight = insightFor(history, cluster.fingerprint);
    return {
      cluster,
      history: insight,
      verdict: verdictFor(cluster, insight, ingested.stats),
    };
  });

  const result: TriageResult = { stats: ingested.stats, reports };

  const useAi = (options.ai ?? true) && aiAvailable() && reports.length > 0;
  if (!useAi) {
    if (reports.length > 0) log('AI layer skipped (no API key or disabled) — deterministic reports only.');
    return result;
  }

  for (const report of reports) {
    try {
      report.ai = await enrichCluster(report);
    } catch (error) {
      log(`AI enrichment failed for ${report.cluster.fingerprint}: ${String(error)}`);
    }
  }
  try {
    result.synthesis = await synthesizeRun(reports, ingested.stats);
  } catch (error) {
    log(`AI run synthesis failed: ${String(error)}`);
  }

  return result;
}
