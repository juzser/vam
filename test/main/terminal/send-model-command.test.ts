/**
 * `/model <alias>` ON THE WIRE -- the argv tmux is handed for the picker's
 * strokes, asserted BY VALUE, because the wrong spelling of this one is typed
 * into a running agent.
 *
 * The composer's model picker builds its strokes with `modelCommandStrokes`
 * (renderer) and sends each over `terminal.send`, the one channel in vam that
 * types into a session somebody's agent is running in. This file walks those
 * exact strokes through main's own `sendSessionKey` with a fake runner and
 * reads what tmux would have been asked to do. Two things have to hold, and
 * they are the same two `promptKeystrokes` argues for a whole prompt:
 *
 *  - THE LINE IS TYPED LITERALLY (`send-keys -l --`). Without `-l` tmux looks
 *    the argument up as a KEY NAME -- measured on 3.7b, `send-keys Escape`
 *    delivers `^[` while `send-keys -l -- Escape` delivers six letters -- and
 *    `--` is what lets text beginning with `-` reach the pane rather than
 *    being read as an option. `/model opus` starts with a slash, but the
 *    builder does not know that, and a full model id typed into the free-text
 *    row is whatever the operator wrote.
 *
 *  - THE ENTER IS A SEPARATE, INTERPRETED KEY, and it is LAST. `-l` forbids
 *    interpretation, so Return cannot ride inside the text; and a raw newline
 *    in the literal payload would reach the pane as 0x0a, which is a submit
 *    to the REPL but not the key an operator pressed. It goes after every
 *    piece so a run that fails midway leaves the line sitting unsent.
 *
 * Nothing spawns -- the runner is a fake -- because the machine this runs on
 * has live agents in real panes.
 */

import { describe, expect, it } from 'vitest';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { sendSessionKey } from '../../../src/main/terminal/pane.js';
import { modelCommandStrokes } from '../../../src/renderer/panels/model-command.js';
import type { PaneSendResult } from '../../../src/shared/terminal.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const failed = (stderr: string): TmuxRunResult => ({
  failure: { message: 'tmux failed' },
  stdout: '',
  stderr,
});

const ATLAS = 'claude-code:atlas-11111111';
const PANE = '=vam-atlas-a1b2c3:';

function runner(answers: Record<string, TmuxRunResult>) {
  const argvs: (readonly string[])[] = [];
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    return answers[argv[0] ?? ''] ?? failed(`no stub for ${argv[0]}`);
  };
  return { run, argvs };
}

const listing = () => ({
  'list-sessions': ok(`${ATLAS}\t\tvam-atlas-a1b2c3\n`),
  'send-keys': ok(''),
});

/** Send every stroke the picker would, in order, the way the renderer does. */
async function sendAll(run: TmuxRun, choice: string): Promise<PaneSendResult[]> {
  const strokes = modelCommandStrokes(choice);
  if (strokes === null) throw new Error(`no strokes for ${JSON.stringify(choice)}`);
  const results: PaneSendResult[] = [];
  for (const stroke of strokes) results.push(await sendSessionKey(run, ATLAS, stroke));
  return results;
}

describe('the picker’s strokes, as tmux receives them', () => {
  it('types `/model opus` literally, then presses Return as its own key', async () => {
    const { run, argvs } = runner(listing());
    expect(await sendAll(run, 'opus')).toEqual(['sent', 'sent']);
    // `argvs[0]` is the listing that aims the first key. What follows is
    // exactly two sends: the line, typed, and the Return, pressed.
    const sends = argvs.filter((argv) => argv[0] === 'send-keys');
    expect(sends).toEqual([
      ['send-keys', '-t', PANE, '-l', '--', '/model opus'],
      ['send-keys', '-t', PANE, 'Enter'],
    ]);
  });

  it('never lets the Return ride inside the literal text, and never types the word Enter', async () => {
    const { run, argvs } = runner(listing());
    await sendAll(run, 'default');
    const sends = argvs.filter((argv) => argv[0] === 'send-keys');
    const literal = sends.filter((argv) => argv.includes('-l'));
    const pressed = sends.filter((argv) => !argv.includes('-l'));
    expect(literal.map((argv) => argv.at(-1))).toEqual(['/model default']);
    for (const argv of literal) {
      expect(argv.at(-1)).not.toContain('\n');
      expect(argv.at(-1)).not.toContain('\r');
    }
    expect(pressed).toEqual([['send-keys', '-t', PANE, 'Enter']]);
    // And the Return is the LAST thing sent, not the first: a submit before
    // the line would send whatever was already sitting in the pane.
    expect(sends.at(-1)).toEqual(['send-keys', '-t', PANE, 'Enter']);
  });

  it('types a full model id in literal pieces that rejoin into one line, then one Return', async () => {
    // `/model claude-opus-5-20260501` is 29 characters against a 16-character
    // key bound. Each piece is its own `-l --` send; the pane, a byte stream,
    // receives one line.
    const { run, argvs } = runner(listing());
    const results = await sendAll(run, 'claude-opus-5-20260501');
    expect(results.every((r) => r === 'sent')).toBe(true);
    const sends = argvs.filter((argv) => argv[0] === 'send-keys');
    const literal = sends.filter((argv) => argv.includes('-l'));
    expect(literal.length).toBeGreaterThan(1);
    for (const argv of literal) {
      expect(argv.slice(0, 5)).toEqual(['send-keys', '-t', PANE, '-l', '--']);
    }
    expect(literal.map((argv) => argv.at(-1)).join('')).toBe('/model claude-opus-5-20260501');
    expect(sends.filter((argv) => !argv.includes('-l'))).toEqual([
      ['send-keys', '-t', PANE, 'Enter'],
    ]);
    expect(sends.at(-1)).toEqual(['send-keys', '-t', PANE, 'Enter']);
  });

  it('is aimed by the same guard as every other key: no session of vam’s own, nothing typed', async () => {
    // A model changed in the wrong agent changes how somebody else's running
    // work behaves, so `/model` gets no gentler aiming than a letter does.
    const { run, argvs } = runner({
      'list-sessions': ok('claude-code:beacon-22222222\t\tvam-beacon-d4e5f6\n'),
      'send-keys': ok(''),
    });
    const strokes = modelCommandStrokes('opus') ?? [];
    expect(await sendSessionKey(run, ATLAS, strokes[0] as (typeof strokes)[number])).toBe(
      'unaimed',
    );
    expect(argvs.map((argv) => argv[0])).toEqual(['list-sessions']);
  });
});
