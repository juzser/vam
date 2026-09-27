import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Guards the actual regression this repo shipped: `electron-vite build`
 * defaults `minify` to `false` for every target, and nothing in
 * `electron.vite.config.ts` used to override it -- so `build:app`, the
 * pipeline that produces what ships, emitted 2,276,000 bytes of unminified,
 * fully-commented renderer JavaScript that had to be parsed before the
 * canvas could draw a single node.
 *
 * This MUST build through `electron-vite`, not plain `vite`. `vite build`
 * (the `build:web` pipeline, `vite.web.config.ts`) already defaults `minify`
 * to `true` and was never affected by this defect -- a guard that spawns
 * `vite build` instead would stay green straight through a revert of
 * `minify: true` in `electron.vite.config.ts`, because it would be
 * measuring a pipeline the regression never touched.
 *
 * Measured, `electron-vite build`, same code and chunks both times:
 *
 *     minify: false (the shipped defect)  entry  2,276,000 B
 *     minify: true  (this fix)            entry    831,637 B
 *
 * `ENTRY_BUDGET_BYTES` sits at 1,000,000 -- about 20% above the current
 * entry, enough headroom to absorb an ordinary dependency patch bump without
 * this test flapping, but still well under half of what an unminified build
 * produces, so a reverted `minify: true` fails this test outright rather
 * than slipping through on a threshold picked too tight to be useful.
 *
 * A SECOND REGRESSION THIS FILE NOW ALSO GUARDS: `DetailPanel.tsx`'s
 * transcript and `FilesTab.tsx`'s `.md` preview both statically imported
 * `react-markdown` + `remark-gfm` at their one call site each, and both
 * modules are reachable from the entry the moment the canvas has a single
 * pane -- so the whole markdown stack (react-markdown, remark-gfm and the
 * mdast/micromark/unist/hast/vfile graph underneath) sat in the eager
 * entry whether or not a transcript, or a `.md` file, was ever opened.
 * `LazyMarkdown.tsx` moves the one shared `<Markdown>` call behind a
 * `React.lazy` + `Suspense` boundary; the fallback is the answer's own raw
 * text, so the one render that can see it is still readable.
 *
 * Measured, `electron-vite build`, same code and chunks both times:
 *
 *     entry, markdown stack static (before this split)  716,706 + 153,981 B  =  870,687 B total, all eager
 *     entry, markdown stack lazy   (this fix)            716,706 B eager  +  153,981 B in `LazyMarkdown-*.js`, fetched on first render
 *     entry gzip, before  262,428 B
 *     entry gzip, after   217,432 B
 *
 * A THIRD REGRESSION THIS FILE NOW ALSO GUARDS: `SettingsOverlay` and
 * `FilesTab` both sat in the eager entry too, for the same reason the
 * markdown stack did -- a static import at the one call site each,
 * reachable from the entry the moment the canvas has a single pane.
 * `Canvas.tsx` now imports `SettingsOverlay` behind a `React.lazy` +
 * `Suspense` boundary (fallback `null`: it is a window overlay, drawn only
 * once `settingsOpen` is true, over everything and reflowing nothing beside
 * it); `DetailPanel.tsx` does the same for `FilesTab` (`LazyFilesTab`,
 * fallback `null`: its own `hidden` prop already paints nothing whenever
 * the Files tab is not the open one, which is the common case, so the
 * fallback is indistinguishable from the resolved-but-hidden component
 * there). `FilesTab.tsx` is 2,700+ lines and drags `files-highlight.ts` and
 * the hand-rolled tokenizer `highlight.ts` in behind it; `SettingsOverlay`
 * carries every settings section, including the icons and controls only it
 * uses.
 *
 * Measured, `electron-vite build`, same code and chunks both times:
 *
 *     entry, before this split   719,146 B  (218,206 B gzip)
 *     entry, after this split    624,969 B  (191,941 B gzip)
 *
 * a ~94 KB / ~13% drop in the eagerly-parsed script, ~26 KB / ~12% gzipped
 * -- `SettingsOverlay-*.js` and `FilesTab-*.js` now carry that weight as
 * their own chunks, fetched on first open rather than parsed before the
 * canvas draws anything.
 *
 * `ENTRY_BUDGET_BYTES` (690,000) and `ENTRY_GZIP_BUDGET_BYTES` (212,000)
 * both sit ~10% above THESE "after" figures, the same headroom policy the
 * markdown split above already established -- enough to absorb an ordinary
 * dependency bump without flapping, but a reverted lazy split on either
 * component puts its chunk straight back into the entry and fails both
 *
 * A FOURTH, SMALL, DELIBERATE BUMP: the Stats & Usage entry icon
 * (`SessionList.tsx`'s avatar bar) is eagerly-loaded chrome, same as every
 * other icon there, and `StatsScreen` itself is lazy on `SettingsOverlay`'s
 * own idiom (`StatsScreen-*.js`, fetched on first open, never in this
 * chunk). Measured, `electron-vite build`, after that one icon and its
 * button: entry 690,589 B -- 589 B past the PREVIOUS 690,000 budget, which
 * itself already carried the ~10% headroom the markdown/settings split
 * established, so this is not that same category of change and does not
 * earn a second helping of it.
 *
 * `ENTRY_BUDGET_BYTES` moves to 691,000 -- just past the measured figure,
 * not a fresh 10%: this is one icon, not a split, and the budget should
 * still notice the NEXT one that lands without a reason.
 * budgets outright.
 *
 * A FOURTH GROWTH, ORDINARY THIS TIME RATHER THAN A REGRESSION: the ADHD
 * skill card (`AdhdSkillCard.tsx`, replacing the old concise-output switch)
 * is itself lazy -- it is only ever mounted inside `SettingsOverlay`, so its
 * OWN component code carries no eager weight, verified the same way the
 * three splits above are: its own `data-adhd-skill-install` marker is absent
 * from the entry and present only in `SettingsOverlay-*.js`. The bundled
 * skill files themselves (`resources/skills/i-have-adhd/{SKILL.md,LICENSE}`)
 * are read only by `src/main/skills/adhd-skill.ts` -- a main-process module
 * with its own `node:fs/promises` import that no renderer file reaches --
 * and `src/shared/adhd-skill.ts` (the vocabulary both processes share) holds
 * only string constants and types, never the files' contents; grepping the
 * built entry for `gfmTable`-style unique markers from either bundled file
 * finds nothing, confirming neither ever crosses into the renderer.
 *
 * What DID move the entry is `src/renderer/i18n/strings.ts` itself: the
 * catalogue is one module, `DetailPanel.tsx` (eager) imports it for six
 * unrelated keys (`prs.repo.*`, `steps.*`), and Rollup inlines the WHOLE
 * `EN` object into every chunk that reaches it rather than splitting it into
 * a shared chunk of its own -- so all ~100 `settings.*` strings ride in the
 * eager entry regardless of `SettingsOverlay`'s own lazy boundary, and did
 * before this card existed too. Growing that catalogue by one row -- a
 * title, a hint, three status words, two button labels, a confirm, a copy
 * command invitation, a credit and a link, a coverage heading and two chip
 * words, a browser fallback, a one-time migration note -- costs real bytes
 * here on that account alone. The copy was written tersely on purpose
 * (`i18n/strings.ts`'s own comment on the block says so) and still costs
 * this much; splitting the catalogue itself into an eager and a
 * settings-only module was considered and set aside FOR THIS PR, because
 * `src/renderer/i18n/strings.ts` is also where a second, parallel change
 * (an Integrations → GitHub settings section) adds its own rows at the same
 * time -- restructuring the module underneath a change in flight elsewhere
 * is a conflict this repository does not need. Left as a note for whoever
 * next grows this catalogue substantially: the six non-`settings.*` keys are
 * the only ones `DetailPanel.tsx` actually reads, so moving the rest to
 * their own module and giving `SettingsOverlay.tsx` (and its own children)
 * a separate `t()` over CORE + SETTINGS would let entry-chunk growth track
 * only the six keys DetailPanel actually needs, not the other ~100.
 *
 * Measured with a merge-base worktree build (`git worktree add` at this PR's
 * actual merge-base with `smith/vam/0.2-tab-shell`, 6331d640, through #514),
 * same code and chunks both times, `electron-vite build --mode production`:
 *
 *     entry, merge-base (no card)   689,116 B  (207,368 B gzip)
 *     entry, this PR (with card)    690,127 B  (207,626 B gzip)
 *
 * +1,011 B eager / +258 B gzipped for the whole card -- confirming the
 * component itself costs nothing here (it is lazy, above); this is purely
 * the catalogue rows, same order of magnitude as an ordinary small feature
 * elsewhere in this codebase. Gzip (207,626 B) is still comfortably UNDER
 * the pre-existing 212,000 B budget -- that number is untouched by this PR.
 * Eager crosses the pre-existing 690,000 B budget by only 127 B: the
 * baseline had already drifted to within 884 B of that ceiling from
 * ordinary, unrelated growth in the time since the 624,969 B split above,
 * and this card's own ~1 KB is what tips it over, not an outsized cost of
 * its own.
 *
 * `ENTRY_BUDGET_BYTES` moves 690,000 -> 692,000: just enough to clear this
 * PR's own measured 690,127 B, plus ~1.9 KB (~0.3%) of slack for measurement
 * noise -- NOT a fresh "~10%" re-baseline off the current, already-grown
 * entry, which would manufacture a ~70 KB jump no single small feature here
 * earned. `ENTRY_GZIP_BUDGET_BYTES` stays at 212,000: this PR's own gzip
 * figure does not approach it.
 *
 * The entry chunk is found by parsing the renderer's own emitted
 * `index.html` for its `<script type="module">` tag -- the same thing a
 * browser reads to decide what loads eagerly -- rather than a hardcoded
 * filename or a list of module names, a rule this repo has already shipped
 * once that was proven to be TYPED without ever being proven to MATCH.
 * `electron-vite`'s CLI has no `--manifest` flag (unlike plain `vite build`),
 * so the manifest approach the web-pipeline guard used is not available
 * here; the HTML is the real, unassailable substitute.
 *
 * A BUDGET BUMP, NOT A REGRESSION: Settings -> Integrations -> GitHub adds a
 * new `GithubPanel.tsx`, but that component is reached only through
 * `SettingsOverlay`'s existing lazy boundary -- verified: `data-github-status`
 * and every `vam:github:*` channel string are absent from the entry chunk,
 * exactly like the three components above. What DOES sit in the eager entry,
 * by this file's own catalogue-is-a-Settings-surface rule (see
 * `i18n/strings.ts`'s header: "A key that does not exist is a type error" --
 * there is no per-component lazy catalogue to opt out into), is the ~30 new
 * `settings.integrations.*` strings themselves, plus the new `sections.ts`
 * nav entry (`sections.ts` is also reachable from `SessionList.tsx` and
 * `canvas-overlays.ts`, both eager, so its icons are never lazy either) and
 * a small `Canvas.tsx` memo feeding the repo picker its project list.
 *
 * Measured, `electron-vite build`, same code and chunks both times:
 *
 *     entry, before Integrations  689,692 B
 *     entry, after Integrations   691,861 B
 *
 * a ~2,169 B growth entirely in Settings-surface strings and nav metadata,
 * not in the new panel's own code. The PREVIOUS `ENTRY_BUDGET_BYTES`
 * (690,000) had already been eaten down to 308 B of slack by unrelated work
 * landed on this branch before this change even started -- this bump does
 * not restore the old 10%-headroom policy, it only clears the one feature
 * that is actually landing here, with the same amount of margin (692,500 -
 * 691,861 = 639 B) the old budget gave for "an ordinary dependency bump."
 * The gzip budget is untouched: `ENTRY_GZIP_BUDGET_BYTES` still passes, since
 * short repeated UI strings compress well.
 *
 * THE ADHD CARD AND INTEGRATIONS THEN MERGED, EACH HAVING BUDGETED FOR ITS
 * OWN DELTA ALONE (692,000 above and 692,500 here) -- neither number
 * accounted for the other landing too, so the merge needed a real
 * remeasurement rather than trusting either arithmetic in isolation.
 * Measured with a merge-base worktree build at the true common ancestor of
 * both PRs (`main`, 5176d0ad, before either landed) and at the merge commit
 * carrying both, same code and chunks both times, `electron-vite build
 * --mode production`:
 *
 *     entry, common ancestor (neither feature)   689,116 B  (207,368 B gzip)
 *     entry, merged (both features)              692,320 B  (208,172 B gzip)
 *
 * +3,204 B eager / +804 B gzip combined -- close to the sum of the eager
 * side of the two features' own separately-measured deltas (1,011 + 2,169 =
 * 3,180 B; the Integrations header above gives no isolated gzip figure of
 * its own to sum against, only "the gzip budget is untouched"), confirming
 * the merge did not duplicate or multiply either eager cost.
 * `ENTRY_BUDGET_BYTES` moved 692,500 -> 694,500: the real merged
 * figure (692,320 B) plus ~2.2 KB (~0.3%) of slack, the same order of
 * headroom both individual bumps above used for "measurement noise and an
 * ordinary dependency patch bump" -- not a fresh double-bump stacking both
 * PRs' own margins on top of each other. `ENTRY_GZIP_BUDGET_BYTES` stayed at
 * 212,000: the merged gzip figure (208,172 B) still had 3.8 KB of headroom
 * under it, more than either feature alone needed.
 *
 * THE CACHE-TIMER COUNTDOWN THEN MERGED IN TOO, on top of the ADHD-card +
 * Integrations tree above: `domain/cache-timer.ts`, `panels/
 * CacheCountdown.tsx`, `panels/cache-timer-clock.ts`, three new `Session`
 * fields threaded through `SessionList.tsx`, and the sidebar's first-ever
 * use of lucide's `Timer` glyph, eager by necessity -- it draws in the
 * sidebar, which every load already pays for, so there is no lazy boundary
 * to move it behind the way `SettingsOverlay` and `FilesTab` were. This
 * branch's own two earlier "before/after" pairs (measured against
 * Integrations alone, then re-measured against Integrations alone again
 * after this branch's own rebases) both went stale the moment the ADHD card
 * and Integrations merged into ONE commit on `main` -- so, the same lesson
 * the paragraph above already draws, this is a real remeasurement against
 * the true merged tree rather than arithmetic stacked on top of either
 * stale figure. Measured with a merge-base worktree build at `main`'s own
 * tip carrying both prior features (14a57c03) and at this branch's merge
 * commit carrying all three, same code and chunks both times,
 * `electron-vite build --mode production`:
 *
 *     entry, main (ADHD card + Integrations, neither cache-timer)   692,523 B
 *     entry, merged (all three features)                           695,970 B  (+3,447 B, +0.50%)
 *
 * `ENTRY_BUDGET_BYTES` moves 694,500 -> 699,500: the real merged figure
 * (695,970 B) plus ~3.5 KB (~0.5%) of slack, the same small-headroom
 * convention every bump above uses for "measurement noise and an ordinary
 * dependency patch bump" -- not the three features' own separate margins
 * stacked on top of each other. `ENTRY_GZIP_BUDGET_BYTES` stays at 212,000:
 * unaffected by this merge, still comfortably clear of the combined figure.
 *
 * THE SETTINGS CARDS RESTRUCTURE (Appearance split into Interface, Terminal
 * and Window & Sidebar; Sessions renamed Agents; four new primitives)
 * TOUCHES NEITHER BUDGET, and is the first entry here that does not. It is a
 * pure re-layout of code and strings already behind `SettingsOverlay`'s own
 * lazy boundary -- no new eager import, no new eager component -- so its
 * whole cost lands in the `SettingsOverlay-*.js` chunk this file does not
 * budget (lazy chunks are checked for existence and for the entry's absence
 * from them, never for size). Measured with a merge-base worktree build at
 * this PR's own merge-base (`main`, 3ea57e75) and at this branch's tip, same
 * code and chunks both times, `electron-vite build --mode production`:
 *
 *     entry, merge-base       695,970 B  (209,465 B gzip)
 *     entry, this PR          696,124 B  (209,544 B gzip)  (+154 B, +0.02%)
 *     SettingsOverlay chunk, merge-base    76,458 B
 *     SettingsOverlay chunk, this PR       80,171 B  (lazy; unbudgeted)
 *
 * +154 B eager / +79 B gzip -- the new icons (`PanelLeft`, `SquareTerminal`)
 * `sections.ts` now imports, which is also reachable eagerly from
 * `SessionList.tsx`/`canvas-overlays.ts` (the same reason the Integrations
 * bump above measured `sections.ts`'s own nav metadata as eager cost). Both
 * budgets keep the headroom the Integrations/cache-timer bump left them
 * (699,500 - 696,124 = 3,376 B eager; 212,000 - 209,544 = 2,456 B gzip), so
 * neither constant moves -- "bump only by the measured need," and the
 * measured need here is comfortably inside what is already there.
 *
 * MEANWHILE, IN PARALLEL, `main` ALSO GREW: THIS STATS & USAGE PR THEN
 * MERGED `main` AGAIN, and `main` had grown on
 * its own in the meantime (`phone: FAB project picker, touch-reachable
 * project controls, session preview line`, #527, 3eb46bbb) -- eager because
 * the FAB and its icons draw in the phone shell chrome, no lazy boundary to
 * hide behind. Measured with a merge-base worktree build at #527's own tip
 * (no Stats & Usage PR at all) and at this branch's own merge commit
 * (carrying #527 plus every Stats & Usage round), same code and chunks both
 * times, `electron-vite build --mode production`:
 *
 *     entry, main alone (#527, no Stats & Usage)   699,217 B
 *     entry, merged (#527 + Stats & Usage)         700,155 B  (+938 B)
 *
 * The 699,500 budget above had already been eaten down to 283 B of headroom
 * by #527 alone, unrelated to anything in this PR; this PR's own Stats &
 * Usage additions (the icon tiles' `i18n/strings.ts` labels -- that
 * catalogue is entirely eager regardless of which screen reads it, see the
 * ADHD-card paragraph above) are the +938 B that tips it over, not an
 * outsized cost of their own. `ENTRY_BUDGET_BYTES` moves 699,500 -> 702,000:
 * the real merged figure (700,155 B) plus ~1.8 KB (~0.26%) of slack, the
 * same small-headroom convention every bump above uses -- not a fresh
 * re-baseline. `ENTRY_GZIP_BUDGET_BYTES` stays at 212,000: this merge's gzip
 * figure does not approach it.
 *
 * THE SETTINGS CARDS BRANCH AND THIS STATS & USAGE TREE (which already
 * carries #527) THEN MERGED INTO EACH OTHER, each having budgeted for its
 * own delta alone (696,124 B measured, no bump vs. 700,155 B measured,
 * bumped to 702,000) -- neither figure accounted for the other landing too,
 * so the merge needed a real remeasurement rather than trusting either
 * arithmetic in isolation, the same lesson the ADHD-card/Integrations merge
 * above already drew. Measured with a worktree build at the true common
 * ancestor of both trees (810e9e06, before either the settings-cards round 2
 * work or the #527/Stats & Usage work landed) and at this merge commit
 * carrying all of it, same code and chunks both times, `electron-vite build
 * --mode production`:
 *
 *     entry, common ancestor (neither tree's own further work)   699,332 B  (210,827 B gzip)
 *     entry, merged (settings cards + #527 + Stats & Usage)      700,444 B  (211,154 B gzip)
 *
 * +1,112 B eager / +327 B gzip combined -- both trees' own work above this
 * common ancestor was already accounted for in each side's separate
 * "before/after" pairs; this remeasurement is the two SIDES combining from
 * that shared point, not a third source of growth. `ENTRY_BUDGET_BYTES`
 * stays at 702,000: the real merged figure (700,444 B) leaves 1,556 B of
 * headroom, so this merge does not need to move it -- the Stats & Usage bump
 * above already covers it. `ENTRY_GZIP_BUDGET_BYTES` stays at 212,000: the
 * merged gzip figure (211,154 B) leaves 846 B of headroom under it.
 *
 * SETTINGS STEP 2A: terminal font family + live preview + pane-divider
 * colour, UI font family, and UI zoom (reversing #281, `main/zoom.ts`'s own
 * header carries that story). All five rows are eager -- Settings itself has
 * no lazy boundary here, so their `i18n/strings.ts` copy, `TerminalPreview.
 * tsx` and the new `FontFamilyField`/stepper markup all land in the entry
 * chunk regardless of which card the operator opens. Measured with a
 * detached worktree build at this branch's own merge-base with `main`
 * (d2c54b66, "Restructure Settings into collapsible cards (step 1: layout
 * only)", #528 -- `main` had not moved since) and at this branch's tip, same
 * code and chunks both times, `electron-vite build --mode production`:
 *
 *     entry, merge-base (step 1 layout only, no step 2A)   700,444 B  (210,619 B gzip)
 *     entry, this branch (step 2A)                         703,011 B  (211,393 B gzip)
 *
 * +2,567 B eager / +774 B gzip. `ENTRY_BUDGET_BYTES` moves 702,000 -> 704,500:
 * the real figure (703,011 B) plus ~1.5 KB (~0.21%) of slack, the same
 * small-headroom convention every bump above uses. `ENTRY_GZIP_BUDGET_BYTES`
 * stays at 212,000: this branch's gzip figure (211,393 B) still leaves 607 B
 * of headroom under it.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const electronViteBinary = path.join(repoRoot, 'node_modules', '.bin', 'electron-vite');
const configPath = path.join(repoRoot, 'electron.vite.config.ts');
// The same existence-only gate `test/e2e/config-collection.test.ts` uses for
// its harness: a cheap, synchronous check for whether the tool this test
// depends on is even present, decided BEFORE anything tries to build.
const buildAvailable = existsSync(electronViteBinary) && existsSync(configPath);

const ENTRY_BUDGET_BYTES = 704_500;
const ENTRY_GZIP_BUDGET_BYTES = 212_000;

// The one string this repo's markdown stack ships that nothing else in the
// dependency graph or vam's own source does: `gfmTable`, the extension name
// `micromark-extension-gfm-table` registers itself under (verified: `grep -rn
// gfmTable src` and `grep -rl gfmTable node_modules` both point only at that
// package). remark-gfm pulls it in transitively, and remark-gfm only ever
// ships together with react-markdown at vam's two call sites
// (`DetailPanel.tsx`'s transcript and `FilesTab.tsx`'s `.md` preview) --
// so this string is a stand-in for "the markdown stack", immune to
// minification renaming a function or a variable the way a symbol-name
// grep would not be.
const MARKDOWN_STACK_MARKER = 'gfmTable';

// `SettingsOverlay`'s own root DOM attribute -- a bare JSX attribute name
// survives minification verbatim (it has to keep matching the real DOM
// attribute), and this one is written nowhere else (verified: `grep -rn
// data-settings-overlay src` outside `SettingsOverlay.tsx` finds nothing,
// and `grep -rl data-settings-overlay node_modules` finds nothing).
const SETTINGS_OVERLAY_MARKER = 'data-settings-overlay';

// The editor's own attribute, ONE LEVEL IN from `FilesTab`'s bare
// `data-files` root: that shorter string is also a PREFIX several sibling
// attributes share (`data-files-row`, `data-files-tree-resize`, …), so a
// substring match on it inside ~700 KB of minified JS risks matching one of
// those instead of proving the component itself shipped. `data-files-editor`
// is exact. Verified unique the same way as the two markers above: `grep -rn
// data-files-editor src` outside `FilesTab.tsx` finds nothing, and
// `grep -rl data-files-editor node_modules` finds nothing.
const FILES_TAB_MARKER = 'data-files-editor';

// `TerminalStreamTab`'s own unpadded xterm mount, one level in from the
// pane's bare `data-terminal-stream` root for the same reason
// `FILES_TAB_MARKER` is not `data-files`: this one is exact, never a prefix
// another attribute shares. Verified unique the same way as the three
// markers above: `grep -rn data-terminal-stream-mount src` outside
// `TerminalStreamTab.tsx` finds nothing, and `grep -rl
// data-terminal-stream-mount node_modules` finds nothing.
const TERMINAL_STREAM_MARKER = 'data-terminal-stream-mount';

describe.skipIf(!buildAvailable)('electron renderer entry chunk budget', () => {
  let outDir: string;
  let entryBytes: number;
  let entryText: string;
  let otherAssetTexts: string[];

  beforeAll(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'vam-bundle-budget-'));
    const result = spawnSync(
      electronViteBinary,
      [
        'build',
        '--config',
        configPath,
        '--outDir',
        outDir,
        '--mode',
        'production',
        '--logLevel',
        'silent',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 60_000,
        // Vitest runs this file with `NODE_ENV=test`, which a spawned
        // child inherits by default. Vite/React key their production
        // codepath off exactly that variable, not off `--mode`, so an
        // inherited `test` here builds React's development bundle --
        // bigger, unminified-shaped, and not what `build:app` (or the
        // epic's own baseline) ever ships.
        env: { ...process.env, NODE_ENV: 'production' },
      },
    );
    // `result.error` (spawn itself failed) is checked before `status`: on a
    // killed or unspawnable child `status` is `null`, ambiguous with a
    // clean-but-signalled exit.
    if (result.error) {
      throw new Error(`electron-vite build failed to spawn: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(
        `electron-vite build exited ${String(result.status)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }

    const htmlPath = path.join(outDir, 'renderer', 'index.html');
    const html = readFileSync(htmlPath, 'utf-8');
    // Exactly what a browser (or Electron's renderer) parses to decide
    // what loads before anything else: the module script(s) in the HTML.
    // A dynamically-imported chunk is never referenced here -- that is
    // the whole point of a lazy boundary -- so this is genuinely "the
    // eager set", not an assumption about which file is named what.
    const scriptSrcs = [...html.matchAll(/<script[^>]*\stype="module"[^>]*\ssrc="([^"]+)"/g)].map(
      (m) => m[1],
    );

    // If the renderer stopped emitting exactly one eager entry script, that
    // is a bigger fact than a byte count and deserves its own clear failure
    // rather than a confusing assertion on `scriptSrcs[0]`.
    expect(scriptSrcs).toHaveLength(1);

    const entrySrc = scriptSrcs[0];
    if (entrySrc === undefined) {
      throw new Error('unreachable: length asserted above');
    }
    const entryPath = path.join(outDir, 'renderer', entrySrc);
    entryBytes = statSync(entryPath).size;
    entryText = readFileSync(entryPath, 'utf-8');

    const assetsDir = path.join(outDir, 'renderer', 'assets');
    otherAssetTexts = readdirSync(assetsDir)
      .filter((name) => name.endsWith('.js') && name !== path.basename(entrySrc))
      .map((name) => readFileSync(path.join(assetsDir, name), 'utf-8'));
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it(`the eagerly-loaded entry chunk stays under ${ENTRY_BUDGET_BYTES} bytes`, () => {
    expect(entryBytes).toBeLessThan(ENTRY_BUDGET_BYTES);
  });

  it(`the eagerly-loaded entry chunk stays under ${ENTRY_GZIP_BUDGET_BYTES} gzip bytes`, () => {
    const entryGzipBytes = gzipSync(entryText).length;
    expect(entryGzipBytes).toBeLessThan(ENTRY_GZIP_BUDGET_BYTES);
  });

  it('the markdown stack (react-markdown + remark-gfm) is not in the eager entry chunk', () => {
    // A boolean assertion, not `expect(entryText).not.toContain(...)`: the
    // entry is ~800 KB of minified JS on one line, and a failed `toContain`
    // has Vitest diff the whole string against the needle -- megabytes of
    // output for one missing substring. Falsify by statically importing
    // `out-markdown.tsx` or `files-markdown.tsx` from `DetailPanel.tsx` /
    // `FilesTab.tsx` again instead of through the lazy `LazyMarkdown`
    // boundary -- this line goes red:
    //   expect(entryText.includes('gfmTable')).toBe(false)
    //   AssertionError: expected true to be false
    expect(entryText.includes(MARKDOWN_STACK_MARKER)).toBe(false);
  });

  it('the markdown stack still ships, in a lazy chunk', () => {
    // Guards against the test above passing for the wrong reason -- the
    // marker disappearing because the code was deleted or tree-shaken away
    // entirely, not because it moved to a lazy boundary.
    expect(otherAssetTexts.some((text) => text.includes(MARKDOWN_STACK_MARKER))).toBe(true);
  });

  it('SettingsOverlay is not in the eager entry chunk', () => {
    // Falsify by making `Canvas.tsx` import `SettingsOverlay` from
    // `../settings/SettingsOverlay.js` directly again instead of through
    // its own `lazy(() => import(...))` -- this line goes red:
    //   expect(entryText.includes('data-settings-overlay')).toBe(false)
    //   AssertionError: expected true to be false
    expect(entryText.includes(SETTINGS_OVERLAY_MARKER)).toBe(false);
  });

  it('SettingsOverlay still ships, in a lazy chunk', () => {
    expect(otherAssetTexts.some((text) => text.includes(SETTINGS_OVERLAY_MARKER))).toBe(true);
  });

  it('FilesTab is not in the eager entry chunk', () => {
    // Falsify by making `DetailPanel.tsx` import `FilesTab` from
    // `./FilesTab.js` directly again instead of through `LazyFilesTab`'s
    // `lazy(() => import(...).then(...))` -- this line goes red:
    //   expect(entryText.includes('data-files-editor')).toBe(false)
    //   AssertionError: expected true to be false
    expect(entryText.includes(FILES_TAB_MARKER)).toBe(false);
  });

  it('FilesTab still ships, in a lazy chunk', () => {
    expect(otherAssetTexts.some((text) => text.includes(FILES_TAB_MARKER))).toBe(true);
  });

  it('TerminalStreamTab (xterm.js) is not in the eager entry chunk', () => {
    // Streaming is the DEFAULT renderer now (`prefs/streaming-terminal.ts`),
    // which makes this boundary matter MORE than it did as a beta, not less
    // -- xterm.js is not small, and `TerminalAutoTab.tsx` still only needs
    // it once a session's Terminal tab is actually opened. Falsify by
    // importing `TerminalStreamTab` from `./TerminalStreamTab.js` directly
    // in `TerminalAutoTab.tsx` again instead of through its own
    // `lazy(() => import(...).then(...))` -- this line goes red:
    //   expect(entryText.includes('data-terminal-stream-mount')).toBe(false)
    //   AssertionError: expected true to be false
    expect(entryText.includes(TERMINAL_STREAM_MARKER)).toBe(false);
  });

  it('TerminalStreamTab still ships, in a lazy chunk', () => {
    expect(otherAssetTexts.some((text) => text.includes(TERMINAL_STREAM_MARKER))).toBe(true);
  });
});

if (!buildAvailable) {
  // `describe.skipIf` reports the block as skipped without a reason string
  // in the default reporter output; this makes the "why" visible in the
  // same run rather than only in this file's own header comment.
  describe('electron renderer entry chunk budget', () => {
    it.skip('node_modules/.bin/electron-vite or electron.vite.config.ts is missing -- see file header', () => {});
  });
}
