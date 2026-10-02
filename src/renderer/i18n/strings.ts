/**
 * EVERY SENTENCE VAM SHOWS, IN ONE PLACE, so a second language is a file
 * rather than a refactor.
 *
 * Operator: "push the text out into i18n so later we can do a language
 * switch." The switch is not built here -- there is one locale and no picker.
 * What is built is the SEAM, and the seam is the whole of the work: a
 * catalogue nobody can add a locale to without touching call sites has moved
 * the strings without moving the problem.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 * NOT A LIBRARY. `i18next` and its relatives carry plural rules, locale
 * negotiation, lazy namespaces, a context stack and a runtime -- for a
 * catalogue and a `replace`. vam has one locale, one process and no server to
 * negotiate with. The day a sentence needs a plural rule, that rule can be
 * argued on the evidence of that sentence; buying the machinery first is
 * paying for a translation project vam has not started.
 *
 * NOT EVERY STRING IN THE APP, YET. This carries the SETTINGS surface, which
 * is where the operator asked the work to start and which is the densest
 * prose vam has. Everything else still holds its own text and is added here
 * as it is touched -- a sweep that moved four hundred strings in one commit
 * would be unreviewable and would touch every file in the renderer.
 *
 * ── THE THREE PROPERTIES THAT MAKE THE SECOND LOCALE SAFE ─────────────────
 *  1. A KEY THAT DOES NOT EXIST IS A TYPE ERROR. `StringKey` is derived from
 *     the English catalogue, so `t('setings.title')` does not compile. There
 *     is no runtime fallback that paints the key on screen, because that is a
 *     bug arriving as content.
 *  2. AN INCOMPLETE LOCALE DOES NOT COMPILE. Every locale is typed as a TOTAL
 *     record over those keys. The day `vi` lands, a string nobody translated
 *     is a build failure rather than an English sentence in a Vietnamese
 *     dialog -- which is the failure mode every half-translated app has.
 *  3. INTERPOLATION IS NAMED. `{theme}`, never `{0}`: a translator reordering
 *     a sentence is the normal case, and a positional slot turns that into a
 *     bug. A slot nobody filled is left VISIBLE -- see `fill`.
 *
 * ── ON CASE ───────────────────────────────────────────────────────────────
 * Case is A PROPERTY OF THE SURFACE, not of the translation. A language whose
 * script has no case, or whose conventions differ as German's do for nouns, is
 * then a catalogue entry rather than a fight with a stylesheet.
 *
 * The settings strings are therefore stored in one canonical case, lower, and
 * that surface capitalises them with CSS (`styles.css`, `.vam-sentence` and
 * the `capitalize` utilities). It also keeps `textContent` stable for the
 * tests and keeps an accessible name a normal word rather than capitals a
 * screen reader may spell out.
 *
 * THE RULE HAS A SECOND HALF, AND THE PRs FOOTER IS WHERE IT FIRST BIT. A
 * stylesheet may own the case only where something can SEE the result:
 * `e2e/settings-chrome-shots.mjs` opens Settings in a real browser and
 * measures it. The PRs pane's repository footer is drawn only when a directory
 * picker exists -- `window.api.dialog` is a preload bridge, so `App.tsx` sends
 * a browser to `DemoCanvas` instead -- and no web guard can reach it. In this
 * repo `::first-letter` has already matched nothing in silence once, on a
 * `<span>` that was not a block container, and only a screenshot found it.
 * Case that no gate can see does not belong in a stylesheet: those keys carry
 * their own capitals, and `test/i18n/strings.test.ts` holds them there.
 */

/** The locales that ship. One, today, and the type is what the rest defends. */
export const LOCALES = ['en'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * THE ENGLISH CATALOGUE, and the source of the key union.
 *
 * Keys are namespaced by WHERE THEY ARE READ (`settings.interface.theme.hint`)
 * rather than by what they say. With one flat list of forty names nobody can
 * tell which screen a string is on, and a translator handed "the Settings
 * strings" has no way to take exactly those.
 */
const EN = {
  // ── The dialog's own chrome ──────────────────────────────────────────────
  'settings.title': 'settings',
  'settings.status.stored': 'stored in this browser, not in a session',
  // `settings.nav.heading` ("Sections") is gone: the operator asked for the
  // rail's own eyebrow to become a "Back to app" ROW rather than a label
  // beside one, so `SectionRail` in `SettingsOverlay.tsx` draws this instead
  // now, closing Settings the same way Esc/`×` already do.
  // `SectionStrip` (narrow desktop) never drew this heading at all -- its own
  // toolbar has no room for one -- so nothing there changes.
  'settings.nav.back': 'Back to app',
  // The accessible name of the close control, which the i18n pass walked past
  // because the button's whole label was the hard-coded string `Esc` -- a key
  // a phone does not have. Lower, like every other name on this surface.
  //
  // `close`, NOT `close settings`: the scrim behind the dialog already carries
  // that exact name, and two buttons answering to one name is a dialog where
  // "press close settings" is ambiguous to anything that resolves controls by
  // name -- a screen reader, and this repo's own tests, which found the scrim
  // by it. Inside a dialog whose heading reads SETTINGS, `close` says the rest.
  'settings.close': 'close',

  // ── Interface ────────────────────────────────────────────────────────────
  // THE APP'S OWN PAINT, and nothing else. The cards restructure (operator:
  // "these are Orca's appearance settings; see what vam can do and add it.
  // Split into clear, separate sections") split what used to be one
  // Appearance panel into three: this one, Terminal (the terminal pane's own
  // paint) and Window & Sidebar (widths) -- `settings/sections.ts` carries
  // the rule that decided each row's new home. The per-token colour
  // overrides sit behind an Advanced disclosure now: most operators pick a
  // template and never open it.
  'settings.interface.hint': 'theme, templates, and the size a response is drawn at',

  // STATS & USAGE, FOLDED IN AS A SECTION (settings-views restructure, item
  // B). `StatsPanel.tsx` carries the whole report; this section's own hint
  // is the one line `SettingsCard` draws under its heading, the same role
  // every other section's hint plays.
  'settings.stats.hint': "what this machine's own agent transcripts say — computed locally",
  'settings.interface.theme.label': 'theme',
  'settings.interface.theme.hint': 'system follows what the operating system asks for',
  'settings.interface.templates.label': 'templates',
  'settings.interface.templates.hint':
    'a whole {theme} palette in one press — the swatches below still edit it',
  'settings.interface.colours.label': 'colours — {theme}',
  'settings.interface.colours.hint': 'unset follows the stylesheet, and {other} keeps its own',
  'settings.interface.colours.reset': 'reset {theme} colours',
  'settings.interface.outText.label': 'out text',
  'settings.interface.outText.hint':
    "how large the agent's answer is drawn, in every response pane",
  // THE APP CHROME'S OWN FONT, separate from `settings.terminal.fontFamily`
  // below — a different face for a different surface. Free text only: there
  // is no "detected sans fonts" scan the way the terminal's own picker has.
  'settings.interface.uiFontFamily.label': 'UI font',
  'settings.interface.uiFontFamily.hint':
    "the app's own chrome — separate from the terminal's font",
  // UI ZOOM — reverses issue 281 ("zoom to be gone"), at the operator's later,
  // explicit request. The chords are printed here through `chordSymbols`,
  // the exact rendering the keyboard editor uses, so this row and
  // `docs/keyboard.md` cannot drift from what `chords.ts` actually binds.
  'settings.interface.uiZoom.label': 'UI zoom',
  'settings.interface.uiZoom.hint': '80–150% in steps — {in} in, {out} out',
  'settings.interface.uiZoom.reset': 'reset to 100%',

  // ── Terminal ─────────────────────────────────────────────────────────────
  // SPLIT OUT OF APPEARANCE: everything about the terminal PANE's own paint,
  // gathered into one card instead of four rows scattered through a panel
  // about the whole app. A Typography sub-group (its text size) and a Themes
  // sub-group (the dark and light theme lists) are always on screen; the
  // colour overrides, the background opacity, and the streaming-terminal
  // switch (moved from Behaviour -- all three are rows a terminal-first
  // operator reaches for and everyone else never opens) sit behind Advanced.
  'settings.terminal.hint': "the terminal pane's own text size, colour theme, and paint",
  'settings.terminal.typography.title': 'Terminal Typography',
  // THE TERMINAL'S OWN SIZE. The label says which surface, because vam draws
  // text in more than one and only this one is measured in columns.
  //
  // THE HINT KEEPS THE CONSEQUENCE AND DROPS THE MECHANISM. What happens is
  // that a running screen re-wraps, and an operator not told that reads it as
  // vam having broken their session; HOW it happens -- vam measures the pane
  // and sends tmux a new column count (`terminal-size.ts`) -- is machinery the
  // operator cannot act on, and it lives there and here rather than on screen.
  'settings.terminal.text.label': 'terminal text',
  'settings.terminal.text.hint':
    'how large the terminal screen is drawn — a bigger size fits fewer columns, and a running screen re-wraps',
  // THE TERMINAL'S OWN FONT FAMILY, alongside its already-shipped size just
  // above. A dropdown (settings-views restructure, item G) offering every
  // family `main/fonts/list-monospace.ts` detected on this machine, or the
  // curated `shared/fonts.ts` list in a browser build with no bridge.
  'settings.terminal.fontFamily.label': 'terminal font',
  'settings.terminal.fontFamily.hint': 'tried first, before the shipped fallback below it',
  'settings.terminal.preview.label': 'preview',
  'settings.terminal.preview.hint': 'the font, size and colours above, together',
  'settings.terminal.themes.title': 'Themes',
  // THE TERMINAL'S OWN SCHEME, in four rows. One theme row per APP theme
  // rather than one for the theme on screen, because a scheme is a published
  // palette chosen by name and previewed on its chip -- there is nothing to
  // judge blind. The colour grid IS for the theme on screen only, for the
  // reason the app palette's grid gives: a single colour can only be judged
  // against the ground it will be worn on. Each theme hint names that mode's
  // DEFAULT, read off the model rather than typed, so the caption cannot say
  // Hans after somebody changes the table.
  //
  // THE TAIL IS GONE FROM BOTH ROWS ("the colours below still edit it
  // afterwards"), and it cost nothing: the row immediately under them is
  // `terminalColours`, whose own caption says it edits each colour over the
  // scheme chosen above. That is the same fact from the side that does the
  // editing, and this one was paying for it twice -- once per app theme.
  'settings.terminal.theme.label': 'terminal theme — {on}',
  'settings.terminal.theme.hint':
    'the scheme the terminal wears while the app is {on} — {default} unless you choose another',
  'settings.terminal.colours.label': 'terminal colours — {theme}',
  'settings.terminal.colours.hint':
    'each colour of the {theme} scheme — unset follows the scheme above, and {other} keeps its own',
  'settings.terminal.colours.reset': 'reset {theme} terminal colours',
  'settings.terminal.opacity.label': 'terminal background',
  // THE FLOOR IS SAID, because a slider that stops at 30% with no word about
  // it reads as a slider that is stuck: under it the pane's own grey shows
  // through more than the scheme's ground does (`prefs/terminal-scheme.ts`).
  // WHY it stops there -- every colour in the scheme was chosen against that
  // ground -- is the argument for the floor, not the floor; it is written in
  // `prefs/terminal-scheme.ts`, and what the operator needs on screen is that
  // the slider ends where it ends on purpose.
  'settings.terminal.opacity.hint':
    "how much of the scheme's ground is painted over the pane — the rest is the pane showing through; it stops at 30%",
  // THE STREAMING TERMINAL: the shipping Terminal tab now
  // (`docs/design/terminal-streaming.md`'s "Flipping the default"), driven
  // by xterm.js over a persistent connection instead of periodic
  // `capture-pane`. On by default; an older tmux -- or a connection that
  // cannot be re-established -- falls back to the classic renderer
  // automatically. MOVED HERE FROM BEHAVIOUR: it is a fact about the
  // terminal's own rendering, not about what a turn shows.
  'settings.terminal.streamingTerminal.label': 'streaming terminal',
  'settings.terminal.streamingTerminal.hint': 'a live xterm.js pane instead of periodic capture',
  'settings.terminal.streamingTerminal.on': 'on',
  'settings.terminal.streamingTerminal.off': 'off',
  // THE SPLIT-PANE DIVIDER'S OWN COLOUR. Rides the same per-theme storage as
  // the Interface grid's swatches (`PANE_DIVIDER_TOKEN`), drawn here instead
  // — see that constant's own comment in `prefs.ts` for why.
  'settings.terminal.paneDivider.label': 'pane divider',
  'settings.terminal.paneDivider.hint':
    'between two split panes, in {theme} — unset follows the app’s own',

  // ── Window & Sidebar ─────────────────────────────────────────────────────
  // NEW. For now it holds only `view width`, moved from Behaviour for the
  // same reason it moved out of Appearance before that: a width is not
  // paint, it IS the whole choice. Named ahead of the sidebar-appearance and
  // status-bar rows a later PR adds, so those land in a section already
  // named for them rather than forcing a second reshuffle.
  'settings.window.hint': 'how wide the response, terminal, PR and agent views draw',
  // THE VIEWS' WIDTH. The hint carries two facts an operator cannot guess and
  // would otherwise meet as a fault: that the fraction has a threshold, so a
  // pane too narrow for two thirds of it to hold 80 characters is left whole
  // rather than narrowed (the operator met the older floor as a defect in a
  // split, `prefs/view-width.ts`), and that the Terminal is NOT one of the
  // views this reaches. The exception is named rather than left silent: it
  // WAS one of them, and an operator who saw the screen re-wrap on the last
  // release needs to read that it will not again — narrowing the terminal
  // meant telling tmux a smaller column count, which re-wraps the screen of a
  // session that is still running.
  //
  // THAT LAST CLAUSE IS THE REASON AND NOT THE FACT, so it stays here. On
  // screen the row says the terminal always fills its pane, which is what an
  // operator can see and act on; "so tmux is never asked to re-wrap a running
  // screen" is why the exception exists, and it was the longest clause in the
  // panel. "instead of filling it" went with it -- the switch's own off label
  // is `full pane` -- and so did "such as one side of a split", an example of
  // a rule the sentence had already stated.
  'settings.window.narrowViews.label': 'view width',
  'settings.window.narrowViews.hint':
    'draw the response, PRs and agents views at two thirds of the pane, while that is at least 80 characters — a narrower pane is left whole. The terminal always fills its pane',
  'settings.window.narrowViews.on': 'narrowed',
  'settings.window.narrowViews.off': 'full pane',

  // THE SIDEBAR-APPEARANCE AND STATUS-BAR ROWS `settings.window.hint`'s own
  // comment named as "a later PR adds" -- this is that PR.
  'settings.window.sidebarAppearance.label': 'sidebar appearance',
  'settings.window.sidebarAppearance.hint': 'shipped, matching the terminal, or tinted',
  'settings.window.sidebarAppearance.default': 'default',
  'settings.window.sidebarAppearance.match-terminal': 'match terminal',
  'settings.window.sidebarAppearance.tinted': 'tinted',

  'settings.window.statusBar.title': 'status bar',
  'settings.window.statusBar.mode.label': 'usage numbers',
  'settings.window.statusBar.mode.hint': 'read as used, or as remaining',
  'settings.window.statusBar.mode.used': 'used',
  'settings.window.statusBar.mode.remaining': 'remaining',
  'settings.window.statusBar.showClaude.label': 'show Claude usage',
  'settings.window.statusBar.showClaude.hint': 'in the status bar',
  'settings.window.statusBar.showClaude.on': 'on',
  'settings.window.statusBar.showClaude.off': 'off',
  'settings.window.statusBar.showCodex.label': 'show Codex usage',
  'settings.window.statusBar.showCodex.hint': 'in the status bar',
  'settings.window.statusBar.showCodex.on': 'on',
  'settings.window.statusBar.showCodex.off': 'off',

  // ── Agents (renamed from Sessions) ───────────────────────────────────────
  // EVERY ROW HERE IS ABOUT THE AGENT A SESSION DRIVES, which is what earned
  // the rename: which one starts and which key sends it a prompt. THE ADHD
  // SKILL PASSED THROUGH HERE, BUT DID NOT STAY: it joined Agents from
  // Behaviour in the cards restructure (same reasoning: it decides what the
  // agent is told to write, not what vam draws), then
  // left for its own "Skills" section in the settings-views restructure
  // (item D) once it grew big enough (its own status pill, an
  // install/reinstall/repair flow) to read as a settled preference buried
  // in a bigger card rather than as the one thing a section is about.
  'settings.agents.hint': 'which agent a new session starts and which key sends it a prompt',
  // Skills' own hint, read by the new section `AdhdSkillCard` moved into.
  'settings.skills.hint': 'the real upstream skills vam can install into an agent’s own directory',
  'settings.agents.provider.label': 'default provider',
  'settings.agents.sendKey.label': 'send key',
  'settings.agents.sendKey.hint': 'which key sends the prompt you are typing to the session',

  // KEEP COMPUTER AWAKE, via Electron’s own `powerSaveBlocker`. Off by
  // default -- see `prefs/keep-awake.ts` for why this direction is the safe
  // one to ship silently.
  'settings.agents.keepAwake.label': 'keep computer awake',
  'settings.agents.keepAwake.hint': 'while vam is open, or only while an agent runs',
  'settings.agents.keepAwake.on': 'on',
  'settings.agents.keepAwake.while-running': 'while an agent is running',
  'settings.agents.keepAwake.off': 'off',

  // AUTO TAB TITLES -- gates logic that already ships unconditionally
  // (Claude Code’s own `ai-title` transcript event, Codex’s first-prompt
  // preview line); see `prefs/auto-tab-titles.ts` for the whole story and
  // why the default is therefore on.
  'settings.agents.autoTabTitles.label': 'auto tab titles',
  'settings.agents.autoTabTitles.hint': 'from the agent’s own activity, not its id',
  'settings.agents.autoTabTitles.on': 'on',
  'settings.agents.autoTabTitles.off': 'off',

  // AGENT PERMISSIONS -- SECURITY-SENSITIVE. Manual is the default and the
  // only choice that writes with no confirmation; see `prefs/
  // agent-permissions.ts` and this row’s own confirmation copy below.
  'settings.agents.permissions.label': 'agent permissions',
  'settings.agents.permissions.hint': 'skip the provider’s own permission prompts',
  'settings.agents.permissions.manual': 'manual',
  'settings.agents.permissions.yolo': 'yolo',
  'settings.agents.permissions.note': 'only a session started after this change is affected',
  'settings.agents.permissions.yolo.confirmLabel': 'confirm switching to Yolo',
  'settings.agents.permissions.yolo.risk':
    'Yolo starts every new session with permission checks turned off — it can read, write and run commands with nothing asking first. Only turn this on for work you would let run unattended.',
  'settings.agents.permissions.yolo.confirm': 'turn on Yolo',
  'settings.agents.permissions.yolo.cancel': 'cancel',

  // DEFAULT AGENT -- what a NEW session’s Start screen highlights first; see
  // `prefs/default-agent.ts` and `resolveDefaultAgentSelection` (`prefs.ts`)
  // for why `No agent` is a second reading of this choice rather than a
  // third provider.
  'settings.agents.defaultAgent.label': 'default agent',
  'settings.agents.defaultAgent.hint': 'highlighted first on a new session’s Start screen',
  'settings.agents.defaultAgent.auto': 'auto',
  'settings.agents.defaultAgent.none': 'no agent',

  // THE ADHD SKILL CARD -- what replaced the concise-output switch. Operator,
  // translated: "turn Concise output into a card [an Orca screenshot]. Talk
  // about the ADHD skill", and then, the design decision that followed:
  // install the REAL skill (`ayghri/i-have-adhd`) into the agent's own skills
  // directory, rather than typing vam's own wording of it into a session's
  // first prompt. `src/shared/adhd-skill.ts` carries the whole story and the
  // pinned source commit.
  //
  // ITS OWN KEYS KEEP THE `settings.behaviour.adhd.*` NAMESPACE even though the
  // card itself has moved twice since (Behaviour to Agents in the cards
  // restructure, Agents to its own "Skills" section in the settings-views
  // restructure, item D): renaming twenty-odd call sites inside
  // `AdhdSkillCard.tsx` for a cosmetic match is that component's own call to
  // make, not either restructure's, which moved the CARD, not its strings.
  //
  // KEPT TERSE ON PURPOSE, MORE THAN THE OLD SWITCH'S OWN DISCLOSURE WAS: this
  // catalogue ships whole inside the eager entry chunk regardless of
  // `SettingsOverlay`'s own lazy split (`t()` and `EN` are one module, and the
  // entry already imports it for surfaces that mount before Settings ever
  // opens) -- `test/renderer/bundle-budget.test.ts` measures that chunk, not
  // this file, so a longer sentence here is a real byte in something every
  // launch parses. `AdhdSkillCard.test.tsx` pins the few words each string
  // must still carry.
  //
  // THE TITLE NAMES THE SKILL, unlike the old switch's label: this is no
  // longer a request vam types, it is a file vam writes, and the operator is
  // choosing whether that file exists -- which is worth naming plainly. Title
  // Case is `SettingsRow`'s own CSS transform (`capitalize`), which only
  // touches the first letter of the word it reaches: 'ADHD skill' becomes
  // "ADHD Skill", never "Adhd Skill".
  'settings.behaviour.adhd.title': 'ADHD skill',
  'settings.behaviour.adhd.hint': 'shorter, scannable answers',
  // THREE STATES, and the pill's own words for each -- `src/shared/
  // adhd-skill.ts`'s `AdhdSkillState` is the type these three cover. A
  // FOURTH, TRANSIENT ONE HAS NO STRING: while the first status read is
  // still in flight the pill is simply absent, the same "absent, not dimmed"
  // rule `UpdatePanel.tsx` keeps for its own bridge-less state -- the read is
  // one IPC round trip to a local disk, over before a reader could notice a
  // blank pill.
  'settings.behaviour.adhd.not-installed': 'Not installed',
  'settings.behaviour.adhd.installed': 'Installed',
  'settings.behaviour.adhd.outdated-modified': 'Outdated or modified',
  'settings.behaviour.adhd.install': 'Install',
  'settings.behaviour.adhd.reinstall': 'Reinstall',
  // PARTIALLY INSTALLED (settings-views restructure, item E): one of the two
  // agent directories has it and the other does not -- neither "Install"
  // (something is already there) nor "Reinstall" (something is still
  // missing) says that honestly. `isAdhdSkillPartiallyInstalled` (`shared/
  // adhd-skill.ts`) is the predicate; the coverage grid below the button
  // already names WHICH agent is missing, so this word is the only new copy
  // this state needs.
  'settings.behaviour.adhd.repair': 'Repair',
  'settings.behaviour.adhd.recheck': 'Re-check',
  'settings.behaviour.adhd.remove': 'Remove',
  // THE CONFIRM, SHOWN ONLY BEFORE OVERWRITING A DIRECTORY THAT DIFFERS --
  // an operator's own edit, or an unrelated skill sharing this name. Either
  // way vam cannot tell which, so both get the same pause before anything is
  // overwritten. See `src/main/skills/adhd-skill.ts`'s header for why the
  // comparison collapses both into one state.
  'settings.behaviour.adhd.confirm.question': 'this was changed. Overwrite?',
  'settings.behaviour.adhd.confirm.yes': 'Overwrite',
  'settings.behaviour.adhd.confirm.no': 'Cancel',
  // THE MANUAL ROUTE. `adhdSkillInstallCommand()` builds the exact text this
  // copies; the hint here is only the invitation, never the command itself.
  'settings.behaviour.adhd.copyHint': 'prefer your own terminal?',
  'settings.behaviour.adhd.copy': 'Copy install command',
  'settings.behaviour.adhd.copied': 'Copied',
  // THE STAR COUNT'S ACCESSIBLE NAME (the row title's `[data-skill-stars]`).
  // The catalogue has no plural rules, so a count of exactly one has its own
  // key, picked in `AdhdSkillCard.tsx`. `{count}` arrives already formatted.
  'settings.behaviour.adhd.starsLabel': '{count} stars on GitHub',
  'settings.behaviour.adhd.starsLabelOne': '{count} star on GitHub',
  // THE REPO LINK. The proper noun, a `data-verbatim` button.
  'settings.behaviour.adhd.creditLink': 'ayghri/i-have-adhd (MIT)',
  'settings.behaviour.adhd.coverageTitle': 'Agent coverage',
  'settings.behaviour.adhd.coverageHint': 'install above, then re-check',
  'settings.behaviour.adhd.agentMissing': 'Missing',
  'settings.behaviour.adhd.agentInstalled': 'Installed',
  'settings.behaviour.adhd.agentModified': 'Modified',
  // NO BRIDGE, NO BUTTONS -- `UpdatePanel`'s own rule: a browser tab (the
  // demo, a paired phone) has no preload, so there is nothing on this machine
  // for a status check or an install to reach.
  'settings.behaviour.adhd.browser': 'lives in the desktop app.',
  // THE ONE-TIME MIGRATION NOTE. Shown only to an operator who had the OLD
  // concise-output switch on; `prefs.conciseOutput` is read, once, for
  // exactly this and never written to `true` again. Dismissing it, or a
  // successful install, both clear the flag -- neither auto-installs, which
  // is the one thing this note may not do on its own.
  'settings.behaviour.adhd.migration': 'concise output now installs the ADHD skill below.',
  'settings.behaviour.adhd.migrationDismiss': 'Dismiss',

  // ── Behaviour ────────────────────────────────────────────────────────────
  // SMALLER THAN IT WAS, not retired: `view width` moved to Window & Sidebar
  // and `streaming terminal` moved to Terminal's own Advanced disclosure
  // (both notes above say why). What is left is what a turn shows on screen,
  // plus a small "Files" sub-group for the file editor's own two rows
  // (moved from Appearance -- a count of spaces and whether a file is
  // coloured are both about a FILE `o` can open, closer kin to focus view's
  // own question than to Interface's paint).
  'settings.behaviour.hint': "what a turn shows on screen, and how vam's own file editor behaves",
  'settings.behaviour.focusView.label': 'focus view',
  'settings.behaviour.focusView.hint':
    "fold each turn's tool calls away, leaving your prompts and the agent's answers",
  'settings.behaviour.focusView.on': 'on',
  'settings.behaviour.focusView.off': 'off',
  'settings.behaviour.files.title': 'Files',
  // THE FILE EDITOR'S COLOURS. The label says which editor, because vam has
  // more than one text box and only this one has a gutter to keep level.
  // The tail this hint had ("for the formats vam can read without guessing")
  // is the note's first sentence, which then NAMES those formats. One of the
  // two had to go and it is this one: a caption that hedges without saying
  // which formats leaves the operator no better off than silence.
  'settings.behaviour.editorHighlight.label': 'file editor colours',
  'settings.behaviour.editorHighlight.hint': 'syntax colours in the Files tab',
  'settings.behaviour.editorHighlight.on': 'on',
  'settings.behaviour.editorHighlight.off': 'off',
  'settings.behaviour.editorIndent.label': 'file editor indent',
  // SPACES IS NOT A DETAIL: it is what keeps the line-number gutter level with
  // the text, so the caption says it rather than leaving "indent" to be read
  // as "a tab".
  'settings.behaviour.editorIndent.hint':
    'how many spaces one Tab inserts in the Files tab, and what a format indents by',
  // DESKTOP NOTIFICATIONS. The label names the thing, not the mechanism; the
  // hint names the one status it is about in the application's own phrase
  // for it ("needs you", the sidebar's word for `waiting`). The note is a
  // disclosure and keeps its three facts (`SettingsOverlay.tsx` says which).
  // THE NOTIFICATIONS SECTION. The switch's five strings moved here from
  // `settings.behaviour.*` with the row (the key names the screen a string is
  // read on, which is the one thing the naming scheme is for); the words are
  // unchanged. The rest is the Test notification button: one hint, and one
  // sentence per verdict main can answer (`src/shared/notify.ts`). `failed`
  // prints the OS's text VERBATIM after the colon -- it is the diagnosis.
  'settings.notifications.hint':
    'a system notification when a session starts needing you — and a way to check one gets through',
  'settings.notifications.waiting.label': 'desktop notifications',
  'settings.notifications.waiting.hint':
    'a system notification when a session starts needing you; click it to go there',
  'settings.notifications.waiting.on': 'on',
  'settings.notifications.waiting.off': 'off',
  'settings.notifications.waiting.note':
    'this device only. Nothing is raised for the session you are looking at. If macOS refuses to show one, the reason is in the error log (E), verbatim.',
  'settings.notifications.test.label': 'delivery check',
  'settings.notifications.test.hint': 'raises one now and says here what the OS did with it',
  'settings.notifications.test.button': 'test notification',
  'settings.notifications.test.pending': 'waiting for the OS…',
  'settings.notifications.test.sent':
    'sent. If nothing appeared, look in System Settings → Notifications → vam.',
  'settings.notifications.test.failed': 'the OS refused it: {reason}',
  'settings.notifications.test.unconfirmed':
    'the OS answered neither way in 10 s — vam cannot tell whether it appeared.',
  'settings.notifications.test.browser': 'only the desktop app can send one',

  // ── Update ───────────────────────────────────────────────────────────────
  // THE OPERATOR ASKED A QUESTION, SO EVERY ANSWER IS A SENTENCE. The popover
  // that already existed draws for one outcome and is silent for the other
  // three, which is right for a notice nobody asked for and wrong for a room
  // somebody walked into. `rate-limited` and `malformed` are developer words
  // for states a person acts on by waiting and by doing nothing; neither
  // reaches the screen.
  'settings.update.hint': 'which vam this is, and whether a newer one is out',
  'settings.update.check': 'check now',
  'settings.update.checking': 'checking…',
  'settings.update.auto.label': 'automatically check for updates',
  'settings.update.auto.hint':
    'look for a newer release once a day and when the computer wakes; check now works either way',
  'settings.update.auto.on': 'on',
  'settings.update.auto.off': 'off',
  'settings.update.idle': 'press check now to look for a newer release',
  'settings.update.current': 'this is the newest release',
  'settings.update.none': 'no releases have been published yet',
  'settings.update.incomplete':
    'a new release is still being published; try again in a little while',
  // NOT STARTING WITH THE PRODUCT NAME, and that is a constraint the panel's
  // structural capitalisation puts on this catalogue: `vam` is lower case
  // everywhere, and a paragraph beginning with it paints `Vam`. The strings
  // drawn without `data-verbatim` therefore begin with something whose case
  // is nobody's decision.
  'settings.update.available': 'a newer vam is out — {version}',
  'settings.update.downloading': 'downloading {version} — {percent}%',
  'settings.update.installing': 'restarting to update…',
  'settings.update.install': 'update',
  'settings.update.notes': 'release notes',
  // The browser build has no preload bridge, so there is no channel to check
  // over. Absent rather than dimmed, with the reason said out loud: a missing
  // control and no explanation reads as a broken screen.
  'settings.update.browser':
    'vam updates from the desktop app. This is a browser tab, which has no way to ask.',

  // ── The update card (top-right) and the error sentences both surfaces share.
  'update.card.label': 'update',
  'update.card.available': 'vam v{version} available',
  'update.card.update': 'update',
  'update.card.later': 'later',
  'update.card.notes': 'release notes',
  'update.card.retry': 'retry',
  'update.card.dismiss': 'dismiss update notice',
  'update.card.downloading': 'downloading vam v{version}',
  'update.card.installing': 'Restarting to update…',
  'update.card.upToDate': 'vam is up to date',
  'update.error.network': 'GitHub could not be reached — check the connection and try again',
  'update.error.rate-limited': 'GitHub is rate-limiting this address; try again in a few minutes',
  'update.error.malformed': 'GitHub answered something vam could not read as a release',
  'update.error.checksum': 'the download did not match its checksum, so it was discarded',
  'update.error.too-large': 'the download was larger than expected, so it was discarded',
  'update.error.unsupported-install':
    'this copy of vam cannot update itself; install the new release by hand',
  'update.error.translocated':
    'move vam to the Applications folder and open it from there, then update',
  'update.error.read-only': 'vam is on a read-only volume and cannot replace itself',
  'update.error.not-writable': 'vam is in a folder this account cannot write to',
  'update.error.quit-cancelled': 'the update was cancelled because vam did not quit',
  'update.error.install-failed': 'the update could not be installed',

  // ── Integrations ─────────────────────────────────────────────────────────
  // Operator: "add an Integrations section in Settings, to connect a GitHub
  // account and select a repo." vam stores no token of its own -- `gh` keeps
  // it in the Keychain -- so this section is a status read, a pane vam types
  // `gh auth login`/`gh auth logout` into, and a picker over `gh repo list`.
  'settings.integrations.hint':
    'connect a GitHub account with `gh`, and choose which repo each project reads pull requests from',
  'settings.integrations.github.heading': 'GitHub',
  // THE SKILLS-CARD SHAPE (settings-views restructure, item F): an icon
  // tile, a title, a one-line hint -- `AdhdSkillCard.tsx`'s own top row, the
  // precedent this reuses rather than invents. Shorter than the section's
  // own `settings.integrations.hint` above (which still carries the fuller
  // "choose which repo" half): this is the CARD's own line, the section's is
  // the SettingsCard wrapper's.
  'settings.integrations.github.hint': 'connect with the `gh` CLI; vam stores no token of its own',
  // THE STATUS PILL'S OWN THREE WORDS, distinct from the longer sentence
  // `data-github-status` still carries below it (kept for
  // `test/settings/github-panel.test.tsx`'s own assertions, which read that
  // element for "octocat", "not logged in", "not installed"). `gh` stays
  // lower case even here -- `GithubStatusPill`'s own comment on why it is
  // the one pill state that opts out of this surface's `capitalize` class.
  'settings.integrations.github.pill.connected': 'Connected',
  'settings.integrations.github.pill.notConnected': 'Not connected',
  'settings.integrations.github.pill.cliMissing': 'gh not installed',
  'settings.integrations.github.loggedInAs': 'logged in as',
  'settings.integrations.github.status.missing': '`gh` is not installed',
  'settings.integrations.github.status.installLink': 'install gh',
  'settings.integrations.github.status.loggedOut': 'not logged in',
  'settings.integrations.github.status.unknown': 'vam could not tell — {message}',
  'settings.integrations.github.recheck': 're-check',
  'settings.integrations.github.rechecking': 'checking…',
  'settings.integrations.github.scopesWarning':
    'this token is missing a scope vam’s pull-request features need: {scopes}',
  'settings.integrations.github.connect': 'connect',
  'settings.integrations.github.connecting': 'starting…',
  'settings.integrations.github.disconnect': 'disconnect',
  'settings.integrations.github.disconnect.confirm': 'disconnect this account?',
  'settings.integrations.github.disconnect.yes': 'yes, disconnect',
  'settings.integrations.github.disconnect.cancel': 'cancel',
  'settings.integrations.github.copyCommand': 'copy command',
  'settings.integrations.github.copied': 'copied',
  'settings.integrations.github.pane.ended': 're-check above',
  // THE GH-MISSING GUIDE (operator request): what to DO once the pill and
  // the status sentence above have already said `gh` itself is not on PATH.
  // Its own "copy" button reuses `copyCommand`/`copied` above rather than a
  // fourth pair of strings -- both buttons copy one shell command into the
  // clipboard, and the entry bundle budget (`bundle-budget.test.ts`) is the
  // reason this is not just tidiness: every catalogue byte ships eagerly,
  // whichever section reads it.
  'settings.integrations.github.guide.intro':
    'GitHub CLI (gh) is not installed. Install it, then sign in.',
  'settings.integrations.github.guide.noBrew': 'no Homebrew yet? see',
  'settings.integrations.github.guide.checkAgain': 'check again',

  // THE GITLAB CARD (operator: "GitLab now via glab, Bitbucket later"), the
  // GitHub card's own shape narrowed: status and Connect/Disconnect only --
  // no repo picker, no scopes warning, since `glab auth status` reports no
  // scopes and this card was never asked for merge requests or PR status.
  'settings.integrations.gitlab.heading': 'GitLab',
  'settings.integrations.gitlab.hint':
    'connect with the `glab` CLI; vam stores no token of its own',
  'settings.integrations.gitlab.pill.connected': 'Connected',
  'settings.integrations.gitlab.pill.notConnected': 'Not connected',
  'settings.integrations.gitlab.pill.cliMissing': 'glab not installed',
  'settings.integrations.gitlab.loggedInAs': 'logged in as',
  'settings.integrations.gitlab.status.missing': '`glab` is not installed',
  'settings.integrations.gitlab.status.installLink': 'install glab',
  'settings.integrations.gitlab.status.loggedOut': 'not logged in',
  'settings.integrations.gitlab.status.unknown': 'vam could not tell — {message}',
  'settings.integrations.gitlab.recheck': 're-check',
  'settings.integrations.gitlab.rechecking': 'checking…',
  'settings.integrations.gitlab.connect': 'connect',
  'settings.integrations.gitlab.connecting': 'starting…',
  'settings.integrations.gitlab.disconnect': 'disconnect',
  'settings.integrations.gitlab.disconnect.confirm': 'disconnect this account?',
  'settings.integrations.gitlab.disconnect.yes': 'yes, disconnect',
  'settings.integrations.gitlab.disconnect.cancel': 'cancel',
  'settings.integrations.gitlab.copyCommand': 'copy command',
  'settings.integrations.gitlab.copied': 'copied',
  'settings.integrations.gitlab.pane.ended': 're-check above',
  // THE GLAB-MISSING GUIDE, `settings.integrations.github.guide.*`'s own
  // shape: what to DO once the pill and the status sentence above have
  // already said `glab` itself is not on PATH.
  'settings.integrations.gitlab.guide.intro':
    'GitLab CLI (glab) is not installed. Install it, then sign in.',
  'settings.integrations.gitlab.guide.noBrew': 'no Homebrew yet? see',
  'settings.integrations.gitlab.guide.checkAgain': 'check again',

  // ── Remote ───────────────────────────────────────────────────────────────
  'settings.remote.hint': 'pair a phone over your tailnet — in person, at this machine',

  // ── Keyboard ─────────────────────────────────────────────────────────────
  'settings.keyboard.hint': 'click a key and press the one you want — Escape cancels',
  'settings.keyboard.reset': 'reset shortcuts',
  'settings.keyboard.capture': 'press a key… Esc to cancel',

  // ── The PRs pane's repository footer ─────────────────────────────────────
  // THE SECOND SURFACE, and it stores the case it paints -- see "ON CASE"
  // above. Settings is capitalised by the stylesheet because a browser guard
  // measures the painted result; this footer is drawn only where a directory
  // picker exists, which is the desktop, and no web guard can reach it.
  // A HEADING IS A NAME, NOT A SENTENCE. These read as labels because the row
  // moved from under the list to above it: "Asking in this session's own
  // directory" was a line of prose restating the default forever, where
  // `factory` is the same fact in one word. `prs.repo.session` is the fallback
  // for a caller that hands no project name -- never a blank heading.
  'prs.repo.session': "This session's repository",
  'prs.repo.choose': 'Choose another repo',
  'prs.repo.clear': "Use the session's",

  // ── A turn's tool calls, under its progress line ─────────────────────────
  // THE TRANSCRIPT COLUMN'S FIRST TWO KEYS, and they are here because these
  // two are prose rather than data: everything else on that line is a turn
  // label, a tool name or a number the reader read. Lower, like the rest of
  // the catalogue -- these are drawn in the column's own quiet mono, which
  // capitalises nothing.
  //
  // `steps.failed` is read and never seen: the row's mark is a glyph and a
  // colour, and neither reaches a screen reader. `steps.more` carries a
  // number vam HELD and did not draw, so it says the number rather than
  // "more" -- the column caps the rows it draws, and a cap that will not say
  // its own size is the fold this whole surface exists to refuse.
  'steps.failed': 'failed',
  'steps.more': '+{count} more, not shown',

  // ── Shared across more than one section's row ────────────────────────────
  // `FontFamilySelect`'s own first `<option>`, read by both the terminal and
  // the UI font dropdowns (settings-views restructure, item G) — one
  // control, one string, rather than a copy each row could drift from.
  'settings.fontFamily.systemDefault': 'System default',

  // ── Exercised by the catalogue's own tests, and by nothing else ──────────
  // Kept HERE rather than in the test file so that the shape a test asserts
  // is the shape the app compiles against. It costs one row.
  'test.repeat': '{word} and {word}',
} as const;

/** Every key the app may ask for. Derived, never written out twice. */
export type StringKey = keyof typeof EN;

/**
 * Every locale, each TOTAL over `StringKey`.
 *
 * The annotation is the load-bearing part: `Record<Locale, Record<StringKey,
 * string>>` is what makes an unfinished translation a build failure. Widening
 * it to `Partial<...>` to "ship early" would buy exactly the bug this is here
 * to prevent.
 */
export const STRINGS: Record<Locale, Record<StringKey, string>> = {
  en: EN,
};

/**
 * The locale in force. Module state, like the other renderer-wide settings --
 * and deliberately not wired to a picker yet, because there is one locale and
 * a control that can only choose what is already chosen is a control that
 * cannot act.
 */
let active: Locale = 'en';

export function activeLocale(): Locale {
  return active;
}

/** Total, in the direction that shows English rather than nothing. */
export function setActiveLocale(next: string): void {
  active = (LOCALES as readonly string[]).includes(next) ? (next as Locale) : 'en';
}

/**
 * Fill `{name}` slots from `values`.
 *
 * A SLOT NOBODY FILLED IS LEFT VISIBLE. Replacing it with '' would give "a
 * whole  palette in one press" -- a sentence that reads as finished and is
 * wrong, which is the worst way for this to fail. Left as `{theme}` it names
 * the slot that was missed and is obviously a bug.
 *
 * THE VALUE IS NEVER READ AS A PATTERN. `String.replace` interprets `$&`,
 * `` $` `` and `$$` in the REPLACEMENT, so a value containing one would splice
 * the match back into the sentence. A function replacement is immune to that,
 * and costs nothing.
 */
function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : value;
  });
}

/**
 * The string for `key`, in the locale in force.
 *
 * No fallback chain and no "missing key" placeholder: `StringKey` makes an
 * unknown key impossible to write, and a locale missing a key impossible to
 * compile, so there is no runtime case left to handle. A `?? key` here would
 * be dead code that also taught the next reader that a missing key is
 * survivable.
 */
export function t(key: StringKey, values?: Readonly<Record<string, string>>): string {
  const template = STRINGS[active][key];
  return values === undefined ? template : fill(template, values);
}
