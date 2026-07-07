import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdictFor } from '../src/verdict.js';
import type { ClassifiedFailure, FailureCluster, HistoryInsight, RunStats } from '../src/types.js';

function makeCluster(
  category: FailureCluster['category'],
  count = 1,
  passedOnRetry = false,
): FailureCluster {
  const failures: ClassifiedFailure[] = Array.from({ length: count }, (_, i) => ({
    testId: `suite › test ${i}`,
    file: 'suite.spec.ts',
    title: `test ${i}`,
    project: 'chromium',
    status: 'failed',
    passedOnRetry,
    errorMessage: 'boom',
    errorStack: '',
    steps: [],
    durationMs: 100,
    attachments: [],
    startedAt: '',
    category,
    fingerprint: 'fp',
  }));
  return { fingerprint: 'fp', category, failures, representative: failures[0]! };
}

const stats: RunStats = {
  runId: 'r',
  startedAt: '',
  total: 20,
  passed: 16,
  failed: 4,
  flaky: 0,
  skipped: 0,
};

function insight(partial: Partial<HistoryInsight>): HistoryInsight {
  return {
    runsRecorded: 0,
    timesSeen: 0,
    seenInLastRun: false,
    consecutiveRunsSeen: 0,
    occurrenceRate: 0,
    ...partial,
  };
}

test('passed-on-retry is likely flaky', () => {
  const verdict = verdictFor(makeCluster('assertion', 1, true), undefined, stats);
  assert.equal(verdict.type, 'likely-flaky');
});

test('network and crash categories are infrastructure', () => {
  assert.equal(verdictFor(makeCluster('network'), undefined, stats).type, 'infrastructure');
  assert.equal(verdictFor(makeCluster('crash'), undefined, stats).type, 'infrastructure');
});

test('intermittent history makes an assertion likely flaky', () => {
  const flakyHistory = insight({
    runsRecorded: 10,
    timesSeen: 2,
    occurrenceRate: 0.2,
    seenInLastRun: false,
  });
  assert.equal(verdictFor(makeCluster('assertion'), flakyHistory, stats).type, 'likely-flaky');
});

test('a stable assertion failure is a likely bug', () => {
  const consistent = insight({ runsRecorded: 5, timesSeen: 3, consecutiveRunsSeen: 3, occurrenceRate: 0.6, seenInLastRun: true });
  assert.equal(verdictFor(makeCluster('assertion'), consistent, stats).type, 'likely-bug');
});

test('widespread timeouts point at infrastructure, isolated ones at a bug', () => {
  const widespread = verdictFor(makeCluster('timeout', 3), undefined, stats);
  assert.equal(widespread.type, 'infrastructure');

  const isolated = verdictFor(makeCluster('timeout', 1), undefined, stats);
  assert.equal(isolated.type, 'likely-bug');
});
