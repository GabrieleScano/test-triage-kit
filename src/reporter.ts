import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FailureRecord, RunStats } from './types.js';

/**
 * Custom Playwright reporter: collects failures during the run and writes a
 * normalized `triage-input.json` the CLI can consume directly.
 *
 * Wire it up in playwright.config.ts:
 *
 *   reporter: [
 *     ['html'],
 *     ['test-triage-kit/reporter', { outputFile: 'triage-input.json' }],
 *   ]
 *
 * The types below are structural mirrors of the Playwright reporter API, so
 * this package does not need a dependency on @playwright/test.
 */
interface PwLocation {
  file: string;
}

interface PwTestCase {
  title: string;
  location: PwLocation;
  titlePath(): string[];
  outcome(): 'skipped' | 'expected' | 'unexpected' | 'flaky';
}

interface PwTestStep {
  title: string;
  category: string;
}

interface PwTestResult {
  status: string;
  duration: number;
  retry: number;
  startTime: Date;
  error?: { message?: string; stack?: string };
  steps: PwTestStep[];
  attachments: { name: string; contentType: string; path?: string }[];
}

interface PwFullResult {
  startTime: Date;
}

export interface TriageInputFile {
  triageFormat: 1;
  stats: RunStats;
  failures: FailureRecord[];
}

interface ReporterOptions {
  outputFile?: string;
}

class TriageReporter {
  private readonly outputFile: string;
  private readonly failures: FailureRecord[] = [];
  /** Last failing result per test — retries overwrite earlier attempts. */
  private readonly lastFailure = new Map<PwTestCase, PwTestResult>();

  constructor(options: ReporterOptions = {}) {
    this.outputFile = options.outputFile ?? 'triage-input.json';
  }

  onTestEnd(test: PwTestCase, result: PwTestResult): void {
    if (result.status === 'failed' || result.status === 'timedOut' || result.status === 'interrupted') {
      this.lastFailure.set(test, result);
    }
  }

  onEnd(fullResult: PwFullResult): void {
    for (const [test, result] of this.lastFailure) {
      const outcome = test.outcome();
      if (outcome !== 'unexpected' && outcome !== 'flaky') continue;
      this.failures.push(toRecord(test, result, outcome === 'flaky'));
    }

    const runId = `run-${fullResult.startTime.toISOString().replace(/[:.]/g, '-')}`;
    const payload: TriageInputFile = {
      triageFormat: 1,
      stats: {
        runId,
        startedAt: fullResult.startTime.toISOString(),
        ...this.countOutcomes(),
      },
      failures: this.failures,
    };

    mkdirSync(dirname(this.outputFile) || '.', { recursive: true });
    writeFileSync(this.outputFile, JSON.stringify(payload, null, 2) + '\n');
    console.log(`[triage] wrote ${this.failures.length} failure record(s) to ${this.outputFile}`);
  }

  onTestBegin(test: PwTestCase): void {
    // Counting on begin+outcome pairs is unreliable across retries; final
    // outcomes are tallied once in onEnd via outcome(). This hook only
    // exists so Playwright recognizes the class as a reporter.
    void test;
  }

  printsToStdio(): boolean {
    return false;
  }

  private countOutcomes(): { total: number; passed: number; failed: number; flaky: number; skipped: number } {
    let failed = 0;
    let flaky = 0;
    for (const test of this.lastFailure.keys()) {
      if (test.outcome() === 'unexpected') failed++;
      else if (test.outcome() === 'flaky') flaky++;
    }
    // passed/skipped are unknown from failures alone; the CLI treats zeros
    // here as "not tracked" and never divides by total for this format.
    return { total: failed + flaky, passed: 0, failed, flaky, skipped: 0 };
  }
}

function toRecord(test: PwTestCase, result: PwTestResult, passedOnRetry: boolean): FailureRecord {
  const titlePath = test.titlePath().filter(Boolean);
  const project = titlePath[1] ?? '';
  return {
    testId: titlePath.join(' › '),
    file: test.location.file,
    title: test.title,
    project,
    status: result.status === 'timedOut' || result.status === 'interrupted' ? result.status : 'failed',
    passedOnRetry,
    errorMessage: result.error?.message ?? '',
    errorStack: result.error?.stack ?? '',
    steps: result.steps.filter((s) => s.category === 'test.step').map((s) => s.title),
    durationMs: result.duration,
    attachments: result.attachments.map((a) => ({
      name: a.name,
      contentType: a.contentType,
      path: a.path,
    })),
    startedAt: result.startTime.toISOString(),
  };
}

export default TriageReporter;
