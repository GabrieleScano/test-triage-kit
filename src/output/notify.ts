import type { TriageResult } from '../types.js';

/**
 * Slack (or compatible) incoming-webhook notification with the run digest.
 * Best-effort: a failed webhook logs a warning and never breaks triage.
 */
export async function notifySlack(webhookUrl: string, result: TriageResult): Promise<void> {
  const { stats, reports, synthesis } = result;

  const newBugs = reports.filter((r) => r.verdict.type === 'likely-bug').length;
  const flaky = reports.filter((r) => r.verdict.type === 'likely-flaky').length;
  const infra = reports.filter((r) => r.verdict.type === 'infrastructure').length;

  const lines = [
    `*Test triage — run \`${stats.runId}\`*`,
    `${stats.failed} failed / ${stats.flaky} flaky / ${stats.passed} passed — ${reports.length} root cause(s): ${newBugs} likely bug, ${flaky} flaky, ${infra} infrastructure.`,
  ];
  if (synthesis) {
    lines.push(synthesis.systemicIssue ? `:warning: ${synthesis.summary}` : synthesis.summary);
    lines.push(`_${synthesis.recommendation}_`);
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: lines.join('\n') }),
  });
  if (!response.ok) {
    throw new Error(`Slack webhook responded ${response.status}`);
  }
}
