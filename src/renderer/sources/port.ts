/**
 * The session-source port: the contract every adapter implements and every
 * consumer reads. Types and narrowing helpers only -- no adapter, no
 * registry, no React, no fetching.
 *
 * `load()` returns projects, never a `CanvasModel`, because with several
 * sources at once the model is the merge of everyone's projects; a source
 * that returned the whole model would be claiming to speak for the others.
 */

import type { AgentWork } from '../../shared/agent-work.js';
import type { HistoryCursor, TranscriptPage } from '../../shared/history.js';
import type { Project, SourceId } from '../domain/model.js';

/**
 * What a source can do, as data rather than as functions. Exactly twelve
 * booleans -- gate every affordance the canvas already draws, never a new
 * one.
 */
export type SourceCapabilities = {
  readonly liveUpdates: boolean;
  readonly recordPrompt: boolean;
  readonly deliverPrompt: boolean;
  readonly promptAttachments: boolean;
  readonly slashCommands: boolean;
  readonly renameSession: boolean;
  readonly closeSession: boolean;
  readonly createSession: boolean;
  readonly governance: boolean;
  readonly pullRequests: boolean;
  readonly terminal: boolean;
  readonly agentRoster: boolean;
  /**
   * THE THIRTEENTH, and the first affordance added to this list rather than
   * gated out of it. The header above says "gate every affordance the canvas
   * already draws, never a new one" — reopening is a new one, and it needs a
   * boolean for the same reason the other twelve do: whether it can act is
   * known before the control would be drawn, so a source that cannot resume
   * must be able to withdraw it with a sentence rather than fail when pressed.
   *
   * It is NOT folded into `createSession`. Codex separates them by example:
   * vam cannot start a Codex thread (that is Stage 2 of
   * `docs/design/a-second-source.md`) and CAN resume one, because
   * `codex resume <uuid>` exists and was measured.
   */
  readonly resumeSession: boolean;
};

/**
 * The source's own words for why a capability is `false`. Every capability
 * that is `false` must carry a non-empty entry here, authored by the source
 * that lacks the thing -- never by the component that would have drawn it.
 */
export type SourceDeclines = Partial<Record<keyof SourceCapabilities, string>>;

/**
 * One error shape for every source. An adapter translates its own failures
 * into this so a consumer that has never heard of a particular backend can
 * still render `code: message`.
 */
export type SourceError = {
  readonly kind: 'refused' | 'unreachable';
  readonly code: string;
  readonly message: string;
  /**
   * `true` only when the source could not confirm ownership but has a
   * process id it could ask a caller to force-kill instead -- see
   * `stop.ts`'s `unresolvedInteractive`. Absent or `false` everywhere else,
   * including the one case a source can positively place elsewhere: killing
   * is not something confirming again can unlock there.
   */
  readonly forcible?: boolean;
};

/**
 * Who else can see what this source returns. Required, and deliberately not
 * a boolean -- "ownership is a property of the connection" only means
 * something if the source has to say what kind of connection it is.
 *
 * - `connection` -- the connection *is* the identity; there is no other
 *   viewer to leak to.
 * - `filtered` -- the backend serves several identities and the source
 *   filters to the authenticated one; `note` says what it filters on.
 * - `unscoped` -- the source cannot promise either of the above and says so.
 *
 * Honesty clause: vam cannot verify any of this. A source that declares
 * `connection` while actually returning another party's sessions is lying,
 * and no test vam can write will catch it -- the type system can require the
 * declaration to exist, it cannot require it to be true. The point of asking
 * for it anyway is to force whoever writes the next adapter to look this
 * question in the eye before they ship it, and to give a reviewer exactly
 * one named thing to check.
 */
export type ViewerScope =
  | { readonly kind: 'connection'; readonly note: string }
  | { readonly kind: 'filtered'; readonly note: string }
  | { readonly kind: 'unscoped'; readonly warning: string };

/**
 * The write surface, present only when `recordPrompt` is true. `recordPrompt`
 * is the only member required here; the lifecycle operations are each their
 * own independently-observable capability (`renameSession`, `closeSession`,
 * `createSession`) and stay optional so a source can record prompts without
 * promising the rest.
 */
export type SourceWrites = {
  recordPrompt(sessionId: string, prompt: string): Promise<void>;
  renameSession?(sessionId: string, title: string): Promise<void>;
  /**
   * `force` is a SECOND, DELIBERATE CALL, never the default of the first --
   * see `Canvas.tsx`'s confirmation. Omitted or `false` is the normal close;
   * `true` only after the operator has read what it will kill and agreed.
   */
  closeSession?(sessionId: string, force?: boolean): Promise<void>;
  createSession?(projectId: string, title: string): Promise<void>;
  /**
   * Start a session in a DIRECTORY rather than in a project vam already
   * knows. Gated by the same `createSession` capability -- deliberately not a
   * thirteenth boolean: it is the same affordance, asked a different way,
   * because a "new project" has no project id yet (a project is derived from
   * the cwd of a live session, so it begins existing only once this returns).
   */
  createSessionIn?(cwd: string, title: string): Promise<void>;
  /**
   * Continue a conversation that has ended, addressed by the row id the
   * canvas holds. Gated by `resumeSession`, which is its OWN capability and
   * not `createSession`'s -- Codex is the case that separates them: vam
   * cannot start a Codex thread and can return to one.
   *
   * No cwd and no provider: both are facts the source holds about that
   * conversation, and a caller supplying either would be deciding where
   * somebody else's session resumes.
   */
  resumeSession?(sessionId: string): Promise<void>;
  /**
   * Opens a picker for one image, scoped to and validated against the
   * session's own working directory, and answers the resolved path -- or
   * `null` on cancel. Gated by `promptAttachments`, not by `recordPrompt`
   * alone: a source can deliver text without being able to name a directory
   * to scope a picker to. Rejects with the port's own `SourceError` when the
   * picked file was refused (outside the directory, or not really an image).
   */
  pickImageAttachment?(sessionId: string): Promise<string | null>;
};

/** The waiver ledger and lesson pipeline, present only when `governance` is true. */
export type SourceGovernance = {
  applyWaivers(sessionId: string, findingIds: readonly string[]): Promise<void>;
  transitionLesson(sessionId: string, lessonId: string, status: string): Promise<void>;
};

/**
 * The port itself. `subscribe`, `write` and `governance` are present exactly
 * when their capability flag is true -- absent means absent, never a stub or
 * a thrower, so a source that cannot write carries nothing that could write.
 * Use `canSubscribeTo`, `canWriteTo` and `canGovernWith` to reach them; a
 * direct ungated call does not typecheck.
 */
/**
 * ONE CONSTITUENT of a source that is really several, for the questions that
 * are about a ROW rather than about the app.
 *
 * `SessionSource.capabilities` is the OR over everything main serves, which is
 * the right answer to "can this app do X" -- whether a control exists at all.
 * It is the wrong answer to "can THIS ROW do X", and the two only started
 * differing when a second source arrived: Claude Code types into a pane it
 * started, Codex queues into a session vam never saw, and a canvas reading the
 * OR would draw a Terminal tab over a row that has no terminal.
 *
 * Narrower than the descriptor it comes from on purpose: a member is consulted
 * for a capability and for the words behind a withdrawal, never for a
 * `viewerScope`, which is a claim about the whole connection.
 */
export type SourceMember = {
  readonly id: SourceId;
  readonly label: string;
  readonly capabilities: SourceCapabilities;
  readonly declines: SourceDeclines;
};

export type SessionSource = {
  readonly id: SourceId;
  readonly label: string;
  readonly capabilities: SourceCapabilities;
  readonly declines: SourceDeclines;
  readonly viewerScope: ViewerScope;
  /**
   * The constituents, when main is serving more than one source. ABSENT when
   * it is serving one, and then this source IS that one -- so a reader must
   * fall back to the top level rather than treat absence as "no capabilities".
   * `capabilitiesFor` in `./members.ts` is the one place that rule lives.
   */
  readonly members?: readonly SourceMember[];
  load(): Promise<readonly Project[]>;
  /**
   * The turns BEFORE a point in one session -- scrolling back, which `load()`
   * deliberately cannot do: it reads a fixed tail of each session so a poll
   * stays cheap, and the median transcript is three times that tail.
   *
   * OPTIONAL, BUT NOT CAPABILITY-GATED, and the distinction matters because
   * every other optional member here is the other thing. `subscribe`, `write`
   * and `governance` are absent when a flag says the source cannot do them;
   * this one is present on every source the factories assemble, and a source
   * that cannot page says so in the ANSWER -- `TranscriptPage`'s `unavailable`
   * arm, which is the same shape `PaneView` and `AgentsResult` use. It is
   * optional only so that a source built by hand (a demo fixture, a test) is
   * not obliged to invent a transcript it does not have.
   *
   * It never rejects, for the reason the arm exists: "vam could not read" and
   * "there is nothing older" are exactly the two answers that must not be
   * confused, and a forgotten `catch` confuses them.
   */
  readonly history?: (sessionId: string, cursor: HistoryCursor | null) => Promise<TranscriptPage>;

  /**
   * What ONE of a session's subagents was asked and what it has done -- the
   * Agents pane's detail side.
   *
   * OPTIONAL AND ANSWER-GATED, exactly like `history` above: a source that
   * cannot see inside an agent says so in `AgentWork`'s own `unavailable`
   * arm rather than through a capability flag, and it never rejects -- "vam
   * could not read" and "this agent has done nothing yet" are the two answers
   * that must not be confused.
   */
  readonly agentWork?: (sessionId: string, agentId: string) => Promise<AgentWork>;
  readonly subscribe?: (onChange: () => void) => () => void;
  readonly write?: SourceWrites;
  readonly governance?: SourceGovernance;
};

/** Narrows a source to one whose `subscribe` member is present and callable. */
export function canSubscribeTo(
  source: SessionSource,
): source is SessionSource & { readonly subscribe: NonNullable<SessionSource['subscribe']> } {
  return source.capabilities.liveUpdates && source.subscribe !== undefined;
}

/** Narrows a source to one whose `write` member is present and callable. */
export function canWriteTo(
  source: SessionSource,
): source is SessionSource & { readonly write: SourceWrites } {
  return source.capabilities.recordPrompt && source.write !== undefined;
}

/** Narrows a source to one whose `governance` member is present and callable. */
export function canGovernWith(
  source: SessionSource,
): source is SessionSource & { readonly governance: SourceGovernance } {
  return source.capabilities.governance && source.governance !== undefined;
}

/**
 * The one way a rejected source call becomes a sentence on screen.
 *
 * The shape test comes FIRST, and deliberately, because the thing this
 * function most often receives is not an `Error` at all. `src/preload/api.ts`
 * rethrows the main process's `SourceError` verbatim (`throw result.error`) so
 * that the `code` and the CLI's own remedy survive the bridge -- and a
 * structured-cloned plain object is what lands in the `catch`. Reaching
 * `String(cause)` with one of those prints `[object Object]`, which is the
 * exact opposite of the point: a refused send is the COMMON case, and
 * "session-running" and "cli-missing" have to be told apart.
 *
 * `SmithApiError` is caught by the same branch rather than a separate one: it
 * is an `Error` subclass carrying an own `code`, so `code: message` is what it
 * rendered before and what it renders now.
 */
export function describeFailure(reason: unknown): string {
  if (typeof reason === 'object' && reason !== null && 'code' in reason && 'message' in reason) {
    return `${String(reason.code)}: ${String(reason.message)}`;
  }
  return reason instanceof Error ? reason.message : String(reason);
}
