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
    writes.createSession = (projectId, title) => api.createSession(projectId, title);
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
  if (capabilities.recordPrompt) {
    assignable.write = buildWrites(api, descriptor);
  }
  if (capabilities.governance) {
    assignable.governance = buildGovernance(api);
  }

  return source;
}
