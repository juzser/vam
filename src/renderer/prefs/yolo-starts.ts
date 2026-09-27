/**
 * The persistent per-session Yolo indicator's leaf shape.
 *
 * SECURITY-ADJACENT, BUT NOT ITSELF A SECURITY CONTROL: a record of whether
 * vam started a given session with the permission-skip flag
 * (`prefs/agent-permissions.ts`) -- so an operator can tell, later, which
 * sessions are running unattended-safe and which are not, without having to
 * remember or re-derive it from whatever `agentPermissions` currently reads.
 *
 * RECORDED ONCE, AT SESSION CREATION, NEVER RE-DERIVED FROM THE LIVE PREF.
 * `Canvas.tsx`'s `startSessionIn` is the one writer, at the exact moment it
 * decides a session's own argv (`sessionArgv`); changing `agentPermissions`
 * afterwards must not repaint an existing session's mark -- that is the
 * whole point of writing the fact down (`prefs.ts`'s `recordYoloStart`)
 * rather than reading the pref again on every render.
 *
 * KEYED BY PANE, NOT BY SESSION ID -- an `unstarted` row and the real session
 * that registers in its pane a moment later carry two different ids
 * (`domain/model.ts`'s own note on `Session.pane`: "a tab holding the first
 * would be pruned... this field is how the canvas follows the pane across
 * that moment"), and the mark has to survive that same handoff. `Canvas.tsx`'s
 * `startSessionIn` already computes `entry.session.pane ?? entry.session.id`
 * for its own in-flight bookkeeping; `recordYoloStart`/`applyYoloStarts`
 * (`prefs.ts`) use the identical key.
 */
export type YoloStartMark = { readonly at: string };

/** Only a `{at: <parseable date string>}` object is a mark; anything else
 *  (a bare string, a stray number, a payload from a future shape this reader
 *  does not know) is dropped rather than guessed at -- the same rule
 *  `readRename` follows for the sibling `renames` bucket. */
export function readYoloStart(entry: unknown): YoloStartMark | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }
  const { at } = entry as { at?: unknown };
  return typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? { at } : null;
}
