/**
 * WHERE VAM ASKS GITHUB FROM, PER PROJECT — main's copy of one preference.
 *
 * Operator: "a session started from an orchestrator or a factory often works
 * on a different repo than the one its directory is in — there needs to be a
 * way to switch repo." The choice is stored in the renderer's prefs, like
 * every other preference; the READ it changes happens here in main, inside
 * `source.ts`'s `load()`. So it has to cross, and this module is the crossing.
 *
 * ── WHY MAIN OWNS THE MAP RATHER THAN `load()` CARRYING IT ────────────────
 * The obvious design is to pass the override into `load()`. It was rejected,
 * and not for the churn.
 *
 * `load()` is the shared `PreloadSourceApi` contract, and
 * `renderer/sources/http-factory.ts` implements that same contract FOR A
 * PAIRED PHONE over Tailscale, against routes `remote/server.ts` registers.
 * Threading a directory through `load()` would make "a directory this machine
 * then spawns a process in" a thing a remote device names. What that buys is a
 * convenience about which repository's pull requests to look at; what it costs
 * is a new remote capability. That trade runs the wrong way however harmless
 * `gh` is: a remote capability should be added when something needs it, not as
 * a side effect of where a preference happens to live.
 *
 * So the map arrives on a DESKTOP-ONLY channel -- `CHANNELS.setPrRepos`, which
 * is not a member of `PreloadSourceApi` and has no route on the remote server,
 * exactly like `streamSubscribe` -- and the remote surface is byte-identical
 * to what it was.
 *
 * ── AND THE PHONE STILL SEES THE OVERRIDE ─────────────────────────────────
 * Measured, not assumed: `main/index.ts` builds ONE `DESKTOP_SOURCE` and hands
 * the same object to `registerSourceIpc` (line 448) and to
 * `startRemoteServer` (line 339). The remote server serves that source's own
 * `load()`, so an override applied here reaches both surfaces identically.
 * There is no disagreement between desktop and phone to announce -- and a
 * sentence warning about one would be a caveat about a state that cannot
 * happen, which is its own defect.
 *
 * ── MODULE STATE, AND WHY THAT IS HONEST HERE ─────────────────────────────
 * It is process-wide mutable state, which is worth being uncomfortable about.
 * What makes it the right shape: it is a projection of the renderer's prefs,
 * written on every prefs write (`activatePrefs`), read at one place, and
 * EMPTY-BY-DEFAULT means exactly what vam did before this existed. A process
 * that never receives a message behaves as it always has.
 */

/** source id → project id → directory. Empty until the renderer says otherwise. */
let overrides: Readonly<Record<string, Readonly<Record<string, string>>>> = {};

/**
 * Replace the whole map.
 *
 * WHOLE, NEVER MERGED, because the renderer's prefs are the truth and a merge
 * could not express a CLEARED override: the operator who points a project back
 * at its own directory removes the entry, and a merge would keep the old one
 * forever. Total, in the direction that forgets rather than invents -- anything
 * that is not the expected shape lands as "no overrides", which is today's
 * behaviour, never a directory nobody chose.
 */
export function setPrRepoOverrides(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    overrides = {};
    return;
  }
  const next: Record<string, Record<string, string>> = {};
  for (const [sourceId, bucket] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof bucket !== 'object' || bucket === null || Array.isArray(bucket)) continue;
    const clean: Record<string, string> = {};
    for (const [projectId, directory] of Object.entries(bucket as Record<string, unknown>)) {
      if (typeof directory !== 'string') continue;
      const trimmed = directory.trim();
      // An empty string handed to `execFile` as a `cwd` is the process's own
      // working directory -- an answer about a repository nobody chose. It is
      // dropped here as well as in `prefs.ts`, because this is the last gate
      // before a spawn and the renderer is the least trusted process.
      if (trimmed !== '') clean[projectId] = trimmed;
    }
    if (Object.keys(clean).length > 0) next[sourceId] = clean;
  }
  overrides = next;
}

/**
 * The directory this project's pull requests should be read from, or `null`
 * for "the session's own" -- which is what vam did before this existed and is
 * what an unset override must mean exactly.
 */
export function prRepoOverride(sourceId: string, projectId: string): string | null {
  const found = overrides[sourceId]?.[projectId];
  return found === undefined || found === '' ? null : found;
}

/** For tests, and for nothing else: the module is process-wide. */
export function clearPrRepoOverrides(): void {
  overrides = {};
}
