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

/** Which system a project came from. Adapters set it; the canvas only labels with it. */
export type SourceId = 'black-smith' | 'orca';

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
  /** Newest first. The canvas shows the first three; §3. */
  readonly decisions: readonly Decision[];
};

export type Project = {
  readonly id: string;
  readonly name: string;
  readonly source: SourceId;
  readonly sessions: readonly Session[];
};

/** Everything the canvas draws in one frame. */
export type CanvasModel = {
  readonly projects: readonly Project[];
};
