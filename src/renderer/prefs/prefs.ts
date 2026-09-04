/**
 * The two things that are yours rather than the factory's.
 *
 * §3 already decided this and the code had not caught up: "draggable and
 * remembers position. Position is saved per user, **and does not go into
 * the event log**." Where you dragged a card and which emoji you put on a
 * session are facts about how you like to look at the work — they are not
 * facts about the work, so they must not become events. black-smith is right
 * to have no route for them, and vam was wrong to answer "black-smith
 * doesn't store icons" as though that settled it.
 * Nobody asked black-smith. This is the browser's job.
 *
 * So: `localStorage`, per browser, per person. It never leaves the machine and
 * it is never sent anywhere.
 *
 * Everything here is defensive on purpose. `localStorage` can be absent, can
 * throw on mere access (a browser set to block site data does exactly that),
 * can be full, and can hold whatever a previous version of vam — or a person
 * with devtools open — left in it. None of that may break the canvas: a
 * preference that cannot be read is a preference you do not have, not an error
 * worth a screen. Every path here ends in "then draw the default layout".
 */

import { DEFAULT_PROVIDER_ID, type ProviderId, readProviderId } from '../../shared/providers.js';
import type { CanvasModel, SourceId } from '../domain/model.js';
import { DEFAULT_SESSION_FILTERS, type SessionFilters } from '../domain/session-filter.js';
import { type KeyBindings, MAX_BINDINGS, setActiveBindings } from '../keyboard/chords.js';
import { setActiveProvider } from '../sources/provider.js';
import {
  ALL_VISIBLE,
  type ColumnId,
  clampPaneWidth,
  DEFAULT_ORDER,
  DEFAULT_PANES,
  LAYOUTS,
  type Layout,
  type LayoutName,
  type Pane,
} from './panes.js';

const KEY = 'vam.prefs.v1';

/**
 * How long an untouched entry survives.
 *
 * Sessions are not forever and neither are their positions. Without a bound the
 * store grows for the life of the browser profile, keeping coordinates for
 * sessions the factory forgot months ago. Thirty days is well past "I am still
 * working on this" and well short of "this is now a leak".
 *
 * Pruning is by age, not by "is this session still in the model" — the model is
 * empty on the very first render, before the first fetch answers, and pruning
 * against it there would delete everything the moment you opened the page.
 */
const TTL_DAYS = 30;

/** What we need of `Storage`. Narrow so a test can pass a plain object. */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type IconChoice = { readonly icon: string; readonly at: string };

/**
 * A session's local name, and when you gave it one.
 *
 * DELIBERATELY VAM'S OWN, and deliberately local. Claude Code keeps its own
 * notion of a user-set name -- `~/.claude/sessions/<pid>.json` carries `name`
 * and `nameSource: "user"` -- and `claude agents` exposes no rename
 * subcommand, so there is no call to make; writing that file ourselves is the
 * "fix" this comment exists to forestall. vam does not write into the
 * operator's Claude Code state. The override lives here, wins over whatever
 * the source calls the session, and clearing it gives the source's name back.
 */
export type RenameChoice = { readonly title: string; readonly at: string };

/**
 * Which of the mockup's two artboards you are looking at.
 *
 * Stored, not sniffed. `prefers-color-scheme` answers a question about the
 * operating system; this one is about a single dashboard you may well want dark
 * while everything around it is light. The toggle in the sidebar is the whole
 * interface, so the stored value is the only input.
 */
export type Theme = 'dark' | 'light' | 'system';

/** Dark is the default: it is the theme vam was designed in (artboard 1a). */
export const DEFAULT_THEME: Theme = 'dark';

/**
 * How much of the canvas a focused session's row should take up.
 *
 * Lives here rather than in `Canvas.tsx` because it is now a stored value and
 * the store is what owns a default; `FOCUS_VIEWPORT_SHARE` there is this
 * constant, re-exported, so there is still exactly one 0.6 in the tree.
 */
export const DEFAULT_FOCUS_SHARE = 0.6;

/**
 * The range the picker offers and every read clamps into.
 *
 * Below 0.3 the row is a speck in the middle of an empty canvas; above 1 the
 * derived padding goes negative and ReactFlow fits the row past the edges of
 * the viewport, which is the one input that makes the canvas draw nothing at
 * all. Both ends are therefore correctness bounds, not taste.
 */
export const FOCUS_SHARE_MIN = 0.3;
export const FOCUS_SHARE_MAX = 1;

/**
 * Total, like `clampPaneWidth`: a stored share can be a string an older vam
 * wrote, a `NaN` from a hand-edited payload, or an Infinity from devtools, and
 * none of those may reach `focusPadding` — a `NaN` padding is a canvas that
 * renders nothing and says nothing.
 */
export function clampFocusShare(share: number): number {
  if (typeof share !== 'number' || Number.isNaN(share)) {
    return DEFAULT_FOCUS_SHARE;
  }
  return Math.min(FOCUS_SHARE_MAX, Math.max(FOCUS_SHARE_MIN, share));
}

/** The root text size of the `out` pane, in px. 12 because `styles.css` says
 *  `body { font-size: 12px }` and `out` inherited it: any other default would
 *  resize the pane for everyone merely by shipping the setting. */
export const DEFAULT_OUT_FONT_SIZE = 12;

/** The range the picker offers and every read clamps into. `out`'s smallest
 *  member — the `(href)` hint — is 0.875 of this root, so below 10 it drops
 *  under 9px; above 20 the body stops fitting the 300px canvas strip without
 *  breaking mid-word. Legibility bounds, enforced on READ as well as write: a
 *  hand-edited payload never passed the picker and must not be able to make a
 *  pane too small to read the setting back in. */
export const OUT_FONT_SIZE_MIN = 10;
export const OUT_FONT_SIZE_MAX = 20;

/** Total, like `clampFocusShare`: a string an older vam wrote, a `NaN` from a
 *  hand edit, an Infinity from devtools — none of them may reach the pane. */
export function clampOutFontSize(size: number): number {
  if (typeof size !== 'number' || Number.isNaN(size)) {
    return DEFAULT_OUT_FONT_SIZE;
  }
  return Math.min(OUT_FONT_SIZE_MAX, Math.max(OUT_FONT_SIZE_MIN, size));
}

/** Session id → the emoji you gave it, for one source. */
export type IconsBySession = Readonly<Record<string, IconChoice>>;

/**
 * A session, named the way the store names sessions everywhere else: by source
 * AND id, because an id is unique only within its source.
 */
export type FocusChoice = { readonly source: string; readonly session: string };

export type Prefs = {
  /**
   * Source id → session id → the emoji you gave it.
   *
   * Session ids are unique only within a source (§ epic.md, AC-1): two
   * sources can both name a session `D-257`, and without this outer key they
   * would share one glyph. Both levels are built on `Object.create(null)`
   * objects populated by explicit loops, never a bare `{}` mutated with
   * `obj[key] = …`, because a plain object's `__proto__` is an inherited
   * SETTER: assigning through it produces no own property at all, so the entry
   * misses the store's own-property count and vanishes on the next
   * `JSON.stringify` round trip (AC-2).
   *
   * `__proto__` is the ONLY key that does this, and naming a second one here
   * would be wrong rather than merely cautious. `constructor`, `prototype` and
   * `toString` are inherited WRITABLE DATA properties, so assigning through
   * them shadows the inherited value with a real own property that serialises
   * like any other — measured, not assumed. The null-prototype accumulator is
   * still the right shape: it removes the hazard by construction instead of
   * relying on a list of key names staying complete.
   */
  readonly icons: Readonly<Record<string, IconsBySession>>;
  readonly theme: Theme;
  /**
   * The share of the viewport a focused row is framed to occupy. Same TTL
   * exemption as `theme` and `panes`, for the same reason: it is a fact about
   * how you like to read the canvas, not about a session.
   *
   * @deprecated NOTHING READS THIS ANY MORE. The behaviour it configured --
   * the canvas automatically scaling to frame the focused session -- was
   * removed at the operator's request; following focus now pans and leaves
   * the zoom exactly where the operator put it, so there is no framing target
   * left to tune.
   *
   * DELETING IT IS A PERSISTED-DATA MIGRATION, NOT A DELETE, the same rule
   * `Project.source` records. The value sits at the top level of stored JSON
   * that shipped vams have already written; the reader below still parses and
   * clamps it, which costs nothing and keeps `readPrefs` total. Whoever drops
   * the field drops the stored key with it and ships a migration for existing
   * stores -- until then a dead field is the cheap, safe state, because reads
   * here degrade per field and an unknown key is simply ignored.
   */
  readonly focusViewportShare: number;
  /**
   * The two dragged pane widths, always present — there are exactly two
   * panes and both are known at compile time, so this is not a keyed map.
   * Not pruned by the TTL `icons` gets: a pane width is a fact about the
   * person, not about a session that stopped existing, the same argument
   * that already exempts `theme` (epic.md §4.1).
   */
  readonly panes: { readonly sidebar: number; readonly detail: number };
  /**
   * Which panes are drawn. NEXT TO `panes`, not inside it: a width is a
   * number every path already clamps into `[MIN, MAX]`, and folding "not
   * drawn" into that number would mean unpicking the clamp that keeps a
   * garbage width from rendering as a pane that has vanished. Same TTL
   * exemption as `panes` and `theme`, for the same reason.
   */
  readonly paneVisibility: Layout;
  /**
   * Source id → project id → the emoji you gave that project's heading.
   *
   * Same idiom as `icons`, one level up, for the same reason: a project id is
   * unique only within a source (`to-canvas.ts` builds it from that source's
   * own `overview.runningSessions`), so a bare `{ projectId: IconChoice }`
   * would let two sources' projects collide the way session ids already do.
   * There is no legacy flat shape to migrate here — this key never shipped
   * before this field existed.
   */
  readonly projectIcons: Readonly<Record<string, IconsBySession>>;
  /**
   * The filter popover's two origin toggles. Exempt from the icon TTL for the
   * same reason `theme` and `panes` are: it describes the person, not a
   * session that may have stopped existing.
   */
  readonly filters: SessionFilters;
  /**
   * Source id → the ids of that source's projects you folded shut.
   *
   * Two levels for the same reason `projectIcons` has two: a project id is
   * unique only within its source, so a flat list would let one source's fold
   * close another source's project. A list rather than a map of booleans
   * because the only value it could hold is `true` — an expanded project is
   * an ABSENT entry, not a stored `false`, so the store never accumulates a
   * row per project you merely looked at. Exempt from the icon TTL, like
   * `theme`, `panes` and `filters`: a fold is a fact about the person.
   */
  readonly collapsedProjects: Readonly<Record<string, readonly string[]>>;
  /**
   * Source id → the ids of that source's projects you REMOVED from vam.
   *
   * The same two-level shape and the same reasoning as `collapsedProjects`
   * above, and it exists for a reason peculiar to this app: a project is
   * derived from the cwd of live sessions, so removing one cannot be a
   * deletion. vam ends the sessions it started and has no verb for the rest,
   * and the project would return on the next refresh regardless. This list is
   * what makes the removal stick — and, being the only stored half of it, the
   * only half that can be undone. Exempt from the icon TTL: it records a
   * decision the operator made, not a session that has stopped existing.
   */
  readonly hiddenProjects: Readonly<Record<string, readonly string[]>>;
  /**
   * Source id → session id → the name you gave it. Same keying, storage and
   * TTL as `icons`, for the same reasons -- and the TTL applies for one more:
   * a name for a session that stopped existing months ago is not worth
   * keeping either.
   */
  readonly renames: Readonly<Record<string, Readonly<Record<string, RenameChoice>>>>;
  /**
   * Token → the colour the operator chose for it, for the few tokens vam
   * offers. An OVERRIDE LAYER, not a palette: an absent token is not a stored
   * default, it is "whatever styles.css says for the theme you are in", so the
   * light/dark pair keeps working under a partial override and a reset is a
   * deletion rather than a write. Exempt from the icon TTL for the reason
   * `theme` is: it describes the person.
   */
  readonly palette: PaletteOverrides;
  /**
   * Action id → the keys the operator gave it. Same "absent means shipped"
   * shape and the same reasoning as `palette`: the chord tables stay the
   * source of the grammar, and this only says where the operator moved things.
   */
  readonly keyBindings: KeyBindings;
  /** The root text size of the `out` pane, in px. One number rather than a
   *  size per element: `out`'s sizes are a hierarchy expressed as `em` against
   *  this root, so storing the root moves them all and cannot flatten them. */
  readonly outFontSize: number;
  /**
   * The provider a new session is started with, chosen in settings.
   *
   * Stored as an id rather than a command: the command belongs to the provider
   * table (`shared/providers.ts`), and a stored command would be a stored
   * decision about how to run somebody else's CLI that no later vam could
   * correct. Exempt from the icon TTL like `theme` and `panes`, for the same
   * reason -- it describes the person, not a session that stopped existing.
   */
  readonly defaultProvider: ProviderId;
  /**
   * Where the operator was looking when they last quit: a SESSION, keyed by
   * its source, or `null` for "nothing was focused".
   *
   * A session rather than a node id, which is the whole decision here. Node
   * ids are derived from the layout and change whenever the model, the filters
   * or the fold state change, so a stored node id would go stale between one
   * launch and the next without anything having ended. A session id under its
   * source is the identity `icons` and `renames` already store, and it is what
   * a re-laid-out canvas can still be matched against (`focus.ts`).
   *
   * EXEMPT FROM THE ICON TTL, and for a different reason than `theme` is. This
   * IS a fact about a session, so the "not about the person" argument does not
   * save it. It is exempt because the TTL exists to stop the store growing a
   * row per session forever, and this is ONE pointer that each write replaces
   * -- there is nothing to accumulate. The staleness the TTL would guard
   * against is already handled better downstream: `resolveFocusNodeId` falls
   * back to the first candidate for any pointer that no longer names a session
   * on screen, whether it went stale in a day or in a year.
   */
  readonly lastFocus: FocusChoice | null;
};

export const EMPTY_PREFS: Prefs = {
  icons: {},
  theme: DEFAULT_THEME,
  focusViewportShare: DEFAULT_FOCUS_SHARE,
  panes: DEFAULT_PANES,
  paneVisibility: ALL_VISIBLE,
  projectIcons: {},
  filters: DEFAULT_SESSION_FILTERS,
  collapsedProjects: {},
  hiddenProjects: {},
  renames: {},
  palette: {},
  keyBindings: {},
  outFontSize: DEFAULT_OUT_FONT_SIZE,
  defaultProvider: DEFAULT_PROVIDER_ID,
  lastFocus: null,
};

/**
 * The real `localStorage`, or null if this browser will not give us one.
 *
 * Reading `window.localStorage` is itself the thing that throws when site data
 * is blocked, so even the access is guarded — a `typeof window` check is not
 * enough.
 */
export function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the store, and put what it says into force.
 *
 * The activation is here rather than in the canvas because the two things this
 * epic added — a colour override layer and a key binding layer — are consumed
 * by a stylesheet and by a module-level chord reducer, neither of which is a
 * React value anything re-renders on. One call on the read path and one on the
 * write path is the whole wiring, and it makes "what is stored" and "what is in
 * force" the same sentence.
 */
export function readPrefs(
  storage: StorageLike | null,
  now: Date = new Date(),
  migrateSource: SourceId = 'black-smith',
): Prefs {
  return activatePrefs(parsePrefs(storage, now, migrateSource));
}

function parsePrefs(
  storage: StorageLike | null,
  now: Date = new Date(),
  migrateSource: SourceId = 'black-smith',
): Prefs {
  if (storage === null) {
    return EMPTY_PREFS;
  }
  let raw: string | null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return EMPTY_PREFS;
  }
  if (raw === null) {
    return EMPTY_PREFS;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Someone else's key, a half-written value, a older format. Start over
    // rather than guess — the cost of being wrong is the default layout.
    return EMPTY_PREFS;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return EMPTY_PREFS;
  }
  const record = parsed as {
    icons?: unknown;
    panes?: unknown;
    paneVisibility?: unknown;
    projectIcons?: unknown;
    filters?: unknown;
    collapsedProjects?: unknown;
    hiddenProjects?: unknown;
    renames?: unknown;
  };
  const cutoff = new Date(now.getTime() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return {
    icons: pruneBuckets(readIcons(record.icons, migrateSource), cutoff),
    // Not pruned by the TTL icons get. A theme is about the person, and one
    // who opens vam twice a year still wants the theme they chose.
    theme: readTheme((parsed as { theme?: unknown }).theme),
    // Per field like every line around it: a payload from a vam that predates
    // this setting has no key at all, and a garbage one costs only itself.
    focusViewportShare: readFocusShare(
      (parsed as { focusViewportShare?: unknown }).focusViewportShare,
    ),
    // Same argument as theme: not pruned, and defensive against an absent
    // field (today's shipped payloads have none), a non-object, or garbage
    // numbers left by devtools or an older vam.
    panes: readPanes(record.panes),
    // Per FIELD again, which is the whole reason this sits beside `panes`
    // rather than in it: every payload already in a browser has no
    // `paneVisibility` key at all, and each of those reads back as "all three
    // panes are drawn" without a version number or a migration.
    paneVisibility: readPaneVisibility(record.paneVisibility),
    // Same TTL as session icons, same reasoning: a project's glyph is not
    // worth remembering forever either.
    projectIcons: pruneBuckets(readProjectIcons(record.projectIcons), cutoff),
    // Same argument again: not pruned, and per-field defensive so one garbage
    // toggle cannot drag the other back to its default with it.
    filters: readFilters(record.filters),
    // Not pruned either, and per-source defensive: one garbage bucket cannot
    // unfold the projects another source folded.
    collapsedProjects: readIdsBySource(record.collapsedProjects),
    // Per field and per source like the fold above it: a payload from a vam
    // that predates removal has no key, and reads back as "nothing removed".
    hiddenProjects: readIdsBySource(record.hiddenProjects),
    // Same TTL and same shape as the icons above; a payload written before
    // this field existed simply has none, and reads as `{}`.
    renames: pruneBuckets(readBuckets(record.renames, readRename), cutoff),
    // Per field like everything above it: a payload from a vam that predates
    // either of these has no key at all, and reads back as "no overrides" —
    // the shipped palette and the shipped chords — without touching a
    // neighbour.
    palette: readPalette((parsed as { palette?: unknown }).palette),
    keyBindings: readKeyBindings((parsed as { keyBindings?: unknown }).keyBindings),
    // Per field like the focus share above it, and clamped here rather than
    // only in the setter: this is the read a hand-edited file arrives by.
    outFontSize: readOutFontSize((parsed as { outFontSize?: unknown }).outFontSize),
    // Per field like everything above it, and normalised rather than merely
    // defaulted: an id an older vam stored for a provider that no longer
    // exists, or a hand-edited one, must read back as the working default. A
    // stored provider vam cannot start would otherwise be an app that cannot
    // start a session at all.
    defaultProvider: readProviderId((parsed as { defaultProvider?: unknown }).defaultProvider),
    // Per field like every line above it: every payload already in a browser
    // has no `lastFocus` key at all and reads back as "nothing remembered",
    // which is precisely what a first launch means -- no version number, no
    // migration. Not pruned; see the field's own note for why the TTL would
    // buy nothing here.
    lastFocus: readLastFocus((parsed as { lastFocus?: unknown }).lastFocus),
  };
}

/**
 * Whatever is under the key, reduced to source → string ids.
 *
 * Every level is checked because every level can be someone else's data: an
 * older vam with no key at all, a devtools edit, a half-written value. A
 * non-array bucket is dropped whole; a non-string id inside an otherwise good
 * bucket is dropped alone, so one bad element cannot unfold the rest.
 */
function readIdsBySource(raw: unknown): Readonly<Record<string, readonly string[]>> {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const out = emptyMap<readonly string[]>();
  for (const [source, bucket] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(bucket)) {
      continue;
    }
    out[source] = bucket.filter((id): id is string => typeof id === 'string');
  }
  return out;
}

/** Is this source's project folded shut? */
export function isProjectCollapsed(prefs: Prefs, source: string, projectId: string): boolean {
  return prefs.collapsedProjects[source]?.includes(projectId) === true;
}

/**
 * Fold or unfold one project.
 *
 * Unfolding REMOVES the id, and removing the last id removes the source's
 * bucket: the stored shape then matches a fresh install exactly, which is
 * what makes "expand everything" leave no residue behind to read back.
 */
/**
 * Add or remove one id from one source's bucket.
 *
 * Removing the last id removes the SOURCE'S BUCKET, so the stored shape then
 * matches a fresh install exactly: that is what makes "expand everything" —
 * and "restore everything" — leave no residue behind to read back.
 */
function withIdBySource(
  map: Readonly<Record<string, readonly string[]>>,
  source: string,
  id: string,
  on: boolean,
): Readonly<Record<string, readonly string[]>> {
  const bucket = map[source] ?? [];
  const next = on
    ? bucket.includes(id)
      ? bucket
      : [...bucket, id]
    : bucket.filter((each) => each !== id);
  return next.length > 0
    ? withEntry(map as Record<string, readonly string[]>, source, next)
    : withoutEntry(map as Record<string, readonly string[]>, source);
}

/** Fold or unfold one project. */
export function setProjectCollapsed(
  prefs: Prefs,
  source: string,
  projectId: string,
  collapsed: boolean,
): Prefs {
  return {
    ...prefs,
    collapsedProjects: withIdBySource(prefs.collapsedProjects, source, projectId, collapsed),
  };
}

/** Has this source's project been removed from vam? */
export function isProjectHidden(prefs: Prefs, source: string, projectId: string): boolean {
  return prefs.hiddenProjects[source]?.includes(projectId) === true;
}

/**
 * Remove one project from vam, or bring it back.
 *
 * Only ever the LIST: ending the project's sessions is the caller's other
 * half, and it is deliberately not attempted here — this function is pure, and
 * the half of removal it owns is the reversible one.
 */
export function setProjectHidden(
  prefs: Prefs,
  source: string,
  projectId: string,
  hidden: boolean,
): Prefs {
  return {
    ...prefs,
    hiddenProjects: withIdBySource(prefs.hiddenProjects, source, projectId, hidden),
  };
}

/** Per FIELD, not per object: a payload from an older vam has neither key,
 * and a payload with one bad key still has one good one. */
function readFilters(raw: unknown): SessionFilters {
  const { hideAgentStarted, onlyPrompted } = (
    typeof raw === 'object' && raw !== null ? raw : {}
  ) as { hideAgentStarted?: unknown; onlyPrompted?: unknown };
  return {
    hideAgentStarted:
      typeof hideAgentStarted === 'boolean'
        ? hideAgentStarted
        : DEFAULT_SESSION_FILTERS.hideAgentStarted,
    onlyPrompted:
      typeof onlyPrompted === 'boolean' ? onlyPrompted : DEFAULT_SESSION_FILTERS.onlyPrompted,
  };
}

/** Written by the filter popover's two toggles. */
export function setSessionFilters(prefs: Prefs, filters: SessionFilters): Prefs {
  return { ...prefs, filters };
}

/** No legacy flat shape to migrate — unlike `readIcons`, every top-level
 * entry here is already `projectId → IconChoice`. */
function readProjectIcons(raw: unknown): Prefs['projectIcons'] {
  if (typeof raw !== 'object' || raw === null) {
    return emptyMap<IconsBySession>();
  }
  const out = emptyMap<IconsBySession>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const nested = readMap(value, readIcon);
    if (Object.keys(nested).length > 0) {
      out[key] = nested;
    }
  }
  return out;
}

function readTheme(raw: unknown): Theme {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : DEFAULT_THEME;
}

/** `clampFocusShare` is total, so a non-number falls through to `NaN` and
 * lands on the default, exactly like a malformed pane width. */
function readFocusShare(raw: unknown): number {
  return clampFocusShare(typeof raw === 'number' ? raw : Number.NaN);
}

/** Same shape as `readFocusShare`: a non-number falls through to `NaN` and
 *  lands on the default, and a number out of range is pulled into it. */
function readOutFontSize(raw: unknown): number {
  return clampOutFontSize(typeof raw === 'number' ? raw : Number.NaN);
}

/**
 * Both halves or neither. A pointer missing its source could be matched
 * against the wrong source's session of the same name, which is the exact
 * collision the two-level keying exists to prevent -- so a half-written value
 * is dropped whole rather than half-trusted. Costs only itself: a garbage
 * pointer leaves every neighbouring field alone.
 */
function readLastFocus(raw: unknown): FocusChoice | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const { source, session } = raw as { source?: unknown; session?: unknown };
  if (typeof source !== 'string' || typeof session !== 'string') {
    return null;
  }
  return { source, session };
}

/** Written whenever focus lands somewhere; `null` forgets the pointer. */
export function setLastFocus(prefs: Prefs, lastFocus: FocusChoice | null): Prefs {
  return { ...prefs, lastFocus };
}

function readPanes(raw: unknown): Prefs['panes'] {
  if (typeof raw !== 'object' || raw === null) {
    return DEFAULT_PANES;
  }
  const { sidebar, detail } = raw as { sidebar?: unknown; detail?: unknown };
  return {
    sidebar: readPaneWidth('sidebar', sidebar),
    detail: readPaneWidth('detail', detail),
  };
}

/** A missing or garbage field means "drawn", per field: the safe direction to
 * fail is showing a pane you wanted hidden, never hiding one you did not. The
 * order gets the same treatment one field along — every payload already in a
 * browser predates it, and each of those reads back as the shipped sequence. */
function readPaneVisibility(raw: unknown): Layout {
  const { sidebar, canvas, detail, order } = (
    typeof raw === 'object' && raw !== null ? raw : {}
  ) as {
    sidebar?: unknown;
    canvas?: unknown;
    detail?: unknown;
    order?: unknown;
  };
  const columns = readColumnOrder(order);
  return {
    sidebar: sidebar !== false,
    canvas: canvas !== false,
    detail: detail !== false,
    // Absent stays ABSENT rather than being materialised as the default: the
    // field is optional in `Layout`, `columnOrder()` answers for it, and a
    // payload that never named an order round-trips through here unchanged.
    ...(columns === undefined ? {} : { order: columns }),
  };
}

/**
 * Total: anything that is not a permutation of the three column ids reads as
 * "no order stored", which `columnOrder()` answers with the shipped sequence. A partial or repeated list is rejected whole rather
 * than repaired, because half an order is a column that would not be drawn at
 * all — and a dropped column is exactly the failure `readPaneVisibility`
 * refuses one field above.
 */
function readColumnOrder(raw: unknown): readonly ColumnId[] | undefined {
  if (!Array.isArray(raw) || raw.length !== DEFAULT_ORDER.length) {
    return undefined;
  }
  const named = new Set(raw.filter((id): id is ColumnId => DEFAULT_ORDER.includes(id as ColumnId)));
  return named.size === DEFAULT_ORDER.length ? (raw as readonly ColumnId[]) : undefined;
}

/** Written by the layout chords. */
export function setPaneVisibility(prefs: Prefs, paneVisibility: Layout): Prefs {
  return { ...prefs, paneVisibility };
}

/** One of the named layouts, applied. */
export function setLayout(prefs: Prefs, layout: LayoutName): Prefs {
  return setPaneVisibility(prefs, LAYOUTS[layout]);
}

/** `clampPaneWidth` is already total, so a non-number falls through to `NaN`
 * and lands on the pane's default, exactly like any other malformed field. */
function readPaneWidth(pane: Pane, raw: unknown): number {
  return clampPaneWidth(pane, typeof raw === 'number' ? raw : Number.NaN);
}

/** Flip it. Written by the sidebar's one toggle and by the settings overlay. */
export function setTheme(prefs: Prefs, theme: Theme): Prefs {
  return { ...prefs, theme };
}

/** Clamped on the way in, so nothing downstream has to wonder. */
export function setFocusShare(prefs: Prefs, share: number): Prefs {
  return { ...prefs, focusViewportShare: clampFocusShare(share) };
}

/** Clamped on the way in as well, for the same reason: the slider cannot
 *  produce an out-of-range value, but a future caller could. */
export function setOutFontSize(prefs: Prefs, size: number): Prefs {
  return { ...prefs, outFontSize: clampOutFontSize(size) };
}

/** Normalised on the way in as well as on the way out, so no caller can store
 *  a provider vam has no command for. */
export function setDefaultProvider(prefs: Prefs, id: unknown): Prefs {
  return { ...prefs, defaultProvider: readProviderId(id) };
}

/**
 * Put the theme on the document.
 *
 * `html.light` is the switch (styles.css), and dark is what `:root` already
 * says — so this REMOVES a class rather than adding a second one. A document
 * that somehow gets neither still renders dark, which is the safe direction to
 * fail: an unstyled light theme on a dark palette is unreadable, the reverse is
 * merely dim.
 */
export function applyTheme(
  theme: Theme,
  root: Element | null = globalThis.document?.documentElement ?? null,
  prefersLight: () => boolean = osPrefersLight,
): EffectiveTheme {
  const effective = effectiveTheme(theme, prefersLight);
  root?.classList.toggle('light', effective === 'light');
  return effective;
}

/** What is on screen. `system` is not one of these — that is the whole point. */
export type EffectiveTheme = 'dark' | 'light';

/**
 * Resolve `system` to the colour it currently means.
 *
 * Anything that reads the theme to DESCRIBE it — the sidebar's toggle and its
 * label — has to read this rather than `prefs.theme`, or a two-way ternary
 * quietly files `system` under its `else` arm and describes the wrong screen.
 */
export function effectiveTheme(
  theme: Theme,
  prefersLight: () => boolean = osPrefersLight,
): EffectiveTheme {
  if (theme === 'system') return prefersLight() ? 'light' : 'dark';
  return theme;
}

/**
 * Follow the OS for as long as the caller cares to.
 *
 * `system` promises the overlay's own words — "follows what the operating
 * system asks for" — and a sampled-once read breaks that promise on the first
 * dashboard left open past sunset. Returns the unsubscribe, so the caller's
 * effect cleanup is the whole story; a `matchMedia` that does not exist yields
 * a no-op, the same safe direction the rest of this section documents.
 */
export function watchOsTheme(onChange: () => void): () => void {
  const query = globalThis.matchMedia?.(PREFERS_LIGHT);
  if (!query) return () => {};
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * What the operating system asked for, injected so a test can state it.
 *
 * `matchMedia` is optional on purpose: a jsdom-ish environment and an Electron
 * renderer disagree about whether it exists, and the safe direction to fail is
 * the one `applyTheme` already documents — no class, therefore dark.
 */
function osPrefersLight(): boolean {
  return globalThis.matchMedia?.(PREFERS_LIGHT).matches === true;
}

/** One spelling, shared by the sample and the subscription that follows it. */
const PREFERS_LIGHT = '(prefers-color-scheme: light)';

/**
 * Store what you dragged, clamped. Called on drag end and on the resize
 * chord — never on a mere render, which is what keeps clamping off the
 * write path (epic.md §4.2 point 2, AC-2(c)): a viewport change calls
 * `renderedWidth` to decide what to draw, never this.
 */
export function setPaneWidth(prefs: Prefs, pane: Pane, width: number): Prefs {
  return { ...prefs, panes: { ...prefs.panes, [pane]: clampPaneWidth(pane, width) } };
}

export function writePrefs(storage: StorageLike | null, prefs: Prefs): void {
  activatePrefs(prefs);
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Quota, or a browser that hands out a Storage and then refuses to use it.
    // The in-memory prefs still work for this session; only the memory is lost.
  }
}

/**
 * A null-prototype accumulator, safe to populate with `out[key] = value` even
 * when `key` is `__proto__` or `constructor`: a plain `{}` inherits
 * `Object.prototype`'s `__proto__` setter, which intercepts that assignment
 * and never creates an own property, so the entry silently fails to
 * enumerate and is dropped by `JSON.stringify`. An object with no prototype
 * has no such setter to intercept the assignment.
 */
function emptyMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** A copy of `map` with one entry added or replaced, still prototype-free. */
function withEntry<T>(map: Record<string, T>, key: string, value: T): Record<string, T> {
  const out = emptyMap<T>();
  for (const k of Object.keys(map)) {
    out[k] = map[k] as T;
  }
  out[key] = value;
  return out;
}

/** A copy of `map` with one entry removed, still prototype-free. */
function withoutEntry<T>(map: Record<string, T>, key: string): Record<string, T> {
  const out = emptyMap<T>();
  for (const k of Object.keys(map)) {
    if (k !== key) {
      out[k] = map[k] as T;
    }
  }
  return out;
}

/** An empty icon clears the choice rather than storing "". */
export function setIcon(
  prefs: Prefs,
  sourceId: SourceId,
  sessionId: string,
  icon: string,
  now: Date,
): Prefs {
  const bucket = prefs.icons[sourceId] ?? emptyMap<IconChoice>();
  const nextBucket =
    icon === ''
      ? withoutEntry(bucket, sessionId)
      : withEntry(bucket, sessionId, { icon, at: now.toISOString() });
  const icons =
    Object.keys(nextBucket).length > 0
      ? withEntry(prefs.icons, sourceId, nextBucket)
      : withoutEntry(prefs.icons, sourceId);
  return { ...prefs, icons };
}

/** An empty icon clears the project's choice, same as `setIcon`. */
export function setProjectIcon(
  prefs: Prefs,
  sourceId: SourceId,
  projectId: string,
  icon: string,
  now: Date,
): Prefs {
  const bucket = prefs.projectIcons[sourceId] ?? emptyMap<IconChoice>();
  const nextBucket =
    icon === ''
      ? withoutEntry(bucket, projectId)
      : withEntry(bucket, projectId, { icon, at: now.toISOString() });
  const projectIcons =
    Object.keys(nextBucket).length > 0
      ? withEntry(prefs.projectIcons, sourceId, nextBucket)
      : withoutEntry(prefs.projectIcons, sourceId);
  return { ...prefs, projectIcons };
}

/**
 * An empty title CLEARS the override, restoring the source's own name.
 *
 * That is the whole undo, and it is why the editor's empty string is not
 * treated as a bad input: a rename you cannot take back is worse than no
 * rename at all.
 */
export function setRename(
  prefs: Prefs,
  sourceId: SourceId,
  sessionId: string,
  title: string,
  now: Date,
): Prefs {
  const bucket = prefs.renames[sourceId] ?? emptyMap<RenameChoice>();
  const trimmed = title.trim();
  const nextBucket =
    trimmed === ''
      ? withoutEntry(bucket, sessionId)
      : withEntry(bucket, sessionId, { title: trimmed, at: now.toISOString() });
  const renames =
    Object.keys(nextBucket).length > 0
      ? withEntry(prefs.renames, sourceId, nextBucket)
      : withoutEntry(prefs.renames, sourceId);
  return { ...prefs, renames };
}

/**
 * Put the stored names onto the model, once, before anything reads it -- the
 * same trick `applyIcons` plays one field over, and for the same reason: the
 * sidebar, the canvas node and the detail panel all render `session.title`,
 * and none of them should have to know that a title can be local.
 */
export function applyRenames(model: CanvasModel, renames: Prefs['renames']): CanvasModel {
  if (Object.keys(renames).length === 0) {
    return model;
  }
  return {
    ...model,
    projects: model.projects.map((project) => {
      const bucket = project.source === undefined ? undefined : renames[project.source];
      if (bucket === undefined) {
        return project;
      }
      return {
        ...project,
        sessions: project.sessions.map((session) => {
          const choice = bucket[session.id];
          return choice === undefined ? session : { ...session, title: choice.title };
        }),
      };
    }),
  };
}

/**
 * Put the stored icons onto the model, once, before anything reads it.
 *
 * The sidebar and the canvas node both render `session.icon`, and neither
 * should know that an icon is a local preference rather than something the
 * factory said. Applying it here means one place knows. Looked up per
 * project's `source`, not by session id alone — two sources can name a
 * session the same thing (AC-1). `projectIcons` follows the same rule one
 * level up, and defaults to `{}` so every existing two-argument call site
 * (session icons only) still compiles.
 */
export function applyIcons(
  model: CanvasModel,
  icons: Prefs['icons'],
  projectIcons: Prefs['projectIcons'] = {},
): CanvasModel {
  if (Object.keys(icons).length === 0 && Object.keys(projectIcons).length === 0) {
    return model;
  }
  return {
    ...model,
    projects: model.projects.map((project) => {
      // A project with no source has no bucket to look one up in — the same
      // "cannot store under an unknown source" call `setIcon`'s caller makes.
      if (project.source === undefined) {
        return project;
      }
      const bucket = icons[project.source];
      const projectBucket = projectIcons[project.source];
      const projectChoice = projectBucket?.[project.id];
      const withIcon =
        projectChoice === undefined ? project : { ...project, icon: projectChoice.icon };
      if (bucket === undefined) {
        return withIcon;
      }
      return {
        ...withIcon,
        sessions: withIcon.sessions.map((session) => {
          const choice = bucket[session.id];
          return choice === undefined ? session : { ...session, icon: choice.icon };
        }),
      };
    }),
  };
}

function readMap<T>(value: unknown, read: (entry: unknown) => T | null): Record<string, T> {
  if (typeof value !== 'object' || value === null) {
    return emptyMap<T>();
  }
  const out = emptyMap<T>();
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const parsed = read(entry);
    if (parsed !== null) {
      out[key] = parsed;
    }
  }
  return out;
}

/**
 * Build the by-source icon map from whatever is under the stored `icons` key,
 * migrating the pre-AC-1 flat shape (`{sessionId: IconChoice}`) as it goes.
 *
 * Handles a payload holding both shapes at once (AC-5) — the case an operator
 * hits mid-upgrade with vam open in two tabs, one writing the old flat shape
 * and one already writing the new nested one to the same key. Each top-level
 * entry is inspected on its own: one that parses as an `IconChoice` is an old
 * flat entry keyed by session id, migrated into `migrateSource`'s bucket;
 * anything else is tried as a new-shape bucket (session id → `IconChoice`)
 * keyed by its own source id. Both merge into the same source's bucket.
 *
 * WHEN THEY CONTEND FOR THE SAME KEY, THE LATER `at` WINS. `migrateSource` is
 * a real source id, so a migrated flat entry and a genuine nested entry can
 * name the same session under the same source -- exactly what the two-tab
 * upgrade produces. An unconditional overwrite would make the survivor depend
 * on `Object.entries` order, which is to say on nothing, and would silently
 * drop an icon that exists nowhere else. An unparseable `at` sorts oldest, so
 * a readable choice always beats an unreadable one; if neither parses the
 * first seen is kept, because there is nothing to prefer it by.
 */
/** Milliseconds for ordering; an unreadable date sorts oldest and never wins. */
function ageOf(choice: IconChoice): number {
  const t = Date.parse(choice.at);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Add `choice` at `sid` unless something strictly newer is already there. */
function keepNewer(
  bucket: Record<string, IconChoice>,
  sid: string,
  choice: IconChoice,
): Record<string, IconChoice> {
  const existing = bucket[sid];
  if (existing !== undefined && ageOf(existing) >= ageOf(choice)) {
    return bucket;
  }
  return withEntry(bucket, sid, choice);
}

function readIcons(raw: unknown, migrateSource: SourceId): Prefs['icons'] {
  if (typeof raw !== 'object' || raw === null) {
    return emptyMap<IconsBySession>();
  }
  let outer = emptyMap<IconsBySession>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const flatLeaf = readIcon(value);
    if (flatLeaf !== null) {
      const bucket = outer[migrateSource] ?? emptyMap<IconChoice>();
      outer = withEntry(outer, migrateSource, keepNewer(bucket, key, flatLeaf));
      continue;
    }
    const nested = readMap(value, readIcon);
    if (Object.keys(nested).length === 0) {
      continue;
    }
    let bucket = outer[key] ?? emptyMap<IconChoice>();
    for (const [sid, choice] of Object.entries(nested)) {
      bucket = keepNewer(bucket, sid, choice);
    }
    outer = withEntry(outer, key, bucket);
  }
  return outer;
}

/** `fresh` applied per source, dropping a source whose bucket becomes empty. */
function pruneBuckets<T extends { at: string }>(
  buckets: Readonly<Record<string, Readonly<Record<string, T>>>>,
  cutoff: string,
): Readonly<Record<string, Readonly<Record<string, T>>>> {
  let out = emptyMap<Readonly<Record<string, T>>>();
  for (const [source, bucket] of Object.entries(buckets)) {
    const kept = fresh(bucket, cutoff);
    if (Object.keys(kept).length > 0) {
      out = withEntry(out, source, kept);
    }
  }
  return out;
}

/** One level of `readMap`, per source -- `readProjectIcons` generalised. */
function readBuckets<T>(
  raw: unknown,
  read: (entry: unknown) => T | null,
): Readonly<Record<string, Readonly<Record<string, T>>>> {
  if (typeof raw !== 'object' || raw === null) {
    return emptyMap<Readonly<Record<string, T>>>();
  }
  const out = emptyMap<Readonly<Record<string, T>>>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const nested = readMap(value, read);
    if (Object.keys(nested).length > 0) {
      out[key] = nested;
    }
  }
  return out;
}

function readRename(entry: unknown): RenameChoice | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }
  const { title, at } = entry as { title?: unknown; at?: unknown };
  if (typeof title !== 'string' || title === '' || typeof at !== 'string') {
    return null;
  }
  return { title, at };
}

function readIcon(entry: unknown): IconChoice | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }
  const { icon, at } = entry as { icon?: unknown; at?: unknown };
  if (typeof icon !== 'string' || icon === '' || typeof at !== 'string') {
    return null;
  }
  return { icon, at };
}

/**
 * Drop what has gone stale. An entry with an unreadable date is kept, not
 * dropped: "I cannot tell how old this is" is not a reason to throw away
 * something the person arranged on purpose.
 */
function fresh<T extends { at: string }>(
  map: Record<string, T>,
  cutoff: string,
): Record<string, T> {
  const out = emptyMap<T>();
  for (const [key, entry] of Object.entries(map)) {
    if (Number.isNaN(Date.parse(entry.at)) || entry.at >= cutoff) {
      out[key] = entry;
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * The appearance override layer.
 * ------------------------------------------------------------------------ */

export type PaletteOverrides = Readonly<Record<string, string>>;

/**
 * The colours the operator may adjust — TEN of about thirty, chosen rather
 * than enumerated.
 *
 * Two families, because they are the two that change the app's character: the
 * surfaces you look at all day (canvas, panel, sidebar, raised) with the ink
 * that has to stay readable on them, and the status family (running, waiting,
 * done, failed) plus the cursor ring, which is what a glance at the canvas is
 * actually reading.
 *
 * The rest are deliberately NOT here, and the reason is the same for all of
 * them: they are measured against these. The tints and washes
 * (`--vam-waiting-tint`, `--vam-done-tint`), the four line weights, the dimmer
 * inks, and the diff and syntax colours are each chosen for contrast against a
 * surface — styles.css says so at the point it defines them — so a picker that
 * moved one alone would produce an unreadable pair with no way to see it
 * coming. `--vam-shadow-node` is not a colour at all, it is a shadow.
 *
 * No default value is stored here, and that is the design rather than an
 * omission: an unset token falls through to whichever half of the stylesheet's
 * light/dark pair is in force, so one override does not freeze the other theme.
 */
export const PALETTE_TOKENS: readonly { readonly token: string; readonly label: string }[] = [
  { token: '--vam-canvas', label: 'canvas' },
  { token: '--vam-panel', label: 'panel' },
  { token: '--vam-sidebar', label: 'sidebar' },
  { token: '--vam-raised', label: 'raised' },
  { token: '--vam-ink', label: 'text' },
  { token: '--vam-running', label: 'running' },
  { token: '--vam-waiting', label: 'waiting' },
  { token: '--vam-cursor-ring', label: 'cursor ring' },
  { token: '--vam-done', label: 'done' },
  { token: '--vam-failed', label: 'failed' },
];

const PALETTE_KEYS = new Set(PALETTE_TOKENS.map((entry) => entry.token));

/**
 * What may be written into a custom property.
 *
 * Six digits and nothing else — which is exactly what an `<input type="color">`
 * produces, so the narrow rule costs the operator nothing. It is not decoration:
 * a custom property is injected into the page's own styles, and a value like
 * `red; --something: else` would be a stylesheet the operator did not write.
 */
const COLOUR = /^#[0-9a-f]{6}$/i;

function readPalette(raw: unknown): PaletteOverrides {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const out = emptyMap<string>();
  for (const [token, value] of Object.entries(raw as Record<string, unknown>)) {
    // Per entry, like every other reader here: one hand-edited colour cannot
    // drag the others back to the stylesheet with it.
    if (PALETTE_KEYS.has(token) && typeof value === 'string' && COLOUR.test(value)) {
      out[token] = value;
    }
  }
  return out;
}

function readKeyBindings(raw: unknown): KeyBindings {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const out = emptyMap<readonly string[]>();
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      continue;
    }
    const keys = value.filter((key): key is string => typeof key === 'string' && key !== '');
    // A payload claiming three keys for one action is trimmed rather than
    // dropped: the operator's first two choices are still their choices.
    out[id] = keys.slice(0, MAX_BINDINGS);
  }
  return out;
}

/** One colour chosen. A token vam does not offer, or a value that is not a
 *  colour, changes nothing — the picker cannot produce either, and a caller
 *  that does has a bug rather than a preference. */
export function setPaletteColor(prefs: Prefs, token: string, value: string): Prefs {
  if (!PALETTE_KEYS.has(token) || !COLOUR.test(value)) {
    return prefs;
  }
  return { ...prefs, palette: withEntry({ ...prefs.palette }, token, value) };
}

/** Back to the stylesheet for one token — by DELETING the override. Writing
 *  today's value back would look identical on screen and would freeze that
 *  colour against the other theme forever. */
export function clearPaletteColor(prefs: Prefs, token: string): Prefs {
  return { ...prefs, palette: withoutEntry({ ...prefs.palette }, token) };
}

/** Back to the stylesheet for all of them. */
export function clearPalette(prefs: Prefs): Prefs {
  return { ...prefs, palette: {} };
}

/** Written by the shortcut editor; validated on the way back in by
 *  `readKeyBindings`, the same as every other stored field. */
export function setKeyBindings(prefs: Prefs, keyBindings: KeyBindings): Prefs {
  return { ...prefs, keyBindings };
}

/**
 * Put the overrides on the document, as custom properties on the root.
 *
 * Every offered token is visited, not only the overridden ones, because the
 * unset ones are what a reset produces: the property is REMOVED, and the
 * cascade falls back to the `:root` / `html.light` pair in styles.css. Setting
 * a token to its current value instead would be indistinguishable on screen
 * and would quietly survive a theme change.
 */
export function applyPalette(
  overrides: PaletteOverrides,
  root: HTMLElement | null = globalThis.document?.documentElement ?? null,
): void {
  if (root === null) {
    return;
  }
  for (const { token } of PALETTE_TOKENS) {
    const value = overrides[token];
    if (value === undefined) {
      root.style.removeProperty(token);
    } else {
      root.style.setProperty(token, value);
    }
  }
}

/**
 * The seam between "stored" and "in force", called on every read and write.
 *
 * Both halves are side effects on things React does not own — the document's
 * root element and the chord reducer's module state — so they cannot be
 * expressed as rendered output. Returning `prefs` unchanged keeps the call
 * sites one expression each.
 */
/** The custom property `out`'s root size is read from. Named rather than
 *  spelled twice: a typo in either half is a setting that silently does
 *  nothing. */
export const OUT_FONT_SIZE_VAR = '--vam-out-font-size';

/** Put the chosen size on the document, as a custom property on the root —
 *  the mechanism the colour overrides use, for the same reason: the pane that
 *  consumes it is not re-rendered by a React value, and `:root` is in force
 *  everywhere with no prop drilled through `DetailPanel`. Clamped here too,
 *  this being the last gate before the DOM. */
export function applyOutFontSize(
  size: number,
  root: HTMLElement | null = globalThis.document?.documentElement ?? null,
): void {
  root?.style.setProperty(OUT_FONT_SIZE_VAR, `${clampOutFontSize(size)}px`);
}

export function activatePrefs(prefs: Prefs): Prefs {
  applyPalette(prefs.palette);
  applyOutFontSize(prefs.outFontSize);
  setActiveBindings(prefs.keyBindings);
  setActiveProvider(prefs.defaultProvider);
  return prefs;
}

/** What the colour picker should show for a token: the operator's override, or
 *  the value the stylesheet is currently giving that token, or nothing at all.
 *  The read is injected so a test can state it — and so a document that has no
 *  cascade to consult (a node environment) costs an empty string, not a throw. */
export function paletteValue(
  overrides: PaletteOverrides,
  token: string,
  read: (token: string) => string = readComputedToken,
): string {
  const chosen = overrides[token];
  if (chosen !== undefined) {
    return chosen;
  }
  // Trimmed HERE rather than only in the default reader: an injected one is
  // still a stylesheet value, and a leading space is not a different colour.
  const current = read(token).trim();
  // Only a plain six-digit colour can go into a colour input. A token defined
  // as anything else is shown as empty rather than as a value the input would
  // silently rewrite.
  return COLOUR.test(current) ? current : '';
}

function readComputedToken(token: string): string {
  const root = globalThis.document?.documentElement ?? null;
  if (root === null || globalThis.getComputedStyle === undefined) {
    return '';
  }
  return globalThis.getComputedStyle(root).getPropertyValue(token);
}
