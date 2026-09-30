/**
 * EC-22 (main side): the stream seed used to be `capture-pane -p -e -N` with
 * no `-S`, so only the visible rows reached xterm and the pane's history
 * never did -- xterm had nothing above the first screen and could not scroll
 * back. The seed now also captures a bounded history (`-S -<N>`). This file
 * drives the client over the same fake-child harness the stdin-backpressure
 * test uses; the cursor stays counted on the VISIBLE screen (the last
 * `pane_height` rows), so `seedWithCursor`'s CUP lands where it did before.
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  type ControlChildProcess,
  SEED_HISTORY_LINES,
  StreamClient,
} from '../../../../src/main/terminal/stream/client.js';
import { TERMINAL_STREAM_SCROLLBACK } from '../../../../src/renderer/panels/terminal-stream/terminal-stream-tuning.js';

class FakeChild extends EventEmitter implements ControlChildProcess {
  readonly stdin = Object.assign(new EventEmitter(), {
    written: [] as string[],
    write(data: string): boolean {
      this.written.push(data);
      return true;
    },
  });
  readonly stdout = new EventEmitter();
  kill(): void {}
  data(chunk: string): void {
    this.stdout.emit('data', chunk);
  }
}

const tick = async (n = 5): Promise<void> => {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
};

const ROWS = 4;
const CURSOR_REPLY = '@vam-cursor 1 3 2 0 0';

/** Connects a client against a fake pane holding `history` rows above the
 * visible `visible` rows. Like real tmux, the fake's `capture-pane` returns
 * the visible rows alone unless the command carries `-S -<n>`, in which case
 * it also returns the last `n` history rows. */
async function seedFor(
  history: readonly string[],
  visible: readonly string[],
): Promise<{ seed: string; sent: string[] }> {
  const child = new FakeChild();
  const client = new StreamClient({
    prefix: [],
    target: 'vam-atlas-a1b2c3',
    spawnChild: () => child,
  });
  const connecting = client.connect();
  child.data('%begin 0 0 1\n%end 0 0 1\n');
  await tick();
  child.data('%begin 1 1 1\n%3\n%end 1 1 1\n');
  await tick();
  const chain = child.stdin.written.find((l) => l.includes('capture-pane')) ?? '';
  const start = /-S -(\d+)/.exec(chain);
  const depth = start === null ? 0 : Number(start[1]);
  const rows = [...history.slice(Math.max(0, history.length - depth)), ...visible];
  child.data(`%begin 2 2 1\n${CURSOR_REPLY}\n%end 2 2 1\n`);
  await tick();
  child.data(`%begin 2 3 1\n${rows.join('\n')}\n%end 2 3 1\n`);
  await tick();
  const seed = await connecting;
  client.dispose();
  return { seed, sent: child.stdin.written };
}

const visible = ['v0', 'v1', 'v2', 'v3'];
const CUP = '\x1b[3;4H\x1b[?25h';

describe('StreamClient seed carries bounded history (EC-22m)', () => {
  it('asks capture-pane for -S -<N> as well as -p -e -N and the target', async () => {
    const { sent } = await seedFor([], visible);
    const line = sent.find((l) => l.includes('capture-pane'));
    expect(line).toBeDefined();
    expect(line).toContain(`capture-pane -p -e -N -S -${SEED_HISTORY_LINES} -t =vam-atlas-a1b2c3:`);
  });

  it('seeds history rows first, in order, then the visible rows, cursor on the visible screen', async () => {
    const history = ['h0', 'h1', 'h2'];
    const { seed } = await seedFor(history, visible);
    expect(seed).toBe(`${[...history, ...visible].join('\n')}${CUP}`);
    // The CUP row/column is unchanged from a history-less pane: it is
    // absolute on the viewport, which holds the last ROWS rows.
    expect(seed.endsWith(CUP)).toBe(true);
  });

  it('seeds a pane with no history exactly as before', async () => {
    const { seed } = await seedFor([], visible);
    expect(seed).toBe(`${visible.join('\n')}${CUP}`);
    expect(visible).toHaveLength(ROWS);
  });

  it('bounds N to a positive integer no larger than the renderer scrollback', () => {
    expect(Number.isInteger(SEED_HISTORY_LINES)).toBe(true);
    expect(SEED_HISTORY_LINES).toBeGreaterThan(0);
    expect(SEED_HISTORY_LINES).toBeLessThanOrEqual(TERMINAL_STREAM_SCROLLBACK);
  });
});
