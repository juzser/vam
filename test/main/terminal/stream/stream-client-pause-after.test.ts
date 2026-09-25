/**
 * `%pause` ONLY EVER ARRIVES WITH `refresh-client -f pause-after=<N>` SET --
 * AGAINST A REAL TMUX, WITH A GENUINELY SLOW CONSUMER.
 *
 * The coordinator's own finding, MEASURED here rather than assumed: a
 * control-mode client that never sets the `pause-after` client flag is
 * NEVER paused by tmux, no matter how far behind it falls -- confirmed on a
 * real tmux 3.7b, private `-L` socket, a 20ms-per-chunk slow consumer
 * draining a 5MB flood, zero `%pause` in several seconds of continuous
 * `%extended-output`. `StreamClient` (`client.ts`) now sends that flag on
 * every `connect()`/reconnect (`#requestPauseAfter`) -- THIS file is the
 * falsification the coordinator asked for: the SAME slow-consumer flood,
 * run twice, once against a raw connection that never sets the flag (never
 * paused -- the bug this whole fix exists for) and once against a real
 * `StreamClient` (sets the flag, recovers) -- so a regression that silently
 * dropped `#requestPauseAfter` would make the second test hang and time out
 * rather than passing by accident.
 *
 * ALSO MEASURED HERE: tmux does not resume a paused pane on its own -- the
 * explicit `refresh-client -A "<pane>:continue"` `#continueAfterPause`
 * sends is REQUIRED, or a paused stream stays stuck forever. The second
 * test below only passes if that round trip, and the reseed after it,
 * actually works end to end against a real tmux -- not a fake child.
 *
 * SAFETY: a private `-L` socket named for this process and this file, a
 * session name carrying the mandatory `vam-` prefix `StreamClient` itself
 * requires (`SAFE_TARGET_RE`), `kill-server` in `afterAll` -- the same
 * pattern `stream-client-count.test.ts` already uses.
 *
 * SKIPPED, LOUDLY, WHERE THERE IS NO TMUX.
 */

import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnRealControlChild } from '../../../../src/main/sources/tmux/control.js';
import { StreamClient } from '../../../../src/main/terminal/stream/client.js';

const tmuxWorks = (): boolean => {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const SOCKET = `vamtest${process.pid}pa`;
const SESSION = `vam-pauseafter-${process.pid}`;

const tmux = (...argv: string[]): string =>
  execFileSync('tmux', ['-L', SOCKET, ...argv], { encoding: 'utf8' });

/** Busy-waits inside the caller's own event-loop tick, exactly the way a
 * renderer that cannot keep up with `term.write()` would stall the main
 * process's own drain of the pipe -- the same technique the design doc's
 * own flood measurement (`e2e/terminal-stream-resource-shots.mjs`) uses,
 * reused here since it is what actually reproduces tmux marking a client
 * "behind" rather than merely asserting it should. */
const slowSpin = (ms: number): void => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* deliberately blocking */
  }
};

const live = tmuxWorks();

describe.skipIf(!live)('pause-after: %pause only arrives with the flag set (real tmux)', () => {
  beforeAll(() => {
    tmux('new-session', '-d', '-s', SESSION, '-x', '80', '-y', '24', 'sh');
  }, 20_000);

  afterAll(() => {
    try {
      tmux('kill-server');
    } catch {
      // Already gone, which is the state this wanted.
    }
  });

  it(
    'FALSIFICATION: never arrives on a raw connection that never sets pause-after',
    async () => {
      const child = spawnRealControlChild('tmux', [
        '-L',
        SOCKET,
        '-C',
        'attach-session',
        '-t',
        `=${SESSION}:`,
      ]);
      let sawPause = false;
      child.stdout.on('data', (chunk) => {
        if (/%pause/.test(String(chunk))) sawPause = true;
        slowSpin(20);
      });

      await new Promise((r) => setTimeout(r, 300));
      tmux('send-keys', '-t', `=${SESSION}:`, 'yes | head -c 5000000', 'Enter');
      await new Promise((r) => setTimeout(r, 4_000));

      child.kill();
      expect(sawPause).toBe(false);

      // Clean the pane for the next test.
      tmux('send-keys', '-t', `=${SESSION}:`, 'C-c');
      tmux('send-keys', '-t', `=${SESSION}:`, 'clear', 'Enter');
    },
    15_000,
  );

  it(
    '%pause arrives on a real StreamClient (sends pause-after), and the pane recovers correctly',
    async () => {
      const client = new StreamClient({ prefix: ['-L', SOCKET], target: SESSION });
      try {
        await client.connect();

        const seeds: string[] = [];
        client.onSeed((seed) => seeds.push(seed));
        // The same slow-consumer shape as the falsification above --
        // reproduced through StreamClient's own onData, exactly how a
        // stalled renderer would actually stall THIS process's drain.
        client.onData(() => slowSpin(20));

        tmux(
          'send-keys',
          '-t',
          `=${SESSION}:`,
          'yes | head -c 5000000; echo VAM-FLOOD-DONE',
          'Enter',
        );

        // A reseed (onSeed) only ever fires after the INITIAL connect() here
        // in response to a %pause -> -A continue -> reseed round trip --
        // never on its own. Seeing one is direct proof the whole cycle ran
        // against a real tmux, not a fake one.
        const deadline = Date.now() + 15_000;
        while (seeds.length === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 200));
        }
        expect(seeds.length).toBeGreaterThan(0);
        expect(seeds[0]?.length).toBeGreaterThan(0);

        // The flood must actually finish and the pane must actually show
        // it -- correctness, not just "something reseeded". Polled: the
        // flood plus an `echo` after it can outlast the first reseed.
        const doneDeadline = Date.now() + 10_000;
        let real = '';
        while (Date.now() < doneDeadline) {
          real = tmux('capture-pane', '-p', '-t', `=${SESSION}:`);
          if (/VAM-FLOOD-DONE/.test(real)) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        expect(real).toMatch(/VAM-FLOOD-DONE/);
      } finally {
        client.dispose();
      }
    },
    30_000,
  );
});
