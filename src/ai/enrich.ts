import Anthropic from '@anthropic-ai/sdk';
import type {
  AiEnrichment,
  ClusterReport,
  RunStats,
  RunSynthesis,
} from '../types.js';

/**
 * AI enrichment layer — strictly additive. The rule engine and history are
 * the source of truth; this layer rewrites a failure into a human-readable
 * bug report (title, root-cause hypothesis, severity proposal, repro steps)
 * and, at run level, judges whether the failures share a systemic cause.
 * Callers treat every function here as best-effort: a network or API error
 * must never break the deterministic triage.
 */
const MODEL = 'claude-opus-4-8';

const ENRICH_SYSTEM = `You are a senior QA engineer triaging an automated end-to-end test failure.
You receive the failure context (error, steps, category from a deterministic rule engine, run history).
Write the bug report a developer would want to receive: precise, free of test-jargon, no speculation presented as fact.`;

const ENRICHMENT_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Human-readable bug title describing the observed application behaviour, not the test mechanics.',
    },
    rootCauseHypothesis: {
      type: 'string',
      description: 'Most plausible root cause, phrased as a hypothesis.',
    },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    severityRationale: { type: 'string' },
    reproSteps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Steps to reproduce in natural language, derived from the test steps.',
    },
  },
  required: ['title', 'rootCauseHypothesis', 'severity', 'severityRationale', 'reproSteps'],
  additionalProperties: false,
} as const;

const SYNTHESIS_SYSTEM = `You are a senior QA engineer looking at ALL failures of a test run together.
Your job is the cross-run judgement a single-failure view cannot make: do these failures share one systemic cause
(e.g. environment down, global slowdown, one broken deploy) or are they independent issues?`;

const SYNTHESIS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two or three sentences summarizing the run for a team channel.' },
    systemicIssue: {
      type: 'boolean',
      description: 'True when the failures likely share a single systemic cause.',
    },
    recommendation: { type: 'string', description: 'The single most useful next action for the team.' },
  },
  required: ['summary', 'systemicIssue', 'recommendation'],
  additionalProperties: false,
} as const;

export function aiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function enrichCluster(report: ClusterReport): Promise<AiEnrichment> {
  const { cluster, verdict, history } = report;
  const rep = cluster.representative;

  const prompt = [
    `Test: ${rep.testId}`,
    `File: ${rep.file}`,
    `Category (rule engine): ${cluster.category}`,
    `Deterministic verdict: ${verdict.type} — ${verdict.reasons.join('; ')}`,
    `Occurrences in this run: ${cluster.failures.length} (${cluster.failures.map((f) => f.project || 'default').join(', ')})`,
    history
      ? `History: seen in ${history.timesSeen}/${history.runsRecorded} past runs, ${history.consecutiveRunsSeen} consecutive.`
      : 'History: none recorded.',
    '',
    'Test steps executed before failing:',
    ...(rep.steps.length > 0 ? rep.steps.map((s) => `- ${s}`) : ['(no steps recorded)']),
    '',
    'Error message:',
    rep.errorMessage || '(empty)',
  ].join('\n');

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: ENRICH_SYSTEM,
    output_config: { format: { type: 'json_schema', schema: ENRICHMENT_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  });

  return parseEnrichment(firstText(response));
}

export async function synthesizeRun(
  reports: ClusterReport[],
  stats: RunStats,
): Promise<RunSynthesis> {
  const prompt = [
    `Run: ${stats.failed} failed, ${stats.flaky} flaky, ${stats.passed} passed out of ${stats.total} tests.`,
    '',
    'Failure clusters (one line each):',
    ...reports.map(({ cluster, verdict }) => {
      const rep = cluster.representative;
      const firstLine = rep.errorMessage.split('\n')[0] ?? '';
      return `- [${cluster.category}/${verdict.type}] x${cluster.failures.length} — ${rep.testId}: ${firstLine.slice(0, 160)}`;
    }),
  ].join('\n');

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: SYNTHESIS_SYSTEM,
    output_config: { format: { type: 'json_schema', schema: SYNTHESIS_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  });

  return parseSynthesis(firstText(response));
}

function firstText(response: Anthropic.Message): string {
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') {
    throw new Error('AI response contained no text block.');
  }
  return block.text;
}

const SEVERITIES = ['critical', 'high', 'medium', 'low'];

/**
 * Parse and validate the model output. The API's structured-output format
 * already constrains the shape, but the output is still validated here so
 * malformed data fails loudly instead of corrupting reports or issues —
 * and so the validation is unit-testable without a network call.
 */
export function parseEnrichment(rawText: string): AiEnrichment {
  const obj = parseObject(rawText);

  for (const field of ['title', 'rootCauseHypothesis', 'severityRationale']) {
    if (typeof obj[field] !== 'string' || obj[field] === '') {
      throw new Error(`AI enrichment "${field}" must be a non-empty string.`);
    }
  }
  if (typeof obj.severity !== 'string' || !SEVERITIES.includes(obj.severity)) {
    throw new Error(`AI enrichment "severity" must be one of ${SEVERITIES.join(', ')}.`);
  }
  if (!Array.isArray(obj.reproSteps) || !obj.reproSteps.every((s) => typeof s === 'string')) {
    throw new Error('AI enrichment "reproSteps" must be an array of strings.');
  }

  return {
    title: obj.title as string,
    rootCauseHypothesis: obj.rootCauseHypothesis as string,
    severity: obj.severity as AiEnrichment['severity'],
    severityRationale: obj.severityRationale as string,
    reproSteps: obj.reproSteps as string[],
  };
}

export function parseSynthesis(rawText: string): RunSynthesis {
  const obj = parseObject(rawText);

  for (const field of ['summary', 'recommendation']) {
    if (typeof obj[field] !== 'string' || obj[field] === '') {
      throw new Error(`AI synthesis "${field}" must be a non-empty string.`);
    }
  }
  if (typeof obj.systemicIssue !== 'boolean') {
    throw new Error('AI synthesis "systemicIssue" must be a boolean.');
  }

  return {
    summary: obj.summary as string,
    systemicIssue: obj.systemicIssue,
    recommendation: obj.recommendation as string,
  };
}

function parseObject(rawText: string): Record<string, unknown> {
  const text = rawText.replace(/```json|```/g, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('AI response was not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('AI response was not a JSON object.');
  }
  return parsed as Record<string, unknown>;
}
