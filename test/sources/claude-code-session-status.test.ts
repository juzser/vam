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
  parseProcessFacts,
  readProcessFacts,
} from '../../src/main/sources/claude-code/session-status.js';

/** The one fact these older cases are about; the file now reports two. */
const parseStatusUpdatedAt = (text: string) => parseProcessFacts(text).statusUpdatedAt;
const readStatusUpdatedAt = async (root: string, pid: number) =>
  (await readProcessFacts(root, pid)).statusUpdatedAt;

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

/**
 * THE SECOND FACT IN THE SAME FILE. One of the operator's live sessions reads
 * `status: "waiting"`, `waitingFor: "permission prompt"` -- a surface outside
 * the transcript that names a pending human decision, which nothing in vam
 * read. A session blocked on a tool approval writes no transcript record at
 * all, so this file is the ONLY place vam can learn that it is stuck.
 */
describe('the waiting state', () => {
  it('reports what a waiting process says it is waiting on', () => {
    const facts = parseProcessFacts(statusFile({ status: 'waiting', waitingFor: 'input needed' }));
    expect(facts.waitingFor).toBe('input needed');
  });

  it('carries a value it has never seen through rather than dropping it', () => {
    // Two values were observed on one machine. That is a sample, not the set:
    // an unknown one means the session is still waiting, and the operator is
    // better served by the CLI's own word than by silence.
    const facts = parseProcessFacts(
      statusFile({ status: 'waiting', waitingFor: 'plan approval' }),
    );
    expect(facts.waitingFor).toBe('plan approval');
  });

  it('is present-but-null when the process is waiting and does not say why', () => {
    for (const over of [{}, { waitingFor: '-' }, { waitingFor: '  ' }, { waitingFor: 7 }]) {
      const facts = parseProcessFacts(statusFile({ status: 'waiting', ...over }));
      expect('waitingFor' in facts).toBe(true);
      expect(facts.waitingFor).toBeNull();
    }
  });

  it('is ABSENT for a process that is not waiting, whatever waitingFor holds', () => {
    // `-` is what an idle session writes there, and it is not a cause.
    for (const status of ['idle', 'running', undefined]) {
      const facts = parseProcessFacts(statusFile({ status, waitingFor: 'permission prompt' }));
      expect('waitingFor' in facts).toBe(false);
    }
  });

  it('is absent for a file vam could not parse at all', () => {
    expect('waitingFor' in parseProcessFacts('{ not json')).toBe(false);
  });

  it('reaches the caller through the reader, for the pid it names', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vam-cc-waiting-'));
    try {
      writeFileSync(
        join(root, '4242.json'),
        statusFile({ status: 'waiting', waitingFor: 'permission prompt' }),
      );
      await expect(readProcessFacts(root, 4242)).resolves.toEqual({
        statusUpdatedAt: 1_700_000_400_000,
        waitingFor: 'permission prompt',
      });
      await expect(readProcessFacts(root, 9999)).resolves.toEqual({ statusUpdatedAt: null });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
