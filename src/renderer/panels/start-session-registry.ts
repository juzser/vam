/**
 * The mounted start screen's own start callback, so the `startSession` chord
 * (`Canvas.tsx`) starts with the provider and permission ON SCREEN rather than
 * a second copy of that choice. `StartSession` (`DetailPanel.tsx`) registers
 * while mounted and unregisters on unmount; `triggerStartSession` returns
 * `false` when nothing is registered, which is the chord's refusal.
 */

let current: (() => void) | null = null;

/** Registers `start` as the on-screen start call; returns its unregister. */
export function registerStartSession(start: () => void): () => void {
  current = start;
  return () => {
    if (current === start) current = null;
  };
}

/** Runs the registered start call; `false` when no start screen is mounted. */
export function triggerStartSession(): boolean {
  if (current === null) return false;
  current();
  return true;
}
