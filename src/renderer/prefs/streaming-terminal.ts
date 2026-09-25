/**
 * WHETHER THE TERMINAL TAB STREAMS, or still polls.
 *
 * `TerminalStreamTab.tsx` is a second Terminal tab component, driven by
 * xterm.js over a persistent `tmux -C` connection
 * (`docs/design/terminal-streaming.md`) instead of `TerminalTab.tsx`'s
 * `capture-pane` timer. `DetailPanel.tsx` needs to pick between the two
 * PER RENDER, reactively -- and it mounts one `DetailPanel` (hence one
 * Terminal tab) per split leaf, with no `prefs` object drilled down to it,
 * exactly the arrangement `terminal-font.ts`'s own header argues at length.
 * So this is a STORE, module state rather than a prop, mirroring that
 * file's shape for a boolean instead of a size.
 */

/** On: streaming is the shipping Terminal tab now, measured against the
 *  capture-pane poll it replaces as the default (`docs/design/terminal-
 *  streaming.md`'s "Flipping the default" section) and backed by an
 *  automatic fallback (`stream-ipc.ts`'s tmux-version gate,
 *  `TerminalAutoTab.tsx`'s reconnect give-up handling) for the tmux that
 *  cannot run it. `prefs.ts`'s `parsePrefs` carries a ONE-TIME migration for
 *  an operator whose stored payload predates this flip -- see
 *  `streamingTerminalMigrated` there for why a bare default here is not
 *  enough on its own to move an existing installation. */
export const DEFAULT_STREAMING_TERMINAL = true;

/** Total, like `readConciseOutput`: only a literal `true` is on, so a
 *  hand-edited or unreadable payload never silently switches the Terminal
 *  tab's implementation out from under an operator who never asked. */
export function readStreamingTerminal(raw: unknown): boolean {
  return raw === true;
}

/** THE SETTING IN FORCE, module state rather than a prop -- see the module
 *  header. */
let active: boolean = DEFAULT_STREAMING_TERMINAL;
const listeners = new Set<() => void>();

/** The snapshot `useSyncExternalStore` compares by identity — a boolean, so
 *  it is stable by construction. */
export function activeStreamingTerminal(): boolean {
  return active;
}

/** Put the setting in force. Called by `activatePrefs`, which every read and
 *  every write goes through. A CHANGE, NOT EVERY WRITE, like
 *  `setActiveTerminalFontSize`: a write to an unrelated field must not
 *  re-mount every open Terminal tab. */
export function setActiveStreamingTerminal(next: boolean): void {
  const on = readStreamingTerminal(next);
  if (on === active) return;
  active = on;
  for (const listener of listeners) listener();
}

/** Subscribe; the returned function unsubscribes. `useSyncExternalStore`'s
 *  contract, the shape `subscribeTerminalFontSize` already has. */
export function subscribeStreamingTerminal(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
