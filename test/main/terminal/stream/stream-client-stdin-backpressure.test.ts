/**
 * Closes finding 70fd9ec9 (S3-minor): `#write` used to discard the boolean
 * `child.stdin.write(...)` returns, so a control client that stopped reading
 * let this file buffer an unbounded backlog. This file is the fake-child
 * harness `tmux-stream-client.test.ts` already uses (own copy, per this
 * task's own claim boundary), with one addition that model's own fake stdin
 * lacks: a controllable write() return value plus a hand-fired `'drain'`.
 */

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECONNECT_BACKOFF_MS } from '../../../../src/main/sources/tmux/control.js';
import { hexBytes } from '../../../../src/main/sources/tmux/control-protocol.js';
import { MAX_STREAM_WRITE_BYTES } from '../../../../src/main/terminal/stream-ipc.js';
import {
  type ControlChildProcess,
  MAX_PENDING_STDIN_BYTES,
  StreamClient,
  type StreamDownEvent,
} from '../../../../src/main/terminal/stream/client.js';

/** Fake stdin -- an `EventEmitter` (so `once('drain', ...)` behaves exactly
 * like Node's real `Writable`) plus a controllable `write()` return value.
 * `nextResults` is a FIFO of forced return values; once it empties, `write`
 * returns `true` (an unblocked pipe, the ordinary case). */
class FakeStdin extends EventEmitter {
  readonly written: string[] = [];
  readonly nextResults: boolean[] = [];
  write(data: string): boolean {
    this.written.push(data);
    const forced = this.nextResults.shift();
    return forced ?? true;
  }
  drain(): void {
    this.emit('drain');
  }
}

class FakeChild extends EventEmitter implements ControlChildProcess {
  readonly stdin = new FakeStdin();
  readonly stdout = new EventEmitter();
  killed = 0;
  kill(): void {
    this.killed += 1;
  }
  data(chunk: string | Buffer): void {
    this.stdout.emit('data', chunk);
  }
}

const tick = async (n = 5): Promise<void> => {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
};

function at(children: readonly FakeChild[], index: number): FakeChild {
  const child = children[index];
  if (child === undefined) throw new Error(`no child at index ${index}`);
  return child;
}

const TARGET = 'vam-atlas-a1b2c3';
const paneTarget = `=${TARGET}:`;

function harness() {
  const children: FakeChild[] = [];
  const spawnChild = vi.fn((_binary: string, _argv: readonly string[]) => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  const client = new StreamClient({ prefix: [], target: TARGET, spawnChild });
  return { client, children, spawnChild };
}

async function answerPauseAfter(child: FakeChild, time = 0): Promise<void> {
  child.data(`%begin ${time} ${time} 1\n%end ${time} ${time} 1\n`);
  await tick();
}

async function answerListPanes(child: FakeChild, paneId = '%3'): Promise<void> {
  child.data(`%begin 1 1 1\n${paneId}\n%end 1 1 1\n`);
  await tick();
}

async function answerCursorQuery(child: FakeChild, time: number): Promise<void> {
  child.data(`%begin ${time} ${time} 1\n%end ${time} ${time} 1\n`);
  await tick();
}

async function answerCapturePane(child: FakeChild, seed: string, time = 2): Promise<void> {
  await answerCursorQuery(child, time);
  child.data(`%begin ${time} ${time} 1\n${seed}\n%end ${time} ${time} 1\n`);
  await tick();
}

async function connectWith(child: FakeChild, paneId = '%3', seed = 'seed'): Promise<void> {
  await answerPauseAfter(child);
  await answerListPanes(child, paneId);
  await answerCapturePane(child, seed);
}

/** The exact `send-keys -H` line (sans trailing `\n`) `write()` builds for
 * `text` -- built through the SAME `hexBytes` the file under test uses, so
 * this never drifts into a second, independently-guessed encoding. */
function keyLine(text: string): string {
  return `send-keys -t ${paneTarget} -H ${hexBytes(text).join(' ')}`;
}

describe('StreamClient stdin backpressure', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC1: holds a write while the pipe is full, flushes it in order after drain', async () => {
    const { client, children } = harness();
    const connecting = client.connect();
    const child = at(children, 0);
    await connectWith(child);
    await connecting;

    const baseline = child.stdin.written.length;
    child.stdin.nextResults.push(false); // 'a' itself trips the block
    client.write('a');
    client.write('b'); // no drain yet -- must not reach stdin

    const afterA = child.stdin.written.length - baseline;
    expect(afterA).toBe(1); // NOT 2, as at main
    expect(child.stdin.written[baseline]).toBe(`${keyLine('a')}\n`);

    child.stdin.drain();
    await tick();

    const afterDrain = child.stdin.written.length - baseline;
    expect(afterDrain).toBe(2);
    expect(child.stdin.written[baseline + 1]).toBe(`${keyLine('b')}\n`);
  });

  it('AC2: order preserved across write() and #send()-originated lines', async () => {
    const { client, children } = harness();
    const connecting = client.connect();
    const child = at(children, 0);
    await connectWith(child, '%3');
    await connecting;

    const baseline = child.stdin.written.length;
    child.stdin.nextResults.push(false); // 'warm' trips the block
    client.write('warm');
    expect(child.stdin.written.length - baseline).toBe(1);

    client.write('a'); // held
    child.data('%pause %3\n'); // triggers #continueAfterPause -> #send, held
    await tick();
    client.write('b'); // held

    expect(child.stdin.written.length - baseline).toBe(1); // still just 'warm'

    child.stdin.drain();
    await tick();

    const refreshLine = `refresh-client -A "%3:continue"`;
    expect(child.stdin.written.slice(baseline + 1)).toEqual([
      `${keyLine('a')}\n`,
      `${refreshLine}\n`,
      `${keyLine('b')}\n`,
    ]);

    // The reseed chain's own line only reaches stdin after the refresh
    // command's own reply lands -- not before, and not out of order. The
    // FIFO's own reply order is: 'warm''s and 'a''s no-op placeholders,
    // THEN the refresh command's real reply (push order, not write order --
    // `write()`'s placeholders were queued before `#send` queued the
    // refresh's).
    child.data('%begin 3 3 1\n%end 3 3 1\n'); // 'warm''s own no-op placeholder
    await tick();
    child.data('%begin 4 4 1\n%end 4 4 1\n'); // 'a''s own no-op placeholder
    await tick();
    const beforeReply = child.stdin.written.length;
    child.data('%begin 5 5 1\n%end 5 5 1\n'); // refresh-client's own reply
    await tick();
    expect(child.stdin.written.length).toBeGreaterThan(beforeReply); // chain line now written
  });

  it('AC3: at the bound, held+tripping lines are discarded and the connection is closed', async () => {
    const { client, children } = harness();
    const connecting = client.connect();
    const child = at(children, 0);
    await connectWith(child);
    await connecting;

    const downEvents: StreamDownEvent[] = [];
    client.onDown((event) => downEvents.push(event));

    child.stdin.nextResults.push(false); // block
    client.write('warm');

    // Each line alone (~10.5MB after hex expansion) sits comfortably under
    // the 16MiB bound; held TOGETHER they exceed it, which is the case this
    // test targets -- the bound is a FIFO total, not a per-line limit.
    const big = 'a'.repeat(3_500_000);
    client.write(big);
    const bigBaseline = child.stdin.written.length;
    client.write(big); // second copy tips the FIFO over MAX_PENDING_STDIN_BYTES

    expect(MAX_PENDING_STDIN_BYTES).toBeGreaterThan(0);
    expect(child.killed).toBe(1);
    expect(downEvents.filter((e) => e.kind === 'reconnecting').length).toBe(1);
    // nothing new reached the OLD child's stdin from the trip itself
    expect(child.stdin.written.length).toBe(bigBaseline);

    // a later drain from the now-dead old child writes nothing further
    child.stdin.drain();
    await tick();
    expect(child.stdin.written.length).toBe(bigBaseline);
  });

  it('AC4: one legal write of MAX_STREAM_WRITE_BYTES never trips the bound', async () => {
    const { client, children } = harness();
    const connecting = client.connect();
    const child = at(children, 0);
    await connectWith(child);
    await connecting;

    const downEvents: StreamDownEvent[] = [];
    client.onDown((event) => downEvents.push(event));

    child.stdin.nextResults.push(false); // block
    client.write('warm');

    const legal = 'a'.repeat(MAX_STREAM_WRITE_BYTES);
    client.write(legal); // held, must NOT trip the bound

    expect(child.killed).toBe(0);
    expect(downEvents.length).toBe(0);

    child.stdin.drain();
    await tick();
    expect(child.stdin.written.at(-1)).toBe(`${keyLine(legal)}\n`);
  });

  it('AC5: a fresh connection after reconnect starts clean', async () => {
    vi.useFakeTimers();
    const { client, children } = harness();
    const connecting = client.connect();
    const child0 = at(children, 0);
    await connectWith(child0);
    await connecting;

    const child0Baseline = child0.stdin.written.length;
    child0.stdin.nextResults.push(false);
    client.write('a'); // blocks child0, holds nothing yet written
    client.write('held-forever'); // stays held on child0 forever
    expect(child0.stdin.written.length - child0Baseline).toBe(1); // only 'a'

    child0.emit('exit'); // connection drops -- #handleDown resets stdin state
    await vi.advanceTimersByTimeAsync(RECONNECT_BACKOFF_MS);
    await tick();

    const child1 = at(children, 1);
    await connectWith(child1);
    await tick();

    const baseline = child1.stdin.written.length;
    client.write('fresh'); // new connection must not be considered blocked
    expect(child1.stdin.written.length - baseline).toBe(1);
    expect(child1.stdin.written.at(-1)).toBe(`${keyLine('fresh')}\n`);

    // a late drain from the dead old child writes nothing to the new one
    const child1Before = child1.stdin.written.length;
    child0.stdin.drain();
    await tick();
    expect(child1.stdin.written.length).toBe(child1Before);
    expect(child0.stdin.written.length - child0Baseline).toBe(1); // 'a' only, ever
  });

  it('AC6: one line == one stdin.write, FIFO, and a mid-flush false stops right there', async () => {
    const { client, children } = harness();
    const connecting = client.connect();
    const child = at(children, 0);
    await connectWith(child);
    await connecting;

    child.stdin.nextResults.push(false); // block on the first
    client.write('l1');
    client.write('l2');
    client.write('l3');
    const baseline = child.stdin.written.length - 1; // 'l1' already written

    child.stdin.drain();
    await tick();
    expect(child.stdin.written.slice(baseline)).toEqual([
      `${keyLine('l1')}\n`,
      `${keyLine('l2')}\n`,
      `${keyLine('l3')}\n`,
    ]);

    // Second episode: flush returns false partway through.
    child.stdin.nextResults.push(false); // next direct write blocks again
    client.write('m1');
    client.write('m2');
    client.write('m3');
    const secondBaseline = child.stdin.written.length - 1; // 'm1' written

    child.stdin.nextResults.push(false); // m2's flush write fails
    child.stdin.drain();
    await tick();
    expect(child.stdin.written.slice(secondBaseline)).toEqual([
      `${keyLine('m1')}\n`,
      `${keyLine('m2')}\n`, // written (attempted), even though it returned false
    ]);

    // 'm3' is still held; a second drain flushes it.
    child.stdin.drain();
    await tick();
    expect(child.stdin.written.slice(secondBaseline)).toEqual([
      `${keyLine('m1')}\n`,
      `${keyLine('m2')}\n`,
      `${keyLine('m3')}\n`,
    ]);
  });

  it('AC7: a second blocked episode is judged only on its own held bytes', async () => {
    const { client, children } = harness();
    const connecting = client.connect();
    const child = at(children, 0);
    await connectWith(child);
    await connecting;

    // First episode: hold a line near, but under, the bound, then drain clean.
    child.stdin.nextResults.push(false);
    client.write('warm');
    const nearBound = 'a'.repeat(4_000_000); // well under MAX_PENDING_STDIN_BYTES
    client.write(nearBound);
    child.stdin.drain();
    await tick();

    const downEvents: StreamDownEvent[] = [];
    client.onDown((event) => downEvents.push(event));

    // Second episode: an equally large hold must NOT be judged against the
    // first episode's already-flushed bytes.
    child.stdin.nextResults.push(false);
    client.write('warm2');
    client.write(nearBound);
    expect(child.killed).toBe(0);
    expect(downEvents.length).toBe(0);

    child.stdin.drain();
    await tick();
    expect(child.stdin.written.at(-1)).toBe(`${keyLine(nearBound)}\n`);
  });

  it('AC8: a write after a completed flush is written directly, no further drain needed', async () => {
    const { client, children } = harness();
    const connecting = client.connect();
    const child = at(children, 0);
    await connectWith(child);
    await connecting;

    child.stdin.nextResults.push(false);
    client.write('a');
    child.stdin.drain();
    await tick();

    const baseline = child.stdin.written.length;
    client.write('c'); // no forced false queued -- must write immediately
    expect(child.stdin.written.length - baseline).toBe(1);
    expect(child.stdin.written.at(-1)).toBe(`${keyLine('c')}\n`);
  });
});
