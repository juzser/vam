/**
 * The one shape the canvas draws.
 *
 * This is not an invention: the factory and orca each already treat "a
 * decision waiting for a person" as
 * first-class, and each already has a project layer, a session layer and a
 * notion of how many agents are running. What differs is only the vocabulary.
 * So the adapters translate into these types and the canvas never learns which
 * system it is looking at — which is also what keeps the eventual write path
 * honest, because a component that cannot tell the sources apart cannot send
 * one an envelope meant for the other.
 *
 * Everything here is data at rest. No adapter, no fetching, no React.
 */

import type { ProviderId } from '../../shared/providers.js';

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
 * The states worth a colour on a canvas you read at a glance.
 *
 * `waiting` is the one that earns the canvas its keep, and it means one precise
 * thing: **the session has finished its turn and the ball is with you.** It
 * answered, or it asked something back, or it handed over commands only you may
 * run — and nothing has been sent since. It does NOT mean "an agent inside it
 * is blocked": a session working through its own subagents is `running`, and
 * you are not meant to do anything about it.
 *
 * THE FIFTH, AND WHY THIS LIST GREW. This comment said for a long time that a
 * fifth status "would make the first four mean less". It was four statuses
 * that were making `waiting` mean less: the Claude Code source read every
 * interactive row the CLI did not call `busy` as `waiting`, and the CLI's own
 * word for a live session doing nothing is `idle` — measured, three of five
 * interactive rows on a working machine. So after a day's work every finished
 * session was amber, the sidebar's loud count was a count of nothing, and the
 * one colour that must be believed was the one an operator learns to ignore.
 *
 * `idle` is therefore a status of its own and NOT a synonym for `done`. `done`
 * is a job that ENDED — the only rows that can honestly report it are the
 * background ones (`main/sources/claude-code/agents.ts`), and `stop.ts`
 * refuses to stop such a row because there is nothing left running. An idle
 * session is the opposite: alive, attached, stoppable, and simply between
 * turns. Folding the two would trade an amber lie for a grey one and lose
 * "this agent is sitting there ready" from the canvas entirely.
 *
 * Its colour is a neutral, deliberately: `idle` is the absence of news, and
 * the four hues stay spent on states that are news.
 *
 * `unstarted` IS THE SIXTH, and it is not a synonym for any of the five: a
 * pane is open and NOTHING has been started in it. `docs/design/vam-owns-the-
 * session.md` §3 -- a new session is a shell in a tmux pane vam owns, real
 * from the first frame, and the provider is chosen afterwards. Such a row has
 * no transcript, no turn and no agent; it has a Terminal view that works and a
 * Response view whose whole content is the provider picker and Start. The
 * row is the tmux session's (`main/sources/claude-code/pane-row.ts`) and it
 * lives exactly as long as that does -- it is never a paint on a timer. It
 * is never `idle` (which is an AGENT between turns), never `done` (nothing
 * ended), and never `waiting` (nothing asked). Its colour is the neutral
 * `idle` shares, because it too is the absence of news.
 *
 * `terminal` IS THE SEVENTH: the operator's own words, "a session should have
 * a 'terminal only' state" -- a pane vam started, whose agent has exited (by
 * `/exit`, Ctrl+C, or on its own), leaving the shell in the pane's foreground
 * again, WHILE the conversation it hosted is still known -- vam has a native
 * session id for it (`docs/design/vam-terminal-only.md`; the pane's own
 * `@vam-session` tmux option, or the published pane a live row proved this
 * poll — `main/sources/claude-code/pane-row.ts`). It differs from `unstarted`
 * in exactly that one fact: `unstarted` is a pane that has NEVER hosted a
 * conversation, so its `title` is the tmux session's own name and it carries
 * no transcript; `terminal` is a pane that HAS, so its `title`, `branch` and
 * `decisions` are the conversation's own, read off the transcript exactly as
 * a live row's are — identity survives the exit. Never `idle` (which is an
 * AGENT between turns — this row has no agent at all), never `done` (Claude
 * Code's own word for a conversation that ended, which this one has not:
 * typing the provider's command, by hand or through Resume, continues it),
 * and never `waiting` (nothing asked, and MUST NOT queue the "waiting" OS
 * notification — `notify/waiting.ts`'s rule is `!== 'waiting' -> 'waiting'`,
 * so a status this union never assigns can never cross it). Its colour is the
 * same neutral `idle` and `unstarted` share: the pane is alive and typeable,
 * asking for nothing.
 *
 * Every surface that paints a status keys a `Record<SessionStatus, …>` off
 * this union — the tab ink and dot, the sidebar dot, the phone dot, the rank
 * order, the filter tally. That is the guard against this list growing again
 * behind someone's back: add a member and the maps stop compiling.
 */
export type SessionStatus =
  | 'running'
  | 'waiting'
  | 'idle'
  | 'done'
  | 'failed'
  | 'unstarted'
  | 'terminal';

/**
 * One round trip between you and a session: your words in, its answer out.
 *
 * NOT one agent turn and NOT one phase. A session runs its
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
 * Both render clamped to two lines. Two, not one: a prompt worth
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
  /**
   * WHEN THE OPERATOR ASKED, ISO-8601, and when this turn last did anything.
   *
   * The In bubble pins a turn's prompt while the activity line under it stays
   * live, so on a long turn the two are hours apart and the pin reads as the
   * current question. These are what let the pane say otherwise.
   *
   * OPTIONAL, AND NULL IS ORDINARY, on the rule this file already keeps for
   * `errorCount`: absent means the SOURCE cannot say. Claude Code's
   * `last-prompt` marker carries no timestamp at all (0 of 25,259 measured),
   * so a turn whose prompt line is above the top of the read window has no
   * honest time to report -- and the first thing that happened afterwards is
   * the answer's time, not the question's.
   */
  readonly promptedAt?: string | null;
  readonly latestAt?: string | null;
  /**
   * How many tool calls FAILED inside this turn, of the ones vam read.
   *
   * WHY IT EXISTS. A turn's mark on the progress line was binary — working or
   * answered — so a turn whose tools blew up three times still read `✓`, and
   * the collapsed line said "12 turns read" over a run that was on fire.
   * Collapsing intermediate work may cost the operator DETAIL; it must never
   * cost them ALARM.
   *
   * READ, NOT INFERRED. A failed tool call is recorded explicitly: an
   * `is_error: true` on the `tool_result` part, the same field `deliver.ts`
   * already reads to tell a refusal from a delivery. Nothing here is derived
   * from a message that merely correlates with failure — a false badge would
   * be worse than none, because it teaches the operator to distrust the one
   * signal that has to be trusted.
   *
   * A COUNT OF WHAT WAS READ, like `decisions` itself. The window is the
   * newest `TAIL_BYTES` of the transcript, so a failure older than that
   * window was never seen and is not in this number. It sits BESIDE the
   * "turns read" qualifier and does not weaken it.
   *
   * OPTIONAL, and the two states differ: ABSENT is "this source cannot report
   * tool failures", which must draw nothing. ZERO is a reading — vam looked
   * and found none.
   */
  readonly errorCount?: number;
  /**
   * The tool calls vam read inside this turn, oldest first — the turn's
   * working, which the column draws when focus view is off.
   *
   * WHY IT EXISTS. Focus view's whole promise is "hide tool calls and other
   * in-progress activity"; turned off it drew one line per turn carrying the
   * turn's mark and the agent's name, because that is all a turn held. The
   * calls were in the transcript all along and the reader discarded them: it
   * read every `tool_use` part and kept only the newest one in the whole
   * window, as `Session.activity`. A mode that hides working has to have
   * working to hide.
   *
   * IT DOES NOT REPLACE `errorCount`, and the two answer different questions.
   * This is a LIST, which a folded line cannot draw; that is a COUNT, which
   * says "something blew up in here" in one glyph and also counts failures vam
   * could not attribute to any call it read — a window that opened between a
   * call and its result. Neither is derived from the other.
   *
   * A LIST OF WHAT WAS READ, like `decisions` and like `errorCount`: the window
   * is the newest `TAIL_BYTES` of the transcript, so a call older than that
   * window is not in here, and this is never a claim about the run.
   *
   * OPTIONAL, on the same rule as `errorCount`: ABSENT is "this source cannot
   * report tool calls" and EMPTY is a reading — vam looked, and the turn called
   * nothing.
   */
  readonly steps?: readonly TurnStep[];
  /**
   * THE ONE FIELD NO SOURCE MAY SET. True on a turn VAM ITSELF painted: the
   * prompt the operator just sent, drawn as the newest turn from the moment it
   * left, before any source has reported it back (`optimistic.ts`).
   *
   * WHY IT IS ON THE MODEL AT ALL. Every other reader goes on treating a paint
   * exactly as it treats a real turn, which is the whole point of painting into
   * the model rather than beside it. The exception is a reader that draws a
   * turn's ABSENCES -- "this turn ended without an answer" and its three
   * siblings in `DetailPanel.tsx` -- because every one of those sentences is a
   * claim about what the SOURCE reported, and on a paint no source has
   * reported anything at all. Nothing ended; vam has not heard back.
   *
   * ABSENT IS THE ORDINARY CASE and means "this turn came from outside". It is
   * not a source reading and has no `null` state, so unlike `errorCount` there
   * is no third thing to distinguish: a source adapter that sets it is stating
   * something untrue about its own data.
   *
   * NOT AN ID PREFIX. `optimistic.ts` does mint its ids as `vam-pending-N` and
   * the panel could have matched on that, but an id's SHAPE is not a promise
   * -- ids arrive from outside vam, and a display that keys on one is a
   * display a source can spoof by accident.
   */
  readonly unconfirmed?: boolean;
  /**
   * True on a turn vam minted from a window in which it could read NO
   * conversation at all -- and therefore a turn whose answer vam has no
   * evidence about, either way.
   *
   * WHY THIS IS A SEPARATE STATE AND NOT `output: null`. `null` is a reading:
   * the source looked at this turn and collected no answer event, which is
   * what a turn still in flight looks like. This is the ABSENCE of a reading,
   * and the two were conflated for exactly as long as it took an operator to
   * notice -- the Response view said "this turn ended without an answer" while
   * the Terminal tab beside it held the agent's full reply.
   *
   * WHAT PRODUCES IT, measured rather than imagined. A transcript is read as a
   * byte window from the end, and a single LINE can be larger than the whole
   * window: 670 of them across 23 of the 85 session transcripts on the machine
   * this was written for, the largest 1,356,930 bytes. One such line sitting in
   * the window leaves it holding no `user` and no `assistant` line at all, and
   * then the only thing able to open a turn is the `last-prompt` marker --
   * whose branch has no answer to give, because the answer was never read.
   * `tail.ts` now widens past such a line; this is what is reported when even
   * the widened read found nothing, and a bounded read must be allowed to give
   * up somewhere.
   *
   * ABSENT IS THE ORDINARY CASE, on the same rule as `errorCount` and
   * `unconfirmed`: absent means this turn came out of a window vam really
   * read. It is NOT a second `unconfirmed` -- that one is vam's own paint,
   * about which no source has said anything yet; this is a source that said
   * something vam could not reach.
   */
  readonly unread?: boolean;
};

/**
 * One tool call, as a row of a turn's working.
 *
 * A NAME, NOT A TRANSCRIPT. The call's input is not carried — a file's whole
 * contents rides in there — nor its result, nor any timing. What a progress row
 * answers is "what did it do next", and the answer is the tool's name plus the
 * description the tool itself wrote, where it wrote one.
 */
export type TurnStep = {
  /**
   * Vam's own, minted from the turn's id and the call's position in it.
   *
   * NOT THE PROVIDER'S `tool_use.id`, though all 63,622 calls in the measured
   * corpus carried one: a list keyed on a value vam does not mint collapses two
   * rows the day one repeats, and nothing here needs the id to mean anything
   * outside its own turn.
   */
  readonly id: string;
  /** `Bash`, or `Bash: run the tests` — cut at the activity line's own limit. */
  readonly label: string;
  /**
   * Did the call's result come back `is_error: true`?
   *
   * READ, NOT INFERRED, and `=== true` rather than truthy — the same rule
   * `errorCount` keeps, for the same reason: a false failure badge is worse
   * than none. FALSE therefore also covers "no result was read", which is the
   * state of every call still running and of one whose result fell outside the
   * window. A row is marked only on the evidence of a failure.
   */
  readonly failed: boolean;
};

/**
 * A command the agent handed back for a person to run.
 *
 * §4 records why this is a field and not a string to be dug out of prose:
 * the factory deliberately returns commands as structured data because only the
 * operator may create remotes, push, or send anything outward. `yy` copies
 * `command` verbatim. Vam never runs it.
 */
export type Command = {
  readonly id: string;
  readonly label: string;
  readonly command: string;
};

/**
 * A tier of the `/` list vam could not read, in the source's own words.
 *
 * `code` is for a reader that wants to branch (`cli-missing`, `timed-out`,
 * `refused`, ...); `message` is the sentence a person reads. Both, for
 * `PullRequestList`'s reason: a code alone cannot be shown and a message alone
 * cannot be matched on.
 */
type SlashCommandGap = {
  readonly code: string;
  readonly message: string;
};

/** One command the PROVIDER configures -- `Command` above is agent-proposed. */
export type SlashCommand = {
  readonly id: string;
  /** Without the leading `/` -- the composer adds that back on completion. */
  readonly name: string;
  readonly description: string | null;
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

/**
 * Where a pull request stands with its reviewers, in the three words GitHub
 * itself has. `null` is the fourth state and the common one: a repository with
 * no review rules answers the EMPTY STRING here, measured, on every row --
 * see `pull-requests-detail.test.ts`. Folding that into `review-required`
 * would print "review required" over every pull request the operator owns.
 */
export type PullRequestReview = 'approved' | 'changes-requested' | 'review-required';

/**
 * Whether GitHub thinks this would merge cleanly. `null` is not a fourth
 * answer invented here: gh's own `UNKNOWN` is what most rows carry, because
 * GitHub computes mergeability lazily and had not been asked. It is emphatic-
 * ally not `conflicting`.
 */
export type PullRequestMergeable = 'mergeable' | 'conflicting';

/**
 * One pull request, narrowed to what the pane draws and nothing else.
 *
 * TWO CLASSES OF FIELD, AND THE TYPE SAYS WHICH IS WHICH. The first four are
 * the row's IDENTITY and are never absent: a payload that cannot supply them
 * fails the whole list as `bad-response` (`pull-requests.ts`), because a
 * shortened list is indistinguishable from a true one. Everything below them
 * is DESCRIPTION, is `| null`, and `null` means gh did not say -- it is a
 * state, exactly as `PullRequestList`'s `unavailable` arm is, and it is never
 * a zero. `additions: 0` is a pull request that only deletes; `additions:
 * null` is a payload that never mentioned lines. A pane drawing "+0" for the
 * second would be this file's own rule broken one field down.
 *
 * They grew on the operator's report -- "it does not show line changes (+/-)"
 * and "it needs more information" -- and every name was checked against
 * `gh pr list --help`'s own JSON field list before it was asked for.
 */
export type PullRequest = {
  readonly number: number;
  readonly title: string;
  /** `draft` is its own state, not a flavour of `open`. */
  readonly state: 'open' | 'draft' | 'merged' | 'closed';
  readonly checks: PullRequestChecks;
  /** Lines added, lines removed, files touched. `null` is "gh did not say". */
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly changedFiles: number | null;
  /** The branch this merges FROM -- and the one a delete-branch action names. */
  readonly headRefName: string | null;
  /** The branch it merges INTO. Drawn as `head -> base`, which is the sentence. */
  readonly baseRefName: string | null;
  /** The author's LOGIN, out of the object gh nests it in; not the display name. */
  readonly author: string | null;
  readonly review: PullRequestReview | null;
  /** ISO 8601, as gh wrote it. Turned into "3h ago" at the point of drawing,
   *  because a relative time is a fact about NOW and must not be frozen into
   *  the model on a ten-second poll. */
  readonly updatedAt: string | null;
  /** Label names, in gh's order. ALWAYS a list -- never `null` -- so nothing
   *  downstream has to ask whether it may iterate. */
  readonly labels: readonly string[];
  /**
   * The pull request's own address, and `null` unless it is one vam would
   * actually open (`src/shared/pr-link.ts`: https, on github.com). A row with
   * `null` here draws no link rather than a link that refuses when pressed --
   * absent, not dimmed. Main checks again at the channel; this is convenience,
   * and the process boundary is the guarantee.
   */
  readonly url: string | null;
  readonly mergeable: PullRequestMergeable | null;
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
  /**
   * What picking this option would PRODUCE, as the tool wrote it -- a colour,
   * a path, a snippet of the thing that would be created. `null` when the
   * record carried none.
   *
   * NOT the description. The description is why you would pick it; this is
   * what you would get, and 127 of 917 options in real data carry one. It was
   * dropped for as long as this type had two fields.
   *
   * OPTIONAL, and `null` and absent mean the same thing here -- the tool
   * offered none. That is not the three-state shape `vamControlled` and
   * `questions` use, and deliberately: those distinguish "vam looked and found
   * nothing" from "vam could not look", a distinction one field of one option
   * inside a record vam has already parsed cannot have. Optional keeps every
   * fixture that predates the field valid, which is what it is worth.
   */
  readonly preview?: string | null;
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
  /** Short name shown on the tab and the sidebar row — an epic id, a task id, a run name. */
  readonly title: string;
  /** Optional second label beside the title, e.g. which epic a task belongs to. */
  readonly epic: string | null;
  readonly status: SessionStatus;
  /**
   * HAS THIS CONVERSATION FINISHED — as something the source MEASURED?
   *
   * Absent means no source said so, which is not the same as `false`, and is
   * why it is optional: a source that has never looked leaves it off, and
   * nothing downstream may read the absence as "still going".
   *
   * ── WHY THIS IS NOT SIMPLY `status === 'done'` ────────────────────────────
   *
   * Because `done` is already spoken for, by a different thing wearing the
   * same word. Claude Code reports `done` for a BACKGROUND AGENT that has
   * finished inside a session the operator is still working in
   * (`sources/claude-code/agents.ts`) — a row that belongs on the canvas,
   * beside the work it came out of. Hiding those was tried here and measured:
   * it broke 461 assertions across 62 files, which is this repo's own corpus
   * saying that a `done` row is ordinary furniture.
   *
   * What the operator asked to stop seeing is the other thing — a finished
   * CONVERSATION a source went and dug out of an archive: "Don't show recent
   * threads, it makes managing active sessions harder." The Codex source sets
   * this from a writer-lock probe (`main/sources/codex/liveness.ts`), and only
   * where that probe actually answered; where it could not look the field
   * stays off rather than claiming an ending nobody observed.
   *
   * `status` still answers the other question — what colour the row is — and
   * such a session is `done` there too. One fact seen from two sides, not one
   * boolean doing two jobs.
   */
  readonly ended?: boolean;
  /**
   * How many agents this session is running right now — the `●N` on the header.
   * This is the ONLY place a subagent appears: it is work happening under
   * a session you started, not a session of its own, and giving it a row would
   * turn a list of four things you own into a list of forty you do not.
   */
  readonly runningAgents: number;
  /**
   * The single activity line, already truncated to one line's worth of meaning
   * by the adapter. `null` when the source cannot say — which is today's state
   * for the factory until it can report a per-worker heartbeat, and must
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
   * no notion of a working directory at all (the factory, today) reports
   * `null` for every session; a source that does but hits an unreadable or
   * malformed repository for one particular session reports `null` for that
   * session alone. Neither is "not on a branch", which git itself has no
   * concept of.
   */
  readonly branch: string | null;
  /**
   * WHEN THIS SESSION WAS CREATED, ISO-8601 -- the fact `sortBy: 'created'`
   * (`selectors.ts`) orders on, so a poll that changes `status` or `age`
   * never moves a row under it.
   *
   * OPTIONAL, on the rule every fact-a-source-may-not-have follows here
   * (`origin`, `pullRequests`): absent is "nobody asked or nobody could
   * say", not "created at the epoch" -- and dozens of fixtures across this
   * suite build a `Session` literal with no opinion about it.
   *
   * A SOURCE'S BEST EVIDENCE, not a promise of ground truth. `claude-code`
   * reads it off the transcript file's own birthtime (`source.ts`; a tail
   * read never opens the file's FIRST line -- `transcript.ts`'s own header
   * says why -- so birthtime is what the same `stat()` the age already
   * costs can answer for free) and falls back to the tmux pane's
   * `session_created` for a row with no transcript yet. `codex` reads the
   * timestamp Codex itself embeds in the rollout's own file name
   * (`rollout.ts`), never `recency_at_ms` -- `docs/design/vam-owns-the-
   * session.md`'s own trap: a recency moves every poll and is not a start
   * time.
   */
  readonly createdAt?: string | null;
  /** Newest first. The canvas shows the first three. */
  readonly decisions: readonly Decision[];
  /**
   * WHEN CLAUDE CODE'S OWN PROMPT CACHE WAS LAST READ OR WRITTEN, ISO-8601,
   * and how long that entry lives from that moment (`cacheTtlMs`) -- together
   * what the sidebar's cache-timer countdown counts down from
   * (`domain/cache-timer.ts`). `main/sources/claude-code/cache-activity.ts`
   * carries the whole reading rule, off the transcript tail already read for
   * `decisions`.
   *
   * OPTIONAL, on the rule every fact only one source answers today follows
   * (`createdAt`, `source`): absent is "nobody asked", not "no cache
   * activity" -- `claude-code`'s own reader always computes a verdict, `null`
   * included, so `null` here means THIS source looked and found none, while
   * absent means a different source (which has no such cache to report on),
   * or a row built by a path this feature has not been threaded through
   * (`pane-row.ts`'s empty and terminal-only rows).
   */
  readonly lastCacheActivityAt?: string | null;
  /** `null` exactly when `lastCacheActivityAt` is `null` -- there being no
   *  timer to time. Absent under the same rule as `lastCacheActivityAt`. */
  readonly cacheTtlMs?: number | null;
  /**
   * THE SOURCE'S OWN CLOCK, `Date.now()` AT THE MOMENT it computed the pair
   * above -- so a device with a clock that disagrees with the source's can
   * still show a correct countdown.
   *
   * WHY THIS EXISTS: `lastCacheActivityAt` is stamped on the machine running
   * Claude Code, not on the machine looking at the sidebar. On a paired
   * phone reached over Tailscale Serve those are different devices, and a
   * countdown that subtracted this device's own `Date.now()` from a
   * timestamp a DIFFERENT clock wrote would be wrong by however far the two
   * clocks disagree -- the operator's own report. `Session.age` never has
   * this problem because it is a STRING the source already finished
   * computing; a live countdown cannot be pre-rendered the same way and
   * still tick, so it needs the source's clock reading alongside its data
   * instead. `panels/CacheCountdown.tsx` is the one reader: it captures the
   * OFFSET between this device's clock and this value, once, the moment a
   * fresh reading of it arrives, and applies that fixed offset to every
   * later live tick rather than re-deriving it from a device clock that has
   * since moved on (which would just cancel the correction back out).
   *
   * `null` exactly when `lastCacheActivityAt` is `null` -- there being no
   * reading to time. Absent under the same rule as `lastCacheActivityAt`:
   * a source that has not been taught this yet, or a fixture with no
   * opinion about it, and `CacheCountdown.tsx` falls back to the device's
   * own clock uncorrected rather than throwing.
   */
  readonly cacheSourceNowMs?: number | null;
  /**
   * Which system this session came from. Optional because merging several
   * sources into one project group (this task's point) cannot force every
   * existing fixture to name one at once.
   */
  readonly source?: SourceId;
  /**
   * The commands the PROVIDER configures -- what `/` offers, as distinct
   * from `decisions[].commands`. Absent means no such surface; empty means
   * the source looked and found none, the common case for `claude-code`.
   */
  readonly slashCommands?: readonly SlashCommand[];
  /**
   * WHY THE `/` LIST IS SHORT OF WHAT THE PROVIDER ITSELF WOULD OFFER, when
   * vam knows that it is. Absent is the ordinary state: every tier vam has was
   * read.
   *
   * IT EXISTS BECAUSE THE LIST HAS TIERS THAT FAIL DIFFERENTLY. Command FILES
   * (`~/.claude/commands`, `<cwd>/.claude/commands`) are silent by design --
   * a directory that is not there means the operator wrote no commands, which
   * is a reading and not a failure. The provider's BUILT-INS are not files:
   * vam has to ask the installed CLI for them (`builtin-commands.ts`), and
   * that question can genuinely fail -- no CLI on `PATH`, a version that does
   * not answer, a timeout. `pull-requests.ts` states the rule this serves:
   * "no commands match" and "vam could not read the commands" must never look
   * the same, and a list quietly missing fifty entries is the second wearing
   * the first's clothes.
   *
   * A `PullRequestList`-style union will not do here, because the failure is
   * PARTIAL: the file tiers can be read while the built-ins are not, and the
   * operator should still get the commands vam does have. So the list stays
   * the list, and this sits beside it naming what is missing from it.
   */
  readonly slashCommandGap?: SlashCommandGap;
  /**
   * The subagents this session spawned, newest first, or absent when the
   * source has no such surface.
   *
   * ABSENT AND EMPTY MEAN DIFFERENT THINGS, and the pane says so. Absent is a
   * source that cannot answer -- the factory's HTTP model has no agent
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
   * with no pull-request surface at all -- the factory's HTTP model has none,
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
   * IS THIS SESSION'S WORKING DIRECTORY A CLAUDE CODE AGENT WORKTREE --
   * `<repo>/.claude/worktrees/agent-<id>`, minted by a subagent run with
   * `isolation: "worktree"`, never a session the operator opened themselves.
   * `agent-worktree.ts`'s own header carries the two-signal rule this is
   * computed by (a realpath'd path segment, or a `worktree-agent-*`
   * branch) and the reason it cannot be confused with vam's OWN worktree
   * feature (PR 496), a different directory layout entirely.
   *
   * `true` ONLY, on the SAME rule `pane`/`vamControlled` already use for a
   * fact a source either measured or did not: absent means "not this",
   * exactly like `false` would, so it is left off rather than spelled out
   * on the session literals across this whole suite that predate it.
   *
   * `session-filter.ts`'s `isHiddenByAgentWorktreeFilter` is the one reader.
   */
  readonly isAgentWorktree?: boolean;
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
   * WHY THIS SOURCE COULD NOT CONFIRM ITS OWN OWNERSHIP THIS LOAD -- absent on
   * every ordinary poll, present only while vam's tmux spine itself could not
   * be read (`docs/design/vam-owns-the-session.md`'s own trap: "an unreadable
   * tmux listing must not empty the sidebar").
   *
   * THE SAME SHAPE `slashCommandGap` USES, for the same reason: `code` is for
   * a reader that wants to branch, `message` is the sentence a person reads,
   * and a code alone cannot be shown while a message alone cannot be matched
   * on.
   *
   * WHY IT RIDES ON THE SESSION AND NOT ON THE SOURCE. A descriptor is
   * computed once, at construction, and cannot change per poll
   * (`combine.ts`'s own header); this is a fact about THIS load, so it has to
   * travel with what this load produced. Stamped identically on every session
   * a source returns while its own tmux read failed -- the same "one per-load
   * fact, many rows" shape `slashCommandGap`'s `builtinCommands` arm already
   * uses -- so the filter layer only has to find ONE occurrence to know the
   * whole load is degraded, and the popover has the actual words to show for
   * it.
   *
   * `vamControlled` ITSELF ALREADY SAYS "ABSENT WHEN VAM COULD NOT ASK" --
   * this is not a second copy of that fact, it is the REASON, which absence
   * alone cannot carry. A filter that hides a row on `vamControlled === false`
   * needs this to know THAT false is trustworthy right now, and a filter that
   * would otherwise hide an ended session needs it to know the same tmux
   * failure is why it cannot trust ITS OWN default either -- see
   * `isHiddenByForeignFilter` and the orchestration in `Canvas.tsx`.
   */
  readonly vamListingGap?: { readonly code: string; readonly message: string };
  /**
   * WHICH vam tmux session this row is proven to be in -- the pane's name --
   * when `vamControlled` is `true`; absent otherwise.
   *
   * THE ONE THING A PANE'S TWO ROWS SHARE. A pane starts life as an
   * `unstarted` row keyed by its own name (`pane-row.ts`), and the moment an
   * agent registers in it the source reports a session row keyed by the
   * agent's identity instead. The two ids have nothing in common, and a tab
   * holding the first would be pruned as closed at exactly the moment the
   * operator is watching it. This field is how the canvas follows the pane
   * across that moment (`renameTab` in `canvas/split.ts`): same pane, new
   * row, same tab.
   *
   * A pairing HINT for the renderer's own bookkeeping, never a row key and
   * never an address anything writes to -- every write still resolves its
   * pane in main, by the rule `reply.ts` documents.
   */
  readonly pane?: string;
  /**
   * FOR A `terminal` ROW: the exact text that resumes the conversation this
   * pane last hosted -- `claude --resume <id>`, already joined the way
   * `recordPrompt` types a command (`startSessionIn` in `Canvas.tsx` does the
   * identical join for `provider.command`; a Codex resume would be `codex
   * resume <id>` were a Codex pane possible, which today it is not --
   * `main/sources/codex/source.ts` declines `terminal` outright).
   *
   * PROVIDER-SPECIFIC KNOWLEDGE STAYS IN MAIN, which is why this is a finished
   * string rather than a provider id plus a session id for the renderer to
   * assemble: `claudeResumeCommand`/`codexResumeCommand` are main-only
   * modules (they validate the id's shape and read the provider table), and a
   * renderer that re-derived the verb would be a second copy of a rule that
   * already differs by provider.
   *
   * Absent whenever the status is not `terminal`, and absent even on a
   * `terminal` row when vam could not build one (an id that fails the uuid
   * shape `resume.ts` requires) -- the row still carries its identity and its
   * transcript either way; only the secondary "Resume" action goes unoffered.
   */
  readonly resumeCommand?: string;
  /**
   * WHICH PROVIDER IS ALREADY RUNNING IN THIS ROW'S PANE, for an `unstarted`
   * or `terminal` row only -- the fact that ends the coordinator's own
   * performance concern with a per-row background poll: the same tmux
   * listing `unclaimedPanes`/`paneRow`/`terminalRow` (`pane-row.ts`) already
   * read to BUILD this row carries the pane's foreground command
   * (`TmuxSession.command`, `#{pane_current_command}`), so there is no
   * second read to make -- `identifyRunningProvider`
   * (`sources/tmux/shell.ts`) classifies it at the SAME poll cadence this
   * row itself arrives on.
   *
   * THREE STATES, the same shape `model` above already established for "a
   * fact a source may or may not hold": ABSENT is the ordinary empty pane --
   * a plain shell, or a listing with no command at all (`isShellCommand`'s
   * own "ABSENCE IS NOT A SHELL" rule applies here too: silence asserts
   * nothing, so the ordinary start screen draws exactly as it always has).
   * `null` is CONFIRMED running -- the foreground command is neither
   * provider's own -- an `htop`, an editor, anything the operator typed by
   * hand that is not one of vam's two providers. The `ProviderId` is the
   * confirmed, identified provider, `claude-code`'s own measured quirk
   * (`sources/claude-code/start-screen.ts`'s header) included.
   *
   * READ BY THE RESPONSE VIEW to draw `PaneReady` instead of the start
   * screen, and to withdraw Start/Resume outright, the instant this field is
   * present -- `Canvas.tsx`'s own `paneProps`. A pane the operator started
   * by hand in the Terminal view, or one still running from before a
   * reload, is caught here on the SOURCE's own poll cadence (about 10s) with
   * no separate mechanism of its own; an ACTIVE Start/Resume wait still gets
   * the faster, bounded 1.5s pane poll (`startingPaneByKey`'s own screen
   * read) for exactly as long as that wait is up, which is where the
   * blocking-screen cards (trust/update) come from too.
   */
  readonly runningProvider?: ProviderId | null;
  /**
   * THE MODEL THIS SESSION IS ON, when its SOURCE holds that fact -- never
   * read off a screen, and never what vam last asked for.
   *
   * WHY A FIELD RATHER THAN THE BRIDGE THAT ALREADY ANSWERS THIS. vam has one
   * way to learn a model today: `main/terminal/model.ts` reads the CLI's own
   * status line out of a pane vam started, with the session's transcript as
   * the fallback. Both of those exist because Claude Code keeps the fact
   * nowhere a program can ask for it. Codex keeps it in `threads.model`, so
   * the source simply knows -- there is no pane to read, and there does not
   * need to be one.
   *
   * THREE STATES, the shape `agents` and `vamControlled` established. ABSENT
   * is a source with no such fact, which is every Claude Code row and every
   * fixture: those rows still get their name from the pane read, and a field
   * that defaulted to `null` would have claimed the source had looked. NULL is
   * a source that holds the field and found it empty -- one of the 789 threads
   * measured here has no model recorded. A STRING is the model as the source
   * spells it, verbatim, because it is the provider's own identifier and not
   * something vam may normalise.
   *
   * IT IS NOT A CONTROL. A source that can say which model a session is on
   * cannot necessarily CHANGE it, and this one cannot: see the Codex source's
   * `terminal` decline.
   */
  readonly model?: string | null;
  /**
   * The `AskUserQuestion` questions this session asked, oldest first, or
   * absent when the source has no such surface.
   *
   * The same three-state shape `agents` established. ABSENT is a source that
   * cannot say -- the factory's HTTP model records no tool calls. EMPTY is a
   * source that looked and found none, which is the COMMON case: most
   * sessions never ask through the tool. Neither is a reason to draw an empty
   * box where a question would go.
   *
   * A STILL-OPEN question survives past the transcript tail vam reads
   * (`TAIL_WINDOW_BYTES` in `sources/claude-code/tail.ts`): a burst of
   * ordinary output after the question used to push it out of the window and
   * silently close the card in the Response view while the session was still
   * waiting, and `sources/claude-code/question-index.ts` now keeps the newest
   * OPEN one in view independently of where the tail window stopped. That
   * memory is itself bounded (`QUESTION_SCAN_CAP_BYTES`), so a question older
   * than even that -- already answered, or asked further back than the cold-
   * start scan reaches -- can still be absent here. Nothing in this app may
   * treat an empty list as "this session is not waiting on you".
   */
  readonly questions?: readonly AgentQuestion[];
  /**
   * What this session says it is WAITING ON, in its own words.
   *
   * WHY THIS IS NOT `status`. `status` is `waiting` for anything that is not
   * running, which includes a session sitting idle at its prompt with nobody
   * blocked on anything. This field is present only when the session itself
   * reported that it is blocked on a person -- a tool-approval prompt, a
   * question typed into the TUI -- and it is the ONLY surface that can say so:
   * an approval prompt writes no transcript record, so `questions` above is
   * empty for it and always will be.
   *
   * THREE STATES. ABSENT is "nothing says this session is waiting on anyone",
   * which covers both a running session and a source with no such surface.
   * PRESENT AND NULL is "waiting, cause unnamed". A STRING is the cause
   * verbatim, and it is verbatim rather than an enum because the observed
   * values are a sample of an open set (`session-status.ts`).
   *
   * A CAUSE IS NOT A CONTROL. Every source can produce this; only a session
   * vam started can be answered. Anything drawn from it must say which of the
   * two it is looking at rather than offering a control that will refuse.
   */
  readonly waitingFor?: string | null;
};

/**
 * VOCABULARY: the code's word and the UI's word for the same two layers, and
 * they do not match. Read this before renaming anything below.
 *
 *   code `Project`  =  UI "repo"     =  one working directory
 *                   =  the value of the `@vam-project` tmux option
 *                   =  the key of three prefs buckets already on disk
 *                      (`projectIcons`, `collapsedProjects`, `hiddenProjects`)
 *   code `Group`    =  UI "project"  =  the layer ABOVE, added later, stored
 *                      as a list of member `Project` ids and nothing else
 *
 * WHY THEY DIFFER, since the mismatch is deliberate and permanent. The
 * operator's word for a checkout is "repo" and their word for the thing above
 * it is "project", so the STRINGS on screen say that. The identifier cannot
 * follow: `Project` here is a contract with a tmux user option set on sessions
 * that are running right now, with three keys inside a store already written
 * to the operator's disk, and with `revealProject`, `projectIdOf` and
 * `MAX_PROJECT_ID_LENGTH`. A UI label is a string; those are a promise to data
 * that already exists.
 *
 * THE HAZARD THAT CREATES, stated because it is this design's whole risk:
 * after the group layer ships, "project" means the OUTER thing in the UI and
 * the INNER thing in the code, and that inversion makes renaming `Project`
 * look like a tidy-up someone forgot. It is not a tidy-up, it is the bug --
 * repointing the tmux option makes the operator's live sessions read
 * `mispaired` and refuse both Close and Enter, and renaming a prefs key
 * silently reverts every icon, fold and removal they saved. Both are frozen by
 * literal value in `test/sources/tmux-argv.test.ts` and
 * `test/prefs/prefs.test.ts`; if you are here because one of those went red,
 * the test is right.
 */
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
   * DELETING IT IS A PERSISTED-DATA MIGRATION, NOT A DELETE. Four prefs
   * buckets are keyed on this value at the top level of stored JSON:
   * `renames`, `icons`, `projectIcons` and `projectNames` (`prefs.ts`,
   * `applyRenames` and `applyIcons`). Dropping the field orphans every
   * rename and every icon an operator has saved, silently, on their next
   * launch. Whoever removes it re-keys those four buckets and ships a
   * migration for existing stores FIRST; until then the ten call sites
   * that read it are correct.
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

/**
 * A grouping of projects the operator made by hand -- UI "project", one level
 * above the code's `Project` (see the vocabulary note above `Project`).
 *
 * STORED, NOT DERIVED, which is what makes it unlike everything else in this
 * file: a project comes from the cwd of live sessions, so vam can rebuild one
 * from a poll, while a group exists only because a person said so and would
 * be gone on the next refresh if it were not written down (`Prefs.groups`).
 *
 * Its `id` is minted locally and derives from nothing -- a group has no cwd to
 * digest, must survive being renamed, and must exist while it holds no
 * projects at all.
 *
 * `projects` holds the members that are LIVE right now, resolved from the
 * stored member ids. A stored id whose project has no running session is not
 * dropped from the store; it simply has nothing to appear as here, and the
 * project rejoins its group the next time a session starts in that directory.
 */
export type Group = {
  readonly id: string;
  readonly name: string;
  /** A single glyph the operator picked, or `null` -- as `Project.icon`. */
  readonly icon?: string | null;
  readonly projects: readonly Project[];
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
  /**
   * The top level. Once groups exist these are the projects belonging to NO
   * group; with no groups stored, which is every store that has ever been
   * written, it is every project and this field means exactly what it always
   * did.
   */
  readonly projects: readonly Project[];
  /**
   * The grouped top level, or absent for "this model has no groups" -- which
   * is today's state everywhere, and permanently the browser build's, since it
   * has no directory picker and so no way to make one.
   *
   * Optional for the reason `Project.icon` is: every `CanvasModel` literal
   * across the fixtures and both adapters stays legal without an edit, and
   * absent has to keep meaning what it means, because that is the case the
   * whole existing suite exercises.
   */
  readonly groups?: readonly Group[];
  readonly budget?: CanvasBudget | null;
};
