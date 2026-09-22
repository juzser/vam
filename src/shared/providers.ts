/**
 * The agent providers vam can start a session with.
 *
 * ONE TABLE, READ FROM BOTH PROCESSES. The renderer needs the labels to draw a
 * picker; main needs the command to run. Splitting those into two lists is
 * how a provider comes to be offered in settings that nothing can actually
 * run, so both come from here.
 *
 * TWO ROWS, AND EACH HAS A SOURCE BEHIND IT. The rule that kept this table at
 * one row still holds: a provider is not merely a command to spawn, it is a
 * source in main that can read back what that command is doing. Claude Code's
 * source reads its state directory; Codex's (`main/sources/codex/`) reads its
 * thread store. Cursor CLI has no source and is not listed. What a further
 * row needs is exactly this: an id, a label, the command to run, and a source
 * in main that can see its sessions.
 *
 * WHERE THE COMMAND IS SPENT changed with Stage 2 of
 * `docs/design/vam-owns-the-session.md`: a new session in a project vam
 * already draws no longer runs the provider at spawn -- it runs a shell
 * (`main/sources/tmux/shell.ts`) -- and the command is TYPED into that shell
 * afterwards, by the Start session button
 * (`main/sources/claude-code/start-in-pane.ts`) or by hand. The "new
 * project" path still hands it to tmux at spawn, and
 * `main/sources/claude-code/create-session.ts` says why.
 *
 * The id is vam's own source id -- `claude-code` and `codex` are the same
 * strings `PROVIDER_MARKS` is keyed by and each adapter stamps on a row -- so
 * a provider and the glyph that stands for it cannot drift apart.
 */

/** Narrow on purpose: an id that is not in the table fails to compile. */
export type ProviderId = 'claude-code' | 'codex';

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
  { id: 'codex', label: 'Codex', command: ['codex'] },
];

/**
 * IS THERE A CHOICE HERE AT ALL? Derived from the table above, and stated ONCE
 * so that every surface offering a provider obeys the same answer.
 *
 * "A CONTROL THAT CANNOT ACT IS NOT DRAWN AS ONE" (`settings/RemotePanel.tsx`'s
 * header) -- and over a one-row table every provider control is one. The
 * settings section's segmented picker draws a single button that is
 * `aria-pressed` from the first paint and calls `onChange` with a `Prefs`
 * identical to the one it was handed; the composer's picker opens a popover
 * with one row in it. Both were the same decision and only one of them had
 * made it, which is how the composer came to spend 44px of a 335px tool row
 * on a choice it could not offer -- measured on a phone, where the popover
 * also opened INSIDE the prompt box it hangs off, 99x34 overlapping the
 * textarea by 28px.
 *
 * SO THE CONTROLS ARE CONDITIONAL, NOT DELETED, and the condition lives here
 * rather than in either of them: the day a second source exists in main this is
 * `true` and both come back unchanged, with no edit at either call site.
 * That day was the `codex` row above. `test/settings/provider-double.test.tsx`
 * mocks this module and proves it for the settings copy;
 * `test/panels/DetailPanel.provider-picker.test.tsx` does the same for the
 * composer's; and `test/shared/providers.test.ts` pins that the shipped table
 * really does derive to `true`.
 *
 * WITHDRAWING THE CONTROL IS NOT WITHDRAWING THE ANSWER: the settings section
 * still names the provider and the command it runs, which is what the operator
 * came there to read.
 */
export const CAN_CHOOSE_PROVIDER: boolean = PROVIDERS.length > 1;

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
