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
 * Keys are namespaced by WHERE THEY ARE READ (`settings.appearance.theme.hint`)
 * rather than by what they say. With one flat list of forty names nobody can
 * tell which screen a string is on, and a translator handed "the Settings
 * strings" has no way to take exactly those.
 */
const EN = {
  // ── The dialog's own chrome ──────────────────────────────────────────────
  'settings.title': 'settings',
  'settings.status.stored': 'stored in this browser, not in a session',
  'settings.nav.heading': 'Sections',
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

  // ── Appearance ───────────────────────────────────────────────────────────
  // COLOUR AND TYPE, and nothing else -- `settings/sections.ts` carries the
  // rule that decides which rows those are, and why the two that look like
  // exceptions are not. The tail this hint used to end with ("how much of a
  // turn the transcript draws, and the file editor") is what moved.
  //
  // WHICH text sizes is not spelled out here any more ("the size of the text in
  // out and in the terminal"): a panel hint names the FAMILIES a section holds
  // so the operator knows whether to open it, and the two rows say which
  // surface they size in their own labels, one screen below.
  'settings.appearance.hint': "theme, colours, text sizes, and the terminal's own colour scheme",
  'settings.appearance.theme.label': 'theme',
  'settings.appearance.theme.hint': 'system follows what the operating system asks for',
  'settings.appearance.templates.label': 'templates',
  'settings.appearance.templates.hint':
    'a whole {theme} palette in one press — the swatches below still edit it',
  'settings.appearance.colours.label': 'colours — {theme}',
  'settings.appearance.colours.hint': 'unset follows the stylesheet, and {other} keeps its own',
  'settings.appearance.colours.reset': 'reset {theme} colours',
  'settings.appearance.outText.label': 'out text',
  'settings.appearance.outText.hint':
    "how large the agent's answer is drawn, in every response pane",
  // THE TERMINAL'S OWN SIZE. The label says which surface, because vam draws
  // text in more than one and only this one is measured in columns.
  //
  // THE HINT KEEPS THE CONSEQUENCE AND DROPS THE MECHANISM. What happens is
  // that a running screen re-wraps, and an operator not told that reads it as
  // vam having broken their session; HOW it happens -- vam measures the pane
  // and sends tmux a new column count (`terminal-size.ts`) -- is machinery the
  // operator cannot act on, and it lives there and here rather than on screen.
  'settings.appearance.terminalText.label': 'terminal text',
  'settings.appearance.terminalText.hint':
    'how large the terminal screen is drawn — a bigger size fits fewer columns, and a running screen re-wraps',
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
  'settings.appearance.terminalTheme.label': 'terminal theme — {on}',
  'settings.appearance.terminalTheme.hint':
    'the scheme the terminal wears while the app is {on} — {default} unless you choose another',
  'settings.appearance.terminalColours.label': 'terminal colours — {theme}',
  'settings.appearance.terminalColours.hint':
    'each colour of the {theme} scheme — unset follows the scheme above, and {other} keeps its own',
  'settings.appearance.terminalColours.reset': 'reset {theme} terminal colours',
  'settings.appearance.terminalOpacity.label': 'terminal background',
  // THE FLOOR IS SAID, because a slider that stops at 30% with no word about
  // it reads as a slider that is stuck: under it the pane's own grey shows
  // through more than the scheme's ground does (`prefs/terminal-scheme.ts`).
  // WHY it stops there -- every colour in the scheme was chosen against that
  // ground -- is the argument for the floor, not the floor; it is written in
  // `prefs/terminal-scheme.ts`, and what the operator needs on screen is that
  // the slider ends where it ends on purpose.
  'settings.appearance.terminalOpacity.hint':
    "how much of the scheme's ground is painted over the pane — the rest is the pane showing through; it stops at 30%",
  // WHAT A SESSION TAB DRAWS. One caption per indicator, and each caption is
  // the whole documentation of its glyph: three of the eight are not
  // guessable from a name (`draft` is text you have NOT sent, `pending` is a
  // prompt the transcript has NOT recorded yet, `agents` is a count), so
  // every caption says what the mark MEANS rather than what it looks like.
  // The hint carries the one rule that is not a switch: idle draws nothing.
  // THE FILE EDITOR'S COLOURS, and only those: its INDENT is in Behaviour,
  // because a count of spaces is bytes in the operator's file rather than a
  // colour. The label says which editor, because vam has more than one text
  // box and only this one has a gutter to keep level.
  // The tail this hint had ("for the formats vam can read without guessing")
  // is the note's first sentence, which then NAMES those formats. One of the
  // two had to go and it is this one: a caption that hedges without saying
  // which formats leaves the operator no better off than silence.
  'settings.appearance.editorHighlight.label': 'file editor colours',
  'settings.appearance.editorHighlight.hint': 'syntax colours in the Files tab',
  'settings.appearance.editorHighlight.on': 'on',
  'settings.appearance.editorHighlight.off': 'off',

  // ── Behaviour ────────────────────────────────────────────────────────────
  // KEYS MOVE WITH THEIR ROW, because this catalogue is namespaced by WHERE A
  // STRING IS READ (see the header). `settings.appearance.focusView.label`
  // read in a Behaviour panel would be the one thing the naming scheme exists
  // to prevent -- a key that names the wrong screen is a key a translator
  // cannot file. The STRINGS themselves are unchanged: this is a move of rows
  // between panels, not a rewrite of what they say.
  'settings.behaviour.hint':
    'what vam draws of a turn, how far a line runs, and what Tab puts in a file — colours and text sizes are in Appearance',
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
  'settings.behaviour.narrowViews.label': 'view width',
  'settings.behaviour.narrowViews.hint':
    'draw the response, PRs and agents views at two thirds of the pane, while that is at least 80 characters — a narrower pane is left whole. The terminal always fills its pane',
  'settings.behaviour.narrowViews.on': 'narrowed',
  'settings.behaviour.narrowViews.off': 'full pane',
  'settings.behaviour.focusView.label': 'focus view',
  'settings.behaviour.focusView.hint':
    "fold each turn's tool calls away, leaving your prompts and the agent's answers",
  'settings.behaviour.focusView.on': 'on',
  'settings.behaviour.focusView.off': 'off',
  // CONCISE OUTPUT. The label names what the operator gets, never the skill it
  // is vam's wording of: `i-have-adhd` is the source and is credited in
  // `main/terminal/concise.ts`, but a settings row that named a third-party
  // skill would be asking the operator to know what that is before they could
  // decide anything.
  //
  // THE HINT SAYS WHO IS ASKING AND WHEN, because both are surprising. vam has
  // no model: the only thing it can do is TYPE A REQUEST into the session, and
  // it does that once per session rather than on every prompt. An operator who
  // read this as "vam shortens the answers it draws" would be wrong about the
  // whole product.
  'settings.behaviour.conciseOutput.label': 'concise output',
  'settings.behaviour.conciseOutput.hint':
    'ask the agent for shorter, clearer answers — vam types the request into the session, it never rewrites what it draws',
  'settings.behaviour.conciseOutput.on': 'on',
  'settings.behaviour.conciseOutput.off': 'off',
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
  'settings.behaviour.editorIndent.label': 'file editor indent',
  // SPACES IS NOT A DETAIL: it is what keeps the line-number gutter level with
  // the text, so the caption says it rather than leaving "indent" to be read
  // as "a tab".
  'settings.behaviour.editorIndent.hint':
    'how many spaces one Tab inserts in the Files tab, and what a format indents by',

  // ── Update ───────────────────────────────────────────────────────────────
  // THE OPERATOR ASKED A QUESTION, SO EVERY ANSWER IS A SENTENCE. The popover
  // that already existed draws for one outcome and is silent for the other
  // three, which is right for a notice nobody asked for and wrong for a room
  // somebody walked into. `rate-limited` and `malformed` are developer words
  // for states a person acts on by waiting and by doing nothing; neither
  // reaches the screen.
  'settings.update.hint': 'which vam this is, and whether a newer one has been released',
  'settings.update.check': 'check for updates',
  'settings.update.checking': 'checking…',
  'settings.update.current': 'this is the newest release',
  'settings.update.none': 'no releases have been published yet',
  // NOT STARTING WITH THE PRODUCT NAME, and that is a constraint the panel's
  // structural capitalisation puts on this catalogue: `vam` is lower case
  // everywhere, and a paragraph beginning with it paints `Vam`. The strings
  // drawn without `data-verbatim` therefore begin with something whose case
  // is nobody's decision.
  'settings.update.available': 'a newer vam is out — {version}',
  'settings.update.open': 'open the release page',
  'settings.update.offline': 'GitHub could not be reached — check the connection and try again',
  'settings.update.limited': 'GitHub is rate-limiting this address; try again in a few minutes',
  'settings.update.malformed': 'GitHub answered something vam could not read as a release',
  // The browser build has no preload bridge, so there is no channel to check
  // over. Absent rather than dimmed, with the reason said out loud: a missing
  // control and no explanation reads as a broken screen.
  'settings.update.browser':
    'vam checks for updates from the desktop app. This is a browser tab, which has no way to ask.',

  // ── Sessions ─────────────────────────────────────────────────────────────
  'settings.sessions.hint': 'which agent a new session starts, and which key sends a prompt to one',
  'settings.sessions.provider.label': 'default provider',
  'settings.sessions.sendKey.label': 'send key',
  'settings.sessions.sendKey.hint': 'which key sends the prompt you are typing to the session',

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
