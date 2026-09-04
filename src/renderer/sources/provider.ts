/**
 * Which provider a new session is started with, in force.
 *
 * A module-level value rather than a React one, for the reason `chords.ts`
 * keeps the active key bindings the same way: the reader is
 * `preload-factory.ts`, which builds the port's write surface once, outside
 * any component, and cannot subscribe to a hook. `activatePrefs` writes here
 * on every read of the store, so "what is stored" and "what a new session
 * runs" are the same sentence.
 *
 * It is seeded with the default rather than left undefined, so a session
 * started before any preference has been read starts with the working
 * provider instead of nothing.
 */

import { DEFAULT_PROVIDER_ID, type ProviderId, readProviderId } from '../../shared/providers.js';

let active: ProviderId = DEFAULT_PROVIDER_ID;

/** Called by `activatePrefs`; normalising here too means no caller can put an
 *  id into force that no provider answers to. */
export function setActiveProvider(id: unknown): void {
  active = readProviderId(id);
}

export function activeProviderId(): ProviderId {
  return active;
}
