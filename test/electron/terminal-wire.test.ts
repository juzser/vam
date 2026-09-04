/**
 * The Terminal bridge, END TO END across the seam: the PRODUCTION preload
 * adapter invoking the PRODUCTION main handlers, with only tmux faked.
 *
 * WHY THIS EXISTS. The two halves were wired together by hand and every test
 * stood on one side of the join. The renderer's tests inject their own `send`,
 * so they never see `createTerminalApi`; main's tests reach into the handler
 * map and call the listener directly, so they never see the channel name or
 * the argument order the preload actually uses. Between them sat the one
 * thing neither could fail on: `send` could invoke the RESIZE channel, drop
 * `rowId`, or swap its arguments, and a suite named "a keystroke reaches
 * tmux" would stay entirely green while typing went to the wrong session or
 * nowhere.
 *
 * Nothing spawns. `TmuxRun` is a fake and the argv is asserted by value --
 * the machine this runs on has live agents in real panes.
 */

import { describe, expect, it } from 'vitest';
import type { TmuxRun, TmuxRunResult } from '../../src/main/sources/tmux/spawn.js';
import { registerTerminalIpc } from '../../src/main/terminal/ipc.js';
import { createTerminalApi, type InvokerLike } from '../../src/preload/api.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });

const ATLAS = 'claude-code:atlas-11111111';
/** Two sessions vam started for ONE project: only the row can say which. */
const TWO = `${ATLAS}\tvam-atlas-a1b2c3\n${ATLAS}\tvam-atlas-g7h8i9\n`;

/**
 * The real preload API, talking to the real main handlers over a fake
 * `ipcRenderer`. The only fakes are the tmux runner and the published-panes
 * file, which are the two things a test may not touch on this machine.
 */
function wire(stdout: string, panes: ReadonlyMap<string, string>) {
  const argvs: (readonly string[])[] = [];
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    return ok(argv[0] === 'list-sessions' ? stdout : '');
  };
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  registerTerminalIpc(
    { handle: (channel, listener) => void handlers.set(channel, listener) },
    run,
    async () => panes,
  );
  const ipc: InvokerLike = {
    invoke: async (channel, ...args) => {
      const handler = handlers.get(channel);
      // A channel main never registered is exactly the bug this file is for.
      if (handler === undefined) throw new Error(`no main handler for ${channel}`);
      return handler({}, ...args);
    },
  };
  return { api: createTerminalApi(ipc), argvs };
}

describe('the preload terminal bridge reaches the handlers it names', () => {
  it('carries a keystroke to the pane the ROW published, argument order and all', async () => {
    const { api, argvs } = wire(TWO, new Map([[ATLAS, 'vam-atlas-g7h8i9']]));
    expect(await api.send(ATLAS, { kind: 'text', text: 'h' }, ATLAS)).toBe('sent');
    // The literal send, aimed at the SECOND session -- which is only
    // reachable if `rowId` survived the crossing. Dropping it leaves the
    // project alone to answer, and a project with two sessions cannot.
    expect(argvs[1]).toEqual(['send-keys', '-t', '=vam-atlas-g7h8i9:', '-l', '--', 'h']);
  });

  it('carries Return and Backspace as the interpreted keys they are', async () => {
    const { api, argvs } = wire(TWO, new Map([[ATLAS, 'vam-atlas-a1b2c3']]));
    await api.send(ATLAS, { kind: 'enter' }, ATLAS);
    await api.send(ATLAS, { kind: 'backspace' }, ATLAS);
    expect(argvs[1]).toEqual(['send-keys', '-t', '=vam-atlas-a1b2c3:', 'Enter']);
    expect(argvs[3]).toEqual(['send-keys', '-t', '=vam-atlas-a1b2c3:', 'BSpace']);
  });

  it('sends without a row too, where the project alone can answer', async () => {
    const { api, argvs } = wire(`${ATLAS}\tvam-atlas-a1b2c3\n`, new Map());
    expect(await api.send(ATLAS, { kind: 'text', text: 'h' })).toBe('sent');
    expect(argvs[1]).toEqual(['send-keys', '-t', '=vam-atlas-a1b2c3:', '-l', '--', 'h']);
  });

  it('does not reach a resize when it was asked to type', async () => {
    // The mutation this is aimed at: `send` invoking the resize channel. The
    // renderer would see a boolean either way.
    const { api, argvs } = wire(`${ATLAS}\tvam-atlas-a1b2c3\n`, new Map());
    await api.send(ATLAS, { kind: 'text', text: 'h' });
    expect(argvs.map((argv) => argv[0])).toEqual(['list-sessions', 'send-keys']);
  });

  it('and the resize channel still resizes, in columns then rows', async () => {
    const { api, argvs } = wire(`${ATLAS}\tvam-atlas-a1b2c3\n`, new Map());
    expect(await api.resize(ATLAS, 120, 40)).toBe(true);
    expect(argvs[1]).toEqual([
      'resize-window',
      '-t',
      '=vam-atlas-a1b2c3:',
      '-x',
      '120',
      '-y',
      '40',
    ]);
  });

  it('reads the screen of the pane the row published', async () => {
    const { api, argvs } = wire(TWO, new Map([[ATLAS, 'vam-atlas-g7h8i9']]));
    const view = await api.read(ATLAS, ATLAS);
    expect(view.kind === 'ok' ? view.name : view.kind).toBe('vam-atlas-g7h8i9');
    expect(argvs[1]).toEqual(['capture-pane', '-p', '-t', '=vam-atlas-g7h8i9:']);
  });

  it('answers `unaimed`, having sent nothing, when the renderer asks with rubbish', async () => {
    const { api, argvs } = wire(TWO, new Map());
    // The preload does not validate; main does, and this is the path that
    // proves the renderer cannot reach tmux around it.
    expect(await api.send(ATLAS, { kind: 'text', text: '' } as never, ATLAS)).toBe('unaimed');
    expect(argvs).toHaveLength(0);
  });
});
