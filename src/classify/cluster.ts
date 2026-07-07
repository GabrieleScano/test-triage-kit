import type { ClassifiedFailure, FailureCluster, FailureRecord } from '../types.js';
import { classify } from './rules.js';
import { fingerprint } from './fingerprint.js';

export function classifyAll(failures: FailureRecord[]): ClassifiedFailure[] {
  return failures.map((failure) => {
    const category = classify(failure);
    return { ...failure, category, fingerprint: fingerprint(failure, category) };
  });
}

/** Group classified failures by fingerprint: one cluster = one root cause. */
export function clusterFailures(failures: ClassifiedFailure[]): FailureCluster[] {
  const byFingerprint = new Map<string, ClassifiedFailure[]>();
  for (const failure of failures) {
    const group = byFingerprint.get(failure.fingerprint) ?? [];
    group.push(failure);
    byFingerprint.set(failure.fingerprint, group);
  }

  return [...byFingerprint.entries()].map(([fp, group]) => {
    // The representative is the failure with the richest error context —
    // it is what reports and AI prompts are built from.
    const representative = [...group].sort(
      (a, b) => b.errorMessage.length + b.steps.length - (a.errorMessage.length + a.steps.length),
    )[0]!;
    return {
      fingerprint: fp,
      category: representative.category,
      failures: group,
      representative,
    };
  });
}
