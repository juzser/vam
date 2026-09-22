/**
 * THE ECHO READ: the cheap read the Terminal tab makes right after a
 * keystroke lands, and the two things it is allowed to skip that the interval
 * read is not.
 *
 * WHY A CHEAPER READ EXISTS AT ALL, measured on this machine (tmux 3.7b, a
 * 200x50 pane with 1600 lines of ~150-character coloured scrollback, private
 * `-L` socket, n=30, load average ~8):
 *
 *            bytes      median
 *   -S -500  86,260     10.30 ms
 *   screen    7,760      5.55 ms
 *
 * plus the `list-sessions` spawn the read makes before it, another ~5 ms. So
 * an echo read that asks for neither costs about a third of one that asks for
 * both -- which is what makes reading ~30 times a second while somebody types
 * affordable at all (`panels/TerminalTab.tsx`, `ECHO_MS`).
 *
 * WHAT IS BEING TRADED, and it is the whole subject of this file. The read is
 * ALSO what re-proves the pairing between a row and the tmux session vam
 * started for it (`terminal/ipc.ts`). An echo read that skips
 * `list-sessions` proves nothing; it rides the aim the last proof left. So
 * every case here is either "the echo read skipped it" or "the interval read
 * still does it", and the second half is the one that keeps the first honest.
 *
 * Nothing spawns: the runner is a fake and the argv is asserted BY VALUE,
 * because the machine this runs on has live agents in real panes.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { AIM_TTL_MS, registerTerminalIpc } from '../../../src/main/terminal/ipc.js';
import type { PaneView } from '../../../src/shared/terminal.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const failed = (stderr: string): TmuxRunResult => ({
  failure: { message: 'tmux failed' },
  stdout: '',
  stderr,
});

const ATLAS = 'claude-code:atlas-11111111';
const BEACON = 'claude-code:beacon-22222222';
const NAME = 'vam-atlas-a1b2c3';
const SCREEN = '@vam-cursor 1 4 2 120\nthe screen\n';

function runner(answers: Record<string, TmuxRunResult>) {
  const argvs: (readonly string[])[] = [];
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    const verb = argv.includes('capture-pane') ? 'capture-pane' : (argv[0] ?? '');
    return answers[verb] ?? failed(`no stub for ${verb}`);
  };
  return {
    run,
    argvs,
    /** Re-point a stub mid-run: a session can end while the tab is open. */
    answer: (verb: string, result: TmuxRunResult) => {
      answers[verb] = result;
    },
    verbs: () => argvs.map((argv) => (argv.includes('capture-pane') ? 'capture-pane' : argv[0])),
    /** The one `capture-pane` argv, for the `-S` question. */
    capture: () => argvs.filter((argv) => argv.includes('capture-pane')).at(-1) ?? [],
  };
}

/** What `IpcMainLike.handle` is given -- its own shape, not a narrowing of it. */
type Handler = (event: unknown, ...args: unknown[]) => unknown;

/** The read channel, a clock a test can hold still, and what tmux was asked. */
function reader(rows = `${ATLAS}\t\t${NAME}\n`, screen = SCREEN) {
  const { run, argvs, verbs, capture, answer } = runner({
    'list-sessions': ok(rows),
    'capture-pane': ok(screen),
  });
  const handlers = new Map<string, Handler>();
  let clock = 1_000;
  registerTerminalIpc(
    { handle: (channel, listener) => void handlers.set(channel, listener) },
    run,
    async () => new Map(),
    () => clock,
  );
  const read = handlers.get(CHANNELS.terminalRead);
  if (read === undefined) throw new Error('the read channel was never registered');
  return {
    read: (mode?: unknown) =>
      (mode === undefined
        ? read({}, ATLAS, ATLAS)
        : read({}, ATLAS, ATLAS, mode)) as Promise<PaneView>,
    argvs,
    verbs,
    capture,
    answer,
    tick: (ms: number) => {
      clock += ms;
    },
    clear: () => void argvs.splice(0, argvs.length),
  };
}

describe('an echo read asks for the screen and nothing above it', () => {
  it('leaves `-S` off entirely when the operator is at the live end', async () => {
    const tab = reader();
    // The aim is proven by the interval read that ran a moment ago -- which is
    // the only way an echo read is ever reached in the app.
    expect((await tab.read()).kind).toBe('ok');
    tab.clear();

    expect((await tab.read('echo')).kind).toBe('ok');
    // BY VALUE, because this is where the decision is legible. `-S -500` is
    // 86KB and ~10ms; the same read without it is 7.7KB and ~5.5ms.
    expect(tab.capture()).toEqual([
      'display-message',
      '-p',
      '-t',
      `=${NAME}:`,
      '-F',
      '@vam-cursor #{cursor_flag} #{cursor_x} #{cursor_y} #{history_size} #{mouse_any_flag}',
      ';',
      'capture-pane',
      '-p',
      '-e',
      '-t',
      `=${NAME}:`,
    ]);
    expect(tab.capture()).not.toContain('-S');
  });

  it('asks for the WHOLE window when the operator has scrolled up', async () => {
    // The scrollback is the entire point of a scrolled-back view: serving it
    // the screen alone would empty the region under the operator's cursor.
    const tab = reader();
    expect((await tab.read()).kind).toBe('ok');
    tab.clear();

    expect((await tab.read('echo-scrollback')).kind).toBe('ok');
    expect(tab.capture()).toContain('-S');
    expect(tab.capture()).toContain('-500');
  });

  it('asks for the whole window on the interval read, every time', async () => {
    // The tick is what keeps something to scroll INTO in the DOM, so the
    // operator can reach the scrollback in the first place.
    const tab = reader();
    expect((await tab.read()).kind).toBe('ok');
    expect(tab.capture()).toContain('-S');
    expect(tab.capture()).toContain('-500');
  });
});

describe('the interval read re-proves the pairing; the echo read rides it', () => {
  it('lists the sessions on the interval read and not on the echo read', async () => {
    const tab = reader();
    expect((await tab.read()).kind).toBe('ok');
    expect(tab.verbs()).toEqual(['list-sessions', 'capture-pane']);
    tab.clear();

    expect((await tab.read('echo')).kind).toBe('ok');
    // ONE SPAWN, not three calls: no `list-sessions`, and no `readdir` of the
    // published panes either -- the aim already holds that decision.
    expect(tab.verbs()).toEqual(['capture-pane']);
  });

  it('lists them again on the NEXT interval read, with a fresh aim in hand', async () => {
    /**
     * THE HALF THE OBVIOUS TEST MISSES, and it missed it here first: a cold
     * tab has no aim, so the first read proves whatever the rule is. Asserting
     * only that one passes just as happily against a build where EVERY read
     * rides the aim -- which is the build with no revalidation in it at all.
     * The tick has to list with a good aim already sitting in the map.
     */
    const tab = reader();
    expect((await tab.read()).kind).toBe('ok');
    // The aim is warm now: an echo read rides it without a spawn to spare.
    expect((await tab.read('echo')).kind).toBe('ok');
    tab.clear();

    expect((await tab.read()).kind).toBe('ok');
    expect(tab.verbs()).toEqual(['list-sessions', 'capture-pane']);
  });

  it('proves the pairing itself when there is no aim to ride', async () => {
    // A cold tab, a tab whose last read failed, a tab past `AIM_TTL_MS`: the
    // echo read has nothing to trust, so it does the whole proof. This is what
    // keeps `not-vam`, `ambiguous` and `mispaired` reachable from this path.
    const tab = reader();
    expect((await tab.read('echo')).kind).toBe('ok');
    expect(tab.verbs()).toEqual(['list-sessions', 'capture-pane']);
  });

  it('does not let an echo read extend the aim past its two seconds', async () => {
    // THE HONEST HALF. An echo read that refreshed the aim would keep a
    // pairing alive for as long as somebody kept typing, without anything ever
    // re-proving it -- and `AIM_TTL_MS` would stop bounding anything at all.
    const tab = reader();
    expect((await tab.read()).kind).toBe('ok');
    tab.tick(AIM_TTL_MS - 1);
    expect((await tab.read('echo')).kind).toBe('ok');
    tab.tick(2);
    tab.clear();

    // Past the backstop: the proof the aim rode has expired, so this read
    // proves the pairing again rather than riding on.
    expect((await tab.read('echo')).kind).toBe('ok');
    expect(tab.verbs()).toEqual(['list-sessions', 'capture-pane']);
  });

  it('drops the aim when the pane it names has gone', async () => {
    // The fail-safe half of riding an aim: tmux answers `can't find pane` for
    // a session that has ended, so a wrong aim stops the run rather than being
    // ridden to the end of `AIM_TTL_MS`.
    const tab = reader();
    expect((await tab.read()).kind).toBe('ok');

    // The session ends under the tab, and the echo read is the one that finds
    // out -- without having listed anything.
    tab.answer('capture-pane', failed(`can't find pane =${NAME}:`));
    tab.clear();
    expect((await tab.read('echo')).kind).toBe('gone');
    expect(tab.verbs()).toEqual(['capture-pane']);

    // And the aim went with it: the next echo read proves a pairing again
    // rather than aiming at a session that is not there.
    tab.answer('capture-pane', ok(SCREEN));
    tab.clear();
    expect((await tab.read('echo')).kind).toBe('ok');
    expect(tab.verbs()).toEqual(['list-sessions', 'capture-pane']);
  });
});

describe('the refusals still mean what they meant', () => {
  it('says `not-vam` for a project no listed session was started for', async () => {
    const tab = reader(`${BEACON}\t\tvam-beacon-d4e5f6\n`);
    expect((await tab.read()).kind).toBe('not-vam');
    // No aim was set, so the next echo read proves for itself and refuses the
    // same way rather than drawing somebody else's screen.
    expect((await tab.read('echo')).kind).toBe('not-vam');
  });

  it('says `ambiguous` for two sessions answering to one project', async () => {
    const tab = reader(`${ATLAS}\t\t${NAME}\n${ATLAS}\t\tvam-atlas-b2c3d4\n`);
    expect((await tab.read()).kind).toBe('ambiguous');
    expect((await tab.read('echo')).kind).toBe('ambiguous');
  });

  it('refuses a mode it does not know, rather than guessing at one', async () => {
    // The renderer is the least trusted process in the app, and this argument
    // decides how much proving main does. Anything unrecognised is a bad ask.
    const tab = reader();
    const view = await tab.read('echo; drop the proof');
    expect(view.kind).toBe('unavailable');
    expect(view.kind === 'unavailable' && view.error.code).toBe('bad-request');
  });
});
