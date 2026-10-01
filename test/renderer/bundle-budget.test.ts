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
 * THE PHONE COMPOSER'S LAYOUT FIX (the operator's own report: "the buttons
 * in the prompt input on mobile... cover most of the input box"). The
 * textarea's wrapper became its own real card (`data-prompt-input`), the
 * "+"/dictate/Send trio became a real, `flex-none` box of their own
 * (`data-prompt-tools`, no longer `display: contents`) instead of three
 * items flattened into the same row as the textarea, and Send gained the
 * inset `[data-tap-skin]` span every OTHER composer icon already wore --
 * three real DOM nodes and their class lists that did not exist before, none
 * of them behind a lazy boundary (the composer is eager on every session
 * screen). Measured, `electron-vite build --mode production`, this
 * worktree's own before/after with only `DetailPanel.tsx` and `styles.css`
 * reverted to `main`'s tip (3eb46bbb) for "before":
 *
 *     entry, before (main's tip)         699,300 B
 *     entry, after (this fix)            699,722 B  (+422 B, +0.06%)
 *
 * `ENTRY_BUDGET_BYTES` moves 699,500 -> 703,300: the real figure (699,722 B)
 * plus ~3.6 KB (~0.5%) of slack, the same small-headroom convention every
 * bump above uses. `ENTRY_GZIP_BUDGET_BYTES` stays at 212,000: gzip
 * compresses the three controls' near-identical class-list strings well,
 * and the gzip check passed unmodified against this same build.
 *
 * THE PHONE'S OWN CHANNEL INTO A PANE (the operator's own second report: "I
 * don't see the quick buttons above the prompt input"). `KEY_STRIP` gained
 * an eighth entry (`tab`, reusing `space`'s own literal-text path) and a
 * dual-channel render (`hasLocalTerminalChannel`/`canSendKeysRemotely`, both
 * new, each carrying its own explanatory comment); the strip itself gained
 * four buttons Orca's own layout puts beside the six keys (a keyboard-toggle,
 * a screen icon, a "»" overflow and Paste); and `typePaneStrokes` gained the
 * `/api/send-key` fallback (`send-key-remote.ts`) for the one build with no
 * `window.api` at all. All of it is eager: the strip draws on every phone
 * session screen, the same as the composer it sits above. Measured,
 * `electron-vite build --mode production`, this worktree's own before/after
 * with only `DetailPanel.tsx` and `styles.css` reverted to this branch's own
 * merge-base for "before":
 *
 *     entry, before (merge-base, composer fix only)   699,722 B
 *     entry, after (this fix)                          704,094 B  (+4,372 B, +0.62%)
 *
 * `ENTRY_BUDGET_BYTES` moves 703,300 -> 707,700: the real figure (704,094 B)
 * plus ~3.6 KB (~0.5%) of slack, the same small-headroom convention every
 * bump above uses. `ENTRY_GZIP_BUDGET_BYTES` stays at 212,000: the new
 * strings and class lists compress well, and the gzip check passed
 * unmodified against this same build.
 *
 * MERGED WITH #522 (composer remount height, hidden-note pause, reused-
 * question double-draw) ON TOP OF THIS BRANCH'S OWN WORK, same as the ADHD
 * card + Integrations merge above: neither PR budgeted for the other landing
 * too. Measured, `electron-vite build --mode production`, at the merge
 * commit carrying both:
 *
 *     entry gzip, at the merge   212,003 B  (3 B over the unmoved 212,000)
 *
 * Three bytes is noise, not a feature this PR's own work cost -- eager stays
 * comfortably under 707,700 at this same build. `ENTRY_GZIP_BUDGET_BYTES`
 * moves 212,000 -> 213,000: enough to clear #522's own small, unrelated
 * contribution to the shared gzip stream with the same order of slack every
 * bump above uses, not a fresh re-baseline.
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
 * THIS PHONE-COMPOSER FOLLOW-UP BRANCH AND THE SETTINGS-CARDS TREE (which
 * already carries #527 and Stats & Usage) THEN MERGED INTO EACH OTHER, each
 * having budgeted for its own delta alone (707,700 on this side, 702,000 on
 * `main`'s) -- neither figure accounted for the other landing too, so this
 * merge needed a real remeasurement rather than trusting either arithmetic in
 * isolation, the same lesson every merge paragraph above already draws.
 * Measured, `electron-vite build --mode production`, on this merge commit
 * (both trees combined, plus the composer/key-strip gap-tightening follow-up
 * in the same commit):
 *
 *     entry, merged (phone composer follow-up + settings cards + #527 + Stats & Usage)   706,044 B  (212,509 B gzip)
 *
 * Both budgets hold WITHOUT moving: 707,700 - 706,044 = 1,656 B of headroom
 * left (0.23%), 213,000 - 212,509 = 491 B left (0.23%) -- thinner than this
 * file's usual ~0.5% convention, but a real measured pass is a real measured
 * pass; the next PR to land here should expect to remeasure and bump rather
 * than assume either number still has room.
 *
 * MEANWHILE, ON A SIBLING BRANCH, THE PHONE TOOLBAR PASS (Orca one-row
 * collapse, follow-up to pull request 527, then its own spacing/account-icon
 * follow-up) MERGED `main` TWICE MORE: first the Stats & Usage PR (#518,
 * squash-merged first), then Settings Cards (#528, "touches neither budget"
 * -- the same pure re-layout the paragraph above already covers). Three
 * independent, additive costs landing in the same eager entry: the toolbar
 * pass touches phone-only render paths, Stats & Usage a desktop-only icon
 * beside the account button, Settings Cards nothing eager at all. Measured
 * with a merge-base worktree build at `main`'s own tip carrying all three
 * (#527 + #518 + #528, d2c54b66 -- the same commit this branch's own
 * paragraph above measures as "700,444 B (211,154 B gzip)") and at that
 * branch's own merge commit, same code and chunks both times,
 * `electron-vite build --mode production`:
 *
 *     entry, main (#527 + #518 + #528, before that merge)   700,444 B  (211,154 B gzip)
 *     entry, merged (+ the phone toolbar pass)              705,616 B  (211,927 B gzip)  (+5,172 B, +0.74%)
 *
 * `ENTRY_BUDGET_BYTES` stays at 707,000: the real merged figure (705,616 B)
 * leaves 1,384 B of headroom, so this merge does not need to move it -- the
 * toolbar pass's own earlier bump already covers it. `ENTRY_GZIP_BUDGET_BYTES`
 * stays at 212,500: the merged gzip figure (211,927 B) leaves 573 B of
 * headroom under it, the same reasoning.
 *
 * SETTINGS STEP 2B (Window & Sidebar: sidebar appearance, status-bar usage
 * toggles; Agents: keep computer awake, auto tab titles, agent permissions
 * Manual/Yolo, default agent) adds real eager logic, not only catalogue
 * strings: `Canvas.tsx` gains the usage-mode/keep-awake wiring and
 * `sessionArgv`/`resolveDefaultAgentSelection` calls, `prefs.ts` gains eight
 * fields and `applyAutoTabTitles`, six new `prefs/*.ts` reader modules and
 * `shared/providers.ts` / `shared/usage.ts` / `shared/codex-usage.ts` all
 * grow -- all of it reachable from the eager entry the same way the
 * catalogue strings are, none of it behind `SettingsOverlay`'s lazy
 * boundary (only the JSX rows themselves are). `src/main/power/*` is
 * main-process only and never reaches the renderer bundle at all. Measured
 * with a merge-base worktree build (`git worktree add --detach` at this
 * branch's own merge-base with `origin/main`, d2c54b66 -- HEAD and the
 * merge-base are the same commit, so this is a clean before/after with no
 * unrelated drift to account for) and this branch's own working tree, same
 * `electron-vite build --mode production` both times:
 *
 *     entry, merge-base (d2c54b66, no step 2B)   700,444 B  (211,154 B gzip)
 *     entry, this branch (with step 2B)          707,013 B  (212,880 B gzip)
 *
 * +6,569 B eager / +1,726 B gzip -- larger than a strings-only bump because
 * this PR is several small features' worth of logic, not one row.
 * `ENTRY_BUDGET_BYTES` moves 702,000 -> 709,500: the real measured figure
 * (707,013 B) plus ~2.5 KB (~0.35%) of slack, the same small-headroom
 * convention every bump above uses for measurement noise and an ordinary
 * dependency patch bump -- not a fresh re-baseline off a number this PR did
 * not earn. `ENTRY_GZIP_BUDGET_BYTES` moves 212,000 -> 213,500: the measured
 * figure (212,880 B) plus ~0.6 KB (~0.3%) of the same slack.
 *
 * THE PHONE TOOLBAR PASS AND SETTINGS STEP 2B THEN MERGED INTO EACH OTHER,
 * each having budgeted for its own delta alone against the SAME shared
 * ancestor (d2c54b66) -- the toolbar pass's own bump landed on `main` first
 * (707,000/212,500), step 2B's own bump (709,500/213,500, above) was measured
 * against a merge-base that predates it, so neither figure accounts for the
 * other's growth landing too. Same lesson every prior fan-in merge in this
 * file already drew: a real remeasurement, not arithmetic stacked on top of
 * either side's own number. Measured with a merge-base worktree build at
 * `origin/main`'s own tip (cdc8be7b, the phone toolbar pass, no step 2B) and
 * at this branch's merge commit (carrying both), same code and chunks both
 * times, `electron-vite build --mode production`:
 *
 *     entry, main (phone toolbar, no step 2B)   705,616 B  (211,927 B gzip)
 *     entry, merged (+ step 2B)                 712,220 B  (213,705 B gzip)  (+6,604 B, +0.94%)
 *
 * +6,604 B eager / +1,778 B gzip -- within measurement noise of step 2B's own
 * isolated delta (+6,569 B / +1,726 B, above): the phone toolbar pass touches
 * only phone-only render paths, none of which step 2B's own eager growth
 * (`Canvas.tsx`/`prefs.ts`/`shared/*`, the same paragraph) shares, so the two
 * sides' costs are simply additive rather than interacting. `ENTRY_BUDGET_
 * BYTES` moves 709,500 -> 714,500: the real merged figure (712,220 B) plus
 * ~2.2 KB (~0.32%) of slack, the same small-headroom convention every bump
 * above uses -- not a fresh re-baseline off either side's own margin.
 * `ENTRY_GZIP_BUDGET_BYTES` moves 213,500 -> 214,500: the measured figure
 * (213,705 B) plus ~0.8 KB (~0.37%) of the same slack.
 *
 * SETTINGS STEP 2A (terminal font family + live preview + pane-divider
 * colour, UI font family, and UI zoom, reversing #281 -- `main/zoom.ts`'s own
 * header carries that story) THEN MERGED THE PHONE TOOLBAR PASS IN, and this
 * branch's own earlier figure above (703,011 B, measured against d2c54b66
 * alone, before the toolbar pass existed) went stale the moment the two
 * landed together -- the same lesson every merge paragraph above already
 * draws. All five Settings rows are eager regardless of which side of the
 * merge they arrived from -- Settings itself has no lazy boundary here, so
 * their `i18n/strings.ts` copy, `TerminalPreview.tsx` and the new
 * `FontFamilyField`/stepper markup land in the entry chunk whether or not
 * the operator ever opens that card. Measured at `main`'s own tip carrying
 * the toolbar pass alone (cdc8be7b, no step 2A) and at this merge commit
 * carrying both, same code and chunks both times, `electron-vite build
 * --mode production`:
 *
 *     entry, main (toolbar pass, no step 2A)   705,616 B  (211,927 B gzip)
 *     entry, merged (+ Settings step 2A)       708,220 B  (212,170 B gzip)  (+2,604 B, +0.37%)
 *
 * `ENTRY_BUDGET_BYTES` moved 707,000 -> 710,000 for that merge: the real
 * figure (708,220 B) plus ~1.8 KB (~0.25%) of slack, the same small-headroom
 * convention every bump above uses. `ENTRY_GZIP_BUDGET_BYTES` moved
 * 212,500 -> 213,000: the merged gzip figure (212,170 B) had only 330 B of
 * headroom left under the old budget, thinner than this file's own
 * convention leaves anywhere else, so it moved too. BOTH FIGURES THEN WENT
 * STALE AGAIN, the same paragraph below explains: `main` grew a THIRD
 * independent branch (the phone-composer follow-up, #530) while this one was
 * still open.
 *
 * MEANWHILE, `main` ALSO MERGED THE PHONE-COMPOSER FOLLOW-UP (#530: the
 * Orca-shaped composer and its own keystroke strip reaching the phone) INTO
 * THE PHONE TOOLBAR PASS, each having budgeted for its own delta alone
 * against the same 700,444 B starting point (707,700/213,000 on the
 * composer follow-up's own side, 707,000/212,500 on the toolbar pass's) --
 * neither figure accounted for the other landing too, so THAT merge needed
 * its own remeasurement, the same lesson every paragraph here keeps
 * drawing. Measured on `main`'s own tip carrying all of it (composer
 * follow-up + toolbar pass + settings cards + #527 + Stats & Usage,
 * a1cdb816):
 *
 *     entry, main (composer follow-up + toolbar pass, no step 2A)   711,242 B  (213,299 B gzip)
 *
 * `ENTRY_BUDGET_BYTES` moved 707,700 -> 714,800 on `main` for that merge (the
 * real figure, 711,242 B, plus ~3.6 KB/~0.5% slack); `ENTRY_GZIP_BUDGET_BYTES`
 * moved 213,000 -> 214,400 (213,299 B plus ~1.1 KB/~0.5%).
 *
 * SETTINGS STEP 2A + PHONE TOOLBAR PASS then merged THIS THIRD BRANCH in
 * too, so BOTH of the paragraphs above (708,220 B/710,000 here; 711,242 B/
 * 714,800 on `main`) are stale the instant this merge lands -- each measured
 * only two of the three branches now present. Measured on `main`'s own tip
 * carrying all three (a1cdb816) and on this merge commit carrying all four
 * (composer follow-up + toolbar pass + Settings step 2A + settings cards +
 * #527 + Stats & Usage), same code and chunks both times, `electron-vite
 * build --mode production`:
 *
 *     entry, main (composer follow-up + toolbar pass, no step 2A)   711,242 B  (213,299 B gzip)
 *     entry, merged (+ Settings step 2A)                            713,837 B  (213,680 B gzip)  (+2,595 B, +0.36%)
 *
 * `ENTRY_BUDGET_BYTES` moves 714,800 -> 716,000: the real merged figure
 * (713,837 B) plus ~2.2 KB (~0.30%) of slack, the same convention every bump
 * above uses -- not the separate branches' own margins added together.
 * `ENTRY_GZIP_BUDGET_BYTES` moves 214,400 -> 214,700: the merged gzip figure
 * (213,680 B) plus ~1 KB (~0.48%) of the same slack. The next PR to land
 * here should still expect to remeasure rather than assume either number
 * has room.
 *
 * THAT TREE (composer follow-up + phone toolbar pass) AND THIS ONE (step 2B
 * + phone toolbar pass + its own S2 security fix) THEN MERGED INTO EACH
 * OTHER, each having budgeted for its own delta alone against the SAME
 * shared ancestor (cdc8be7b, the phone toolbar pass alone, 705,616 B) --
 * neither figure accounted for the other landing too, the same gap every
 * merge paragraph above has found. Measured, `electron-vite build --mode
 * production`, on this merge commit (composer follow-up + step 2B + its
 * security fix + phone toolbar pass + settings cards + #527 + Stats &
 * Usage, all combined):
 *
 *     entry, merged (all of the above)   717,898 B  (215,155 B gzip)
 *
 * Both figures land OVER either side's own separate budget (714,500 /
 * 214,500 on this side, 714,800 / 214,400 on the composer follow-up's) --
 * neither bump accounted for the other landing at the same time. `ENTRY_
 * BUDGET_BYTES` moves 714,800 -> 719,500: the real merged figure (717,898 B)
 * plus ~1.6 KB (~0.22%) of slack, the same small-headroom convention every
 * bump above uses. `ENTRY_GZIP_BUDGET_BYTES` moves 214,400 -> 215,800: the
 * merged gzip figure (215,155 B) plus ~0.6 KB (~0.3%) of the same slack.
 *
 * SETTINGS STEP 2A (this branch) AND SETTINGS STEP 2B (`main`'s tip,
 * e1eb6f2b) THEN MERGED INTO EACH OTHER, each having budgeted for its own
 * delta alone against a shared ancestor that did not carry the other
 * (713,837 B/716,000 here, measured against a1cdb816; 717,898 B/719,500 on
 * `main`, measured against its own composer-follow-up + toolbar-pass tree)
 * -- neither figure accounted for the sibling Settings PR landing at the
 * same time, the same gap every merge paragraph above has found. Measured,
 * `electron-vite build --mode production`, on this merge commit (step 2A +
 * step 2B + composer follow-up + phone toolbar pass + settings cards + #527
 * + Stats & Usage, all combined):
 *
 *     entry, merged (all of the above)   720,494 B  (215,514 B gzip)
 *
 * +2,596 B eager / +359 B gzip over `main`'s own tip -- within measurement
 * noise of Settings step 2A's own isolated eager delta measured earlier in
 * this file (+2,595 B against the toolbar pass alone), consistent with the
 * same reasoning every additive merge above draws: step 2A's rows share no
 * eager code with step 2B's.
 * `ENTRY_BUDGET_BYTES` moves 719,500 -> 723,000: the real merged figure
 * (720,494 B) plus ~2.5 KB (~0.35%) of slack, the same small-headroom
 * convention every bump above uses. `ENTRY_GZIP_BUDGET_BYTES` moves
 * 215,800 -> 216,300: the merged gzip figure (215,514 B) plus ~0.8 KB
 * (~0.36%) of the same slack. The next PR to land here should expect to
 * remeasure rather than assume either number still has room.
 *
 * A SIXTH, SMALL, ORDINARY GROWTH, AFTER THE YOLO-INDICATOR REVERT (#535):
 * the per-session permission picker (`DetailPanel.tsx`'s
 * `ProviderStartControls`) adds a second small `fieldset` beside the
 * provider picker -- two buttons, two icons (`Shield`/`ShieldOff`), one
 * `Note` tooltip -- the same "one control, not a split" category as the
 * Stats & Usage icon bump earlier in this file.
 *
 * Measured with a merge-base worktree build (`git worktree add --detach` at
 * `origin/main`'s own tip, 5817a38d -- the revert commit, i.e. WITHOUT this
 * PR's picker), same code and chunks both times, `electron-vite build
 * --mode production`:
 *
 *     entry, main (5817a38d, no picker)   720,494 B  (216,019 B gzip, THIS machine's zlib)
 *     entry, merged (+ the picker)        722,046 B  (216,344 B gzip)  (+1,552 B / +0.22%, +325 B gzip / +0.15%)
 *
 * SAME CROSS-MACHINE GZIP CAVEAT the previous (reverted) paragraph already
 * recorded: this machine's zlib gzips `main`'s own unchanged 720,494 B to
 * 216,019 B, not 215,514 B -- so, again, the DELTA (+325 B gzip, measured
 * before/after in this one run) is what is portable, not the absolute
 * figure.
 *
 * `ENTRY_BUDGET_BYTES` moves 723,000 -> 723,500: the real merged figure
 * (722,046 B) plus ~1.5 KB (~0.2%) of slack, the same small-headroom
 * convention every bump above uses. `ENTRY_GZIP_BUDGET_BYTES` moves
 * 216,300 -> 216,700: the merged gzip figure (216,344 B, THIS machine's
 * zlib) plus ~350 B (~0.16%) of the same slack. The next PR to land here
 * should expect to remeasure rather than assume either number still has
 * room.
 *
 * THE SETTINGS-VIEWS RESTRUCTURE (items A-D: a full-window screen replacing
 * the centred modal, Stats & Usage folded in as one of its sections, single-
 * section-view navigation replacing the always-mounted cards, a new Skills
 * section) TOUCHES NEITHER BUDGET: every line is a re-layout of code already
 * behind `SettingsOverlay`'s own lazy boundary, plus `StatsScreen`'s own
 * separate lazy chunk folding INTO this one rather than into the eager entry
 * (confirmed: `data-stats-panel` is absent from the entry, present once in
 * `SettingsOverlay-*.js`). Measured, `electron-vite build --mode production`,
 * this branch against `main`: entry 722,046 B (unmoved) -> 721,741 B
 * (-305 B); gzip 216,344 B -> 216,312 B (-32 B, this machine's zlib). Both
 * budgets stay at 723,500 / 216,700.
 *
 * A NINTH, SMALL GROWTH: "BACK TO APP" (replacing the Sections rail with a
 * closable row) AND THE GH-MISSING GUIDE (PR 550's own follow-up, later also
 * gaining an S2 security fix routing the guide's two external links through
 * `ExternalLink`/`window.api.link.open` instead of a bare `target="_blank"`
 * the app's own `setWindowOpenHandler` silently refuses) DOES move the
 * budget -- both are new CATALOGUE STRINGS (`i18n/strings.ts`), not new
 * component code behind a lazy boundary: `DetailPanel.tsx` (eager) imports
 * `t()` from the same module `SettingsOverlay.tsx`/`GithubPanel.tsx` read
 * their own copy from, and a bundler cannot tree-shake individual properties
 * out of one exported object literal -- the WHOLE English catalogue ships in
 * the entry. `GithubMark`'s SVG and the guide's JSX are NOT part of this
 * bump (confirmed by grep: `brew install gh` appears once, in
 * `SettingsOverlay-*.js`, never in the entry) -- only the strings are.
 * Measured, this branch against its own base (`ea4f6613`): entry 723,449 B
 * -> 723,692 B (+243 B, base already left only 51 B of headroom); gzip
 * 216,698 B -> 216,801 B (+103 B). `ENTRY_BUDGET_BYTES` moved
 * 723,500 -> 725,000 (723,692 B + ~0.18% slack); `ENTRY_GZIP_BUDGET_BYTES`
 * moved 216,700 -> 217,100 (216,801 B + ~0.14% slack).
 *
 * A TENTH, SMALL, ORDINARY GROWTH, ON A SIBLING BRANCH: the sidebar's
 * worktree-row filters gained the one exception #504 always meant them to
 * have -- a WAITING session's own worktree row stays reachable regardless of
 * either toggle (`WorktreesSection.tsx`'s `holdsWaitingSession`) -- eager,
 * since `WorktreesSection` has no lazy boundary. Measured against
 * `origin/main`'s tip (73abe90b, no waiting exception): entry 723,443 B ->
 * 723,545 B (+102 B); gzip 216,662 B -> 216,736 B (+74 B, this machine's
 * zlib). `ENTRY_BUDGET_BYTES` moved 723,500 -> 725,000 (723,545 B + ~0.2%
 * slack); `ENTRY_GZIP_BUDGET_BYTES` moved 216,700 -> 217,200 (216,736 B +
 * ~0.21% slack) on `main`.
 *
 * AN ELEVENTH, SMALL, ORDINARY GROWTH, ON ANOTHER SIBLING BRANCH: the
 * question card's double-submit fix (`sendingRef` + `try`/`finally` around
 * `send`) and its phone preview-collapse fix (`usePhoneViewport()`, a
 * `previewExpanded` disclosure), together -- category-consistent small
 * additions, no new dependency. Measured, forked from the SAME 723,500 /
 * 216,700 ancestor the tenth paragraph above budgeted against: entry
 * 723,917 B (+417 B); gzip 216,836 B (+136 B). This PR squash-merged to
 * `main` first, so `ENTRY_BUDGET_BYTES` moved 723,500 -> 725,500 and
 * `ENTRY_GZIP_BUDGET_BYTES` moved 216,700 -> 217,200 independently of the
 * tenth paragraph's own bump above -- neither side knew about the other.
 *
 * THE TENTH AND ELEVENTH PARAGRAPHS' BRANCHES THEN MERGED INTO EACH OTHER,
 * each having budgeted for its own delta alone against the SAME shared
 * ancestor -- neither figure accounted for the other landing too. Measured
 * on their merge commit (both fixes combined): entry 724,470 B (+970 B over
 * the shared ancestor); gzip 216,999 B (+299 B) -- more than the simple sum
 * of the two sides' isolated deltas, but well within either side's own
 * headroom. `ENTRY_BUDGET_BYTES` moved 725,500 -> 725,900 (724,470 B +
 * ~0.2% slack); `ENTRY_GZIP_BUDGET_BYTES` moved 217,200 -> 217,400
 * (216,999 B + ~0.18% slack).
 *
 * THE NINTH PARAGRAPH'S BRANCH (PR 550, above) AND THE MERGED TENTH+ELEVENTH
 * TREE ON `main` (sidebar-worktree-filters + question-card, above) THEN
 * MERGED INTO EACH OTHER, each having budgeted for its own delta alone
 * against the SAME shared ancestor (723,500 / 216,700) -- neither figure
 * accounted for the other landing too, the same gap every fan-in merge in
 * this file has found. Measured, `electron-vite build --mode production`,
 * on this merge commit (both trees combined):
 *
 *     entry   724,790 B  (217,186 B gzip)
 *
 * `ENTRY_BUDGET_BYTES` moves 725,900 -> 726,100: the real merged figure
 * (724,790 B) plus ~1.3 KB (~0.18%) of slack, the same small-headroom
 * convention every bump above uses -- not either side's own margin kept
 * as-is. `ENTRY_GZIP_BUDGET_BYTES` moves 217,400 -> 217,550: the measured
 * gzip figure (217,186 B) plus ~364 B (~0.17%) of the same slack. The next
 * PR to land here should still expect to remeasure rather than assume
 * either number still has room.
 *
 * A TWELFTH GROWTH: THE GITLAB CARD (operator: "GitLab now via glab,
 * Bitbucket later"). `GitlabPanel.tsx` itself is NOT eager -- it is mounted
 * by `SettingsOverlay.tsx`, already proven out of the entry by the guard
 * below -- and neither is `GitlabMark`'s SVG, which lives in that same lazy
 * chunk. What DOES move the budget is the ninth paragraph's own mechanism
 * again: a new run of CATALOGUE STRINGS (`settings.integrations.gitlab.*`,
 * ~26 keys covering the card's heading, hint, pill, status sentences and
 * the glab-missing guide) added to `i18n/strings.ts`'s one exported object
 * literal, which ships whole in the eager entry regardless of which
 * component reads which key from it. Measured, `electron-vite build --mode
 * production`, this branch against `main`'s tip (`99b989ae`, the commit
 * this branch was cut from): entry 724,790 B -> 726,418 B (+1,628 B,
 * +0.22%); gzip 217,187 B -> 217,412 B (+225 B, +0.10%, this machine's
 * zlib). `ENTRY_BUDGET_BYTES` moves 726,100 -> 727,700: the measured figure
 * (726,418 B) plus ~1,282 B (~0.18%) of the same small-headroom convention
 * every bump above uses. `ENTRY_GZIP_BUDGET_BYTES` is NOT moved -- the
 * measured gzip figure (217,412 B) still clears the existing 217,550
 * budget, if only by 138 B, so this PR bumps only the number its own build
 * actually tripped rather than one that still holds.
 *
 * A THIRTEENTH, SMALL, ORDINARY GROWTH, ON A SIBLING BRANCH FORKED FROM THE
 * SAME `99b989ae` ANCESTOR: the operator's Esc/Cmd+. reversal (`chords.ts`'s
 * new `interrupt` action and its `Mod-.` table entry, `rowConflicts()`, and
 * `keysheet.ts`'s one new `ACTION_LABELS` row) is all eager -- `chords.ts`
 * and `keysheet.ts` are both shared modules the entry already statically
 * imports (`TerminalTab.tsx`, `DetailPanel.tsx`, `Canvas.tsx` all read
 * `chords.ts` directly), so this did not go through `SettingsOverlay`'s own
 * lazy boundary even though the new conflict-dot UI itself lives entirely
 * inside that lazy chunk. CI's own `electron-vite build --mode production`
 * run (`ubuntu-latest`, this PR's actual gate, forked before the twelfth
 * paragraph's GitLab card existed) measured entry gzip at 217,677 B against
 * the 217,550 B budget the eleventh paragraph left it at -- over by 127 B,
 * and over on the FIRST push despite this branch's own local (`darwin`)
 * build passing under budget beforehand, the same cross-machine zlib-output
 * variance the eleventh and twelfth paragraphs' own "this machine's zlib"
 * notes already flagged, now large enough on its own to flip a result. This
 * branch alone moved `ENTRY_GZIP_BUDGET_BYTES` 217,550 -> 217,900 (CI's own
 * 217,677 B plus ~223 B/~0.1% slack) and left `ENTRY_BUDGET_BYTES` at
 * 726,100, the raw-byte test having passed in the same CI run.
 *
 * THE TWELFTH AND THIRTEENTH PARAGRAPHS' BRANCHES THEN MERGED INTO EACH
 * OTHER, each having budgeted for its own delta alone against the SAME
 * shared ancestor (726,100 / 217,550) -- neither figure accounted for the
 * other landing too, the same gap every fan-in merge in this file has
 * found. Measured, `electron-vite build --mode production` (this machine's
 * `darwin` zlib), on this merge (both trees combined):
 *
 *     entry   727,239 B  (217,677 B gzip)
 *
 * `ENTRY_BUDGET_BYTES` moves 727,700 -> 728,700: the real merged figure
 * (727,239 B) plus ~1,461 B (~0.2%) of the same small-headroom convention
 * every bump above uses -- not either side's own margin kept as-is (the
 * twelfth paragraph's own 727,700 already cleared the merged figure, but
 * only by 461 B, tighter than this file's own convention asks for once the
 * two deltas are combined). `ENTRY_GZIP_BUDGET_BYTES` moves 217,900 ->
 * 218,150: the merged gzip figure (217,677 B) sits under the thirteenth
 * paragraph's own 217,900, but only by 223 B -- the same size of margin
 * that paragraph's own bump already proved is not always enough to survive
 * a DIFFERENT machine's zlib (`ubuntu-latest`'s CI build measured this same
 * source at that exact 217,677 B figure before this merge, on a build that
 * did not yet include the GitLab card, which strongly suggests this
 * merge's 217,677 B local figure understates what CI will measure once
 * BOTH trees are combined there too) -- so the merge takes the fuller ~0.2%
 * slack the coordinator asked for rather than the ~0.1% the prior paragraph
 * used. The next PR to land here should still expect to remeasure rather
 * than assume either number still has room.
 *
 * A FOURTEENTH, SMALL GROWTH: THE SELF-UPDATER. The update card itself is
 * NOT eager -- `UpdateNotice` loads behind its own `React.lazy` boundary --
 * but the card's and Settings -> Update's new catalogue strings
 * (`update.*`) land in `i18n/strings.ts`'s one exported object literal,
 * which ships whole in the entry, the ninth paragraph's mechanism again.
 * Measured, `electron-vite build --mode production` (this machine's
 * `darwin` zlib), this branch against `main`'s tip (`3fe3b5ec`, the commit
 * it is rebased on): entry 726,872 B -> 727,087 B (+215 B); gzip
 * 218,114 B -> 218,289 B (+175 B). `main` itself already sat only 36 B
 * under the gzip budget, so any eager byte tipped it.
 * `ENTRY_GZIP_BUDGET_BYTES` moves 218,150 -> 218,700: the measured figure
 * (218,289 B) plus ~411 B (~0.2%) of the slack the thirteenth paragraph
 * showed a different machine's zlib can eat. `ENTRY_BUDGET_BYTES` is NOT
 * moved: 727,087 B still clears 728,700 by 1,613 B.
 *
 * A FIFTEENTH, EPIC-WIDE ALLOWANCE: THE REMAINING UI TASKS. The entry grows
 * with every renderer task the vam-ux-3 epic still has to land, the phone
 * terminal and create-plus task first: merged onto the integration branch it
 * failed BOTH budgets above (entry 728,731 B against 728,700, gzip 218,716 B
 * against 218,700), by 31 B and 16 B. Because the epic's other UI tasks grow
 * the entry too, the budget is sized once for the epic here instead of being
 * bumped at every merge. Measured, `electron-vite build --mode production`
 * (this machine's `darwin` zlib), the way this test measures it:
 *
 *     integration 70278b8c            entry 728,231 B  (218,640 B gzip)
 *     integration + phone terminal    entry 728,731 B  (218,716 B gzip)
 *     integration + phone terminal
 *       + the four held heads         entry 729,147 B  (218,875 B gzip)
 *
 * Wave 1's 8 renderer tasks grew the entry by a mean of 181.4 B raw and
 * 53.5 B gzip each. Sixteen renderer tasks remain that can grow it, so the
 * projection is 16 x 181.4 = +2,902 B raw and 16 x 53.5 = +856 B gzip on top
 * of the 729,147 B / 218,875 B base (integration + phone terminal + the four
 * held heads, planner-measured; the 728,731 B / 218,716 B line above is
 * integration + phone terminal alone): 732,049 B / 219,731 B (an estimate from the wave-1
 * mean, not a measurement), plus ~0.2% slack for another machine's zlib, the
 * thirteenth paragraph's lesson. `ENTRY_BUDGET_BYTES` moves 728,700 ->
 * 733,600 and `ENTRY_GZIP_BUDGET_BYTES` moves 218,700 -> 220,200. This is an
 * epic-wide allowance, not headroom any one PR may assume: the next PR to
 * land here still re-measures rather than assuming there is room.
 *
 * A SIXTEENTH, SMALL GROWTH, FROM vam-ux-3/task-4-card-matches-terminal: the
 * question card now draws the terminal's own free-text row and follows the
 * pane's step, all eager `DetailPanel.tsx` code. Measured, `electron-vite
 * build --mode production` (this machine's `darwin` zlib), the way this test
 * measures it: entry 733,717 B (over 733,600 by 117 B); gzip 220,218 B (over
 * 220,200 by 18 B). `ENTRY_BUDGET_BYTES` moves 733,600 -> 733,900 and
 * `ENTRY_GZIP_BUDGET_BYTES` moves 220,200 -> 220,350: the measured figures
 * plus ~180 B / ~130 B of slack, inside the epic allowance's 734,000 /
 * 220,400 ceiling. After the merge queue rebased this task onto integration
 * with task-21, the same measurement read entry 734,798 B and gzip 220,648 B:
 * the extra growth arrived with task-21 on integration, not from this task.
 * Plan v17 allows up to 735,200 / 220,800, so `ENTRY_BUDGET_BYTES` moves
 * 733,900 -> 735,000 and `ENTRY_GZIP_BUDGET_BYTES` moves 220,350 -> 220,750
 * (~200 B / ~100 B of slack over the post-rebase figures).
 *
 * A SEVENTEENTH, FROM vam-ux-3/task-16-prs-view-filter-and-sort: the PRs
 * tab's filter bar, its count line and the filter state in `DetailPanel.tsx`
 * are all eager code. Measured, `electron-vite build --mode production`
 * (this machine's `darwin` zlib), the way this test measures it: entry
 * 738,703 B (over 735,000 by 3,703 B); gzip 221,774 B (over 220,750 by
 * 1,024 B). `ENTRY_BUDGET_BYTES` moves 735,000 -> 739,000 and
 * `ENTRY_GZIP_BUDGET_BYTES` moves 220,750 -> 221,924: the measured figures
 * plus ~297 B / ~150 B of slack, inside plan v19's 739,500 / 222,100 ceiling.
 *
 * AN EIGHTEENTH, FROM vam-ux-3/task-17-composer-tab-suggestion: the Tab KeyTag,
 * suggestion overlay and pane reader are eager code. Measured the way this test
 * measures it: entry 740,863 B, gzip 222,495 B. The budgets move 739,000 ->
 * 741,163 and 221,924 -> 222,645, inside plan v20's 741,200 / 222,650 ceiling.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const electronViteBinary = path.join(repoRoot, 'node_modules', '.bin', 'electron-vite');
const configPath = path.join(repoRoot, 'electron.vite.config.ts');
// The same existence-only gate `test/e2e/config-collection.test.ts` uses for
// its harness: a cheap, synchronous check for whether the tool this test
// depends on is even present, decided BEFORE anything tries to build.
const buildAvailable = existsSync(electronViteBinary) && existsSync(configPath);

const ENTRY_BUDGET_BYTES = 741_163;
const ENTRY_GZIP_BUDGET_BYTES = 222_645;

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

// The stats popover panel's own root attribute, one level in from the shell's
// bare `data-stats-popover`: that shorter string is a PREFIX of this one and
// of `data-stats-popover-error`, so it would match the eager shell. This one
// is exact. Verified unique: `grep -rn data-stats-popover-panel src` outside
// `StatsPopoverPanel.tsx` finds nothing, and `grep -rl
// data-stats-popover-panel node_modules` finds nothing.
const STATS_POPOVER_PANEL_MARKER = 'data-stats-popover-panel';

// The usage popover panel's header row. Exact, not a prefix of another
// attribute: `grep -rn data-usage-header src` finds only
// `UsagePopoverPanel.tsx` (the eager shell's own markers are
// `data-usage-toggle` and `data-usage-panel`, neither of which starts with
// this string).
const USAGE_PANEL_MARKER = 'data-usage-header';

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

  it('the stats popover panel (and its Heatmap) is not in the eager entry chunk', () => {
    // Falsify by importing `StatsPopoverPanel` statically in
    // `StatsPopover.tsx` instead of through its `lazy(() => import(...))`:
    //   expect(entryText.includes('data-stats-popover-panel')).toBe(false)
    //   AssertionError: expected true to be false
    expect(entryText.includes(STATS_POPOVER_PANEL_MARKER)).toBe(false);
  });

  it('the stats popover panel ships in exactly one lazy chunk', () => {
    expect(
      otherAssetTexts.filter((text) => text.includes(STATS_POPOVER_PANEL_MARKER)),
    ).toHaveLength(1);
  });

  it('the usage popover panel is not in the eager entry chunk, and ships in exactly one lazy chunk', () => {
    // Falsify by importing `UsagePopoverPanel` statically in
    // `UsagePopover.tsx` instead of through its `lazy(() => import(...))`.
    expect(entryText.includes(USAGE_PANEL_MARKER)).toBe(false);
    expect(otherAssetTexts.filter((text) => text.includes(USAGE_PANEL_MARKER))).toHaveLength(1);
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
