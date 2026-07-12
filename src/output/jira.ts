import type { ClusterReport } from '../types.js';
import { defaultTitle } from './markdown.js';

/**
 * Jira Cloud issue lifecycle — the same dedupe-by-fingerprint contract as
 * output/github.ts, ported to Jira's Atlassian Document Format (ADF)
 * instead of Markdown. Existing open issues are matched by a
 * "triage-fingerprint: <hash>" marker paragraph embedded in their
 * description; a known failure becomes a comment, not a new issue.
 *
 * Uses the Jira REST API v3 via fetch. Auth: JIRA_EMAIL + JIRA_API_TOKEN
 * (Basic auth, as Jira Cloud requires), JIRA_BASE_URL and JIRA_PROJECT_KEY.
 * Works against the free tier of Jira Cloud — no paid plan needed.
 */
const TRIAGE_LABEL = 'automated-triage';
const MARKER = /triage-fingerprint:\s*([0-9a-f]+)/;

export interface JiraConfig {
  baseUrl: string; // "https://your-domain.atlassian.net"
  email: string;
  apiToken: string;
  projectKey: string;
  /** Log actions instead of performing them. */
  dryRun?: boolean;
}

export interface JiraIssueRef {
  key: string;
  fingerprint: string;
  summary: string;
}

export interface JiraSyncOutcome {
  created: JiraIssueRef[];
  commented: JiraIssueRef[];
  closeProposed: JiraIssueRef[];
  skipped: string[];
}

// Minimal Atlassian Document Format node shapes — just enough to build and
// walk the nodes this module actually emits.
export interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
}
export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

export function jiraConfigFromEnv(dryRun = false): JiraConfig | undefined {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY;
  if (!baseUrl || !email || !apiToken || !projectKey) return undefined;
  return { baseUrl, email, apiToken, projectKey, dryRun };
}

export async function syncJiraIssues(
  config: JiraConfig,
  reports: ClusterReport[],
  runId: string,
  resolvedFps: string[],
): Promise<JiraSyncOutcome> {
  const open = await listOpenTriageIssues(config);
  const byFingerprint = new Map(open.map((i) => [i.fingerprint, i]));
  const outcome: JiraSyncOutcome = { created: [], commented: [], closeProposed: [], skipped: [] };

  for (const report of reports) {
    const fp = report.cluster.fingerprint;

    // Same policy as the GitHub lifecycle: flaky/infra verdicts don't get a
    // bug filed against them.
    if (report.verdict.type === 'likely-flaky' || report.verdict.type === 'infrastructure') {
      outcome.skipped.push(`${fp} (${report.verdict.type})`);
      continue;
    }

    const existing = byFingerprint.get(fp);
    if (existing) {
      await comment(
        config,
        existing.key,
        `Failure occurred again in run "${runId}" — ${report.cluster.failures.length} occurrence(s).`,
      );
      outcome.commented.push(existing);
    } else {
      const created = await createIssue(config, report, runId);
      outcome.created.push(created);
    }
  }

  for (const fp of resolvedFps) {
    const issue = byFingerprint.get(fp);
    if (!issue) continue;
    await comment(
      config,
      issue.key,
      `This failure has not occurred in the last runs (fingerprint "${fp}" green). Consider closing this issue.`,
    );
    outcome.closeProposed.push(issue);
  }

  return outcome;
}

export async function listOpenTriageIssues(config: JiraConfig): Promise<JiraIssueRef[]> {
  const jql = `project = "${config.projectKey}" AND labels = "${TRIAGE_LABEL}" AND statusCategory != Done`;
  const result = await jiraApi<{
    issues: { key: string; fields: { summary: string; description?: AdfDoc } }[];
  }>(config, 'POST', '/rest/api/3/search', {
    jql,
    fields: ['summary', 'description'],
    maxResults: 100,
  });
  return result.issues.flatMap((issue) => {
    const fingerprint = extractFingerprint(issue.fields.description);
    return fingerprint
      ? [{ key: issue.key, fingerprint, summary: issue.fields.summary }]
      : [];
  });
}

async function createIssue(
  config: JiraConfig,
  report: ClusterReport,
  runId: string,
): Promise<JiraIssueRef> {
  const summary = report.ai?.title ?? defaultTitle(report);
  const fp = report.cluster.fingerprint;
  if (config.dryRun) {
    console.log(`[dry-run] would create Jira issue: ${summary}`);
    return { key: 'DRY-0', fingerprint: fp, summary };
  }
  const created = await jiraApi<{ key: string }>(config, 'POST', '/rest/api/3/issue', {
    fields: {
      project: { key: config.projectKey },
      summary,
      issuetype: { name: 'Bug' },
      labels: [TRIAGE_LABEL],
      description: clusterAdf(report, runId),
    },
  });
  return { key: created.key, fingerprint: fp, summary };
}

async function comment(config: JiraConfig, issueKey: string, text: string): Promise<void> {
  if (config.dryRun) {
    console.log(`[dry-run] would comment on ${issueKey}: ${text}`);
    return;
  }
  await jiraApi(config, 'POST', `/rest/api/3/issue/${issueKey}/comment`, {
    body: textAdf(text),
  });
}

async function jiraApi<T>(
  config: JiraConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Basic ${auth}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Jira API ${method} ${path}: ${response.status} ${response.statusText}`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

// --- ADF -------------------------------------------------------------------

const VERDICT_LABEL: Record<string, string> = {
  'likely-bug': 'Likely application bug',
  'likely-flaky': 'Likely flaky test',
  infrastructure: 'Infrastructure / environment',
  unknown: 'Unclassified',
};

/** Issue description for a cluster report, as an ADF document. */
export function clusterAdf(report: ClusterReport, runId: string): AdfDoc {
  const { cluster, verdict, history, ai } = report;
  const content: AdfNode[] = [];

  content.push(paragraph(`Verdict: ${VERDICT_LABEL[verdict.type] ?? verdict.type}`));
  if (verdict.reasons.length > 0) content.push(bulletList(verdict.reasons));

  const fields = [
    `Category: ${cluster.category}`,
    `triage-fingerprint: ${cluster.fingerprint}`,
    `Occurrences this run: ${cluster.failures.length}`,
    `Run: ${runId}`,
  ];
  if (ai) fields.push(`Proposed severity: ${ai.severity} — ${ai.severityRationale}`);
  if (history && history.runsRecorded > 0) {
    fields.push(
      `History: seen in ${history.timesSeen}/${history.runsRecorded} past runs (${history.consecutiveRunsSeen} consecutive)`,
    );
  }
  content.push(bulletList(fields));

  if (ai) {
    content.push(heading('Root cause hypothesis'));
    content.push(paragraph(ai.rootCauseHypothesis));
    content.push(heading('Steps to reproduce'));
    content.push(orderedList(ai.reproSteps));
  }

  content.push(heading('Error'));
  content.push(codeBlock(truncate(cluster.representative.errorMessage || '(empty error message)', 2000)));

  return { type: 'doc', version: 1, content };
}

function textAdf(text: string): AdfDoc {
  return { type: 'doc', version: 1, content: [paragraph(text)] };
}

function paragraph(text: string): AdfNode {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}
function heading(text: string): AdfNode {
  return { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text }] };
}
function codeBlock(text: string): AdfNode {
  return { type: 'codeBlock', content: [{ type: 'text', text }] };
}
function bulletList(items: string[]): AdfNode {
  return { type: 'bulletList', content: items.map(listItem) };
}
function orderedList(items: string[]): AdfNode {
  return { type: 'orderedList', content: items.map(listItem) };
}
function listItem(text: string): AdfNode {
  return { type: 'listItem', content: [paragraph(text)] };
}

/** Recovers the fingerprint marker embedded in an issue's ADF description. */
export function extractFingerprint(doc: AdfDoc | undefined): string | undefined {
  if (!doc) return undefined;
  return MARKER.exec(collectText(doc))?.[1];
}

function collectText(node: AdfNode | AdfDoc): string {
  const own = 'text' in node && node.text ? [node.text] : [];
  const children = node.content?.map(collectText) ?? [];
  return [...own, ...children].join(' ');
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}
