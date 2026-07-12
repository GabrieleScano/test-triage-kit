import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jiraPreviewHtml, adfToHtml } from '../src/output/jira-html.js';
import { clusterAdf } from '../src/output/jira.js';
import type { ClusterReport, TriageResult } from '../src/types.js';

function report(overrides: Partial<ClusterReport> = {}): ClusterReport {
  return {
    cluster: {
      fingerprint: 'abc123',
      category: 'assertion',
      representative: {
        testId: 'login.spec.ts > logs in',
        file: 'login.spec.ts',
        title: 'logs in',
        project: 'chromium',
        status: 'failed',
        passedOnRetry: false,
        errorMessage: 'expected banner to be visible',
        errorStack: '',
        steps: [],
        durationMs: 100,
        attachments: [],
        startedAt: new Date().toISOString(),
      },
      failures: [],
    },
    verdict: { type: 'likely-bug', reasons: ['new fingerprint'] },
    ...overrides,
  } as ClusterReport;
}

test('adfToHtml renders headings, lists and code blocks', () => {
  const withAi = report({
    ai: {
      title: 'Error banner missing',
      rootCauseHypothesis: 'The banner component was renamed.',
      severity: 'high',
      severityRationale: 'Blocks the login flow.',
      reproSteps: ['Open the login page', 'Log in as locked_out_user'],
    },
  });
  const html = adfToHtml(clusterAdf(withAi, 'run-1'));
  assert.match(html, /<h3>Root cause hypothesis<\/h3>/);
  assert.match(html, /<pre>expected banner to be visible<\/pre>/);
  assert.match(html, /<ol>.*<li>/s);
});

test('adfToHtml escapes HTML in error text', () => {
  const r = report({
    cluster: {
      ...report().cluster,
      representative: { ...report().cluster.representative, errorMessage: '<script>alert(1)</script>' },
    },
  });
  const html = adfToHtml(clusterAdf(r, 'run-1'));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('jiraPreviewHtml only cards likely-bug verdicts, with sequential issue keys', () => {
  const result: TriageResult = {
    stats: { runId: 'run-1', startedAt: '', total: 2, passed: 0, failed: 2, flaky: 0, skipped: 0 },
    reports: [
      report({ cluster: { ...report().cluster, fingerprint: 'aaa' } }),
      report({ cluster: { ...report().cluster, fingerprint: 'bbb' }, verdict: { type: 'likely-flaky', reasons: [] } }),
      report({ cluster: { ...report().cluster, fingerprint: 'ccc' } }),
    ],
  };
  const html = jiraPreviewHtml(result, 'QA');
  assert.match(html, /QA-1/);
  assert.match(html, /QA-2/);
  assert.doesNotMatch(html, /QA-3/);
});

test('jiraPreviewHtml handles a run with no likely-bug verdicts', () => {
  const result: TriageResult = {
    stats: { runId: 'run-2', startedAt: '', total: 1, passed: 0, failed: 1, flaky: 1, skipped: 0 },
    reports: [report({ verdict: { type: 'likely-flaky', reasons: [] } })],
  };
  assert.match(jiraPreviewHtml(result, 'QA'), /No likely-bug verdicts/);
});

test('jiraPreviewHtml embeds an illustration when one is provided for the fingerprint, with its caption', () => {
  const result: TriageResult = {
    stats: { runId: 'run-3', startedAt: '', total: 1, passed: 0, failed: 1, flaky: 0, skipped: 0 },
    reports: [report()],
  };
  const html = jiraPreviewHtml(result, 'QA', { abc123: '<svg><rect/></svg>' });
  assert.match(html, /<svg><rect\/><\/svg>/);
  assert.match(html, /not a captured screenshot/);
});

test('jiraPreviewHtml renders no illustration when none is provided for the fingerprint', () => {
  const result: TriageResult = {
    stats: { runId: 'run-4', startedAt: '', total: 1, passed: 0, failed: 1, flaky: 0, skipped: 0 },
    reports: [report()],
  };
  const html = jiraPreviewHtml(result, 'QA', { 'some-other-fingerprint': '<svg></svg>' });
  assert.doesNotMatch(html, /class="attachment"/);
});
