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
    writes.closeSession = (sessionId) => api.closeSession(sessionId);
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
  };

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
