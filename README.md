# Test Triage Kit

Failure-triage toolkit for **Playwright**: it turns raw test failures into deduplicated, classified, AI-enriched bug reports — and knows when *not* to open one.

[![CI](https://github.com/GabrieleScano/test-triage-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/GabrieleScano/test-triage-kit/actions/workflows/ci.yml)

**[See a live triage report →](https://gabrielescano.github.io/test-triage-kit/)** — the pipeline run on the bundled fixture: clustered bugs, a flaky test, stated verdicts, and the AI-written bug reports (human title, root-cause hypothesis, severity, repro steps). The model responses are [recorded](fixtures/recorded-ai.json) and validated by the real parser, so CI rebuilds the page deterministically without an API key; the [deterministic-only output](https://gabrielescano.github.io/test-triage-kit/deterministic/) is published alongside for comparison.

## Why this project

Auto-filing a bug for every red test produces noise, not triage. The real problems are the ones a single failing test can't answer:

- **Is this one bug or ten?** Ten tests broken by the same selector should become *one* report.
- **Is it a bug at all?** Flaky tests and environment outages are not application bugs.
- **Is it new?** A known failure should update its existing issue, not open a duplicate.

The pipeline answers those questions deterministically, then uses AI only for what rules can't do: writing the report a developer actually wants to read.

```
ingest → classify → fingerprint/cluster → history → verdict → (AI enrich) → outputs
```

| Stage | What it does | Deterministic? |
|---|---|---|
| Ingest | Playwright JSON report **or** the included custom reporter | ✅ |
| Classify | Rule engine: `assertion` / `timeout` / `network` / `crash` / `setup` | ✅ |
| Fingerprint | Normalizes volatile parts (durations, ids, ports) and hashes category + selector + message → failures with one root cause cluster together | ✅ |
| History | Append-only run history → flaky detection ("failed 2 of 10 runs, never twice in a row") | ✅ |
| Verdict | `likely-bug` / `likely-flaky` / `infrastructure` — with stated reasons | ✅ |
| AI enrichment | Human-readable title, root-cause hypothesis, severity proposal, natural-language repro steps; plus a cross-run synthesis ("12 failures, one systemic cause") | ➕ additive |
| Outputs | Markdown reports, static HTML triage page, GitHub Issues / Jira lifecycle, Slack digest | ✅ |

The rule engine is the source of truth; the AI layer (Anthropic Messages API with structured outputs) is best-effort — a network error never breaks triage, and its output is schema-validated before anything downstream uses it.

## Usage

```bash
npm ci
npm test          # unit tests, no network needed
npm run demo      # triage the bundled fixture report into triage-output/
```

Against a real run:

```bash
npx playwright test --reporter=json > report.json   # in your test project
npx triage report.json --out triage-output --history .triage-history.json
```

Or wire the custom reporter into `playwright.config.ts` and consume its normalized output:

```ts
reporter: [
  ['html'],
  ['test-triage-kit/reporter', { outputFile: 'triage-input.json' }],
],
```

Options: `--no-ai`, `--github` (+ `--dry-run`), `--jira` (+ `--dry-run`), `--slack`, `--help`.

## GitHub Issues lifecycle

With `--github` (needs `GITHUB_TOKEN` + `GITHUB_REPOSITORY`, both present in GitHub Actions):

- **New fingerprint + likely-bug verdict** → opens an issue (labels `bug`, `automated-triage`), with the fingerprint embedded as a marker in the body.
- **Known fingerprint** → comments the new occurrence on the existing issue. No duplicates, ever.
- **Fingerprint green for 5 runs** → comments a close proposal. It never closes issues on its own — that judgement stays human.
- **Flaky / infrastructure verdicts** → deliberately skipped. Filing them as bugs is exactly the noise this tool exists to prevent.

## Jira lifecycle

Same contract, ported to Jira Cloud. With `--jira` (needs `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`):

- Issues are created via the Jira REST API v3, with the description built as **Atlassian Document Format** (not Markdown) — headings, bullet/ordered lists and a code block for the error, plus the fingerprint marker as its own paragraph.
- Open issues labeled `automated-triage` are matched by walking their ADF description for that marker, so the dedupe/comment/close-proposal lifecycle is identical to the GitHub one.
- Runs against the **free tier of Jira Cloud** — no paid plan required to try it end to end.

## AI layer

```bash
cp .env.example .env   # add your ANTHROPIC_API_KEY
```

Per cluster, Claude receives the error, the executed `test.step()` titles, the rule-engine category and the history, and returns strict JSON (title, root-cause *hypothesis*, severity + rationale, repro steps). At run level it makes the one judgement no per-failure view can: whether the failures share a systemic cause (environment down, broken deploy) — in which case the summary says so instead of reporting N separate bugs.

Without an API key everything still works; reports are simply built from the deterministic data.

## Design principles

- **Honest verdicts.** Every verdict states its reasons; "possible flakiness" is a first-class outcome, not an embarrassment to hide.
- **One root cause, one report.** Deduplication by fingerprint is the core feature, not an afterthought.
- **AI proposes, humans decide.** Severity is a proposal; issue closing is a suggestion; the rule engine can always run offline.
- **Runner-agnostic core.** Everything after ingestion works on a normalized `FailureRecord` — Playwright is the first adapter, not a hard dependency.

## Related projects

Part of a QA engineering portfolio covering the full cycle: [requirements-analyzer](https://github.com/GabrieleScano/requirements-analyzer) (shift-left requirements review) → [ai-augmented-e2e](https://github.com/GabrieleScano/ai-augmented-e2e) (test design & execution) → **test-triage-kit** (failure triage).

The kit is wired into `ai-augmented-e2e`'s CI as a live integration: its Playwright config loads `test-triage-kit/reporter`, and every workflow run triages the failures and uploads the verdicts as a build artifact.
