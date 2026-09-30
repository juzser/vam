/**
 * Finding 546486bb (S2-major, performance): main counts unacknowledged
 * forwarded `terminalStreamData` bytes per stream, stops forwarding at a
 * high-water mark, and resyncs the pane (a fresh `StreamClient` + a pushed
 * `terminalStreamSeed`) once the renderer's acks bring the count back down.
 *
 * This test plays the RENDERER's own part directly -- invoking the captured
 * `terminalStreamAck` handler -- since preload/renderer wiring (task-9) is
 * out of scope for this task.
 */

import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';
import type { StreamClient } from '../../../src/main/terminal/stream/client.js';
import {
  MAX_HELD_STREAM_WRITE_BYTES,
  registerTerminalStreamIpc,
  STREAM_UNACKED_HIGH_WATER_BYTES,
  STREAM_UNACKED_LOW_WATER_BYTES,
} from '../../../src/main/terminal/stream-ipc.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });

const ATLAS = 'claude-code:atlas-11111111';
const TMUX_VERSION_OK = ok('tmux 3.7b\n');
const LIST_ONE = ok(`${ATLAS}\t\tvam-atlas-a1b2c3\n`);

function runner(answers: Record<string, TmuxRunResult>) {
  const argvs: (readonly string[])[] = [];
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    const verb = argv[0] ?? '';
    return answers[verb] ?? { failure: { message: 'no stub' }, stdout: '', stderr: '' };
  };
  return { run, argvs };
}

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

/**
 * A fake `StreamClient` whose `connect()` is caller-controlled -- resolves
 * or rejects only when the test tells it to, never on a real tick or timer,
 * so every ordering in this file is driven by hand.
 */
function fakeClient(label: string, log: string[]) {
  const dataListeners: ((chunk: string) => void)[] = [];
  const seedListeners: ((seed: string) => void)[] = [];
  const downListeners: ((event: unknown) => void)[] = [];
  const written: string[] = [];
  let disposeCount = 0;
  let resolveConnect: ((seed: string) => void) | undefined;
  let rejectConnect: ((err: unknown) => void) | undefined;
  // Resolves the instant `connect()` is CALLED -- awaiting this, rather than
  // a fixed number of `Promise.resolve()` ticks, pumps the microtask queue
  // through however many hops `registerTerminalStreamIpc`'s own resolution/
  // resync path needs before it reaches this client's own `connect()`, so a
  // test never has to guess (or under-guess) that number by hand.
  let connectCalledResolve: (() => void) | undefined;
  const connectCalled = new Promise<void>((resolve) => {
    connectCalledResolve = resolve;
  });
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
    connect: () => {
      connectCalledResolve?.();
      return new Promise<string>((resolve, reject) => {
        resolveConnect = (seed) => resolve(seed);
        rejectConnect = (err) => reject(err);
      });
    },
    write: (text: string) => {
      written.push(text);
      log.push(`write:${label}:${text}`);
    },
    dispose: () => {
      disposeCount += 1;
      log.push(`dispose:${label}`);
    },
  } as unknown as StreamClient;
  return {
    client,
    label,
    dataListeners,
    seedListeners,
    downListeners,
    written,
    disposeCount: () => disposeCount,
    connectCalled,
    resolveConnect: (seed = `${label}-seed`) => resolveConnect?.(seed),
    rejectConnect: (err: unknown = new Error('gone')) => rejectConnect?.(err),
  };
}

describe('registerTerminalStreamIpc -- backpressure (finding 546486bb)', () => {
  it('AC1: stops forwarding at the high-water mark, dropping the rest', async () => {
    const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents, sent } = fakeWebContents();
    const log: string[] = [];
    const fake = fakeClient('c1', log);
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

    // `connect()` on open must resolve for the stream to exist at all.
    const openPromise = call(CHANNELS.terminalStreamOpen, ATLAS);
    await fake.connectCalled;
    fake.resolveConnect('seed');
    const opened = (await openPromise) as { ok: true; streamId: string };
    const streamId = opened.streamId;

    const CHUNK = 64 * 1024; // 64KiB
    const chunk = 'x'.repeat(CHUNK);
    for (let i = 0; i < 64; i += 1) {
      fake.dataListeners[0]?.(chunk);
    }

    const dataSends = sent.filter(
      (s) => s.channel === CHANNELS.terminalStreamData && s.args[0] === streamId,
    );
    const totalBytesSent = dataSends.length * CHUNK;

    // At main 6b0a7a6c (no bound at all): 64 sends, 4MiB (64 * 64KiB) total.
    // With the bound: capped at STREAM_UNACKED_HIGH_WATER_BYTES (2MiB) ==
    // 32 chunks of 64KiB each, and no more.
    expect(dataSends.length).toBeLessThanOrEqual(32);
    expect(dataSends.length).toBe(STREAM_UNACKED_HIGH_WATER_BYTES / CHUNK);
    expect(totalBytesSent).toBe(STREAM_UNACKED_HIGH_WATER_BYTES);
    expect(totalBytesSent).toBeLessThan(64 * CHUNK); // 4MiB flooded, not all forwarded.
  });

  it('AC2: an ack down to the low-water mark queues exactly one resync, swaps the client, reseeds, and resumes forwarding', async () => {
    const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents, sent } = fakeWebContents();
    const log: string[] = [];
    const fake1 = fakeClient('c1', log);
    let created = 0;
    const clients = [fake1];
    const createClient = vi.fn(() => {
      created += 1;
      return clients[created - 1]?.client ?? fake1.client;
    });
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient });

    const openPromise = call(CHANNELS.terminalStreamOpen, ATLAS);
    await fake1.connectCalled;
    fake1.resolveConnect('seed');
    const opened = (await openPromise) as { ok: true; streamId: string };
    const streamId = opened.streamId;
    expect(created).toBe(1);

    // Flood past the high-water mark so main starts dropping.
    const CHUNK = 64 * 1024;
    for (let i = 0; i < 64; i += 1) fake1.dataListeners[0]?.('x'.repeat(CHUNK));
    const forwardedBytes = STREAM_UNACKED_HIGH_WATER_BYTES;

    // Ack down to the low-water mark.
    const toAck = forwardedBytes - STREAM_UNACKED_LOW_WATER_BYTES;
    const fake2 = fakeClient('c2', log);
    clients.push(fake2);
    createClient.mockImplementation(() => {
      created += 1;
      return created === 1 ? fake1.client : fake2.client;
    });
    const ackPromise = call(CHANNELS.terminalStreamAck, streamId, toAck);

    // The resync queues on `pending` and runs at once (nothing else queued).
    // Awaiting the replacement's own `connectCalled` pumps the microtask
    // queue through however many hops it takes to reach the point of
    // disposing the old client and creating the replacement.
    await fake2.connectCalled;
    expect(fake1.disposeCount()).toBe(1);
    expect(created).toBe(2);

    fake2.resolveConnect('resync-seed');
    await ackPromise;

    const seedSends = sent.filter(
      (s) => s.channel === CHANNELS.terminalStreamSeed && s.args[0] === streamId,
    );
    expect(seedSends).toHaveLength(1);
    expect(seedSends[0]?.args[1]).toBe('resync-seed');

    // Post-swap chunks forward again -- through the NEW client's listener.
    fake2.dataListeners[0]?.('after-swap');
    expect(
      sent.some(
        (s) =>
          s.channel === CHANNELS.terminalStreamData &&
          s.args[0] === streamId &&
          s.args[1] === 'after-swap',
      ),
    ).toBe(true);

    // The OLD (disposed) client's post-swap chunks never reach the renderer.
    const beforeCount = sent.length;
    fake1.dataListeners[0]?.('stale-chunk');
    expect(sent.length).toBe(beforeCount);

    // A second ack while nothing is dropping does not start a second resync.
    await call(CHANNELS.terminalStreamAck, streamId, 1);
    expect(created).toBe(2);
  });

  it('AC2: a second ack while a resync is already in flight does not start a second resync', async () => {
    const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents } = fakeWebContents();
    const log: string[] = [];
    const fake1 = fakeClient('c1', log);
    const fake2 = fakeClient('c2', log);
    let created = 0;
    const createClient = vi.fn(() => {
      created += 1;
      return created === 1 ? fake1.client : fake2.client;
    });
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient });

    const openPromise = call(CHANNELS.terminalStreamOpen, ATLAS);
    await fake1.connectCalled;
    fake1.resolveConnect('seed');
    const opened = (await openPromise) as { ok: true; streamId: string };
    const streamId = opened.streamId;

    for (let i = 0; i < 64; i += 1) fake1.dataListeners[0]?.('x'.repeat(64 * 1024));
    const toAck = STREAM_UNACKED_HIGH_WATER_BYTES - STREAM_UNACKED_LOW_WATER_BYTES;

    const ack1 = call(CHANNELS.terminalStreamAck, streamId, toAck);
    // A second ack, still while the resync's own connect() has not settled.
    const ack2 = call(CHANNELS.terminalStreamAck, streamId, 0);
    await fake2.connectCalled;

    expect(created).toBe(2); // Only ONE replacement created.

    fake2.resolveConnect('resync-seed');
    await ack1;
    await ack2;
    expect(created).toBe(2);
  });

  it('AC2: the swap does not reset the unacked count -- an ack of residue r plus the replacement c bytes keeps the stream open', async () => {
    const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const { webContents, sent } = fakeWebContents();
    const log: string[] = [];
    const fake1 = fakeClient('c1', log);
    const fake2 = fakeClient('c2', log);
    let created = 0;
    const createClient = vi.fn(() => {
      created += 1;
      return created === 1 ? fake1.client : fake2.client;
    });
    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient });

    const openPromise = call(CHANNELS.terminalStreamOpen, ATLAS);
    await fake1.connectCalled;
    fake1.resolveConnect('seed');
    const opened = (await openPromise) as { ok: true; streamId: string };
    const streamId = opened.streamId;

    const dataSends = (): unknown[] =>
      sent
        .filter((s) => s.channel === CHANNELS.terminalStreamData && s.args[0] === streamId)
        .map((s) => s.args[1]);

    // Flood past the high-water mark so main starts dropping.
    const CHUNK = 64 * 1024;
    for (let i = 0; i < 64; i += 1) fake1.dataListeners[0]?.('x'.repeat(CHUNK));
    expect(dataSends().length).toBe(STREAM_UNACKED_HIGH_WATER_BYTES / CHUNK);

    // A residue that is NOT the low-water mark exactly, so a reset to 0
    // would be indistinguishable from the kept count at the last step.
    const r = 12_345;
    const c = 777;
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(STREAM_UNACKED_LOW_WATER_BYTES);
    expect(r % CHUNK).not.toBe(0);

    // Ack down to the residue r, which queues the resync.
    const ackPromise = call(
      CHANNELS.terminalStreamAck,
      streamId,
      STREAM_UNACKED_HIGH_WATER_BYTES - r,
    );

    await fake2.connectCalled;
    fake2.resolveConnect('resync-seed');
    await ackPromise;

    expect(created).toBe(2);
    expect(fake1.disposeCount()).toBe(1);

    // The swap clears `dropping`, so the replacement's chunk forwards.
    fake2.dataListeners[0]?.('y'.repeat(c));
    expect(dataSends().at(-1)).toBe('y'.repeat(c));

    // THE DIFFERENTIAL ACK: acking r + c only closes the stream (protocol
    // violation) if `unacked` was reset to 0 by the swap -- if the swap kept
    // the count, unacked is r + c here and this ack brings it to exactly 0.
    await call(CHANNELS.terminalStreamAck, streamId, r + c);

    const lengthBeforeFurtherData = dataSends().length;
    fake2.dataListeners[0]?.('after-residue-ack');
    expect(dataSends().slice(lengthBeforeFurtherData)).toEqual(['after-residue-ack']);
    expect(fake2.disposeCount()).toBe(0);
  });

  describe('T4-AC3: closing/dispose mid-resync-connect', () => {
    function floodAndAck(
      call: (channel: string, ...args: unknown[]) => unknown,
      streamId: string,
      fake1: ReturnType<typeof fakeClient>,
    ): void {
      for (let i = 0; i < 64; i += 1) fake1.dataListeners[0]?.('x'.repeat(64 * 1024));
      const toAck = STREAM_UNACKED_HIGH_WATER_BYTES - STREAM_UNACKED_LOW_WATER_BYTES;
      void call(CHANNELS.terminalStreamAck, streamId, toAck);
    }

    it('close mid-connect: no double dispose, no seed/data/down for X afterward, second close is a no-op', async () => {
      const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents, sent } = fakeWebContents();
      const log: string[] = [];
      const fake1 = fakeClient('c1', log);
      const fake2 = fakeClient('c2', log);
      let created = 0;
      registerTerminalStreamIpc(ipcMain, webContents, run, {
        createClient: () => {
          created += 1;
          return created === 1 ? fake1.client : fake2.client;
        },
      });

      const openPromise = call(CHANNELS.terminalStreamOpen, ATLAS);
      await fake1.connectCalled;
      fake1.resolveConnect('seed');
      const opened = (await openPromise) as { ok: true; streamId: string };
      const streamId = opened.streamId;

      floodAndAck(call, streamId, fake1);
      await fake2.connectCalled;
      expect(fake1.disposeCount()).toBe(1); // Old client already disposed (resync start).

      // Close mid-connect (connect() has been called, but has not resolved).
      await call(CHANNELS.terminalStreamClose, streamId);
      const beforeSettle = sent.length;

      // Now let the replacement's connect() resolve.
      fake2.resolveConnect('resync-seed');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(fake1.disposeCount()).toBe(1); // Never double-disposed.
      expect(fake2.disposeCount()).toBe(1); // The orphaned replacement, disposed exactly once.
      expect(sent.length).toBe(beforeSettle); // No seed/data/down sent after close.

      // Second close is a no-op.
      await expect(call(CHANNELS.terminalStreamClose, streamId)).resolves.toBe(true);
      expect(fake1.disposeCount()).toBe(1);
      expect(fake2.disposeCount()).toBe(1);
    });

    it('close mid-connect, then connect() REJECTS: still no double dispose, nothing sent', async () => {
      const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents, sent } = fakeWebContents();
      const log: string[] = [];
      const fake1 = fakeClient('c1', log);
      const fake2 = fakeClient('c2', log);
      let created = 0;
      registerTerminalStreamIpc(ipcMain, webContents, run, {
        createClient: () => {
          created += 1;
          return created === 1 ? fake1.client : fake2.client;
        },
      });

      const openPromise = call(CHANNELS.terminalStreamOpen, ATLAS);
      await fake1.connectCalled;
      fake1.resolveConnect('seed');
      const opened = (await openPromise) as { ok: true; streamId: string };
      const streamId = opened.streamId;

      floodAndAck(call, streamId, fake1);
      await fake2.connectCalled;
      await call(CHANNELS.terminalStreamClose, streamId);
      const beforeSettle = sent.length;

      fake2.rejectConnect(new Error('gone'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(fake1.disposeCount()).toBe(1);
      expect(fake2.disposeCount()).toBe(1);
      expect(sent.length).toBe(beforeSettle);
    });

    it('connect() REJECTS on a still-open stream: sends exactly one down event, then closes', async () => {
      const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents, sent } = fakeWebContents();
      const log: string[] = [];
      const fake1 = fakeClient('c1', log);
      const fake2 = fakeClient('c2', log);
      let created = 0;
      registerTerminalStreamIpc(ipcMain, webContents, run, {
        createClient: () => {
          created += 1;
          return created === 1 ? fake1.client : fake2.client;
        },
      });

      const openPromise = call(CHANNELS.terminalStreamOpen, ATLAS);
      await fake1.connectCalled;
      fake1.resolveConnect('seed');
      const opened = (await openPromise) as { ok: true; streamId: string };
      const streamId = opened.streamId;

      await floodAndAck(call, streamId, fake1);
      await fake2.connectCalled;
      fake2.rejectConnect(new Error('gone'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const downSends = sent.filter(
        (s) => s.channel === CHANNELS.terminalStreamDown && s.args[0] === streamId,
      );
      expect(downSends).toHaveLength(1);
      expect(downSends[0]?.args[1]).toEqual({ kind: 'gave-up', reason: 'session-gone' });
      expect(fake1.disposeCount()).toBe(1);
      expect(fake2.disposeCount()).toBe(1);

      // The stream is now closed -- a further write is a no-op.
      await call(CHANNELS.terminalStreamWrite, streamId, new TextEncoder().encode('x'));
      expect(fake2.written).toEqual([]);
    });

    it('registry dispose() mid-connect (resolve variant): no double dispose', async () => {
      const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents, sent } = fakeWebContents();
      const log: string[] = [];
      const fake1 = fakeClient('c1', log);
      const fake2 = fakeClient('c2', log);
      let created = 0;
      const registration = registerTerminalStreamIpc(ipcMain, webContents, run, {
        createClient: () => {
          created += 1;
          return created === 1 ? fake1.client : fake2.client;
        },
      });

      const openPromise = call(CHANNELS.terminalStreamOpen, ATLAS);
      await fake1.connectCalled;
      fake1.resolveConnect('seed');
      const opened = (await openPromise) as { ok: true; streamId: string };
      const streamId = opened.streamId;

      floodAndAck(call, streamId, fake1);
      await fake2.connectCalled;
      registration.dispose();
      const beforeSettle = sent.length;

      fake2.resolveConnect('resync-seed');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(fake1.disposeCount()).toBe(1);
      expect(fake2.disposeCount()).toBe(1);
      expect(sent.length).toBe(beforeSettle);
    });

    it('registry dispose() mid-connect (reject variant): no double dispose', async () => {
      const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents, sent } = fakeWebContents();
      const log: string[] = [];
      const fake1 = fakeClient('c1', log);
      const fake2 = fakeClient('c2', log);
      let created = 0;
      const registration = registerTerminalStreamIpc(ipcMain, webContents, run, {
        createClient: () => {
          created += 1;
          return created === 1 ? fake1.client : fake2.client;
        },
      });

      const openPromise = call(CHANNELS.terminalStreamOpen, ATLAS);
      await fake1.connectCalled;
      fake1.resolveConnect('seed');
      const opened = (await openPromise) as { ok: true; streamId: string };
      const streamId = opened.streamId;

      floodAndAck(call, streamId, fake1);
      await fake2.connectCalled;
      registration.dispose();
      const beforeSettle = sent.length;

      fake2.rejectConnect(new Error('gone'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(fake1.disposeCount()).toBe(1);
      expect(fake2.disposeCount()).toBe(1);
      expect(sent.length).toBe(beforeSettle);
    });
  });

  describe('T4-AC4: holding writes that arrive during a connecting resync', () => {
    async function openAndFlood(
      call: (channel: string, ...args: unknown[]) => unknown,
      fake1: ReturnType<typeof fakeClient>,
    ): Promise<string> {
      const openPromise = call(CHANNELS.terminalStreamOpen, ATLAS);
      await fake1.connectCalled;
      fake1.resolveConnect('seed');
      const opened = (await openPromise) as { ok: true; streamId: string };
      for (let i = 0; i < 64; i += 1) fake1.dataListeners[0]?.('x'.repeat(64 * 1024));
      return opened.streamId;
    }

    it('main scenario: writes queued while resyncing land, in order, after the seed', async () => {
      const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents } = fakeWebContents();
      const log: string[] = [];
      const fake1 = fakeClient('c1', log);
      const fake2 = fakeClient('c2', log);
      let created = 0;
      registerTerminalStreamIpc(ipcMain, webContents, run, {
        createClient: () => {
          created += 1;
          return created === 1 ? fake1.client : fake2.client;
        },
      });

      const streamId = await openAndFlood(call, fake1);
      const toAck = STREAM_UNACKED_HIGH_WATER_BYTES - STREAM_UNACKED_LOW_WATER_BYTES;
      const ackPromise = call(CHANNELS.terminalStreamAck, streamId, toAck);
      await Promise.resolve();
      await Promise.resolve();

      // Writes arrive while the resync is still connecting -- held, not
      // forwarded to either client.
      const write1 = call(CHANNELS.terminalStreamWrite, streamId, new TextEncoder().encode('a'));
      await Promise.resolve();
      expect(fake1.written).toEqual([]);
      expect(fake2.written).toEqual([]);

      await fake2.connectCalled;
      fake2.resolveConnect('resync-seed');
      await ackPromise;
      await write1;

      // The held write is delivered to the NEW client after the swap.
      expect(fake2.written).toEqual(['a']);
      expect(fake1.written).toEqual([]);
    });

    it('(i) close mid-connect: queued writes become no-ops', async () => {
      const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents } = fakeWebContents();
      const log: string[] = [];
      const fake1 = fakeClient('c1', log);
      const fake2 = fakeClient('c2', log);
      let created = 0;
      registerTerminalStreamIpc(ipcMain, webContents, run, {
        createClient: () => {
          created += 1;
          return created === 1 ? fake1.client : fake2.client;
        },
      });

      const streamId = await openAndFlood(call, fake1);
      const toAck = STREAM_UNACKED_HIGH_WATER_BYTES - STREAM_UNACKED_LOW_WATER_BYTES;
      const ackPromise = call(CHANNELS.terminalStreamAck, streamId, toAck);
      await Promise.resolve();
      await Promise.resolve();

      const writePromise = call(
        CHANNELS.terminalStreamWrite,
        streamId,
        new TextEncoder().encode('a'),
      );
      await Promise.resolve();

      await call(CHANNELS.terminalStreamClose, streamId);
      await fake2.connectCalled;
      fake2.resolveConnect('resync-seed');
      await ackPromise;
      await writePromise;

      expect(fake1.written).toEqual([]);
      expect(fake2.written).toEqual([]);
    });

    it('(ii) connect() rejects on a live stream: replacement write count is 0', async () => {
      const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents } = fakeWebContents();
      const log: string[] = [];
      const fake1 = fakeClient('c1', log);
      const fake2 = fakeClient('c2', log);
      let created = 0;
      registerTerminalStreamIpc(ipcMain, webContents, run, {
        createClient: () => {
          created += 1;
          return created === 1 ? fake1.client : fake2.client;
        },
      });

      const streamId = await openAndFlood(call, fake1);
      const toAck = STREAM_UNACKED_HIGH_WATER_BYTES - STREAM_UNACKED_LOW_WATER_BYTES;
      const ackPromise = call(CHANNELS.terminalStreamAck, streamId, toAck);
      await Promise.resolve();
      await Promise.resolve();

      const writePromise = call(
        CHANNELS.terminalStreamWrite,
        streamId,
        new TextEncoder().encode('a'),
      );
      await Promise.resolve();

      await fake2.connectCalled;
      fake2.rejectConnect(new Error('gone'));
      await ackPromise;
      await writePromise;

      expect(fake2.written).toEqual([]);
    });

    it('(iii) writes totalling more than MAX_HELD_STREAM_WRITE_BYTES: only what fits is delivered, in order, after the seed', async () => {
      const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents } = fakeWebContents();
      const log: string[] = [];
      const fake1 = fakeClient('c1', log);
      const fake2 = fakeClient('c2', log);
      let created = 0;
      registerTerminalStreamIpc(ipcMain, webContents, run, {
        createClient: () => {
          created += 1;
          return created === 1 ? fake1.client : fake2.client;
        },
      });

      const streamId = await openAndFlood(call, fake1);
      const toAck = STREAM_UNACKED_HIGH_WATER_BYTES - STREAM_UNACKED_LOW_WATER_BYTES;
      const ackPromise = call(CHANNELS.terminalStreamAck, streamId, toAck);
      await Promise.resolve();
      await Promise.resolve();

      // Two chunks that individually fit, but together exceed the max.
      const half = 'y'.repeat(Math.floor(MAX_HELD_STREAM_WRITE_BYTES * 0.6));
      const writeA = call(CHANNELS.terminalStreamWrite, streamId, new TextEncoder().encode(half));
      await Promise.resolve();
      const writeB = call(CHANNELS.terminalStreamWrite, streamId, new TextEncoder().encode(half));
      await Promise.resolve();

      await fake2.connectCalled;
      fake2.resolveConnect('resync-seed');
      await ackPromise;
      await writeA;
      await writeB;

      // Only the FIRST chunk fit; the second overflowed and was dropped.
      expect(fake2.written).toEqual([half]);
      const totalDelivered = fake2.written.reduce((sum, s) => sum + Buffer.byteLength(s), 0);
      expect(totalDelivered).toBeLessThanOrEqual(MAX_HELD_STREAM_WRITE_BYTES);
    });

    it('(iv) write to a missing/closed streamId is a no-op', async () => {
      const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents } = fakeWebContents();
      registerTerminalStreamIpc(ipcMain, webContents, run, {});

      await expect(
        call(CHANNELS.terminalStreamWrite, 'unknown-id', new TextEncoder().encode('a')),
      ).resolves.toBeUndefined();
    });

    it('(v) paste composition: write, paste, write while pending resolve in order after seed', async () => {
      let setBufferRelease: (() => void) | undefined;
      const setBufferGate = new Promise<void>((resolve) => {
        setBufferRelease = resolve;
      });
      const pasteCalls: string[] = [];
      const run: TmuxRun = async (argv) => {
        const verb = argv[0] ?? '';
        if (verb === '-V') return TMUX_VERSION_OK;
        if (verb === 'list-sessions') return LIST_ONE;
        if (verb === 'set-buffer') {
          pasteCalls.push('set-buffer');
          await setBufferGate;
          return ok('');
        }
        if (verb === 'paste-buffer') {
          pasteCalls.push('paste-buffer');
          return ok('');
        }
        return { failure: { message: 'no stub' }, stdout: '', stderr: '' };
      };
      const { ipcMain, call } = fakeIpcMain();
      const { webContents } = fakeWebContents();
      const log: string[] = [];
      const fake1 = fakeClient('c1', log);
      const fake2 = fakeClient('c2', log);
      let created = 0;
      registerTerminalStreamIpc(ipcMain, webContents, run, {
        createClient: () => {
          created += 1;
          return created === 1 ? fake1.client : fake2.client;
        },
      });

      const streamId = await openAndFlood(call, fake1);
      const toAck = STREAM_UNACKED_HIGH_WATER_BYTES - STREAM_UNACKED_LOW_WATER_BYTES;
      const ackPromise = call(CHANNELS.terminalStreamAck, streamId, toAck);
      await Promise.resolve();
      await Promise.resolve();

      // write('a') queues behind the in-flight resync link.
      const writeA = call(CHANNELS.terminalStreamWrite, streamId, new TextEncoder().encode('a'));
      await Promise.resolve();
      // paste queues behind write('a').
      const pastePromise = call(
        CHANNELS.terminalStreamPaste,
        streamId,
        new TextEncoder().encode('pasted'),
      );
      await Promise.resolve();
      await Promise.resolve();
      // write('b') queues behind the paste.
      const writeB = call(CHANNELS.terminalStreamWrite, streamId, new TextEncoder().encode('b'));
      await Promise.resolve();

      await fake2.connectCalled;
      fake2.resolveConnect('resync-seed');
      setBufferRelease?.();
      await ackPromise;
      await writeA;
      await pastePromise;
      await writeB;

      expect(fake2.written).toEqual(['a', 'b']);
      expect(pasteCalls).toEqual(['set-buffer', 'paste-buffer']);
    });

    it('(vi) old client not captured by write: replacement gets 0 writes after old dispose, before swap', async () => {
      const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents } = fakeWebContents();
      const log: string[] = [];
      const fake1 = fakeClient('c1', log);
      const fake2 = fakeClient('c2', log);
      let created = 0;
      registerTerminalStreamIpc(ipcMain, webContents, run, {
        createClient: () => {
          created += 1;
          return created === 1 ? fake1.client : fake2.client;
        },
      });

      const streamId = await openAndFlood(call, fake1);
      const toAck = STREAM_UNACKED_HIGH_WATER_BYTES - STREAM_UNACKED_LOW_WATER_BYTES;
      const ackPromise = call(CHANNELS.terminalStreamAck, streamId, toAck);
      await Promise.resolve();
      await Promise.resolve();

      // Old client is disposed by now (resync start); a write here must
      // never reach it, and must not reach the not-yet-swapped replacement.
      const writePromise = call(
        CHANNELS.terminalStreamWrite,
        streamId,
        new TextEncoder().encode('x'),
      );
      await Promise.resolve();
      expect(fake1.written).toEqual([]);
      expect(fake2.written).toEqual([]);

      await fake2.connectCalled;
      fake2.resolveConnect('resync-seed');
      await ackPromise;
      await writePromise;

      expect(fake1.written).toEqual([]);
      expect(fake2.written).toEqual(['x']);
    });

    it('(vii) close while resync is queued behind an in-flight paste: createClient stays at 1, old client disposed once', async () => {
      let setBufferRelease: (() => void) | undefined;
      const setBufferGate = new Promise<void>((resolve) => {
        setBufferRelease = resolve;
      });
      const run: TmuxRun = async (argv) => {
        const verb = argv[0] ?? '';
        if (verb === '-V') return TMUX_VERSION_OK;
        if (verb === 'list-sessions') return LIST_ONE;
        if (verb === 'set-buffer') {
          await setBufferGate;
          return ok('');
        }
        if (verb === 'paste-buffer') return ok('');
        return { failure: { message: 'no stub' }, stdout: '', stderr: '' };
      };
      const { ipcMain, call } = fakeIpcMain();
      const { webContents } = fakeWebContents();
      const log: string[] = [];
      const fake1 = fakeClient('c1', log);
      let created = 0;
      registerTerminalStreamIpc(ipcMain, webContents, run, {
        createClient: () => {
          created += 1;
          return fake1.client;
        },
      });

      const streamId = await openAndFlood(call, fake1);

      // A paste starts first, gating on set-buffer.
      const pastePromise = call(
        CHANNELS.terminalStreamPaste,
        streamId,
        new TextEncoder().encode('pasted'),
      );
      await Promise.resolve();
      await Promise.resolve();

      // The ack's resync queues BEHIND the in-flight paste.
      const toAck = STREAM_UNACKED_HIGH_WATER_BYTES - STREAM_UNACKED_LOW_WATER_BYTES;
      const ackPromise = call(CHANNELS.terminalStreamAck, streamId, toAck);
      await Promise.resolve();
      await Promise.resolve();

      // Nothing created yet -- the resync link has not run (still behind the paste).
      expect(created).toBe(1);

      // Close now, while the resync is still queued (not yet running).
      await call(CHANNELS.terminalStreamClose, streamId);

      setBufferRelease?.();
      await pastePromise;
      await ackPromise;

      expect(created).toBe(1); // The resync link, finding the record closed, never created a replacement.
      expect(fake1.disposeCount()).toBe(1); // Disposed once, by the close.
    });

    it('(viii) bytes written OUTSIDE a resync do not pollute heldWriteBytes for a LATER resync episode', async () => {
      const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents } = fakeWebContents();
      const log: string[] = [];
      const fake1 = fakeClient('c1', log);
      const fake2 = fakeClient('c2', log);
      let created = 0;
      registerTerminalStreamIpc(ipcMain, webContents, run, {
        createClient: () => {
          created += 1;
          return created === 1 ? fake1.client : fake2.client;
        },
      });

      const openPromise = call(CHANNELS.terminalStreamOpen, ATLAS);
      await fake1.connectCalled;
      fake1.resolveConnect('seed');
      const opened = (await openPromise) as { ok: true; streamId: string };
      const streamId = opened.streamId;

      // A large write BEFORE any flood/resync -- goes straight through on
      // the fast path, must never count against a later resync's own bound.
      const preFloodWrite = 'p'.repeat(Math.floor(MAX_HELD_STREAM_WRITE_BYTES * 0.9));
      await call(CHANNELS.terminalStreamWrite, streamId, new TextEncoder().encode(preFloodWrite));
      expect(fake1.written).toEqual([preFloodWrite]);

      for (let i = 0; i < 64; i += 1) fake1.dataListeners[0]?.('x'.repeat(64 * 1024));
      const toAck = STREAM_UNACKED_HIGH_WATER_BYTES - STREAM_UNACKED_LOW_WATER_BYTES;
      const ackPromise = call(CHANNELS.terminalStreamAck, streamId, toAck);
      await Promise.resolve();
      await Promise.resolve();

      // A write during the resync, sized so it would only fit if the
      // pre-flood write had NOT polluted `heldWriteBytes`.
      const duringResync = 'q'.repeat(Math.floor(MAX_HELD_STREAM_WRITE_BYTES * 0.9));
      const writePromise = call(
        CHANNELS.terminalStreamWrite,
        streamId,
        new TextEncoder().encode(duringResync),
      );
      await Promise.resolve();

      await fake2.connectCalled;
      fake2.resolveConnect('resync-seed');
      await ackPromise;
      await writePromise;

      expect(fake2.written).toEqual([duringResync]);
    });
  });

  describe('ack handler trusts nothing', () => {
    async function openOne() {
      const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents, sent } = fakeWebContents();
      const log: string[] = [];
      const fake = fakeClient('c1', log);
      registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });
      const openPromise = call(CHANNELS.terminalStreamOpen, ATLAS);
      await fake.connectCalled;
      fake.resolveConnect('seed');
      const opened = (await openPromise) as { ok: true; streamId: string };
      return { call, sent, fake, streamId: opened.streamId };
    }

    it('ignores an unknown streamId without throwing', async () => {
      const { call } = await openOne();
      await expect(call(CHANNELS.terminalStreamAck, 'unknown-id', 10)).resolves.toBeUndefined();
    });

    it('ignores a non-string streamId', async () => {
      const { call, fake } = await openOne();
      fake.dataListeners[0]?.('x'.repeat(100));
      await expect(call(CHANNELS.terminalStreamAck, 123, 10)).resolves.toBeUndefined();
      // Forwarding state unchanged: a small ack of the real id still works.
    });

    it('ignores a non-finite byte count (NaN, Infinity)', async () => {
      const { call, streamId } = await openOne();
      await expect(call(CHANNELS.terminalStreamAck, streamId, Number.NaN)).resolves.toBeUndefined();
      await expect(
        call(CHANNELS.terminalStreamAck, streamId, Number.POSITIVE_INFINITY),
      ).resolves.toBeUndefined();
    });

    it('ignores a negative byte count', async () => {
      const { call, streamId } = await openOne();
      await expect(call(CHANNELS.terminalStreamAck, streamId, -1)).resolves.toBeUndefined();
    });

    it('ignores a non-integer byte count', async () => {
      const { call, streamId } = await openOne();
      await expect(call(CHANNELS.terminalStreamAck, streamId, 1.5)).resolves.toBeUndefined();
    });

    it('ignores a wrong arg count', async () => {
      const { call, streamId } = await openOne();
      await expect(call(CHANNELS.terminalStreamAck, streamId)).resolves.toBeUndefined();
      await expect(call(CHANNELS.terminalStreamAck, streamId, 10, 20)).resolves.toBeUndefined();
    });

    it('a well-formed OVERSIZED count closes the stream via the record-close routine; a later ack for it is ignored as unknown', async () => {
      const { call, fake, streamId, sent } = await openOne();
      fake.dataListeners[0]?.('x'.repeat(100)); // unacked === 100

      await call(CHANNELS.terminalStreamAck, streamId, 200); // more than outstanding
      expect(fake.disposeCount()).toBe(1);

      // No further forwarding: a chunk fired on the now-orphaned old listener
      // set never reaches the renderer again -- it was closed, so `isLive()`
      // fails on the SAME client instance too.
      const before = sent.length;
      fake.dataListeners[0]?.('after-close');
      expect(sent.length).toBe(before);

      // A later ack for the same (now unknown) id is ignored.
      await expect(call(CHANNELS.terminalStreamAck, streamId, 1)).resolves.toBeUndefined();
    });
  });

  describe('per-stream state does not leak', () => {
    it('terminalStreamClose drops pasteTargets/pending too; post-close paste/write are no-ops', async () => {
      const { run, argvs } = runner({
        '-V': TMUX_VERSION_OK,
        'list-sessions': LIST_ONE,
        'set-buffer': ok(''),
        'paste-buffer': ok(''),
      });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents } = fakeWebContents();
      const log: string[] = [];
      const fake = fakeClient('c1', log);
      registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });

      const openPromise = call(CHANNELS.terminalStreamOpen, ATLAS);
      await fake.connectCalled;
      fake.resolveConnect('seed');
      const opened = (await openPromise) as { ok: true; streamId: string };
      const streamId = opened.streamId;

      await call(CHANNELS.terminalStreamClose, streamId);
      argvs.length = 0;

      await call(CHANNELS.terminalStreamPaste, streamId, new TextEncoder().encode('hello'));
      expect(argvs).toEqual([]);

      await call(CHANNELS.terminalStreamWrite, streamId, new TextEncoder().encode('hello'));
      expect(fake.written).toEqual([]);
    });

    it('dispose() drops pasteTargets/pending too', async () => {
      const { run, argvs } = runner({
        '-V': TMUX_VERSION_OK,
        'list-sessions': LIST_ONE,
        'set-buffer': ok(''),
        'paste-buffer': ok(''),
      });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents } = fakeWebContents();
      const log: string[] = [];
      const fake = fakeClient('c1', log);
      const registration = registerTerminalStreamIpc(ipcMain, webContents, run, {
        createClient: () => fake.client,
      });

      const openPromise = call(CHANNELS.terminalStreamOpen, ATLAS);
      await fake.connectCalled;
      fake.resolveConnect('seed');
      const opened = (await openPromise) as { ok: true; streamId: string };
      const streamId = opened.streamId;

      registration.dispose();
      argvs.length = 0;
      await call(CHANNELS.terminalStreamPaste, streamId, new TextEncoder().encode('hello'));
      expect(argvs).toEqual([]);
    });

    it('the bound is per-stream: flooding one stream to its bound leaves a second stream forwarding every chunk', async () => {
      const { run } = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
      const { ipcMain, call } = fakeIpcMain();
      const { webContents, sent } = fakeWebContents();
      const log: string[] = [];
      const fakeA = fakeClient('a', log);
      const fakeB = fakeClient('b', log);
      let created = 0;
      registerTerminalStreamIpc(ipcMain, webContents, run, {
        createClient: () => {
          created += 1;
          return created === 1 ? fakeA.client : fakeB.client;
        },
      });

      const openA = call(CHANNELS.terminalStreamOpen, ATLAS);
      await fakeA.connectCalled;
      fakeA.resolveConnect('seed-a');
      const openedA = (await openA) as { ok: true; streamId: string };

      const openB = call(CHANNELS.terminalStreamOpen, ATLAS);
      await fakeB.connectCalled;
      fakeB.resolveConnect('seed-b');
      const openedB = (await openB) as { ok: true; streamId: string };

      // Flood A to its bound.
      const CHUNK = 64 * 1024;
      for (let i = 0; i < 64; i += 1) fakeA.dataListeners[0]?.('x'.repeat(CHUNK));
      const aSends = sent.filter(
        (s) => s.channel === CHANNELS.terminalStreamData && s.args[0] === openedA.streamId,
      );
      expect(aSends.length).toBe(STREAM_UNACKED_HIGH_WATER_BYTES / CHUNK);

      // B, meanwhile, is unaffected by A's bound: a flood well under B's OWN
      // high-water mark still forwards every chunk.
      const bChunks = STREAM_UNACKED_HIGH_WATER_BYTES / CHUNK / 2;
      for (let i = 0; i < bChunks; i += 1) fakeB.dataListeners[0]?.('y'.repeat(CHUNK));
      const bSends = sent.filter(
        (s) => s.channel === CHANNELS.terminalStreamData && s.args[0] === openedB.streamId,
      );
      expect(bSends.length).toBe(bChunks);
    });
  });
});
