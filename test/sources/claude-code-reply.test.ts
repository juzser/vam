/**
 * Enter, and where it actually goes.
 *
 * THE BUG THIS FILE EXISTS FOR. `recordPrompt` ran `claude --resume <id> -p`
 * and nothing else, and that CLI declines while the target session is running
 * -- which, for a session the operator is sitting in front of and wants to
 * reply to, is every time. So Enter reliably produced a refusal and never a
 * reply, and the operator read it as "Enter does nothing".
 *
 * What changed is that vam now STARTS sessions, in tmux panes it owns, and
 * typing into a pane vam owns is a real channel. The tests below pin the
 * routing between the two paths and, more importantly, pin the negatives: a
 * reply vam cannot place must SEND NOTHING, not merely say something.
 */

import { describe, expect, it } from 'vitest';
import { projectIdOf } from '../../src/main/sources/claude-code/project-id.js';
import { replyToSession } from '../../src/main/sources/claude-code/reply.js';
import type { TmuxRun, TmuxRunResult } from '../../src/main/sources/tmux/spawn.js';

const CWD = '/work/atlas';
const OTHER = '/work/other';
const SESSION = '11111111-2222-3333-4444-555555555555';
const PANE = `vam-atlas-a1b2c3`;

const ok = (stdout = ''): TmuxRunResult => ({ failure: null, stdout, stderr: '' });

/** A tmux whose listing reports the given sessions, recording every argv it is handed. */
function fakeTmux(listing: string, results: Partial<Record<string, TmuxRunResult>> = {}) {
  const calls: string[][] = [];
  const run: TmuxRun = async (argv) => {
    calls.push([...argv]);
    const verb = argv[0] ?? '';
    return results[verb] ?? (verb === 'list-sessions' ? ok(listing) : ok());
  };
  return { run, calls, sent: () => calls.filter((argv) => argv[0] === 'send-keys') };
}

const agents = [{ key: `${SESSION}#7`, sessionId: SESSION, cwd: CWD }];

/** A `deliver` that must not be reached, and says so loudly if it is. */
const noDeliver = async () => {
  throw new Error('the CLI delivery path was called when it must not have been');
};

describe('replyToSession', () => {
  it('types the reply into the pane of a session vam started, and never spawns the CLI', async () => {
    const tmux = fakeTmux(`${projectIdOf(CWD)}\t${PANE}\n`);
    const error = await replyToSession({
      agents,
      rowId: `${SESSION}#7`,
      prompt: 'ship it',
      run: tmux.run,
      deliver: noDeliver,
    });

    expect(error).toBeNull();
    // Literal text, then Return as a separate call: `-l` is what stops tmux
    // reading the operator's words as key NAMES, and under `-l` the word
    // `Enter` would be typed rather than pressed.
    expect(tmux.sent()).toEqual([
      ['send-keys', '-t', `=${PANE}:`, '-l', '--', 'ship it'],
      ['send-keys', '-t', `=${PANE}:`, 'Enter'],
    ]);
  });

  it('sends NOTHING to tmux for a session vam did not start, and falls back to the CLI', async () => {
    // A tmux server with sessions on it, none of them vam's for this project.
    const tmux = fakeTmux(`\tnotes\n${projectIdOf(OTHER)}\tvam-other-999999\n`);
    let asked: { sessionId: string; cwd: string } | null = null;
    const error = await replyToSession({
      agents,
      rowId: `${SESSION}#7`,
      prompt: 'ship it',
      run: tmux.run,
      deliver: async (input) => {
        asked = { sessionId: input.sessionId, cwd: input.cwd };
        return {
          kind: 'refused',
          code: 'session-running',
          message: `session ${SESSION} is running, so Claude Code will not resume it here.`,
        };
      },
    });

    // THE NEGATIVE, ASSERTED DIRECTLY: not one keystroke went anywhere.
    expect(tmux.sent()).toEqual([]);
    expect(asked).toEqual({ sessionId: SESSION, cwd: CWD });
    expect(error?.code).toBe('session-running');
    // And what comes back must not read as a delivery.
    expect(error?.message).not.toMatch(/delivered|sent/i);
  });

  it('does not guess between two panes vam started for one project', async () => {
    const id = projectIdOf(CWD);
    const tmux = fakeTmux(`${id}\tvam-atlas-aaa\n${id}\tvam-atlas-bbb\n`);
    let calledCli = false;
    await replyToSession({
      agents,
      rowId: SESSION,
      prompt: 'ship it',
      run: tmux.run,
      deliver: async () => {
        calledCli = true;
        return null;
      },
    });

    expect(tmux.sent()).toEqual([]);
    expect(calledCli).toBe(true);
  });

  it('will not type into a pane when the project holds more than one live session', async () => {
    // The pairing tmux records is a PROJECT, not a session, so a second live
    // session in the same directory means the pane might be the other one.
    const tmux = fakeTmux(`${projectIdOf(CWD)}\t${PANE}\n`);
    let calledCli = false;
    await replyToSession({
      agents: [...agents, { key: 'other#8', sessionId: 'other', cwd: CWD }],
      rowId: `${SESSION}#7`,
      prompt: 'ship it',
      run: tmux.run,
      deliver: async () => {
        calledCli = true;
        return null;
      },
    });

    expect(tmux.sent()).toEqual([]);
    expect(calledCli).toBe(true);
  });

  it('refuses a row it cannot find without touching tmux or the CLI', async () => {
    const tmux = fakeTmux('');
    const error = await replyToSession({
      agents,
      rowId: 'gone#1',
      prompt: 'ship it',
      run: tmux.run,
      deliver: noDeliver,
    });

    expect(error?.code).toBe('unknown-session');
    expect(tmux.calls).toEqual([]);
  });

  it('reports a tmux that refused the keystrokes rather than reporting a delivery', async () => {
    const tmux = fakeTmux(`${projectIdOf(CWD)}\t${PANE}\n`, {
      'send-keys': {
        failure: { message: 'exit 1', code: 1 },
        stdout: '',
        stderr: `can't find pane: =${PANE}:`,
      },
    });
    const error = await replyToSession({
      agents,
      rowId: SESSION,
      prompt: 'ship it',
      run: tmux.run,
      deliver: noDeliver,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain(PANE);
    // The Return must not be pressed after the text failed to arrive.
    expect(tmux.sent()).toHaveLength(1);
  });

  it('falls back to the CLI when tmux cannot be asked at all', async () => {
    const tmux = fakeTmux('', {
      'list-sessions': {
        failure: { message: 'spawn tmux ENOENT', code: 'ENOENT' },
        stdout: '',
        stderr: '',
      },
    });
    let calledCli = false;
    await replyToSession({
      agents,
      rowId: SESSION,
      prompt: 'ship it',
      run: tmux.run,
      deliver: async () => {
        calledCli = true;
        return null;
      },
    });

    expect(tmux.sent()).toEqual([]);
    expect(calledCli).toBe(true);
  });
});
