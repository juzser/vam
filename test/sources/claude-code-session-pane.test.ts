/**
 * The pane a Claude Code session PUBLISHES about itself.
 *
 * A session running under tmux writes its own pane into
 * `~/.claude/sessions/<pid>.json` as `tmux: '<session>:@<window>.%<pane>'`,
 * keyed by `sessionId`. That is the per-session pairing vam never had.
 *
 * Every fixture here is invented -- invented pids, invented session ids,
 * invented tmux names, under a fresh `mkdtemp` directory. The operator's real
 * `~/.claude/sessions` is never enumerated by these tests, and no home path,
 * username or real session id is written into a fixture.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parsePublishedPane,
  readPublishedPanes,
  readPublishedPanesAndProcessFacts,
} from '../../src/main/sources/claude-code/session-pane.js';

// The module namespace of a Node builtin is not configurable in ESM, so a
// direct `vi.spyOn(fsPromises, 'readFile')` throws -- `vi.mock` with a
// pass-through wrapper is the only way to count real calls without changing
// what they return.
const readFileCalls = vi.hoisted(() => [] as string[]);
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: (path: unknown, ...rest: unknown[]) => {
      readFileCalls.push(String(path));
      return (actual.readFile as (...args: unknown[]) => unknown)(path, ...rest);
    },
  };
});

const sessionFile = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    pid: 4242,
    sessionId: 'sess-alpha',
    cwd: '/w/alpha',
    kind: 'interactive',
    status: 'idle',
    tmux: 'vam-alpha-aa11bb:@0.%0',
    ...over,
  });

describe('parsePublishedPane', () => {
  it('reads the session id and the tmux SESSION out of a published pane', () => {
    expect(parsePublishedPane(sessionFile())).toEqual({
      sessionId: 'sess-alpha',
      tmuxSession: 'vam-alpha-aa11bb',
    });
  });

  it('accepts a bare session name, with no window or pane after it', () => {
    expect(parsePublishedPane(sessionFile({ tmux: 'vam-alpha-aa11bb' }))?.tmuxSession).toBe(
      'vam-alpha-aa11bb',
    );
  });

  it('returns null when there is no tmux field -- the session is not under tmux', () => {
    expect(parsePublishedPane(sessionFile({ tmux: undefined }))).toBeNull();
  });

  it.each([[''], [':@0.%0'], ['   '], [42], [null], [{ session: 'x' }]])(
    'returns null for an unusable tmux value (%p)',
    (value) => {
      expect(parsePublishedPane(sessionFile({ tmux: value }))).toBeNull();
    },
  );

  it('returns null when the session id is missing or not a string', () => {
    expect(parsePublishedPane(sessionFile({ sessionId: undefined }))).toBeNull();
    expect(parsePublishedPane(sessionFile({ sessionId: 7 }))).toBeNull();
  });

  it('returns null for malformed JSON rather than throwing', () => {
    expect(parsePublishedPane('{ not json')).toBeNull();
  });

  it('returns null for a document that is not an object', () => {
    expect(parsePublishedPane('[1, 2, 3]')).toBeNull();
  });
});

describe('readPublishedPanes', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-cc-panes-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('maps every row (session id and pid) in the directory to its own tmux session', async () => {
    writeFileSync(join(root, '4242.json'), sessionFile());
    writeFileSync(
      join(root, '4243.json'),
      sessionFile({ pid: 4243, sessionId: 'sess-beta', tmux: 'vam-alpha-cc22dd:@0.%0' }),
    );
    const panes = await readPublishedPanes(root);
    expect(panes.get('sess-alpha#4242')).toBe('vam-alpha-aa11bb');
    // Two sessions in ONE project, each pointing at its own pane. This is the
    // case the project-tag pairing collapses into `ambiguous`.
    expect(panes.get('sess-beta#4243')).toBe('vam-alpha-cc22dd');
  });

  it('skips a session with no tmux field instead of recording an empty pane', async () => {
    writeFileSync(join(root, '4242.json'), sessionFile({ tmux: undefined }));
    await expect(readPublishedPanes(root)).resolves.toEqual(new Map());
  });

  it('never opens a <pid>.<hash>.key sibling', async () => {
    // A key file holds secret material. Enumerating this directory must not
    // read one, so only `.json` names are opened at all.
    writeFileSync(join(root, '4242.abc123.key'), 'not-json-secret-material');
    writeFileSync(join(root, '4242.json'), sessionFile());
    await expect(readPublishedPanes(root)).resolves.toEqual(
      new Map([['sess-alpha#4242', 'vam-alpha-aa11bb']]),
    );
  });

  it('ignores a malformed file and keeps the rest of the directory', async () => {
    writeFileSync(join(root, '4242.json'), 'not json at all');
    writeFileSync(join(root, '4243.json'), sessionFile({ pid: 4243, sessionId: 'sess-beta' }));
    await expect(readPublishedPanes(root)).resolves.toEqual(
      new Map([['sess-beta#4243', 'vam-alpha-aa11bb']]),
    );
  });

  it('is an empty map for a directory that is not there, never a throw', async () => {
    await expect(readPublishedPanes(join(root, 'absent'))).resolves.toEqual(new Map());
  });

  it('keys by the PROCESS, not the session id, when two pids resume one session', async () => {
    // Measured on a real machine (`agents.ts`): two processes can resume the
    // same Claude Code session, each with its own pid and its own pane. A map
    // keyed by `sessionId` alone can hold only one of them -- whichever
    // `readdir` returns last -- and silently drops the other's claim.
    writeFileSync(
      join(root, '100.json'),
      sessionFile({ pid: 100, sessionId: 'sess-shared', tmux: 'vam-alpha-aa11bb:@0.%0' }),
    );
    writeFileSync(
      join(root, '200.json'),
      sessionFile({ pid: 200, sessionId: 'sess-shared', tmux: 'vam-beta-cc22dd:@0.%0' }),
    );
    const panes = await readPublishedPanes(root);
    // Both claims must survive, addressable by the process that made them.
    expect(panes.get('sess-shared#100')).toBe('vam-alpha-aa11bb');
    expect(panes.get('sess-shared#200')).toBe('vam-beta-cc22dd');
    expect(panes.size).toBe(2);
  });
});

/**
 * `load()` used to call `readPublishedPanes` for the pairing above and then
 * `readProcessFacts` again, per agent, against the SAME `<pid>.json` file --
 * at 200 sessions, 200 redundant reads out of roughly 1000 total in one
 * `load()`. This is what closes that gap: one read per row, both facts out
 * of it.
 */
describe('readPublishedPanesAndProcessFacts', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-cc-panes-facts-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads each row exactly once, for both the pairing and the status', async () => {
    writeFileSync(
      join(root, '4242.json'),
      sessionFile({ statusUpdatedAt: 1_700_000_400_000, status: 'waiting', waitingFor: 'input' }),
    );
    writeFileSync(
      join(root, '4243.json'),
      sessionFile({ pid: 4243, sessionId: 'sess-beta', tmux: 'vam-alpha-cc22dd:@0.%0' }),
    );
    readFileCalls.length = 0;
    const { panes, facts } = await readPublishedPanesAndProcessFacts(root);
    // Both facts, out of the pairing's own directory scan.
    expect(panes.get('sess-alpha#4242')).toBe('vam-alpha-aa11bb');
    expect(facts.get(4242)).toEqual({ statusUpdatedAt: 1_700_000_400_000, waitingFor: 'input' });
    expect(facts.get(4243)?.statusUpdatedAt).toBeNull();
    // ONE call per row -- never two for the same pid, whatever the caller
    // ends up wanting out of it.
    expect(readFileCalls.filter((name) => name.endsWith('4242.json'))).toHaveLength(1);
    expect(readFileCalls.filter((name) => name.endsWith('4243.json'))).toHaveLength(1);
  });

  it('resolves each PID to its own facts and its own pane, not the other pid sharing its sessionId', async () => {
    // Measured on a real machine (`agents.ts`): two processes can resume the
    // same Claude Code session, each with its own pid, its own pane and its
    // own status file. Keying either map by `sessionId` instead of pid would
    // let the second file's read silently overwrite the first's -- the exact
    // collapse that once made vam address the wrong tmux session while
    // reporting success.
    writeFileSync(
      join(root, '100.json'),
      sessionFile({
        pid: 100,
        sessionId: 'sess-shared',
        tmux: 'vam-alpha-aa11bb:@0.%0',
        status: 'waiting',
        statusUpdatedAt: 1_700_000_100_000,
        waitingFor: 'permission prompt',
      }),
    );
    writeFileSync(
      join(root, '200.json'),
      sessionFile({
        pid: 200,
        sessionId: 'sess-shared',
        tmux: 'vam-beta-cc22dd:@0.%0',
        status: 'idle',
        statusUpdatedAt: 1_700_000_200_000,
      }),
    );
    const { panes, facts } = await readPublishedPanesAndProcessFacts(root);
    // The pane claim: both survive, addressable by the process that made
    // them -- one sessionId, two rows, two different tmux panes.
    expect(panes.get('sess-shared#100')).toBe('vam-alpha-aa11bb');
    expect(panes.get('sess-shared#200')).toBe('vam-beta-cc22dd');
    expect(panes.size).toBe(2);
    // The facts: each pid's own file, not one overwriting the other's.
    expect(facts.get(100)).toEqual({
      statusUpdatedAt: 1_700_000_100_000,
      waitingFor: 'permission prompt',
    });
    expect(facts.get(200)).toEqual({ statusUpdatedAt: 1_700_000_200_000 });
    expect(facts.size).toBe(2);
  });
});
