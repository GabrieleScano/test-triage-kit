import type { FailureCategory, FailureRecord } from '../types.js';

/**
 * Deterministic classification of a failure into a category.
 *
 * This rule engine is the source of truth for triage: it runs offline, is
 * fully unit-tested, and its output feeds fingerprinting and verdicts. The
 * AI layer is additive on top of it, never a replacement.
 *
 * Rules are evaluated in order; the first match wins. Order matters:
 * a browser crash often also produces timeouts, and a network error often
 * surfaces inside an assertion, so the more specific signals come first.
 */
interface Rule {
  category: FailureCategory;
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    category: 'crash',
    pattern:
      /target (page|context|browser).*closed|browser has been closed|process crashed|SIGSEGV|SIGKILL|worker process exited/i,
  },
  {
    category: 'network',
    pattern:
      /net::ERR_|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|ERR_NETWORK|502 Bad Gateway|503 Service Unavailable|504 Gateway/i,
  },
  {
    category: 'setup',
    pattern: /in beforeAll hook|in beforeEach hook|Error in fixture|worker setup/i,
  },
  {
    // Deliberately narrow: only definitive timeout phrases. An assertion
    // failure's call log also says "waiting for locator(...)" — matching on
    // that would misclassify every expect() failure as a timeout.
    category: 'timeout',
    pattern: /Test timeout of \d+ms exceeded|Timeout \d+ms exceeded|Timed out \d+ms waiting for (navigation|event)/i,
  },
  {
    category: 'assertion',
    pattern: /expect\(|toBe|toEqual|toHave|toContain|AssertionError|expected .* received/i,
  },
];

export function classify(failure: Pick<FailureRecord, 'errorMessage' | 'errorStack'>): FailureCategory {
  const haystack = `${failure.errorMessage}\n${failure.errorStack}`;
  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) return rule.category;
  }
  return 'unknown';
}
