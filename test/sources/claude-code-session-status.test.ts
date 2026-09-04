/**
 * The per-PROCESS status file, `~/.claude/sessions/<pid>.json`.
 *
 * A row is a process, not a session, and two processes that resumed one
 * session share a transcript -- so the transcript's mtime cannot tell them
 * apart. This file can: `statusUpdatedAt` is written per pid.
 *
 * Every fixture here is an invented pid under a fresh `mkdtemp` directory; the
 * operator's real `~/.claude/sessions` is never read by these tests, and no
 * home path is written into a fixture.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultSessionsRoot,
  parseStatusUpdatedAt,
  readStatusUpdatedAt,
} from '../../src/main/sources/claude-code/session-status.js';

const statusFile = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    pid: 4242,
    sessionId: 'sess-1',
    cwd: '/w/alpha',
    startedAt: 1_700_000_000_000,
    kind: 'interactive',
    status: 'idle',
    updatedAt: 1_700_000_500_000,
    statusUpdatedAt: 1_700_000_400_000,
    ...over,
  });

describe('parseStatusUpdatedAt', () => {
  it('takes statusUpdatedAt from a well-formed file', () => {
    expect(parseStatusUpdatedAt(statusFile())).toBe(1_700_000_400_000);
  });

  it('returns null for malformed JSON rather than throwing', () => {
    expect(parseStatusUpdatedAt('{ not json')).toBeNull();
  });

  it('returns null when statusUpdatedAt is absent, so the caller can fall back', () => {
    expect(parseStatusUpdatedAt(statusFile({ statusUpdatedAt: undefined }))).toBeNull();
  });

  it.each([['a string'], [null], [Number.NaN]])(
    'returns null for a non-numeric statusUpdatedAt (%p)',
    (value) => {
      expect(parseStatusUpdatedAt(statusFile({ statusUpdatedAt: value }))).toBeNull();
    },
  );

  it('returns null for a document that is not an object', () => {
    expect(parseStatusUpdatedAt('[1, 2, 3]')).toBeNull();
  });
});

describe('readStatusUpdatedAt', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-cc-sessions-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the file named for the pid', async () => {
    writeFileSync(join(root, '4242.json'), statusFile());
    await expect(readStatusUpdatedAt(root, 4242)).resolves.toBe(1_700_000_400_000);
  });

  it('returns null for a missing file, and for a missing directory', async () => {
    await expect(readStatusUpdatedAt(root, 4242)).resolves.toBeNull();
    await expect(readStatusUpdatedAt(join(root, 'absent'), 4242)).resolves.toBeNull();
  });

  it('returns null for unparseable contents rather than throwing', async () => {
    writeFileSync(join(root, '4242.json'), 'not json at all');
    await expect(readStatusUpdatedAt(root, 4242)).resolves.toBeNull();
  });

  it('never reads a <pid>.<hash>.key sibling as JSON', async () => {
    // The directory holds key files next to the status files. They are not
    // JSON, and reading one for a pid whose status file is absent would be a
    // parse error where the answer is simply "nothing recorded".
    writeFileSync(join(root, '4242.abc123.key'), 'not-json-secret-material');
    await expect(readStatusUpdatedAt(root, 4242)).resolves.toBeNull();
  });
});

describe('defaultSessionsRoot', () => {
  it('is derived from the home directory, never a literal path', () => {
    expect(defaultSessionsRoot()).toBe(join(homedir(), '.claude', 'sessions'));
  });
});
