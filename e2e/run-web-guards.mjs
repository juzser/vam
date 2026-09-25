/**
 * Every asserting e2e script, run for real, in one command.
 *
 *   node e2e/run-web-guards.mjs
 *
 * Until now these scripts ran only when a human remembered them: 59 throwing
 * assertions covering exactly what jsdom cannot see (project-switch
 * reconciliation, per-project layout restore, the per-pane `+`, drag-to-move,
 * which pane is focused AT THE MOMENT OF AN EVENT, `position: sticky` against
 * real layout, which element is on top at a pixel, which of a column's many
 * sticky prompts is PINNED at a given scroll offset and what a percentage
 * max-height actually resolves to, and -- since the tooltip
 * audit -- what a tooltip FLATTENS TO for a screen reader, whether Tab
 * reaches the element a `Note` hangs on, the computed contrast of the tip's
 * boundary against the surface it floats over in both themes, and -- since the
 * pane took its own colour token -- what a surface ACTUALLY PAINTS and whether
 * a swatch in the settings form reaches it, and -- since the settings audit --
 * whether the narrow settings nav has an ACCESSIBLE NAME at a breakpoint jsdom
 * cannot see, what the Remote section's buttons actually paint, and what is
 * left of the favicon's mark once a tab has rasterised it at 16 and 32, and --
 * since the keyboard audit -- which listener owns a keystroke, which is
 * decided by `defaultPrevented` on a CANCELABLE event and so cannot be
 * measured with a hand-built one, and -- since the pane audit -- what an
 * option PAINTS against the card it sits inside once a pointer is over it,
 * whether the composer's submit puts a WORD on screen for the outcome it will
 * produce rather than one arrow for two, and whether a focused field draws a
 * ring an operator can see, measured after a real Tab press because
 * `:focus-visible` is a heuristic about the last input device and no
 * programmatic `.focus()` satisfies it), and -- since the canvas-truth audit --
 * whether a jump label is PAINTED on the row it addresses and lands on top of
 * it rather than behind its title, and whether a mode change actually runs an
 * animation, which is `Element.getAnimations()` and exists in no unit
 * environment at all, and -- since the half-page keys -- how far half a
 * viewport IS once a browser has laid the column out (`clientHeight` is 0 in
 * happy-dom, so the distance is unmeasurable there) and whether writing
 * `scrollTop` reaches the column's own pager, which it does here and does not
 * in any unit environment, where assigning it fires no scroll event at all,
 * and -- since the Files tab -- whether the editor's `<textarea>` is a REAL
 * insert scope once Chromium has actually focused it (read off the mode chip,
 * the same live-DOM signal `mode-truth-shots.mjs` already proves), whether
 * the one select-only chord in the whole table is silently declined while it
 * has focus, whether a `changed-on-disk` refusal still shows the operator's
 * own edit after a real save round-trip, and whether closing the page while
 * a buffer is dirty is something ONLY a real `beforeunload` event can answer,
 * and -- since the Terminal tab learned to take a composed language -- what an
 * INPUT METHOD really does to a keystroke, which is CDP
 * `Input.imeSetComposition` and a pipeline no unit environment has at all
 * (happy-dom's `CompositionEvent` does not even carry its `data`): whether the
 * commit key really arrives carrying `isComposing`, whether `compositionend`
 * really delivers the syllable, whether sequential focus navigation really
 * gets back OUT of a pane whose keyboard lives on a hidden box, and whether a
 * drag across that pane still selects the text it draws,
 * and -- since the Files tab learned markdown -- what a token CLASS actually
 * PAINTS (a scanner proven token by token still draws nothing at all if the
 * stylesheet has no such token), what colour a tree row's glyph is really
 * given, how much of a row is LEFT FOR ITS NAME once a glyph sits in front of
 * it at vam's narrowest legal pane, whether raw HTML in a previewed file
 * reaches the DOM as an element or as characters, and where the boxes of three
 * toolbar buttons fall against the view pill -- which is a rectangle question
 * and not a click one, because a control can be half-buried and still take
 * every click aimed at its centre,
 * and -- since the file tree learned to be dragged -- whether a column that
 * OVERFLOWS really stops at the pane and really scrolls (a `scrollTop` that
 * moves under a real wheel, which no unit environment can produce), whether
 * the thumb that says so appears only when there is something to scroll, and
 * what a pointer-captured drag does to two columns' rectangles at both
 * extremes and at vam's narrowest legal pane -- including the one act that
 * proves the container clamp never writes back, which is looking at another
 * tab and coming back, because a `display: none` tree measures 0px.
 * and -- since the sidebar became a tree you can read -- where its three
 * levels REALLY sit once a browser has laid the column out (a `padding-left`
 * on a container moves its CHILDREN and not itself, so the declaration and the
 * picture are two different facts), whether a status mark keeps its lane at
 * every status, whether every spinner in the list is at the SAME ANGLE --
 * `Element.getAnimations()` on a row mounted deliberately late, which is a
 * question no unit environment can be asked at all -- whether a bell rung for
 * a wait ever stops ringing, and what `prefers-reduced-motion` leaves drawn,
 * which is the cascade's answer about a real node rather than a content scan
 * of a stylesheet,
 * and -- since an icon could be a glyph with a colour -- whether a tone CLASS
 * resolves to anything at all (a token missing from the built stylesheet
 * leaves the glyph on its inherited ink and every unit assertion still green),
 * whether the light theme really remaps the eight rather than reproducing
 * them, what a glyph's rectangle does to the name beside it, and whether the
 * sentence a refusing control owes has a box on screen rather than only a
 * value in a function,
 * and -- since an agent's links became controls -- whether the SHIPPED BUNDLE
 * really draws a link as a button and leaves no anchor in the pane (a claim
 * about the built page, which the component's own unit tests cannot make),
 * whether the address beside it is PAINTED rather than merely present,
 * whether a refused scheme puts a sentence on screen with a box of its own,
 * and whether jumping to `path:line` really SCROLLS the editor there --
 * computed from the textarea's own line height and viewport, both of which
 * are 0 or `''` in happy-dom, where the claim cannot be asked at all,
 * and -- since the operator found a hairline where the sidebar meets the
 * pane -- WHAT THE TOP ROW OF A SEAM ACTUALLY PAINTS, compared pixel by pixel
 * against the rows below it. That is the one claim nothing in this repo could
 * previously make: every element at that seam declared exactly the right
 * thing, and the line came from Tailwind's own preflight handing every `<hr>`
 * a `currentColor` top border back after the reset, so the class names, the
 * tokens and the content scans were all green while the line was on screen,
 * and -- since the terminal took a colour scheme of its own -- what the
 * screen's ground, ink, bold ink, caret and `::selection` RESOLVE to on a
 * real paint in both app themes (a utility a unit test can only name), and
 * whether the scheme follows the OS flipping under `system`, which no write
 * carries and only `emulateMedia` can drive,
 * and -- since the composer's model field became a picker that is DISABLED
 * where vam cannot type -- what the dimmed label of a disabled control
 * actually paints against the composer (a token guard proves the value is in
 * the stylesheet, only a browser proves it reaches the node), and whether the
 * note on a disabled button can be opened at all: a disabled `<button>` takes
 * no focus anywhere, so "the note is there" and "the note can be read" are
 * two facts, and only a real hover and a real Tab press answer the second --
 * and the hover half is where the guard buried an assumption of its own
 * author's (see the script's header),
 * and -- since the operator asked the Terminal view to stop taking the
 * keyboard on arrival -- WHO HOLDS IT after a real key press: that arriving at
 * the pane leaves it on the shell, that `i` and `I` both put it on the pane's
 * own input, that Escape typed there is still SENT into the session rather
 * than used as an exit, and that a session switch does not take it back. Every
 * one of those is `document.activeElement` after a keystroke a browser
 * delivered -- in a unit environment `activeElement` is whatever the test last
 * focused by hand, so the whole family of "the mode reads Insert while the
 * body holds the keyboard" is invisible there,
 * and -- since the terminal learned to keep its scrollback -- whether the
 * pane OVERFLOWS AT ALL once the capture is longer than the box (it did not,
 * and the operator reported exactly that: `scrollHeight === clientHeight` is
 * a number no unit environment reports at all), whether a real wheel reaches
 * the history, and whether a poll a second later leaves the operator where
 * they scrolled to or throws them at the live end -- which is a race between
 * a layout effect and an interval, and has no meaning outside a browser,
 * and -- since the settings overlay was split into look and behaviour --
 * whether a control is PAINTED in the panel it was moved to and nowhere else,
 * which no unit environment can be asked at all: every panel in that dialog is
 * mounted and `hidden`, so a `querySelector` finds a row in the tree whether
 * or not the operator could ever see it, and only a real box with a real
 * width tells the two apart,
 * and -- since the operator found the composer's popovers stacking on top of
 * each other -- whether pressing OUTSIDE an open popover really closes it,
 * which is a real `pointerdown` reaching a document listener from a real hit
 * test at a real coordinate: a unit environment can only fire a synthetic
 * event at a node it picked itself, which says the handler exists and nothing
 * about whether a pointer ever gets there,
 * and -- since the operator asked a table in an answer to wrap -- whether a
 * cell REALLY BROKE A LINE and whether the table it is in really fits the pane
 * around it, at the 408px default pane and at a 390px phone: `w-max` and no
 * width at all leave the identical DOM behind, every cell in a unit
 * environment is 0px tall whether it holds one word or forty, and the
 * scrollbar that would show the difference is hidden by `vam-no-scrollbar`, so
 * the whole claim is a handful of numbers a browser has and nothing else does.
 * This
 * driver builds the web bundle, serves it with
 * `vite preview`, points each script at it and fails with a non-zero exit as
 * soon as any assertion throws — so CI can hold them.
 *
 * The other `e2e/*.mjs` scripts (issue-188-shots, pane-refinements-shots,
 * pane-patches-shots, phone-list-shots, phone-prompt-shots, uiux-pane-shots)
 * are NOT run here and must not be added: they take screenshots and assert nothing, so
 * running them would only turn a green tick into a broader claim than it is.
 *
 * Environment:
 *   VAM_E2E_PORT          preview port (default 5520)
 *   VAM_E2E_OUT           screenshot directory (default e2e/test-results/web-guards,
 *                         gitignored — never docs/ui, CI must not produce a repo diff)
 *   VAM_E2E_SKIP_BUILD    serve whatever is already in dist-web. This is how the
 *                         guard itself gets falsified: mutate the built bundle,
 *                         re-run, watch it go red.
 *   VAM_E2E_CHECK_ORPHANS after every guard has run, compare this run's own
 *                         output directory (never docs/ui, so this needs no
 *                         extra port or build) against `docs/ui`'s committed
 *                         PNGs. A committed PNG this run did not write AND
 *                         that `git grep` finds referenced nowhere else in
 *                         the tree (a doc, a source comment) is an orphan --
 *                         a screenshot a rename or a removed guard left
 *                         behind — and fails the run. Off by default because
 *                         it is only meaningful on the FULL 50-guard list (a
 *                         partial run would flag everything the guards it
 *                         skipped would have written); the CI web-guards job
 *                         sets it because that job always runs the full list
 *                         anyway, and the check itself costs one `readdir`
 *                         and a `git grep` per candidate, not another guard.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';

const GUARDS = [
  'split-panes-shots',
  'prompt-suggest-shots',
  'transcript-flow-shots',
  'transcript-column-shots',
  'prompt-mode-icon-shots',
  'long-prompt-shots',
  'narrow-pane-overlay-shots',
  'tab-strip-shots',
  'turn-signal-shots',
  'tooltip-shots',
  'pane-colour-shots',
  'composer-bar-shots',
  'settings-chrome-shots',
  'settings-panels-shots',
  'favicon-shots',
  'key-truth-shots',
  'mode-truth-shots',
  'half-page-shots',
  'target-size-shots',
  'turn-steps-shots',
  'agents-navigator-shots',
  'files-tab-keyboard-shots',
  'files-markdown-shots',
  'files-tree-resize-shots',
  'terminal-ime-shots',
  'sidebar-tree-shots',
  'workspace-options-shots',
  'sidebar-seam-shots',
  'terminal-chrome-shots',
  'terminal-scheme-shots',
  'terminal-settings-shots',
  // FRAME PARITY BETWEEN THE TWO TERMINAL TABS (docs/design/
  // terminal-streaming.md): with `streamingTerminal` ON, `TerminalStreamTab.
  // tsx`'s xterm.js pane has to be visually indistinguishable in its
  // frame/chrome from `TerminalTab.tsx`'s own capture-pane view with the
  // setting OFF -- the operator's own ask. Needs no real tmux (both
  // `window.api.terminal` and `window.api.terminalStream` are stubs), so it
  // runs here rather than by hand. `terminal-stream-frame-shots.mjs`'s own
  // header holds the falsifications and what is deliberately not measured.
  'terminal-stream-frame-shots',
  'command-palette-shots',
  'tree-icon-shots',
  'out-links-shots',
  'view-width-shots',
  'model-picker-shots',
  'terminal-scrollback-shots',
  // THE SCROLLBACK SURVIVES A KEYSTROKE. The guard above proves the pane
  // scrolls and the poll leaves it alone, against a stub that answers every
  // read with the whole window whatever `mode` asked -- so the echo read's
  // screen-only answer never reached its DOM, and "can't scroll" shipped past
  // it green. This one's stub honours `mode` as main does, and it TYPES.
  'terminal-echo-scroll-shots',
  'terminal-insert-shots',
  'prompt-popovers-shots',
  // The PRs tab, which `?demo=1` structurally cannot reach with content: the
  // demo fixture declares no pull requests. Stubs `window.api` like
  // `files-tab-keyboard-shots` does, and measures the row at 390px -- eleven
  // fields were added to it and whether they FIT is a rectangle question no
  // unit environment can answer.
  'prs-tab-shots',
  // A table in an agent's answer, at the 408px default pane and at a 390px
  // phone. Stubs `window.api` for the same reason the two above do -- the demo
  // fixture's answers contain no table, and putting one in it would change the
  // transcript every demo-driven guard counts turns and rows in.
  'out-table-shots',
  // THE `?` SHEET'S SHAPE: one column, label left and key right, a rule
  // between sections, and a search box that holds the keyboard. Every term of
  // that is a rectangle or a distance -- "clearer separation" is the claim
  // that one gap is bigger than another, and both are zero in a unit
  // environment. It also drives the box with REAL keystrokes, which is the
  // only way to tell `?`-types-a-character from `?`-closes-the-sheet.
  'key-sheet-shots',
  // THE SHORTCUT SYMBOLS, on both platforms out of one bundle. Loads the page
  // twice with `navigator.platform` overridden before any module runs, which
  // is the only way to prove ⌘-or-Ctrl is a RUNTIME answer in the shipped
  // bytes -- and RASTERISES each glyph against the notdef box, because a tofu
  // is four identical bytes to every string assertion in the unit suite.
  'chord-symbol-shots',
  // THE PROVIDER MARK on a sidebar row, at 1280, at the 200px sidebar floor
  // and at 390px. Every claim in it is a rectangle, a rasterised glyph or a
  // resolved token -- including the one the unit file gets WRONG: "before the
  // title" is DOM ORDER there, and an `order-last` on the mark's wrapper moves
  // the painted glyph past the title while leaving the whole unit file green.
  // It also rewrites the served bundle's `orca` source to `codex` on one page,
  // so the operator's actual pair is measured rather than argued from a
  // fixture that contains neither.
  'provider-mark-shots',
  // THE START SCREEN of a pane with nothing in it, on the desktop and at
  // 390px, plus the Terminal view of that row. Every claim is painted: the
  // hollow status dot's lane and size beside the other five marks, the Start
  // button inside the pane's fold, and a pane drawn rather than an
  // `ambiguous` refusal for a pane-row id -- none of which a unit environment
  // measures. Its three shots are `docs/ui/start-screen-*.png`.
  'start-screen-shots',
  // THE TERMINAL-ONLY STATE (`docs/design/vam-terminal-only.md`): a pane
  // whose agent exited but whose conversation is known, and its getting-
  // started screen -- the operator's own revision, replacing an earlier
  // transcript-plus-Resume-bar draft. Fully stubs `window.api`, the same
  // reason `sidebar-ownership-shots.mjs` does, because Resume has to reach a
  // REAL `recordPrompt` with the row's own `resumeCommand` for this to prove
  // anything past "the click did not throw". Every other claim is painted:
  // the `terminal` mark beside its six neighbours in the sidebar AND on the
  // tab (unlike `idle`/`unstarted`, visible without a click), the mark, the
  // three shortcuts each with a chord chip, and both buttons inside the
  // pane's fold on desktop and the phone's 44px floor. Its shots are
  // `docs/ui/terminal-only-*.png`.
  'terminal-only-shots',
  // PER-KEYSTROKE TYPING LATENCY, against a REAL tmux, a REAL `claude`
  // fullscreen TUI and the real renderer bundle -- the operator's third
  // report of "still a noticeable delay when typing". No unit environment
  // spawns a process or measures a `performance.now()` gap across an
  // Electron-shaped IPC boundary, so this is the only guard that can catch a
  // keystroke chain regressing back to a spawn per key
  // (`terminal-typing-latency-shots.mjs`'s own header holds the measured
  // before/after and the bound this asserts).
  'terminal-typing-latency-shots',
  // WHETHER A REAL `visibilitychange` REACHES `useVisibilityInterval`'S OWN
  // LISTENER AT ALL -- the perf pass that gated three background polls on
  // document visibility. jsdom/happy-dom let a unit test hand `visibilityState`
  // a value and call a handler by hand; neither can say whether the app's own
  // listener is wired to the right property at all, which this repo has
  // already been burned by in visibility-driven code before. Stubs
  // `window.api` (`?demo=1`'s own fixture never calls it, so it gives no hook
  // to count against) and proves the load poller goes quiet over a real 3s
  // hidden window and fires one immediate call on return
  // (`attention-shots.mjs`'s own header holds the cadence math and the one
  // poller this guard could not reach, and why).
  'attention-shots',
  // STAGE 1 OF `docs/design/vam-owns-the-session.md`: only vam's own
  // sessions show by default, the toggle that reveals the rest, the sidebar
  // that never goes empty when tmux itself cannot be read, and the row a
  // bare `tmux new-session -s vam-x` earns with nothing started in it yet.
  // Stubs `window.api` for the same reason `attention-shots.mjs` and
  // `prs-tab-shots.mjs` both do, and measures four DOM states no unit test
  // drives end to end: a real click on the popover's toggle, and a real
  // reading of the reason text a degraded load leaves on screen
  // (`sidebar-ownership-shots.mjs`'s own header holds the falsifications).
  'sidebar-ownership-shots',
  // THE QUIET LINE'S OWN DISMISS BUTTON, AS RECTANGLES: inside the note, at
  // least as large as the sidebar's own icon buttons (Settings/Remote/
  // theme) -- neither of which happy-dom's zero-layout DOM can answer.
  // Regenerates `docs/ui/hidden-sessions-note-{dark,light}.png`.
  // `hidden-sessions-note-shots.mjs`'s own header holds the falsification.
  'hidden-sessions-note-shots',
  // DISMISS, THROUGH THE REAL PRELOAD CONTRACT AND A REAL CLICK -- the
  // operator's own report, "some sessions cannot be closed and report a
  // failure — they stay there forever." Stubs `window.api` and throws
  // `stop.ts`'s exact `already-finished` refusal from `closeSession`, then
  // proves the row's hover-revealed `×` actually removes the row from the
  // sidebar (never happy-dom's fake hover/opacity), that the status names the
  // removal rather than a failure, and that the undo control brings it back.
  // `close-dismiss-shots.mjs`'s own header holds the falsification.
  'close-dismiss-shots',
  // THE GETTING-STARTED SCREEN: the detail pane's Response view (and, on a
  // phone, the list screen's own body) when vam has no session to show
  // anywhere -- first launch, or every row foreign-hidden. Stubs
  // `window.api`, and is the first guard to stub `window.api.dialog` too,
  // so New project reaches a REAL `createSessionIn` through a real click
  // rather than merely not throwing. Measures what no unit test can: the
  // mark, two shortcut rows and the primary button all fit inside a real
  // 1280px pane, the phone's own Show control clears the 44px floor with
  // its shortcut rows withdrawn, and the browser/phone state (no `dialog`
  // at all) draws no dead button and no bare-word shortcut list.
  // `getting-started-shots.mjs`'s own header holds the rest.
  'getting-started-shots',
  // THE OPERATOR'S REPORT: "Ctrl+C in the terminal shuts the session down
  // entirely." Drives no browser at all -- the bug and the fix are both in
  // MAIN, so there is nothing here for Chromium to add -- and ignores the
  // `origin`/`outDir` argv every other guard in this list is called with.
  // Spawns through the REAL `createSessionInDirectory` and `resumeClaudeSession`
  // against a REAL private tmux, presses Ctrl-C twice through the real
  // `send-keys` path, and asserts the tmux session survives with the shell
  // in its pane's foreground -- then falsifies itself by spawning the
  // identical fixture DIRECTLY, the shape both paths used to have, and
  // asserts THAT one dies with the agent. `shell-first-ctrlc-survives.mjs`'s
  // own header holds the measurement and why `codex/resume.ts` is not a
  // fourth phase.
  'shell-first-ctrlc-survives',
  // THE USAGE POPOVER: the account icon that replaced the sidebar's letter
  // avatar, and the panel it opens, at 1280px and at 390px. Stubs
  // `window.api` for the same reason `getting-started-shots.mjs` and
  // `prs-tab-shots.mjs` do -- the demo fixture has no bridge behind it, so it
  // could never reach real provider data -- and measures what no unit
  // environment can: the panel's own painted rectangle stays inside the
  // viewport at both widths, never clipped. `usage-popover-shots.mjs`'s own
  // header holds the rest.
  'usage-popover-shots',
  // THE PHONE CORE LOOP'S OWN TWO SCREENS (docs/design/phone-core-loop.md):
  // the inline question (one shared scroller, no retired fixed card, every
  // option clears 44px) and the composer with none open (exactly 4 controls,
  // and AC-7's height half, real-browser-measured at 75px -- the ≤76px
  // stretch target, down from 95px, down from the pre-merge 145px).
  // Held out of this list until that merge shipped, per this file's own
  // header note on why: unlike every other guard here, a real layout change
  // was the only way to close it, not a class this list could paper over.
  // `phone-question-shots.mjs`'s own header holds the measurement.
  'phone-question-shots',
  // STREAMING-PATH LATENCY, against the SHIPPED `StreamClient` and a real
  // tmux control-mode connection -- the operator's own ask, translated:
  // "the terminal latency/resource measurement scripts are not in the
  // automatic checks -- fix it." Placed LAST, after every other guard's own
  // Chromium has already closed: it needs the same real, private-socket
  // tmux this job already installs for `terminal-echo-scroll-shots.mjs` and
  // `terminal-typing-latency-shots.mjs` above, and its own p95 bounds carry
  // headroom for a loaded machine, not a QUIET one -- running it last (never
  // parallel; this whole list is sequential, this file's own header
  // explains why) is the cheapest way to give it the quietest tail of the
  // run rather than adding a second CI job for one guard.
  // `terminal-stream-latency-shots.mjs`'s own header holds the calibration,
  // the bounds and their headroom, and the falsification.
  //
  // THE ONE-LINE HOOK for the streaming resource guard (CPU/memory/client
  // count, `e2e/terminal-stream-resource-shots.mjs`, `vam/stream-default`):
  // once that branch lands, add `'terminal-stream-resource-shots',` as the
  // next entry, right here -- it measures the same shipped `StreamClient`
  // the same way (a private tmux socket, its own throwaway harness), so it
  // belongs in this same "runs last, alone" slot, not a new CI job.
  'terminal-stream-latency-shots',
];

const port = Number(process.env.VAM_E2E_PORT ?? 5520);
const origin = `http://localhost:${port}`;
const outDir = process.env.VAM_E2E_OUT ?? 'e2e/test-results/web-guards';

/** Run a command with its output going straight to ours — an assertion that
 *  throws must arrive in the log with its own message, never summarised. */
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function waitForServer(deadlineMs) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(origin);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${origin} did not answer within ${deadlineMs}ms.`);
}

mkdirSync(outDir, { recursive: true });

if (!process.env.VAM_E2E_SKIP_BUILD) {
  const built = await run('node_modules/.bin/vite', ['build', '--config', 'vite.web.config.ts']);
  if (built !== 0) process.exit(built);
}

const preview = spawn(
  'node_modules/.bin/vite',
  ['preview', '--config', 'vite.web.config.ts', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
const failed = [];
try {
  await waitForServer(60_000);
  // Sequential, not parallel: four Chromiums on one CI runner is how a guard
  // starts flaking, and a flaky guard is the one the next person disables.
  for (const guard of GUARDS) {
    console.log(`\n=== e2e/${guard}.mjs`);
    const code = await run('node', [`e2e/${guard}.mjs`, origin, outDir]);
    if (code !== 0) failed.push(guard);
  }
} finally {
  preview.kill('SIGTERM');
}

/** A name is "referenced elsewhere" if `git grep` finds it anywhere in the
 *  tracked tree outside the two PNG directories themselves (a doc, a source
 *  comment) -- a screenshot a doc still points at must survive even though
 *  no guard's assertion happens to write it any more. Exit 1 from `git
 *  grep -q` means no match; anything else (no repo, no git) is a real error
 *  this check should not silently swallow into a false "orphaned". */
function isReferencedElsewhere(name) {
  try {
    execFileSync(
      'git',
      ['grep', '-q', '-F', '-e', name, '--', '.', ':!docs/ui', ':!docs/images', ':!e2e/test-results'],
      { stdio: 'ignore' },
    );
    return true;
  } catch (err) {
    if (err.status === 1) return false;
    throw err;
  }
}

if (process.env.VAM_E2E_CHECK_ORPHANS) {
  const docsUiPngs = readdirSync('docs/ui').filter((f) => f.endsWith('.png'));
  const produced = new Set(readdirSync(outDir).filter((f) => f.endsWith('.png')));
  const notProduced = docsUiPngs.filter((f) => !produced.has(f));
  const orphans = notProduced.filter((f) => !isReferencedElsewhere(f));
  if (orphans.length > 0) {
    console.error(
      `\ndocs/ui holds ${orphans.length} PNG(s) this run did not write and nothing ` +
        `references:\n${orphans.map((f) => `  docs/ui/${f}`).join('\n')}`,
    );
    failed.push('docs-ui-orphan-check');
  } else {
    console.log(
      `\ndocs/ui orphan check: all ${docsUiPngs.length} committed PNGs are either produced ` +
        'by this run or referenced elsewhere.',
    );
  }
}

if (failed.length > 0) {
  const label = (g) => (g === 'docs-ui-orphan-check' ? g : `e2e/${g}.mjs`);
  console.error(`\nFAILED: ${failed.map(label).join(', ')}`);
  process.exit(1);
}
console.log(`\nAll ${GUARDS.length} web guards passed. Screenshots in ${outDir}.`);
