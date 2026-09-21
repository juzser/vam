/**
 * The operator's own Claude Code sessions.
 *
 * TWO SOURCES OF TRUTH, each used for what it actually knows:
 *
 *  - `claude agents --json` is the SESSION LIST and the STATUS. It knows which
 *    processes are alive; nothing on disk does.
 *  - the transcript at `~/.claude/projects/<slug>/<sessionId>.jsonl` is the
 *    CONTENT: the newest turns, the branch, the current tool call.
 *
 * The list used to come from the directory instead, which is why this file
 * says so: walking the transcripts yields every session that ever existed --
 * 30 within a two-week window on this machine against 5 processes actually
 * running -- and showing the operator a canvas of mostly-dead sessions is the
 * complaint this source exists to answer. The CLI answers it exactly.
 *
 * `<slug>` is a lossy flattening of the working directory and is never parsed;
 * it is only walked, to find which file a session id lives in. `cwd` comes
 * from the CLI, which reports the real path.
 *
 * SUBAGENTS ARE NOT SESSIONS. `<sessionId>/subagents/agent-*.jsonl` (869 files
 * here, against 80 transcripts) is work happening *under* a session, and the
 * model is explicit that it surfaces as `runningAgents` and never as a row --
 * rows are things the operator owns. The other half of that decision: inline
 * `isSidechain: true` lines, which older transcripts used for the same
 * purpose, measure zero in every current session file.
 *
 * ── WHAT CHANGED UNDERNEATH THAT, AND WHY IT STILL STANDS ────────────────
 * The paragraph above is kept because its conclusion is still the rule: a
 * subagent is not a row, and nothing below adds one. What it got wrong was a
 * premise it never stated -- that a subagent is work nobody TALKS to. An
 * operator can send a message mid-turn while a subagent is running, and
 * Claude Code delivers it into the agent's transcript and not into the
 * session's. Reported from use, then measured on the real file: the session's
 * own transcript had gone quiet nine minutes earlier, ZERO of the 43
 * text-bearing `user` lines in its last 4 MB were operator prompts, and all
 * four of the operator's most recent messages were in the agent's file. vam
 * was faithful to a file that had stopped being where the conversation was.
 *
 * So the row stays a session and its turns stay the session's -- but its
 * NEWEST turn is the newest of the session transcript and the session's LIVE
 * subagents, chosen by when the OPERATOR spoke and never by which file was
 * written last. `subagent.ts` holds that rule, what it costs, and why an
 * agent's own words can never take the row.
 *
 * THIS MODULE IS MAIN-PROCESS ONLY. It reads the filesystem and spawns a
 * subprocess, so the browser build cannot use it and does not import it; the
 * web target is unaffected.
 */

import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Project, Session, SlashCommand } from '../../../renderer/domain/model.js';
import type { AgentWork } from '../../../shared/agent-work.js';
import type { HistoryCursor, TranscriptPage } from '../../../shared/history.js';
import type { SourceDescriptor } from '../../../shared/preload-api.js';
import type { SourceError } from '../../ipc/channels.js';
import type { MainSource } from '../source.js';
import { createTmuxRunner, listVamSessions, type TmuxSession } from '../tmux/spawn.js';
import { type AgentRoster, readAgentRoster, subagentsDirOf } from './agent-roster.js';
import { readAgentWork } from './agent-work.js';
import { type AgentsResult, type LiveAgent, listLiveAgents } from './agents.js';
import { type BuiltinCommandList, createBuiltinCommandReader } from './builtin-commands.js';
import { createSessionInDirectory, createSessionInProject } from './create-session.js';
import { readTranscriptHistory } from './history.js';
import { prRepoOverride } from './pr-repos.js';
import { projectIdOf } from './project-id.js';
import {
  createPullRequestReader,
  type ReadPullRequests,
  readPullRequestsViaCli,
} from './pull-requests.js';
import { paneForRow, replyToSession } from './reply.js';
import { createBranchLookup } from './repo-branch.js';
import { resumeClaudeSession } from './resume.js';
import { readPublishedPanes, readPublishedPanesAndProcessFacts } from './session-pane.js';
import { defaultSessionsRoot } from './session-status.js';
import {
  createProjectCommandLookup,
  mergeSlashCommands,
  readUserSlashCommands,
} from './slash-commands.js';
import {
  killPidViaSignal,
  pidHasClaudeSessionFile,
  stopSession,
  stopSessionViaCli,
} from './stop.js';
import { withLiveAgentTurn } from './subagent.js';
import { MAX_TAIL_READ_BYTES, readLiveTail, TAIL_WINDOW_BYTES } from './tail.js';
import { compactAge, EMPTY_FACTS, type TranscriptFacts } from './transcript.js';
import { defaultTranscriptRoot, indexTranscripts, locateTranscript } from './transcript-index.js';
import { fileTranscriptSource, readTranscriptWindow, type TranscriptSource } from './window.js';

/**
 * The read budget. Only sessions the CLI reported are opened -- single digits
 * in practice -- and each is read backwards from the end until the window holds
 * the raw material of a turn, a step of `TAIL_WINDOW_BYTES` at a time and never
 * past `MAX_TAIL_READ_BYTES` in total (`tail.ts`, which states the whole rule
 * and what it costs). So `load()` costs kilobytes against the 0.94 GB of
 * session transcripts on this disk, independent of how large any one of them
 * is. A transcript shared by two resumed processes is read once.
 *
 * ONE STEP IS THE COMMON CASE, and that is the point of stating the budget as a
 * rule rather than as a constant: measured over the 85 session transcripts
 * here, 83 satisfy the stop rule on the first step and pay exactly what the old
 * single fixed read paid. The other two exist because a single LINE can be
 * larger than the whole window -- 670 of them here -- and a window holding one
 * of those holds no conversation at all.
 *
 * THIS IS THE LIVE VIEW'S BUDGET AND NOTHING ELSE'S. Scrolling back through a
 * session is a separate, on-demand read (`history.ts`), asked for by a person
 * and never by the poll; it does not widen this and this does not bound it.
 *
 * WHAT THE OPERATOR SEES FOR IT, said here because it is this budget that
 * decides it: 34 of the 77 sessions measured for the original window fit inside
 * one step entirely and show every turn they have. The rest open MID-TURN, and
 * the oldest turn on the canvas is then one whose beginning vam never read --
 * its prompt is whole (`last-prompt` re-emits the text in full) and its answer
 * is the real one, but the tool failures counted against it are only those
 * inside the window. That turn is not dropped: on five of the six largest
 * transcripts here the tail holds exactly one turn, so dropping it would leave
 * the canvas empty. `history.ts` is what reaches everything before it, and its
 * cursor rules are written so that turn is never handed over a second time.
 *
 * AND WHEN EVEN THE WIDENED READ FINDS NO CONVERSATION, the turns it minted say
 * so rather than claiming the session answered nothing (`Decision.unread`).
 *
 * The per-process status files are the one read that is per ROW rather than
 * per session -- there is no sharing them, since telling two rows apart is
 * exactly what they are for. Each is a single small JSON document (a few
 * hundred bytes, read whole), so a canvas of single-digit rows costs
 * single-digit kilobytes on top of the tails.
 */

/*
 * THE TRANSCRIPT ROOT, THE INDEX AND THE ROW-KEY RULE MOVED, to
 * `transcript-index.ts`, and the move is the only change to them.
 *
 * They were here while two readers on this page shared them. The model button
 * gained a second source (`transcript-model.ts`) and became a third, in
 * another directory -- and the one thing `locateTranscript` must never be is
 * copied, because the `#` rule it carries is subtle and a second copy is a
 * second thing to get wrong. `defaultTranscriptRoot` is still re-exported
 * below: it is this module's public surface and the source's own answer to
 * "where does Claude Code keep transcripts".
 */
export { defaultTranscriptRoot } from './transcript-index.js';

type TranscriptRead = {
  readonly facts: TranscriptFacts;
  /**
   * The subagents beside this transcript: the `●N` count and the roster the
   * pane's Agents tab lists, off ONE walk of the directory. The count was
   * always this walk's output; the roster is the rest of what it touched.
   */
  readonly roster: AgentRoster;
  /** Last activity, which `startedAt` is not. `null` when there is no file. */
  readonly mtimeMs: number | null;
};

const NO_TRANSCRIPT: TranscriptRead = {
  facts: EMPTY_FACTS,
  // Empty, not absent: a session vam READ and found no agents under is a
  // different thing from a source that cannot answer at all (model.ts).
  roster: { agents: [], running: 0 },
  mtimeMs: null,
};

async function readTranscript(
  path: string,
  sessionId: string,
  nowMs: number,
): Promise<TranscriptRead> {
  try {
    const info = await stat(path);
    // The SAME window primitive `history.ts` pages with, so the ids the canvas
    // holds and the ids a page hands back are minted from the same offsets --
    // which is the whole reason a page can be merged into the tail at all.
    //
    // The size is the one this `stat` already answered rather than a second
    // one of its own: the file cannot be stat'd twice per poll just to learn a
    // number that is sitting here.
    const { facts } = await readLiveTail(
      {
        size: async () => info.size,
        read: (from, to) => readTranscriptWindow(path, from, to),
      },
      sessionId,
      TAIL_WINDOW_BYTES,
      MAX_TAIL_READ_BYTES,
    );
    // The roster's walk is what names the live agents, and it has already been
    // paid for the `●N` badge -- so a session with none costs nothing new here
    // and reads no file it did not read before (`subagent.ts`).
    const roster = await readAgentRoster(path, nowMs);
    return {
      facts: await withLiveAgentTurn(facts, roster, subagentsDirOf(path), sessionId),
      roster,
      mtimeMs: info.mtimeMs,
    };
  } catch {
    // An unreadable transcript costs its own turns, never the whole load: the
    // session is live and the operator should still see it.
    return NO_TRANSCRIPT;
  }
}

/**
 * The turns BEFORE a cursor, for one session -- the on-demand read `load()`
 * deliberately is not (`history.ts` says why, and what it costs).
 *
 * `rowId` is what the renderer holds: `<sessionId>#<pid>`, one per PROCESS,
 * because two processes can resume the same session (`agents.ts`'s `key`). A
 * transcript is per SESSION, so the id is tried whole first and then at its
 * last `#`. That is the one place this string is re-split, and it is defensible
 * here for the reason `LiveAgent.pid` says it is not elsewhere: nothing is
 * being addressed -- no process, no pane, no signal -- only a file is being
 * named, and the session id is what names it. Asking the CLI instead would
 * spawn a subprocess per scroll step.
 */
export async function readClaudeCodeHistory(
  root: string,
  rowId: string,
  cursor: HistoryCursor | null,
  // Injectable for the reason every read here is: a test names an invented
  // transcript under a temp directory, never the operator's own.
  sourceOf: (path: string) => TranscriptSource = fileTranscriptSource,
): Promise<TranscriptPage> {
  const { sessionId, path } = await locateTranscript(root, rowId);
  if (path === undefined) {
    // vam looked and this session has no transcript -- a refusal naming what
    // it could not find, never an empty page claiming the session is empty.
    return {
      kind: 'unavailable',
      error: {
        kind: 'refused',
        code: 'unknown-session',
        message: `vam found no transcript for ${sessionId}; it may have been removed`,
      },
    };
  }
  return await readTranscriptHistory(sourceOf(path), sessionId, cursor);
}

/**
 * What ONE of a session's subagents was asked and what it has done.
 *
 * ON DEMAND, like the history above and for the same reason said differently:
 * a session here has up to 460 agent transcripts beside it, and the poll's
 * 128 KiB-per-session budget exists to refuse exactly that. Nobody pays this
 * until a person opens the Agents tab and picks a row.
 *
 * The agent id is NOT trusted to be a file name -- `agent-work.ts` checks it
 * before it becomes a path, because it arrives over IPC from a renderer.
 */
export async function readClaudeCodeAgentWork(
  root: string,
  rowId: string,
  agentId: string,
): Promise<AgentWork> {
  const { sessionId, path } = await locateTranscript(root, rowId);
  if (path === undefined) {
    return {
      kind: 'unavailable',
      error: {
        kind: 'refused',
        code: 'unknown-session',
        message: `vam found no transcript for ${sessionId}; it may have been removed`,
      },
    };
  }
  return await readAgentWork(path, agentId);
}

export async function loadClaudeCodeProjects(
  root: string,
  agents: readonly LiveAgent[],
  nowMs: number = Date.now(),
  // Cached per call to this function -- one `load()` worth of sessions -- per
  // `repo-branch.ts`'s contract. Injectable so tests never touch a real
  // directory on the machine running them.
  branchOf: (cwd: string) => Promise<string | null> = createBranchLookup(),
  // Injectable for the same reason as `branchOf`: tests read invented pids
  // under a temp directory, never the operator's own `~/.claude/sessions`.
  sessionsRoot: string = defaultSessionsRoot(),
  // NULL BY DEFAULT, AND THAT IS THE POINT: asking about pull requests means
  // spawning `gh` and reaching GitHub with the operator's credentials, so a
  // caller that has not asked for it gets a model with `pullRequests` absent
  // rather than a surprise network call. `CLAUDE_CODE_SOURCE` injects the
  // throttled reader; tests inject invented answers.
  readPrs: ReadPullRequests | null = null,
  // The tmux sessions vam started, for `Session.vamControlled`. NULL BY
  // DEFAULT and null means "vam could not ask" -- the field is then left off
  // the session entirely rather than defaulting to `false`, which would claim
  // vam checked. `CLAUDE_CODE_SOURCE` passes the real listing; a listing vam
  // failed to obtain arrives here as null too, not as an empty array.
  tmuxSessions: readonly TmuxSession[] | null = null,
  // The `/` typeahead's USER tier, read once per `load()` and stamped onto
  // every session -- `~/.claude/commands`, the same regardless of the row.
  // Injectable like `branchOf`: tests read invented commands, never the
  // operator's real directory.
  slashCommands: readonly SlashCommand[] = [],
  // The `/` typeahead's PROJECT tier, per session's own `cwd`. A LOOKUP rather
  // than a list, because this one is NOT the same regardless of the row --
  // and cached inside itself, so the sessions of one project cost one read
  // between them (`createProjectCommandLookup`). The default reads nothing:
  // like `readPrs` and `tmuxSessions`, a caller that has not asked for a
  // filesystem read does not get a surprise one.
  projectCommandsFor: (cwd: string) => Promise<readonly SlashCommand[]> = async () => [],
  // The `/` typeahead's BUILT-IN tier, or the reason there is none. NULL means
  // nobody asked -- which is not a failure and draws nothing; an `unavailable`
  // means vam asked the CLI and could not be told, which the session carries
  // as `slashCommandGap` so the short list says why it is short.
  builtinCommands: BuiltinCommandList | null = null,
): Promise<readonly Project[]> {
  const index = await indexTranscripts(root);
  // What the sessions publish about themselves: `sessionId` -> tmux session,
  // out of the same `~/.claude/sessions` files the per-row status read below
  // wants too -- read together, once per file, rather than the pairing and
  // the status opening the same `<pid>.json` twice (`session-pane.ts`). This
  // is what makes `vamControlled` a fact about a SESSION rather than about a
  // project.
  const { panes, facts: processFacts } = await readPublishedPanesAndProcessFacts(sessionsRoot);

  // Read each transcript once, however many processes resumed it.
  const reads = new Map<string, TranscriptRead>();
  for (const sessionId of new Set(agents.map((a) => a.sessionId))) {
    const path = index.get(sessionId);
    reads.set(
      sessionId,
      path === undefined ? NO_TRANSCRIPT : await readTranscript(path, sessionId, nowMs),
    );
  }

  const grouped = new Map<string, { cwd: string; sessions: Session[] }>();
  for (const agent of agents) {
    const read = reads.get(agent.sessionId) ?? NO_TRANSCRIPT;
    // Per row, because a row is a process: the age below and the waiting
    // state come out of the same file and are read together. Looked up
    // rather than re-read -- `readPublishedPanesAndProcessFacts` above
    // already opened this pid's file once this load; a pid absent from the
    // map (no file at all, or one this user could not read) gets the same
    // answer `readProcessFacts` gives a file it cannot use: nothing.
    const facts =
      agent.pid === null
        ? { statusUpdatedAt: null }
        : (processFacts.get(agent.pid) ?? { statusUpdatedAt: null });
    const statusUpdatedAt = facts.statusUpdatedAt;
    // TRANSCRIPT FIRST, `.git/HEAD` AS FALLBACK. `read.facts.branch` is
    // `gitBranch` as Claude Code itself recorded it per turn -- the branch the
    // session actually ran on, and it costs nothing extra since the transcript
    // is already read. `.git/HEAD` only stands in when there is no transcript
    // yet, or an older one that never wrote `gitBranch`.
    const branch = read.facts.branch ?? (await branchOf(agent.cwd));
    /**
     * One question per session, and the directory it is asked in is the
     * session's own UNLESS the operator pointed this project somewhere else.
     *
     * WHY THE OVERRIDE EXISTS: a session started from an orchestrator or a
     * factory runs in that factory's directory, so asking there reports the
     * factory's pull requests while the work is in another repository. Keyed
     * by PROJECT because a project already is a cwd grouping -- see
     * `Prefs.prRepos`.
     *
     * STILL NO `--repo`. The override moves where vam STANDS; `gh` resolves
     * the remote itself from there, so this file's own invariant holds: the
     * pane describes the repository vam is actually in, never one it was told
     * to claim. `overridden` travels with it so a failure can name the
     * directory rather than saying "this session's", which would be false.
     *
     * Throttled by the reader rather than by this loop, and the reader keys
     * its cache on the cwd -- so pointing a project elsewhere invalidates
     * nothing and re-asks once, in the new place.
     */
    const override = prRepoOverride('claude-code', projectIdOf(agent.cwd));
    const prs =
      readPrs === null
        ? null
        : await readPrs({
            cwd: override ?? agent.cwd,
            branch,
            overridden: override !== null,
          });
    const session: Session = {
      id: agent.key,
      // The CLI's name is the operator's own; the generated title is only a
      // fallback, and the session id a fallback for that.
      title: agent.name ?? read.facts.aiTitle ?? agent.sessionId,
      icon: null,
      // The branch is the second label: it is what actually distinguishes two
      // sessions on the same project at a glance.
      epic: read.facts.branch,
      status: agent.status,
      runningAgents: read.roster.running,
      agents: read.roster.agents,
      activity: agent.status === 'running' ? read.facts.activity : null,
      // Age is LAST ACTIVITY, per PROCESS. `~/.claude/sessions/<pid>.json`'s
      // `statusUpdatedAt` is the only surface that answers per process: two
      // processes that resumed one session share a transcript, so the mtime
      // below gives them one identical age where their real ones differed by
      // 18 hours on the machine this was measured on. The rest of the chain
      // is unchanged and still ordered for its own reasons: the transcript's
      // mtime is real last activity, while `startedAt` is when the process
      // launched -- for a session resumed all day that reads as days old
      // while it is answering right now, so it stands last, because a row
      // with neither a status file nor a transcript has nothing better.
      age: compactAge(nowMs - (statusUpdatedAt ?? read.mtimeMs ?? agent.startedAt ?? nowMs)),
      branch,
      // Absent, not empty, when nobody injected a reader: an empty list is
      // "vam asked GitHub and this branch has none", which a load that never
      // asked has no business claiming (model.ts).
      ...(prs === null ? {} : { pullRequests: prs }),
      decisions: read.facts.decisions,
      // The questions the session asked through `AskUserQuestion`, from the
      // same tail. Always present for this source -- empty means vam READ the
      // window and found none, which is the common case (model.ts).
      //
      // WHAT THE WINDOW COSTS. Only the end of the transcript is read, so a
      // question asked far enough back has scrolled out and is simply not
      // here. That is the correct behaviour -- vam reports what it read, not
      // what it supposes -- but it means an empty list is never evidence that
      // a session is not blocked on a question, and nothing downstream may
      // treat it as such. Widening the window to be sure would cost the whole
      // point of reading a tail, and the case it would buy (a session that
      // asked and then produced 128 KB of output while still waiting) is the
      // one where the question is stale anyway.
      questions: read.facts.questions,
      // THREE TIERS, MOST SPECIFIC FIRST, as one list (`mergeSlashCommands`).
      // The project tier is the only per-row read, and it is shared across the
      // rows of a project by the lookup's own cache.
      slashCommands: mergeSlashCommands(
        await projectCommandsFor(agent.cwd),
        slashCommands,
        builtinCommands?.kind === 'ok' ? builtinCommands.commands : [],
      ),
      // Spread, so a load with nothing missing carries no key at all -- see
      // `slashCommandGap` in `model.ts`.
      ...(builtinCommands !== null && builtinCommands.kind === 'unavailable'
        ? {
            slashCommandGap: {
              code: builtinCommands.code,
              message: builtinCommands.message,
            },
          }
        : {}),
      // WHAT THE SESSION SAYS IT IS BLOCKED ON, out of the same per-process
      // file the age came from. A tool-approval prompt is a TUI state and
      // writes no transcript record, so `questions` above is empty for it and
      // this is the only surface that names it. Spread, so a row that is not
      // waiting carries no key at all -- see `waitingFor` in `model.ts`.
      ...('waitingFor' in facts ? { waitingFor: facts.waitingFor } : {}),
      source: 'claude-code',
      // An INTERACTIVE row is a terminal a person is sitting in front of, so
      // `human` is a fact there. A BACKGROUND row is not: measured against
      // the real CLI, `--all` lists background sessions living under
      // `.claude/worktrees/`, and nothing on the row says whether a person
      // launched it or an agent spawned it. This used to claim `human` for
      // both. `unknown` is what vam actually knows, and `session-filter.ts`
      // keeps unknown VISIBLE by design -- hiding what you did not check is
      // how a filter loses work -- so the honest value costs no row on
      // screen. Agent traffic proper (`<sessionId>/subagents/`) still never
      // becomes a row at all.
      //
      // `promptCount` stays null: a tail cannot count a whole session's
      // turns, and a partial count would read as a true one.
      origin: {
        startedBy: agent.kind === 'interactive' ? 'human' : 'unknown',
        promptCount: null,
      },
      // The SAME proof `stop.ts` acts on, computed once here so every consumer
      // reads one answer: one tagged tmux session for this project, one live
      // row in it. Anything ambiguous is `false` -- vam asked and cannot prove
      // this row is that pane, which is exactly the case where acting on it
      // would act on the wrong one.
      ...(tmuxSessions === null
        ? {}
        : { vamControlled: paneForRow(tmuxSessions, agents, agent, panes) !== null }),
    };
    const group = grouped.get(agent.cwd) ?? { cwd: agent.cwd, sessions: [] };
    group.sessions.push(session);
    grouped.set(agent.cwd, group);
  }

  return [...grouped.values()].map((group) => ({
    id: projectIdOf(group.cwd),
    name: basename(group.cwd),
    // Deprecated on the model, and still set: the launched-app harness asserts
    // that what main serves carries at least the key set the browser demo
    // model does, and dropping an optional field is a shape divergence.
    source: 'claude-code',
    sessions: group.sessions,
  }));
}

/** Why each remaining `false` is false. */
const NOT_RECORDED = 'a Claude Code transcript records nothing that answers this';
const NO_SURFACE = 'the CLI exposes no such operation on a session, so vam has nothing to call';

const DESCRIPTOR: SourceDescriptor = {
  id: 'claude-code',
  /*
    "READ-ONLY" WAS TRUE ONCE AND HAS NOT BEEN FOR A LONG TIME, and the
    operator read it off the status bar and reported it as wrong -- which it
    was. This source TYPES prompts into a session's tmux pane (`reply.ts`),
    answers a picker by navigating it (`terminal/answer.ts`), switches a
    session's model through the CLI's own menu (`terminal/model-switch.ts`)
    and, since the PRs tab grew actions, merges pull requests and deletes
    remote branches with the operator's own credentials.

    The capability table below is the honest account of what this source can
    do, and it says `deliverPrompt: true` three lines down. A label that
    contradicts the table under it is worse than no label: it is the one line
    an operator reads when deciding whether vam can reach a session at all.
  */
  label: 'Claude Code',
  capabilities: {
    liveUpdates: false,
    // Both true, and they mean different things. `deliverPrompt` is the real
    // claim: vam TYPES the prompt into the tmux pane of a session it started
    // (`reply.ts`), so what vam sends reaches a running agent rather than being
    // filed in a log -- but only for a session vam owns a pane for, and a row
    // with no such pane is refused, not recorded (there is no log to fall back
    // to on this source). The port makes `recordPrompt` the only required
    // member of a write surface, so the pane channel is only reachable through
    // it -- which is why it is true as well. What vam can honestly claim after
    // a send is that the text was typed into the pane; the turn shows in the
    // Response view when the transcript does. See `recordPrompt` below.
    recordPrompt: true,
    deliverPrompt: true,
    // A pasted image is a path in the typed prompt, which `reply.ts` types into
    // the pane like any other text, and Claude Code reads the bytes itself on
    // the other end
    // (`state/artifacts/vam-image-attach/findings.md`). The picking and the
    // two checks that matter -- inside the session's own directory, really an
    // image by content -- happen in main before the draft ever changes
    // (`main/dialog/attach-image.ts`).
    promptAttachments: true,
    // THREE TIERS, and each is really read. `slash-commands.ts` reads the two
    // made of files -- `~/.claude/commands/*.md` and the session's own
    // `<cwd>/.claude/commands/*.md` -- and `builtin-commands.ts` asks the
    // installed CLI to name its BUILT-INS, which are not files and used to be
    // left out for a reason that turned out to be a stopping point rather
    // than a fact. A built-in list vam could not obtain travels as
    // `Session.slashCommandGap`, never as a shorter list.
    slashCommands: true,
    renameSession: false,
    // `claude stop <id>` is real. It stops BACKGROUND sessions only, and an
    // interactive row is refused by name rather than silently ignored -- see
    // `stop.ts`. A capability that is true for most rows and refuses the rest
    // in the source's own words is exactly what `declines` cannot express, so
    // the refusal travels as a `SourceError` at call time instead.
    closeSession: true,
    // `tmux new-session -d -c <cwd> claude` really starts one, so `o` is no
    // longer a refusal on this source. What it starts is vam's own session in
    // a detachable pty; the operator's existing sessions still cannot be
    // adopted, and nothing here claims otherwise. See `create-session.ts`.
    createSession: true,
    governance: false,
    // `gh pr list --head <branch>`, run in the session's own working
    // directory. See `pull-requests.ts` for what happens when it cannot be.
    pullRequests: true,
    // `tmux capture-pane -p` on the session vam started for this project,
    // paired by the id recorded on the tmux session at creation. The canvas
    // reads this to decide whether to OFFER the Terminal tab at all, so a
    // source without the surface no longer gets a tab that can only apologise.
    terminal: true,
    // `<sessionId>/subagents/` is real and is now read: each agent's own
    // transcript for whether it is running, and the `meta.json` beside it for
    // what it is. See `agent-roster.ts`.
    agentRoster: true,
    // `claude --resume <sessionId>` -- `docs/design/reopening-a-session.md`
    // §3, built in `./resume.ts`. It is offered only for a row whose whole
    // conversation has finished; that rule is enforced at the spawn, not
    // here, because a capability is a fact about the SOURCE and this one is
    // a fact about a row.
    resumeSession: true,
  },
  declines: {
    // No watch is implemented, so no live badge is claimed: flipping this on
    // without one gives the canvas a badge no event ever arrives at.
    liveUpdates:
      'this source re-reads on demand; nothing watches the session list or the transcripts yet',
    // No entry for recordPrompt, deliverPrompt, promptAttachments or
    // slashCommands: a decline is written only for a capability that is
    // false, and all four are now true.
    renameSession: NO_SURFACE,
    // No entry for closeSession: a decline is written only for a capability
    // that is false, and this one is now true.
    // No entry for createSession: a decline is written only for a capability
    // that is false, and this one is now true.
    governance: NOT_RECORDED,
    // No entry for pullRequests: a decline is written only for a capability
    // that is false, and this one is now true.
    // No entry for terminal: a decline is written only for a capability that
    // is false, and this one is now true. What the surface IS -- a plain-text
    // `capture-pane` snapshot, not a rendered live stream -- is said by the
    // tab itself, which is where a person can read it.
    // No entry for agentRoster: a decline is written only for a capability
    // that is false, and this one is now true.
  },
  /**
   * `connection`, and the connection is the operating-system user. The CLI
   * lists this account's own processes and the transcripts live in its own
   * home directory, so what comes back is exactly the set of sessions this
   * person is running -- there is no second identity in the store to filter
   * against, and none to leak to.
   */
  viewerScope: {
    kind: 'connection',
    note: "the CLI lists the running user's own sessions and the transcripts are files in their own home directory; the OS account is the identity, and there is no other viewer",
  },
};

/** The process-wide throttled reader. See the note in `load` below. */
const PR_READER = createPullRequestReader(readPullRequestsViaCli());

/**
 * The process-wide built-in command reader, for the same reason as
 * `PR_READER`: one spawn for the life of the app, not one per poll. See
 * `builtin-commands.ts` for what that spawn is and what it costs.
 */
const BUILTIN_COMMANDS = createBuiltinCommandReader();

/**
 * `AgentsResult`'s `unavailable` arm, turned into the same `SourceError`
 * shape `recordPrompt`, `closeSession` and `createSession` already resolve
 * to. `kind: 'unreachable'` because this is never a refusal of a request vam
 * understood -- it is vam failing to reach the CLI at all.
 */
const agentsUnavailableError = (
  result: Extract<AgentsResult, { kind: 'unavailable' }>,
): SourceError => ({
  kind: 'unreachable',
  code: result.code,
  message: result.message,
});

export const CLAUDE_CODE_SOURCE: MainSource = {
  descriptor: DESCRIPTOR,
  load: async () => {
    const agentsResult = await listLiveAgents();
    // Thrown rather than degraded to an empty project list: `load()`'s only
    // channel for "vam could not ask" is a rejection, which `useSourceModel`
    // catches and shows beside the source instead of quietly emptying the
    // canvas. See `Canvas.tsx`'s `SourceReadout`.
    if (agentsResult.kind === 'unavailable') {
      throw new Error(agentsResult.message);
    }
    return loadClaudeCodeProjects(
      defaultTranscriptRoot(),
      agentsResult.agents,
      Date.now(),
      createBranchLookup(),
      defaultSessionsRoot(),
      // ONE reader for the life of the process, because the throttle lives in
      // it: a reader created per `load()` would remember nothing and spawn
      // `gh` on every ten-second poll, which is the cost this feature must
      // not have.
      PR_READER,
      // One extra tmux call per load, and it is what makes `vamControlled`
      // answerable. `unavailable` stays NULL rather than becoming an empty
      // list: vam could not ask, and must not report that as "vam started
      // none of these".
      await (async () => {
        const listed = await listVamSessions(createTmuxRunner());
        return listed.kind === 'ok' ? listed.sessions : null;
      })(),
      await readUserSlashCommands(),
      // One lookup per `load()`, so the sessions of one project read their
      // `.claude/commands` once between them.
      createProjectCommandLookup(),
      // ONE READER FOR THE LIFE OF THE PROCESS, for `PR_READER`'s reason: the
      // installed CLI does not change under a running app, so this spawn
      // happens once rather than on every ten-second poll.
      await BUILTIN_COMMANDS(),
    );
  },
  /**
   * The live list is re-asked here rather than cached from `load()`: it is
   * where the pane pairing is resolved from, and a canvas drawn minutes ago may
   * name a session that has since exited. Asking again costs one subprocess and
   * is the difference between typing into the pane that exists now and refusing
   * a session that is already gone.
   */
  recordPrompt: async (sessionId, prompt) => {
    const agentsResult = await listLiveAgents();
    if (agentsResult.kind === 'unavailable') return agentsUnavailableError(agentsResult);
    return replyToSession({
      agents: agentsResult.agents,
      rowId: sessionId,
      prompt,
      run: createTmuxRunner(),
      // Read fresh, for the same reason the agent list is: a canvas drawn
      // minutes ago is not evidence about which pane a session is in now.
      panes: await readPublishedPanes(defaultSessionsRoot()),
    });
  },
  /**
   * The live list is re-asked for the same reason `recordPrompt` re-asks it,
   * plus one of its own: `kind` is what decides whether this session can be
   * stopped at all, and a canvas drawn minutes ago is not evidence about a
   * process now.
   */
  closeSession: async (sessionId, force = false) => {
    const agentsResult = await listLiveAgents();
    if (agentsResult.kind === 'unavailable') return agentsUnavailableError(agentsResult);
    return stopSession(
      agentsResult.agents,
      sessionId,
      (id) => stopSessionViaCli({ sessionId: id }),
      // With a runner in hand, a session vam started is killed rather than
      // refused -- see `stop.ts`. Without one it would still be refused.
      createTmuxRunner(),
      // The published pairing, without which a project holding more than one
      // live session can prove nothing and close refuses every row in it.
      await readPublishedPanes(defaultSessionsRoot()),
      force,
      // The confirmed last resort, real only here: a raw signal to the pid
      // `claude agents --json` reported, for the row a tmux route could not
      // verify at all. See `stop.ts` for what it will and will not do.
      killPidViaSignal,
      // Re-checked at the moment force actually signals, not at this poll --
      // `row.pid` is already stale by the time it gets here. See
      // `pidHasClaudeSessionFile`'s own doc for what the check does and does
      // not prove.
      pidHasClaudeSessionFile(defaultSessionsRoot()),
    );
  },
  /**
   * The live list is re-asked here too, and for a third reason of its own: it
   * is the only thing that maps a project id back to a directory, and a
   * canvas drawn minutes ago may name a project whose last session has since
   * exited.
   */
  createSession: async (projectId, title, provider) => {
    const agentsResult = await listLiveAgents();
    if (agentsResult.kind === 'unavailable') return agentsUnavailableError(agentsResult);
    return createSessionInProject({
      provider,
      agents: agentsResult.agents,
      projectId,
      title,
      run: createTmuxRunner(),
    });
  },
  /** No agent list to consult: the operator named the directory themselves. */
  createSessionInDirectory: async (cwd, title, provider) =>
    createSessionInDirectory({ cwd, title, provider, run: createTmuxRunner() }),
  /**
   * `docs/design/reopening-a-session.md` §3.
   *
   * The agent list is asked for INSIDE `resumeClaudeSession` rather than
   * gathered here, for the reason that module documents: what has to be true
   * is that nothing is live on that SESSION ID -- not merely that this row has
   * finished -- and the canvas's idea of either is one poll old.
   */
  resumeSession: async (sessionId) =>
    resumeClaudeSession({
      rowId: sessionId,
      agents: listLiveAgents,
      run: createTmuxRunner(),
    }),
  /**
   * NO agent list is asked for here, unlike every write above, and that is the
   * point of the difference: this reads a FILE, and a transcript outlives the
   * process that wrote it. Re-asking the CLI would spawn a subprocess on every
   * scroll step and would refuse to show the history of a session that has
   * since exited -- which is exactly a session worth scrolling back through.
   */
  readHistory: async (sessionId, cursor) =>
    readClaudeCodeHistory(defaultTranscriptRoot(), sessionId, cursor),
  readAgentWork: async (sessionId, agentId) =>
    readClaudeCodeAgentWork(defaultTranscriptRoot(), sessionId, agentId),
};
