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
import {
  type SpawnControlChild,
  spawnRealControlChild,
} from '../../../../src/main/sources/tmux/control.js';
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

  it('FALSIFICATION: never arrives on a raw connection that never sets pause-after', async () => {
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
  }, 15_000);

  // RETRY ONCE, matching #493's own convention for exactly this class of
  // real-timing guard: a real tmux, a real socket and a real flood still
  // leave SOME residual timing this test cannot fully pin down (how long
  // tmux itself takes to notice and report %pause once genuinely behind).
  // One retry covers that without widening every ordinary run's budget to
  // cover a rare miss.
  it('%pause arrives on a real StreamClient (sends pause-after), and the pane recovers correctly', {
    retry: 1,
    timeout: 30_000,
  }, async () => {
    // TEES the real child's raw stdout (via `StreamClient`'s own public
    // `spawnChild` injection seam -- a SECOND listener on the SAME
    // `child.stdout`, never interfering with `StreamClient`'s own
    // internal parsing) so this test can assert the WIRE PROTOCOL
    // directly -- tmux actually sent `%pause`, and this client actually
    // sent the `-A "<pane>:continue"` resume tmux requires -- rather than
    // only inferring both from a reseed firing. Also the STALL LEVER: a
    // Node `Readable` genuinely pauses ALL its listeners (not just this
    // one) while `.pause()`d, until `.resume()`.
    const rawChunks: string[] = [];
    // `ControlChildProcess['stdout']` (`control.ts`) is deliberately typed
    // minimally (`{ on(event: 'data', ...) }`) -- every other caller only
    // ever needs that. `spawnRealControlChild` is a real `child_process.
    // spawn()` underneath, whose `.stdout` really is a full `Readable`
    // with `.pause()`/`.resume()`; this test's own local, wider type
    // names exactly the extra surface it needs rather than casting to
    // `any`.
    let realStdout: { pause(): void; resume(): void } | undefined;
    const observingSpawn: SpawnControlChild = (binary, argv) => {
      const child = spawnRealControlChild(binary, argv);
      realStdout = child.stdout as unknown as { pause(): void; resume(): void };
      child.stdout.on('data', (chunk) => rawChunks.push(String(chunk)));
      return child;
    };

    const client = new StreamClient({
      prefix: ['-L', SOCKET],
      target: SESSION,
      spawnChild: observingSpawn,
    });
    try {
      await client.connect();

      // THE CLIENT'S OWN VIEW, not tmux's independent `capture-pane` --
      // `capture-pane` reads the pane's CURRENT buffer regardless of
      // whether any control client is stuck paused (a pause only stops
      // tmux SENDING to that one client; it never stops the pane's own
      // process or tmux's own buffer of it), so polling `capture-pane`
      // alone cannot tell "the flood finished" apart from "this CLIENT is
      // still stuck and will never say so". `liveText` is rebuilt from
      // exactly what this client itself received: replaced whole on every
      // seed (a fresh `capture-pane` snapshot, `StreamClient`'s own
      // contract), appended on every live `%output` chunk in between --
      // the direct answer to "did the pane recover, from THIS client's
      // own point of view, or does it stay paused".
      let liveText = '';
      client.onSeed((seed) => {
        liveText = seed;
      });
      client.onData((chunk) => {
        liveText += chunk;
      });

      tmux(
        'send-keys',
        '-t',
        `=${SESSION}:`,
        'yes | head -c 5000000; echo VAM-FLOOD-DONE',
        'Enter',
      );

      // A REAL STALLED READER, not a per-chunk timing guess. MEASURED,
      // the hard way, across several iterations of this file: a
      // 20ms-per-chunk busy-wait's actual effect depends entirely on how
      // many bytes tmux happens to batch into each chunk -- when tmux (or
      // the OS scheduler) batches LARGE chunks (thousands of lines at
      // once, observed directly), the SAME 20ms/chunk delay throttles
      // total throughput far less than when chunks arrive small and
      // frequent, so whether the client ever falls a full pause-after
      // SECOND behind became a coin flip that depended on unrelated
      // system conditions -- 3 separate local test sessions each saw both
      // outcomes. Genuinely pausing the underlying stream is
      // deterministic regardless: `.pause()` stops Node reading from the
      // OS pipe AT ALL (for every listener on it, including `StreamClient`'s
      // own), so the pipe's kernel buffer fills and tmux's own write
      // blocks -- exactly the real condition `pause-after` exists to
      // detect -- for as long as this test decides, independent of chunk
      // size. 1.5s comfortably clears the 1s `PAUSE_AFTER_SECONDS`
      // threshold (`client.ts`) without depending on exactly how long
      // tmux takes to notice.
      realStdout?.pause();
      await new Promise((r) => setTimeout(r, 1_500));
      realStdout?.resume();

      // GENEROUS AND CONDITION-BASED, not a fixed sleep: CI found the
      // ORIGINAL version of this test failing at 11.9s on a slower Linux
      // runner because a fixed 10s poll for `capture-pane`'s own text was
      // simply too short there -- a wall-clock race in the TEST, not
      // proof of a bug. Polled every 200ms, on the CLIENT'S OWN
      // accumulated view. Once resumed, everything buffered during the
      // stall arrives in one burst and the remainder of the flood drains
      // unthrottled (~2.5s wall for a full 5MB flood with no slow
      // consumer at all, this repo's own `terminal-stream-resource-
      // shots.mjs` measurement) -- 15s is generous against that, not
      // against a chunk-size-dependent guess.
      const liveDeadline = Date.now() + 15_000;
      while (!/VAM-FLOOD-DONE/.test(liveText) && Date.now() < liveDeadline) {
        await new Promise((r) => setTimeout(r, 200));
      }

      const raw = rawChunks.join('');
      // THE PROPERTY ITSELF, asserted directly rather than merely
      // inferred from a reseed happening to fire: tmux actually sent
      // %pause for this client's own pane, and this client actually sent
      // the explicit resume tmux requires (MEASURED: tmux never resumes a
      // paused pane on its own -- see client.ts's own `#continueAfterPause`
      // header). `%continue` appears here whether it arrived as a bare
      // notification line or nested inside the `-A` command's own reply
      // block (measured to be the real shape) -- a plain substring search
      // catches either.
      expect(raw).toMatch(/%pause /);
      expect(raw).toMatch(/%continue/);

      // NEVER STAYS PAUSED: the client's own view must show the flood's
      // trailing marker -- proof the pane recovered from THIS client's
      // point of view, not merely that tmux's own independent buffer
      // moved on without it.
      expect(liveText).toMatch(/VAM-FLOOD-DONE/);

      // CORRECTNESS cross-check against ground truth: what this client
      // ended up seeing agrees with tmux's own `capture-pane` for the
      // same pane at the same point.
      const groundTruth = tmux('capture-pane', '-p', '-t', `=${SESSION}:`);
      expect(groundTruth).toMatch(/VAM-FLOOD-DONE/);
    } finally {
      client.dispose();
    }
  });
});
