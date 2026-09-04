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
 * SUBAGENTS ARE NOT SESSIONS. `<sessionId>/subagents/agent-*.jsonl` (486 files
 * here, against 54 transcripts) is work happening *under* a session, and the
 * model is explicit that it surfaces as `runningAgents` and never as a row --
 * rows are things the operator owns. The other half of that decision: inline
 * `isSidechain: true` lines, which older transcripts used for the same
 * purpose, measure zero in every current session file.
 *
 * THIS MODULE IS MAIN-PROCESS ONLY. It reads the filesystem and spawns a
 * subprocess, so the browser build cannot use it and does not import it; the
 * web target is unaffected.
 */

import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Project, Session } from '../../../renderer/domain/model.js';
import type { SourceDescriptor } from '../../../shared/preload-api.js';
import type { MainSource } from '../source.js';
import { createTmuxRunner, listVamSessions, type TmuxSession } from '../tmux/spawn.js';
import { type AgentRoster, readAgentRoster } from './agent-roster.js';
import { type LiveAgent, listLiveAgents } from './agents.js';
import { createSessionInDirectory, createSessionInProject } from './create-session.js';
import { deliverPromptViaCli } from './deliver.js';
import { projectIdOf } from './project-id.js';
import {
  createPullRequestReader,
  type ReadPullRequests,
  readPullRequestsViaCli,
} from './pull-requests.js';
import { paneForRow, replyToSession } from './reply.js';
import { createBranchLookup } from './repo-branch.js';
import { readPublishedPanes } from './session-pane.js';
import { defaultSessionsRoot, readStatusUpdatedAt } from './session-status.js';
import { stopSession, stopSessionViaCli } from './stop.js';
import {
  compactAge,
  EMPTY_FACTS,
  summarizeTranscript,
  type TranscriptFacts,
} from './transcript.js';

/**
 * The read budget. Only sessions the CLI reported are opened -- single digits
 * in practice -- and each is read for its last `TAIL_BYTES` and no more, so
 * `load()` costs kilobytes against the 814 MB of transcripts on this disk,
 * independent of how large any one of them is. A transcript shared by two
 * resumed processes is read once.
 *
 * The per-process status files are the one read that is per ROW rather than
 * per session -- there is no sharing them, since telling two rows apart is
 * exactly what they are for. Each is a single small JSON document (a few
 * hundred bytes, read whole), so a canvas of single-digit rows costs
 * single-digit kilobytes on top of the tails.
 */
const TAIL_BYTES = 128 * 1024;

/** Where Claude Code keeps transcripts. Derived, never a literal home path. */
export const defaultTranscriptRoot = (): string => join(homedir(), '.claude', 'projects');

/** The last `bytes` of a file, decoded loosely -- a cut token is the parser's problem. */
async function readTail(path: string, size: number, bytes: number): Promise<string> {
  const length = Math.min(size, bytes);
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, size - length));
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * Where each session id's transcript lives, by walking the slug directories
 * once. Names only -- no file is opened and nothing is stat'd here, so an
 * index over 54 transcripts costs ten `readdir` calls.
 */
async function indexTranscripts(root: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  let dirs: string[];
  try {
    dirs = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    // No transcript root: Claude Code has never run for this user, or this is
    // a machine without it. Live sessions can still be listed, with no turns.
    return index;
  }
  for (const dir of dirs) {
    try {
      for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          index.set(entry.name.slice(0, -'.jsonl'.length), join(root, dir, entry.name));
        }
      }
    } catch {
      // A directory that vanished between the two reads.
    }
  }
  return index;
}

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
    const tail = await readTail(path, info.size, TAIL_BYTES);
    return {
      facts: summarizeTranscript(tail, sessionId),
      roster: await readAgentRoster(path, nowMs),
      mtimeMs: info.mtimeMs,
    };
  } catch {
    // An unreadable transcript costs its own turns, never the whole load: the
    // session is live and the operator should still see it.
    return NO_TRANSCRIPT;
  }
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
): Promise<readonly Project[]> {
  const index = await indexTranscripts(root);
  // What the sessions publish about themselves: `sessionId` -> tmux session,
  // out of the same `~/.claude/sessions` files the per-row status read already
  // opens. One `readdir` per load. This is what makes `vamControlled` a fact
  // about a SESSION rather than about a project (`session-pane.ts`).
  const panes = await readPublishedPanes(sessionsRoot);

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
    // Per row, because a row is a process. See the age comment below.
    const statusUpdatedAt =
      agent.pid === null ? null : await readStatusUpdatedAt(sessionsRoot, agent.pid);
    // TRANSCRIPT FIRST, `.git/HEAD` AS FALLBACK. `read.facts.branch` is
    // `gitBranch` as Claude Code itself recorded it per turn -- the branch the
    // session actually ran on, and it costs nothing extra since the transcript
    // is already read. `.git/HEAD` only stands in when there is no transcript
    // yet, or an older one that never wrote `gitBranch`.
    const branch = read.facts.branch ?? (await branchOf(agent.cwd));
    // One question per session, asked in the session's own directory, and
    // throttled by the reader rather than by this loop.
    const prs = readPrs === null ? null : await readPrs({ cwd: agent.cwd, branch });
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
      // WHAT THE WINDOW COSTS. Only the last `TAIL_BYTES` are read, so a
      // question asked far enough back has scrolled out and is simply not
      // here. That is the correct behaviour -- vam reports what it read, not
      // what it supposes -- but it means an empty list is never evidence that
      // a session is not blocked on a question, and nothing downstream may
      // treat it as such. Widening the window to be sure would cost the whole
      // point of reading a tail, and the case it would buy (a session that
      // asked and then produced 128 KB of output while still waiting) is the
      // one where the question is stale anyway.
      questions: read.facts.questions,
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
const NOT_YET_WRITTEN =
  'this round reads only; the CLI does support resuming a session with a prompt, so this is unimplemented rather than impossible';
const NOT_RECORDED = 'a Claude Code transcript records nothing that answers this';
const NO_SURFACE = 'the CLI exposes no such operation on a session, so vam has nothing to call';

const DESCRIPTOR: SourceDescriptor = {
  id: 'claude-code',
  label: 'Claude Code (local sessions, read-only)',
  capabilities: {
    liveUpdates: false,
    // Both true, and they mean different things. `deliverPrompt` is the real
    // claim: `claude --resume <id> -p` appends the turn to the running
    // session's own history, so what vam sends is ANSWERED, not filed. The
    // port makes `recordPrompt` the only required member of a write surface,
    // so delivering is only reachable through it -- which is why it is true
    // as well. See the note on `recordPrompt` below: for this source the two
    // are one operation, and the weaker word is the one that is misleading.
    recordPrompt: true,
    deliverPrompt: true,
    promptAttachments: false,
    slashCommands: false,
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
  },
  declines: {
    // No watch is implemented, so no live badge is claimed: flipping this on
    // without one gives the canvas a badge no event ever arrives at.
    liveUpdates:
      'this source re-reads on demand; nothing watches the session list or the transcripts yet',
    // No entry for recordPrompt or deliverPrompt: a decline is written only
    // for a capability that is false, and both are now true.
    promptAttachments: NOT_YET_WRITTEN,
    slashCommands: NOT_YET_WRITTEN,
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

export const CLAUDE_CODE_SOURCE: MainSource = {
  descriptor: DESCRIPTOR,
  load: async () =>
    loadClaudeCodeProjects(
      defaultTranscriptRoot(),
      await listLiveAgents(),
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
    ),
  /**
   * The live list is re-asked here rather than cached from `load()`: it is
   * where the session's working directory comes from, and a canvas drawn
   * minutes ago may name a session that has since exited. Asking again costs
   * one subprocess and is the difference between refusing a dead session and
   * delivering into the wrong directory.
   */
  recordPrompt: async (sessionId, prompt) =>
    replyToSession({
      agents: await listLiveAgents(),
      rowId: sessionId,
      prompt,
      run: createTmuxRunner(),
      deliver: deliverPromptViaCli,
      // Read fresh, for the same reason the agent list is: a canvas drawn
      // minutes ago is not evidence about which pane a session is in now.
      panes: await readPublishedPanes(defaultSessionsRoot()),
    }),
  /**
   * The live list is re-asked for the same reason `recordPrompt` re-asks it,
   * plus one of its own: `kind` is what decides whether this session can be
   * stopped at all, and a canvas drawn minutes ago is not evidence about a
   * process now.
   */
  closeSession: async (sessionId) =>
    stopSession(
      await listLiveAgents(),
      sessionId,
      (id) => stopSessionViaCli({ sessionId: id }),
      // With a runner in hand, a session vam started is killed rather than
      // refused -- see `stop.ts`. Without one it would still be refused.
      createTmuxRunner(),
      // The published pairing, without which a project holding more than one
      // live session can prove nothing and close refuses every row in it.
      await readPublishedPanes(defaultSessionsRoot()),
    ),
  /**
   * The live list is re-asked here too, and for a third reason of its own: it
   * is the only thing that maps a project id back to a directory, and a
   * canvas drawn minutes ago may name a project whose last session has since
   * exited.
   */
  createSession: async (projectId, title, provider) =>
    createSessionInProject({
      provider,
      agents: await listLiveAgents(),
      projectId,
      title,
      run: createTmuxRunner(),
    }),
  /** No agent list to consult: the operator named the directory themselves. */
  createSessionInDirectory: async (cwd, title, provider) =>
    createSessionInDirectory({ cwd, title, provider, run: createTmuxRunner() }),
};
