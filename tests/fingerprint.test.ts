import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fingerprint,
  normalizeErrorMessage,
  extractSubject,
} from '../src/classify/fingerprint.js';
import { classifyAll, clusterFailures } from '../src/classify/cluster.js';
import type { FailureRecord } from '../src/types.js';

test('normalization strips volatile parts', () => {
  const a = normalizeErrorMessage('Timeout 5000ms exceeded at 2026-07-06T21:14:03.120Z');
  const b = normalizeErrorMessage('Timeout 30000ms exceeded at 2026-07-07T09:02:44.001Z');
  assert.equal(a, b);
});

test('extracts the locator as subject', () => {
  const subject = extractSubject(
    "Error: expect(locator).toBeVisible() failed\nLocator: locator('[data-test=\"error-banner\"]')",
  );
  assert.equal(subject, '[data-test="error-banner"]');
});

test('extracts URLs with normalized port', () => {
  const subject = extractSubject('net::ERR_CONNECTION_REFUSED at http://localhost:3123/api/cart');
  assert.equal(subject, 'http://localhost:<port>/api/cart');
});

test('same root cause in different tests yields the same fingerprint', () => {
  const message =
    "Error: expect(locator).toBeVisible() failed\nLocator: locator('[data-test=\"error-banner\"]')";
  const fp1 = fingerprint({ errorMessage: message, testId: 'login › test A' }, 'assertion');
  const fp2 = fingerprint({ errorMessage: message, testId: 'login › test B' }, 'assertion');
  assert.equal(fp1, fp2);
});

test('different selectors yield different fingerprints', () => {
  const base = 'Error: expect(locator).toBeVisible() failed\nLocator: ';
  const fp1 = fingerprint(
    { errorMessage: base + "locator('[data-test=\"a\"]')", testId: 't' },
    'assertion',
  );
  const fp2 = fingerprint(
    { errorMessage: base + "locator('[data-test=\"b\"]')", testId: 't' },
    'assertion',
  );
  assert.notEqual(fp1, fp2);
});

test('empty error messages do not collapse distinct tests together', () => {
  const fp1 = fingerprint({ errorMessage: '', testId: 'suite › test A' }, 'unknown');
  const fp2 = fingerprint({ errorMessage: '', testId: 'suite › test B' }, 'unknown');
  assert.notEqual(fp1, fp2);
});

test('clustering groups shared-fingerprint failures into one cluster', () => {
  const message =
    "Error: expect(locator).toBeVisible() failed\nLocator: locator('[data-test=\"error-banner\"]')";
  const failures: FailureRecord[] = [
    makeFailure('test A', message),
    makeFailure('test B', message),
    makeFailure('test C', 'Test timeout of 30000ms exceeded.'),
  ];
  const clusters = clusterFailures(classifyAll(failures));
  assert.equal(clusters.length, 2);
  const sizes = clusters.map((c) => c.failures.length).sort();
  assert.deepEqual(sizes, [1, 2]);
});

function makeFailure(title: string, errorMessage: string): FailureRecord {
  return {
    testId: `suite › ${title}`,
    file: 'suite.spec.ts',
    title,
    project: 'chromium',
    status: 'failed',
    passedOnRetry: false,
    errorMessage,
    errorStack: '',
    steps: [],
    durationMs: 100,
    attachments: [],
    startedAt: '2026-07-06T21:14:03.120Z',
  };
}
