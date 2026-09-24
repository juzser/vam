/**
 * TWO SOURCES FOR ONE FACT, AND THE ORDER THEY ARE ASKED IN.
 *
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 *
 * Reported from use: the model button said `model` and never anything else.
 * Not a parser bug -- `readModelLine` was answering correctly. The operator's
 * `~/.claude/settings.json` sets `statusLine` to a script of their own, so the
 * CLI paints that script's output where its footer would go and the shape the
 * footer reader checks for is not on the screen at all
 * (`CUSTOM_STATUS_LINE`, captured read-only from one of their live sessions).
 * A control whose one fact can be switched off by an unrelated setting needed
 * a second way to know, and the transcript is the CLI's own record of it.
 *
 * ── THE PRECEDENCE, AND THE ARGUMENT FOR IT ───────────────────────────────
 *
 * THE PAINTED FOOTER FIRST, THE TRANSCRIPT SECOND, because they answer two
 * different questions and only one of them is about NOW:
 *
 *  - the footer carries what the CLI is SET TO at this instant. Type `/model
 *    haiku` and it changes before the session has answered anything.
 *  - the transcript carries what the API actually SERVED on the last turn. It
 *    does not move until the session next answers, so a `/model` switch with
 *    no turn since leaves it naming the model before the switch.
 *
 * So the footer is fresher wherever it exists, and the transcript answers only
 * where it does not. The two arms are kept APART across the bridge --
 * `model` against `last-turn` -- rather than merged into one name, because
 * the surface says a different sentence for each: "running X" is a claim only
 * the footer can support.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { registerTerminalIpc } from '../../../src/main/terminal/ipc.js';
import { readSessionModel } from '../../../src/main/terminal/model.js';
import type { SessionModel } from '../../../src/shared/terminal.js';
import { CUSTOM_STATUS_LINE, OPUS_FRESH, PERMISSION_ASKING } from './model-status-screens.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const fail = (stderr: string): TmuxRunResult => ({
  failure: { message: stderr, code: 1 },
  stdout: '',
  stderr,
});

/** Invented, like every value here: a project digest and vam's own prefix. */
const PROJECT = 'p-atlas-1';
const PANE = 'vam-atlas-a1b2c3';
const LISTING = `${PROJECT}\t\t${PANE}\n`;
const ROW = 'sess-1#4242';
const PANES = new Map([[ROW, PANE]]);

/** tmux answering the listing, then the capture. */
const server =
  (screen: string, listing = LISTING): TmuxRun =>
  async (argv) =>
    argv[0] === 'list-sessions' ? ok(listing) : ok(screen);

/** A transcript reader that records the row it was asked about. */
function transcript(answer: string | null) {
  const asked: string[] = [];
  return {
    asked,
    read: async (rowId: string) => {
      asked.push(rowId);
      return answer;
    },
  };
}

describe('the painted footer is asked first', () => {
  it('names the model off the screen, and never opens a transcript at all', async () => {
    const { asked, read } = transcript('Haiku 4.5');
    expect(await readSessionModel(server(OPUS_FRESH), PROJECT, ROW, PANES, read)).toEqual({
      kind: 'model',
      name: 'Opus 5',
    });
    // NOT MERELY IGNORED -- NOT READ. The transcript read is a filesystem walk
    // on a four-second poll, and paying for an answer that cannot be used is
    // the shape that turns a fallback into a permanent cost.
    expect(asked).toEqual([]);
  });

  it('prefers the footer even when the transcript disagrees with it', async () => {
    // THE CASE THE ORDER EXISTS FOR: `/model` was just typed in the pane and
    // no turn has run since, so the footer says Opus and the last turn ran on
    // something else. The footer is the fresher fact.
    const { read } = transcript('Sonnet 5');
    expect(await readSessionModel(server(OPUS_FRESH), PROJECT, ROW, PANES, read)).toEqual({
      kind: 'model',
      name: 'Opus 5',
    });
  });
});

describe('the transcript answers when the footer cannot', () => {
  it('answers for a session whose status line the operator has replaced', async () => {
    // The whole defect, end to end: this screen is a real one.
    const { asked, read } = transcript('Opus 5');
    expect(await readSessionModel(server(CUSTOM_STATUS_LINE), PROJECT, ROW, PANES, read)).toEqual({
      kind: 'last-turn',
      name: 'Opus 5',
    });
    expect(asked).toEqual([ROW]);
  });

  it('answers for the commonest case of all -- a question over the footer', async () => {
    const { read } = transcript('Fable 5.1');
    expect(await readSessionModel(server(PERMISSION_ASKING), PROJECT, ROW, PANES, read)).toEqual({
      kind: 'last-turn',
      name: 'Fable 5.1',
    });
  });

  it('answers even when tmux itself could not be asked', async () => {
    // A TRANSCRIPT IS KEYED BY THE ROW'S OWN SESSION ID, not by a pane, so
    // none of the pane reader's four refusals bear on it. `model.ts` refuses a
    // pane it has not proven because a model read out of the WRONG pane would
    // be drawn on this row's button; there is no wrong-row hazard in reading
    // the file this row's session writes.
    const dead: TmuxRun = async () => fail('no server running');
    const { read } = transcript('Opus 5');
    expect(await readSessionModel(dead, PROJECT, ROW, PANES, read)).toEqual({
      kind: 'last-turn',
      name: 'Opus 5',
    });
  });

  it('answers for a row whose published pane names another project', async () => {
    // `mispaired`. The pane is refused and stays refused; the row's own
    // transcript is a different question.
    const { read } = transcript('Opus 5');
    const elsewhere = server(OPUS_FRESH, `p-other\t\t${PANE}\n`);
    expect(await readSessionModel(elsewhere, PROJECT, ROW, PANES, read)).toEqual({
      kind: 'last-turn',
      name: 'Opus 5',
    });
  });
});

describe('unknown stays reachable, which is the whole reason the button is trusted', () => {
  it('is unknown when neither source can tell', async () => {
    const { asked, read } = transcript(null);
    expect(await readSessionModel(server(PERMISSION_ASKING), PROJECT, ROW, PANES, read)).toEqual({
      kind: 'unknown',
    });
    expect(asked).toEqual([ROW]);
  });

  it('is unknown, and reads nothing, when there is no row to be a session', async () => {
    // Without a row id there is no session id, so there is no transcript to
    // look up -- a project is not a session.
    const { asked, read } = transcript('Opus 5');
    expect(
      await readSessionModel(server(PERMISSION_ASKING), PROJECT, undefined, undefined, read),
    ).toEqual({ kind: 'unknown' });
    expect(asked).toEqual([]);
  });

  it('is unknown when nobody wired a transcript reader in', async () => {
    // The default is "nobody asked", which is `source.ts`'s own rule for a
    // filesystem read: a caller that has not asked for one does not get a
    // surprise one.
    expect(await readSessionModel(server(PERMISSION_ASKING), PROJECT, ROW, PANES)).toEqual({
      kind: 'unknown',
    });
  });
});

describe('the channel carries the second arm across the bridge', () => {
  function harness(run: TmuxRun, read: (rowId: string) => Promise<string | null>) {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    registerTerminalIpc(
      { handle: (channel, handler) => void handlers.set(channel, handler) },
      run,
      async () => PANES,
      () => Date.now(),
      read,
    );
    const model = handlers.get(CHANNELS.terminalModel);
    if (model === undefined) throw new Error('the model channel was never registered');
    return model;
  }

  it('hands the renderer `last-turn` and the name, over the same one channel', async () => {
    const { asked, read } = transcript('Opus 5');
    const model = harness(server(CUSTOM_STATUS_LINE), read);
    expect(await model(null, PROJECT, ROW)).toEqual({ kind: 'last-turn', name: 'Opus 5' });
    expect(asked).toEqual([ROW]);
  });

  it('reads no transcript for an ask it refused by shape', async () => {
    const { asked, read } = transcript('Opus 5');
    const model = harness(server(CUSTOM_STATUS_LINE), read);
    const answer: SessionModel = (await model(null, 42, ROW)) as SessionModel;
    expect(answer).toEqual({ kind: 'unknown' });
    expect(asked).toEqual([]);
  });
});
