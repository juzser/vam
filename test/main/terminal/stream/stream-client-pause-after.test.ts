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
 * ── WHY THE SECOND TEST WAS FLAKY ON CI (RCA, D-<pending>) ────────────────
 * PR #498's CI (run 36125880008, job 108041761291) failed on this file
 * without having touched it -- purely load-dependent. TWO DISTINCT bugs in
 * THIS TEST, both reproduced locally (macOS, 10 cores) by running the OLD
 * version of this file repeatedly under 20 competing `yes > /dev/null`
 * processes (heavier oversubscription than a shared CI runner, but the
 * SAME shape of CPU starvation):
 *
 * (1) THE FIXED 1.5s PAUSE WINDOW RACED THE FLOOD'S OWN PRODUCTION RATE.
 *     tmux's `pause-after` fires once ITS OWN write to a client's socket
 *     has been blocked for longer than the threshold -- which requires the
 *     `yes | head -c 5000000` pipeline to actually have been SCHEDULED and
 *     to have produced enough bytes to fill the kernel pipe/socket buffers
 *     in the first place. On a CPU-starved runner, process scheduling for
 *     that pipeline (and tmux's own server) can be delayed well past the
 *     fixed 1.5s the OLD test paused its reader for, so `.resume()` fires
 *     before any real backlog -- let alone backlog older than
 *     `PAUSE_AFTER_SECONDS` -- ever built up. MEASURED locally: the FIRST
 *     attempt failed with `raw` containing nothing but the initial
 *     `capture-pane` reply -- zero `%pause`, zero `%output` at all -- an
 *     exact match for the CI failure's first assertion.
 *
 * (2) THE RETRY REUSED THE SAME, UNCLEANED PANE -- A CROSS-ATTEMPT RACE
 *     ON `groundTruth`. `beforeAll` creates ONE session for the whole
 *     file; nothing reset the pane between the first attempt and vitest's
 *     own `retry: 1`. When attempt 1 failed (as in (1)), it had ALREADY
 *     sent `yes | head -c 5000000; echo VAM-FLOOD-DONE` to the pane before
 *     throwing, and that pipeline kept running, unobserved, in the
 *     background. The retry then: seeded itself from -- and had its
 *     `%output` listener fed by -- attempt 1's STILL-RUNNING flood, so its
 *     OWN `liveText` could show `VAM-FLOOD-DONE` from attempt 1's leftover
 *     run while the retry's OWN freshly-queued flood command was still
 *     sitting unread in the pty's input queue (the shell was still busy
 *     with attempt 1's pipeline, which does not read stdin). By the time
 *     the retry's OWN flood finally started and this file asked for a
 *     FRESH, independent `capture-pane` (`groundTruth`), that told the
 *     truth: the pane was still mid-flood, no marker yet. MEASURED
 *     locally, byte-for-byte the same failure as CI's own log: `raw`
 *     carries `%pause `/`%continue`, `liveText` matches
 *     `/VAM-FLOOD-DONE/`, and `groundTruth` -- checked at
 *     `stream-client-pause-after.test.ts:244` in both the CI log and this
 *     file's own local repro -- is still bare `y` lines.
 *
 * THE FIX, both load-independent:
 *   - A DUTY-CYCLE pause instead of one fixed window: pause the raw reader,
 *     briefly resume it to let `%pause`/`%continue` latch if they arrived
 *     (see `sawPause`/`sawContinue` below), and repeat -- up to a GENEROUS
 *     deadline -- rather than gambling that 1.5s of pausing lines up with
 *     however fast this runner happens to produce bytes today.
 *   - A CONTINUOUS `yes` (no `head -c`, killed with `C-c` only once this
 *     file has ITSELF observed the causal chain -- `%pause` then
 *     `%continue` -- on the wire) instead of a fixed-size flood racing a
 *     fixed wait, so there is always more output on the way regardless of
 *     how slowly this runner produces it.
 *   - AN EXPLICIT PANE RESET, with a per-attempt sentinel polled back
 *     before anything else runs, at the TOP of the flaky test -- so
 *     vitest's own retry (or a second local run) never inherits a previous
 *     attempt's still-running flood. A per-attempt DONE marker
 *     (`VAM-FLOOD-DONE-<timestamp>`) closes the loophole for good: even if
 *     the reset somehow failed to fully settle, a stale marker from a
 *     different attempt could never match this attempt's own regex.
 *   - Every wait below is a POLL against a generous deadline, never a bare
 *     `setTimeout`, so this file's own timing choices are never again the
 *     thing a loaded CI runner falsifies. `%pause`/`%continue` are LATCHED
 *     synchronously as their chunk arrives (see the `observingSpawn` note
 *     below) rather than re-scanned from an accumulated buffer -- a second,
 *     independently MEASURED bug this file's own first draft introduced
 *     and fixed before it ever reached review (see that note).
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

/** The one shape every generous, condition-based wait in this file uses --
 * `stream-client-count.test.ts`'s own `while (... && Date.now() < until)`
 * poll, named and reused rather than copied five times over. Returns
 * whether `check()` was ever true, so a caller can assert on the SAME
 * condition it polled for and get a message that names what never
 * happened, rather than a generic timeout. */
const pollUntil = async (
  check: () => boolean,
  deadlineMs: number,
  intervalMs = 200,
): Promise<boolean> => {
  const deadline = Date.now() + deadlineMs;
  while (!check() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return check();
};

/** Appends `chunk`, keeping only the last `MAX_TRACKED_CHARS` -- MEASURED
 * the hard way, running the falsification drill below (production's own
 * `#requestPauseAfter` commented out) against a CONTINUOUS `yes`: with
 * pause-after genuinely broken, `%pause` never arrives, so the duty-cycle
 * stall below runs its full generous deadline with an entirely unthrottled
 * flood behind it the whole time. An unbounded accumulator re-scanned on
 * every poll (this file's own first draft: an array of chunks, re-joined
 * from scratch on every check) grew fast enough to crash the Vitest worker
 * outright -- a V8 OOM inside `RegExpReplace`, not a clean assertion
 * failure. Every marker this file ever looks for is short and always
 * arrives at (or near) the CURRENT tail of the stream, so trimming old
 * history changes nothing this file asserts on, in either the fast-path or
 * the broken-production path. */
const MAX_TRACKED_CHARS = 200_000;
const appendBounded = (acc: string, chunk: string): string => {
  const next = acc + chunk;
  return next.length > MAX_TRACKED_CHARS ? next.slice(-MAX_TRACKED_CHARS) : next;
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
  // real-timing guard. Safe to keep now that `#resetPane` runs at the top
  // of the test body on EVERY invocation (the initial attempt and any
  // retry alike): a retry can no longer inherit a previous attempt's
  // still-running flood (the module header's own RCA), so this is purely
  // a safety net for a genuinely rare real-tmux hiccup, never a way to
  // paper over this file's own timing.
  it('%pause arrives on a real StreamClient (sends pause-after), and the pane recovers correctly', {
    retry: 1,
    timeout: 120_000,
  }, async () => {
    // THE RESET (module header, bug (2)): send an interrupt in case a
    // PREVIOUS attempt left a flood running, then confirm the shell is
    // actually back at a prompt and has executed a fresh, per-attempt
    // sentinel before this attempt touches the pane at all. Without this,
    // vitest's own retry can start while the FIRST attempt's own
    // `yes`/`head` pipeline is still mid-flight in the pane, feeding this
    // attempt's seed and `%output` with the wrong run's text.
    const ready = `VAM-READY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    tmux('send-keys', '-t', `=${SESSION}:`, 'C-c');
    tmux('send-keys', '-t', `=${SESSION}:`, `clear; echo ${ready}`, 'Enter');
    const settled = await pollUntil(
      () => tmux('capture-pane', '-p', '-t', `=${SESSION}:`).includes(ready),
      10_000,
    );
    expect(settled).toBe(true);

    // TEES the real child's raw stdout (via `StreamClient`'s own public
    // `spawnChild` injection seam -- a SECOND listener on the SAME
    // `child.stdout`, never interfering with `StreamClient`'s own
    // internal parsing) so this test can assert the WIRE PROTOCOL
    // directly -- tmux actually sent `%pause`, and this client actually
    // sent the `-A "<pane>:continue"` resume tmux requires -- rather than
    // only inferring both from a reseed firing. Also the STALL LEVER: a
    // Node `Readable` genuinely pauses ALL its listeners (not just this
    // one) while `.pause()`d, until `.resume()`.
    // LATCHED, not re-scanned from an accumulated buffer: MEASURED, the
    // hard way, running this exact drill -- a resume after the duty-cycle
    // stall below can flush a burst large enough that, by the time a
    // DEFERRED poll gets around to checking a bounded tail buffer, that
    // burst has ALREADY pushed `%pause` itself out of the tracked window
    // (this file's own first draft: `appendBounded`'s trimming, working
    // exactly as designed, but against the wrong target -- it should bound
    // MEMORY, not decide what this file gets to notice). Checking
    // synchronously, INSIDE the same `'data'` handler invocation that
    // delivers the matching text, catches it regardless of how much MORE
    // data floods in immediately after -- Node runs one listener call to
    // completion before the next `'data'` event is even dispatched.
    // `pauseTail` is a SEPARATE, small rolling window used only to catch a
    // marker split across a chunk boundary; once `sawPause`/`sawContinue`
    // latch true they never go false again.
    let sawPause = false;
    let sawContinue = false;
    let pauseTail = '';
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
      child.stdout.on('data', (chunk) => {
        const text = String(chunk);
        const window = pauseTail + text;
        if (!sawPause && /%pause /.test(window)) sawPause = true;
        if (!sawContinue && /%continue/.test(window)) sawContinue = true;
        // Comfortably wider than either marker, just enough to survive a
        // chunk boundary landing mid-marker.
        pauseTail = window.slice(-256);
      });
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
        liveText = appendBounded(liveText, chunk);
      });

      // CONTINUOUS, not a fixed 5MB `head -c` (module header, bug (1)): a
      // slow runner needs MORE wall-clock time to produce the same
      // backlog, not less, so a size-capped flood can finish (or simply
      // not yet have produced enough to overflow a kernel buffer) before
      // this file ever gets a chance to observe backpressure. `yes` alone
      // never stops on its own; this file explicitly interrupts it below,
      // only once the causal chain has actually been observed.
      tmux('send-keys', '-t', `=${SESSION}:`, 'yes', 'Enter');

      // A DUTY-CYCLE STALL, not one fixed window (module header, bug (1)).
      // MEASURED, the hard way, across several iterations of this file: a
      // single fixed pause gambles that tmux crosses its own
      // `PAUSE_AFTER_SECONDS` age threshold DURING that exact window,
      // which depends entirely on how fast THIS runner happens to be able
      // to schedule the flood today. Pausing the raw reader for 1s, then
      // resuming it just long enough to drain and inspect what arrived,
      // then pausing again -- repeated up to a generous 25s deadline --
      // keeps this client NET SLOW for as long as it takes, on a fast
      // machine or a starved one alike, rather than betting on a single
      // window. `.pause()` stops Node reading from the OS pipe AT ALL
      // (for every listener on it, including `StreamClient`'s own), so the
      // pipe's kernel buffer fills and tmux's own write blocks -- exactly
      // the real condition `pause-after` exists to detect.
      const pauseDeadline = Date.now() + 25_000;
      while (!sawPause && Date.now() < pauseDeadline) {
        realStdout?.pause();
        await new Promise((r) => setTimeout(r, 1_000));
        realStdout?.resume();
        await new Promise((r) => setTimeout(r, 300));
      }

      // THE PROPERTY ITSELF, asserted directly rather than merely
      // inferred from a reseed happening to fire: tmux actually sent
      // %pause for this client's own pane. Checked BEFORE the flood is
      // ever interrupted below, so a genuine regression here (pause-after
      // silently dropped) fails on THIS assertion rather than stalling
      // out waiting for a DONE marker that can never arrive while the
      // pane stays paused.
      expect(sawPause, 'tmux never sent %pause for this pane').toBe(true);

      // GENEROUS AND CONDITION-BASED: wait for this client to have sent
      // the explicit resume tmux requires (MEASURED: tmux never resumes a
      // paused pane on its own -- see client.ts's own `#continueAfterPause`
      // header) and gotten its reply. `%continue` appears here whether it
      // arrived as a bare notification line or nested inside the `-A`
      // command's own reply block (measured to be the real shape) -- a
      // plain substring search catches either.
      await pollUntil(() => sawContinue, 15_000);
      expect(sawContinue, 'this client never sent -A "<pane>:continue" back').toBe(true);

      // THE CAUSAL CHAIN'S NEXT LINK: only NOW, with pause and continue
      // both independently confirmed on the wire, interrupt the flood and
      // print a marker unique to THIS attempt (module header, bug (2)) --
      // so even if some future change reintroduces a reset gap, a stale
      // marker from a different attempt can never match this regex.
      const done = `VAM-FLOOD-DONE-${Date.now()}`;
      tmux('send-keys', '-t', `=${SESSION}:`, 'C-c');
      tmux('send-keys', '-t', `=${SESSION}:`, `echo ${done}`, 'Enter');
      const doneMarker = new RegExp(done);

      // NEVER STAYS PAUSED: the client's own view must show the flood's
      // trailing marker -- proof the pane recovered from THIS client's
      // point of view, not merely that tmux's own independent buffer
      // moved on without it. GENEROUS AND CONDITION-BASED, not a fixed
      // sleep: CI found the ORIGINAL version of this test failing at
      // 11.9s on a slower Linux runner because a fixed 10s poll was
      // simply too short there -- a wall-clock race in the TEST, not
      // proof of a bug.
      const sawLive = await pollUntil(() => doneMarker.test(liveText), 30_000);
      expect(sawLive).toBe(true);
      expect(liveText).toMatch(doneMarker);

      // CORRECTNESS cross-check against ground truth: what this client
      // ended up seeing agrees with tmux's own `capture-pane` for the
      // same pane. Polled too, not a single post-hoc snapshot: spawning a
      // brand new `tmux` CLI process (`execFileSync`) to ask is itself
      // slower under the exact CPU contention this file exists to survive
      // -- CI's own log showed this specific assertion racing a
      // still-in-flight flood (module header, bug (2)); polling here
      // removes that race regardless of which cause produced it.
      let groundTruth = '';
      const sawGroundTruth = await pollUntil(() => {
        groundTruth = tmux('capture-pane', '-p', '-t', `=${SESSION}:`);
        return doneMarker.test(groundTruth);
      }, 10_000);
      expect(sawGroundTruth).toBe(true);
      expect(groundTruth).toMatch(doneMarker);
    } finally {
      client.dispose();
    }
  });
});
