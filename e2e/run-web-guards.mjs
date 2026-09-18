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
 * a layout effect and an interval, and has no meaning outside a browser.
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
 *   VAM_E2E_PORT       preview port (default 5520)
 *   VAM_E2E_OUT        screenshot directory (default e2e/test-results/web-guards,
 *                      gitignored — never docs/ui, CI must not produce a repo diff)
 *   VAM_E2E_SKIP_BUILD serve whatever is already in dist-web. This is how the
 *                      guard itself gets falsified: mutate the built bundle,
 *                      re-run, watch it go red.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

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
  'sidebar-seam-shots',
  'terminal-chrome-shots',
  'terminal-scheme-shots',
  'terminal-settings-shots',
  'command-palette-shots',
  'tree-icon-shots',
  'out-links-shots',
  'view-width-shots',
  'model-picker-shots',
  'terminal-scrollback-shots',
  'terminal-insert-shots',
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

if (failed.length > 0) {
  console.error(`\nFAILED: ${failed.map((g) => `e2e/${g}.mjs`).join(', ')}`);
  process.exit(1);
}
console.log(`\nAll ${GUARDS.length} web guards passed. Screenshots in ${outDir}.`);
