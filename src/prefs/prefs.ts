/**
 * The two things that are yours rather than the factory's.
 *
 * §3 already decided this and the code had not caught up: "kéo được và nhớ vị
 * trí. Vị trí lưu theo từng người dùng, **không đi vào event log**." Where you
 * dragged a card and which emoji you put on a session are facts about how you
 * like to look at the work — they are not facts about the work, so they must
 * not become events. black-smith is right to have no route for them, and vam
 * was wrong to answer "black-smith không lưu icon" as though that settled it.
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

import type { CanvasModel } from '../domain/model.js';

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

export type Pin = { readonly x: number; readonly y: number; readonly at: string };
export type IconChoice = { readonly icon: string; readonly at: string };

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

export type Prefs = {
  /** Node id → where you put it. Only nodes you actually moved appear here. */
  readonly pinned: Readonly<Record<string, Pin>>;
  /** Session id → the emoji you gave it. */
  readonly icons: Readonly<Record<string, IconChoice>>;
  readonly theme: Theme;
};

export const EMPTY_PREFS: Prefs = { pinned: {}, icons: {}, theme: DEFAULT_THEME };

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

export function readPrefs(storage: StorageLike | null, now: Date = new Date()): Prefs {
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
  const record = parsed as { pinned?: unknown; icons?: unknown };
  const cutoff = new Date(now.getTime() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return {
    pinned: fresh(readMap(record.pinned, readPin), cutoff),
    icons: fresh(readMap(record.icons, readIcon), cutoff),
    // Not pruned by the TTL the other two get. A pin ages because the session
    // it points at stops existing; a theme is about the person, and one who
    // opens vam twice a year still wants the theme they chose.
    theme: readTheme((parsed as { theme?: unknown }).theme),
  };
}

function readTheme(raw: unknown): Theme {
  return raw === 'light' || raw === 'dark' ? raw : DEFAULT_THEME;
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

/** Remember where a node was put. */
export function pin(prefs: Prefs, nodeId: string, at: { x: number; y: number }, now: Date): Prefs {
  return {
    ...prefs,
    pinned: { ...prefs.pinned, [nodeId]: { x: at.x, y: at.y, at: now.toISOString() } },
  };
}

/**
 * Did this node actually move, or did ReactFlow just call a click a drag?
 *
 * The drag threshold catches most of it; this catches the rest — a drag that
 * ends where it started should leave no pin, because a pin is the thing that
 * opts a node out of ever being re-ranked again.
 *
 * A node with no home — one the layout no longer draws — counts as moved: it
 * has nothing to sort back into, so keeping where the person put it is the only
 * answer available.
 */
export function movedFromHome(
  at: { x: number; y: number },
  home: { x: number; y: number } | undefined,
): boolean {
  return home === undefined || Math.abs(at.x - home.x) > 1 || Math.abs(at.y - home.y) > 1;
}

/**
 * What a finished drag changes, decided here rather than in the event handler.
 *
 * The handler that calls this is two lines of unwrapping ReactFlow's arguments;
 * everything that could be wrong — which nodes count as moved, what a pin
 * holds, whether anything changed at all — is in this function, where a test
 * can reach it without a pointer.
 *
 * Returns the SAME object when nothing moved, so the caller can skip the write
 * with an identity check and a drag that goes nowhere touches no storage.
 */
export function pinDragged(
  prefs: Prefs,
  dragged: readonly { id: string; position: { x: number; y: number } }[],
  homeOf: (id: string) => { x: number; y: number } | undefined,
  now: Date,
): Prefs {
  let next = prefs;
  for (const node of dragged) {
    if (movedFromHome(node.position, homeOf(node.id))) {
      next = pin(next, node.id, node.position, now);
    }
  }
  return next;
}

/**
 * Forget every position, so auto-layout has the canvas back.
 *
 * A pin that survives reloads and has no way out is a trap: one bad drag and
 * that card is wrong forever, with nothing on screen explaining why it will not
 * sort with the others. `gr` is that way out.
 */
export function unpinAll(prefs: Prefs): Prefs {
  return { ...prefs, pinned: {} };
}

/** An empty icon clears the choice rather than storing "". */
export function setIcon(prefs: Prefs, sessionId: string, icon: string, now: Date): Prefs {
  const icons = { ...prefs.icons };
  if (icon === '') {
    delete icons[sessionId];
  } else {
    icons[sessionId] = { icon, at: now.toISOString() };
  }
  return { ...prefs, icons };
}

/**
 * Put the stored icons onto the model, once, before anything reads it.
 *
 * The sidebar and the canvas node both render `session.icon`, and neither
 * should know that an icon is a local preference rather than something the
 * factory said. Applying it here means one place knows.
 */
export function applyIcons(model: CanvasModel, icons: Prefs['icons']): CanvasModel {
  if (Object.keys(icons).length === 0) {
    return model;
  }
  return {
    ...model,
    projects: model.projects.map((project) => ({
      ...project,
      sessions: project.sessions.map((session) => {
        const choice = icons[session.id];
        return choice === undefined ? session : { ...session, icon: choice.icon };
      }),
    })),
  };
}

function readMap<T>(value: unknown, read: (entry: unknown) => T | null): Record<string, T> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const out: Record<string, T> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const parsed = read(entry);
    if (parsed !== null) {
      out[key] = parsed;
    }
  }
  return out;
}

function readPin(entry: unknown): Pin | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }
  const { x, y, at } = entry as { x?: unknown; y?: unknown; at?: unknown };
  // Number.isFinite, not typeof: a stored NaN or Infinity round-trips through
  // JSON as null or throws off the layout, and a node placed at NaN vanishes.
  if (!Number.isFinite(x) || !Number.isFinite(y) || typeof at !== 'string') {
    return null;
  }
  return { x: x as number, y: y as number, at };
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
  const out: Record<string, T> = {};
  for (const [key, entry] of Object.entries(map)) {
    if (Number.isNaN(Date.parse(entry.at)) || entry.at >= cutoff) {
      out[key] = entry;
    }
  }
  return out;
}
