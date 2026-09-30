/**
 * THE TUNING KNOBS `TerminalStreamTab.tsx`'S XTERM INSTANCE SHIPS WITH --
 * pulled out of that file so a NODE-SIDE guard (`e2e/terminal-stream-
 * resource-shots.mjs`) can bundle and measure the SAME numbers the app
 * actually ships, rather than a second, hand-copied set of literals that
 * can silently drift out of step with them (a guard-quality finding: the
 * resource guard's own flood measurement used to construct its `Terminal`
 * at the LATENCY harness's default `scrollback: 2000`
 * (`terminal-stream-latency-harness.html`, tuned for a DIFFERENT
 * measurement) and hand-copied the water-mark literals inline, so a future
 * change to either number here would leave that guard quietly measuring
 * something vam no longer ships).
 *
 * ZERO DEPENDENCIES, DELIBERATELY: no React, no `@xterm/xterm`, no CSS
 * import -- this file exists so it can be `esbuild`-bundled on its own,
 * cheaply, from a plain Node script (`bundleOf`, `terminal-stream-resource-
 * shots.mjs`'s own helper), the same way that script already bundles
 * `src/main/terminal/stream/client.ts` and `src/main/sources/tmux/spawn.ts`.
 * A file that pulled in `TerminalStreamTab.tsx`'s own imports (a `.css`
 * import among them) would not bundle that way at all.
 */

/** The shipped `Terminal` option, `TerminalStreamTab.tsx`'s own
 * `scrollback: 5000`. See `e2e/terminal-stream-resource-shots.mjs`'s
 * `heapAfterLines` for the measurement this number is chosen against. */
export const TERMINAL_STREAM_SCROLLBACK = 5000;

/**
 * RENDERER-SIDE BACKPRESSURE (the coordinator's own follow-up to the
 * pause-after fix in `main/terminal/stream/client.ts`). `TerminalStreamTab.tsx`
 * used to hand every `onData` chunk straight to `term.write()` with nothing
 * ever tracking how much of it xterm had actually finished PARSING --
 * `write()` queues internally and returns immediately, so a long flood (a
 * verbose build log, `cat` of a large file) could grow that internal queue
 * unboundedly with nothing there ever noticing, REGARDLESS of whether
 * `pause-after` also bounds what MAIN's own drain of tmux falls behind by
 * -- that fix is one layer up and does not know or care how fast xterm
 * itself can keep up.
 *
 * `term.write(data, callback)`'s callback fires once xterm has actually
 * PARSED that call's data (xterm's own documented contract) --
 * `TerminalStreamTab.tsx`'s own `pendingBytes` tracks exactly that: bytes
 * handed to `term.write` but not yet parsed, never merely "received over
 * IPC".
 *
 * `HIGH_WATER_MARK` -- the low end of the operator's own suggested 1-2MB
 * range. `LOW_WATER_MARK` -- a quarter of it, a wide hysteresis gap so
 * draining right at the edge does not flap between dropping and forwarding
 * on every single chunk.
 *
 * DROP AND RESEED, not "ask main to pause the stream" (the coordinator's own
 * other option): once dropping starts, no new chunk is EVER handed to
 * `term.write()`, so `pendingBytes` can only fall from there -- renderer
 * memory is bounded with no new main<->renderer pause/resume IPC round trip
 * at all. Once it drains back under the low mark the screen is PROVABLY
 * stale (real data was silently dropped in between), so "resume" means
 * reconnecting -- the exact `teardownStream()`-then-`connect()` pair
 * `TerminalStreamTab.tsx` already runs for a hidden pane becoming visible
 * again, reused rather than inventing a second, narrower resync primitive.
 */
export const TERMINAL_STREAM_HIGH_WATER_MARK = 2 * 1024 * 1024;
export const TERMINAL_STREAM_LOW_WATER_MARK = TERMINAL_STREAM_HIGH_WATER_MARK / 4;

/**
 * WHEEL SPEED, both renderers (operator round 8, EC-69): one wheel notch
 * moves 3 lines, matching macOS Terminal and iTerm, and Alt-held moves 5x
 * that. xterm's own defaults are 1 line and 5 (its `scrollSensitivity` /
 * `fastScrollSensitivity` options); `TerminalTab.tsx`'s `wheelNotches`
 * multiplies its tick count by `TERMINAL_WHEEL_LINES_PER_NOTCH` too, so the
 * two screens scroll at the same pace. No setting: one named constant.
 */
export const TERMINAL_WHEEL_LINES_PER_NOTCH = 3;
export const TERMINAL_FAST_SCROLL_FACTOR = 5;
