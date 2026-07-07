import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendRun,
  insightFor,
  resolvedFingerprints,
  type HistoryFile,
} from '../src/history/store.js';

function historyOf(fingerprintsPerRun: string[][]): HistoryFile {
  let history: HistoryFile = { version: 1, runs: [] };
  fingerprintsPerRun.forEach((fps, i) => {
    history = appendRun(history, {
      runId: `run-${i}`,
      at: new Date(2026, 6, i + 1).toISOString(),
      failedFingerprints: fps,
    });
  });
  return history;
}

test('insight counts occurrences and consecutive streak', () => {
  const history = historyOf([['aaa'], [], ['aaa'], ['aaa']]);
  const insight = insightFor(history, 'aaa');
  assert.equal(insight.runsRecorded, 4);
  assert.equal(insight.timesSeen, 3);
  assert.equal(insight.consecutiveRunsSeen, 2);
  assert.equal(insight.seenInLastRun, true);
  assert.equal(insight.occurrenceRate, 0.75);
});

test('insight for an unseen fingerprint is all zeros', () => {
  const insight = insightFor(historyOf([['aaa'], ['bbb']]), 'ccc');
  assert.equal(insight.timesSeen, 0);
  assert.equal(insight.consecutiveRunsSeen, 0);
  assert.equal(insight.seenInLastRun, false);
});

test('resolvedFingerprints requires enough green runs', () => {
  // 'aaa' failed long ago, green for the last 5 runs → resolved
  const history = historyOf([['aaa'], [], [], [], [], []]);
  assert.deepEqual(resolvedFingerprints(history, ['aaa'], 5), ['aaa']);

  // seen again 2 runs ago → not resolved
  const recent = historyOf([['aaa'], [], [], [], ['aaa'], []]);
  assert.deepEqual(resolvedFingerprints(recent, ['aaa'], 5), []);

  // not enough history yet → never propose closing
  const short = historyOf([[], []]);
  assert.deepEqual(resolvedFingerprints(short, ['aaa'], 5), []);
});

test('history is capped at 100 runs', () => {
  const history = historyOf(Array.from({ length: 130 }, () => []));
  assert.equal(history.runs.length, 100);
  assert.equal(history.runs[0]?.runId, 'run-30');
});
