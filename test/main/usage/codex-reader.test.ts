/**
 * `readCodexUsage`: finds the newest `~/.codex/sessions/YYYY/MM/DD/rollout-
 * *.jsonl`, tails it (the `claude-code/tail.ts` discipline `rollout.ts`
 * already applies — bounded, backwards, a line that will not parse skipped),
 * and reads the last `token_count` event's `rate_limits` off it. Every
 * filesystem touch is injected, so none of this ever reads the operator's
 * real `~/.codex`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { TranscriptSource } from '../../../src/main/sources/claude-code/window.js';
import {
  type CodexUsageReaderDeps,
  DEFAULT_CODEX_USAGE_DEPS,
  readCodexUsage,
} from '../../../src/main/usage/codex-reader.js';

/** The real shape, verified live on this machine (task brief). */
const REAL_RATE_LIMITS = {
  limit_id: 'codex',
  primary: { used_percent: 11.0, window_minutes: 300, resets_at: 1_790_000_000 },
  secondary: { used_percent: 2.0, window_minutes: 10080, resets_at: 1_790_500_000 },
  credits: { balance: 100 },
};

/** One JSONL line, as `event_msg`/`token_count` — the same envelope
 *  `rollout.ts` reads `item_completed` off. */
function tokenCountLine(rateLimits: unknown, timestamp?: string): string {
  return JSON.stringify({
    timestamp: timestamp ?? '2026-09-24T09:12:00.000Z',
    type: 'event_msg',
    payload: { type: 'token_count', rate_limits: rateLimits },
  });
}

/** A fake tree: `dirs` maps a directory path to its entry names, `files` maps
 *  a rollout file's path to its whole text. Sizes and reads are served out of
 *  `files` directly — small enough in every test here that one whole-file
 *  read already IS the tail window, so `stride`/`budget` never has to matter
 *  for the fixture to be exercised; the widening loop itself is `rollout.ts`'s
 *  own tested code, reused rather than re-proven. */
function fakeDeps(
  dirs: Record<string, readonly string[]>,
  files: Record<string, string>,
  mtimes: Record<string, Date> = {},
): CodexUsageReaderDeps {
  return {
    sessionsDir: '/home/.codex/sessions',
    readdir: async (path) => dirs[path] ?? [],
    source: (path): TranscriptSource => ({
      size: async () => Buffer.byteLength(files[path] ?? '', 'utf8'),
      read: async (from, to) => {
        const text = files[path] ?? '';
        const buf = Buffer.from(text, 'utf8');
        const slice = buf.subarray(from, to).toString('utf8');
        return { text: slice, start: from };
      },
    }),
    mtime: async (path) => mtimes[path] ?? null,
  };
}

describe('readCodexUsage', () => {
  it('reads the newest rollout under YYYY/MM/DD, and the event’s own timestamp as observedAt', async () => {
    const path = '/home/.codex/sessions/2026/09/24/rollout-2026-09-24T09-00-00-abc.jsonl';
    const deps = fakeDeps(
      {
        '/home/.codex/sessions': ['2026'],
        '/home/.codex/sessions/2026': ['09'],
        '/home/.codex/sessions/2026/09': ['24'],
        '/home/.codex/sessions/2026/09/24': ['rollout-2026-09-24T09-00-00-abc.jsonl'],
      },
      { [path]: `${tokenCountLine(REAL_RATE_LIMITS, '2026-09-24T09:12:00.000Z')}\n` },
    );

    const snapshot = await readCodexUsage(deps);

    expect(snapshot.kind).toBe('ok');
    if (snapshot.kind !== 'ok') throw new Error('unreachable');
    expect(snapshot.limits.primary).toMatchObject({ kind: 'known', percent: 11 });
    expect(snapshot.limits.secondary).toMatchObject({ kind: 'known', percent: 2 });
    expect(snapshot.observedAt).toBe('2026-09-24T09:12:00.000Z');
  });

  it('picks the LAST token_count line in the file, not an earlier one', async () => {
    const path = '/home/.codex/sessions/2026/09/24/rollout-a.jsonl';
    const older = { primary: { used_percent: 5, window_minutes: 300, resets_at: 1 } };
    const newer = { primary: { used_percent: 90, window_minutes: 300, resets_at: 2 } };
    const deps = fakeDeps(
      {
        '/home/.codex/sessions': ['2026'],
        '/home/.codex/sessions/2026': ['09'],
        '/home/.codex/sessions/2026/09': ['24'],
        '/home/.codex/sessions/2026/09/24': ['rollout-a.jsonl'],
      },
      {
        [path]: [
          tokenCountLine(older, '2026-09-24T08:00:00.000Z'),
          tokenCountLine(newer, '2026-09-24T09:00:00.000Z'),
        ].join('\n'),
      },
    );

    const snapshot = await readCodexUsage(deps);
    if (snapshot.kind !== 'ok') throw new Error('unreachable');
    expect(snapshot.limits.primary).toMatchObject({ percent: 90 });
    expect(snapshot.observedAt).toBe('2026-09-24T09:00:00.000Z');
  });

  it('skips an unparseable line rather than failing the whole read', async () => {
    const path = '/home/.codex/sessions/2026/09/24/rollout-a.jsonl';
    const deps = fakeDeps(
      {
        '/home/.codex/sessions': ['2026'],
        '/home/.codex/sessions/2026': ['09'],
        '/home/.codex/sessions/2026/09': ['24'],
        '/home/.codex/sessions/2026/09/24': ['rollout-a.jsonl'],
      },
      { [path]: `not-json-at-all{{{\n${tokenCountLine(REAL_RATE_LIMITS)}\n` },
    );

    const snapshot = await readCodexUsage(deps);
    expect(snapshot.kind).toBe('ok');
  });

  it('falls back to the next-older rollout when the newest carries no token_count event', async () => {
    const newestPath = '/home/.codex/sessions/2026/09/24/rollout-b-newer.jsonl';
    const olderPath = '/home/.codex/sessions/2026/09/24/rollout-a-older.jsonl';
    const deps = fakeDeps(
      {
        '/home/.codex/sessions': ['2026'],
        '/home/.codex/sessions/2026': ['09'],
        '/home/.codex/sessions/2026/09': ['24'],
        '/home/.codex/sessions/2026/09/24': ['rollout-a-older.jsonl', 'rollout-b-newer.jsonl'],
      },
      {
        [newestPath]: `${JSON.stringify({ timestamp: 't', type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [] }, turn_id: '1' } })}\n`,
        [olderPath]: `${tokenCountLine(REAL_RATE_LIMITS, '2026-09-24T07:00:00.000Z')}\n`,
      },
    );

    const snapshot = await readCodexUsage(deps);
    expect(snapshot.kind).toBe('ok');
    if (snapshot.kind !== 'ok') throw new Error('unreachable');
    expect(snapshot.observedAt).toBe('2026-09-24T07:00:00.000Z');
  });

  it('falls back to the file’s mtime when the matched line carries no timestamp', async () => {
    const path = '/home/.codex/sessions/2026/09/24/rollout-a.jsonl';
    const mtime = new Date('2026-09-24T06:30:00.000Z');
    const deps = fakeDeps(
      {
        '/home/.codex/sessions': ['2026'],
        '/home/.codex/sessions/2026': ['09'],
        '/home/.codex/sessions/2026/09': ['24'],
        '/home/.codex/sessions/2026/09/24': ['rollout-a.jsonl'],
      },
      {
        [path]: `${JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: REAL_RATE_LIMITS } })}\n`,
      },
      { [path]: mtime },
    );

    const snapshot = await readCodexUsage(deps);
    if (snapshot.kind !== 'ok') throw new Error('unreachable');
    expect(snapshot.observedAt).toBe(mtime.toISOString());
  });

  it('answers no-session, not unavailable, when the sessions directory has nothing in it', async () => {
    const deps = fakeDeps({ '/home/.codex/sessions': [] }, {});
    const snapshot = await readCodexUsage(deps);
    expect(snapshot).toEqual({ kind: 'unknown', reason: 'no-session' });
  });

  it('answers unavailable, not no-session, when listing the tree throws', async () => {
    const deps: CodexUsageReaderDeps = {
      sessionsDir: '/home/.codex/sessions',
      readdir: vi.fn(async () => {
        throw new Error('EACCES');
      }),
      source: () => {
        throw new Error('unreachable');
      },
      mtime: async () => null,
    };
    const snapshot = await readCodexUsage(deps);
    expect(snapshot).toEqual({ kind: 'unknown', reason: 'unavailable' });
  });

  it('answers no-session when every candidate file carries no token_count event at all', async () => {
    const path = '/home/.codex/sessions/2026/09/24/rollout-a.jsonl';
    const deps = fakeDeps(
      {
        '/home/.codex/sessions': ['2026'],
        '/home/.codex/sessions/2026': ['09'],
        '/home/.codex/sessions/2026/09': ['24'],
        '/home/.codex/sessions/2026/09/24': ['rollout-a.jsonl'],
      },
      { [path]: `${JSON.stringify({ type: 'event_msg', payload: { type: 'other' } })}\n` },
    );

    const snapshot = await readCodexUsage(deps);
    expect(snapshot).toEqual({ kind: 'unknown', reason: 'no-session' });
  });
});

describe('DEFAULT_CODEX_USAGE_DEPS', () => {
  it('points at CODEX_HOME’s sessions directory', () => {
    expect(DEFAULT_CODEX_USAGE_DEPS.sessionsDir.endsWith('.codex/sessions')).toBe(true);
  });
});
