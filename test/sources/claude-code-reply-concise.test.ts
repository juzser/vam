/**
 * WHAT TMUX IS ACTUALLY HANDED while the concise-output switch is on.
 *
 * THIS FILE EXISTS BECAUSE AN ARGV-SHAPED UNIT TEST IS NOT ENOUGH, and this
 * repo has the lesson written down: a test that builds an argv and asserts the
 * argv it built is a tautology. `test/main/terminal/concise.test.ts` holds the
 * DECISIONS (who is primed, what the rules say, what turning the switch off
 * does); what is asserted here is the BEHAVIOUR of the real `replyToSession`
 * over a fake tmux -- every `send-keys` it produced, in order, for a first
 * prompt and for the second one to the same session.
 *
 * The three claims the operator's request actually rests on:
 *   1. the rules ride on the FIRST prompt to a session,
 *   2. and NOT on the second,
 *   3. and with the switch off the argv is byte-identical to what vam sent
 *      before this feature existed.
 *
 * Every one of them is about a sequence of spawns rather than about a string,
 * and the fourth -- that a REFUSED prompt does not spend the priming -- can
 * only be asked here, because the refusal is `replyToSession`'s and the ledger
 * is the other module's.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectIdOf } from '../../src/main/sources/claude-code/project-id.js';
import { replyToSession } from '../../src/main/sources/claude-code/reply.js';
import type { TmuxRun, TmuxRunResult } from '../../src/main/sources/tmux/spawn.js';
import {
  CONCISE_RULES,
  forgetConcisePriming,
  setConciseOutput,
} from '../../src/main/terminal/concise.js';

const CWD = '/work/atlas';
// Invented, not a real session id: vam is public.
const SESSION = '11111111-2222-3333-4444-555555555555';
const OTHER_SESSION = '99999999-8888-7777-6666-555555555555';
const PANE = 'vam-atlas-a1b2c3';

const ok = (stdout = ''): TmuxRunResult => ({ failure: null, stdout, stderr: '' });

function fakeTmux(listing: string, results: Partial<Record<string, TmuxRunResult>> = {}) {
  const calls: string[][] = [];
  const run: TmuxRun = async (argv) => {
    calls.push([...argv]);
    const verb = argv[0] ?? '';
    return results[verb] ?? (verb === 'list-sessions' ? ok(listing) : ok());
  };
  return { run, calls, sent: () => calls.filter((argv) => argv[0] === 'send-keys') };
}

const agents = [
  { key: `${SESSION}#7`, sessionId: SESSION, cwd: CWD },
  { key: `${OTHER_SESSION}#3`, sessionId: OTHER_SESSION, cwd: CWD },
];

/** The listing, and the published pairing that makes each row's pane provable
 *  -- two live rows in one project, which is the case the project tag alone
 *  cannot answer. */
const LISTING = `${projectIdOf(CWD)}\t\t${PANE}\n${projectIdOf(CWD)}\t\tvam-atlas-d4e5f6\n`;
const PANES = new Map([
  [`${SESSION}#7`, PANE],
  [`${OTHER_SESSION}#3`, 'vam-atlas-d4e5f6'],
]);

const reply = (tmux: { run: TmuxRun }, rowId: string, prompt: string) =>
  replyToSession({ agents, rowId, prompt, run: tmux.run, panes: PANES });

beforeEach(() => {
  setConciseOutput(false);
  forgetConcisePriming();
});

afterEach(() => {
  // The ledger is process-wide; a test that left the switch on would arm every
  // file that runs after it in this worker.
  setConciseOutput(false);
  forgetConcisePriming();
});

describe('with the switch off', () => {
  it('types exactly what vam typed before this feature existed', async () => {
    const tmux = fakeTmux(LISTING);
    expect(await reply(tmux, `${SESSION}#7`, 'ship it')).toBeNull();
    // One literal chunk and one interpreted Enter. No lead, no extra escape,
    // no second newline -- the baseline `claude-code-reply.test.ts` pins for
    // the same call.
    expect(tmux.sent()).toEqual([
      ['send-keys', '-t', `=${PANE}:`, '-l', '--', 'ship it'],
      ['send-keys', '-t', `=${PANE}:`, 'Enter'],
    ]);
  });
});

describe('with the switch on', () => {
  beforeEach(() => setConciseOutput(true));

  it('rides the rules in on the first prompt, and submits once', async () => {
    const tmux = fakeTmux(LISTING);
    expect(await reply(tmux, `${SESSION}#7`, 'ship it')).toBeNull();
    // THE WHOLE SEQUENCE. The rules are typed as their own line WITH the
    // REPL's escape backslash, then an Enter that INSERTS a newline rather
    // than submitting; then the blank line, the same way; then the operator's
    // own text; then the ONE bare Enter that submits. A lead that submitted on
    // its own would ask the agent a question and throw the operator's prompt
    // into the answer.
    expect(tmux.sent()).toEqual([
      ['send-keys', '-t', `=${PANE}:`, '-l', '--', `${CONCISE_RULES}\\`],
      ['send-keys', '-t', `=${PANE}:`, 'Enter'],
      ['send-keys', '-t', `=${PANE}:`, '-l', '--', '\\'],
      ['send-keys', '-t', `=${PANE}:`, 'Enter'],
      ['send-keys', '-t', `=${PANE}:`, '-l', '--', 'ship it'],
      ['send-keys', '-t', `=${PANE}:`, 'Enter'],
    ]);
    // ONE SUBMIT, counted rather than eyeballed off the array above: a bare
    // Enter is byte-identical to the newline escape's Enter, and what tells
    // them apart is the backslash on the chunk before it.
    const submits = tmux
      .sent()
      .filter((argv, i, all) => argv[argv.length - 1] === 'Enter' && i === all.length - 1);
    expect(submits).toHaveLength(1);
  });

  it('sends the second prompt to that session clean', async () => {
    const first = fakeTmux(LISTING);
    await reply(first, `${SESSION}#7`, 'ship it');
    const second = fakeTmux(LISTING);
    expect(await reply(second, `${SESSION}#7`, 'and again')).toBeNull();
    expect(second.sent()).toEqual([
      ['send-keys', '-t', `=${PANE}:`, '-l', '--', 'and again'],
      ['send-keys', '-t', `=${PANE}:`, 'Enter'],
    ]);
  });

  it('still primes the OTHER session in the same project', async () => {
    const first = fakeTmux(LISTING);
    await reply(first, `${SESSION}#7`, 'ship it');
    const other = fakeTmux(LISTING);
    await reply(other, `${OTHER_SESSION}#3`, 'ship it');
    const typed = other.sent().map((argv) => argv[argv.length - 1]);
    expect(typed[0]).toBe(`${CONCISE_RULES}\\`);
  });

  it('does not spend the priming on a session vam has no channel into', async () => {
    // A row with no provable pane is REFUSED and nothing is typed
    // (`reply.ts`). The rules must still be waiting for the prompt that does
    // land -- which is what makes `delivered` a callback rather than a write.
    const deaf = fakeTmux('');
    const refused = await replyToSession({
      agents,
      rowId: `${SESSION}#7`,
      prompt: 'ship it',
      run: deaf.run,
      panes: new Map(),
    });
    expect(refused?.code).toBe('no-terminal');
    expect(deaf.sent()).toEqual([]);

    const later = fakeTmux(LISTING);
    await reply(later, `${SESSION}#7`, 'ship it');
    expect(later.sent()[0]?.[5]).toBe(`${CONCISE_RULES}\\`);
  });

  it('does not spend it when the keystrokes themselves fail', async () => {
    // Half a prompt in the pane and no Return pressed: `reply.ts` stops on the
    // first failing keystroke on purpose. The session was not told anything a
    // reader could act on, so it is not primed.
    const broken = fakeTmux(LISTING, {
      'send-keys': {
        failure: { message: "can't find pane", code: 1, killed: false, signal: null },
        stdout: '',
        stderr: "can't find pane",
      },
    });
    expect(await reply(broken, `${SESSION}#7`, 'ship it')).not.toBeNull();

    const later = fakeTmux(LISTING);
    await reply(later, `${SESSION}#7`, 'ship it');
    expect(later.sent()[0]?.[5]).toBe(`${CONCISE_RULES}\\`);
  });
});
