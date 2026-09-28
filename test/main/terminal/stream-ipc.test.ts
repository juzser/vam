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
import {
  MAX_STREAM_WRITE_BYTES,
  registerTerminalStreamIpc,
} from '../../../src/main/terminal/stream-ipc.js';

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

  it('returns the resolved tmux session name alongside the seed -- what TerminalStreamTab draws on its status rule, the same name TerminalTab reads off `view.name`', async () => {
    const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const fake = fakeClient('hello-screen');
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

    const result = await call(CHANNELS.terminalStreamOpen, ATLAS);
    expect(result).toMatchObject({ ok: true, name: 'vam-atlas-a1b2c3' });
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

  it('ignores a write over MAX_STREAM_WRITE_BYTES rather than forwarding it', async () => {
    // A paste is the one caller that could ever hand this channel more than a
    // few bytes at once (`TerminalStreamTab.tsx`'s paste listener); the
    // renderer already truncates at `MAX_PASTE_TEXT` before it ever gets this
    // far, but the renderer is the least trusted process in the app, so the
    // bound is checked here too rather than only there.
    const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const fake = fakeClient();
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

    const opened = (await call(CHANNELS.terminalStreamOpen, ATLAS)) as {
      ok: true;
      streamId: string;
    };
    const tooBig = new Uint8Array(MAX_STREAM_WRITE_BYTES + 1);
    await call(CHANNELS.terminalStreamWrite, opened.streamId, tooBig);

    expect(fake.written).toEqual([]);
  });

  it('still forwards a write right at the bound', async () => {
    const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const fake = fakeClient();
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

    const opened = (await call(CHANNELS.terminalStreamOpen, ATLAS)) as {
      ok: true;
      streamId: string;
    };
    const atBound = new TextEncoder().encode('a'.repeat(MAX_STREAM_WRITE_BYTES));
    await call(CHANNELS.terminalStreamWrite, opened.streamId, atBound);

    expect(fake.written).toEqual(['a'.repeat(MAX_STREAM_WRITE_BYTES)]);
  });

  it('paste delivers the sanitized text through tmux paste-buffer -p, targeting the resolved session (the S2 fix: tmux itself decides bracketing, never this bridge)', async () => {
    const { run, argvs } = runner({
      '-V': TMUX_VERSION_OK,
      'list-sessions': LIST_ONE,
      'set-buffer': ok(''),
      'paste-buffer': ok(''),
    });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const fake = fakeClient();
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

    const opened = (await call(CHANNELS.terminalStreamOpen, ATLAS)) as {
      ok: true;
      streamId: string;
    };
    const bytes = new TextEncoder().encode('héllo');
    await call(CHANNELS.terminalStreamPaste, opened.streamId, bytes);

    const setBufferStep = argvs.find((argv) => argv[0] === 'set-buffer');
    expect(setBufferStep?.at(-1)).toBe('héllo');
    const pasteStep = argvs.find((argv) => argv[0] === 'paste-buffer');
    expect(pasteStep).toBeDefined();
    // `-p`: the whole reason this channel exists, over `terminalStreamWrite`.
    expect(pasteStep).toContain('-p');
    // `=<name>:` -- `paneTarget`'s own shape, targeting the SAME session
    // `terminalStreamOpen` resolved, never a name this bridge re-derives.
    expect(pasteStep?.at(-1)).toBe('=vam-atlas-a1b2c3:');
  });

  it('a paste that fails on its LAST step (paste-buffer itself) best-effort deletes its own orphaned buffer (review finding: a failed step used to leave the buffer on the tmux server forever)', async () => {
    const { run, argvs } = runner({
      '-V': TMUX_VERSION_OK,
      'list-sessions': LIST_ONE,
      'set-buffer': ok(''),
      'paste-buffer': failed('no such buffer'),
      'delete-buffer': ok(''),
    });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const fake = fakeClient();
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

    const opened = (await call(CHANNELS.terminalStreamOpen, ATLAS)) as {
      ok: true;
      streamId: string;
    };
    await call(CHANNELS.terminalStreamPaste, opened.streamId, new TextEncoder().encode('hello'));

    const setBufferStep = argvs.find((argv) => argv[0] === 'set-buffer');
    const bufferName = setBufferStep?.[2];
    expect(bufferName).toBeDefined();
    const deleteStep = argvs.find((argv) => argv[0] === 'delete-buffer');
    expect(deleteStep).toEqual(['delete-buffer', '-b', bufferName]);
  });

  it('a paste that fails on an EARLIER step (a later set-buffer chunk) still best-effort deletes the buffer', async () => {
    let setBufferCalls = 0;
    const argvs: (readonly string[])[] = [];
    const run: TmuxRun = async (argv) => {
      argvs.push(argv);
      const verb = argv[0] ?? '';
      if (verb === '-V') return TMUX_VERSION_OK;
      if (verb === 'list-sessions') return LIST_ONE;
      if (verb === 'set-buffer') {
        setBufferCalls += 1;
        // The FIRST chunk succeeds (the buffer now exists on the server),
        // the second (an `-a` append) fails -- the shape a paste too large
        // for one `set-buffer` call can hit partway through.
        return setBufferCalls === 1 ? ok('') : failed('tmux: server exited');
      }
      if (verb === 'delete-buffer') return ok('');
      return failed(`no stub for ${verb}`);
    };
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const fake = fakeClient();
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

    const opened = (await call(CHANNELS.terminalStreamOpen, ATLAS)) as {
      ok: true;
      streamId: string;
    };
    // Long enough (over the 8192-byte default chunk) to force a second
    // `set-buffer` chunk.
    await call(
      CHANNELS.terminalStreamPaste,
      opened.streamId,
      new TextEncoder().encode('x'.repeat(9000)),
    );

    const sets = argvs.filter((argv) => argv[0] === 'set-buffer');
    expect(sets.length).toBeGreaterThan(1);
    const bufferName = sets[0]?.[2];
    const deleteStep = argvs.find((argv) => argv[0] === 'delete-buffer');
    expect(deleteStep).toEqual(['delete-buffer', '-b', bufferName]);
    // Never reached `paste-buffer` -- the earlier failure stopped it.
    expect(argvs.some((argv) => argv[0] === 'paste-buffer')).toBe(false);
  });

  it("a successful paste never calls delete-buffer -- paste-buffer's own -d already cleaned it up", async () => {
    const { run, argvs } = runner({
      '-V': TMUX_VERSION_OK,
      'list-sessions': LIST_ONE,
      'set-buffer': ok(''),
      'paste-buffer': ok(''),
    });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const fake = fakeClient();
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

    const opened = (await call(CHANNELS.terminalStreamOpen, ATLAS)) as {
      ok: true;
      streamId: string;
    };
    await call(CHANNELS.terminalStreamPaste, opened.streamId, new TextEncoder().encode('hello'));

    expect(argvs.some((argv) => argv[0] === 'delete-buffer')).toBe(false);
  });

  it('ignores a paste for an unknown/closed streamId, same posture as write', async () => {
    const { run, argvs } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    registerTerminalStreamIpc(ipcMain, webContents, run, {});

    const bytes = new TextEncoder().encode('hello');
    await call(CHANNELS.terminalStreamPaste, 'unknown-id', bytes);

    expect(argvs.some((argv) => argv[0] === 'set-buffer' || argv[0] === 'paste-buffer')).toBe(
      false,
    );
  });

  it('ignores a paste over MAX_STREAM_WRITE_BYTES rather than forwarding it', async () => {
    const { run, argvs } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const fake = fakeClient();
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

    const opened = (await call(CHANNELS.terminalStreamOpen, ATLAS)) as {
      ok: true;
      streamId: string;
    };
    const tooBig = new Uint8Array(MAX_STREAM_WRITE_BYTES + 1);
    await call(CHANNELS.terminalStreamPaste, opened.streamId, tooBig);

    expect(argvs.some((argv) => argv[0] === 'set-buffer' || argv[0] === 'paste-buffer')).toBe(
      false,
    );
  });

  it('a stream closed after opening refuses a later paste too', async () => {
    const { run, argvs } = runner({
      '-V': TMUX_VERSION_OK,
      'list-sessions': LIST_ONE,
      'set-buffer': ok(''),
      'paste-buffer': ok(''),
    });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const fake = fakeClient();
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

    const opened = (await call(CHANNELS.terminalStreamOpen, ATLAS)) as {
      ok: true;
      streamId: string;
    };
    await call(CHANNELS.terminalStreamClose, opened.streamId);
    argvs.length = 0;
    await call(CHANNELS.terminalStreamPaste, opened.streamId, new TextEncoder().encode('hello'));

    expect(argvs).toEqual([]);
  });

  describe('paste/write ordering (review finding: paste and write travel on different transports with no ordering guarantee)', () => {
    /** A `run` whose `set-buffer` answer does not settle until the test
     *  releases `gate` -- standing in for `sendPasteArgv`'s own real
     *  `execFile` spawns actually taking real wall-clock time, unlike
     *  `StreamClient#write`'s synchronous stdin write. */
    function deferredRunner() {
      const argvs: (readonly string[])[] = [];
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const run: TmuxRun = async (argv) => {
        argvs.push(argv);
        const verb = argv[0] ?? '';
        if (verb === '-V') return TMUX_VERSION_OK;
        if (verb === 'list-sessions') return LIST_ONE;
        if (verb === 'set-buffer') {
          await gate;
          return ok('');
        }
        if (verb === 'paste-buffer') return ok('');
        return failed(`no stub for ${verb}`);
      };
      return { run, argvs, release: () => release?.() };
    }

    it('a write arriving while a paste is still in flight is queued behind it, not sent immediately', async () => {
      const { run, release } = deferredRunner();
      const { ipcMain, call } = fakeIpcMain();
      const { webContents } = fakeWebContents();
      const fake = fakeClient();
      registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

      const opened = (await call(CHANNELS.terminalStreamOpen, ATLAS)) as {
        ok: true;
        streamId: string;
      };

      // Mirrors the operator's own report: paste, then Enter, back to back.
      const pastePromise = call(
        CHANNELS.terminalStreamPaste,
        opened.streamId,
        new TextEncoder().encode('pasted text'),
      );
      // Let the paste's own microtasks run far enough to reach the gated
      // `set-buffer` call before the write arrives.
      await Promise.resolve();
      await Promise.resolve();
      const writePromise = call(
        CHANNELS.terminalStreamWrite,
        opened.streamId,
        new TextEncoder().encode('\r'),
      );
      // Give the write's own handler a chance to run to completion IF it
      // were (wrongly) on the synchronous fast path.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(fake.written).toEqual([]);

      release();
      await pastePromise;
      await writePromise;

      expect(fake.written).toEqual(['\r']);
    });

    it('a write with no paste pending goes straight to the client, on the synchronous fast path', async () => {
      const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents } = fakeWebContents();
      const fake = fakeClient();
      registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

      const opened = (await call(CHANNELS.terminalStreamOpen, ATLAS)) as {
        ok: true;
        streamId: string;
      };
      // No `await` on the write's own returned promise -- the fast path must
      // already have called `client.write` synchronously, before this
      // handler's own promise needs even one microtask to settle.
      void call(CHANNELS.terminalStreamWrite, opened.streamId, new TextEncoder().encode('x'));

      expect(fake.written).toEqual(['x']);
    });

    it('two pastes fired back to back still run in arrival order, the second never touching tmux until the first is done', async () => {
      const argvs: (readonly string[])[] = [];
      let releaseFirst: (() => void) | undefined;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let setBufferCalls = 0;
      const run: TmuxRun = async (argv) => {
        argvs.push(argv);
        const verb = argv[0] ?? '';
        if (verb === '-V') return TMUX_VERSION_OK;
        if (verb === 'list-sessions') return LIST_ONE;
        if (verb === 'set-buffer') {
          setBufferCalls += 1;
          // Only the FIRST paste's own `set-buffer` is held -- a real second
          // paste arriving mid-flight must queue behind it rather than race
          // it, exactly the shape "paste, paste again" (or a very fast
          // double-paste) would hit.
          if (setBufferCalls === 1) await firstGate;
          return ok('');
        }
        if (verb === 'paste-buffer') return ok('');
        return failed(`no stub for ${verb}`);
      };
      const { ipcMain, call } = fakeIpcMain();
      const { webContents } = fakeWebContents();
      const fake = fakeClient();
      registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

      const opened = (await call(CHANNELS.terminalStreamOpen, ATLAS)) as {
        ok: true;
        streamId: string;
      };
      const firstPaste = call(
        CHANNELS.terminalStreamPaste,
        opened.streamId,
        new TextEncoder().encode('first'),
      );
      await Promise.resolve();
      await Promise.resolve();
      const secondPaste = call(
        CHANNELS.terminalStreamPaste,
        opened.streamId,
        new TextEncoder().encode('second'),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // The SECOND paste must not have reached tmux at all yet -- it is
      // queued behind the first, still gated.
      expect(argvs.filter((argv) => argv[0] === 'set-buffer')).toHaveLength(1);

      releaseFirst?.();
      await firstPaste;
      await secondPaste;

      const sets = argvs.filter((argv) => argv[0] === 'set-buffer');
      expect(sets.map((step) => step.at(-1))).toEqual(['first', 'second']);
    });
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
