/**
 * The two things that are yours rather than the factory's.
 *
 * §3 already decided this and the code had not caught up: "draggable and
 * remembers position. Position is saved per user, **and does not go into
 * the event log**." Where you dragged a card and which emoji you put on a
 * session are facts about how you like to look at the work — they are not
 * facts about the work, so they must not become events. The factory is right
 * to have no route for them, and vam was wrong to answer "the factory
 * doesn't store icons" as though that settled it.
 * Nobody asked the factory. This is the browser's job.
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
import { clampPaneWidth, DEFAULT_PANES, type Pane } from './panes.js';
import { DEFAULT_FOCUS_VIEW, readFocusView, setActiveFocusView } from './progress.js';
import {
  DEFAULT_PROMPT_SUBMIT_KEY,
  type PromptSubmitKey,
  readPromptSubmitKey,
  setActivePromptSubmitKey,
} from './submit-key.js';

const KEY = 'vam.prefs.v1';

/**
 * A FIELD THAT WAS RETIRED, AND WHY IT NEEDED NO MIGRATION.
 *
 * `dismissedSessions` shipped in PR 248: a field here, a reader branch, a
 * source-key migration, a TTL exemption, three exported helpers
 * (`isSessionDismissed`, `setSessionDismissed`, `applySessionDismissals`) and
 * its own test file — and no caller anywhere in `src/`. No surface ever
 * dismissed a row and no model was ever filtered by one. Its doc described,
 * in the present tense, a capability the operator did not have.
 *
 * SO NOTHING IS BEING TAKEN FROM ANYBODY, and that is the difference from
 * `RETIRED_TOKENS` and `LEGACY_GROUND_TOKEN` further down, which are read,
 * written back and applied precisely because an operator CAN have a value
 * under them. There was no write path here to produce a stored
 * `dismissedSessions` at all: `readPrefs` builds an explicit object field by
 * field, so a key nobody wrote is a key nobody reads, and the next write
 * simply does not carry it.
 *
 * The problem it was built for is real and is still open: a background row a
 * source reports `done`/`failed` has no job left to close, so `closeSession`
 * refuses it forever (`stop.ts`'s `already-finished`) and the row sits in the
 * sidebar for up to `BACKGROUND_WINDOW_MS` (`agents.ts`: 14 days). Solving it
 * needs an affordance on the row and a route back — a stored list on its own
 * was never the hard half, and keeping the unused half was not progress
 * toward the other one. `test/prefs/prefs.no-write-only-field.test.ts` is what
 * stops the next one shipping the same way.
 */

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

/** The root text size of the `out` pane, in px.
 *
 *  It was 12 to match `styles.css`'s `body { font-size: 12px }`, which `out`
 *  inherited -- so that merely SHIPPING the setting resized nobody's pane.
 *  That reasoning was about the moment the setting landed, and it has served
 *  its purpose: 13 is now a deliberate choice about reading agent output for
 *  hours, not an accident of inheritance. `out` is the pane an operator reads
 *  most and the one whose text is densest, and the operator asked for a point
 *  more.
 *
 *  It moves for everyone who never touched the picker, which is the intent.
 *  Anyone who DID choose a size keeps it: a stored value is read back and
 *  clamped, and this default is only consulted when there is none. */
export const DEFAULT_OUT_FONT_SIZE = 13;

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

/**
 * One group as it is written to `localStorage`.
 *
 * DELIBERATELY NOT `Group` from `domain/model.ts`: that one carries resolved
 * `Project` objects, which are derived from live sessions and must never be
 * persisted -- storing them would freeze a session list into the prefs file
 * and make it wrong within the minute. This carries member ids and nothing
 * else, and the model's `Group` is rebuilt from it on each poll.
 *
 * `id` is minted by the caller and derived from nothing: a group has no cwd to
 * digest, has to survive a rename, and has to exist while it holds nothing.
 */
export type StoredGroup = {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly projects: readonly string[];
};

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
   * Source id → project id → the name you gave that project's heading, or
   * nothing for "use the source's own name".
   *
   * Same idiom as `projectIcons`, one field over rather than one level up:
   * both are keyed `sourceId → projectId → …` for the same reason -- a
   * project id is unique only within its source. The leaf is `RenameChoice`
   * (`{title, at}`), the same shape `renames` already uses one level up, not
   * `IconChoice`: this is a name, not a glyph. Same TTL as `renames` and
   * `projectIcons`, for the same reason a name for a project nobody has
   * touched in thirty days is not worth keeping either. There is no legacy
   * flat shape to migrate here, exactly like `projectIcons` -- this key never
   * shipped before this field existed.
   *
   * The project's `id` is never touched by a rename here, on purpose: icons,
   * collapse state, group membership and hidden-project state all key off it,
   * and a rename that changed it would orphan every one of them.
   */
  readonly projectNames: Readonly<Record<string, Readonly<Record<string, RenameChoice>>>>;
  /**
   * Source id → project id → the DIRECTORY vam asks GitHub from for that
   * project's sessions. Absent everywhere by default.
   *
   * THE PROBLEM IT SOLVES. A session started from an orchestrator or a factory
   * runs in that factory's directory, so `pull-requests.ts` -- which asks `gh`
   * from the session's own cwd, deliberately and with no `--repo` -- reports
   * the factory's pull requests while the work is in another repository
   * entirely. The operator asked for a way to point it.
   *
   * PER PROJECT, BECAUSE A PROJECT IS A CWD. The README states it: "there is
   * no stored project in vam: a project is live sessions grouped by their
   * cwd." The thing being corrected here IS that cwd, so the correction
   * belongs at the same grain. Per session it would let two sessions with an
   * identical cwd disagree about which repository that cwd is, which is not
   * inconvenient but incoherent.
   *
   * A DIRECTORY, NEVER AN `owner/name`. `pull-requests.ts` runs `gh` with no
   * `--repo` on purpose: "naming a repository here would let a session's pane
   * describe a repository the session is not in." A directory keeps that true
   * -- `gh` still resolves the remote itself -- and only moves where vam
   * stands to ask.
   *
   * TWO LEVELS for `projectNames`' reason: a project id is unique only within
   * its source. Exempt from the icon TTL like `projectNames` is not: an
   * override is about a directory on this machine, and the project it names
   * can go quiet for a month without the operator's choice becoming wrong.
   */
  readonly prRepos: Readonly<Record<string, Readonly<Record<string, string>>>>;
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
   * Source id → the groups the operator made in that source, in the order
   * they were made. UI "project"; see the vocabulary table in
   * `domain/model.ts` for why the code's word for it is `Group`.
   *
   * THE ONLY STORED HALF OF THE GROUP LAYER, and the only stored thing in vam
   * that is not derivable from a poll: a project comes back from the cwd of a
   * live session, a grouping comes back from nowhere. Keyed by source like the
   * three buckets above, and for the same reason -- a project id is unique
   * only within its source, so a flat list would let one source's group claim
   * another's project.
   *
   * Members are project IDS, never paths, so nothing here can name a directory
   * that has moved. A member id is KEPT even when no live project matches it:
   * that is what makes a grouping survive the operator closing the last
   * session in one of its projects. Exempt from the icon TTL, like the fold
   * and the removal above -- it records a decision a person made.
   */
  readonly groups: Readonly<Record<string, readonly StoredGroup[]>>;
  /**
   * Source id → the ids of that source's groups you folded shut. Exactly
   * `collapsedProjects`, one level up, with the same list-not-booleans shape
   * and the same TTL exemption.
   */
  readonly collapsedGroups: Readonly<Record<string, readonly string[]>>;
  /**
   * Source id → session id → the name you gave it. Same keying, storage and
   * TTL as `icons`, for the same reasons -- and the TTL applies for one more:
   * a name for a session that stopped existing months ago is not worth
   * keeping either.
   */
  readonly renames: Readonly<Record<string, Readonly<Record<string, RenameChoice>>>>;
  /**
   * The colours the operator chose, ONE SET PER THEME — dark's and light's,
   * each a token → colour map for the few tokens vam offers.
   *
   * Per theme because a colour is only ever chosen against the theme that was
   * on screen at the time. While this was one flat map, a canvas colour picked
   * at night was forced onto the light theme as well, where it could be
   * unreadable, and there was no way to say so.
   *
   * An OVERRIDE LAYER still, and per theme it is one twice over: an absent
   * token is not a stored default, it is "whatever styles.css says for the
   * theme you are in", so a partial override keeps that theme's half of the
   * light/dark pair working and a reset is a deletion rather than a write.
   * Exempt from the icon TTL for the reason `theme` is: it describes the
   * person.
   */
  readonly palette: ThemePalettes;
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
  /**
   * Which tab the detail pane was showing, as an OPAQUE STRING.
   *
   * Opaque on purpose, and it is the one design decision in this field. The
   * list of tabs lives in `DetailPanel.tsx` next to the bar that draws it,
   * because a second idea of how many tabs there are is a bug waiting for a
   * fifth digit. Importing that list here to validate against would drag a
   * React component into a module whose whole job is `localStorage`, so the
   * dependency runs the other way: the store keeps whatever string it was
   * given, and the pane -- which owns the list -- decides on read whether that
   * string still names a tab and falls back to its default when it does not.
   * A tab renamed or withdrawn between versions therefore costs one default
   * tab, not a migration.
   *
   * Exempt from the icon TTL for the reason `theme` is: which tab you read
   * first is a fact about you, not about a session.
   */
  readonly detailTab: string | null;
  /**
   * How much of each turn's working the transcript column draws — `shown` or
   * `collapsed`. See `progress.ts` for what the two differ by and for the one
   * thing `collapsed` may never fold away.
   *
   * GLOBAL, not per pane and not per session, and the argument is about what
   * the operator is choosing. This is a reading preference — how densely they
   * want a transcript to read — the same kind of fact as `theme` and
   * `outFontSize`, both of which are one value for the whole app. Per pane it
   * would be an arrangement rather than a preference, and one the operator
   * would have to re-make on every split (`Canvas.tsx` mounts a fresh
   * `DetailPanel` per leaf, and a pane opened by a keystroke has no dialogue
   * in which to be asked). Per session it would be worse: it would key a
   * display choice to a session id, which the TTL prunes and which
   * `lastFocus`'s own note explains cannot be relied on to keep meaning.
   *
   * Exempt from the icon TTL for the reason `theme` is: it describes the
   * person, not a session that stopped existing.
   */
  readonly focusView: boolean;
  /**
   * Which key in the prompt box sends the draft — `enter` or `shift-enter`.
   * The other one takes a newline; see `submit-key.ts` for why the two swap
   * together and why this is a named pair rather than a boolean.
   *
   * GLOBAL, for the reason `focusView` is: there is one composer idiom and
   * an operator's hands do not change between panes. Per pane it would be an
   * arrangement they had to re-make on every split; per session it would key a
   * habit to an id the TTL prunes.
   *
   * Exempt from the icon TTL like `theme` and `panes`: it describes the
   * person, not a session that stopped existing.
   */
  readonly promptSubmitKey: PromptSubmitKey;
};

export const EMPTY_PREFS: Prefs = {
  icons: {},
  theme: DEFAULT_THEME,
  panes: DEFAULT_PANES,
  projectIcons: {},
  projectNames: {},
  prRepos: {},
  filters: DEFAULT_SESSION_FILTERS,
  collapsedProjects: {},
  hiddenProjects: {},
  groups: {},
  collapsedGroups: {},
  renames: {},
  palette: { dark: {}, light: {} },
  keyBindings: {},
  outFontSize: DEFAULT_OUT_FONT_SIZE,
  defaultProvider: DEFAULT_PROVIDER_ID,
  lastFocus: null,
  detailTab: null,
  focusView: DEFAULT_FOCUS_VIEW,
  promptSubmitKey: DEFAULT_PROMPT_SUBMIT_KEY,
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
  migrateSource: SourceId = 'factory',
): Prefs {
  return activatePrefs(parsePrefs(storage, now, migrateSource));
}

function parsePrefs(
  storage: StorageLike | null,
  now: Date = new Date(),
  migrateSource: SourceId = 'factory',
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
    projectIcons?: unknown;
    projectNames?: unknown;
    prRepos?: unknown;
    filters?: unknown;
    collapsedProjects?: unknown;
    hiddenProjects?: unknown;
    groups?: unknown;
    collapsedGroups?: unknown;
    renames?: unknown;
  };
  const cutoff = new Date(now.getTime() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return {
    // `migrateSourceKey` runs BEFORE `pruneBuckets`: it only reshuffles which
    // source a bucket sits under, and the TTL cutoff is evaluated per entry
    // regardless, so the order does not change what survives -- but pruning
    // the merged, current-named picture reads as the one true timeline rather
    // than two half-histories pruned separately then stitched together.
    icons: pruneBuckets(
      migrateSourceKey(
        readIcons(record.icons, migrateSource),
        LEGACY_HTTP_SOURCE_ID,
        migrateSource,
        mergeTimestamped,
      ),
      cutoff,
    ),
    // Not pruned by the TTL icons get. A theme is about the person, and one
    // who opens vam twice a year still wants the theme they chose.
    theme: readTheme((parsed as { theme?: unknown }).theme),
    // Same argument as theme: not pruned, and defensive against an absent
    // field (today's shipped payloads have none), a non-object, or garbage
    // numbers left by devtools or an older vam.
    panes: readPanes(record.panes),
    // Same TTL as session icons, same reasoning: a project's glyph is not
    // worth remembering forever either. Same old-id migration too -- a
    // project's glyph is keyed by source exactly like a session's is.
    projectIcons: pruneBuckets(
      migrateSourceKey(
        readProjectIcons(record.projectIcons),
        LEGACY_HTTP_SOURCE_ID,
        migrateSource,
        mergeTimestamped,
      ),
      cutoff,
    ),
    // Same TTL and shape as `renames`, one field over rather than one level
    // up -- see the field's own comment. `readBuckets` rather than a
    // dedicated `readProjectNames`: every top-level entry here is already
    // `projectId → RenameChoice`, exactly what `readBuckets` already reads
    // for `renames`, so there is no flat legacy shape of its own to special-
    // case the way `readIcons` does for `icons`.
    projectNames: pruneBuckets(
      migrateSourceKey(
        readBuckets(record.projectNames, readRename),
        LEGACY_HTTP_SOURCE_ID,
        migrateSource,
        mergeTimestamped,
      ),
      cutoff,
    ),
    // NOT PRUNED, unlike `projectNames` directly above, and the difference is
    // the field's meaning rather than an oversight: the icon TTL exists to
    // stop the store keeping rows for sessions that stopped existing, and an
    // override is a fact about a DIRECTORY on this machine. A project that
    // goes quiet for a month has not made the operator's choice wrong, and
    // expiring it would silently point the pane back at the factory.
    prRepos: readBuckets(record.prRepos, readRepoPath),
    // Same argument again: not pruned, and per-field defensive so one garbage
    // toggle cannot drag the other back to its default with it.
    filters: readFilters(record.filters),
    // Not pruned either, and per-source defensive: one garbage bucket cannot
    // unfold the projects another source folded. Old-id migrated like every
    // other source-keyed field: a fold made under the old id is still a fold.
    collapsedProjects: migrateSourceKey(
      readIdsBySource(record.collapsedProjects),
      LEGACY_HTTP_SOURCE_ID,
      migrateSource,
      mergeIdLists,
    ),
    // Per field and per source like the fold above it: a payload from a vam
    // that predates removal has no key, and reads back as "nothing removed".
    hiddenProjects: migrateSourceKey(
      readIdsBySource(record.hiddenProjects),
      LEGACY_HTTP_SOURCE_ID,
      migrateSource,
      mergeIdLists,
    ),
    // Per field and per source again, and NOT pruned by the TTL: every store
    // in existence predates the group layer and has neither key, which reads
    // back as "no groups" -- the state the whole app already renders.
    groups: migrateSourceKey(
      readGroups(record.groups),
      LEGACY_HTTP_SOURCE_ID,
      migrateSource,
      mergeGroups,
    ),
    collapsedGroups: migrateSourceKey(
      readIdsBySource(record.collapsedGroups),
      LEGACY_HTTP_SOURCE_ID,
      migrateSource,
      mergeIdLists,
    ),
    // Same TTL and same shape as the icons above; a payload written before
    // this field existed simply has none, and reads as `{}`. Old-id migrated
    // the same way, off the same `{ at }` shape `IconChoice` has.
    renames: pruneBuckets(
      migrateSourceKey(
        readBuckets(record.renames, readRename),
        LEGACY_HTTP_SOURCE_ID,
        migrateSource,
        mergeTimestamped,
      ),
      cutoff,
    ),
    // Per field like everything above it: a payload from a vam that predates
    // either of these has no key at all, and reads back as "no overrides" —
    // the shipped palette and the shipped chords — without touching a
    // neighbour.
    palette: readPalettes((parsed as { palette?: unknown }).palette),
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
    // migration otherwise. Not pruned; see the field's own note for why the
    // TTL would buy nothing here. The pointer's `source` is still migrated
    // off the old id -- a focus recorded under `black-smith` should still
    // resolve, not silently fail to match any session on screen.
    lastFocus: migrateLastFocusSource(
      readLastFocus((parsed as { lastFocus?: unknown }).lastFocus),
      LEGACY_HTTP_SOURCE_ID,
      migrateSource,
    ),
    // Per field again, and deliberately NOT validated here -- see the field.
    // Anything that is not a string is "no tab remembered", which is what a
    // payload from a vam predating this field already says by having no key.
    detailTab: readDetailTab((parsed as { detailTab?: unknown }).detailTab),
    // Per field like every line above it, and normalised rather than merely
    // defaulted: a value this vam cannot read must come back as the mode that
    // hides nothing. `readFocusView` is where that direction is argued -- and
    // where the retired `turnProgress` word is carried across, which is why
    // BOTH keys are handed to it rather than only the new one.
    focusView: readFocusView(
      (parsed as { focusView?: unknown }).focusView,
      (parsed as { turnProgress?: unknown }).turnProgress,
    ),
    // Per field like every line above it, and normalised rather than merely
    // defaulted, in the one safe direction: a word this vam has no mode for
    // must read back as the key the box has always sent on. `readPromptSubmitKey`
    // is where that direction is argued.
    promptSubmitKey: readPromptSubmitKey((parsed as { promptSubmitKey?: unknown }).promptSubmitKey),
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

/**
 * Every level defensive, like `readIdsBySource` above it: a non-array bucket
 * is dropped whole, and a group missing an id or a name is dropped alone so
 * one bad record cannot cost the operator every other group in that source. A
 * non-string member id goes the same way -- dropped by itself, because the
 * remaining members are still a grouping the operator made.
 */
function readGroups(raw: unknown): Readonly<Record<string, readonly StoredGroup[]>> {
  if (typeof raw !== 'object' || raw === null) {
    return emptyMap<readonly StoredGroup[]>();
  }
  const out = emptyMap<readonly StoredGroup[]>();
  for (const [source, bucket] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(bucket)) {
      continue;
    }
    const groups = bucket.map(readGroup).filter((group): group is StoredGroup => group !== null);
    if (groups.length > 0) {
      out[source] = groups;
    }
  }
  return out;
}

function readGroup(raw: unknown): StoredGroup | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { id, name, icon, projects } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || id === '' || typeof name !== 'string') {
    return null;
  }
  const members = Array.isArray(projects)
    ? projects.filter((each): each is string => typeof each === 'string')
    : [];
  return typeof icon === 'string' && icon !== ''
    ? { id, name, icon, projects: members }
    : { id, name, projects: members };
}

/** Is this source's group folded shut? */
export function isGroupCollapsed(prefs: Prefs, source: string, groupId: string): boolean {
  return prefs.collapsedGroups[source]?.includes(groupId) === true;
}

/** Fold or unfold one group -- `setProjectCollapsed`, one level up. */
export function setGroupCollapsed(
  prefs: Prefs,
  source: string,
  groupId: string,
  collapsed: boolean,
): Prefs {
  return {
    ...prefs,
    collapsedGroups: withIdBySource(prefs.collapsedGroups, source, groupId, collapsed),
  };
}

/**
 * Rewrite one source's groups, dropping the bucket when nothing is left.
 *
 * The empty-bucket rule is `withIdBySource`'s, for its reason: a store whose
 * last group was dissolved then reads back identical to a fresh install, with
 * no empty object left behind to be mistaken for a group layer in use.
 */
function withGroups(
  prefs: Prefs,
  source: string,
  next: (groups: readonly StoredGroup[]) => readonly StoredGroup[],
): Prefs {
  const bucket = prefs.groups[source] ?? [];
  const updated = next(bucket);
  const groups =
    updated.length > 0
      ? withEntry(prefs.groups as Record<string, readonly StoredGroup[]>, source, updated)
      : withoutEntry(prefs.groups as Record<string, readonly StoredGroup[]>, source);
  return { ...prefs, groups };
}

/** One group, edited in place; a group id that is not there changes nothing. */
function withGroup(
  prefs: Prefs,
  source: string,
  groupId: string,
  edit: (group: StoredGroup) => StoredGroup,
): Prefs {
  return withGroups(prefs, source, (groups) =>
    groups.some((group) => group.id === groupId)
      ? groups.map((group) => (group.id === groupId ? edit(group) : group))
      : groups,
  );
}

/**
 * A new, empty group. `id` is minted by the caller -- see `StoredGroup.id`.
 *
 * Empty is a legitimate state, not a transient one: the operator names a group
 * before they have anything to put in it, and a group that deleted itself the
 * moment its last project left would take the name with it.
 */
export function createGroup(prefs: Prefs, source: string, id: string, name: string): Prefs {
  return withGroups(prefs, source, (groups) =>
    groups.some((group) => group.id === id) ? groups : [...groups, { id, name, projects: [] }],
  );
}

export function renameGroup(prefs: Prefs, source: string, groupId: string, name: string): Prefs {
  return withGroup(prefs, source, groupId, (group) => ({ ...group, name }));
}

/** An empty icon clears the choice rather than storing "", as `setIcon` does. */
export function setGroupIcon(
  prefs: Prefs,
  source: string,
  groupId: string,
  icon: string | null,
): Prefs {
  return withGroup(prefs, source, groupId, ({ icon: _dropped, ...group }) =>
    icon === null || icon === '' ? group : { ...group, icon },
  );
}

/**
 * Put a project in a group, MOVING it out of any group it was already in.
 *
 * At most one group per project, and it is enforced here rather than left to
 * the caller because the cost of getting it wrong is not cosmetic: membership
 * is array position, so a project in two groups has its sessions walked twice
 * and mints two nodes carrying the same `info:<sessionId>` id -- which breaks
 * the canvas and the keys `j`/`k` step through.
 */
export function addProjectToGroup(
  prefs: Prefs,
  source: string,
  groupId: string,
  projectId: string,
): Prefs {
  return withGroups(prefs, source, (groups) =>
    groups.some((group) => group.id === groupId)
      ? groups.map((group) =>
          group.id === groupId
            ? group.projects.includes(projectId)
              ? group
              : { ...group, projects: [...group.projects, projectId] }
            : { ...group, projects: group.projects.filter((each) => each !== projectId) },
        )
      : groups,
  );
}

export function removeProjectFromGroup(
  prefs: Prefs,
  source: string,
  groupId: string,
  projectId: string,
): Prefs {
  return withGroup(prefs, source, groupId, (group) => ({
    ...group,
    projects: group.projects.filter((each) => each !== projectId),
  }));
}

/**
 * Dissolve a group. Its members return to the top level, and its fold goes
 * with it so a group created later under a reused id is not born folded.
 *
 * Nothing is ended and nothing is hidden: this is the reversible half and the
 * only half there is. What is lost is a name and an icon.
 */
export function deleteGroup(prefs: Prefs, source: string, groupId: string): Prefs {
  const withoutFold = setGroupCollapsed(prefs, source, groupId, false);
  return withGroups(withoutFold, source, (groups) =>
    groups.filter((group) => group.id !== groupId),
  );
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

/** Same shape as `clampPaneWidth`: a non-number falls through to `NaN` and
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

/** A string or nothing. The only check the store is entitled to make: it does
 *  not know what the tabs are called, so it cannot say more than "this is the
 *  kind of thing a tab name is". */
function readDetailTab(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null;
}

/** Written when the operator changes tab; `null` forgets which. */
export function setDetailTab(prefs: Prefs, detailTab: string | null): Prefs {
  return { ...prefs, detailTab };
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

/** `clampPaneWidth` is already total, so a non-number falls through to `NaN`
 * and lands on the pane's default, exactly like any other malformed field. */
function readPaneWidth(pane: Pane, raw: unknown): number {
  return clampPaneWidth(pane, typeof raw === 'number' ? raw : Number.NaN);
}

/** Flip it. Written by the sidebar's one toggle and by the settings overlay. */
export function setTheme(prefs: Prefs, theme: Theme): Prefs {
  return { ...prefs, theme };
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

/** Normalised on the way in as well as on the way out, for the same reason and
 *  in the same direction: a caller that stored something unreadable would take
 *  the column's progress lines away on the strength of it. */
export function setFocusView(prefs: Prefs, on: unknown): Prefs {
  return { ...prefs, focusView: readFocusView(on, undefined) };
}

/** Normalised on the way in as well as on the way out, for the same reason and
 *  in the same direction: a caller that stored an unknown word would move the
 *  operator's send key on the strength of it. */
export function setPromptSubmitKey(prefs: Prefs, key: unknown): Prefs {
  return { ...prefs, promptSubmitKey: readPromptSubmitKey(key) };
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
 * An empty title CLEARS the override, restoring the source's own name --
 * exactly `setRename`, one field over rather than one level up. The
 * project's `id` is never the thing being written here: this only ever
 * touches `projectNames`, so nothing that keys off the id (icons, collapse
 * state, group membership, hidden-project state) can be disturbed by a
 * rename.
 */
export function setProjectRename(
  prefs: Prefs,
  sourceId: SourceId,
  projectId: string,
  title: string,
  now: Date,
): Prefs {
  const bucket = prefs.projectNames[sourceId] ?? emptyMap<RenameChoice>();
  const trimmed = title.trim();
  const nextBucket =
    trimmed === ''
      ? withoutEntry(bucket, projectId)
      : withEntry(bucket, projectId, { title: trimmed, at: now.toISOString() });
  const projectNames =
    Object.keys(nextBucket).length > 0
      ? withEntry(prefs.projectNames, sourceId, nextBucket)
      : withoutEntry(prefs.projectNames, sourceId);
  return { ...prefs, projectNames };
}

/**
 * A stored override, or nothing. Total, and in the one safe direction: a value
 * that is not a non-empty string is an ABSENCE, which is the session's own
 * directory -- never `''`, which `execFile` would read as "wherever the app
 * was launched from".
 */
function readRepoPath(entry: unknown): string | null {
  if (typeof entry !== 'string') return null;
  const trimmed = entry.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Point one project's pull-request reads at a directory, or clear it.
 *
 * An empty (or blank) value CLEARS, exactly as `setProjectRename`'s empty
 * title does, and for a sharper reason: an empty string handed to `execFile`
 * as a `cwd` is the process's own working directory, so storing one would
 * answer about a repository nobody chose. Clearing is the only reading of ""
 * that cannot lie.
 */
export function setProjectPrRepo(
  prefs: Prefs,
  sourceId: SourceId,
  projectId: string,
  directory: string,
): Prefs {
  const bucket = prefs.prRepos[sourceId] ?? emptyMap<string>();
  const trimmed = directory.trim();
  const nextBucket =
    trimmed === '' ? withoutEntry(bucket, projectId) : withEntry(bucket, projectId, trimmed);
  const prRepos =
    Object.keys(nextBucket).length > 0
      ? withEntry(prefs.prRepos, sourceId, nextBucket)
      : withoutEntry(prefs.prRepos, sourceId);
  return { ...prefs, prRepos };
}

/** The directory this project's pull requests are read from, or `null` for
 *  "the session's own", which is what vam did before this existed. */
export function prRepoFor(prefs: Prefs, sourceId: SourceId, projectId: string): string | null {
  return readRepoPath(prefs.prRepos[sourceId]?.[projectId]);
}

/**
 * Put the stored names onto the model, once, before anything reads it -- the
 * same trick `applyIcons` plays one field over, and for the same reason: the
 * sidebar, the canvas node and the detail panel all render `session.title`,
 * and none of them should have to know that a title can be local.
 *
 * `projectNames` defaults to `{}` for the same reason `applyIcons`'
 * `projectIcons` argument does: every existing two-argument call site
 * (session renames only) still compiles. Applied to `project.name` --
 * never `project.id`, which every one of `applyIcons`, `isProjectCollapsed`,
 * `isProjectHidden` and the group layer keys off and which a rename must
 * leave alone.
 */
export function applyRenames(
  model: CanvasModel,
  renames: Prefs['renames'],
  projectNames: Prefs['projectNames'] = {},
): CanvasModel {
  if (Object.keys(renames).length === 0 && Object.keys(projectNames).length === 0) {
    return model;
  }
  return {
    ...model,
    projects: model.projects.map((project) => {
      // A project with no source has no bucket to look either override up
      // in -- the same "cannot store under an unknown source" rule
      // `setRename`/`setProjectRename`'s callers already follow.
      if (project.source === undefined) {
        return project;
      }
      const nameChoice = projectNames[project.source]?.[project.id];
      const withName = nameChoice === undefined ? project : { ...project, name: nameChoice.title };
      const bucket = renames[project.source];
      if (bucket === undefined) {
        return withName;
      }
      return {
        ...withName,
        sessions: withName.sessions.map((session) => {
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
function ageOf(choice: { readonly at: string }): number {
  const t = Date.parse(choice.at);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/**
 * Add `choice` at `sid` unless something strictly newer is already there.
 *
 * Generic over anything shaped like `{ at: string }` -- `IconChoice` and
 * `RenameChoice` both are -- because `migrateSourceKey` below needs the exact
 * same newest-wins rule to fold a legacy-id bucket into a current one, and a
 * second copy of this logic keyed to one concrete type would drift from this
 * one the first time either changed.
 */
function keepNewer<T extends { readonly at: string }>(
  bucket: Record<string, T>,
  sid: string,
  choice: T,
): Record<string, T> {
  const existing = bucket[sid];
  if (existing !== undefined && ageOf(existing) >= ageOf(choice)) {
    return bucket;
  }
  return withEntry(bucket, sid, choice);
}

/**
 * The on-disk name of vam's original, single-source integration before this
 * rename. A LITERAL, deliberately, not a display name -- nothing shows it (see
 * `Canvas.tsx`, `App.tsx`, the adapters). It survives here only because
 * `migrateSourceKey` needs the exact byte string an already-installed vam
 * already wrote to `localStorage`, months or years before this file's own
 * `migrateSource` started returning a different one.
 */
const LEGACY_HTTP_SOURCE_ID = 'black-smith';

/**
 * Carry a source-keyed bucket forward from an id's old name to its new one.
 *
 * Every prefs field below this line is keyed by source id, and `readPrefs`
 * runs against whatever a browser already has stored -- unmoved since before
 * a source was ever renamed in code. Without this, every icon, rename, fold,
 * hide, group and pointer an operator already made under `black-smith` would
 * stay on disk keyed by a name nothing looks up anymore: present, readable by
 * a person with devtools open, and permanently invisible to vam. That is
 * exactly the silent loss a rename must not cause.
 *
 * `merge` resolves the one case that is rare rather than impossible: an
 * install old enough to still carry pre-AC-1 flat data (which `readIcons`
 * folds into `migrateSource`'s bucket on its own) can ALSO already have a
 * genuine nested bucket sitting under the literal old id, in the same
 * payload -- so a bucket can exist under both names in the same read, and
 * dropping either half would be the same silent loss this function exists to
 * prevent.
 */
function migrateSourceKey<T>(
  buckets: Readonly<Record<string, T>>,
  from: string,
  to: string,
  merge: (legacy: T, current: T) => T,
): Readonly<Record<string, T>> {
  if (!Object.hasOwn(buckets, from)) {
    return buckets;
  }
  const asRecord = buckets as Record<string, T>;
  const legacy = asRecord[from] as T;
  const current = asRecord[to];
  const merged = current === undefined ? legacy : merge(legacy, current);
  return withEntry(withoutEntry(asRecord, from), to, merged);
}

/** `migrateSourceKey`'s `merge` for the two `{ at: string }`-keyed buckets
 *  (`icons`/`projectIcons` and `renames`): per entry, the newer write wins. */
function mergeTimestamped<T extends { readonly at: string }>(
  legacy: Readonly<Record<string, T>>,
  current: Readonly<Record<string, T>>,
): Readonly<Record<string, T>> {
  let out: Record<string, T> = { ...current };
  for (const [id, choice] of Object.entries(legacy)) {
    out = keepNewer(out, id, choice);
  }
  return out;
}

/** `migrateSourceKey`'s `merge` for an id list (`collapsedProjects`,
 *  `hiddenProjects`, `collapsedGroups`): union, order-preserving. */
function mergeIdLists(legacy: readonly string[], current: readonly string[]): readonly string[] {
  const seen = new Set(current);
  return [...current, ...legacy.filter((id) => !seen.has(id))];
}

/** `migrateSourceKey`'s `merge` for `groups`: concatenated, current's ids
 *  winning a collision -- as unreachable in practice as the outer collision
 *  `migrateSourceKey` itself guards against, since a group id is minted, not
 *  derived, but dropping a legacy group outright would still be the wrong
 *  failure mode if it ever happened. */
function mergeGroups(
  legacy: readonly StoredGroup[],
  current: readonly StoredGroup[],
): readonly StoredGroup[] {
  const ids = new Set(current.map((group) => group.id));
  return [...current, ...legacy.filter((group) => !ids.has(group.id))];
}

/** `lastFocus` is one pointer, not a bucket: migrate its `source` field in
 *  place rather than reaching for `migrateSourceKey`, which is for maps. */
function migrateLastFocusSource(
  focus: FocusChoice | null,
  from: string,
  to: string,
): FocusChoice | null {
  return focus !== null && focus.source === from ? { ...focus, source: to } : focus;
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
 * One override map per theme, keyed by the EFFECTIVE theme.
 *
 * `system` is not a bucket, and cannot become one: it names a source for the
 * appearance, not an appearance, so there is nothing for an operator to have
 * chosen a colour against. Every caller that picks a bucket resolves through
 * `effectiveTheme` first — the same single source `applyTheme` reads — which
 * is what makes the OS flipping under `system` swap the overrides in force at
 * the same moment it swaps the class on `<html>`.
 */
export type ThemePalettes = Readonly<Record<EffectiveTheme, PaletteOverrides>>;

/**
 * The colours the operator may adjust — ELEVEN of about thirty, chosen rather
 * than enumerated.
 *
 * Two families, because they are the two that change the app's character: the
 * surfaces you look at all day (pane, panel, sidebar, raised) with the ink
 * that has to stay readable on them, and the status family (running, waiting,
 * done, failed) plus the cursor ring, which is what a glance at the session
 * list is actually reading.
 *
 * `pane` IS THE DETAIL PANE'S OWN FILL, and it is here because the operator
 * asked for it to be: the pane was painted `bg-sidebar` -- the mockup gives
 * the two the same value -- so the sidebar swatch moved the whole right-hand
 * pane with it and there was no way to pull them apart. They are separate
 * tokens now, starting on the same value (styles.css), and `seedSplits` below
 * carries a stored sidebar override onto the new one so the split is
 * invisible until the operator moves one of them.
 *
 * `ground` USED TO BE HERE AND IS NOT ANY MORE -- operator: "the ground
 * setting is unnecessary". It was the deepest surface, and what it actually
 * painted inside the pane (the sticky prompt's band) now takes the pane's own
 * fill, so the swatch was setting a colour the operator could barely see. The
 * TOKEN stays: it still paints the page behind the panes, the code fence
 * (whose syntax colours were measured against it -- styles.css) and the modal
 * scrims. See `RETIRED_TOKENS`.
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
 * light/dark pair is in force. What a SET token does about the other theme is
 * not this table's business — that is `ThemePalettes`, which keeps a map per
 * theme, so a colour chosen in dark binds dark and leaves light exactly as
 * unset as it was. (This paragraph once claimed the second half for the flat
 * map that preceded it, and was wrong: one map applied to both themes froze
 * the other theme on the first pick.)
 */
export const PALETTE_TOKENS: readonly { readonly token: string; readonly label: string }[] = [
  { token: '--vam-pane', label: 'pane' },
  { token: '--vam-panel', label: 'panel' },
  /* `card` IS THE FILL OF ANYTHING SITTING ON THE PANE OR THE SIDEBAR, and
     it is here for the same reason `pane` is: it was carved out of a token the
     operator could already set. Every card in the detail pane and the sidebar
     painted `bg-panel` until the operator's second report of "black patches",
     which was `panel` measuring 1.028:1 DARKER than the two surfaces it was
     drawn on (styles.css). `seedCard` below carries a stored panel override
     onto it so the repoint takes nothing away. */
  { token: '--vam-card', label: 'card' },
  { token: '--vam-sidebar', label: 'sidebar' },
  { token: '--vam-raised', label: 'raised' },
  /* THE ONE COLOUR THE OPERATOR HAS ASKED ABOUT TWICE. First for the prompt
     to "have a different colour so it stands out, and sit in a bubble", then
     -- having got a bubble filled with `raised`, 1.030:1 against the band
     behind it -- for it to have "more contrast within the pane". A swatch is
     the honest end of that: the fill now has a real step, and the person who
     keeps looking at it can move it without waiting for a build. It is NOT
     seeded from `raised`; see `seedCard`. */
  { token: '--vam-in-bubble', label: 'in bubble' },
  { token: '--vam-ink', label: 'text' },
  { token: '--vam-running', label: 'running' },
  { token: '--vam-waiting', label: 'waiting' },
  { token: '--vam-cursor-ring', label: 'cursor ring' },
  { token: '--vam-idle', label: 'idle' },
  { token: '--vam-done', label: 'done' },
  { token: '--vam-failed', label: 'failed' },
];

/**
 * A COLOUR THE OPERATOR MAY STILL HAVE, AND MAY NO LONGER SET.
 *
 * `--vam-ground` left the swatch grid when the operator asked for it to; it
 * did not leave the stylesheet. So a stored override for it is still read,
 * still written back, and still put on the document -- anything else changes
 * what somebody sees because of a refactor, which is the one thing a
 * migration may not do (`LEGACY_GROUND_TOKEN` below argues the same case for
 * the rename before this one, and that rename now lands here).
 *
 * The cost, stated rather than discovered: with no swatch there is no
 * per-token reset either, so "reset <theme> colours" is the only way back.
 * That button clears the whole bucket, retired entries included, so the
 * colour is undoable -- just not individually.
 */
const RETIRED_TOKENS: readonly string[] = ['--vam-ground'];

/** Every token that may appear in a stored bucket: offered plus retired. */
const PALETTE_KEYS = new Set([...PALETTE_TOKENS.map((entry) => entry.token), ...RETIRED_TOKENS]);

/**
 * EVERY SPLIT A STORED COLOUR HAS TO SURVIVE, as `[the older token, the one
 * carved out of it]`.
 *
 * A table rather than two hand-written functions, and the reason is the
 * comment the first one carried: "a typo in either half is a seed that
 * silently never happens". Two copies of that hazard is two chances to have
 * it, and the second split arrived within one release of the first.
 *
 *  - `sidebar -> pane`: the detail pane wore `bg-sidebar` until the operator
 *    asked for "the pane's colour setting split from the sidebar".
 *  - `panel -> card`: every card on the pane and in the sidebar wore
 *    `bg-panel` until the operator's second report of black patches, which
 *    was that fill measuring 1.028:1 DARKER than the surfaces under it.
 *
 * `--vam-in-bubble` IS DELIBERATELY ABSENT from this table even though the
 * bubble it fills used to wear `raised`. Seeding it would carry a colour the
 * operator chose for session rows and hovers onto a surface they never picked
 * it for -- and, specifically, would restore the 1.03:1 they came back to
 * complain about. Preserving what somebody sees is the rule; preserving a
 * defect they asked to have fixed is not the same thing.
 */
const SPLITS: readonly (readonly [string, string])[] = [
  ['--vam-sidebar', '--vam-pane'],
  ['--vam-panel', '--vam-card'],
];

/**
 * What `--vam-ground` was called before the canvas it was named after was
 * deleted, and the only place that spelling may still appear.
 *
 * A rename is free for a stylesheet and expensive for a stored file: the key
 * is the CSS custom property itself, so an operator who had customised this
 * colour would open the new build to find their pick gone -- dropped by
 * `readBucket` for not being a known token, then erased for good by the next
 * `writePrefs`, which stringifies whatever was parsed. Read on LOAD rather
 * than written as a fallback at paint time, so the migration happens once and
 * everything downstream sees exactly one name.
 */
const LEGACY_GROUND_TOKEN = '--vam-canvas';
const GROUND_TOKEN = '--vam-ground';

/**
 * What may be written into a custom property.
 *
 * Six digits and nothing else — which is exactly what an `<input type="color">`
 * produces, so the narrow rule costs the operator nothing. It is not decoration:
 * a custom property is injected into the page's own styles, and a value like
 * `red; --something: else` would be a stylesheet the operator did not write.
 */
const COLOUR = /^#[0-9a-f]{6}$/i;

function readBucket(raw: unknown): PaletteOverrides {
  if (typeof raw !== 'object' || raw === null) {
    return {};
  }
  const out = emptyMap<string>();
  for (const [token, value] of Object.entries(raw as Record<string, unknown>)) {
    // The retired name is accepted and rewritten, never carried: a payload
    // written by two versions can hold both, and the CURRENT name is the one
    // the operator last picked with, so it wins.
    const key = token === LEGACY_GROUND_TOKEN ? GROUND_TOKEN : token;
    if (token === LEGACY_GROUND_TOKEN && out[GROUND_TOKEN] !== undefined) {
      continue;
    }
    // Per entry, like every other reader here: one hand-edited colour cannot
    // drag the others back to the stylesheet with it.
    if (PALETTE_KEYS.has(key) && typeof value === 'string' && COLOUR.test(value)) {
      out[key] = value;
    }
  }
  return seedSplits(out);
}

/**
 * A SURFACE SPLIT OFF ANOTHER ONE WITHOUT MOVING A PIXEL.
 *
 * Each pair in `SPLITS` names a token that used to paint a surface and the
 * token that paints it now. An operator who had customised the OLD one was
 * therefore looking at a custom version of the NEW surface, and the repoint
 * alone would have handed it back to the stylesheet's grey in front of them.
 * So the old colour is copied onto the new token once, on load, and written
 * back under it.
 *
 * ONLY WHEN THE OLD TOKEN IS ACTUALLY OVERRIDDEN. Seeding an unset token from
 * the stylesheet's current value would freeze it: a theme change moves the
 * original, and a copy pinned to the other theme's grey would follow nothing.
 * And never over a value the operator has picked -- a payload holding both was
 * written by a build that already had the new token.
 */
function seedSplits(bucket: Record<string, string>): PaletteOverrides {
  for (const [from, to] of SPLITS) {
    const source = bucket[from];
    if (bucket[to] === undefined && source !== undefined) {
      bucket[to] = source;
    }
  }
  return bucket;
}

/**
 * Both buckets — and the migration off the flat map that shipped first.
 *
 * A payload written before this feature is one flat token → colour map, and it
 * is read into BOTH themes. That is the deliberate reading: it is the only one
 * that leaves the screen on upgrade exactly as the operator left it. Loading
 * the flat set into the theme in force alone would silently strip the other
 * theme of colours it was visibly wearing, and loading it into neither would
 * throw the operator's choices away — both are a change nobody asked for, made
 * by a version bump. The cost is that the two buckets start out identical,
 * which is a thing the operator can see and undo with one pick per theme.
 *
 * A payload counts as the new shape when either bucket key is present as an
 * object, which is what keeps the per-field defence: a missing bucket costs an
 * empty one, a garbage bucket costs itself and not its neighbour, and neither
 * can reach a field beside `palette`.
 */
function readPalettes(raw: unknown): ThemePalettes {
  if (typeof raw !== 'object' || raw === null) {
    return { dark: {}, light: {} };
  }
  const shaped = raw as { dark?: unknown; light?: unknown };
  if (isObject(shaped.dark) || isObject(shaped.light)) {
    return { dark: readBucket(shaped.dark), light: readBucket(shaped.light) };
  }
  const flat = readBucket(raw);
  return { dark: flat, light: { ...flat } };
}

function isObject(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null;
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

/** One colour chosen, IN ONE THEME — the effective one, which is the only
 *  theme an operator can have been looking at when they chose. A token vam does
 *  not offer, or a value that is not a colour, changes nothing: the picker
 *  cannot produce either, and a caller that does has a bug rather than a
 *  preference. */
export function setPaletteColor(
  prefs: Prefs,
  theme: EffectiveTheme,
  token: string,
  value: string,
): Prefs {
  if (!PALETTE_KEYS.has(token) || !COLOUR.test(value)) {
    return prefs;
  }
  return withBucket(prefs, theme, withEntry({ ...prefs.palette[theme] }, token, value));
}

/** Back to the stylesheet for one token in one theme — by DELETING the
 *  override. Writing today's value back would look identical on screen and
 *  would freeze that colour against a later stylesheet forever. */
export function clearPaletteColor(prefs: Prefs, theme: EffectiveTheme, token: string): Prefs {
  return withBucket(prefs, theme, withoutEntry({ ...prefs.palette[theme] }, token));
}

/** Back to the stylesheet for all of them, in ONE theme. The other theme's
 *  colours were chosen on a screen this one cannot see, so a reset here is not
 *  evidence that they are unwanted. */
export function clearPalette(prefs: Prefs, theme: EffectiveTheme): Prefs {
  return withBucket(prefs, theme, {});
}

function withBucket(prefs: Prefs, theme: EffectiveTheme, bucket: PaletteOverrides): Prefs {
  return { ...prefs, palette: { ...prefs.palette, [theme]: bucket } };
}

/** The overrides in force. `theme` is the EFFECTIVE theme: resolve `system`
 *  through `effectiveTheme` before you get here, or you are asking for the
 *  colours of a screen nobody is looking at. */
export function paletteFor(palettes: ThemePalettes, theme: EffectiveTheme): PaletteOverrides {
  return palettes[theme];
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
 *
 * RETIRED TOKENS ARE VISITED TOO. A colour the operator can no longer pick is
 * still a colour they picked: leaving it out of this loop would keep it in
 * the file and take it off the screen, which is the drop this whole layer is
 * written to avoid -- and would leave a reset unable to remove a property it
 * had set in an earlier build.
 */
export function applyPalette(
  overrides: PaletteOverrides,
  root: HTMLElement | null = globalThis.document?.documentElement ?? null,
): void {
  if (root === null) {
    return;
  }
  for (const token of [...PALETTE_TOKENS.map((entry) => entry.token), ...RETIRED_TOKENS]) {
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
  applyPalette(paletteFor(prefs.palette, effectiveTheme(prefs.theme)));
  applyOutFontSize(prefs.outFontSize);
  setActiveBindings(prefs.keyBindings);
  setActiveProvider(prefs.defaultProvider);
  setActiveFocusView(prefs.focusView);
  setActivePromptSubmitKey(prefs.promptSubmitKey);
  /**
   * AND ONE PREFERENCE CROSSES INTO MAIN, because the read it changes happens
   * there: `gh` is spawned by `main/sources/claude-code/source.ts`, which has
   * no access to this store.
   *
   * HERE RATHER THAN AT THE PICKER, for the reason every line above it is
   * here: `activatePrefs` runs on every read AND every write, so a reload arms
   * main as surely as a click does. A push wired to the control alone would
   * leave main holding an empty map until the operator happened to open
   * settings, and the pane would report the factory's pull requests until they
   * did.
   *
   * FIRE AND FORGET, DELIBERATELY. `activatePrefs` is synchronous and every
   * other side effect here is too; awaiting an IPC round-trip would make every
   * prefs write async for a projection whose staleness costs one poll. A
   * rejection is swallowed for the same reason it is in `createStreamSubscribe`
   * -- the desktop bridge is absent in the browser build, where `window.api`
   * has no `prefs` at all and this must simply not happen.
   */
  globalThis.window?.api?.prefs?.setPrRepos?.(prefs.prRepos)?.catch?.(() => {});
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

/**
 * What the STYLESHEET gives a token, past whatever the operator has in force.
 *
 * `paletteValue` answers "what should the picker show for this token" and
 * consults the cascade -- which, once `applyPalette` has run, is the operator's
 * own palette: the overrides live on `document.documentElement`'s inline style
 * and custom properties inherit, so no element on the page computes the
 * stylesheet's value any more. That is the right answer for a swatch and the
 * WRONG one for the `default` colour template, whose three preview discs
 * promise the palette you get by pressing it. Left on `paletteValue`, the chip
 * would preview `ember` while offering vam.
 *
 * LIFT, ASK, PUT BACK -- and the middle step is the only one that reads. The
 * whole sequence is synchronous, so the browser never gets a frame in which
 * the operator's colour is off the document, and the restore is in a `finally`
 * because the alternative failure is not a wrong preview but a palette that
 * falls off the screen when a settings row asks a question.
 *
 * A token with nothing overriding it is the common case and is not touched at
 * all: a remove/restore pair on an unset property still invalidates style,
 * once per disc, per render, for an answer that was already correct.
 */
export function stylesheetPaletteValue(
  token: string,
  root: HTMLElement | null = globalThis.document?.documentElement ?? null,
  read: (token: string) => string = readComputedToken,
): string {
  const inline = root?.style.getPropertyValue(token) ?? '';
  if (root === null || inline === '') {
    return paletteValue({}, token, read);
  }
  try {
    root.style.removeProperty(token);
    return paletteValue({}, token, read);
  } finally {
    root.style.setProperty(token, inline);
  }
}

function readComputedToken(token: string): string {
  const root = globalThis.document?.documentElement ?? null;
  if (root === null || globalThis.getComputedStyle === undefined) {
    return '';
  }
  return globalThis.getComputedStyle(root).getPropertyValue(token);
}
