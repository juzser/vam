/**
 * Each mounted start screen's own start callback, keyed by session id, so the `startSession` chord
 * (`Canvas.tsx`) starts with the provider and permission ON SCREEN rather than
 * a second copy of that choice. `StartSession` (`DetailPanel.tsx`) registers
 * while mounted and unregisters on unmount; `triggerStartSession` returns
 * `false` when nothing is registered, which is the chord's refusal.
 */

const bySession = new Map<string, () => void>();

/** Registers `start` as `sessionId`'s on-screen start call; returns its unregister. */
export function registerStartSession(sessionId: string, start: () => void): () => void {
  bySession.set(sessionId, start);
  return () => {
    if (bySession.get(sessionId) === start) bySession.delete(sessionId);
  };
}

/** Runs `sessionId`'s start call; `false` when that session has no start screen. */
export function triggerStartSession(sessionId: string): boolean {
  const start = bySession.get(sessionId);
  if (start === undefined) return false;
  start();
  return true;
}
