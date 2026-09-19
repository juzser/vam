/**
 * THE MODEL SWITCH ON THE WIRE -- the argv tmux is handed, asserted BY VALUE,
 * because the wrong spelling of any of these is pressed into a running agent.
 *
 * WHAT THIS FILE USED TO WALK, AND WHY IT MOVED. The composer's picker built
 * `/model <alias>` with `modelCommandStrokes` (renderer) and sent each piece
 * over `terminal.send`; this file walked those strokes through
 * `sendSessionKey`. Measured on Claude Code 2.1.276, that line answers `Set
 * model to Opus 5 and saved as your default for new sessions` -- so the route
 * this file was pinning rewrote `~/.claude/settings.json` on every pick. The
 * builder is gone and `main/terminal/model-switch.ts` drives the CLI's own
 * menu instead; the argv-level questions are the same ones, asked of it.
 *
 * THREE THINGS HAVE TO HOLD, and the first two are the ones
 * `promptKeystrokes` argues for a whole prompt:
 *
 *  - TEXT IS TYPED LITERALLY (`send-keys -l --`). Without `-l` tmux looks the
 *    argument up as a KEY NAME -- measured on 3.7b, `send-keys Escape`
 *    delivers `^[` while `send-keys -l -- Escape` delivers six letters -- and
 *    `--` is what lets text beginning with `-` reach the pane rather than
 *    being read as an option. `/model` starts with a slash, which is reason
 *    enough on its own.
 *
 *  - THE RETURN IS A SEPARATE, INTERPRETED KEY, and it is LAST of the pair
 *    that opens the menu. `-l` forbids interpretation, so Return cannot ride
 *    inside the text; and a raw newline in a literal payload would reach the
 *    pane as 0x0a, a submit to the REPL but not a key an operator pressed.
 *
 *  - AND THERE IS EXACTLY ONE RETURN. The second one -- on the open menu -- is
 *    the defect: it is the key the CLI's own footer labels `Enter to set as
 *    default`. `s` goes in its place, as literal text.
 *
 * Nothing spawns -- the runner is a fake -- because the machine this runs on
 * has live agents in real panes.
 */

import { describe, expect, it } from 'vitest';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { switchSessionModel } from '../../../src/main/terminal/model-switch.js';
import { AFTER_ESCAPE, MENU_ON_HAIKU, MENU_ON_OPUS } from './model-menu-screens.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });

const ATLAS = 'claude-code:atlas-11111111';
const PANE = '=vam-atlas-a1b2c3:';

/** tmux answering the listing, then one captured screen per read, in order. */
function runner(screens: readonly string[], listing = `${ATLAS}\t\tvam-atlas-a1b2c3\n`) {
  const argvs: (readonly string[])[] = [];
  let at = 0;
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    if (argv[0] === 'list-sessions') return ok(listing);
    // `capturePaneArgv` leads with `display-message`, so the verb is not [0].
    if (argv.includes('capture-pane')) {
      const screen = screens[Math.min(at, screens.length - 1)] ?? '';
      at += 1;
      return ok(screen);
    }
    return ok('');
  };
  return { run, argvs };
}

const sends = (argvs: readonly (readonly string[])[]) =>
  argvs.filter((argv) => argv[0] === 'send-keys');

describe('the menu route, as tmux receives it', () => {
  it('types a BARE `/model` literally, presses Return once, and commits with `s`', async () => {
    const { run, argvs } = runner([AFTER_ESCAPE, MENU_ON_OPUS, MENU_ON_HAIKU]);
    expect(await switchSessionModel(run, ATLAS, 'haiku')).toEqual({
      kind: 'sent',
    });
    expect(sends(argvs)).toEqual([
      ['send-keys', '-t', PANE, '-l', '--', '/model'],
      ['send-keys', '-t', PANE, 'Enter'],
      ['send-keys', '-t', PANE, 'Down'],
      ['send-keys', '-t', PANE, '-l', '--', 's'],
    ]);
  });

  it('never lets the Return ride inside the literal text, and never types the word Enter', async () => {
    const { run, argvs } = runner([AFTER_ESCAPE, MENU_ON_OPUS, MENU_ON_HAIKU]);
    await switchSessionModel(run, ATLAS, 'haiku');
    const literal = sends(argvs).filter((argv) => argv.includes('-l'));
    const pressed = sends(argvs).filter((argv) => !argv.includes('-l'));
    expect(literal.map((argv) => argv.at(-1))).toEqual(['/model', 's']);
    for (const argv of literal) {
      expect(argv.at(-1)).not.toContain('\n');
      expect(argv.at(-1)).not.toContain('\r');
      expect(argv.at(-1)).not.toBe('Enter');
    }
    // ONE Return, and it comes before the arrow -- it is the key that OPENS
    // the menu. A second one would be `Enter to set as default`.
    expect(pressed.filter((argv) => argv.at(-1) === 'Enter')).toEqual([
      ['send-keys', '-t', PANE, 'Enter'],
    ]);
  });

  it('closes the menu with the KEY Escape, never with the six letters', async () => {
    // Measured on 3.7b: `send-keys Escape` delivers `^[`, `send-keys -l --
    // Escape` types the word into whatever has the keyboard.
    const { run, argvs } = runner([AFTER_ESCAPE, AFTER_ESCAPE]);
    expect(await switchSessionModel(run, ATLAS, 'haiku')).toEqual({ kind: 'no-menu' });
    expect(sends(argvs).at(-1)).toEqual(['send-keys', '-t', PANE, 'Escape']);
  });
});

describe('the full-model-id route, as tmux receives it: it does not receive it', () => {
  it('hands tmux no send-keys at all for an id the menu has no row for', async () => {
    // WHAT THIS ASSERTED BEFORE. `/model claude-opus-5-20260501` went in as one
    // literal send and one Return -- the argument form, which the CLI answers
    // "...and saved as your default for new sessions". It was disclosed rather
    // than hidden; the operator chose refusal over disclosure, so the line is
    // not built for any input at all and this file's subject is what tmux is
    // NOT handed.
    const { run, argvs } = runner([AFTER_ESCAPE]);
    expect(await switchSessionModel(run, ATLAS, 'claude-opus-5-20260501')).toEqual({
      kind: 'not-in-menu',
      choice: 'claude-opus-5-20260501',
    });
    expect(sends(argvs)).toEqual([]);
    // Not even the Escape the post-menu refusals press: no menu was opened.
    expect(argvs.map((argv) => argv[0])).toEqual(['list-sessions', 'display-message']);
  });
});

describe('it is aimed by the same guard as every other key', () => {
  it('sends nothing at all when no session of vam’s own answers for the project', async () => {
    // A model changed in the wrong agent changes how somebody else's running
    // work behaves, so this gets no gentler aiming than a letter does.
    const { run, argvs } = runner(
      [AFTER_ESCAPE],
      'claude-code:beacon-22222222\t\tvam-beacon-d4e5f6\n',
    );
    expect(await switchSessionModel(run, ATLAS, 'opus')).toEqual({ kind: 'unaimed' });
    expect(argvs.map((argv) => argv[0])).toEqual(['list-sessions']);
  });
});
