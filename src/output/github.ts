import type { ClusterReport } from '../types.js';
import { clusterMarkdown, defaultTitle } from './markdown.js';

/**
 * GitHub Issues lifecycle. Deduplication is the whole point: before opening
 * anything, existing open issues are matched by the fingerprint marker
 * embedded in their body. A known failure becomes a comment on its issue,
 * not a new one; a fingerprint that has been green for N runs gets a
 * close proposal. Without this, auto-filed issues are pure noise.
 *
 * Uses the GitHub REST API via fetch — no SDK needed for four endpoints.
 * Auth: GITHUB_TOKEN + GITHUB_REPOSITORY ("owner/repo"), both provided
 * automatically in GitHub Actions.
 */
const API = 'https://api.github.com';
const TRIAGE_LABEL = 'automated-triage';
const MARKER = /<!-- triage-fingerprint: ([0-9a-f]+) -->/;

export interface GithubConfig {
  token: string;
  repo: string; // "owner/repo"
  /** Log actions instead of performing them. */
  dryRun?: boolean;
}

export interface IssueRef {
  number: number;
  fingerprint: string;
  title: string;
}

export interface SyncOutcome {
  created: IssueRef[];
  commented: IssueRef[];
  closeProposed: IssueRef[];
  skipped: string[];
}

export function githubConfigFromEnv(dryRun = false): GithubConfig | undefined {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return undefined;
  return { token, repo, dryRun };
}

export async function syncIssues(
  config: GithubConfig,
  reports: ClusterReport[],
  runId: string,
  resolvedFps: string[],
): Promise<SyncOutcome> {
  const open = await listOpenTriageIssues(config);
  const byFingerprint = new Map(open.map((i) => [i.fingerprint, i]));
  const outcome: SyncOutcome = { created: [], commented: [], closeProposed: [], skipped: [] };

  for (const report of reports) {
    const fp = report.cluster.fingerprint;

    // Flaky and infrastructure verdicts don't deserve a bug issue — that is
    // exactly the noise this tool exists to prevent.
    if (report.verdict.type === 'likely-flaky' || report.verdict.type === 'infrastructure') {
      outcome.skipped.push(`${fp} (${report.verdict.type})`);
      continue;
    }

    const existing = byFingerprint.get(fp);
    if (existing) {
      await comment(
        config,
        existing.number,
        `Failure occurred again in run \`${runId}\` — ${report.cluster.failures.length} occurrence(s).`,
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
      issue.number,
      `This failure has not occurred in the last runs (fingerprint \`${fp}\` green). Consider closing this issue.`,
    );
    outcome.closeProposed.push(issue);
  }

  return outcome;
}

export async function listOpenTriageIssues(config: GithubConfig): Promise<IssueRef[]> {
  const issues = await gh<{ number: number; title: string; body?: string }[]>(
    config,
    'GET',
    `/repos/${config.repo}/issues?labels=${TRIAGE_LABEL}&state=open&per_page=100`,
  );
  return issues.flatMap((issue) => {
    const match = issue.body?.match(MARKER);
    return match?.[1]
      ? [{ number: issue.number, fingerprint: match[1], title: issue.title }]
      : [];
  });
}

async function createIssue(
  config: GithubConfig,
  report: ClusterReport,
  runId: string,
): Promise<IssueRef> {
  const title = report.ai?.title ?? defaultTitle(report);
  const fp = report.cluster.fingerprint;
  if (config.dryRun) {
    console.log(`[dry-run] would create issue: ${title}`);
    return { number: 0, fingerprint: fp, title };
  }
  const created = await gh<{ number: number }>(
    config,
    'POST',
    `/repos/${config.repo}/issues`,
    {
      title,
      body: clusterMarkdown(report, runId),
      labels: ['bug', TRIAGE_LABEL],
    },
  );
  return { number: created.number, fingerprint: fp, title };
}

async function comment(config: GithubConfig, issue: number, body: string): Promise<void> {
  if (config.dryRun) {
    console.log(`[dry-run] would comment on #${issue}: ${body}`);
    return;
  }
  await gh(config, 'POST', `/repos/${config.repo}/issues/${issue}/comments`, { body });
}

async function gh<T>(
  config: GithubConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${method} ${path}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}
