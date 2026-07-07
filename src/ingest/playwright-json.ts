import type { AttachmentRef, FailureRecord, RunStats } from '../types.js';

/**
 * Adapter for the standard Playwright JSON reporter output
 * (`playwright test --reporter=json`). Working from the standard report —
 * rather than only from a custom reporter — means the toolkit can triage
 * runs that already happened, including CI artifacts.
 *
 * Only the fields we consume are typed; the report carries much more.
 */
interface JsonReport {
  suites?: JsonSuite[];
  stats?: {
    startTime?: string;
    expected?: number;
    unexpected?: number;
    flaky?: number;
    skipped?: number;
  };
}

interface JsonSuite {
  title?: string;
  file?: string;
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}

interface JsonSpec {
  title?: string;
  file?: string;
  tests?: JsonTest[];
}

interface JsonTest {
  projectName?: string;
  status?: string; // "expected" | "unexpected" | "flaky" | "skipped"
  results?: JsonResult[];
}

interface JsonResult {
  status?: string;
  duration?: number;
  retry?: number;
  startTime?: string;
  error?: { message?: string; stack?: string };
  steps?: JsonStep[];
  attachments?: { name?: string; contentType?: string; path?: string }[];
}

interface JsonStep {
  title?: string;
  steps?: JsonStep[];
}

export interface IngestedRun {
  stats: RunStats;
  failures: FailureRecord[];
}

export function isPlaywrightJsonReport(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as JsonReport).suites)
  );
}

export function ingestPlaywrightJson(data: unknown, runId: string): IngestedRun {
  if (!isPlaywrightJsonReport(data)) {
    throw new Error('Not a Playwright JSON report: missing "suites" array.');
  }
  const report = data as JsonReport;
  const failures: FailureRecord[] = [];

  for (const suite of report.suites ?? []) {
    walkSuite(suite, [], failures);
  }

  const stats = report.stats ?? {};
  const passed = stats.expected ?? 0;
  const failed = stats.unexpected ?? 0;
  const flaky = stats.flaky ?? 0;
  const skipped = stats.skipped ?? 0;

  return {
    stats: {
      runId,
      startedAt: stats.startTime ?? new Date().toISOString(),
      total: passed + failed + flaky + skipped,
      passed,
      failed,
      flaky,
      skipped,
    },
    failures,
  };
}

function walkSuite(suite: JsonSuite, path: string[], out: FailureRecord[]): void {
  const nextPath = suite.title ? [...path, suite.title] : path;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      collectFromTest(spec, test, nextPath, out);
    }
  }
  for (const child of suite.suites ?? []) {
    walkSuite(child, nextPath, out);
  }
}

function collectFromTest(
  spec: JsonSpec,
  test: JsonTest,
  path: string[],
  out: FailureRecord[],
): void {
  // "expected" and "skipped" tests never enter triage; "unexpected" is a
  // real failure; "flaky" (failed, then passed on retry) is recorded too so
  // the verdict layer can label it instead of silently dropping it.
  if (test.status !== 'unexpected' && test.status !== 'flaky') return;

  const results = test.results ?? [];
  const failedResult =
    [...results].reverse().find((r) => r.status !== 'passed' && r.status !== 'skipped') ??
    results[results.length - 1];
  if (!failedResult) return;

  const file = spec.file ?? path[0] ?? 'unknown';
  const title = spec.title ?? 'untitled';
  const project = test.projectName ?? '';
  const status = normalizeStatus(failedResult.status);

  out.push({
    testId: [file, ...path.slice(1), title, project].filter(Boolean).join(' › '),
    file,
    title,
    project,
    status,
    passedOnRetry: test.status === 'flaky',
    errorMessage: failedResult.error?.message ?? '',
    errorStack: failedResult.error?.stack ?? '',
    steps: flattenSteps(failedResult.steps ?? []),
    durationMs: failedResult.duration ?? 0,
    attachments: (failedResult.attachments ?? []).map(toAttachment),
    startedAt: failedResult.startTime ?? '',
  });
}

function normalizeStatus(status: string | undefined): FailureRecord['status'] {
  if (status === 'timedOut' || status === 'interrupted') return status;
  return 'failed';
}

function flattenSteps(steps: JsonStep[], depth = 0): string[] {
  const titles: string[] = [];
  for (const step of steps) {
    if (step.title) titles.push('  '.repeat(depth) + step.title);
    if (step.steps) titles.push(...flattenSteps(step.steps, depth + 1));
  }
  return titles;
}

function toAttachment(a: {
  name?: string;
  contentType?: string;
  path?: string;
}): AttachmentRef {
  return {
    name: a.name ?? 'attachment',
    contentType: a.contentType ?? 'application/octet-stream',
    path: a.path,
  };
}
