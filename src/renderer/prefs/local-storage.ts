/**
 * THE SHARED FAIL-OPEN `localStorage` POLICY.
 *
 * `worktree-tree-collapse.ts`, `settings/card-collapse.ts` and
 * `prefs/foreign-hidden-note.ts` each keep their own small piece of state
 * directly in `localStorage` rather than the big `Prefs` blob `prefs.ts`
 * owns -- and each one used to hand-copy the same accessor and the same
 * try/catch fail-open wrapping around it. This module is that one copy: a
 * change to the fail-open policy is made here once and reaches all three
 * stores, instead of three times in three files that could drift apart.
 *
 * THE DIRECTION IS FAIL-OPEN, ALWAYS THE SAME WAY: an accessor that throws
 * (some privacy modes throw on ACCESS itself, before any method runs), a
 * `getItem` that throws, a stored value that fails to parse, and a
 * `setItem` that throws (quota, Safari private mode) all degrade silently
 * to the caller's own default. A viewer who cannot persist this is asked
 * again next launch, which is not a broken feature.
 *
 * EACH STORE KEEPS ITS OWN SHAPE. This module owns only the accessor and
 * the try/catch; the key, the stored value's own validation, and what
 * "fallback" means for that store stay with the caller.
 */

export function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Access ITSELF throws in some privacy modes, before any method runs.
    return null;
  }
}

/**
 * Reads `key`, hands the raw string to `parse`, and returns `fallback` if
 * the key is absent, `parse` throws (corrupt JSON, a wrong shape), or the
 * storage itself is unreachable or throws.
 */
export function readItem<T>(key: string, fallback: T, parse: (raw: string) => T): T {
  try {
    const raw = store()?.getItem(key) ?? null;
    if (raw === null) return fallback;
    return parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Writes `value` under `key`. Swallows any failure -- an unreachable or
 * throwing storage leaves the write silently undone rather than taking the
 * caller down with it, the same fail-open direction `readItem` takes.
 */
export function writeItem(key: string, value: string): void {
  try {
    store()?.setItem(key, value);
  } catch {
    // Same fail-open direction as `readItem`.
  }
}
