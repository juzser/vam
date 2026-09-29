/**
 * Finding 546486bb (S2-major, performance), PRELOAD HALF: the wrapper
 * (`src/preload/terminal-stream-ack.ts`) that sends `terminalStreamAck` back
 * to main as bytes are delivered through `onData`.
 *
 * AC1 covers the wrapper alone, against a FAKE `TerminalStreamApi` -- no
 * preload/electron machinery needed, since the wrapper only ever calls the
 * API object it was handed and an injected `invoke`.
 *
 * AC2 covers the byte-counting agreement between this wrapper and main's own
 * `registerTerminalStreamIpc` (`src/main/terminal/stream-ipc.ts`): only this
 * task can see both modules at once.
 */

import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import type { TmuxRun, TmuxRunResult } from '../../src/main/sources/tmux/spawn.js';
import type { StreamClient } from '../../src/main/terminal/stream/client.js';
import {
  registerTerminalStreamIpc,
  STREAM_UNACKED_LOW_WATER_BYTES,
} from '../../src/main/terminal/stream-ipc.js';
import type { TerminalStreamApi } from '../../src/preload/api.js';
import {
  TERMINAL_STREAM_ACK_STEP_BYTES,
  wrapTerminalStreamApiWithAck,
} from '../../src/preload/terminal-stream-ack.js';

/** THE RESYNC GUARANTEE the step size must hold -- see the wrapper's own header. */
it('TERMINAL_STREAM_ACK_STEP_BYTES stays at or below the low-water mark', () => {
  expect(TERMINAL_STREAM_ACK_STEP_BYTES).toBeLessThanOrEqual(STREAM_UNACKED_LOW_WATER_BYTES);
});

/**
 * A fake `TerminalStreamApi`: `onData` captures its listener per `streamId`
 * and returns a COUNTED unsubscribe; every other member is its own `vi.fn`,
 * so pass-through can be asserted by identity.
 */
function fakeApi() {
  const subscriptions = new Map<
    string,
    { listener: (chunk: string) => void; unsubCount: number; removed: boolean }[]
  >();
  const onData = vi.fn((streamId: string, listener: (chunk: string) => void) => {
    const entry = { listener, unsubCount: 0, removed: false };
    const list = subscriptions.get(streamId) ?? [];
    list.push(entry);
    subscriptions.set(streamId, list);
    return () => {
      entry.unsubCount += 1;
      entry.removed = true;
    };
  });
  const api: TerminalStreamApi = {
    open: vi.fn() as unknown as TerminalStreamApi['open'],
    close: vi.fn() as unknown as TerminalStreamApi['close'],
    write: vi.fn() as unknown as TerminalStreamApi['write'],
    paste: vi.fn() as unknown as TerminalStreamApi['paste'],
    onData,
    onSeed: vi.fn() as unknown as TerminalStreamApi['onSeed'],
    onDown: vi.fn() as unknown as TerminalStreamApi['onDown'],
  };
  return {
    api,
    /** Delivers `chunk` to every caller subscribed to `streamId` right now. */
    emit: (streamId: string, chunk: string) => {
      for (const entry of subscriptions.get(streamId) ?? []) {
        if (!entry.removed) entry.listener(chunk);
      }
    },
    unsubCount: (streamId: string) =>
      (subscriptions.get(streamId) ?? []).reduce((sum, e) => sum + e.unsubCount, 0),
  };
}

function fakeInvoke() {
  const calls: { channel: string; args: unknown[] }[] = [];
  let rejectNext = false;
  const invoke = vi.fn((channel: string, ...args: unknown[]) => {
    calls.push({ channel, args });
    if (rejectNext) {
      rejectNext = false;
      return Promise.reject(new Error('boom'));
    }
    return Promise.resolve(undefined);
  });
  return {
    invoke: { invoke },
    calls,
    ackCalls: () => calls.filter((c) => c.channel === CHANNELS.terminalStreamAck),
    rejectNextCall: () => {
      rejectNext = true;
    },
  };
}

describe('wrapTerminalStreamApiWithAck', () => {
  it('(1) delivers every chunk to the caller unchanged and in order', () => {
    const fake = fakeApi();
    const { invoke } = fakeInvoke();
    const wrapped = wrapTerminalStreamApiWithAck(fake.api, invoke);

    const received: string[] = [];
    wrapped.onData('s1', (chunk) => received.push(chunk));
    fake.emit('s1', 'a');
    fake.emit('s1', 'b');
    fake.emit('s1', 'c');

    expect(received).toEqual(['a', 'b', 'c']);
  });

  it('(2) acks once at least one step has accumulated for that streamId', () => {
    const fake = fakeApi();
    const { invoke, ackCalls } = fakeInvoke();
    const wrapped = wrapTerminalStreamApiWithAck(fake.api, invoke);
    wrapped.onData('s1', () => {});

    // Under one step: no ack yet.
    fake.emit('s1', 'x'.repeat(TERMINAL_STREAM_ACK_STEP_BYTES - 1));
    expect(ackCalls()).toHaveLength(0);

    // One more byte crosses the step.
    fake.emit('s1', 'y');
    expect(ackCalls()).toHaveLength(1);
    expect(ackCalls()[0]?.args).toEqual(['s1', TERMINAL_STREAM_ACK_STEP_BYTES]);
  });

  it('(3) acks once per chunk, however many subscribers are live', () => {
    const fake = fakeApi();
    const { invoke, ackCalls } = fakeInvoke();
    const wrapped = wrapTerminalStreamApiWithAck(fake.api, invoke);

    const receivedA: string[] = [];
    const receivedB: string[] = [];
    wrapped.onData('s1', (chunk) => receivedA.push(chunk));
    wrapped.onData('s1', (chunk) => receivedB.push(chunk));

    const STEP = TERMINAL_STREAM_ACK_STEP_BYTES;
    fake.emit('s1', 'x'.repeat(STEP));
    fake.emit('s1', 'y'.repeat(STEP));

    expect(receivedA).toHaveLength(2);
    expect(receivedB).toHaveLength(2);
    // Exactly two steps acked in total, not four -- a double count per chunk
    // would over-ack and trip main's protocol-violation close.
    expect(ackCalls()).toHaveLength(2);
    const totalAcked = ackCalls().reduce((sum, c) => sum + (c.args[1] as number), 0);
    expect(totalAcked).toBe(STEP * 2);
    // Underlying `onData` was registered exactly once for this streamId.
    expect(fake.api.onData).toHaveBeenCalledTimes(1);
  });

  it('(4) releases the underlying subscription once the last caller unsubscribes, and acks nothing further', () => {
    const fake = fakeApi();
    const { invoke, ackCalls } = fakeInvoke();
    const wrapped = wrapTerminalStreamApiWithAck(fake.api, invoke);

    const stopA = wrapped.onData('s1', () => {});
    const stopB = wrapped.onData('s1', () => {});

    stopA();
    expect(fake.unsubCount('s1')).toBe(0);

    stopB();
    expect(fake.unsubCount('s1')).toBe(1);

    const ackedBefore = ackCalls().length;
    // A resubscribe re-registers the underlying `onData`, so this checks the
    // OLD listener reference is gone, not that the stream can never reopen.
    fake.emit('s1', 'x'.repeat(TERMINAL_STREAM_ACK_STEP_BYTES));
    expect(ackCalls()).toHaveLength(ackedBefore);
  });

  it('calling the same unsubscribe twice is a no-op, not a double release', () => {
    const fake = fakeApi();
    const { invoke } = fakeInvoke();
    const wrapped = wrapTerminalStreamApiWithAck(fake.api, invoke);

    const stopA = wrapped.onData('s1', () => {});
    const stopB = wrapped.onData('s1', () => {});

    // A caller unsubscribing twice (e.g. an effect cleanup racing a manual
    // stop) must not remove `stopA`'s listener a second time, and must not
    // release the shared underlying subscription while `stopB` is still live.
    stopA();
    stopA();
    expect(fake.unsubCount('s1')).toBe(0);

    stopB();
    expect(fake.unsubCount('s1')).toBe(1);
  });

  it('(5) a rejected ack invoke is caught and never surfaces as an unhandled rejection', async () => {
    const fake = fakeApi();
    const { invoke, rejectNextCall } = fakeInvoke();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapped = wrapTerminalStreamApiWithAck(fake.api, invoke);
    wrapped.onData('s1', () => {});

    rejectNextCall();
    expect(() => fake.emit('s1', 'x'.repeat(TERMINAL_STREAM_ACK_STEP_BYTES))).not.toThrow();
    // Let the rejection's `.catch` handler actually run before asserting on it.
    await Promise.resolve();
    await Promise.resolve();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("pass-through: every other member is the fake API's own function, called with the same arguments", () => {
    const fake = fakeApi();
    const { invoke } = fakeInvoke();
    const wrapped = wrapTerminalStreamApiWithAck(fake.api, invoke);

    expect(wrapped.close).toBe(fake.api.close);
    expect(wrapped.write).toBe(fake.api.write);
    expect(wrapped.paste).toBe(fake.api.paste);
    expect(wrapped.open).toBe(fake.api.open);
    expect(wrapped.onSeed).toBe(fake.api.onSeed);
    expect(wrapped.onDown).toBe(fake.api.onDown);

    wrapped.paste('s1', new Uint8Array([1, 2, 3]));
    expect(fake.api.paste).toHaveBeenCalledWith('s1', new Uint8Array([1, 2, 3]));
  });
});

/**
 * AC2: bytes are counted the same way on both sides of the bridge.
 *
 * Connects main's `registerTerminalStreamIpc` (a fake `createClient`, a
 * stub `run` for the tmux version/session lookup, and a `webContents` whose
 * `terminalStreamData` sends feed the wrapped `onData`) to a wrapper whose
 * `invoke` calls main's own captured `terminalStreamAck` handler directly.
 */
describe('terminal stream ack -- byte counting agreement (AC2)', () => {
  const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
  const ATLAS = 'claude-code:atlas-11111111';
  const TMUX_VERSION_OK = ok('tmux 3.7b\n');
  const LIST_ONE = ok(`${ATLAS}\t\tvam-atlas-a1b2c3\n`);

  function runner(answers: Record<string, TmuxRunResult>) {
    const run: TmuxRun = async (argv) => {
      const verb = argv[0] ?? '';
      return answers[verb] ?? { failure: { message: 'no stub' }, stdout: '', stderr: '' };
    };
    return run;
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

  function fakeWebContents(onSend: (channel: string, ...args: unknown[]) => void) {
    return { send: onSend };
  }

  /** A `StreamClient` fake whose `onData` is fired by the test, like the
   *  backpressure suite's own `fakeClient` (`stream-ipc.backpressure.test.ts`). */
  function fakeClient() {
    const dataListeners: ((chunk: string) => void)[] = [];
    let disposeCount = 0;
    const client = {
      onData: (l: (chunk: string) => void) => {
        dataListeners.push(l);
        return () => {};
      },
      onSeed: () => () => {},
      onDown: () => () => {},
      connect: () => Promise.resolve('seed'),
      write: () => {},
      dispose: () => {
        disposeCount += 1;
      },
    } as unknown as StreamClient;
    return { client, dataListeners, disposeCount: () => disposeCount };
  }

  it('main-forwarded UTF-8 bytes equal preload-acked UTF-8 bytes for a multi-byte chunk', async () => {
    const run = runner({ '-V': TMUX_VERSION_OK, 'list-sessions': LIST_ONE });
    const { ipcMain, call } = fakeIpcMain();
    const fake = fakeClient();

    // The wrapped `onData` this stream's `terminalStreamData` sends feed --
    // fed through `webContents.send`, exactly as the real preload's own
    // `createFilteredStreamListener` would filter it.
    let dataListener: ((chunk: string) => void) | undefined;
    const webContents = fakeWebContents((channel, ...args) => {
      if (channel === CHANNELS.terminalStreamData) {
        const [, chunk] = args as [string, string];
        dataListener?.(chunk);
      }
    });

    registerTerminalStreamIpc(ipcMain, webContents, run, { createClient: () => fake.client });
    const opened = (await call(CHANNELS.terminalStreamOpen, ATLAS)) as {
      ok: true;
      streamId: string;
    };
    const streamId = opened.streamId;

    // The wrapper's `invoke` calls main's own captured ack handler directly,
    // deferred to a microtask -- exactly like the real `ipcRenderer.invoke`,
    // which always crosses the process boundary asynchronously. Calling it
    // synchronously here would let an ack re-enter main's data path mid-chunk,
    // before `record.unacked` finished accounting for the chunk being sent --
    // a reentrancy the real bridge cannot produce.
    const wrapperInvoke = {
      invoke: (channel: string, ...args: unknown[]) =>
        Promise.resolve().then(() => call(channel, ...args)),
    };
    const fakeApiForWrap: TerminalStreamApi = {
      open: (() => Promise.resolve()) as unknown as TerminalStreamApi['open'],
      close: () => {},
      write: () => {},
      paste: () => {},
      onData: (id, listener) => {
        dataListener = listener;
        return () => {
          dataListener = undefined;
        };
      },
      onSeed: () => () => {},
      onDown: () => () => {},
    };
    const wrapped = wrapTerminalStreamApiWithAck(fakeApiForWrap, wrapperInvoke);

    const acksSent: number[] = [];
    const rawInvoke = wrapperInvoke.invoke.bind(wrapperInvoke);
    wrapperInvoke.invoke = (channel: string, ...args: unknown[]) => {
      if (channel === CHANNELS.terminalStreamAck) acksSent.push(args[1] as number);
      return rawInvoke(channel, ...args);
    };

    wrapped.onData(streamId, () => {});

    const multiByteChunk = 'é中😀';
    const multiByteLength = Buffer.byteLength(multiByteChunk, 'utf8');
    const asciiChunk = 'a'.repeat(TERMINAL_STREAM_ACK_STEP_BYTES - multiByteLength);

    fake.dataListeners[0]?.(multiByteChunk);
    fake.dataListeners[0]?.(asciiChunk);

    // Let the wrapper's ack invoke (a resolved promise chain) settle.
    await Promise.resolve();
    await Promise.resolve();

    // Exactly one step arrived, counted in UTF-8, so exactly one ack of one
    // step went out -- and main accepted it without over-ack (dispose stays 0).
    expect(acksSent).toEqual([TERMINAL_STREAM_ACK_STEP_BYTES]);
    expect(fake.disposeCount()).toBe(0);

    // One further single-byte chunk crosses a second step boundary trivially
    // (pending starts back at 0): send it directly as a second ack of 1,
    // which exceeds main's outstanding unacked count (0) and closes the
    // stream -- showing main's outstanding count was exactly 0 after the
    // first ack.
    await call(CHANNELS.terminalStreamAck, streamId, 1);
    expect(fake.disposeCount()).toBe(1);
  });
});
