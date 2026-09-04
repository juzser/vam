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
   * How this session came to exist. Optional because ten fixture files build
   * `Session` literals by hand, and because a model assembled without a
   * timeline genuinely has nothing to say here — absent reads exactly like
   * `unknown`, which is the visible-by-default case.
   */
  readonly origin?: SessionOrigin;
};

export type Project = {
  readonly id: string;
  readonly name: string;
  /**
   * @deprecated A project mixes sessions from several sources now (this
   * task's point), so one id on the project no longer means anything;
   * `Session.source` is the field that carries it. Kept optional, not
   * removed, so fixtures across ten files stay legal — removal is task-9b's.
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
