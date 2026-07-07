import type {
  FailureCluster,
  HistoryInsight,
  RunStats,
  Verdict,
} from './types.js';

/**
 * Deterministic verdict: is this cluster a probable application bug, a
 * flaky test, or an infrastructure problem? An honest triage tool states
 * this distinction explicitly instead of presenting every failure as a bug
 * — auto-filed issues without it are just noise.
 */
export function verdictFor(
  cluster: FailureCluster,
  history: HistoryInsight | undefined,
  stats: RunStats,
): Verdict {
  const reasons: string[] = [];

  if (cluster.failures.every((f) => f.passedOnRetry)) {
    reasons.push('every occurrence passed on retry in this run');
    return { type: 'likely-flaky', reasons };
  }

  if (cluster.category === 'network' || cluster.category === 'crash') {
    reasons.push(`category "${cluster.category}" points at environment, not application logic`);
    return { type: 'infrastructure', reasons };
  }

  if (history && history.runsRecorded >= 3) {
    if (history.timesSeen > 0 && history.occurrenceRate < 0.3 && !history.seenInLastRun) {
      reasons.push(
        `seen intermittently in ${history.timesSeen}/${history.runsRecorded} past runs, not in the previous one`,
      );
      return { type: 'likely-flaky', reasons };
    }
    if (history.consecutiveRunsSeen >= 2) {
      reasons.push(
        `failed in ${history.consecutiveRunsSeen} consecutive past runs — consistent, not intermittent`,
      );
    }
  }

  if (cluster.category === 'assertion') {
    reasons.push('a stable assertion failure usually means behaviour changed');
    return { type: 'likely-bug', reasons };
  }

  if (cluster.category === 'timeout') {
    const widespread = stats.failed > 0 && cluster.failures.length / stats.failed > 0.5;
    if (widespread) {
      reasons.push('timeouts affect most failures of this run — environment slowdown is more plausible');
      return { type: 'infrastructure', reasons };
    }
    reasons.push('an isolated, repeatable timeout usually hides a real regression or a broken selector');
    return { type: 'likely-bug', reasons };
  }

  if (cluster.category === 'setup') {
    reasons.push('failure happens in test setup, before the behaviour under test runs');
    return { type: 'infrastructure', reasons };
  }

  reasons.push('no rule matched with confidence');
  return { type: 'unknown', reasons };
}
