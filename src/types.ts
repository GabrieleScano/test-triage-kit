/**
 * Core data model. Every ingestion adapter normalizes into FailureRecord;
 * everything downstream (classification, clustering, history, AI, outputs)
 * works only on these types, never on runner-specific shapes.
 */

export type FailureCategory =
  | 'assertion'
  | 'timeout'
  | 'network'
  | 'crash'
  | 'setup'
  | 'unknown';

export interface FailureRecord {
  /** Stable test identity: file › describe path › title › project. */
  testId: string;
  file: string;
  title: string;
  /** Playwright project (browser) the test ran on, if any. */
  project: string;
  status: 'failed' | 'timedOut' | 'interrupted';
  /** True when the test failed but a retry passed (Playwright "flaky" outcome). */
  passedOnRetry: boolean;
  errorMessage: string;
  errorStack: string;
  /** Titles of the test.step() calls executed before failing. */
  steps: string[];
  durationMs: number;
  attachments: AttachmentRef[];
  startedAt: string;
}

export interface AttachmentRef {
  name: string;
  contentType: string;
  path?: string;
}

export interface ClassifiedFailure extends FailureRecord {
  category: FailureCategory;
  fingerprint: string;
}

/** Failures sharing a fingerprint — one root cause, one report. */
export interface FailureCluster {
  fingerprint: string;
  category: FailureCategory;
  failures: ClassifiedFailure[];
  representative: ClassifiedFailure;
}

export interface RunStats {
  runId: string;
  startedAt: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
}

export type VerdictType =
  | 'likely-bug'
  | 'likely-flaky'
  | 'infrastructure'
  | 'unknown';

export interface Verdict {
  type: VerdictType;
  reasons: string[];
}

export interface HistoryInsight {
  runsRecorded: number;
  timesSeen: number;
  seenInLastRun: boolean;
  consecutiveRunsSeen: number;
  /** 0..1 — fraction of recorded runs in which this fingerprint appeared. */
  occurrenceRate: number;
}

export interface AiEnrichment {
  title: string;
  rootCauseHypothesis: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  severityRationale: string;
  reproSteps: string[];
}

export interface RunSynthesis {
  summary: string;
  systemicIssue: boolean;
  recommendation: string;
}

/** Everything known about one cluster after the full pipeline. */
export interface ClusterReport {
  cluster: FailureCluster;
  verdict: Verdict;
  history?: HistoryInsight;
  ai?: AiEnrichment;
}

export interface TriageResult {
  stats: RunStats;
  reports: ClusterReport[];
  synthesis?: RunSynthesis;
}
