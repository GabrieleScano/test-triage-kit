import { createHash } from 'node:crypto';
import type { FailureCategory, FailureRecord } from '../types.js';

/**
 * A fingerprint identifies the *root cause* of a failure, not the failing
 * test: ten tests broken by the same missing selector must share one
 * fingerprint so they become one report instead of ten.
 *
 * The signature is category + involved selector/URL + the error's first
 * line with volatile parts (durations, ids, ports, hashes, paths) replaced
 * by placeholders — the same failure must fingerprint identically across
 * runs, machines and retries.
 */

const ANSI = /\[[0-9;]*m/g;

export function normalizeErrorMessage(message: string): string {
  const firstLine =
    message
      .replace(ANSI, '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';

  return firstLine
    .replace(/\d+ms/g, 'Nms')
    .replace(/\d+(\.\d+)?s\b/g, 'Ns')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{7,40}\b/g, '<hash>')
    .replace(/:\d{2,5}\//g, ':<port>/')
    .replace(/\/[\w./-]*\/(test-results|node_modules)\/[\w./-]*/g, '<path>')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<timestamp>')
    .replace(/\b\d{4,}\b/g, '<n>');
}

/** Extract the locator / selector / URL the failure revolves around, if any. */
export function extractSubject(message: string): string {
  const clean = message.replace(ANSI, '');

  const locator = clean.match(/locator\((['"`])(.+?)\1\)/);
  if (locator?.[2]) return locator[2];

  const getBy = clean.match(/getBy\w+\((['"`])(.+?)\1[),]/);
  if (getBy?.[2]) return getBy[2];

  const waitingFor = clean.match(/waiting for (?:locator|selector) (['"`])(.+?)\1/);
  if (waitingFor?.[2]) return waitingFor[2];

  const url = clean.match(/https?:\/\/[^\s"')]+/);
  if (url?.[0]) return url[0].replace(/:\d{2,5}/, ':<port>');

  return '';
}

export function fingerprint(
  failure: Pick<FailureRecord, 'errorMessage' | 'testId'>,
  category: FailureCategory,
): string {
  const normalized = normalizeErrorMessage(failure.errorMessage);
  const subject = extractSubject(failure.errorMessage);
  // With no usable error text there is nothing to cluster on — fall back to
  // the test identity so distinct silent failures don't collapse together.
  const signature = normalized
    ? `${category}|${subject}|${normalized}`
    : `${category}|${failure.testId}`;
  return createHash('sha1').update(signature).digest('hex').slice(0, 16);
}
