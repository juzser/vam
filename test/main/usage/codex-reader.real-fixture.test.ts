/**
 * `readCodexUsage` against a REAL fixture directory on disk, through
 * `DEFAULT_CODEX_USAGE_DEPS`'s own `readdir`/`source`/`mtime` -- the real
 * `node:fs/promises` calls and the real `fileTranscriptSource` tail reader,
 * never the in-memory `fakeDeps` the rest of `codex-reader.test.ts` uses.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE FAKED-DEPS SUITE: #531's own
 * screenshots were produced against a FAKED `window.api.usage` bridge in the
 * browser harness, so the real reading path -- real directory walk, real
 * bounded-tail file read, real `rate_limits` shape off a real rollout file --
 * was never exercised end to end before it shipped. The in-memory fixtures
 * above already prove the SELECTION logic (which event wins); this file
 * proves the FILESYSTEM plumbing around it does not silently diverge from
 * that logic again. `sessionsDir` is the only thing overridden -- the same
 * seam `codexHome()`'s own `CODEX_HOME` override gives production -- every
 * other function here is `DEFAULT_CODEX_USAGE_DEPS`'s real implementation.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CODEX_USAGE_DEPS, readCodexUsage } from '../../../src/main/usage/codex-reader.js';

/** One `event_msg`/`token_count` line, the real envelope Codex writes,
 *  `rate_limits` nested under `payload` -- the shape verified live on this
 *  machine, sanitised (fake numbers, no ids). */
function tokenCountLine(rateLimits: unknown, timestamp: string): string {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: 0,
        },
        last_token_usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: 0,
        },
        model_context_window: 0,
      },
      rate_limits: rateLimits,
    },
  });
}

/** The REAL shape a brand-new Codex thread's first reading carries, measured
 *  live on this machine (task brief §3): `primary`/`secondary` present as
 *  literal `null` rather than absent or malformed. */
const PLACEHOLDER_RATE_LIMITS = {
  limit_id: 'codex',
  limit_name: null,
  primary: null,
  secondary: null,
  credits: { has_credits: false, unlimited: false, balance: '0' },
  individual_limit: null,
  spend_control_reached: null,
  plan_type: 'plus',
  rate_limit_reached_type: null,
};

const GOOD_RATE_LIMITS = {
  limit_id: 'codex',
  limit_name: null,
  primary: { used_percent: 17, window_minutes: 300, resets_at: 1_790_000_000 },
  secondary: { used_percent: 3, window_minutes: 10_080, resets_at: 1_790_500_000 },
  credits: { has_credits: false, unlimited: false, balance: '0' },
  individual_limit: null,
  spend_control_reached: null,
  plan_type: 'plus',
  rate_limit_reached_type: null,
};

describe('readCodexUsage, wired to a real ~/.codex-shaped fixture directory (no faked bridge)', () => {
  let fixtureHome: string;

  beforeEach(() => {
    fixtureHome = mkdtempSync(join(tmpdir(), 'vam-codex-fixture-'));
  });

  afterEach(() => {
    rmSync(fixtureHome, { recursive: true, force: true });
  });

  it('reads a real rollout file on disk and finds the known window', async () => {
    const dayDir = join(fixtureHome, 'sessions', '2026', '09', '28');
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(
      join(dayDir, 'rollout-2026-09-28T09-05-00-fixture-a.jsonl'),
      `${tokenCountLine(GOOD_RATE_LIMITS, '2026-09-28T09:05:30.000Z')}\n`,
    );

    const deps = { ...DEFAULT_CODEX_USAGE_DEPS, sessionsDir: join(fixtureHome, 'sessions') };
    const snapshot = await readCodexUsage(deps);

    expect(snapshot.kind).toBe('ok');
    if (snapshot.kind !== 'ok') throw new Error('unreachable');
    expect(snapshot.limits.primary).toMatchObject({ kind: 'known', percent: 17 });
    expect(snapshot.limits.secondary).toMatchObject({ kind: 'known', percent: 3 });
  });

  /**
   * THE OPERATOR'S BUG, end to end: the real directory walk finds the real
   * newest file, the real bounded-tail reader reads it backwards, and the
   * newest `token_count` line in it is the null-window placeholder -- with
   * a real, usable reading one line above it in the SAME real file. Nothing
   * here is a fake; only `sessionsDir` points somewhere other than the
   * operator's own `~/.codex`.
   */
  it('skips a real placeholder event (rate_limits present, both windows null) and falls back to the real reading above it', async () => {
    const dayDir = join(fixtureHome, 'sessions', '2026', '09', '28');
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(
      join(dayDir, 'rollout-2026-09-28T09-19-44-fixture-fresh-thread.jsonl'),
      [
        tokenCountLine(GOOD_RATE_LIMITS, '2026-09-28T09:19:50.000Z'),
        // The newest line -- a brand-new thread's first token_count event,
        // exactly as read off this machine's real ~/.codex/sessions.
        tokenCountLine(PLACEHOLDER_RATE_LIMITS, '2026-09-28T09:19:56.000Z'),
      ].join('\n'),
    );

    const deps = { ...DEFAULT_CODEX_USAGE_DEPS, sessionsDir: join(fixtureHome, 'sessions') };
    const snapshot = await readCodexUsage(deps);

    expect(snapshot.kind).toBe('ok');
    if (snapshot.kind !== 'ok') throw new Error('unreachable');
    expect(snapshot.limits.primary).toMatchObject({ kind: 'known', percent: 17 });
    expect(snapshot.limits.secondary).toMatchObject({ kind: 'known', percent: 3 });
    expect(snapshot.observedAt).toBe('2026-09-28T09:19:50.000Z');
  });

  it('answers no-session against an empty real sessions directory', async () => {
    mkdirSync(join(fixtureHome, 'sessions'), { recursive: true });
    const deps = { ...DEFAULT_CODEX_USAGE_DEPS, sessionsDir: join(fixtureHome, 'sessions') };
    const snapshot = await readCodexUsage(deps);
    expect(snapshot).toEqual({ kind: 'unknown', reason: 'no-session' });
  });
});
