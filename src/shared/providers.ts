/**
 * The agent providers vam can start a session with.
 *
 * ONE TABLE, READ FROM BOTH PROCESSES. The renderer needs the labels to draw a
 * picker; main needs the command to hand tmux. Splitting those into two lists
 * is how a provider comes to be offered in settings that nothing can actually
 * run, so both come from here.
 *
 * TODAY THE TABLE HAS ONE ROW, AND THAT IS THE HONEST STATE. Codex CLI and
 * Cursor CLI are on the roadmap and neither is implemented: vam's only session
 * source reads Claude Code's own state directory, and a provider is not merely
 * a command to spawn -- it is a source that can read back what that command is
 * doing. A settings control offering a provider that cannot start is worse
 * than one offering a single honest choice, so nothing is listed here until
 * its source exists. What a second row needs is exactly this: an id, a label,
 * the command tmux should run, and a source in main that can see its sessions.
 *
 * The id is vam's own source id where one exists -- `claude-code` is the same
 * string `PROVIDER_MARKS` is keyed by and the adapter stamps on a row -- so a
 * provider and the glyph that stands for it cannot drift apart.
 */

/** Narrow on purpose: an id that is not in the table fails to compile. */
export type ProviderId = 'claude-code';

export type Provider = {
  readonly id: ProviderId;
  readonly label: string;
  /**
   * What a new session runs, as an ARRAY of words rather than a string: tmux
   * runs a one-argument `shell-command` through `sh -c` and only a
   * multi-argument one directly, so the split is what keeps a shell out of the
   * path (`main/sources/tmux/argv.ts`).
   */
  readonly command: readonly string[];
};

/** The provider a fresh vam starts sessions with, and the answer to every
 *  unusable stored value. */
export const DEFAULT_PROVIDER_ID: ProviderId = 'claude-code';

export const PROVIDERS: readonly Provider[] = [
  { id: 'claude-code', label: 'Claude Code', command: ['claude'] },
];

/**
 * Whatever was stored or sent, reduced to a provider that can actually start.
 *
 * TOTAL, and deliberately so. The value arrives from `localStorage` -- where a
 * previous vam, a hand edit, or a provider since removed from the table can
 * all have left it -- and then over IPC, where main must not trust the
 * renderer's normalisation either. An id nobody answers to is not an error
 * worth a screen: it is a session started with the default provider, which is
 * the only outcome that leaves the operator able to work.
 */
export function resolveProvider(id: unknown): Provider {
  const match = PROVIDERS.find((provider) => provider.id === id);
  return match ?? (PROVIDERS.find((p) => p.id === DEFAULT_PROVIDER_ID) as Provider);
}

/** The same fallback, when only the id is wanted. */
export function readProviderId(id: unknown): ProviderId {
  return resolveProvider(id).id;
}
