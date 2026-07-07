import { readFileSync } from 'node:fs';

/**
 * Minimal, dependency-free `.env` loader.
 *
 * Reads KEY=VALUE pairs from a `.env` file (if present) and sets any that
 * are not already defined in `process.env`. A missing file is a no-op, so
 * exporting the variable directly in the shell still works.
 */
export function loadEnv(path = '.env'): void {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return; // no .env file — nothing to load
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
