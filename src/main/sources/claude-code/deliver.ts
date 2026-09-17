/**
 * The delivery channel that was RETIRED, and the one addressing helper that
 * outlived it.
 *
 * WHAT THIS FILE USED TO DO, AND WHY IT NO LONGER DOES. It ran
 * `claude --resume <sessionId> -p "<prompt>" --output-format json` to append a
 * turn to an existing session. That channel is gone, and this note is here so
 * the next reader does not reintroduce it as an improvement. Three things
 * killed it, and each on its own would have:
 *
 *   1. IT COULD NOT RESUME A FRESH SESSION. `--resume` appends to a
 *      conversation FILE, and the CLI writes that file only on a session's
 *      FIRST turn. A session vam had just started -- alive in its pane, no turn
 *      taken -- had no file to resume, so the CLI answered "No conversation
 *      found with session ID: <id>". That is the exact defect the operator hit:
 *      create a session, type a prompt seconds later, get a failure that named
 *      nothing they could do.
 *   2. THE REFUSAL WAS THE COMMON CASE, NOT THE EDGE. The CLI also declines
 *      while the target session is RUNNING -- and a session the operator wants
 *      to reply to is running by definition -- so even for a session that HAD
 *      a file, the answer was usually a refusal.
 *   3. THE OPERATOR'S DESIGN RULE. vam is a projection of the terminal: the
 *      pane a session runs in is the base, and the Response view is a chat UI
 *      over what that pane produces. A prompt is TYPED into the pane (see
 *      `reply.ts`), first turn or not, running or not; the turn appears in the
 *      view when the transcript records it. One channel, and the pane is it.
 *
 * `--fork-session` and its reasoning went with the channel. It mattered only
 * because `--resume` could be told to branch a COPY and answer there while the
 * real session carried on elsewhere; with no `--resume` spawn at all, there is
 * no flag to withhold and nothing here that could deliver to the wrong place.
 * Its successor concern -- proving the keystrokes reached the RIGHT session --
 * lives in `reply.ts`'s pane pairing (`paneForRow`), which is the only place a
 * session is matched to a pane vam owns.
 *
 * NO SPAWN REMAINS IN THIS FILE, so there is no stdin to close and no 3-second
 * stdin wait to pay (the old `execFile` left the child's stdin an open pipe the
 * CLI waited on). The one thing that survives is pure and unrelated to the
 * channel: turning a renderer row id into the session id it addresses.
 */

/**
 * The row id the renderer holds is `<sessionId>#<pid>` -- two processes can
 * resume one session, so a row is a process (see `agents.ts`). A reply
 * addresses the SESSION, so the process half is dropped here. Kept in this
 * file, and imported by `reply.ts` and `stop.ts`, because it is the addressing
 * question the retired channel and its replacement both have to answer first.
 */
export function sessionIdOf(rowId: string): string {
  return rowId.split('#')[0] ?? rowId;
}
