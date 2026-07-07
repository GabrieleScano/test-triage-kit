import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnrichment, parseSynthesis } from '../src/ai/enrich.js';

const validEnrichment = {
  title: 'Error banner not shown for locked out users',
  rootCauseHypothesis: 'The banner component was renamed.',
  severity: 'high',
  severityRationale: 'Blocks the login error flow.',
  reproSteps: ['Open the login page', 'Log in as locked_out_user'],
};

test('accepts a valid enrichment payload', () => {
  const parsed = parseEnrichment(JSON.stringify(validEnrichment));
  assert.equal(parsed.severity, 'high');
  assert.equal(parsed.reproSteps.length, 2);
});

test('strips markdown fences before parsing', () => {
  const fenced = '```json\n' + JSON.stringify(validEnrichment) + '\n```';
  assert.equal(parseEnrichment(fenced).title, validEnrichment.title);
});

test('rejects invalid JSON', () => {
  assert.throws(() => parseEnrichment('not json'), /not valid JSON/);
});

test('rejects an invalid severity', () => {
  const bad = { ...validEnrichment, severity: 'catastrophic' };
  assert.throws(() => parseEnrichment(JSON.stringify(bad)), /severity/);
});

test('rejects missing fields', () => {
  const { title: _title, ...withoutTitle } = validEnrichment;
  assert.throws(() => parseEnrichment(JSON.stringify(withoutTitle)), /title/);
});

test('rejects non-string repro steps', () => {
  const bad = { ...validEnrichment, reproSteps: [1, 2] };
  assert.throws(() => parseEnrichment(JSON.stringify(bad)), /reproSteps/);
});

test('accepts a valid synthesis payload', () => {
  const parsed = parseSynthesis(
    JSON.stringify({ summary: 'All good.', systemicIssue: false, recommendation: 'Ship it.' }),
  );
  assert.equal(parsed.systemicIssue, false);
});

test('rejects a synthesis with a non-boolean systemicIssue', () => {
  assert.throws(
    () =>
      parseSynthesis(
        JSON.stringify({ summary: 's', systemicIssue: 'yes', recommendation: 'r' }),
      ),
    /systemicIssue/,
  );
});
