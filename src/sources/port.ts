/**
 * The session-source port: the contract every adapter implements and every
 * consumer reads. Types and narrowing helpers only -- no adapter, no
 * registry, no React, no fetching.
 *
 * `load()` returns projects, never a `CanvasModel`, because with several
 * sources at once the model is the merge of everyone's projects; a source
 * that returned the whole model would be claiming to speak for the others.
 */

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
  closeSession?(sessionId: string): Promise<void>;
  createSession?(projectId: string, title: string): Promise<void>;
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
export type SessionSource = {
  readonly id: SourceId;
  readonly label: string;
  readonly capabilities: SourceCapabilities;
  readonly declines: SourceDeclines;
  readonly viewerScope: ViewerScope;
  load(): Promise<readonly Project[]>;
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
