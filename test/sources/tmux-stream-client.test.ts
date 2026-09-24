/**
 * `StreamClient`, the Terminal tab's streaming half -- a FAKE child process,
 * no real tmux, exactly `tmux-control.test.ts`'s own approach. What is under
 * test: reusing `ControlFramer.feedEvents()` (not a second parser), the
 * multi-byte UTF-8 chunk-boundary fix, seed-before-stream ordering, the
 * reply-based (not position-based) startup-block skip, `%pause`/`%continue`
 * reseed, reconnect-without-resend, and clean disposal.
 */

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECONNECT_BACKOFF_MS } from '../../src/main/sources/tmux/control.js';
import {
  type ControlChildProcess,
  MAX_RECONNECT_ATTEMPTS,
  MAX_RECONNECT_BACKOFF_MS,
  StreamClient,
} from '../../src/main/terminal/stream/client.js';

class FakeChild extends EventEmitter implements ControlChildProcess {
  readonly written: string[] = [];
  killed = 0;
  readonly stdout = new EventEmitter();
  readonly stdin = {
    write: (data: string): boolean => {
      this.written.push(data);
      return true;
    },
  };
  kill(): void {
    this.killed += 1;
  }
  data(chunk: string | Buffer): void {
    this.stdout.emit('data', chunk);
  }
}

/** Let every already-queued microtask (the client's own promise chain)
 * run before the next assertion or the next fake reply. Mirrors
 * `tmux-control.test.ts`'s own `tick`. */
const tick = async (n = 5): Promise<void> => {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
};

/** `children[i]`, thrown rather than non-null-asserted -- a missing child
 * here is a test bug, and this fails loudly instead of silently. */
function at(children: readonly FakeChild[], index: number): FakeChild {
  const child = children[index];
  if (child === undefined) throw new Error(`no child at index ${index}`);
  return child;
}

function harness(target = 'vam-atlas-a1b2c3') {
  const children: FakeChild[] = [];
  const spawnChild = vi.fn((_binary: string, _argv: readonly string[]) => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  const client = new StreamClient({ prefix: [], target, spawnChild });
  return { client, children, spawnChild };
}

/** Reply the fake child to `list-panes` with one pane id, then to
 * `capture-pane` with `seed` -- the two commands `connect()`/a reconnect
 * always send, in order, each its own `%begin`/`%end` block. Ticks between
 * the two so the client's own continuation (which only issues the SECOND
 * command after the first one's reply resolves) has a chance to run before
 * the second reply arrives. */
async function answerListPanes(child: FakeChild, paneId = '%3'): Promise<void> {
  child.data(`%begin 1 1 1\n${paneId}\n%end 1 1 1\n`);
  await tick();
}

async function answerCapturePane(child: FakeChild, seed: string, time = 2): Promise<void> {
  child.data(`%begin ${time} ${time} 1\n${seed}\n%end ${time} ${time} 1\n`);
  await tick();
}

async function connectWith(child: FakeChild, paneId = '%3', seed = 'seed'): Promise<void> {
  await answerListPanes(child, paneId);
  await answerCapturePane(child, seed);
}

/** A `%error`-closed block -- tmux's own shape for "can't find session: x",
 * the reply this codebase's other tmux tests already use for the identical
 * real-tmux error text (`tmux-control-protocol.test.ts`). */
async function answerCapturePaneWithError(
  child: FakeChild,
  errorText: string,
  time = 2,
): Promise<void> {
  child.data(`%begin ${time} ${time} 1\n${errorText}\n%error ${time} ${time} 1\n`);
  await tick();
}

describe('StreamClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves connect() with the seed and reuses feedEvents for %output', async () => {
    const { client, children } = harness();
    const connecting = client.connect();
    const child = at(children, 0);
    await connectWith(child, '%3', 'seed-text');
    expect(await connecting).toBe('seed-text\n');

    const received: string[] = [];
    client.onData((chunk) => received.push(chunk));
    child.data('%output %3 hi there\n');
    expect(received).toEqual(['hi there']);
  });

  it('decodes a multi-byte UTF-8 character split across two data events', async () => {
    const { client, children } = harness();
    const connecting = client.connect();
    const child = at(children, 0);
    await connectWith(child);
    await connecting;

    const received: string[] = [];
    client.onData((chunk) => received.push(chunk));
    // '€' is E2 82 AC in UTF-8 -- split the pipe read inside the sequence.
    const full = Buffer.from('%output %3 a€b\n', 'utf8');
    const splitAt = full.indexOf(0x82); // inside the euro sign
    child.data(full.subarray(0, splitAt));
    child.data(full.subarray(splitAt));
    expect(received).toEqual(['a€b']);
  });

  it('drops %output for the resolved pane that arrives before capture-pane replies', async () => {
    const { client, children } = harness();
    const connecting = client.connect();
    const child = at(children, 0);
    const received: string[] = [];
    client.onData((chunk) => received.push(chunk));

    // list-panes reply lands, capture-pane not yet answered.
    await answerListPanes(child, '%3');
    // %output for the now-resolved pane arrives before the seed's own reply.
    child.data('%output %3 too-early\n');
    await answerCapturePane(child, 'seed');
    await connecting;
    // Anything from after the seed's reply is forwarded normally.
    child.data('%output %3 after-seed\n');

    expect(received).toEqual(['after-seed']);
  });

  it('drops blocks by their own reply flag, not by position -- two stray blocks first', async () => {
    const { client, children } = harness();
    const connecting = client.connect();
    const child = at(children, 0);
    // Two unsolicited, non-reply blocks (flags bit 0 unset) before either
    // real reply -- must not be mistaken for list-panes' or capture-pane's.
    child.data('%begin 0 0 0\n%end 0 0 0\n');
    child.data('%begin 0 1 0\nnoise\n%end 0 1 0\n');
    await tick();
    await connectWith(child, '%7', 'real-seed');
    expect(await connecting).toBe('real-seed\n');
  });

  it('reseeds via onSeed, not onData, on %pause then %continue', async () => {
    const { client, children } = harness();
    const connecting = client.connect();
    const child = at(children, 0);
    await connectWith(child, '%3', 'initial');
    await connecting;

    const data: string[] = [];
    const seeds: string[] = [];
    client.onData((chunk) => data.push(chunk));
    client.onSeed((seed) => seeds.push(seed));

    child.data('%pause %3\n');
    // %output while paused is not trusted -- dropped, not forwarded.
    child.data('%output %3 unreliable\n');
    child.data('%continue %3\n');
    await tick();
    // The reseed's own capture-pane reply.
    await answerCapturePane(child, 'fresh-seed', 3);

    expect(data).toEqual([]);
    expect(seeds).toEqual(['fresh-seed\n']);
  });

  it('reconnects after a drop: backoff, fresh child, fresh seed, no resent write', async () => {
    vi.useFakeTimers();
    const { client, children, spawnChild } = harness();
    const connecting = client.connect();
    const child = at(children, 0);
    await connectWith(child, '%3', 'first-seed');
    await connecting;

    client.write('Z');
    expect(child.written.some((line) => line.includes('5a'))).toBe(true);

    const seeds: string[] = [];
    client.onSeed((seed) => seeds.push(seed));

    child.emit('exit');
    await tick();
    expect(spawnChild).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS);
    expect(spawnChild).toHaveBeenCalledTimes(2);
    const second = at(children, 1);
    // Only the reconnect's own capture-pane is sent -- never the earlier `Z`.
    await answerCapturePane(second, 'reconnect-seed', 1);

    expect(seeds).toEqual(['reconnect-seed\n']);
    expect(second.written.some((line) => line.includes('5a'))).toBe(false);
  });

  it('dispose() kills the child exactly once and delivers no further events', async () => {
    const { client, children } = harness();
    const connecting = client.connect();
    const child = at(children, 0);
    await connectWith(child, '%3', 'seed');
    await connecting;

    const received: string[] = [];
    client.onData((chunk) => received.push(chunk));
    client.dispose();
    expect(child.killed).toBe(1);

    child.data('%output %3 after-dispose\n');
    expect(received).toEqual([]);
  });

  // ── Review finding: the target must go through the SAME allowlist every
  // other control-mode caller does before this file builds a single raw
  // line with it (`control-protocol.ts`'s own `SAFE_TARGET_RE`). ────────────
  describe('target validation (review finding)', () => {
    it('refuses to attach when the target carries a `;` -- a second tmux command', async () => {
      const { client, spawnChild } = harness('vam-a1b2c3; kill-server');
      await expect(client.connect()).rejects.toThrow();
      expect(spawnChild).not.toHaveBeenCalled();
    });

    it('refuses a target carrying a space or a quote the same way', async () => {
      const { client: withSpace, spawnChild: spawnSpace } = harness('vam-a1b2c3 evil');
      await expect(withSpace.connect()).rejects.toThrow();
      expect(spawnSpace).not.toHaveBeenCalled();

      const { client: withQuote, spawnChild: spawnQuote } = harness('vam-a1b2c3"');
      await expect(withQuote.connect()).rejects.toThrow();
      expect(spawnQuote).not.toHaveBeenCalled();
    });

    it('still accepts an ordinary vam session name, unaffected by the new check', async () => {
      const { client, children } = harness('vam-atlas-a1b2c3');
      const connecting = client.connect();
      const child = at(children, 0);
      await connectWith(child, '%3', 'seed-text');
      expect(await connecting).toBe('seed-text\n');
    });
  });

  // ── Review finding: %extended-output (tmux's flow-control-carrying
  // variant of %output) was undocumented-but-claimed-done; decode it the
  // same way %output is. ─────────────────────────────────────────────────
  it('decodes %extended-output the same way as %output, reusing the one framer', async () => {
    const { client, children } = harness();
    const connecting = client.connect();
    const child = at(children, 0);
    await connectWith(child, '%3', 'seed');
    await connecting;

    const received: string[] = [];
    client.onData((chunk) => received.push(chunk));
    // tmux's own shape: %extended-output %<pane> <age> <flags> : <payload>,
    // the payload escaped the identical way %output's is.
    child.data('%extended-output %3 120 : caught\\040up\n');
    expect(received).toEqual(['caught up']);
  });

  // ── Review finding: an unbounded fixed-interval reconnect loop. ─────────
  describe('reconnect backoff, cap and give-up (review finding)', () => {
    it('grows the delay between attempts, capped, and gives up after MAX_RECONNECT_ATTEMPTS', async () => {
      vi.useFakeTimers();
      const { client, children, spawnChild } = harness();
      const connecting = client.connect();
      const first = at(children, 0);
      await connectWith(first, '%3', 'seed');
      await connecting;

      const downEvents: unknown[] = [];
      client.onDown((event) => downEvents.push(event));

      let spawns = 1;
      let delay = RECONNECT_BACKOFF_MS;
      for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt += 1) {
        const current = at(children, spawns - 1);
        current.emit('exit');
        await tick();
        // Advancing by LESS than the expected delay must not spawn yet --
        // this is what actually distinguishes "grows" from "stayed fixed".
        if (delay > 1) {
          await vi.advanceTimersByTimeAsync(delay - 1);
          expect(spawnChild).toHaveBeenCalledTimes(spawns);
        }
        await vi.advanceTimersByTimeAsync(1);
        spawns += 1;
        expect(spawnChild).toHaveBeenCalledTimes(spawns);
        delay = Math.min(delay * 2, MAX_RECONNECT_BACKOFF_MS);
      }

      // One more drop after the cap: no further reconnect is ever scheduled.
      const last = at(children, spawns - 1);
      last.emit('exit');
      await tick();
      await vi.advanceTimersByTimeAsync(MAX_RECONNECT_BACKOFF_MS * 10);
      expect(spawnChild).toHaveBeenCalledTimes(spawns);

      expect(downEvents.at(-1)).toEqual({ kind: 'gave-up', reason: 'max-attempts' });
    });

    it('gives up immediately, without exhausting attempts, when the session is gone', async () => {
      vi.useFakeTimers();
      const { client, children, spawnChild } = harness();
      const connecting = client.connect();
      const first = at(children, 0);
      await connectWith(first, '%3', 'seed');
      await connecting;

      const downEvents: unknown[] = [];
      const seeds: string[] = [];
      client.onDown((event) => downEvents.push(event));
      client.onSeed((seed) => seeds.push(seed));

      first.emit('exit');
      await tick();
      await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS);
      expect(spawnChild).toHaveBeenCalledTimes(2);
      const second = at(children, 1);
      await answerCapturePaneWithError(second, "can't find session: vam-atlas-a1b2c3");

      // No reseed -- the reconnect never got a real screen.
      expect(seeds).toEqual([]);
      expect(downEvents.at(-1)).toEqual({ kind: 'gave-up', reason: 'session-gone' });

      // And no further attempt, however long is waited -- well under
      // MAX_RECONNECT_ATTEMPTS worth of backoff.
      await vi.advanceTimersByTimeAsync(MAX_RECONNECT_BACKOFF_MS * 10);
      expect(spawnChild).toHaveBeenCalledTimes(2);
    });

    it('resets the attempt count after a genuinely successful reconnect', async () => {
      vi.useFakeTimers();
      const { client, children, spawnChild } = harness();
      const connecting = client.connect();
      const first = at(children, 0);
      await connectWith(first, '%3', 'seed');
      await connecting;

      // One failed drop, one successful reconnect.
      first.emit('exit');
      await tick();
      await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS);
      const second = at(children, 1);
      await answerCapturePane(second, 'reconnect-seed', 5);

      // A SECOND drop, now: if the attempt counter had not reset, this
      // would use the SECOND backoff step (RECONNECT_BACKOFF_MS * 2) rather
      // than the first again.
      second.emit('exit');
      await tick();
      await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS - 1);
      expect(spawnChild).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(spawnChild).toHaveBeenCalledTimes(3);
    });
  });
});
