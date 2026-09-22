/**
 * A vam pane with no agent in it, as a ROW.
 *
 * `docs/design/vam-owns-the-session.md` §3. A new session is a shell in a
 * tmux session vam owns (`create-session.ts`), and until something is started
 * in it no source can report it: Claude Code's rows are its live process list
 * and Codex's are its thread store, and an empty shell is in neither. The
 * row has to come from the thing that exists at that moment, which is the
 * tmux session -- so `loadClaudeCodeProjects` appends, to the source rows,
 * one of these for every vam tmux session no source row is paired to.
 *
 * THE SUBTRACTION IS THE WHOLE OF THE RULE. A pane an agent row has been
 * proven to be in (`paneForRow`, the same three tiers `vamControlled` is
 * computed from) is that row's, and drawing it a second time as empty would
 * put two rows on screen for one screen -- and, worse, offer Start session
 * on a pane with an agent already in it. `claimedPanes` (`session-pane.ts`)
 * is the same idea pointing the other way and the precedent for this.
 *
 * WHAT `@vam-pid` NOW MEANS, said here because this is where it bites. The
 * pane's recorded pid is the pid of the process tmux exec'd into it, which
 * since Stage 2 is the SHELL, not an agent. `paneForRow`'s second tier
 * matches an agent's own pid against it and therefore never fires for a
 * session started this way; what binds such a pane to its agent is the pane
 * Claude Code PUBLISHES about itself (`session-pane.ts`, written whenever it
 * runs under tmux -- measured: the one session file on this machine with a
 * `tmux` field is a vam session's), and failing that the single-candidate
 * project tag. Two panes in one project with an agent in each therefore
 * bind by publication alone, which is the exact case
 * `claude-code-pane-rows.test.ts` pins.
 *
 * THE ROW'S IDENTITY IS THE TMUX SESSION'S NAME, under a prefix no source
 * key can wear: a Claude Code row is `<sessionId>#<pid>` and a Codex row a
 * bare uuid, and `combine.ts` routes writes by the id a source CLAIMED
 * rather than by its shape -- so the prefix is not how the row is routed, it
 * is how `recordPrompt` and `closeSession` inside THIS source tell a pane
 * row from an agent row without a second lookup. `paneNameOf` is the only
 * reader of it.
 *
 * ITS LIFETIME IS THE TMUX SESSION'S. The row is re-derived from
 * `listVamSessions` on every load: it appears when the pane does, and it is
 * gone when the pane is -- killed by Close, or by the shell exiting. Nothing
 * here keeps time, which is what separates this from the renderer's
 * transient "starting a session in …" placeholder, a paint that resolves
 * when a row it did not know arrives. This row is that row.
 */

import type { Session } from '../../../renderer/domain/model.js';
import type { TmuxSession } from '../tmux/spawn.js';

const PANE_ROW_PREFIX = 'pane:';

/** The row id a vam tmux session is drawn under while nothing runs in it. */
export function paneRowId(name: string): string {
  return `${PANE_ROW_PREFIX}${name}`;
}

/**
 * The tmux session a pane-row id names, or `null` for any other id -- an
 * agent row's, or anything a caller invented. `null` is the ordinary answer
 * for every row this source has always had, so a reader branching on it is
 * branching on "is this the new kind of row", nothing more.
 */
export function paneNameOf(rowId: string): string | null {
  if (!rowId.startsWith(PANE_ROW_PREFIX)) return null;
  const name = rowId.slice(PANE_ROW_PREFIX.length);
  return name === '' ? null : name;
}

/**
 * The vam tmux sessions no row has been proven to be in.
 *
 * `claimed` is every pane `paneForRow` answered for a LIVE agent row this
 * load -- not the published claims alone, and the difference is §3's own
 * decision: a pane whose agent has EXITED keeps its row, as the empty state
 * with the picker on it. A session file that outlives its process still
 * publishes a pane (`session-pane.ts` says claims are not checked against
 * liveness, and why), and reading that stale claim as "occupied" would take a
 * live, usable pane off the list. So the claim that subtracts here is the
 * pairing of a row that is actually on screen.
 *
 * An empty project id is refused for the reason every other reader refuses
 * it: an unset option reads back as `''`.
 */
export function unclaimedPanes(
  sessions: readonly TmuxSession[],
  claimed: ReadonlySet<string>,
): readonly TmuxSession[] {
  return sessions.filter((session) => session.project !== '' && !claimed.has(session.name));
}

/**
 * The row itself. Everything a `Session` must carry is here, and everything
 * optional is left off -- no `agents`, no `questions`, no `slashCommands` --
 * because each of those is a fact a SOURCE reports about a conversation, and
 * there is no conversation. An absent key is "nobody said", which is true.
 *
 * THE TITLE IS THE TMUX SESSION'S NAME. It is the one name the thing has:
 * what `tmux ls` prints, what the Terminal view is addressed by, and the only
 * string that tells two empty panes in one project apart. Anything friendlier
 * would be invented -- vam knows nothing else about this row yet -- and the
 * name is replaced by the agent's own the moment there is an agent.
 */
export function paneRow(session: TmuxSession): Session {
  return {
    id: paneRowId(session.name),
    title: session.name,
    epic: null,
    status: 'unstarted',
    runningAgents: 0,
    activity: null,
    age: null,
    branch: null,
    decisions: [],
    source: 'claude-code',
    // A pane vam created, by the only proof there is: it is in vam's own
    // prefix-filtered listing. Started by a person, through vam.
    origin: { startedBy: 'human', promptCount: null },
    vamControlled: true,
    pane: session.name,
  };
}
