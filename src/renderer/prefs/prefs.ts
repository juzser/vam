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

import type { CanvasModel, SourceId } from '../domain/model.js';
import { DEFAULT_SESSION_FILTERS, type SessionFilters } from '../domain/session-filter.js';
import {
  ALL_VISIBLE,
  clampPaneWidth,
  DEFAULT_PANES,
  LAYOUTS,
  type LayoutName,
  type Pane,
  type PaneVisibility,
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
export type Theme = 'dark' | 'light';

/** Dark is the default: it is the theme vam was designed in (artboard 1a). */
export const DEFAULT_THEME: Theme = 'dark';

/** Session id → the emoji you gave it, for one source. */
export type IconsBySession = Readonly<Record<string, IconChoice>>;

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
  readonly paneVisibility: PaneVisibility;
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
   * Source id → session id → the name you gave it. Same keying, storage and
   * TTL as `icons`, for the same reasons -- and the TTL applies for one more:
   * a name for a session that stopped existing months ago is not worth
   * keeping either.
   */
  readonly renames: Readonly<Record<string, Readonly<Record<string, RenameChoice>>>>;
};

export const EMPTY_PREFS: Prefs = {
  icons: {},
  theme: DEFAULT_THEME,
  panes: DEFAULT_PANES,
  paneVisibility: ALL_VISIBLE,
  projectIcons: {},
  filters: DEFAULT_SESSION_FILTERS,
  collapsedProjects: {},
  renames: {},
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

export function readPrefs(
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
    renames?: unknown;
  };
  const cutoff = new Date(now.getTime() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return {
    icons: pruneBuckets(readIcons(record.icons, migrateSource), cutoff),
    // Not pruned by the TTL icons get. A theme is about the person, and one
    // who opens vam twice a year still wants the theme they chose.
    theme: readTheme((parsed as { theme?: unknown }).theme),
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
    collapsedProjects: readCollapsed(record.collapsedProjects),
    // Same TTL and same shape as the icons above; a payload written before
    // this field existed simply has none, and reads as `{}`.
    renames: pruneBuckets(readBuckets(record.renames, readRename), cutoff),
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
function readCollapsed(raw: unknown): Prefs['collapsedProjects'] {
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
export function setProjectCollapsed(
  prefs: Prefs,
  source: string,
  projectId: string,
  collapsed: boolean,
): Prefs {
  const bucket = prefs.collapsedProjects[source] ?? [];
  const next = collapsed
    ? bucket.includes(projectId)
      ? bucket
      : [...bucket, projectId]
    : bucket.filter((id) => id !== projectId);
  const collapsedProjects =
    next.length > 0
      ? withEntry(prefs.collapsedProjects as Record<string, readonly string[]>, source, next)
      : withoutEntry(prefs.collapsedProjects as Record<string, readonly string[]>, source);
  return { ...prefs, collapsedProjects };
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
  return raw === 'light' || raw === 'dark' ? raw : DEFAULT_THEME;
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
 * fail is showing a pane you wanted hidden, never hiding one you did not. */
function readPaneVisibility(raw: unknown): PaneVisibility {
  const { sidebar, canvas, detail } = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    sidebar?: unknown;
    canvas?: unknown;
    detail?: unknown;
  };
  return {
    sidebar: sidebar !== false,
    canvas: canvas !== false,
    detail: detail !== false,
  };
}

/** Written by the layout chords. */
export function setPaneVisibility(prefs: Prefs, paneVisibility: PaneVisibility): Prefs {
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

/** Flip it. Written by the sidebar's one toggle. */
export function setTheme(prefs: Prefs, theme: Theme): Prefs {
  return { ...prefs, theme };
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
): void {
  root?.classList.toggle('light', theme === 'light');
}

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
