import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/classify/rules.js';

const cases: [string, string, string][] = [
  ['assertion', 'Error: expect(locator).toBeVisible() failed', ''],
  ['assertion', 'AssertionError: expected 200, received 500', ''],
  ['timeout', 'Test timeout of 30000ms exceeded.', ''],
  ['timeout', 'page.click: Timeout 5000ms exceeded while waiting for locator', ''],
  ['network', 'Error: net::ERR_CONNECTION_REFUSED at http://localhost:3000', ''],
  ['network', 'FetchError: request failed, ECONNRESET', ''],
  ['crash', 'Error: Target page, context or browser has been closed', ''],
  ['setup', 'Error in beforeEach hook: database seed failed', ''],
  ['unknown', 'something completely different happened', ''],
];

for (const [expected, message, stack] of cases) {
  test(`classifies "${message.slice(0, 50)}" as ${expected}`, () => {
    assert.equal(classify({ errorMessage: message, errorStack: stack }), expected);
  });
}

test('an expect() failure whose call log mentions "waiting for locator" is an assertion, not a timeout', () => {
  const message =
    'Error: expect(locator).toBeVisible() failed\n\n' +
    "Locator: locator('[data-test=\"error-banner\"]')\n" +
    'Expected: visible\nReceived: <element(s) not found>\n' +
    'Call log:\n  - expect.toBeVisible with timeout 5000ms\n' +
    "  - waiting for locator('[data-test=\"error-banner\"]')";
  assert.equal(classify({ errorMessage: message, errorStack: '' }), 'assertion');
});

test('crash wins over timeout when both signals are present', () => {
  const message = 'Timeout 30000ms exceeded.\nError: Target page, context or browser has been closed';
  assert.equal(classify({ errorMessage: message, errorStack: '' }), 'crash');
});

test('uses the stack when the message is empty', () => {
  assert.equal(
    classify({ errorMessage: '', errorStack: 'Error: net::ERR_NAME_NOT_RESOLVED' }),
    'network',
  );
});
