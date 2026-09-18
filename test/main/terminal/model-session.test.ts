/**
 * The model channel across the bridge: the read that puts a NAME on the model
 * button, and every way it declines to.
 *
 * It is a read like the prompt channel next door, and it is aimed by the same
 * `targetSession` rule for a reason worth stating once: the answer is drawn on
 * one row's button, so a model read out of a pane that row is not in would be
 * a sentence about somebody else's session wearing this one's title. Every
 * refusal is `unknown` here -- see `main/terminal/model.ts` for why the four
 * causes are not kept apart, which is the one place this channel differs from
 * `terminalRead`.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { registerTerminalIpc } from '../../../src/main/terminal/ipc.js';
import { readSessionModel } from '../../../src/main/terminal/model.js';
import { createTerminalApi } from '../../../src/preload/api.js';
import { OPUS_FRESH, PERMISSION_ASKING } from './model-status-screens.js';

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

/** tmux answering the listing, then the capture. */
const server =
  (screen: string, listing = LISTING): TmuxRun =>
  async (argv) =>
    argv[0] === 'list-sessions' ? ok(listing) : ok(screen);

function harness(run: TmuxRun, panes: ReadonlyMap<string, string> = new Map()) {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  registerTerminalIpc(
    { handle: (channel, handler) => void handlers.set(channel, handler) },
    run,
    async () => panes,
  );
  const model = handlers.get(CHANNELS.terminalModel);
  if (model === undefined) throw new Error('the model channel was never registered');
  return model;
}

describe('reading the model of the session a row is in', () => {
  it('names it off the screen of the pane the row published', async () => {
    const run = server(OPUS_FRESH);
    expect(await readSessionModel(run, PROJECT, 's1', new Map([['s1', PANE]]))).toEqual({
      kind: 'model',
      name: 'Opus 5',
    });
  });

  it('asks for the SCREEN and not the scrollback', async () => {
    // The footer is on the screen by definition, and the Terminal tab's
    // thousand lines of history would be a thousand lines for a reader that
    // looks at five. `-S` is what asks for history (`tmux/argv.ts`).
    const argvs: (readonly string[])[] = [];
    const run: TmuxRun = async (argv) => {
      argvs.push(argv);
      return argv[0] === 'list-sessions' ? ok(LISTING) : ok(OPUS_FRESH);
    };
    await readSessionModel(run, PROJECT, 's1', new Map([['s1', PANE]]));
    const capture = argvs.find((argv) => argv.includes('capture-pane')) ?? [];
    expect(capture).toContain('capture-pane');
    expect(capture).not.toContain('-S');
    // Aimed exactly, the way every other read of this pane is: a bare target
    // would resolve by prefix onto a session that is not this one.
    expect(capture).toContain(`=${PANE}:`);
  });

  it('says unknown for a screen whose footer is hidden behind a question', async () => {
    const run = server(PERMISSION_ASKING);
    expect(await readSessionModel(run, PROJECT, 's1', new Map([['s1', PANE]]))).toEqual({
      kind: 'unknown',
    });
  });

  it('says unknown for a project vam started no session for', async () => {
    const run = server(OPUS_FRESH, '\t\tsomebody-elses-session\n');
    expect(await readSessionModel(run, PROJECT, 's1')).toEqual({ kind: 'unknown' });
  });

  it('says unknown when two of vam’s sessions answer for one project', async () => {
    // A coin toss here would put another session's model on this row.
    const run = server(OPUS_FRESH, `${PROJECT}\t\t${PANE}\n${PROJECT}\t\t${OTHER}\n`);
    expect(await readSessionModel(run, PROJECT, 's1')).toEqual({ kind: 'unknown' });
  });

  it('says unknown for a row whose published pane is not one vam can use', async () => {
    // `mispaired`: the row named a pane, and it is not vam's for this project.
    // The tag path must not get its turn -- that is how a healthy session the
    // row was never in gets read (`terminal/pane.ts`).
    const run = server(OPUS_FRESH);
    expect(
      await readSessionModel(run, PROJECT, 's1', new Map([['s1', 'vam-beacon-999999']])),
    ).toEqual({ kind: 'unknown' });
  });

  it('says unknown when tmux would not answer the listing', async () => {
    const run: TmuxRun = async () => fail('no server running');
    expect(await readSessionModel(run, PROJECT, 's1')).toEqual({ kind: 'unknown' });
  });

  it('says unknown when the capture itself fails', async () => {
    const run: TmuxRun = async (argv) =>
      argv[0] === 'list-sessions' ? ok(LISTING) : fail("can't find pane");
    expect(await readSessionModel(run, PROJECT, 's1', new Map([['s1', PANE]]))).toEqual({
      kind: 'unknown',
    });
  });
});

describe('the model channel', () => {
  it('answers the name over the bridge', async () => {
    const model = harness(server(OPUS_FRESH), new Map([['s1', PANE]]));
    expect(await model(null, PROJECT, 's1')).toEqual({ kind: 'model', name: 'Opus 5' });
  });

  it('refuses an ask that is not two strings, without asking tmux anything', async () => {
    // The renderer is the least trusted process in the app, and this is the
    // same bound every channel in this file puts on an id it is handed.
    let spawned = 0;
    const run: TmuxRun = async (argv) => {
      spawned += 1;
      return argv[0] === 'list-sessions' ? ok(LISTING) : ok(OPUS_FRESH);
    };
    const model = harness(run, new Map([['s1', PANE]]));
    expect(await model(null)).toEqual({ kind: 'unknown' });
    expect(await model(null, 42)).toEqual({ kind: 'unknown' });
    expect(await model(null, PROJECT, 's1', 'extra')).toEqual({ kind: 'unknown' });
    expect(await model(null, 'x'.repeat(501), 's1')).toEqual({ kind: 'unknown' });
    expect(await model(null, PROJECT, 'y'.repeat(501))).toEqual({ kind: 'unknown' });
    expect(spawned).toBe(0);
  });
});

describe('the preload member', () => {
  it('invokes the model channel, and passes a row id only when there is one', async () => {
    // The row id is what makes the answer per SESSION rather than per project
    // (`terminal/pane.ts`), and a project with two sessions has two models.
    const calls: unknown[][] = [];
    const api = createTerminalApi({
      invoke: async (...args: unknown[]) => {
        calls.push(args);
        return { kind: 'unknown' };
      },
    });
    expect(await api.model(PROJECT)).toEqual({ kind: 'unknown' });
    await api.model(PROJECT, 's1');
    expect(calls).toEqual([
      [CHANNELS.terminalModel, PROJECT],
      [CHANNELS.terminalModel, PROJECT, 's1'],
    ]);
  });
});
