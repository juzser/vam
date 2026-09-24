/**
 * The Terminal tab's streaming IPC -- open/close/write, resolved by the SAME
 * `listVamSessions`+`targetSession` pairing `terminal/ipc.ts`'s own read/send
 * channels use, with a `tmux -V` minimum-version gate in front of it.
 *
 * Nothing here spawns a real `StreamClient`: `createClient` is injected, so
 * what is asserted is the RESOLUTION and the WIRING (push channels, the
 * open/close/write round trip), not the client's own protocol handling
 * (`tmux-stream-client.test.ts` covers that).
 */

import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import type { StreamClient } from '../../../src/main/terminal/stream/client.js';
import { registerTerminalStreamIpc } from '../../../src/main/terminal/stream-ipc.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const failed = (stderr: string): TmuxRunResult => ({
  failure: { message: 'tmux failed' },
  stdout: '',
  stderr,
});

const ATLAS = 'claude-code:atlas-11111111';

/** Records every argv and answers by verb -- `-V` and `list-sessions`. */
function runner(answers: Record<string, TmuxRunResult>) {
  const argvs: (readonly string[])[] = [];
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    const verb = argv[0] ?? '';
    return answers[verb] ?? failed(`no stub for ${verb}`);
  };
  return { run, argvs };
}

/** A fake `IpcMainLike` that records handlers by channel so a test can call
 * them directly, exactly the way `registerTerminalIpc`'s own tests do. */
function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return {
    ipcMain: {
      handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
        handlers.set(channel, listener);
      },
    },
    call: (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (handler === undefined) throw new Error(`no handler registered for ${channel}`);
      return handler(undefined, ...args);
    },
  };
}

function fakeWebContents() {
  const sent: { channel: string; args: unknown[] }[] = [];
  return {
    webContents: { send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }) },
    sent,
  };
}

/** A fake `StreamClient` shape, only the four members `stream-ipc.ts` calls. */
function fakeClient(seed = 'seed-text') {
  const dataListeners: ((chunk: string) => void)[] = [];
  const seedListeners: ((seed: string) => void)[] = [];
  // `unknown`, not `StreamDownEvent`: this test file asserts the WIRING
  // (main forwards whatever `StreamClient` hands it), not `StreamClient`'s
  // own event shape, so it never imports that type -- `tmux-stream-
  // client.test.ts` is where `StreamDownEvent`'s own shape is pinned.
  const downListeners: ((event: unknown) => void)[] = [];
  const written: string[] = [];
  let disposed = false;
  const client = {
    onData: (l: (chunk: string) => void) => {
      dataListeners.push(l);
      return () => {};
    },
    onSeed: (l: (seed: string) => void) => {
      seedListeners.push(l);
      return () => {};
    },
    onDown: (l: (event: unknown) => void) => {
      downListeners.push(l);
      return () => {};
    },
    connect: async () => seed,
    write: (text: string) => written.push(text),
    dispose: () => {
      disposed = true;
    },
  } as unknown as StreamClient;
  return {
    client,
    dataListeners,
    seedListeners,
    downListeners,
    written,
    isDisposed: () => disposed,
  };
}

const TMUX_VERSION_OK = ok('tmux 3.7b\n');
const LIST_ONE = ok(`${ATLAS}\t\tvam-atlas-a1b2c3\n`);

describe('registerTerminalStreamIpc', () => {
  it('opens a stream for a resolvable session and returns its seed', async () => {
    const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const fake = fakeClient('hello-screen');
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

    const result = await call(CHANNELS.terminalStreamOpen, ATLAS);
    expect(result).toMatchObject({ ok: true, seed: 'hello-screen' });
  });

  it('pushes data/seed/down through webContents.send, keyed by streamId', async () => {
    const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents, sent } = fakeWebContents();
    const fake = fakeClient();
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

    const opened = (await call(CHANNELS.terminalStreamOpen, ATLAS)) as {
      ok: true;
      streamId: string;
    };
    fake.dataListeners[0]?.('a chunk');
    fake.seedListeners[0]?.('a fresh seed');
    fake.downListeners[0]?.({ kind: 'reconnecting', attempt: 1 });

    expect(sent).toContainEqual({
      channel: CHANNELS.terminalStreamData,
      args: [opened.streamId, 'a chunk'],
    });
    expect(sent).toContainEqual({
      channel: CHANNELS.terminalStreamSeed,
      args: [opened.streamId, 'a fresh seed'],
    });
    // THE EVENT ITSELF RIDES ALONG (a review finding: this used to be
    // payload-free, so a renderer had no way to tell "still trying" apart
    // from "gave up for good").
    expect(sent).toContainEqual({
      channel: CHANNELS.terminalStreamDown,
      args: [opened.streamId, { kind: 'reconnecting', attempt: 1 }],
    });
  });

  it('write decodes the bridged Uint8Array back to text and forwards it', async () => {
    const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const fake = fakeClient();
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

    const opened = (await call(CHANNELS.terminalStreamOpen, ATLAS)) as {
      ok: true;
      streamId: string;
    };
    const bytes = new TextEncoder().encode('héllo');
    await call(CHANNELS.terminalStreamWrite, opened.streamId, bytes);

    expect(fake.written).toEqual(['héllo']);
  });

  it('close disposes the client and is idempotent for an unknown id', async () => {
    const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const fake = fakeClient();
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

    const opened = (await call(CHANNELS.terminalStreamOpen, ATLAS)) as {
      ok: true;
      streamId: string;
    };
    await call(CHANNELS.terminalStreamClose, opened.streamId);
    expect(fake.isDisposed()).toBe(true);

    await expect(call(CHANNELS.terminalStreamClose, 'unknown-id')).resolves.toBe(true);
  });

  it('refuses below the minimum tmux version without ever creating a client', async () => {
    const { run } = runner({ '-V': ok('tmux 2.9\n'), 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const createClient = vi.fn(() => fakeClient().client);
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient });

    const result = await call(CHANNELS.terminalStreamOpen, ATLAS);
    expect(result).toEqual({ ok: false, reason: 'unsupported-tmux' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('allows exactly the minimum tmux version', async () => {
    const { run } = runner({ '-V': ok('tmux 3.2\n'), 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const fake = fakeClient();
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

    const result = await call(CHANNELS.terminalStreamOpen, ATLAS);
    expect(result).toMatchObject({ ok: true });
  });

  it('refuses when targetSession cannot resolve one session (none)', async () => {
    const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': ok('') });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const createClient = vi.fn(() => fakeClient().client);
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient });

    const result = await call(CHANNELS.terminalStreamOpen, ATLAS);
    expect(result).toEqual({ ok: false, reason: 'unresolved-session' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('refuses a malformed request without asking tmux anything', async () => {
    const { run, argvs } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    registerTerminalStreamIpc(ipcMain, webContents, run, {});

    const result = await call(CHANNELS.terminalStreamOpen, 123);
    expect(result).toEqual({ ok: false, reason: 'bad-request' });
    expect(argvs).toEqual([]);
  });

  it('dispose() disposes every open client', async () => {
    const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const fake = fakeClient();
    const registration = registerTerminalStreamIpc(ipcMain, webContents, run, {
      createClient: () => fake.client,
    });

    await call(CHANNELS.terminalStreamOpen, ATLAS);
    registration.dispose();
    expect(fake.isDisposed()).toBe(true);
  });
});
