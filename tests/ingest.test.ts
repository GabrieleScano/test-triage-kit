import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestPlaywrightJson } from '../src/ingest/playwright-json.js';

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../fixtures/sample-report.json'),
    'utf-8',
  ),
) as unknown;

test('ingests failures and flaky tests from a Playwright JSON report', () => {
  const { stats, failures } = ingestPlaywrightJson(fixture, 'run-test');

  assert.equal(stats.failed, 3);
  assert.equal(stats.flaky, 1);
  assert.equal(stats.passed, 21);
  assert.equal(failures.length, 4);

  const flaky = failures.filter((f) => f.passedOnRetry);
  assert.equal(flaky.length, 1);
  assert.equal(flaky[0]?.title, 'shows the cart badge after adding an item');
});

test('captures error, steps and attachments', () => {
  const { failures } = ingestPlaywrightJson(fixture, 'run-test');
  const lockedOut = failures.find((f) => f.title.includes('locked out'));

  assert.ok(lockedOut);
  assert.match(lockedOut.errorMessage, /error-banner/);
  assert.deepEqual(lockedOut.steps, [
    'open login page',
    'submit locked_out_user credentials',
    'verify error banner',
  ]);
  assert.equal(lockedOut.attachments.length, 1);
  assert.equal(lockedOut.attachments[0]?.contentType, 'image/png');
  assert.equal(lockedOut.project, 'chromium');
  assert.equal(lockedOut.status, 'failed');
});

test('flaky test record uses the failing attempt, not the passing retry', () => {
  const { failures } = ingestPlaywrightJson(fixture, 'run-test');
  const flaky = failures.find((f) => f.passedOnRetry);
  assert.ok(flaky);
  assert.match(flaky.errorMessage, /toHaveText/);
});

test('rejects data that is not a Playwright report', () => {
  assert.throws(() => ingestPlaywrightJson({ foo: 'bar' }, 'run-test'), /Not a Playwright JSON report/);
});
