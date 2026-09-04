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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parsePublishedPane,
  readPublishedPanes,
} from '../../src/main/sources/claude-code/session-pane.js';

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

  it('maps every session id in the directory to its own tmux session', async () => {
    writeFileSync(join(root, '4242.json'), sessionFile());
    writeFileSync(
      join(root, '4243.json'),
      sessionFile({ pid: 4243, sessionId: 'sess-beta', tmux: 'vam-alpha-cc22dd:@0.%0' }),
    );
    const panes = await readPublishedPanes(root);
    expect(panes.get('sess-alpha')).toBe('vam-alpha-aa11bb');
    // Two sessions in ONE project, each pointing at its own pane. This is the
    // case the project-tag pairing collapses into `ambiguous`.
    expect(panes.get('sess-beta')).toBe('vam-alpha-cc22dd');
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
      new Map([['sess-alpha', 'vam-alpha-aa11bb']]),
    );
  });

  it('ignores a malformed file and keeps the rest of the directory', async () => {
    writeFileSync(join(root, '4242.json'), 'not json at all');
    writeFileSync(join(root, '4243.json'), sessionFile({ pid: 4243, sessionId: 'sess-beta' }));
    await expect(readPublishedPanes(root)).resolves.toEqual(
      new Map([['sess-beta', 'vam-alpha-aa11bb']]),
    );
  });

  it('is an empty map for a directory that is not there, never a throw', async () => {
    await expect(readPublishedPanes(join(root, 'absent'))).resolves.toEqual(new Map());
  });
});
