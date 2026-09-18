/**
 * WHAT AN ICON IS — two kinds of them now, and one string that still holds
 * everything already on somebody's disk.
 *
 * The operator asked for "some icons and a colour" for projects, groups and
 * sessions. The second half is what forces this module to exist: AN EMOJI
 * CANNOT BE RECOLOURED. 🔨 is a picture the font draws, not a shape vam
 * paints, and `color` does nothing to it in any browser. So "add a colour
 * field" is not a change that can be made to the icon vam already has — a
 * glyph that takes a colour has to be one that inherits `currentColor`, which
 * is what a lucide path is and what an emoji is not. An icon therefore becomes
 * a CHOICE BETWEEN TWO KINDS, and the tone belongs to exactly one of them.
 *
 * ## The representation, and how an already-stored emoji reads under it
 *
 * The stored value stays a plain `string`, as `Session.icon`,
 * `Project.icon` and `Group.icon` have always been, and prefixes the new kind:
 *
 *     "🔨"                     an emoji, exactly what it has always been
 *     "lucide:rocket"          a named glyph, in the default tone
 *     "lucide:rocket:teal"     a named glyph, in one of the eight tones
 *
 * AN OLD VALUE IS READ BY THE FIRST RULE IN `parseIcon`: anything that does
 * not begin with `lucide:` is an emoji, returned as-is. Every icon written
 * before this change was one emoji straight out of `EmojiGrid`, so every one
 * of them takes that branch and draws exactly what it drew yesterday. THERE IS
 * NO MIGRATION, deliberately: `prefs.ts` argues twice that a rewrite over an
 * operator's stored JSON is a step that can fail on their machine and take
 * their choices with it, and the cheapest migration is the one that does not
 * exist. The prefs buckets, their TTL, their source keying and the three
 * `set*Icon` writers are all untouched — they store a string, and this is
 * still a string.
 *
 * THE COLLISION IS IMPOSSIBLE RATHER THAN UNLIKELY: the only writer of the old
 * kind is the emoji grid, which emits one emoji character, and no emoji
 * sequence contains an ASCII `l`. A hand-edited prefs file could of course
 * type `lucide:` as an "emoji" — and would then get a glyph or, if it named
 * nothing, no icon; that is the whole cost, and it is smaller than a
 * migration's.
 *
 * ## Why the tone lives INSIDE the value instead of beside it
 *
 * A colour resolves down the same chain as the glyph (`session-icon.tsx`): the
 * session's own, else the project's, else a default. The cheap way to build
 * that is a second field with a second chain — and a second chain is how a
 * session showing its PROJECT's emoji ends up wearing its own stored tone,
 * which is a combination nobody ever chose and which cannot even be drawn.
 * Carrying the tone inside the value makes the two questions one question:
 * whatever link of the chain answers, answers with both halves at once.
 *
 * ## Why an unreadable value is `null` and not a visible error
 *
 * `lucide:nonesuch` is what a NEWER vam's icon looks like to an older one, and
 * what a hand-edited file can hold. It resolves to "no icon", so the chain
 * carries on to the next link and the caller's own placeholder ends it. The
 * alternative is a sidebar heading reading `lucide:nonesuch`, which is vam
 * printing its own machinery at the operator. An unknown TONE is treated less
 * harshly — the glyph survives in the default tone — because the glyph is the
 * choice and the tone is its decoration, and losing the decoration is the
 * smaller loss.
 */

import {
  BookOpen,
  Bot,
  Boxes,
  Bug,
  Cloud,
  Code,
  Cpu,
  Database,
  Flag,
  FlaskConical,
  GitBranch,
  Globe,
  Layers,
  type LucideIcon,
  Package,
  Palette,
  Rocket,
  Server,
  Shield,
  Smartphone,
  Star,
  Target,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

/**
 * ORCA'S EIGHT, in orca's order, because the shape of the control is the part
 * worth copying: a neutral and seven hues is enough to tell a dozen projects
 * apart and few enough to fit one row under the glyph grid. A ninth would buy
 * a distinction nobody asked for and cost the row its alignment with the
 * eight-wide glyph grid above it.
 *
 * `neutral` IS NOT A HUE, and that is why it leads. It is the colour an
 * unpainted glyph already has — `styles.css` gives `--vam-icon-neutral` the
 * value `--vam-ink-faint` holds, the ink the `Monitor` and `Folder`
 * placeholders wear — so picking it reads as "no colour" rather than as a
 * grey somebody chose. `token-contrast.test.ts` holds those two values equal,
 * so the two cannot drift into being visibly different answers to the same
 * question.
 *
 * Declared as a VALUE with the type read back off it (`IconToneName`), not as
 * a union with a matching array beside it: two lists of the same eight things
 * is the drift this repo has paid for three times.
 */
export const ICON_TONES = [
  'neutral',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'purple',
  'pink',
] as const satisfies readonly string[];

/**
 * The Tailwind utility each tone paints with — TOKENS, never values (13.1).
 *
 * Exported because `token-contrast.test.ts` measures these, and it must
 * measure the list the app really paints rather than a second copy of it. That
 * is not a hypothetical: the file-tree glyph inks were typed out in both
 * places, and repointing a family in the module reddened nothing at all until
 * the guard started deriving its tokens from `FILE_ROW_INKS`. The bridge is
 * the same one line there and here — `text-icon-teal` is `--vam-icon-teal`
 * with one prefix swapped.
 *
 * SPELLED AS WHOLE LITERALS rather than built from the tone name, because
 * Tailwind's scanner reads SOURCE TEXT and emits a utility only where it finds
 * one written out. This table is the only place the eight class names exist as
 * text, which is what makes it the load-bearing part.
 *
 * WHAT THAT DOES AND DOES NOT PROTECT, measured rather than assumed: replacing
 * `ICON_TONE_INK[value.tone]` at the call site below with an interpolated
 * `text-icon-${value.tone}` STILL PAINTS CORRECTLY, because the scanner has
 * already found all eight here. So the rule is not "never interpolate a class"
 * -- it is "every class the app can paint must be written out somewhere the
 * scanner reads". Deleting an entry from this table is what really unpaints a
 * tone, which is why `token-contrast.test.ts` derives its token list from it.
 */
export const ICON_TONE_INK = {
  neutral: 'text-icon-neutral',
  red: 'text-icon-red',
  orange: 'text-icon-orange',
  yellow: 'text-icon-yellow',
  green: 'text-icon-green',
  teal: 'text-icon-teal',
  purple: 'text-icon-purple',
  pink: 'text-icon-pink',
} as const satisfies Record<IconToneName, string>;

/**
 * THE CURATED SET — twenty-four glyphs, and the argument for that number.
 *
 * `IconPicker`'s own header argues, correctly, that a shortlist of emoji is the
 * wrong answer: "the whole reason a person picks an icon is that theirs means
 * something to them, and a shortlist decides in advance which meanings are
 * available." NONE OF THAT IS WEAKENED HERE, because the full emoji picker is
 * still in the panel, unchanged and unbounded. This list is not "the icons you
 * may have". It is "the icons vam can RECOLOUR", which is a different and
 * necessarily smaller set: a shape vam draws itself.
 *
 * TWENTY-FOUR IS THREE ROWS OF EIGHT, and eight is the tone row beneath it, so
 * the two controls are one grid wide and the panel keeps the 340px the emoji
 * grid fixes (`IconPicker`). The rows are also the categories, in order: what
 * the work IS, what it runs on or ships as, and what it is about.
 *
 * IT IS NOT THE WHOLE LIBRARY, and that is a bundle fact rather than a taste
 * one. `lucide-react` ships ~1,600 icons (3,557 declarations with aliases);
 * these are twenty-four named imports, which is what a bundler can tree-shake.
 * `import * as icons` or a dynamic `icons[name]` lookup defeats that and puts
 * the library into the eager chunk `bundle-budget.test.ts` measures.
 *
 * `satisfies Record<IconGlyphName, LucideIcon>` makes the map TOTAL: a name
 * added to the type with no picture beside it fails to compile.
 */
export const ICON_GLYPHS = {
  // What the work is.
  code: Code,
  terminal: Terminal,
  'git-branch': GitBranch,
  server: Server,
  database: Database,
  cloud: Cloud,
  cpu: Cpu,
  globe: Globe,
  // What it runs on, or ships as.
  package: Package,
  boxes: Boxes,
  layers: Layers,
  smartphone: Smartphone,
  rocket: Rocket,
  zap: Zap,
  bot: Bot,
  wrench: Wrench,
  // What it is about.
  'flask-conical': FlaskConical,
  bug: Bug,
  shield: Shield,
  'book-open': BookOpen,
  palette: Palette,
  star: Star,
  flag: Flag,
  target: Target,
} as const satisfies Record<string, LucideIcon>;

/**
 * A glyph's name — lucide's OWN kebab-case name for it, not one invented here.
 * That is the point: the name goes into an operator's prefs file, and
 * `lucide:flask-conical` is a string they can look up on lucide.dev. A private
 * vocabulary ("test", "beaker") would be a second naming system to maintain
 * and to explain.
 */
export type IconGlyphName = keyof typeof ICON_GLYPHS;

/** One tone name. Declared from the list so the two cannot disagree. */
export type IconToneName = (typeof ICON_TONES)[number];

/** Every glyph name, in the grid's own order — a picker draws this, a test sweeps it. */
export const ICON_GLYPH_NAMES = Object.keys(ICON_GLYPHS) as readonly IconGlyphName[];

/** What an icon resolves to. `null` (never a member here) means "nobody chose one". */
export type IconValue =
  | { readonly kind: 'emoji'; readonly emoji: string }
  | { readonly kind: 'glyph'; readonly glyph: IconGlyphName; readonly tone: IconToneName };

/** The one prefix that separates the two kinds. See the header for why an old
 *  value cannot accidentally carry it. */
const GLYPH_PREFIX = 'lucide:';

/** The tone a glyph wears when nobody has said otherwise — the last link of
 *  the colour chain, and the same "no colour picked" the placeholders wear. */
export const DEFAULT_TONE: IconToneName = 'neutral';

const isTone = (raw: string): raw is IconToneName =>
  (ICON_TONES as readonly string[]).includes(raw);

const isGlyphName = (raw: string): raw is IconGlyphName =>
  Object.hasOwn(ICON_GLYPHS, raw) && raw !== '';

/**
 * A stored string, read. Total, and never throws: the input is an operator's
 * own JSON file and a reader that can fail is a launch that can fail.
 */
export function parseIcon(stored: string | null | undefined): IconValue | null {
  if (stored === null || stored === undefined || stored === '') return null;
  // THE BACKWARD-COMPATIBLE READ, and it is the first branch on purpose: every
  // icon written before glyphs existed lands here and is returned unchanged.
  if (!stored.startsWith(GLYPH_PREFIX)) return { kind: 'emoji', emoji: stored };
  const [glyph, tone] = stored.slice(GLYPH_PREFIX.length).split(':');
  if (glyph === undefined || !isGlyphName(glyph)) return null;
  return { kind: 'glyph', glyph, tone: tone !== undefined && isTone(tone) ? tone : DEFAULT_TONE };
}

/** The inverse, for the picker: what to hand `setIcon` and friends. */
export function storedIcon(value: IconValue): string {
  return value.kind === 'emoji' ? value.emoji : `${GLYPH_PREFIX}${value.glyph}:${value.tone}`;
}

/**
 * What the status line says after a pick.
 *
 * `Canvas` reported the stored string directly ("🔨 — kept on this machine"),
 * which was the icon itself while every icon was an emoji. `lucide:rocket:teal`
 * in that sentence is vam reading its own storage format aloud, so a glyph is
 * named in the two words the operator actually chose.
 */
export function describeIcon(stored: string): string {
  const value = parseIcon(stored);
  if (value === null) return stored;
  return value.kind === 'emoji' ? value.emoji : `${value.glyph} · ${value.tone}`;
}

/**
 * An icon, drawn — and the one place either kind turns into pixels.
 *
 * `fallback` is the CALLER'S placeholder rather than one chosen here, for the
 * reason `SessionIcon`'s `size` is a parameter: the three call sites end the
 * chain differently on purpose (a project draws `Monitor`, a group draws
 * `Folder`, a tab draws nothing at all), and that is a fact about each surface,
 * not about what an icon is.
 *
 * AN EMOJI IS RETURNED AS BARE TEXT, with no element around it. Every existing
 * caller puts it inside its own span and lays that span out; wrapping it here
 * would change three surfaces' layout to no purpose and would move what their
 * `textContent` reports.
 *
 * `data-icon-glyph` and `data-icon-tone` carry what was really drawn, so a
 * guard can measure the painted node — a class name proves a rule was typed,
 * not that it matched, which is the lesson `files-icons.tsx` records beside its
 * own `data-file-icon`.
 */
export function IconMark({
  value,
  size,
  fallback,
}: {
  readonly value: IconValue | null;
  /** The glyph's size in px. Irrelevant to an emoji, which is text and takes
   *  the caller's own type scale. */
  readonly size: number;
  readonly fallback: ReactNode;
}): ReactElement {
  if (value === null) return <>{fallback}</>;
  if (value.kind === 'emoji') return <>{value.emoji}</>;
  const Glyph = ICON_GLYPHS[value.glyph];
  return (
    <Glyph
      data-icon-glyph={value.glyph}
      data-icon-tone={value.tone}
      aria-hidden="true"
      size={size}
      strokeWidth={1.7}
      className={`flex-none ${ICON_TONE_INK[value.tone]}`}
    />
  );
}
