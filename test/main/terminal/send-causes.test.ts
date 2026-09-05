/**
 * The send channel must name the cause it actually hit.
 *
 * Three different facts reach the operator through one value: tmux could not
 * be asked at all, the row sits in a pane vam may not use, and vam could not
 * name a session of its own for this project. `TerminalTab` draws a separate
 * sentence for each, so flattening two of them into `unaimed` sends the
 * operator to check a pairing when tmux is not running. Asserted one cause at
 * a time -- a test that only checked "a refusal appeared" passes against the
 * bug. Nothing spawns; the runner is a fake.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import { registerTerminalIpc } from '../../../src/main/terminal/ipc.js';

const ATLAS = 'claude-code:atlas-11111111';
const BEACON = 'claude-code:beacon-22222222';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const missing: TmuxRunResult = {
  failure: { message: 'spawn tmux ENOENT', code: 'ENOENT' },
  stdout: '',
  stderr: '',
};

function sender(answer: TmuxRunResult, panes: ReadonlyMap<string, string>) {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const run: TmuxRun = async () => answer;
  registerTerminalIpc(
    { handle: (channel, listener) => void handlers.set(channel, listener) },
    run,
    async () => panes,
  );
  const send = handlers.get(CHANNELS.terminalSend);
  if (send === undefined) throw new Error('the send channel was never registered');
  return send;
}

describe('what the send channel calls its refusal', () => {
  it('says tmux is unavailable when it could not be asked at all', async () => {
    const send = sender(missing, new Map());
    // Not `unaimed`: nothing was aimed because nothing could be LISTED, and
    // there is no pairing for the operator to go and check.
    expect(await send({}, ATLAS, { kind: 'text', text: 'h' }, ATLAS)).toBe('unavailable');
  });

  it('says mispaired when the row published a pane of another project', async () => {
    const send = sender(
      ok(`${ATLAS}\tvam-atlas-a1b2c3\n${BEACON}\tvam-beacon-d4e5f6\n`),
      new Map([[ATLAS, 'vam-beacon-d4e5f6']]),
    );
    expect(await send({}, ATLAS, { kind: 'text', text: 'h' }, ATLAS)).toBe('mispaired');
  });

  it('keeps unaimed for the case it was written for: no session of vam’s own', async () => {
    const send = sender(ok(`${BEACON}\tvam-beacon-d4e5f6\n`), new Map());
    expect(await send({}, ATLAS, { kind: 'text', text: 'h' }, ATLAS)).toBe('unaimed');
  });
});
