/**
 * Issues 502/507: the operator's FIRST real message into a pane row the Response
 * view already draws `PaneReady` for.
 *
 * `PaneReady` is drawn the instant `entry.session.runningProvider` confirms a
 * known provider is running in a pane still reported `unstarted`/`terminal`
 * -- ahead of the slower agents-list poll that would otherwise repaint the
 * row as a live agent. The composer is enabled for it (`DetailPanel.tsx`'s
 * own `PaneReady` header), and it sends through the SAME write Start session
 * uses: `recordPrompt(rowId, text)` on a `pane:` row id, which `source.ts`
 * routes to `typeIntoOwnPane` (`start-in-pane.ts`) by NAME rather than
 * through `paneForRow`'s pairing, because a pane row has no agent to pair.
 *
 * `test/sources/claude-code-start-in-pane.test.ts` already pins the fix at
 * the unit level, with an in-memory `TmuxRun`. This file exercises the SAME
 * bug through the REAL exported `CLAUDE_CODE_SOURCE.recordPrompt` -- the
 * object the renderer's IPC bridge actually calls -- which builds its own
 * `createTmuxRunner()` internally and cannot be handed a stub. A fake `tmux`
 * put first on `PATH` is the only injection point that exists for it, the
 * same technique `claude-code.test.ts`'s own "write path when the CLI cannot
 * be asked" suite already uses for a fake `claude`.
 */

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLAUDE_CODE_SOURCE } from '../../src/main/sources/claude-code/source.js';

const PANE = 'vam-atlas-aa11bb';
const PROJECT = 'claude-code:atlas-11111111';

describe('CLAUDE_CODE_SOURCE.recordPrompt -- a `pane:` row already running a confirmed provider', () => {
  let binRoot: string;
  let listingPath: string;
  let logPath: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    binRoot = mkdtempSync(join(tmpdir(), 'vam-fake-tmux-'));
    listingPath = join(binRoot, 'listing.txt');
    logPath = join(binRoot, 'calls.log');
    writeFileSync(listingPath, '');
    writeFileSync(logPath, '');
    const tmuxPath = join(binRoot, 'tmux');
    // ONLY `send-keys` IS LOGGED, deliberately: `typeIntoPane`'s review-gate
    // read (`display-message ; capture-pane`) is a real call this fake still
    // answers (silently, exit 0, empty stdout -- so the gate never re-fires
    // a second Enter), it is simply not part of what these tests assert.
    writeFileSync(
      tmuxPath,
      [
        '#!/bin/sh',
        'case "$1" in',
        '  list-sessions)',
        `    cat "${listingPath}"`,
        '    ;;',
        '  send-keys)',
        `    { printf '%s\\t' "$@"; printf '\\n'; } >> "${logPath}"`,
        '    ;;',
        '  *)',
        '    ;;',
        'esac',
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(tmuxPath, 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${binRoot}:${originalPath ?? ''}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    rmSync(binRoot, { recursive: true, force: true });
  });

  /** Every `send-keys` this fake tmux saw, as argv arrays -- `send-keys` itself included. */
  function sendKeysCalls(): string[][] {
    return readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.replace(/\t$/, '').split('\t'));
  }

  it('delivers the first message into a pane CONFIRMED running claude (its measured version-string command), never refusing pane-occupied', async () => {
    writeFileSync(listingPath, `${PROJECT}\t4242\t${PANE}\t2.1.282\n`);
    const result = await CLAUDE_CODE_SOURCE.recordPrompt?.(`pane:${PANE}`, 'hello there');
    expect(result).toBeNull();
    expect(sendKeysCalls()).toEqual([
      ['send-keys', '-t', `=${PANE}:`, '-l', '--', 'hello there'],
      ['send-keys', '-t', `=${PANE}:`, 'Enter'],
    ]);
  });

  it('delivers the same for a pane CONFIRMED running codex', async () => {
    writeFileSync(listingPath, `${PROJECT}\t4242\t${PANE}\tcodex\n`);
    const result = await CLAUDE_CODE_SOURCE.recordPrompt?.(`pane:${PANE}`, 'hello there');
    expect(result).toBeNull();
    expect(sendKeysCalls()).toEqual([
      ['send-keys', '-t', `=${PANE}:`, '-l', '--', 'hello there'],
      ['send-keys', '-t', `=${PANE}:`, 'Enter'],
    ]);
  });

  it('still refuses a pane running something neither table entry names', async () => {
    writeFileSync(listingPath, `${PROJECT}\t4242\t${PANE}\tvim\n`);
    const result = await CLAUDE_CODE_SOURCE.recordPrompt?.(`pane:${PANE}`, 'hello there');
    expect(result).toMatchObject({ kind: 'refused', code: 'pane-occupied' });
    expect(sendKeysCalls()).toEqual([]);
  });

  it('still types a shell pane the ordinary Start-session way', async () => {
    writeFileSync(listingPath, `${PROJECT}\t4242\t${PANE}\tzsh\n`);
    const result = await CLAUDE_CODE_SOURCE.recordPrompt?.(`pane:${PANE}`, 'claude');
    expect(result).toBeNull();
    expect(sendKeysCalls()).toEqual([
      ['send-keys', '-t', `=${PANE}:`, '-l', '--', 'claude'],
      ['send-keys', '-t', `=${PANE}:`, 'Enter'],
    ]);
  });
});
