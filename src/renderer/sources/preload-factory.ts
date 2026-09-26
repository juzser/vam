/**
 * Reassembles the flat preload api into a real `SessionSource`.
 *
 * The bridge cannot carry the port's shape (see `src/shared/preload-api.ts`:
 * `exposeInMainWorld` runs once, before any source is known, and freezes what
 * it copies), so the preload exposes every function unconditionally and ships
 * capability as data. That leaves exactly one place where "absent means
 * absent, never a stub and never a thrower" can be honoured -- here.
 *
 * So this module builds the object member by member: an optional member is
 * *assigned* only when its flag is true, and otherwise never written at all.
 * Assigning `subscribe: undefined` for an absent capability would look
 * equivalent and is not: `'subscribe' in source` would then be true, and a
 * consumer enumerating the source would see an affordance it must not draw.
 */

import type { PreloadSourceApi, SourceDescriptor } from '../../shared/preload-api.js';
import type { SessionSource, SourceGovernance, SourceWrites } from './port.js';
import { activeProviderId } from './provider.js';

function buildWrites(api: PreloadSourceApi, descriptor: SourceDescriptor): SourceWrites {
  const { capabilities } = descriptor;
  const writes: SourceWrites = {
    recordPrompt: (sessionId, prompt) => api.recordPrompt(sessionId, prompt),
  };
  // Each lifecycle operation is its own capability, so each is assigned on
  // its own flag -- a source may record prompts and rename nothing.
  if (capabilities.renameSession) {
    writes.renameSession = (sessionId, title) => api.renameSession(sessionId, title);
  }
  if (capabilities.closeSession) {
    writes.closeSession = (sessionId, force) => api.closeSession(sessionId, force);
  }
  if (capabilities.createSession) {
    // WHICH AGENT A NEW SESSION RUNS IS ANSWERED HERE, not at the call site.
    // The choice is a stored preference and the port's write surface is built
    // once, outside React, so reading it at call time is what keeps every
    // caller -- the canvas, the sidebar, a future one -- saying "start a
    // session" and nothing about providers. Read per call, not captured: the
    // operator may change it in settings while this source is alive.
    writes.createSession = (projectId, title) =>
      api.createSession(projectId, title, activeProviderId());
    // The same capability carries both: a new session in a project vam knows,
    // and one in a directory that is about to become a project.
    writes.createSessionIn = (cwd, title) => api.createSessionIn(cwd, title, activeProviderId());
  }
  // Its own flag for the same reason `promptAttachments` has one, and the
  // asymmetry is real rather than defensive: the Codex source answers false
  // to `createSession` and true to this.
  if (capabilities.resumeSession) {
    // No provider is read here, unlike `createSession` above. A reopened
    // session continues a conversation that was started by a particular
    // agent, and running it under whatever the operator has selected TODAY
    // would hand one agent's history to another.
    writes.resumeSession = (sessionId) => api.resumeSession(sessionId);
  }
  // Its own flag, not folded into `createSession`'s: a source can deliver
  // text without being able to scope a picker to a directory.
  if (capabilities.promptAttachments) {
    writes.pickImageAttachment = (sessionId) => api.pickImageAttachment(sessionId);
  }
  return writes;
}

function buildGovernance(api: PreloadSourceApi): SourceGovernance {
  return {
    applyWaivers: (sessionId, findingIds) => api.applyWaivers(sessionId, findingIds),
    transitionLesson: (sessionId, lessonId, status) =>
      api.transitionLesson(sessionId, lessonId, status),
  };
}

/**
 * Asks the api what its source can do, then returns a `SessionSource` whose
 * optional members exist exactly when the answer says they should.
 */
export async function createSourceFromPreload(api: PreloadSourceApi): Promise<SessionSource> {
  const descriptor = await api.describe();
  const { capabilities } = descriptor;

  const source: SessionSource = {
    id: descriptor.id,
    label: descriptor.label,
    capabilities,
    declines: descriptor.declines,
    viewerScope: descriptor.viewerScope,
    load: () => api.load(),
    // ASSIGNED UNCONDITIONALLY, unlike the three members below it, and
    // `port.ts` says why: this one is not gated by a capability flag. A source
    // that cannot page answers `unavailable` in its own words rather than
    // being absent, so leaving it off here would hide a working surface behind
    // a check no descriptor makes.
    history: (sessionId, cursor) => api.history(sessionId, cursor),
    // ASSIGNED UNCONDITIONALLY, exactly like `history` immediately above --
    // `port.ts`'s own doc comment says so verbatim ("OPTIONAL AND
    // ANSWER-GATED, exactly like `history` above"). A source that cannot look
    // inside an agent answers through `AgentWork`'s own `unavailable` arm, not
    // through this member's absence; leaving it off here (as this factory
    // used to) stranded `AgentWorkReaderProvider` on `null` for every source,
    // so `useAgentWork`'s poll never started at all.
    agentWork: (sessionId, agentId) => api.agentWork(sessionId, agentId),
  };

  // THE CONSTITUENTS, when main is serving more than one source. Copied
  // across rather than derived, and ASSIGNED ONLY WHEN PRESENT, on this
  // module's own rule: `members: undefined` would make `'members' in source`
  // true, and `capabilitiesFor` reads absence as "this source is the only
  // one", which is a different thing from "this source has no constituents".
  if (descriptor.members !== undefined) {
    (source as { members?: SessionSource['members'] }).members = descriptor.members.map(
      (member) => ({
        id: member.id,
        label: member.label,
        capabilities: member.capabilities,
        declines: member.declines,
      }),
    );
  }

  // A mutable view of the same object: the port declares the optional members
  // `readonly`, which is the right contract for consumers and the wrong one
  // for the single place that populates them.
  const assignable = source as {
    subscribe?: SessionSource['subscribe'];
    write?: SourceWrites;
    governance?: SourceGovernance;
  };

  if (capabilities.liveUpdates) {
    assignable.subscribe = (onChange) => api.subscribe(onChange);
  }
  // `SourceWrites.recordPrompt` is REQUIRED by the port, so a write surface
  // cannot exist without it -- which makes `renameSession` (or `closeSession`,
  // or `createSession`) true while `recordPrompt` is false a contradiction the
  // type system cannot state: the capability advertises an affordance that no
  // member can reach, and `declines` is conventionally only written for FALSE
  // capabilities, so nothing explains the gap either. Refuse it here rather
  // than build a source that lies about itself. Fixing this properly is a
  // port-level change (make `recordPrompt` optional, or state the invariant)
  // and `port.ts` is deliberately untouched by this task.
  const strandedWrites = (['renameSession', 'closeSession', 'createSession'] as const).filter(
    (k) => capabilities[k],
  );
  if (!capabilities.recordPrompt && strandedWrites.length > 0) {
    throw new Error(
      `source "${descriptor.id}" claims ${strandedWrites.join(', ')} but not recordPrompt; ` +
        'the port has no way to expose a write surface without recordPrompt, so the ' +
        'capability could never be reached',
    );
  }

  if (capabilities.recordPrompt) {
    assignable.write = buildWrites(api, descriptor);
  }
  if (capabilities.governance) {
    assignable.governance = buildGovernance(api);
  }

  return source;
}
