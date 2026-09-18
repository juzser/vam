/**
 * Enter, and the ONE channel it now has.
 *
 * THE RULE THIS FILE EXISTS FOR. vam is a projection of the terminal: it types
 * the operator's prompt into the tmux pane of a session vam started, and the
 * Response view shows the turn when the session's own transcript shows it.
 * There is no second channel. The old `claude --resume <id> -p` path was
 * retired (`deliver.ts`) -- it refused while the target was running, which is
 * every session the operator wants to reply to, and it could not resume a
 * fresh session at all -- so a row with no pane vam owns is not delivered to a
 * different way. It is refused, in words that say why and what to do.
 *
 * The tests below pin that routing and, above all, the negatives: a reply vam
 * cannot type must SEND NOTHING to tmux and must claim nothing was delivered.
 */

import { describe, expect, it } from 'vitest';
import { projectIdOf } from '../../src/main/sources/claude-code/project-id.js';
import { replyToSession } from '../../src/main/sources/claude-code/reply.js';
import type { TmuxRun, TmuxRunResult } from '../../src/main/sources/tmux/spawn.js';

const CWD = '/work/atlas';
const OTHER = '/work/other';
// Invented, not a real session id: vam is public.
const SESSION = '11111111-2222-3333-4444-555555555555';
const PANE = 'vam-atlas-a1b2c3';

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

/**
 * A bare `send-keys … Enter` -- and note that the newline ESCAPE and the final
 * SUBMIT are byte-identical here. The REPL tells them apart only by the
 * backslash the escape leaves on the line before it, which is exactly why a
 * newline cannot be asserted "not a submit" by argv shape alone; the preceding
 * chunk is what carries the distinction.
 */
const isBareEnter = (argv: string[]): boolean =>
  argv[0] === 'send-keys' && !argv.includes('-l') && argv[argv.length - 1] === 'Enter';

const agents = [{ key: `${SESSION}#7`, sessionId: SESSION, cwd: CWD }];

describe('replyToSession', () => {
  it('types the reply into the pane of a session vam started, then submits once', async () => {
    const tmux = fakeTmux(`${projectIdOf(CWD)}\t\t${PANE}\n`);
    const error = await replyToSession({
      agents,
      rowId: `${SESSION}#7`,
      prompt: 'ship it',
      run: tmux.run,
    });

    expect(error).toBeNull();
    // Literal text (`-l`), then Return as a separate call: `-l` is what stops
    // tmux reading the operator's words as key NAMES, and under `-l` the word
    // `Enter` would be typed rather than pressed.
    expect(tmux.sent()).toEqual([
      ['send-keys', '-t', `=${PANE}:`, '-l', '--', 'ship it'],
      ['send-keys', '-t', `=${PANE}:`, 'Enter'],
    ]);
  });

  it('breaks a multi-line prompt with the escape, so only the final Enter submits', async () => {
    const tmux = fakeTmux(`${projectIdOf(CWD)}\t\t${PANE}\n`);
    const error = await replyToSession({
      agents,
      rowId: `${SESSION}#7`,
      prompt: 'line one\nline two',
      run: tmux.run,
    });

    expect(error).toBeNull();
    const sent = tmux.sent();
    // The whole sequence: type line one WITH the escape backslash, press Enter
    // (a NEWLINE, because of that backslash), type line two, then the ONE final
    // Enter that submits (no backslash before it).
    expect(sent).toEqual([
      ['send-keys', '-t', `=${PANE}:`, '-l', '--', 'line one\\'],
      ['send-keys', '-t', `=${PANE}:`, 'Enter'],
      ['send-keys', '-t', `=${PANE}:`, '-l', '--', 'line two'],
      ['send-keys', '-t', `=${PANE}:`, 'Enter'],
    ]);
    // The final keystroke is the submit; the only OTHER bare Enter is the
    // newline escape, and it sits after a chunk ending in a backslash.
    const last = sent.length - 1;
    expect(isBareEnter(sent[last] as string[])).toBe(true);
    sent.forEach((argv, index) => {
      if (index !== last && isBareEnter(argv)) {
        const before = sent[index - 1];
        expect(before?.[before.length - 1]?.endsWith('\\')).toBe(true);
      }
    });
  });

  it('REFUSES a session vam has no pane for, and types nothing at all', async () => {
    // A tmux server with sessions on it, none of them vam's for this project.
    const tmux = fakeTmux(`\t\tnotes\n${projectIdOf(OTHER)}\t\tvam-other-999999\n`);
    const error = await replyToSession({
      agents,
      rowId: `${SESSION}#7`,
      prompt: 'ship it',
      run: tmux.run,
    });

    // THE NEGATIVE, ASSERTED DIRECTLY: not one keystroke went anywhere.
    expect(tmux.sent()).toEqual([]);
    expect(error?.kind).toBe('refused');
    expect(error?.code).toBe('no-terminal');
    // It says what is true and points at the remedy, and it never claims a
    // delivery.
    expect(error?.message).toContain(`${SESSION}`);
    expect(error?.message).toMatch(/terminal/i);
    expect(error?.message).not.toMatch(/delivered|sent to the agent|resume/i);
  });

  it('refuses rather than guess between two panes vam started for one project', async () => {
    const id = projectIdOf(CWD);
    const tmux = fakeTmux(`${id}\t\tvam-atlas-aaa\n${id}\t\tvam-atlas-bbb\n`);
    const error = await replyToSession({
      agents,
      rowId: SESSION,
      prompt: 'ship it',
      run: tmux.run,
    });

    expect(tmux.sent()).toEqual([]);
    expect(error?.code).toBe('no-terminal');
  });

  it('refuses when the project holds more than one live session and no proof which pane', async () => {
    // The tag tmux records is a PROJECT, not a session, so a second live
    // session in the same directory means the pane might be the other one.
    const tmux = fakeTmux(`${projectIdOf(CWD)}\t\t${PANE}\n`);
    const error = await replyToSession({
      agents: [...agents, { key: 'other#8', sessionId: 'other', cwd: CWD }],
      rowId: `${SESSION}#7`,
      prompt: 'ship it',
      run: tmux.run,
    });

    expect(tmux.sent()).toEqual([]);
    expect(error?.code).toBe('no-terminal');
  });

  it('refuses a row it cannot find without touching tmux', async () => {
    const tmux = fakeTmux('');
    const error = await replyToSession({
      agents,
      rowId: 'gone#1',
      prompt: 'ship it',
      run: tmux.run,
    });

    expect(error?.code).toBe('unknown-session');
    expect(tmux.calls).toEqual([]);
  });

  it('reports a tmux that refused the keystrokes rather than reporting a delivery', async () => {
    const tmux = fakeTmux(`${projectIdOf(CWD)}\t\t${PANE}\n`, {
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
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain(PANE);
    // The Return must not be pressed after the text failed to arrive.
    expect(tmux.sent()).toHaveLength(1);
  });

  it('carries a tmux the reply reached but could not submit, so the words are not lost', async () => {
    // Make ONLY the submit (a bare Enter) fail, not the literal text.
    const calls: string[][] = [];
    const run: TmuxRun = async (argv) => {
      calls.push([...argv]);
      if (isBareEnter([...argv])) {
        return { failure: { message: 'exit 1', code: 1 }, stdout: '', stderr: 'boom' };
      }
      if (argv[0] === 'list-sessions') return ok(`${projectIdOf(CWD)}\t\t${PANE}\n`);
      return ok();
    };
    const error = await replyToSession({ agents, rowId: SESSION, prompt: 'ship it', run });
    expect(error?.message).toMatch(/typed into .* but vam could not press Return/);
    expect(calls.filter((argv) => argv[0] === 'send-keys')).toHaveLength(2);
  });

  it('refuses when tmux cannot be asked at all, without claiming a delivery', async () => {
    const tmux = fakeTmux('', {
      'list-sessions': {
        failure: { message: 'spawn tmux ENOENT', code: 'ENOENT' },
        stdout: '',
        stderr: '',
      },
    });
    const error = await replyToSession({
      agents,
      rowId: SESSION,
      prompt: 'ship it',
      run: tmux.run,
    });

    expect(tmux.sent()).toEqual([]);
    expect(error).not.toBeNull();
    expect(error?.message).not.toMatch(/delivered/i);
  });
});

describe('replyToSession with published panes', () => {
  const alpha = { key: 'sess-alpha#7', sessionId: 'sess-alpha', cwd: CWD };
  const beta = { key: 'sess-beta#8', sessionId: 'sess-beta', cwd: CWD };

  it('types into the pane the row published, with a second session in the project', async () => {
    const project = projectIdOf(CWD);
    const tmux = fakeTmux(`${project}\t\tvam-atlas-aa11bb\n${project}\t\tvam-atlas-cc22dd\n`);
    const error = await replyToSession({
      agents: [alpha, beta],
      rowId: 'sess-beta#8',
      prompt: 'ship it',
      run: tmux.run,
      panes: new Map([
        ['sess-alpha#7', 'vam-atlas-aa11bb'],
        ['sess-beta#8', 'vam-atlas-cc22dd'],
      ]),
    });

    expect(error).toBeNull();
    expect(tmux.sent()).toEqual([
      ['send-keys', '-t', '=vam-atlas-cc22dd:', '-l', '--', 'ship it'],
      ['send-keys', '-t', '=vam-atlas-cc22dd:', 'Enter'],
    ]);
  });

  it('refuses the project-tag fallback when the only tagged pane was published by another row', async () => {
    // THE VETO THE FALLBACK ENDS ON, exercised on its own. One live row in the
    // project, one tmux session tagged with the project -- every count the
    // fallback demands is satisfied -- and yet the pane is spoken for: a row
    // in ANOTHER project published it as its own. `claimedPanes` must win over
    // the tag, and with the pane now the only channel, "refuse" is the whole
    // difference between a typed reply and one landing in somebody else's
    // agent. A mutation that returns the tagged pane unchecked survived every
    // other test in this file; this one is the reason it no longer does.
    const gamma = { key: 'sess-gamma#9', sessionId: 'sess-gamma', cwd: CWD };
    const delta = { key: 'sess-delta#10', sessionId: 'sess-delta', cwd: OTHER };
    const tmux = fakeTmux(`${projectIdOf(CWD)}\t\tvam-atlas-ee33ff\n`);
    const error = await replyToSession({
      agents: [gamma, delta],
      rowId: 'sess-gamma#9',
      prompt: 'ship it',
      run: tmux.run,
      panes: new Map([['sess-delta#10', 'vam-atlas-ee33ff']]),
    });

    expect(tmux.sent()).toEqual([]);
    expect(error?.code).toBe('no-terminal');
  });
});
