/**
 * Finds Codex's own usage on disk: the newest `token_count` event's
 * `rate_limits`, off the most recently written
 * `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
 *
 * SAME READER DISCIPLINE AS `sources/codex/rollout.ts`, reused rather than
 * re-derived: a bounded tail (`TAIL_WINDOW_BYTES`, widened up to
 * `MAX_TAIL_READ_BYTES`), read backwards, with a line that will not parse
 * skipped rather than failing the read (`parseRolloutLines`). What is new
 * here is WHICH line the scan is looking for (`token_count`'s `rate_limits`
 * rather than a turn's `UserMessage`/`AgentMessage`) and WHICH FILE it starts
 * from: a session's transcript is one known rollout, chosen by its sqlite row
 * elsewhere in this tree; a usage reading has no session to start from, so
 * this module finds the rollout ITSELF, by walking the date-partitioned
 * directory newest-first.
 *
 * `MAX_FILES_SCANNED` bounds how many rollouts a single popover-open pays
 * for: the newest file usually carries a `token_count` event (Codex emits one
 * on every turn), so the common case is one file and one tail read; the cap
 * only matters for an operator whose most recent thread never got far enough
 * to be token-counted.
 */

import { readdir as fsReaddir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { type CodexUsageSnapshot, parseCodexRateLimits } from '../../shared/codex-usage.js';
import type { TranscriptSource } from '../sources/claude-code/window.js';
import { fileTranscriptSource } from '../sources/claude-code/window.js';
import {
  MAX_TAIL_READ_BYTES,
  parseRolloutLines,
  TAIL_WINDOW_BYTES,
} from '../sources/codex/rollout.js';
import { codexHome } from '../sources/codex/store.js';

export type CodexUsageReaderDeps = {
  readonly sessionsDir: string;
  /** Directory entry NAMES, never full paths -- empty on anything this
   *  cannot read (ENOENT included), never a throw: an operator with no
   *  `~/.codex` yet is the ordinary case, not a failure this module reports. */
  readonly readdir: (path: string) => Promise<readonly string[]>;
  readonly source: (path: string) => TranscriptSource;
  /** `null` on anything this cannot stat -- the fallback observed time when
   *  the matched line itself carries none. */
  readonly mtime: (path: string) => Promise<Date | null>;
};

export const DEFAULT_CODEX_USAGE_DEPS: CodexUsageReaderDeps = {
  sessionsDir: join(codexHome(), 'sessions'),
  readdir: async (path) => {
    try {
      return await fsReaddir(path);
    } catch {
      return [];
    }
  },
  source: fileTranscriptSource,
  mtime: async (path) => {
    try {
      return (await stat(path)).mtime;
    } catch {
      return null;
    }
  },
};

/** How many of the newest rollouts this reader will open looking for a
 *  reading, once the newest one turns out to carry none. */
const MAX_FILES_SCANNED = 5;

const NUMERIC = /^\d+$/;

/**
 * Every rollout path under `sessionsDir`, newest directory and newest
 * filename first -- `YYYY`, `MM`, `DD` sort correctly as strings because
 * they are zero-padded, and Codex's own `rollout-<iso-with-hyphens>-<uuid>`
 * filenames sort the same way for the same reason. Stops as soon as `limit`
 * paths are collected, so an operator with years of history never pays for
 * more than the newest handful of directories.
 */
async function newestRolloutPaths(
  deps: CodexUsageReaderDeps,
  limit: number,
): Promise<readonly string[]> {
  const paths: string[] = [];
  const years = [...(await deps.readdir(deps.sessionsDir))]
    .filter((n) => NUMERIC.test(n))
    .sort()
    .reverse();
  for (const year of years) {
    const yearDir = join(deps.sessionsDir, year);
    const months = [...(await deps.readdir(yearDir))]
      .filter((n) => NUMERIC.test(n))
      .sort()
      .reverse();
    for (const month of months) {
      const monthDir = join(yearDir, month);
      const days = [...(await deps.readdir(monthDir))]
        .filter((n) => NUMERIC.test(n))
        .sort()
        .reverse();
      for (const day of days) {
        const dayDir = join(monthDir, day);
        const files = [...(await deps.readdir(dayDir))]
          .filter((name) => name.startsWith('rollout-') && name.endsWith('.jsonl'))
          .sort()
          .reverse();
        for (const name of files) {
          paths.push(join(dayDir, name));
          if (paths.length >= limit) return paths;
        }
      }
    }
  }
  return paths;
}

type Line = Record<string, unknown>;

/** `rate_limits` off a `token_count` event, in either shape this reader has
 *  reason to expect: flat on the line itself, or nested under `payload` the
 *  way `rollout.ts`'s `item_completed` lines are -- the endpoint's exact
 *  envelope is not confirmed beyond the brief's own quoted fragment, so both
 *  are read rather than one guessed. */
function rateLimitsOf(line: Line): unknown {
  if (line.rate_limits !== undefined) return line.rate_limits;
  const payload = line.payload;
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const rec = payload as Record<string, unknown>;
    if (rec.rate_limits !== undefined) return rec.rate_limits;
  }
  return undefined;
}

function timestampOf(line: Line): string | null {
  const value = line.timestamp;
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * One file's newest `token_count` reading, or `null` when this file carries
 * none at all within its allowed budget -- the same widening loop
 * `readRolloutTail` uses, stopped the moment a match is found rather than run
 * to a turn boundary, since a usage reading has no "whole turn" to complete.
 */
async function newestRateLimitsIn(
  source: TranscriptSource,
): Promise<{ readonly rateLimits: unknown; readonly timestamp: string | null } | null> {
  const size = await source.size();
  let boundary = size;
  let spent = 0;
  for (;;) {
    const from = Math.max(0, boundary - TAIL_WINDOW_BYTES);
    const window = await source.read(from, boundary);
    spent += boundary - from;
    if (window.text !== '') {
      const lines = parseRolloutLines(window.text);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const rateLimits = rateLimitsOf(lines[i] as Line);
        if (rateLimits !== undefined) {
          return { rateLimits, timestamp: timestampOf(lines[i] as Line) };
        }
      }
    }
    if (from === 0) break;
    boundary = window.text === '' ? from : window.start;
    if (spent + TAIL_WINDOW_BYTES > MAX_TAIL_READ_BYTES) break;
  }
  return null;
}

/**
 * Codex's usage snapshot: the newest `rate_limits` reading this reader can
 * find, or the specific reason it cannot -- `'no-session'` when there is
 * simply nothing to read yet (no `~/.codex/sessions`, or every scanned
 * rollout carries no `token_count` event), `'unavailable'` when the attempt
 * itself failed (a directory that exists but cannot be listed). Never throws.
 */
export async function readCodexUsage(
  deps: CodexUsageReaderDeps = DEFAULT_CODEX_USAGE_DEPS,
): Promise<CodexUsageSnapshot> {
  let paths: readonly string[];
  try {
    paths = await newestRolloutPaths(deps, MAX_FILES_SCANNED);
  } catch {
    return { kind: 'unknown', reason: 'unavailable' };
  }
  if (paths.length === 0) {
    return { kind: 'unknown', reason: 'no-session' };
  }
  for (const path of paths) {
    try {
      const found = await newestRateLimitsIn(deps.source(path));
      if (found === null) continue;
      const limits = parseCodexRateLimits(found.rateLimits);
      const observedAt =
        found.timestamp ?? (await deps.mtime(path))?.toISOString() ?? new Date().toISOString();
      return { kind: 'ok', limits, observedAt };
    } catch {
      // This file could not be read; the next-older candidate might be.
    }
  }
  return { kind: 'unknown', reason: 'no-session' };
}
