import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HistoryInsight } from '../types.js';

/**
 * Append-only run history persisted as a single JSON file (commit it, cache
 * it in CI, or point --history at a shared location). History is what makes
 * flaky detection possible at all: a single run cannot distinguish a real
 * regression from an intermittent failure.
 */
export interface HistoryRun {
  runId: string;
  at: string;
  failedFingerprints: string[];
}

export interface HistoryFile {
  version: 1;
  runs: HistoryRun[];
}

const MAX_RUNS_KEPT = 100;

export function loadHistory(path: string): HistoryFile {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return { version: 1, runs: [] };
  }
  try {
    const parsed = JSON.parse(raw) as HistoryFile;
    if (parsed.version === 1 && Array.isArray(parsed.runs)) return parsed;
  } catch {
    // fall through — a corrupt history file must never break triage
  }
  return { version: 1, runs: [] };
}

export function appendRun(
  history: HistoryFile,
  run: HistoryRun,
): HistoryFile {
  const runs = [...history.runs, run].slice(-MAX_RUNS_KEPT);
  return { version: 1, runs };
}

export function saveHistory(path: string, history: HistoryFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(history, null, 2) + '\n');
}

/**
 * How a fingerprint behaved across recorded runs (excluding the current
 * one). Intermittent occurrences are the flakiness signal; consecutive
 * occurrences are the regression signal.
 */
export function insightFor(history: HistoryFile, fp: string): HistoryInsight {
  const runs = history.runs;
  const timesSeen = runs.filter((r) => r.failedFingerprints.includes(fp)).length;

  let consecutive = 0;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i]!.failedFingerprints.includes(fp)) consecutive++;
    else break;
  }

  const lastRun = runs[runs.length - 1];
  return {
    runsRecorded: runs.length,
    timesSeen,
    seenInLastRun: lastRun ? lastRun.failedFingerprints.includes(fp) : false,
    consecutiveRunsSeen: consecutive,
    occurrenceRate: runs.length === 0 ? 0 : timesSeen / runs.length,
  };
}

/**
 * Fingerprints that have open reports but have not failed for the last
 * `greenRuns` recorded runs — candidates for closing their issue.
 */
export function resolvedFingerprints(
  history: HistoryFile,
  candidates: string[],
  greenRuns = 5,
): string[] {
  if (history.runs.length < greenRuns) return [];
  const recent = history.runs.slice(-greenRuns);
  return candidates.filter((fp) =>
    recent.every((run) => !run.failedFingerprints.includes(fp)),
  );
}
