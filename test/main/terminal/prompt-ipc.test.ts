/**
 * The prompt channel across the bridge: the READ that makes answering a
 * permission prompt possible at all.
 *
 * It is a read, but it is not the Terminal tab's read. That one hands the
 * renderer a screen to draw; this one hands it a QUESTION -- a title and a
 * list of labels the card offers as options and sends straight back down the
 * answer channel. So the refusals matter as much as the prompt: `mispaired`
 * is a row whose published pane vam rejected and it must never fall through
 * to the project tag, which would show the operator another session's prompt
 * and then answer it for them.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { registerTerminalIpc } from '../../../src/main/terminal/ipc.js';
import { createTerminalApi } from '../../../src/preload/api.js';
import { BASH_PERMISSION } from './permission-screens.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const fail = (stderr: string): TmuxRunResult => ({
  failure: { message: stderr, code: 1 },
  stdout: '',
  stderr,
});

const ATLAS = 'claude-code:atlas-11111111';
/** Invented, like every value here: a project digest and vam's own prefix. */
const PROJECT = 'p-atlas-1';
const PANE = 'vam-atlas-a1b2c3';
const LISTING = `${PROJECT}\t${PANE}\n`;

function harness(run: TmuxRun, panes: ReadonlyMap<string, string> = new Map()) {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  registerTerminalIpc(
    { handle: (channel, handler) => void handlers.set(channel, handler) },
    run,
    async () => panes,
  );
  const prompt = handlers.get(CHANNELS.terminalPrompt);
  if (prompt === undefined) throw new Error('the prompt channel was never registered');
  return prompt;
}

/** tmux answering the listing, then the capture. */
const server = (screen: string): TmuxRun => {
  return async (argv) => (argv[0] === 'list-sessions' ? ok(LISTING) : ok(screen));
};

describe('the prompt handler', () => {
  it('reads the prompt in the pane the row is proven to be in', async () => {
    const prompt = harness(server(BASH_PERMISSION), new Map([['s1', PANE]]));
    expect(await prompt(null, PROJECT, 's1')).toEqual({
      kind: 'prompt',
      prompt: {
        title: 'Do you want to proceed?',
        options: [
          'Yes',
          'Yes, and do not ask again for scripts/rebuild-index.sh',
          'No, and tell the agent what to do differently',
        ],
      },
    });
  });

  it('answers `none` for a pane it read and found no prompt on', async () => {
    const prompt = harness(server('a session simply working\n'), new Map([['s1', PANE]]));
    expect(await prompt(null, PROJECT, 's1')).toEqual({ kind: 'none' });
  });

  it('refuses a row whose published pane is not the one tmux reports', async () => {
    // THE FALL-THROUGH THIS FORBIDS once resolved a healthy session the row
    // was never in. A published pane that disagrees is corruption, not
    // absence, so the tag path never gets its turn -- and the answer is
    // `mispaired`, which is vam having named a session and refused it, not
    // `unaimed`, which is vam not having named one.
    const prompt = harness(server(BASH_PERMISSION), new Map([['s1', 'vam-somewhere-else']]));
    expect(await prompt(null, PROJECT, 's1')).toEqual({ kind: 'mispaired' });
  });

  it('says `unavailable` when tmux itself could not be asked', async () => {
    const prompt = harness(async () => fail('tmux: command not found'));
    expect(await prompt(null, PROJECT, 's1')).toEqual({ kind: 'unavailable' });
  });

  it('says `unreadable` when the pairing held but the capture did not', async () => {
    const prompt = harness(
      async (argv) => (argv[0] === 'list-sessions' ? ok(LISTING) : fail("can't find pane")),
      new Map([['s1', PANE]]),
    );
    expect(await prompt(null, PROJECT, 's1')).toEqual({ kind: 'unreadable' });
  });

  it('refuses a malformed ask without asking tmux anything', async () => {
    const argvs: (readonly string[])[] = [];
    const prompt = harness(async (argv) => {
      argvs.push(argv);
      return ok(LISTING);
    });
    expect(await prompt(null, 7)).toEqual({ kind: 'unaimed' });
    expect(await prompt(null, 'x'.repeat(501))).toEqual({ kind: 'unaimed' });
    expect(await prompt(null, PROJECT, 's1', 'extra')).toEqual({ kind: 'unaimed' });
    expect(argvs).toEqual([]);
  });
});

describe('the preload member', () => {
  it('invokes the prompt channel, and passes a row id only when there is one', async () => {
    const calls: unknown[][] = [];
    const api = createTerminalApi({
      invoke: async (...args: unknown[]) => {
        calls.push(args);
        return { kind: 'none' };
      },
    });
    expect(await api.prompt(ATLAS)).toEqual({ kind: 'none' });
    await api.prompt(ATLAS, 's1');
    expect(calls).toEqual([
      [CHANNELS.terminalPrompt, ATLAS],
      [CHANNELS.terminalPrompt, ATLAS, 's1'],
    ]);
  });
});
