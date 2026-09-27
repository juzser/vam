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
import { identifyRunningProvider } from '../tmux/shell.js';
import type { TmuxSession } from '../tmux/spawn.js';

const PANE_ROW_PREFIX = 'pane:';

/**
 * `TmuxSession.sessionCreated` (unix seconds, as a string -- tmux options
 * and `-F` fields are always strings) into `Session.createdAt`. `null` for
 * anything not a real listing could have produced: an older tmux (the field
 * absent), or a rewritten listing (`listVamSessions`'s own LC_CTYPE trap) --
 * never a thrown exception, on the rule every reader of an optional tmux
 * field in this source follows.
 */
function createdAtOf(session: TmuxSession): string | null {
  const raw = session.sessionCreated;
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const ms = Number(raw) * 1000;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

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
 * A pane-row id's OWN working directory, straight off vam's own tmux
 * listing -- or `null` for anything that is not one, or that names no pane
 * currently in it.
 *
 * WHY THIS EXISTS (issues 502/507's "other entry points"). `resolveSessionCwd`
 * (`main/index.ts`) is what the image-attach picker and the file-editor
 * tab's directory listing both resolve a session id through, but it only
 * ever consulted `claude agents --json` -- so a `pane:` row id, the identical
 * id `recordPrompt`/`closeSession` already dispatch on (this file's own
 * header), answered `unknown-session` even once the Response view's
 * `PaneReady` state had confirmed a provider was running and enabled the
 * composer for it. There is no agent to look up for a pane row; there never
 * is. `main/index.ts` calls this FIRST, exactly as `paneNameOf` is checked
 * before `recordPrompt` ever asks `listLiveAgents`.
 *
 * NOT GATED ON `identifyRunningProvider`, unlike `typeIntoOwnPane`'s delivery
 * choice: this answers a DIRECTORY to scope a file dialog to, never sends a
 * keystroke, so there is nothing here for "known provider vs. unidentified
 * program" to protect. Any pane vam's own listing still shows -- shell,
 * known provider, or anything else -- answers its real cwd.
 */
export function paneCwdOf(sessions: readonly TmuxSession[], rowId: string): string | null {
  const name = paneNameOf(rowId);
  if (name === null) return null;
  const cwd = sessions.find((session) => session.name === name)?.cwd;
  return cwd === undefined || cwd === '' ? null : cwd;
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
 * it: an unset option reads back as `''` -- UNLESS tmux itself said where the
 * pane actually is. `@vam-project` is vam's own digest, written only by
 * `createVamSession`; a session under vam's prefix that nobody ever ran that
 * for -- `tmux new-session -s vam-x`, typed by hand -- carries no digest to
 * refuse or match, but tmux still knows its real cwd
 * (`TmuxSession.cwd`, `#{pane_current_path}`), and that is enough to place the
 * row honestly. `source.ts` is what turns a known cwd into a brand-new
 * project; this only has to stop refusing the session that has one.
 */
export function unclaimedPanes(
  sessions: readonly TmuxSession[],
  claimed: ReadonlySet<string>,
): readonly TmuxSession[] {
  return sessions.filter(
    (session) =>
      !claimed.has(session.name) &&
      (session.project !== '' || (session.cwd !== undefined && session.cwd !== '')),
  );
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
  const runningProvider = identifyRunningProvider(session.command);
  return {
    id: paneRowId(session.name),
    title: session.name,
    epic: null,
    status: 'unstarted',
    runningAgents: 0,
    activity: null,
    age: null,
    branch: null,
    // The one row with no transcript at all, so tmux's own creation time --
    // never a file's birthtime, which does not exist yet -- is the only
    // source `Session.createdAt` has (`model.ts`, `createdAtOf` above).
    createdAt: createdAtOf(session),
    decisions: [],
    source: 'claude-code',
    // A pane vam created, by the only proof there is: it is in vam's own
    // prefix-filtered listing. Started by a person, through vam.
    origin: { startedBy: 'human', promptCount: null },
    vamControlled: true,
    pane: session.name,
    // WHO IS ALREADY RUNNING HERE, from the SAME `TmuxSession` this row is
    // built from -- no second read. `Session.runningProvider`'s own header.
    // Absent, not `undefined`-valued, on the same "an unset key is nobody
    // said" rule `resumeCommand` below follows: an ordinary empty shell must
    // read exactly as it always has to a reader who only checks presence.
    ...(runningProvider === undefined ? {} : { runningProvider }),
  };
}

/**
 * The row for a vam pane whose agent has exited but whose conversation vam
 * still knows -- `docs/design/vam-terminal-only.md`, and `paneRow`'s sibling
 * for the case that module's own header did not have: `@vam-session` unset
 * meant "never hosted anything", and now it can also mean "hosted something,
 * and the pane still remembers what".
 *
 * IDENTITY SURVIVES THE EXIT. Where `paneRow` has nothing to draw but the tmux
 * session's own name, this has the conversation's own `title`, `branch` and
 * `decisions` -- read off its transcript by the caller (`source.ts`, which
 * holds the transcript index this function has no IO of its own to consult)
 * exactly as a live row's are, so a person who switches to the Response view
 * mid-getting-started-screen and back sees the same words either way.
 *
 * THE ROW ID STAYS PANE-ROUTED, on purpose, not the conversation's bare id.
 * `CLAUDE_CODE_SOURCE.recordPrompt` and `.closeSession` (`source.ts`) both
 * dispatch on `paneNameOf(id)` before they ever ask `claude agents --json`,
 * which is exactly right here too: there is no live agent to look up, only a
 * pane to type into or kill, the same as the anonymous row beside it. Keeping
 * the id scheme identical is what lets Start session, Resume and Close all
 * keep working through the SAME write paths `paneRow`'s row already uses,
 * with no branch added to either.
 */
export function terminalRow(
  session: TmuxSession,
  conversation: {
    /** The native id this pane's `@vam-session` names -- carried through only
     *  for a caller that wants it; the row itself is addressed by pane. */
    readonly sessionId: string;
    readonly title: string;
    readonly decisions: Session['decisions'];
    readonly branch: string | null;
    /** `claude --resume <id>`, already joined -- `null` when vam could not
     *  build one, which omits `resumeCommand` rather than inventing it. */
    readonly resumeCommand: string | null;
    /**
     * The conversation's OWN creation time, read off its transcript's
     * birthtime by the caller (`source.ts`) -- this row HAS a transcript
     * (that is the whole reason it is a `terminalRow` and not a bare
     * `paneRow`), so it reads the identical source a live row's `createdAt`
     * does, never tmux's `session_created`.
     */
    readonly createdAt: string | null;
  },
): Session {
  const runningProvider = identifyRunningProvider(session.command);
  return {
    id: paneRowId(session.name),
    title: conversation.title,
    epic: null,
    status: 'terminal',
    runningAgents: 0,
    activity: null,
    age: null,
    branch: conversation.branch,
    createdAt: conversation.createdAt,
    decisions: conversation.decisions,
    source: 'claude-code',
    origin: { startedBy: 'human', promptCount: null },
    vamControlled: true,
    pane: session.name,
    ...(conversation.resumeCommand === null ? {} : { resumeCommand: conversation.resumeCommand }),
    // See `paneRow`'s own comment just above -- identical fact, identical
    // rule, for the `terminal` row's own shell.
    ...(runningProvider === undefined ? {} : { runningProvider }),
  };
}
