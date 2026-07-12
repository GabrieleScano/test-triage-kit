import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jiraConfigFromEnv,
  syncJiraIssues,
  clusterAdf,
  extractFingerprint,
  type JiraConfig,
} from '../src/output/jira.js';
import type { ClusterReport } from '../src/types.js';

const config: JiraConfig = {
  baseUrl: 'https://example.atlassian.net',
  email: 'qa@example.com',
  apiToken: 'token',
  projectKey: 'QA',
};

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

/** Records every fetch call and returns scripted responses in order. */
function mockFetch(responses: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = responses[i++];
    return new Response(JSON.stringify(body ?? {}), { status: 200 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test('jiraConfigFromEnv requires all four variables', () => {
  const saved = {
    JIRA_BASE_URL: process.env.JIRA_BASE_URL,
    JIRA_EMAIL: process.env.JIRA_EMAIL,
    JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
    JIRA_PROJECT_KEY: process.env.JIRA_PROJECT_KEY,
  };
  delete process.env.JIRA_BASE_URL;
  assert.equal(jiraConfigFromEnv(), undefined);

  process.env.JIRA_BASE_URL = 'https://example.atlassian.net';
  process.env.JIRA_EMAIL = 'qa@example.com';
  process.env.JIRA_API_TOKEN = 'token';
  process.env.JIRA_PROJECT_KEY = 'QA';
  assert.deepEqual(jiraConfigFromEnv(), {
    baseUrl: 'https://example.atlassian.net',
    email: 'qa@example.com',
    apiToken: 'token',
    projectKey: 'QA',
    dryRun: false,
  });

  Object.entries(saved).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
});

test('clusterAdf embeds a matching fingerprint marker', () => {
  const doc = clusterAdf(report(), 'run-1');
  assert.equal(extractFingerprint(doc), 'abc123');
});

test('extractFingerprint returns undefined without a marker', () => {
  assert.equal(extractFingerprint(undefined), undefined);
  assert.equal(
    extractFingerprint({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'no marker here' }] }] }),
    undefined,
  );
});

test('creates a new issue for a likely-bug report with no existing match', async () => {
  const { calls, restore } = mockFetch([{ issues: [] }, { key: 'QA-1' }]);
  try {
    const outcome = await syncJiraIssues(config, [report()], 'run-1', []);
    assert.equal(outcome.created.length, 1);
    assert.equal(outcome.created[0].key, 'QA-1');
    assert.equal(calls[1].url, 'https://example.atlassian.net/rest/api/3/issue');
  } finally {
    restore();
  }
});

test('skips flaky and infrastructure verdicts', async () => {
  const { restore } = mockFetch([{ issues: [] }]);
  try {
    const flaky = report({ verdict: { type: 'likely-flaky', reasons: [] } });
    const outcome = await syncJiraIssues(config, [flaky], 'run-1', []);
    assert.equal(outcome.created.length, 0);
    assert.equal(outcome.skipped.length, 1);
  } finally {
    restore();
  }
});

test('comments instead of duplicating when the fingerprint already has an open issue', async () => {
  const existingDoc = clusterAdf(report(), 'run-0');
  const { calls, restore } = mockFetch([
    { issues: [{ key: 'QA-9', fields: { summary: 'old', description: existingDoc } }] },
    {},
  ]);
  try {
    const outcome = await syncJiraIssues(config, [report()], 'run-2', []);
    assert.equal(outcome.commented.length, 1);
    assert.equal(outcome.commented[0].key, 'QA-9');
    assert.equal(calls[1].url, 'https://example.atlassian.net/rest/api/3/issue/QA-9/comment');
  } finally {
    restore();
  }
});

test('proposes closing issues for resolved fingerprints', async () => {
  const existingDoc = clusterAdf(report(), 'run-0');
  const { calls, restore } = mockFetch([
    { issues: [{ key: 'QA-9', fields: { summary: 'old', description: existingDoc } }] },
    {},
  ]);
  try {
    const outcome = await syncJiraIssues(config, [], 'run-3', ['abc123']);
    assert.equal(outcome.closeProposed.length, 1);
    assert.equal(calls[1].url, 'https://example.atlassian.net/rest/api/3/issue/QA-9/comment');
  } finally {
    restore();
  }
});

test('dry-run logs instead of calling the create/comment endpoints', async () => {
  const { calls, restore } = mockFetch([{ issues: [] }]);
  try {
    const outcome = await syncJiraIssues({ ...config, dryRun: true }, [report()], 'run-1', []);
    assert.equal(outcome.created[0].key, 'DRY-0');
    assert.equal(calls.length, 1); // only the search call, no create call
  } finally {
    restore();
  }
});
