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
  'settings.appearance.hint':
    'theme, colours, the size of the text in out, and how much of a turn the transcript draws',
  'settings.appearance.theme.label': 'theme',
  'settings.appearance.theme.hint': 'system follows what the operating system asks for',
  'settings.appearance.templates.label': 'templates',
  'settings.appearance.templates.hint':
    'a whole {theme} palette in one press — the swatches below still edit it afterwards',
  'settings.appearance.colours.label': 'colours — {theme}',
  'settings.appearance.colours.hint': 'unset follows the stylesheet, and {other} keeps its own',
  'settings.appearance.colours.reset': 'reset {theme} colours',
  'settings.appearance.outText.label': 'out text',
  'settings.appearance.outText.hint':
    "how large the agent's answer is drawn, in every response pane",
  'settings.appearance.focusView.label': 'focus view',
  'settings.appearance.focusView.hint':
    "fold each turn's working away, leaving your prompts and the agent's answers",
  'settings.appearance.focusView.on': 'on',
  'settings.appearance.focusView.off': 'off',

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
  'prs.repo.own': "Asking in this session's own directory",
  'prs.repo.overridden': 'Asking in {directory}',
  'prs.repo.choose': 'Choose another…',
  'prs.repo.change': 'Change…',
  'prs.repo.clear': "Use the session's",

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
