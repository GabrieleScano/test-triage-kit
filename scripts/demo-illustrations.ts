import type { ClusterReport } from '../src/types.js';

/**
 * Hand-drawn, theme-safe SVG mockups for the two demo fixture bugs, used
 * only by the Jira preview page. These are diagrams illustrating what each
 * failure looks like in the app — not captured screenshots, since the
 * fixture's Playwright report is synthetic and has no real attachments.
 */
export function illustrationFor(report: ClusterReport): string | undefined {
  switch (report.cluster.category) {
    case 'assertion':
      return loginBannerMockup();
    case 'timeout':
      return checkoutTimeoutMockup();
    default:
      return undefined;
  }
}

function frame(content: string): string {
  return `<svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustrative bug reproduction">
    <rect x="0.5" y="0.5" width="399" height="219" rx="7" fill="none" stroke="currentColor" stroke-opacity=".35"/>
    <rect x="0.5" y="0.5" width="399" height="24" rx="7" fill="currentColor" fill-opacity=".06"/>
    <circle cx="16" cy="12.5" r="3.5" fill="currentColor" fill-opacity=".25"/>
    <circle cx="28" cy="12.5" r="3.5" fill="currentColor" fill-opacity=".25"/>
    <circle cx="40" cy="12.5" r="3.5" fill="currentColor" fill-opacity=".25"/>
    <rect x="60" y="7" width="200" height="11" rx="5.5" fill="currentColor" fill-opacity=".08"/>
    ${content}
  </svg>`;
}

function loginBannerMockup(): string {
  return frame(`
    <text x="24" y="56" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="currentColor">Sign in</text>
    <rect x="24" y="72" width="220" height="16" rx="4" fill="none" stroke="currentColor" stroke-opacity=".35"/>
    <rect x="24" y="98" width="220" height="16" rx="4" fill="none" stroke="currentColor" stroke-opacity=".35"/>
    <rect x="24" y="150" width="90" height="22" rx="5" fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-opacity=".35"/>
    <text x="69" y="165" font-family="system-ui, sans-serif" font-size="11" fill="currentColor" text-anchor="middle">Log in</text>
    <rect x="24" y="120" width="220" height="20" rx="4" fill="none" stroke="#de350b" stroke-width="1.5" stroke-dasharray="4 3"/>
    <text x="34" y="134" font-family="system-ui, sans-serif" font-size="11" fill="#de350b">✕ error banner — expected here, not rendered</text>
  `);
}

function checkoutTimeoutMockup(): string {
  return frame(`
    <text x="24" y="56" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="currentColor">Confirm order</text>
    <circle cx="66" cy="110" r="20" fill="none" stroke="currentColor" stroke-opacity=".2" stroke-width="4"/>
    <path d="M66 90 A20 20 0 0 1 86 110" fill="none" stroke="#de350b" stroke-width="4" stroke-linecap="round"/>
    <text x="100" y="106" font-family="system-ui, sans-serif" font-size="11" fill="currentColor">Waiting for</text>
    <text x="100" y="120" font-family="system-ui, sans-serif" font-size="11" fill="currentColor">checkout-complete.html …</text>
    <rect x="270" y="90" width="106" height="20" rx="10" fill="#de350b" fill-opacity=".12" stroke="#de350b" stroke-opacity=".5"/>
    <text x="323" y="104" font-family="system-ui, sans-serif" font-size="10" fill="#de350b" text-anchor="middle">⏱ 30000ms exceeded</text>
  `);
}
