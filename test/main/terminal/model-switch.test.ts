/**
 * SWITCHING A SESSION'S MODEL WITHOUT REWRITING THE OPERATOR'S DEFAULT.
 *
 * THE DEFECT THIS FILE PINS. vam switched models by typing `/model <alias>`
 * and Enter into the pane. Measured on Claude Code 2.1.276, that form also
 * saves the alias as the user's default for new sessions -- the CLI says so
 * itself: the answer line reads `Set model to Opus 5 and saved as your default
 * for new sessions`, and the menu's own header reads `Switch between Claude
 * models. Your pick becomes the default for new sessions.` So every pick in
 * vam silently rewrote `~/.claude/settings.json`, from a control whose note
 * claimed it switched this session.
 *
 * THE ROUTE THAT DOES NOT, measured on the same CLI over a private tmux
 * socket: a BARE `/model` opens a menu whose footer reads `Enter to set as
 * default · s to use this session only · Esc to cancel`. `send-keys Down` then
 * `send-keys -l -- 's'` answered `Set model to Haiku 4.5 for this session
 * only`, and `~/.claude/settings.json` was byte-identical afterwards -- same
 * sha256, same mtime. The screens of that drive are in `model-menu-screens.ts`
 * and this file walks them.
 *
 * EVERY SCREEN HERE IS A REAL CAPTURE and the tmux behind it is a fake, for
 * the reason `model-session.test.ts` states: the machine this runs on has live
 * agents in real panes.
 *
 * WHAT IS ASSERTED BY VALUE, because the wrong one of these is pressed into
 * somebody's running agent:
 *
 *  - THE KEYS, IN ORDER. One Enter and one only -- the one that OPENS the menu
 *    -- and `s` as literal text at the end. An Enter on an open menu is the
 *    defect itself.
 *  - THE CURSOR IS READ BEFORE `s` IS PRESSED, never counted. The walk steps
 *    and re-reads, exactly as `answer.ts` does, because a menu that stopped
 *    taking keys would otherwise take an `s` on whatever row it was showing.
 *  - EVERY REFUSAL AFTER THE MENU OPENS PRESSES ESCAPE. Leaving the CLI's menu
 *    open in the operator's session is not an acceptable failure state.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { registerTerminalIpc } from '../../../src/main/terminal/ipc.js';
import {
  menuRowName,
  rowNamed,
  switchSessionModel,
} from '../../../src/main/terminal/model-switch.js';
import { createTerminalApi } from '../../../src/preload/api.js';
import type { ModelSwitchResult } from '../../../src/shared/terminal.js';
import {
  AFTER_ESCAPE,
  MENU_ON_DEFAULT,
  MENU_ON_FABLE,
  MENU_ON_HAIKU,
  MENU_ON_OPUS,
  MENU_ON_SONNET,
} from './model-menu-screens.js';
import { PERMISSION_ASKING } from './model-status-screens.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const fail = (stderr: string): TmuxRunResult => ({
  failure: { message: stderr, code: 1 },
  stdout: '',
  stderr,
});

/** Invented, like every value here: a project digest and vam's own prefix. */
const PROJECT = 'p-atlas-1';
const PANE = 'vam-atlas-a1b2c3';
const OTHER = 'vam-atlas-d4e5f6';
const LISTING = `${PROJECT}\t\t${PANE}\n`;
/** The row published its pane, which is what makes the answer per SESSION. */
const ROW: ReadonlyMap<string, string> = new Map([['s1', PANE]]);

/**
 * A tmux that answers the listing and then hands out one captured screen per
 * `capture-pane`, in order. `null` is a capture that FAILED; the last entry is
 * repeated for every read past the end, which is how a menu that has stopped
 * moving is expressed.
 */
function server(screens: readonly (string | null)[], listing = LISTING) {
  const argv: (readonly string[])[] = [];
  let at = 0;
  const run: TmuxRun = async (asked) => {
    argv.push(asked);
    if (asked[0] === 'list-sessions') return ok(listing);
    // `capturePaneArgv` leads with `display-message` -- the cursor format and
    // the capture arrive as ONE tmux invocation, so the verb is not argv[0].
    if (asked.includes('capture-pane')) {
      const screen = screens[Math.min(at, screens.length - 1)];
      at += 1;
      return screen === null || screen === undefined ? fail("can't find pane") : ok(screen);
    }
    return ok('');
  };
  return { run, argv };
}

/**
 * Every key tmux was asked to press, in order. Literal text is quoted, an
 * interpreted key name is bare -- the distinction `argv.ts` exists to keep,
 * and the one a reader of this file has to see at a glance.
 */
const keys = (argv: readonly (readonly string[])[]): string[] =>
  argv
    .filter((asked) => asked[0] === 'send-keys')
    .map((asked) => (asked.includes('-l') ? `«${asked.at(-1)}»` : String(asked.at(-1))));

const captures = (argv: readonly (readonly string[])[]): number =>
  argv.filter((asked) => asked.includes('capture-pane')).length;

describe('the walk onto a menu row, and the `s` that keeps it to this session', () => {
  it('opens the menu, steps the cursor onto the asked-for row and presses `s`', async () => {
    // The real drive: the menu opens with the cursor on Opus, the probe arrow
    // takes it to Haiku, and two more steps reach Sonnet -- through Default,
    // whose own description says `Sonnet 5`.
    const { run, argv } = server([
      AFTER_ESCAPE,
      MENU_ON_OPUS,
      MENU_ON_HAIKU,
      MENU_ON_DEFAULT,
      MENU_ON_SONNET,
    ]);
    expect(await switchSessionModel(run, PROJECT, 'sonnet', 's1', ROW)).toEqual({
      kind: 'sent',
      scope: 'session',
    });
    expect(keys(argv)).toEqual(['«/model»', 'Enter', 'Down', 'Down', 'Down', '«s»']);
  });

  it('presses exactly ONE Return, the one that opens the menu, and never on a row', async () => {
    // THE DEFECT, AS AN ASSERTION. Return on an open model menu is what saves
    // the alias as the operator's default for new sessions.
    const { run, argv } = server([
      AFTER_ESCAPE,
      MENU_ON_OPUS,
      MENU_ON_HAIKU,
      MENU_ON_DEFAULT,
      MENU_ON_SONNET,
    ]);
    await switchSessionModel(run, PROJECT, 'sonnet', 's1', ROW);
    const pressed = keys(argv);
    expect(pressed.filter((key) => key === 'Enter')).toHaveLength(1);
    expect(pressed.indexOf('Enter')).toBeLessThan(pressed.indexOf('Down'));
    expect(pressed.at(-1)).toBe('«s»');
  });

  it('walks the wrap the CLI really does, rather than counting positions', async () => {
    // Measured: Down from row 5 lands on row 1. Asking for Opus while the
    // cursor is already on Opus therefore goes all the way round.
    const { run, argv } = server([
      AFTER_ESCAPE,
      MENU_ON_OPUS,
      MENU_ON_HAIKU,
      MENU_ON_DEFAULT,
      MENU_ON_SONNET,
      MENU_ON_FABLE,
      MENU_ON_OPUS,
    ]);
    expect(await switchSessionModel(run, PROJECT, 'opus', 's1', ROW)).toEqual({
      kind: 'sent',
      scope: 'session',
    });
    expect(keys(argv)).toEqual([
      '«/model»',
      'Enter',
      'Down',
      'Down',
      'Down',
      'Down',
      'Down',
      '«s»',
    ]);
  });

  it('does not take the Default row for Sonnet, though its description says Sonnet 5', async () => {
    // THE PREFIX TRAP, AND IT IS IN THE REAL CAPTURE: row one's label reads
    // `Default (recommended)  Sonnet 5 · Efficient for routine tasks`. A match
    // by `includes` would press `s` there and switch the session to whatever
    // Default currently resolves to.
    const { run, argv } = server([AFTER_ESCAPE, MENU_ON_HAIKU, MENU_ON_DEFAULT, MENU_ON_SONNET]);
    expect(await switchSessionModel(run, PROJECT, 'sonnet', 's1', ROW)).toEqual({
      kind: 'sent',
      scope: 'session',
    });
    expect(keys(argv)).toEqual(['«/model»', 'Enter', 'Down', 'Down', '«s»']);
  });

  it('re-reads the screen after every arrow, so the `s` lands on a row it just read', async () => {
    const { run, argv } = server([AFTER_ESCAPE, MENU_ON_HAIKU, MENU_ON_DEFAULT, MENU_ON_SONNET]);
    await switchSessionModel(run, PROJECT, 'sonnet', 's1', ROW);
    // One before a key is typed, one for the opened menu, one per arrow.
    expect(captures(argv)).toBe(4);
  });

  it('aims the keys and the reads at the row’s own pane, exactly', async () => {
    const { run, argv } = server([AFTER_ESCAPE, MENU_ON_OPUS, MENU_ON_HAIKU]);
    await switchSessionModel(run, PROJECT, 'haiku', 's1', ROW);
    for (const asked of argv) {
      if (asked[0] === 'list-sessions') continue;
      expect(asked).toContain(`=${PANE}:`);
    }
  });
});

describe('a name is matched at the head of the row, on a boundary', () => {
  it('takes the row whose label BEGINS with the name', () => {
    expect(
      rowNamed('Sonnet ✔               Sonnet 5 · Efficient for routine tasks', 'Sonnet'),
    ).toBe(true);
    expect(
      rowNamed('Default (recommended)  Sonnet 5 · Efficient for routine tasks', 'Default'),
    ).toBe(true);
  });

  it('refuses a row that merely mentions the name further along', () => {
    expect(
      rowNamed('Default (recommended)  Sonnet 5 · Efficient for routine tasks', 'Sonnet'),
    ).toBe(false);
  });

  it('refuses a longer name that starts with this one', () => {
    // The day the CLI ships `SonnetLite`, `^Sonnet` alone would answer for it.
    expect(rowNamed('SonnetLite             Sonnet 5 · Cheap', 'Sonnet')).toBe(false);
    expect(rowNamed('Sonnet-Lite            Sonnet 5 · Cheap', 'Sonnet')).toBe(false);
  });

  it('knows the five aliases the CLI’s own menu prints, and nothing else', () => {
    expect(menuRowName('default')).toBe('Default');
    expect(menuRowName('sonnet')).toBe('Sonnet');
    expect(menuRowName('fable')).toBe('Fable');
    expect(menuRowName('opus')).toBe('Opus');
    expect(menuRowName('haiku')).toBe('Haiku');
    expect(menuRowName('Opus')).toBe('Opus');
    expect(menuRowName('claude-opus-5-20260501')).toBeNull();
  });
});

describe('a picker that already has the keyboard stops the switch before a key', () => {
  it('refuses with the question the pane is asking, and types nothing at all', async () => {
    const { run, argv } = server([PERMISSION_ASKING]);
    expect(await switchSessionModel(run, PROJECT, 'opus', 's1', ROW)).toEqual({
      kind: 'question',
      title: 'Do you want to create b.txt?',
    });
    // Not "the /model but not the Return": NOTHING. A bare `/model` typed into
    // an open permission prompt is its own mess.
    expect(keys(argv)).toEqual([]);
  });

  it('refuses a menu the operator opened themselves, rather than driving it', async () => {
    const { run, argv } = server([MENU_ON_OPUS]);
    const result = await switchSessionModel(run, PROJECT, 'opus', 's1', ROW);
    expect(result.kind).toBe('question');
    expect(keys(argv)).toEqual([]);
  });

  it('refuses the full-model-id route on the same reading, not only the five aliases', async () => {
    const { run, argv } = server([PERMISSION_ASKING]);
    const result = await switchSessionModel(run, PROJECT, 'claude-opus-5-20260501', 's1', ROW);
    expect(result.kind).toBe('question');
    expect(keys(argv)).toEqual([]);
  });
});

describe('every refusal after the menu is asked for closes it again', () => {
  it('says no-menu, and presses Escape, when the menu did not open', async () => {
    // What this really means: the REPL was busy, so the `/model` line went in
    // as a PROMPT. The caption says so; this asserts vam did not walk on.
    const { run, argv } = server([AFTER_ESCAPE, AFTER_ESCAPE]);
    expect(await switchSessionModel(run, PROJECT, 'opus', 's1', ROW)).toEqual({ kind: 'no-menu' });
    expect(keys(argv)).toEqual(['«/model»', 'Enter', 'Escape']);
  });

  it('says no-menu when it could not read the screen after asking for one', async () => {
    const { run, argv } = server([AFTER_ESCAPE, null]);
    expect(await switchSessionModel(run, PROJECT, 'opus', 's1', ROW)).toEqual({ kind: 'no-menu' });
    expect(keys(argv)).toEqual(['«/model»', 'Enter', 'Escape']);
  });

  it('says not-live when the probe arrow does not move the cursor', async () => {
    // A menu that does not take keys would otherwise be sent an `s` on
    // whatever row the cursor sat on -- the Crimson failure `answer.ts`
    // documents, wearing this control's face.
    const { run, argv } = server([AFTER_ESCAPE, MENU_ON_OPUS, MENU_ON_OPUS]);
    expect(await switchSessionModel(run, PROJECT, 'sonnet', 's1', ROW)).toEqual({
      kind: 'not-live',
    });
    expect(keys(argv)).toEqual(['«/model»', 'Enter', 'Down', 'Escape']);
  });

  it('says not-live when the menu leaves the screen mid-walk', async () => {
    const { run, argv } = server([AFTER_ESCAPE, MENU_ON_OPUS, MENU_ON_HAIKU, AFTER_ESCAPE]);
    expect(await switchSessionModel(run, PROJECT, 'sonnet', 's1', ROW)).toEqual({
      kind: 'not-live',
    });
    expect(keys(argv)).toEqual(['«/model»', 'Enter', 'Down', 'Down', 'Escape']);
  });

  it('says unreadable, and still escapes, when the screen goes dark mid-walk', async () => {
    const { run, argv } = server([AFTER_ESCAPE, MENU_ON_OPUS, null]);
    expect(await switchSessionModel(run, PROJECT, 'sonnet', 's1', ROW)).toEqual({
      kind: 'unreadable',
    });
    expect(keys(argv)).toEqual(['«/model»', 'Enter', 'Down', 'Escape']);
  });

  it('gives up after one pass of the rows rather than walking forever', async () => {
    // A menu that took the probe arrow and then stopped moving. The bound is
    // what stops this being an infinite walk in somebody's running agent.
    const { run, argv } = server([AFTER_ESCAPE, MENU_ON_OPUS, MENU_ON_FABLE]);
    expect(await switchSessionModel(run, PROJECT, 'sonnet', 's1', ROW)).toEqual({
      kind: 'unmatched',
      label: 'Sonnet',
    });
    const pressed = keys(argv);
    expect(pressed.at(0)).toBe('«/model»');
    expect(pressed.at(-1)).toBe('Escape');
    expect(pressed).not.toContain('«s»');
    expect(pressed.filter((key) => key === 'Down').length).toBeLessThanOrEqual(8);
  });

  it('reports a tmux that would not press the `s`, having closed the menu', async () => {
    const screens = [AFTER_ESCAPE, MENU_ON_OPUS, MENU_ON_HAIKU];
    let at = 0;
    const argv: (readonly string[])[] = [];
    const run: TmuxRun = async (asked) => {
      argv.push(asked);
      if (asked[0] === 'list-sessions') return ok(LISTING);
      if (asked.includes('capture-pane')) {
        const screen = screens[Math.min(at, screens.length - 1)] ?? '';
        at += 1;
        return ok(screen);
      }
      return asked.at(-1) === 's' ? fail('lost server') : ok('');
    };
    expect(await switchSessionModel(run, PROJECT, 'haiku', 's1', ROW)).toEqual({ kind: 'refused' });
    expect(keys(argv)).toEqual(['«/model»', 'Enter', 'Down', '«s»', 'Escape']);
  });
});

describe('the full model id has no row, so it takes the argument form and says so', () => {
  it('types the whole line literally, presses Return, and calls the scope what it is', async () => {
    const { run, argv } = server([AFTER_ESCAPE]);
    expect(await switchSessionModel(run, PROJECT, 'claude-opus-5-20260501', 's1', ROW)).toEqual({
      kind: 'sent',
      scope: 'default',
    });
    expect(keys(argv)).toEqual(['«/model claude-opus-5-20260501»', 'Enter']);
    // Literally, with `--`: without `-l` tmux looks the argument up as a KEY
    // NAME, and `--` is what lets text beginning with `-` reach the pane.
    expect(argv.find((asked) => asked[0] === 'send-keys')).toEqual([
      'send-keys',
      '-t',
      `=${PANE}:`,
      '-l',
      '--',
      '/model claude-opus-5-20260501',
    ]);
    // It reads once -- the picker check -- and never opens a menu it cannot
    // find this id on.
    expect(captures(argv)).toBe(1);
  });

  it('does not press the Return when the line itself would not go in', async () => {
    const argv: (readonly string[])[] = [];
    const run: TmuxRun = async (asked) => {
      argv.push(asked);
      if (asked[0] === 'list-sessions') return ok(LISTING);
      if (asked.includes('capture-pane')) return ok(AFTER_ESCAPE);
      return fail('lost server');
    };
    expect(await switchSessionModel(run, PROJECT, 'claude-opus-5', 's1', ROW)).toEqual({
      kind: 'refused',
    });
    expect(keys(argv)).toEqual(['«/model claude-opus-5»']);
  });
});

describe('it is aimed by the same rule as every other write into a pane', () => {
  it('says unavailable, and types nothing, when tmux would not answer the listing', async () => {
    // NOT `no server running`, which `listVamSessions` reads as an empty list
    // -- no server means no sessions, and that is an answer rather than a
    // failure. This is tmux refusing to answer at all.
    const argv: (readonly string[])[] = [];
    const run: TmuxRun = async (asked) => {
      argv.push(asked);
      return fail('lost server');
    };
    expect(await switchSessionModel(run, PROJECT, 'opus', 's1', ROW)).toEqual({
      kind: 'unavailable',
    });
    expect(keys(argv)).toEqual([]);
  });

  it('says mispaired for a row whose published pane is not one vam can use', async () => {
    const { run, argv } = server([AFTER_ESCAPE]);
    expect(
      await switchSessionModel(run, PROJECT, 'opus', 's1', new Map([['s1', 'vam-beacon-999999']])),
    ).toEqual({ kind: 'mispaired' });
    expect(keys(argv)).toEqual([]);
  });

  it('says unaimed when two of vam’s sessions answer for one project', async () => {
    const { run, argv } = server([AFTER_ESCAPE], `${PROJECT}\t\t${PANE}\n${PROJECT}\t\t${OTHER}\n`);
    expect(await switchSessionModel(run, PROJECT, 'opus', 's1')).toEqual({ kind: 'unaimed' });
    expect(keys(argv)).toEqual([]);
  });

  it('says unreadable, having typed nothing, when it could not look first', async () => {
    const { run, argv } = server([null]);
    expect(await switchSessionModel(run, PROJECT, 'opus', 's1', ROW)).toEqual({
      kind: 'unreadable',
    });
    expect(keys(argv)).toEqual([]);
  });

  it('refuses a choice that is not one word before it asks tmux anything', async () => {
    const { run, argv } = server([AFTER_ESCAPE]);
    for (const choice of ['opus haiku', 'opus\nhaiku', '', 'x'.repeat(300)]) {
      expect(await switchSessionModel(run, PROJECT, choice, 's1', ROW), choice).toEqual({
        kind: 'unaimed',
      });
    }
    expect(argv).toEqual([]);
  });
});

describe('the channel the renderer reaches it through', () => {
  function harness(run: TmuxRun, panes: ReadonlyMap<string, string> = ROW) {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    registerTerminalIpc(
      { handle: (channel, handler) => void handlers.set(channel, handler) },
      run,
      async () => panes,
    );
    const handler = handlers.get(CHANNELS.terminalSwitchModel);
    if (handler === undefined) throw new Error('the switch-model channel was never registered');
    return handler as (event: unknown, ...args: unknown[]) => Promise<ModelSwitchResult>;
  }

  it('drives the whole walk for the row it is given', async () => {
    const { run, argv } = server([AFTER_ESCAPE, MENU_ON_OPUS, MENU_ON_HAIKU]);
    expect(await harness(run)(null, PROJECT, 'haiku', 's1')).toEqual({
      kind: 'sent',
      scope: 'session',
    });
    expect(keys(argv)).toEqual(['«/model»', 'Enter', 'Down', '«s»']);
  });

  it('refuses a malformed ask without asking tmux anything', async () => {
    const { run, argv } = server([AFTER_ESCAPE, MENU_ON_OPUS, MENU_ON_HAIKU]);
    const handler = harness(run);
    const asks: unknown[][] = [
      [],
      [PROJECT],
      [PROJECT, 'opus', 's1', 'extra'],
      [PROJECT, 42],
      [PROJECT, 'opus haiku'],
      [PROJECT, 'opus\n'],
      [PROJECT, 'x'.repeat(300)],
      ['p'.repeat(600), 'opus'],
      [PROJECT, 'opus', 42],
      [PROJECT, 'opus', 'r'.repeat(600)],
    ];
    for (const ask of asks) {
      expect(await handler(null, ...ask), JSON.stringify(ask)).toEqual({ kind: 'unaimed' });
    }
    expect(argv).toEqual([]);
  });

  it('answers for the project alone when no row is named', async () => {
    const { run } = server([AFTER_ESCAPE, MENU_ON_OPUS, MENU_ON_HAIKU]);
    expect(await harness(run, new Map())(null, PROJECT, 'haiku')).toEqual({
      kind: 'sent',
      scope: 'session',
    });
  });

  it('is on the preload’s terminal api, forwarding the row when there is one', async () => {
    const asked: unknown[][] = [];
    const api = createTerminalApi({
      invoke: async (channel: string, ...args: unknown[]) => {
        asked.push([channel, ...args]);
        return { kind: 'sent', scope: 'session' };
      },
    });
    expect(await api.switchModel(PROJECT, 'opus')).toEqual({ kind: 'sent', scope: 'session' });
    await api.switchModel(PROJECT, 'opus', 's1');
    expect(asked).toEqual([
      [CHANNELS.terminalSwitchModel, PROJECT, 'opus'],
      [CHANNELS.terminalSwitchModel, PROJECT, 'opus', 's1'],
    ]);
  });
});
