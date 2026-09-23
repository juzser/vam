/**
 * THE TERMINAL SCROLLS -- against a REAL tmux, read by the REAL main-process
 * read path, in both of the situations the operator has met.
 *
 * ── PHASE E: THE ARROWS REACH THE PROGRAM; Shift+PageUp IS VAM'S OWN ─────
 * vam/terminal-arrows. The operator's report: "in the terminal, the arrow
 * keys can't be used to select options." See the phase's own header, well
 * below the other four, for the measurement.
 *
 * ── PHASE A: A SHELL WITH SCROLLBACK, WHILE TYPING ───────────────────────
 * The report against #437, translated: "can't scroll in the terminal view".
 * An `echo` read answers with the SCREEN alone (its measured win, 7,760
 * bytes against 86,260) and the tab drew that answer as the whole view, so
 * the scrollback left the DOM while keys were going in. #439 splices the
 * screen back onto the drawn window (`composeScreen`). This phase types
 * into a real shell with three hundred lines above its prompt and asserts
 * the pane still overflows, a wheel mid-burst really moves it, and the
 * position holds.
 *
 * ── PHASE B: A PROGRAM THAT OWNS THE SCREEN AND THE MOUSE ────────────────
 * The report against #439: "still can't scroll". The first version of this
 * guard answered `read` from a stub and passed; the build it passed on was
 * still broken, because the defect was never the splice. MEASURED on a
 * private socket (tmux 3.7b) against Claude Code 2.1.278 started the way vam
 * starts it, straight into `claude` with `"tui": "fullscreen"` in the
 * operator's settings:
 *
 *   alternate_on=1  history_size=0  mouse_any_flag=1
 *
 * and `capture-pane -S -500` answering with exactly the pane's rows. The
 * program draws in the alternate screen, tmux keeps no scrollback for it, so
 * the pane holds one boxful and a wheel over it has nothing to move -- while
 * the program, which asked for mouse reports precisely so it could scroll
 * its own viewport, never hears about the wheel. (#439's premise -- the
 * screen is a byte-suffix of the window -- was `cmp`-identical on that same
 * session; it fixed a collapse that was not happening.) This phase runs
 * `e2e/fixtures/mouse-owner.cjs` in the pane, which does exactly what Claude
 * Code does, and asserts a wheel over the pane moves ITS viewport.
 *
 * FALSIFIED on #439 with this file's real read in place: phase A green,
 * phase B red on `a wheel over the pane reaches the program that owns it`
 * -- the viewport's first line unchanged after the wheel -- which is the
 * operator's report exactly.
 *
 * ── WHY EVERYTHING HERE IS REAL ─────────────────────────────────────────
 * `read`, `resize` and `send` are the app's own `readSessionPane`,
 * `readAimedPane`, `resizeSessionPane` and `sendToPane`
 * (`src/main/terminal/pane.ts`), bundled from source and bridged into the
 * page with `exposeFunction`, aimed at a throwaway session on a PRIVATE tmux
 * socket this script creates and kills. The renderer receives exactly the
 * bytes the app's renderer gets; keys and wheel reports land in the same
 * pane the app would send them to.
 *
 * THE RUNNER IS `createControlTmuxRunner`, NOT `createTmuxRunner` -- the
 * SAME persistent control-mode client `main/index.ts` actually wires the
 * Terminal tab to (`sources/tmux/control.ts`). This guard exists to catch
 * exactly the class of regression a runner swap could cause -- the wheel
 * report and Shift+Enter's literal newline both ride the `-H` hex rewrite
 * `control-protocol.ts` gives every `send-keys -l --` call, and a guard that
 * exercised the plain `execFile` path here would never notice if that
 * rewrite broke either one. `terminal-typing-latency-shots.mjs` measures
 * the LATENCY difference the two runners make; this one measures that the
 * behaviour is unchanged.
 *
 * NEEDS `tmux` ON PATH. Without one the guard prints a loud SKIP and exits
 * 0 -- honestly: a stub that satisfies the property under test is what let
 * the broken build ship, and there is no faithful stand-in for tmux. A CI
 * runner that wants this guard to assert installs tmux (`apt-get install
 * tmux` / `brew install tmux`).
 *
 * `?demo=1` is kept on the URL for the reason `terminal-chrome-shots.mjs`
 * records.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/terminal-echo-scroll-shots.mjs http://localhost:5520 docs/ui
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const SESSION = 'atlas-echo-scroll';
const BRANCH = 'work/atlas-echo-scroll';
/** The project id vam records on the tmux session and matches back (`@vam-project`). */
const PROJECT = 'p1';
/** A private tmux server, so nothing here can see or touch the operator's own. */
const SOCKET = 'vam-e2e-scroll';
const TMUX_SESSION = 'vam-e2e-scroll-a1b2c3';
const COLUMNS = 200;
const ROWS = 50;
/** The window read's history, mirrored from `main/terminal/ipc.ts`. */
const HISTORY = 500;

/* ── tmux, or an honest skip ────────────────────────────────────────────── */

const which = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
if (which.error || which.status !== 0) {
  console.warn(
    'SKIP  terminal-echo-scroll-shots.mjs: no `tmux` on PATH. This guard reads a REAL tmux pane ' +
      "through the app's own read path because a stub is what let the scroll collapse ship (#439). " +
      'Install tmux on this runner for it to assert anything.',
  );
  process.exit(0);
}
console.log(`tmux: ${which.stdout.trim()} on private socket -L ${SOCKET}`);

const env = { ...process.env, LC_CTYPE: 'en_US.UTF-8' };
const tmux = (...args) => execFileSync('tmux', ['-L', SOCKET, ...args], { env, encoding: 'utf8' });
const killServer = () => spawnSync('tmux', ['-L', SOCKET, 'kill-server'], { env });

killServer();
tmux('new-session', '-d', '-s', TMUX_SESSION, '-x', String(COLUMNS), '-y', String(ROWS), 'sh');
tmux('set-option', '-t', `=${TMUX_SESSION}:`, '@vam-project', PROJECT);
tmux(
  'send-keys',
  '-t',
  `=${TMUX_SESSION}:`,
  '-l',
  // NOT `clear`: on Linux ncurses its terminfo `clear` carries `E3`
  // (`ESC [ 3 J`, "erase scrollback"), which tmux honours by DROPPING THE
  // HISTORY -- measured: `history_size` 103 -> 0 on tmux 3.7b, and the same
  // on the CI runner's 3.4, where this phase reddened with "714 vs 714, of
  // 0" while the fill had visibly landed. macOS's terminfo has no `E3`, so
  // the laptop never saw it. `ESC [ H ESC [ 2 J` clears the screen alone.
  'i=1; while [ $i -le 300 ]; do printf "\\033[3$((i%7+1))m line %03d some coloured text \\033[0m trailing   \\n" $i; i=$((i+1)); done; printf "\\033[H\\033[2J"; i=1; while [ $i -le 8 ]; do printf "\\033[3$((i%7+1))m after clear %03d\\033[0m\\n" $i; i=$((i+1)); done\n',
);

/* ── the app's own read path, bundled from source ───────────────────────── */

const require = createRequire(new URL('../node_modules/.pnpm/node_modules/', import.meta.url));
const esbuild = require('esbuild');
const bundleDir = mkdtempSync(join(tmpdir(), 'vam-echo-scroll-'));
const bundleOf = async (entry) => {
  const outfile = join(bundleDir, `${entry.replace(/[/.]/g, '_')}.mjs`);
  await esbuild.build({
    entryPoints: [new URL(`../${entry}`, import.meta.url).pathname],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
};
const { readSessionPane, readAimedPane, resizeSessionPane, sendToPane } = await bundleOf(
  'src/main/terminal/pane.ts',
);
const { createControlTmuxRunner } = await bundleOf('src/main/sources/tmux/control.ts');

// The runner `main/index.ts` actually wires the Terminal tab to -- see the
// module note above. `.dispose()`d in `finally`, below.
const real = createControlTmuxRunner('tmux');
/** The app's runner, aimed at the private socket. Same argv otherwise. */
const run = (argv) => real(['-L', SOCKET, ...argv]);

// Wait for the MEASURED condition, not a sleep: the last line of the fill
// is on screen AND tmux holds the scrollback above it (the 300 lines, less
// the screen that scrolled off, is at least 250). A runner is far slower
// than a laptop, and a fill that printed but left no history is exactly the
// silent state this phase exists to catch (see the `clear` note above).
{
  const until = Date.now() + 30_000;
  for (;;) {
    const view = await readSessionPane(run, PROJECT, undefined, undefined, HISTORY);
    const depth = Number(
      tmux('display-message', '-p', '-t', `=${TMUX_SESSION}:`, '#{history_size}').trim(),
    );
    if (view.kind === 'ok' && view.text.includes('after clear 008') && depth >= 250) break;
    if (Date.now() > until) {
      console.error(
        `FAIL  the private tmux session never printed its fill with scrollback (history_size ${depth}):`,
        JSON.stringify(view).slice(0, 300),
      );
      killServer();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` -- ${detail}`}`);
  failures.push(label);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

/**
 * THE BRIDGE. `read` mirrors `main/terminal/ipc.ts`: `echo` asks for no
 * history, the other two for `HISTORY`; a `poll` proves the pairing through
 * `readSessionPane` and refreshes the aim, an echo rides the aim through
 * `readAimedPane`. The bytes that reach the renderer are the bytes the
 * app's renderer gets.
 */
let aimed = null;
const modes = [];
let reads = 0;
await page.exposeFunction('__realRead', async (mode) => {
  reads += 1;
  modes.push(mode ?? 'absent');
  const history = mode === 'echo' ? 0 : HISTORY;
  let view;
  if (mode !== 'poll' && aimed !== null) {
    view = await readAimedPane(run, aimed, history);
    if (view.kind !== 'ok') aimed = null;
  } else {
    view = await readSessionPane(run, PROJECT, undefined, undefined, history);
    aimed = view.kind === 'ok' ? view.name : null;
  }
  return view;
});
const sent = [];
await page.exposeFunction('__realSend', async (key) => {
  if (aimed === null) {
    sent.push({ key, landed: 'unaimed' });
    return 'unaimed';
  }
  const landed = await sendToPane(run, aimed, key);
  sent.push({ key, landed });
  return landed;
});
await page.exposeFunction('__realResize', (columns, rows) =>
  resizeSessionPane(run, PROJECT, { columns, rows }),
);

await page.addInitScript(
  ({ session, branch }) => {
    globalThis.window.__resized = [];
    const unavailable = () =>
      Promise.resolve({
        kind: 'unavailable',
        error: { kind: 'unreachable', code: 'stub', message: 'stub source' },
      });
    globalThis.window.api = {
      describe: async () => ({
        id: 'stub',
        label: 'Stub',
        capabilities: {
          liveUpdates: false,
          recordPrompt: false,
          deliverPrompt: false,
          promptAttachments: false,
          slashCommands: false,
          renameSession: false,
          closeSession: false,
          createSession: false,
          governance: false,
          pullRequests: false,
          terminal: true,
          agentRoster: false,
          resumeSession: false,
        },
        declines: {},
        viewerScope: 'operator',
      }),
      load: async () => [
        {
          id: 'p1',
          name: 'stub project',
          sessions: [
            {
              id: session,
              title: 'stub session',
              icon: null,
              epic: null,
              branch,
              status: 'waiting',
              runningAgents: 0,
              activity: null,
              age: '2m',
              decisions: [
                { id: 'd1', label: 'step 1', input: 'a turn', output: 'an answer', commands: [] },
              ],
            },
          ],
        },
      ],
      subscribe: () => () => {},
      recordPrompt: async () => {},
      renameSession: async () => {},
      closeSession: async () => {},
      createSession: async () => {},
      createSessionIn: async () => {},
      pickImageAttachment: async () => null,
      history: async () => unavailable(),
      agentWork: async () => unavailable(),
      applyWaivers: async () => {},
      transitionLesson: async () => {},
      usage: { get: async () => ({ kind: 'unavailable' }) },
      terminal: {
        read: (_projectId, _rowId, mode) => globalThis.window.__realRead(mode),
        resize: (_projectId, columns, rows) => {
          globalThis.window.__resized.push({ columns, rows });
          return globalThis.window.__realResize(columns, rows);
        },
        // `(projectId, key, rowId)`, the preload's order (`preload/api.ts`).
        send: (_projectId, key, _rowId) => globalThis.window.__realSend(key),
        answer: async () => ({ kind: 'unavailable' }),
        prompt: async () => ({ kind: 'unavailable' }),
      },
    };
  },
  { session: SESSION, branch: BRANCH },
);

try {
  await page.goto(`${origin}?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-tab-strip]');
  await page.locator(`[data-session-row="${SESSION}"]`).first().click();
  await page.locator('[data-view="terminal"]').click();
  await page.waitForSelector('[data-terminal-pane]', { timeout: 5_000 });
  await page.waitForTimeout(2_400);

  const readPane = async () => {
    const dom = await page.evaluate(() => {
      const pane = document.querySelector('[data-terminal-pane]');
      const screen = pane.querySelector('pre');
      return {
        scrollTop: Math.round(pane.scrollTop),
        scrollHeight: pane.scrollHeight,
        clientHeight: pane.clientHeight,
        drawn: (screen.textContent ?? '').split('\n').length,
        rows: globalThis.window.__resized.at(-1)?.rows ?? null,
      };
    });
    return { ...dom, reads, modes: modes.slice() };
  };

  const atBottom = (seen, slack = 2) =>
    seen.scrollHeight - seen.scrollTop - seen.clientHeight <= slack;

  const type = async (key) => {
    await page.keyboard.type(key);
    await page.waitForTimeout(40);
  };

  await page.locator('[data-terminal-pane]').click();
  const first = await readPane();
  console.log('first:', JSON.stringify({ ...first, modes: undefined }));
  check(
    'the pane opens overflowing its box, at the live end',
    first.scrollHeight > first.clientHeight && atBottom(first),
    `${first.scrollHeight} vs ${first.clientHeight}, scrollTop ${first.scrollTop}`,
  );

  const samples = [];
  for (let i = 0; i < 8; i += 1) {
    await type('a');
    samples.push(await readPane());
  }
  const echoes = samples.at(-1).modes.filter((m) => m === 'echo').length;
  console.log(
    'while typing:',
    samples.map((s) => `${s.scrollHeight}/${s.clientHeight}/${s.drawn}`).join(' '),
    `echo reads: ${echoes}`,
  );
  check(
    'the cheap read really was asked for -- the echo read still costs no scrollback',
    echoes > 0,
    `modes seen: ${[...new Set(samples.at(-1).modes)].join(',')}`,
  );
  check(
    'the pane still overflows its box while keys are going in',
    samples.every((s) => s.scrollHeight > s.clientHeight),
    `${Math.min(...samples.map((s) => s.scrollHeight))} <= ${samples[0].clientHeight}`,
  );
  check(
    'and never draws fewer lines than the window it opened with',
    samples.every((s) => s.drawn >= first.drawn),
    `min drawn ${Math.min(...samples.map((s) => s.drawn))} against ${first.drawn} at open`,
  );

  await page.locator('[data-terminal-pane]').hover();
  await page.mouse.wheel(0, -1_200);
  await type('b');
  const scrolled = await readPane();
  check(
    'a wheel over the pane mid-burst really moves it back into the history',
    scrolled.scrollTop < first.scrollTop - 100 && !atBottom(scrolled),
    `scrollTop ${scrolled.scrollTop} against ${first.scrollTop}, of ${scrolled.scrollHeight - scrolled.clientHeight}`,
  );

  await page.screenshot({ path: `${outDir}/terminal-echo-scrolled.png` });
  console.log(`${outDir}/terminal-echo-scrolled.png`);

  for (let i = 0; i < 10; i += 1) await type('c');
  const held = await readPane();
  const since = held.modes.slice(scrolled.modes.length);
  check(
    'the pane is left where the operator put it while keys keep going in',
    held.reads > scrolled.reads &&
      Math.abs(held.scrollTop - scrolled.scrollTop) <= 2 &&
      !atBottom(held),
    `${held.scrollTop} against ${scrolled.scrollTop}, after ${held.reads - scrolled.reads} reads (${[...new Set(since)].join(',')})`,
  );
  check(
    'and the echo asks for the scrollback once the operator is in it',
    since.includes('echo-scrollback') && !since.includes('echo'),
    `modes after the wheel: ${[...new Set(since)].join(',')}`,
  );

  await page.waitForTimeout(1_200);
  const stillHeld = await readPane();
  check(
    'and is still there once typing stops and the poll has the pane to itself',
    Math.abs(stillHeld.scrollTop - scrolled.scrollTop) <= 2 && !atBottom(stillHeld),
    `${stillHeld.scrollTop} against ${scrolled.scrollTop}`,
  );

  // `Shift+End` is vam's OWN scrollback control now (vam/terminal-arrows); a
  // bare `End` reaches the shell's own readline instead. See PHASE E below
  // for the real pty proof of both halves of that split.
  await page.keyboard.press('Shift+End');
  await page.waitForTimeout(600);
  const returned = await readPane();
  check(
    'Shift+End takes the operator back to the live end, and the pane follows the output again',
    atBottom(returned) && returned.reads > stillHeld.reads,
    `scrollTop ${returned.scrollTop} of ${returned.scrollHeight - returned.clientHeight}`,
  );

  await page.screenshot({ path: `${outDir}/terminal-echo-returned.png` });
  console.log(`${outDir}/terminal-echo-returned.png`);
  /* ── PHASE B: THE PROGRAM OWNS THE SCREEN AND THE MOUSE ────────────────── */

  // A session started STRAIGHT INTO the program, the way vam starts one into
  // `claude`: no shell in front of it, so the pane has no history at all.
  // The phase A session is killed first so the project has one pane again.
  const owner = new URL('./fixtures/mouse-owner.cjs', import.meta.url).pathname;
  tmux('kill-session', '-t', `=${TMUX_SESSION}:`);
  tmux(
    'new-session',
    '-d',
    '-s',
    TMUX_SESSION,
    '-x',
    String(COLUMNS),
    '-y',
    String(ROWS),
    'node',
    owner,
  );
  tmux('set-option', '-t', `=${TMUX_SESSION}:`, '@vam-project', PROJECT);
  aimed = null;
  // Polls' worth: the program has drawn, the resize has landed, the read
  // has seen the flag.
  await page.waitForTimeout(1_500);
  const state = tmux(
    'display-message',
    '-p',
    '-t',
    `=${TMUX_SESSION}:`,
    '-F',
    'alt=#{alternate_on} hist=#{history_size} mouse=#{mouse_any_flag} #{pane_width}x#{pane_height}',
  ).trim();
  const topLine = async () =>
    page.evaluate(() => {
      const first = document
        .querySelector('[data-terminal-pane] pre')
        ?.textContent?.split('\n')[0];
      const m = /fullscreen (\d+)/.exec(first ?? '');
      return m === null ? null : Number(m[1]);
    });
  const owned = await readPane();
  const before = await topLine();
  console.log('program:', state, JSON.stringify({ ...owned, modes: undefined }), 'top line', before);
  // Against the pane's OWN height, not the rows the tab asked for: whether
  // the resize has landed yet is not what this check is about.
  const paneRows = Number(/x(\d+)$/.exec(state)?.[1] ?? 0);
  check(
    'the pane holds one screen once the program owns it -- tmux has no scrollback for it',
    before !== null && paneRows > 0 && owned.drawn <= paneRows + 1,
    `drawn ${owned.drawn} of ${paneRows} rows, first line ${before}; ${state}`,
  );

  await page.locator('[data-terminal-pane]').hover();
  await page.mouse.wheel(0, -160);
  await page.waitForTimeout(400);
  const after = await topLine();
  console.log('wheel sends:', JSON.stringify(sent.filter((s) => s.key.kind === 'wheel')));
  check(
    'a wheel over the pane reaches the program that owns it, and its viewport moves',
    before !== null && after !== null && after < before,
    `first line ${before} -> ${after}`,
  );
  await page.screenshot({ path: `${outDir}/terminal-mouse-owner-scrolled.png` });
  console.log(`${outDir}/terminal-mouse-owner-scrolled.png`);

  await page.mouse.wheel(0, 160);
  await page.waitForTimeout(400);
  const back = await topLine();
  check(
    'and a wheel the other way brings it back',
    after !== null && back !== null && back > after,
    `first line ${after} -> ${back}`,
  );

  /* ── PHASE C: SHIFT+ENTER IS A NEWLINE IN THE PANE, NEVER A SUBMIT ──────── */

  // vam/shift-enter. The operator's report: Shift+Enter submits in the
  // Terminal tab instead of inserting a line, because `TerminalTab.tsx`
  // dropped Shift on the floor before a keystroke ever reached tmux. This
  // phase drives a REAL Shift+Enter over a REAL pane and reads what a REAL
  // program on the other end of the pty actually got -- asserting only that
  // vam's own `send` bridge was CALLED with the right `PaneKey` would still
  // pass if tmux declined the byte, or if `-l` had typed the word `Enter`
  // instead of pressing it (both real ways for that gap to open, and both
  // measured against directly in `tmux/argv.ts`'s own note).
  // `e2e/fixtures/key-echo.cjs` is the fixture: raw mode, one hex-dumped
  // line per chunk of stdin it reads, so a lone `\n` shows as `0a` and a
  // real Enter as `0d` -- distinguishable by an exact string match, not by
  // eye.
  const echo = new URL('./fixtures/key-echo.cjs', import.meta.url).pathname;
  tmux('kill-session', '-t', `=${TMUX_SESSION}:`);
  tmux('new-session', '-d', '-s', TMUX_SESSION, '-x', String(COLUMNS), '-y', String(ROWS), 'node', echo);
  tmux('set-option', '-t', `=${TMUX_SESSION}:`, '@vam-project', PROJECT);
  aimed = null;
  sent.length = 0;
  await page.waitForTimeout(1_000);

  await page.locator('[data-terminal-pane]').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(400);
  const afterShiftEnter = tmux('capture-pane', '-p', '-t', `=${TMUX_SESSION}:`);
  check(
    'vam’s own send bridge carries Shift+Enter as `{ kind: "enter", shift: true }`',
    sent.some((s) => s.key.kind === 'enter' && s.key.shift === true && s.landed === 'sent'),
    JSON.stringify(sent),
  );
  check(
    'the real program in the pane reads Shift+Enter as a bare LF (0x0a), not a Return (0x0d)',
    /chunk \d+: 0a$/m.test(afterShiftEnter.trimEnd()),
    JSON.stringify(afterShiftEnter),
  );
  check(
    'and NOT as the interpreted Return -- the byte a submit would have sent',
    !afterShiftEnter.includes('0d'),
    JSON.stringify(afterShiftEnter),
  );

  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const afterPlainEnter = tmux('capture-pane', '-p', '-t', `=${TMUX_SESSION}:`);
  check(
    'a PLAIN Enter right after still presses the interpreted Return (0x0d), so the two keys stay distinct',
    /chunk \d+: 0d$/m.test(afterPlainEnter.trimEnd()),
    JSON.stringify(afterPlainEnter),
  );

  /* ── PHASE D: OPENKEY'S WHOLE-SYLLABLE REPLACEMENT REACHES THE PANE ─────── */

  // vam/vi-ime. The operator's report, translated: "When typing Vietnamese in
  // tmux (the Terminal tab), some special letters like ố, ồ … get lost, and
  // then as I keep typing, characters keep getting deleted one after
  // another." The operator runs OpenKey (github.com/tuyenvm/OpenKey), which
  // is not a standard input method: it holds no marked-text session with
  // Chromium at all. Correcting an earlier letter (doubling `o` into `ô`, a
  // tone key moving a mark) it posts one synthetic Backspace keyDown/keyUp
  // pair PER CHARACTER to erase (`SendBackspace`,
  // `Sources/OpenKey/macOS/ModernKey/OpenKey.mm`) and then ONE keyDown/keyUp
  // pair carrying the WHOLE corrected string via
  // `CGEventKeyboardSetUnicodeString` (`SendNewCharString`, same file) --
  // never the single changed letter alone, and never one character at a
  // time.
  //
  // MEASURED AGAINST A REAL CHROMIUM, NEITHER EVENT IS A `keydown` A HANDLER
  // CAN READ. `TerminalTab.openkey.test.tsx` carries the probe in full: CDP
  // `Input.dispatchKeyEvent({ type: 'keyDown', key: 'ối', ... })` -- more than
  // one code unit -- produces a `keydown` whose `key` is the EMPTY STRING;
  // `Input.insertText` and a raw `type: 'char'` event, with no prior
  // `Input.imeSetComposition` call, produce no `keydown` at all, only
  // `beforeinput`/`input`, `isComposing: false`, `inputType: 'insertText'`.
  // `Input.insertText` IS THE INSTRUMENT here for exactly that reason, and
  // NOT `Input.imeSetComposition`: OpenKey never opens a composition, so
  // driving the IME-composition API would measure a mechanism the operator's
  // report is not about, and dispatching a fake multi-character `keydown`
  // would measure a `key` value Chromium never actually produces (an earlier
  // cut of this phase did exactly that and passed for the wrong reason --
  // `sent` never carried the replacement at all, backspaces included, because
  // `composedKeydownStrokes` correctly declined the empty string CDP handed
  // it). This phase asserts what `Input.insertText` and two real Backspace
  // `keydown`s do against a REAL program on a REAL pty: asserting only that
  // vam's own `send` bridge was CALLED with the right `PaneKey`s would still
  // pass if tmux declined a delivery or delivered the backspaces after the
  // replacement instead of before it -- both real ways for the operator's
  // report to reappear with this guard green.
  //
  // ACCESSIBILITY AUTOMATION COULD NOT DRIVE THE REAL OpenKey PROCESS in the
  // environment this guard was written in -- `osascript`'s `System Events`
  // answered "Not authorized to send Apple events to System Events (-1743)"
  // -- so nothing below is OpenKey itself; the event shapes are reasoned from
  // its own source and measured against Chromium directly. What IS measured
  // here is real: whether Chromium, given exactly that shape, really turns it
  // into the `PaneKey`s the operator's report needs, and whether a real tmux
  // pane really receives them in order.
  aimed = null;
  sent.length = 0;
  tmux('kill-session', '-t', `=${TMUX_SESSION}:`);
  tmux(
    'new-session',
    '-d',
    '-s',
    TMUX_SESSION,
    '-x',
    String(COLUMNS),
    '-y',
    String(ROWS),
    'node',
    echo,
  );
  tmux('set-option', '-t', `=${TMUX_SESSION}:`, '@vam-project', PROJECT);
  await page.waitForTimeout(1_000);

  await page.locator('[data-terminal-pane]').click();
  await page.waitForTimeout(200);

  // CDP, not `page.keyboard` -- Playwright's own keyboard API presses a named
  // KEY and has no way to fire the shape below at all.
  const cdp = await page.context().newCDPSession(page);

  /** A real Backspace keydown -- what `SendBackspace` posts, one pair per
   *  character OpenKey means to erase. */
  const backspaceKeyDown = () =>
    cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8,
    });
  /** A plain ASCII letter, keydown then keyup -- ordinary typing, unrelated
   *  to OpenKey's own mechanism, and what builds the raw Telex skeleton. */
  const letterKeyDown = (letter) =>
    cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: letter,
      code: `Key${letter.toUpperCase()}`,
      windowsVirtualKeyCode: letter.toUpperCase().charCodeAt(0),
      nativeVirtualKeyCode: letter.toUpperCase().charCodeAt(0),
    });

  for (const letter of 'toi') await letterKeyDown(letter);
  await page.waitForTimeout(150);

  // THE CORRECTION: OpenKey deletes the last two characters it typed ("o"
  // and "i") with two real Backspace keydowns, and then posts ONE event
  // carrying the tone-marked replacement whole -- `Input.insertText`, with NO
  // prior `Input.imeSetComposition` call, is what MEASURED as the shape that
  // produces (`isComposing: false`, `inputType: 'insertText'`, no `keydown`
  // at all). The pane should read "tối" once this lands -- not "t" with the
  // rest of the syllable silently gone, which is the operator's report typed
  // out literally.
  await backspaceKeyDown();
  await backspaceKeyDown();
  await cdp.send('Input.insertText', { text: 'ối' });
  await page.waitForTimeout(400);

  const afterCorrection = tmux('capture-pane', '-p', '-t', `=${TMUX_SESSION}:`);
  const hexOf = (text) => Buffer.from(text, 'utf8').toString('hex').match(/../g).join(' ');
  check(
    'vam’s own send bridge carries the two backspaces before the replacement text, in order',
    sent.filter((s) => s.key.kind === 'backspace').length === 2 &&
      sent.some((s) => s.key.kind === 'text' && s.key.text === 'ối') &&
      sent.findLastIndex((s) => s.key.kind === 'backspace') <
        sent.findIndex((s) => s.key.kind === 'text' && s.key.text === 'ối'),
    JSON.stringify(sent),
  );
  check(
    'the real program in the pane receives both backspaces as real bytes (0x7f or 0x08), not the six characters "Backspace"',
    (afterCorrection.match(/chunk \d+: (?:7f|08)$/gm) ?? []).length === 2,
    JSON.stringify(afterCorrection),
  );
  check(
    'and the tone-marked replacement really reaches it whole, as the UTF-8 bytes of "ối" — not lost the way the operator’s report describes',
    afterCorrection.includes(hexOf('ối')),
    `expected a chunk of "${hexOf('ối')}" in:\n${afterCorrection}`,
  );

  /* ── PHASE E: THE EIGHT NAVIGATION KEYS REACH THE PROGRAM, AND
     Shift+PageUp SCROLLS VAM'S OWN VIEW WHILE DELIVERING NOTHING ─────────── */

  // vam/terminal-arrows. The operator's report, translated: "in the terminal,
  // the arrow keys can't be used to select options." `TerminalTab.tsx` read
  // the arrows and Home/End/PageUp/PageDown as vam's OWN scroll of the pane's
  // view before a keystroke ever reached the pane, so every one of Claude
  // Code's own option pickers -- walked with exactly those keys -- could not
  // be answered from inside this tab. Asserting only that vam's own `send`
  // bridge was called with `{ kind: 'nav', ... }` would still pass if tmux
  // declined the delivery, or if `-l` had typed the key's NAME instead of
  // pressing it (both real ways for that gap to open, and both measured
  // against directly in `tmux/argv.ts`'s own note) -- so this drives REAL
  // arrow keys over a REAL pane and reads the REAL bytes a program on the
  // other end of the pty received, the same instrument the Shift+Enter phase
  // above uses for one key.
  aimed = null;
  sent.length = 0;
  tmux('kill-session', '-t', `=${TMUX_SESSION}:`);
  tmux(
    'new-session',
    '-d',
    '-s',
    TMUX_SESSION,
    '-x',
    String(COLUMNS),
    '-y',
    String(ROWS),
    'node',
    echo,
  );
  tmux('set-option', '-t', `=${TMUX_SESSION}:`, '@vam-project', PROJECT);
  await page.waitForTimeout(1_000);

  await page.locator('[data-terminal-pane]').click();
  await page.waitForTimeout(200);

  // FILLER, so Shift+PageUp below has real scrollback to move into -- a
  // FRESH key-echo session has nothing on screen yet, exactly like Phase A's
  // shell needed its 300-line printf fill before a wheel had anything to
  // prove. Each character rides the SAME serialised send path a real
  // operator's typing does, so this is not a shortcut: it is eighty ordinary
  // keystrokes, each hex-dumped on its own line by the fixture.
  await page.keyboard.type('x'.repeat(80));
  await page.waitForTimeout(1_500);

  const chunkLines = (capture) =>
    capture
      .split('\n')
      .map((line) => /^chunk \d+: (.+)$/.exec(line.trimEnd())?.[1])
      .filter((hex) => hex !== undefined);

  const NAV_PRESSES = [
    ['ArrowUp', 'up', '1b 5b 41'],
    ['ArrowDown', 'down', '1b 5b 42'],
    ['ArrowLeft', 'left', '1b 5b 44'],
    ['ArrowRight', 'right', '1b 5b 43'],
  ];
  for (const [domKey] of NAV_PRESSES) {
    await page.keyboard.press(domKey);
    await page.waitForTimeout(200);
  }
  const afterArrows = tmux('capture-pane', '-p', '-t', `=${TMUX_SESSION}:`);
  const lastFour = chunkLines(afterArrows).slice(-4);
  check(
    'ArrowUp/ArrowDown/ArrowLeft/ArrowRight each deliver the real VT100 cursor escape sequence, in order',
    JSON.stringify(lastFour) === JSON.stringify(NAV_PRESSES.map(([, , hex]) => hex)),
    `expected ${JSON.stringify(NAV_PRESSES.map(([, , hex]) => hex))}, got ${JSON.stringify(lastFour)}`,
  );
  check(
    'vam’s own send bridge carries each one as { kind: "nav", nav: <name> }, never as typed text',
    NAV_PRESSES.every(([, nav]) =>
      sent.some((s) => s.key.kind === 'nav' && s.key.nav === nav && s.landed === 'sent'),
    ),
    JSON.stringify(sent.filter((s) => s.key.kind === 'nav')),
  );

  const beforeShift = await page.evaluate(() => {
    const paneEl = document.querySelector('[data-terminal-pane]');
    return { scrollTop: paneEl.scrollTop, scrollHeight: paneEl.scrollHeight };
  });
  check(
    'the eighty-line filler really overflowed the box, so Shift+PageUp has somewhere to go',
    beforeShift.scrollHeight > 0 && beforeShift.scrollTop > 0,
    JSON.stringify(beforeShift),
  );
  const chunksBeforeShift = chunkLines(afterArrows).length;
  sent.length = 0;
  await page.keyboard.press('Shift+PageUp');
  await page.waitForTimeout(400);
  const afterShift = tmux('capture-pane', '-p', '-t', `=${TMUX_SESSION}:`);
  check(
    'Shift+PageUp delivers NOTHING to the program -- no new chunk on the wire',
    chunkLines(afterShift).length === chunksBeforeShift,
    `${chunksBeforeShift} chunks before, ${chunkLines(afterShift).length} after`,
  );
  check(
    'and vam’s own send bridge was never asked either',
    sent.length === 0,
    JSON.stringify(sent),
  );
  const afterShiftScroll = await page.evaluate(
    () => document.querySelector('[data-terminal-pane]').scrollTop,
  );
  check(
    'Shift+PageUp really moved vam’s own scrollTop, up out of the live end',
    afterShiftScroll < beforeShift.scrollTop,
    `${beforeShift.scrollTop} -> ${afterShiftScroll}`,
  );
} finally {
  await browser.close();
  real.dispose();
  killServer();
  rmSync(bundleDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed in terminal-echo-scroll-shots.mjs`);
  process.exit(1);
}
console.log('\nterminal-echo-scroll-shots.mjs: all checks passed.');
