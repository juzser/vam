/**
 * The one shape the canvas draws.
 *
 * docs/design/canvas-layout.md §2 established that this is not an invention:
 * black-smith and orca each already treat "a decision waiting for a person" as
 * first-class, and each already has a project layer, a session layer and a
 * notion of how many agents are running. What differs is only the vocabulary.
 * So the adapters translate into these types and the canvas never learns which
 * system it is looking at — which is also what keeps §6's eventual write path
 * honest, because a component that cannot tell the sources apart cannot send
 * one an envelope meant for the other.
 *
 * Everything here is data at rest. No adapter, no fetching, no React.
 */

/**
 * Which system a project or session came from. Adapters set it; the canvas only
 * labels with it.
 *
 * A plain string, not a union of literals: the registry (task-3) is its only
 * validated producer, and a source is free to name itself anything the
 * registry accepts without this file being edited for every new one.
 */
export type SourceId = string;

/**
 * The four states worth a colour on a canvas you read at a glance (§3). A fifth
 * would make the first four mean less.
 *
 * `waiting` is the one that earns the canvas its keep, and it means one precise
 * thing: **the session has finished its turn and the ball is with you.** It
 * answered, or it asked something back, or it handed over commands only you may
 * run — and nothing has been sent since. It does NOT mean "an agent inside it
 * is blocked": a session working through its own subagents is `running`, and
 * you are not meant to do anything about it.
 */
export type SessionStatus = 'running' | 'waiting' | 'done' | 'failed';

/**
 * One round trip between you and a session: your words in, its answer out.
 *
 * NOT one agent turn and NOT one phase (§3, "Node session"). A session runs its
 * own agents — reviewer, verifier, coder — by itself, and none of those becomes
 * a row or a step here. They surface only as the `●N` count and the activity
 * line on the session that owns them. What is a step is the thing you would
 * scroll back through the transcript to find: what you asked, and what came
 * back.
 *
 * Two fields surface on the canvas and nothing else does; the whole agent
 * transcript stays behind `Enter`.
 *
 * The pair is deliberately asymmetric, and this is the definition the adapters
 * must honour:
 *
 *  - `input` — **what the operator put in**: the prompt they typed. Not the
 *    agent's restatement of it, not a summary. This is the half that answers
 *    "what did I ask for", which is the question you cannot reconstruct from
 *    anywhere else on the canvas.
 *  - `output` — **the session's final response**, not its working. A reviewer's
 *    verdict, not the diff it read to reach one.
 *
 * Both render clamped to two lines (§3). Two, not one: a prompt worth
 * distinguishing from the one above it rarely fits in a single line, and a
 * response truncated to one line is usually the same first clause for every
 * session. Two lines is where these become telling rather than decorative.
 *
 * `output` is `null` while the session is **still working on this turn** — it has
 * your prompt and has not finished answering. That is a different thing from an
 * empty string, which would be a turn that resolved to nothing.
 *
 * Note what `null` is NOT: it is not "waiting on you". Those were the same field
 * once and the conflation showed — every unanswered step rendered as a demand
 * for a decision, which made a session quietly getting on with its work look
 * like one blocking on a person. Who owes the next move is a property of the
 * SESSION (`status: 'waiting'`), not of a turn.
 */
export type Decision = {
  readonly id: string;
  /** Who or what is deciding — `reviewer`, `gate`, `sign-off`. */
  readonly label: string;
  /** The prompt the operator typed. */
  readonly input: string;
  /** The session's final response, or `null` while the session is still working. */
  readonly output: string | null;
  /** Commands this decision is asking you to run by hand — see `yy` in §4. */
  readonly commands: readonly Command[];
};

/**
 * A command the agent handed back for a person to run.
 *
 * §4 records why this is a field and not a string to be dug out of prose:
 * black-smith deliberately returns commands as structured data because only the
 * operator may create remotes, push, or send anything outward. `yy` copies
 * `command` verbatim. Vam never runs it.
 */
export type Command = {
  readonly id: string;
  readonly label: string;
  readonly command: string;
};

/**
 * Two immutable facts about how a session came to exist, both read off its
 * timeline: who opened it, and how many times a person has spoken in it.
 *
 * Immutable is the point — a `session-start` actor never changes and a prompt
 * count only grows — which is why they can be derived once per model build
 * and never reconciled.
 *
 * `unknown` and `null` are load-bearing, not placeholders. They mean "vam has
 * not established this", and every filter that reads them treats them as
 * VISIBLE. Hiding something you did not check is how work disappears.
 */
export type SessionOrigin = {
  readonly startedBy: 'human' | 'agent' | 'unknown';
  /** `null` when no timeline has arrived for this session yet. */
  readonly promptCount: number | null;
};

/**
 * One subagent a session spawned, as `Session.agents` lists it.
 *
 * A subagent is still NOT a row on the canvas -- see `runningAgents` below,
 * which is unchanged. This is the roster BEHIND a session, read only when the
 * operator opens the pane's Agents tab, and it answers the question the `●N`
 * badge cannot: which agents, doing what.
 *
 * `type` and `description` are `null` when the source has the agent but not
 * its labels -- Claude Code writes them to a file beside the agent transcript,
 * and that file can be absent, truncated, or written by a newer version with
 * different keys. The agent is still listed: its id and whether it is running
 * are facts either way, and dropping a running agent because a label was
 * unreadable is the failure mode worth avoiding.
 */
export type SessionAgent = {
  /** The agent transcript's own name (`agent-<id>`). Opaque; never parsed. */
  readonly id: string;
  /** What kind of agent it is (`coder`, `uiux`), or `null` when unknown. */
  readonly type: string | null;
  /** What it was asked to do, in the spawner's words, or `null` when unknown. */
  readonly description: string | null;
  /** Whether it is working right now, by the same window `runningAgents` counts. */
  readonly running: boolean;
};

/**
 * How a pull request's checks stand, flattened to the four words a narrow
 * pane can draw.
 *
 * `none` is NOT `passing`. A branch whose PR has no checks configured at all
 * and a branch whose checks all went green are different facts, and merging
 * them is how a pane starts telling the operator a green story about a
 * repository nobody is testing.
 */
export type PullRequestChecks = 'passing' | 'failing' | 'pending' | 'none';

/** One pull request, narrowed to what the pane draws and nothing else. */
export type PullRequest = {
  readonly number: number;
  readonly title: string;
  /** `draft` is its own state, not a flavour of `open`. */
  readonly state: 'open' | 'draft' | 'merged' | 'closed';
  readonly checks: PullRequestChecks;
};

/**
 * What vam knows about a session branch's pull requests.
 *
 * TWO OUTCOMES, AND THE POINT OF THE TYPE IS THAT THEY CANNOT BE CONFUSED.
 * `ok` with an empty list means vam ASKED and the branch genuinely has no
 * pull request. `unavailable` means vam could not ask, or did not understand
 * the answer -- gh missing, gh unauthenticated, no repository, no GitHub
 * remote, a timeout, unreadable output. Rendering the second as an empty list
 * would tell the operator "there is no PR" on the strength of never having
 * found out, which is the one thing this feature must never do.
 *
 * `code` and `message` are deliberately the same pair `SourceError` carries,
 * without being one: there is no source refusing anything here, only a CLI
 * that could not be asked.
 */
export type PullRequestList =
  | { readonly kind: 'ok'; readonly prs: readonly PullRequest[] }
  | { readonly kind: 'unavailable'; readonly code: string; readonly message: string };

/**
 * One option a session offered when it asked a question.
 *
 * `description` is `null` when the record carried none -- the tool makes it
 * optional -- and it is not a placeholder for the label. Both are drawn: the
 * label is what the option IS, the description is why you would pick it, and a
 * list of labels alone is a list of words the operator has to guess between.
 */
export type QuestionOption = {
  readonly label: string;
  readonly description: string | null;
};

/**
 * A question a session asked its operator through the `AskUserQuestion` tool.
 *
 * NOT every question a session asks. One written in prose inside an answer has
 * no structure to read and never becomes one of these -- the pane's `out`
 * region already shows that text. This type covers only the questions recorded
 * as a tool call, which is exactly the case where vam knows the options.
 *
 * `answer` IS THE OPEN/CLOSED FLAG, and it is derived from the transcript
 * rather than from status: `null` means the question's `tool_use` has no
 * matching `tool_result` yet, so the session is still waiting on a person; a
 * string is what was answered. Anything drawn from an answered question must
 * not look like it is still waiting.
 *
 * VAM CANNOT ANSWER ONE. Picking an option here delivers nothing -- the only
 * write channel vam has is the prompt box of a session it started -- so the UI
 * that renders this must never imply an answer was submitted.
 */
export type AgentQuestion = {
  /** The `tool_use` id plus the question's position within that call. */
  readonly id: string;
  /** The tool's own short label for the question, or `null` when absent. */
  readonly header: string | null;
  readonly question: string;
  /** Whether several options may be picked, as the record states it. */
  readonly multiSelect: boolean;
  readonly options: readonly QuestionOption[];
  /** `null` while the question is still open; otherwise what was answered. */
  readonly answer: string | null;
};

export type Session = {
  readonly id: string;
  /** Short name on the node header — an epic id, a task id, a run name. */
  readonly title: string;
  /**
   * A single glyph the operator picked, or `null` for none.
   *
   * Borrowed from orca, where a workspace carries one. It earns its place for
   * the same reason there: a list of a dozen sessions named `D-2xx` is a list
   * you read character by character, and a glyph is the thing the eye finds
   * before it starts reading. It is chosen by a person and means whatever they
   * decided — nothing derives it, and nothing should.
   */
  readonly icon: string | null;
  /** Optional second label beside the title, e.g. which epic a task belongs to. */
  readonly epic: string | null;
  readonly status: SessionStatus;
  /**
   * How many agents this session is running right now — the `●N` on the header
   * (§3). This is the ONLY place a subagent appears: it is work happening under
   * a session you started, not a session of its own, and giving it a row would
   * turn a list of four things you own into a list of forty you do not.
   */
  readonly runningAgents: number;
  /**
   * The single activity line, already truncated to one line's worth of meaning
   * by the adapter. `null` when the source cannot say — which is today's state
   * for black-smith until its worker-heartbeat epic lands (§5 epic B), and must
   * render as "no line", never as an empty spinner pretending to be live.
   */
  readonly activity: string | null;
  /**
   * How long ago the session last did anything, already in the compact form the
   * sidebar right-aligns (`2m`, `6h`, `3d`).
   *
   * Split out of `activity`, which used to carry both. The ADE mockup puts the
   * two at opposite ends of the same row — what it did on the left, how long
   * ago on the right — and a single pre-joined string cannot be put in two
   * places. `null` where the source cannot say.
   */
  readonly age: string | null;
  /**
   * The git branch the session's working directory is on, drawn on the left
   * of the same row `age` right-aligns.
   *
   * `null` means the source cannot say -- not "no branch". A source that has
   * no notion of a working directory at all (black-smith, today) reports
   * `null` for every session; a source that does but hits an unreadable or
   * malformed repository for one particular session reports `null` for that
   * session alone. Neither is "not on a branch", which git itself has no
   * concept of.
   */
  readonly branch: string | null;
  /** Newest first. The canvas shows the first three; §3. */
  readonly decisions: readonly Decision[];
  /**
   * Which system this session came from. Optional because merging several
   * sources into one project group (this task's point) cannot force every
   * existing fixture to name one at once.
   */
  readonly source?: SourceId;
  /**
   * The subagents this session spawned, newest first, or absent when the
   * source has no such surface.
   *
   * ABSENT AND EMPTY MEAN DIFFERENT THINGS, and the pane says so. Absent is a
   * source that cannot answer -- black-smith's HTTP model has no agent
   * surface, so `to-canvas.ts` leaves it out. Empty is a source that looked
   * and found none, which is the COMMON case: most sessions never spawn a
   * subagent. Neither is a reason to draw a spinner or invent a row.
   *
   * Populated today by the `claude-code` source alone, off
   * `<sessionId>/subagents/`. Optional for the same reason `origin` is: a
   * dozen fixture files build `Session` literals by hand.
   *
   * This is CAPPED at the source (see `agent-roster.ts`), so its length is not
   * a count -- `runningAgents` remains the only number the badge trusts.
   */
  readonly agents?: readonly SessionAgent[];
  /**
   * The pull requests open on this session's branch, or vam's reason for not
   * knowing.
   *
   * THREE STATES, the same shape `agents` established. ABSENT is a source
   * with no pull-request surface at all -- black-smith's HTTP model has none,
   * so `to-canvas.ts` leaves it out. `{ kind: 'ok', prs: [] }` is a source
   * that ASKED GitHub and found none. `{ kind: 'unavailable' }` is a source
   * that has the surface and could not use it, and it says why.
   *
   * Populated by the `claude-code` source alone, which shells out to `gh` in
   * the session's own working directory (`pull-requests.ts`). Optional for
   * the same reason `agents` is: a dozen fixture files build `Session`
   * literals by hand.
   */
  readonly pullRequests?: PullRequestList;
  /**
   * How this session came to exist. Optional because ten fixture files build
   * `Session` literals by hand, and because a model assembled without a
   * timeline genuinely has nothing to say here — absent reads exactly like
   * `unknown`, which is the visible-by-default case.
   */
  readonly origin?: SessionOrigin;
  /**
   * Whether vam can ACT on this session directly -- close it, and in time
   * reach it -- because vam started it and can still prove which pane it is.
   *
   * NAMED FOR WHAT IT MEANS, NOT FOR HOW IT IS OBTAINED. Today the fact comes
   * from the `@vam-project` option tmux records on a session vam created, and
   * from the two-condition pairing `reply.ts` documents; if the pairing ever
   * changes, the question this answers does not.
   *
   * NOT `origin`. `origin.startedBy` records WHO began a session -- a person,
   * an agent, or nobody who can say -- which is orthogonal: a session a human
   * started through vam is `human` AND controlled.
   *
   * THREE STATES, the shape `agents` and `pullRequests` established. `true` is
   * a proven pairing. `false` is vam having ASKED and found none. ABSENT is
   * vam not being able to ask at all -- no tmux, no server, a source with no
   * such surface, a fixture -- and it must not collapse into `false`: "vam did
   * not start this" and "vam has no idea" lead to different UI, and the second
   * one is not a licence to offer a control that will refuse.
   */
  readonly vamControlled?: boolean;
  /**
   * The `AskUserQuestion` questions this session asked, oldest first, or
   * absent when the source has no such surface.
   *
   * The same three-state shape `agents` established. ABSENT is a source that
   * cannot say -- black-smith's HTTP model records no tool calls. EMPTY is a
   * source that looked and found none, which is the COMMON case: most
   * sessions never ask through the tool. Neither is a reason to draw an empty
   * box where a question would go.
   *
   * A question older than the transcript tail vam reads (`TAIL_BYTES` in
   * `sources/claude-code/source.ts`) has scrolled out of the window and is
   * absent here -- which is why a pane may show none while a session is in
   * fact blocked on one, and why nothing in this app treats an empty list as
   * "this session is not waiting on you".
   */
  readonly questions?: readonly AgentQuestion[];
};

export type Project = {
  readonly id: string;
  readonly name: string;
  /**
   * Which system this project's sessions came from, where they share one.
   *
   * SUPERSEDED AS A SESSION FACT, NOT REMOVABLE. A project mixes sessions
   * from several sources now, so this id no longer describes every session
   * under it; `Session.source` is the per-session truth and wins wherever
   * both are present (the status glyph's arm order, asserted in
   * `Canvas.usage.test.tsx`). This field remains the FALLBACK for sessions
   * carrying no source of their own — the factory adapter stamps only this
   * one — so deleting it blanks the glyph for every such session.
   *
   * DELETING IT IS A PERSISTED-DATA MIGRATION, NOT A DELETE. Three prefs
   * buckets are keyed on this value at the top level of stored JSON:
   * `renames`, `icons` and `projectIcons` (`prefs.ts`, `applyRenames` and
   * `applyIcons`). Dropping the field orphans every rename and every icon
   * an operator has saved, silently, on their next launch. Whoever removes
   * it re-keys those three buckets and ships a migration for existing
   * stores FIRST; until then the ten call sites that read it are correct.
   */
  readonly source?: SourceId;
  readonly sessions: readonly Session[];
  /**
   * A single glyph the operator picked for this project's heading, or `null`
   * for none — one level up from `Session.icon`, same idea. Optional (unlike
   * `Session.icon`, which is required) so every existing `Project` literal
   * across the fixtures and adapters stays legal without an edit.
   */
  readonly icon?: string | null;
};

/** Everything the canvas draws in one frame. */
/**
 * Token spend against budget, when the source has such a thing.
 *
 * Optional on the model on purpose: a budget is a property of the FACTORY,
 * not of sessions. A source reading local transcripts has no budget and must
 * be able to say so by omission rather than by inventing a zero.
 */
export type CanvasBudget = {
  readonly tokensSpent: number;
  readonly tokensBudget: number;
  /** The factory's own figure, not recomputed here — it can exceed 100. */
  readonly usedPct: number;
};

export type CanvasModel = {
  readonly projects: readonly Project[];
  readonly budget?: CanvasBudget | null;
};
