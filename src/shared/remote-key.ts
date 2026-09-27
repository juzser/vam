/**
 * The remote key route's own vocabulary -- `/api/send-key`'s whole allowlist,
 * and the one place both ends of that route read it from.
 *
 * IN `src/shared/`, LIKE `terminal.ts` BESIDE IT, for the same reason: main
 * validates an incoming id against this exact list (`main/remote/send-key.ts`),
 * and the renderer decides which of ITS OWN key-strip items are even worth
 * asking for (`panels/DetailPanel.tsx`) -- the same list read twice rather
 * than typed twice, which is how the two drifted before (`KEY_STRIP`'s own
 * history: a caption and a glyph table kept in two places once, and it did).
 *
 * SIX IDS, closed. Vam's own naming (`escape`, `back-tab`, ...), not tmux's
 * key names and not Claude Code's -- see `PaneKey` in `terminal.ts`, which
 * this is a small, closed SUBSET of. `up`/`down` are the desktop key strip's
 * own addition (vam/terminal-arrows) and are deliberately not here: Orca's
 * own phone layout, which the remote strip matches, has no arrow keys, and
 * arrows never travel this route in any build.
 */

import type { PaneKey } from './terminal.js';

export const REMOTE_KEY_IDS = ['escape', 'tab', 'enter', 'back-tab', 'space', 'backspace'] as const;

export type RemoteKeyId = (typeof REMOTE_KEY_IDS)[number];

const REMOTE_KEY_SET: ReadonlySet<string> = new Set(REMOTE_KEY_IDS);

export function isRemoteKeyId(value: unknown): value is RemoteKeyId {
  return typeof value === 'string' && REMOTE_KEY_SET.has(value);
}

/**
 * The allowlisted id, turned into the `PaneKey` the tmux-sending path already
 * knows how to deliver (`main/terminal/pane.ts`'s `sendToPane`). A closed
 * `switch` with no default arm: every id in `REMOTE_KEY_IDS` has exactly one
 * case, so adding a seventh id to the array without adding its arm here is a
 * compile error, never a silently-`undefined` key.
 *
 * `tab` IS `{ kind: 'text', text: '\t' }`, NOT A NEW `PaneKey` KIND. There is
 * no dedicated kind for a plain Tab (`DetailPanel.tsx`'s `KEY_STRIP` never
 * grew one), and there does not need to be: MEASURED against a real tmux
 * 3.7b over a private `-L` socket, `send-keys Tab` (the symbolic press) and
 * `send-keys -l -- <the literal tab byte>` (`sendTextArgv`, the same path
 * `space` on this strip already takes) both deliver the identical single
 * 0x09 byte -- unlike Escape/Enter/Backspace, where the literal and the
 * symbolic forms measurably differ (`tmux/argv.ts`'s own measurements). So
 * this reuses the already-tested text path rather than inventing a new one.
 */
export function remoteKeyToPaneKey(id: RemoteKeyId): PaneKey {
  switch (id) {
    case 'escape':
      return { kind: 'escape' };
    case 'enter':
      return { kind: 'enter', shift: false };
    case 'back-tab':
      return { kind: 'back-tab' };
    case 'backspace':
      return { kind: 'backspace' };
    case 'space':
      return { kind: 'text', text: ' ' };
    case 'tab':
      return { kind: 'text', text: '\t' };
  }
}

/**
 * The other direction, for the phone strip: which of ITS keys can even be
 * offered over the remote route. `null` for anything outside the six --
 * `up`/`down` among them -- which is what tells the strip to render that
 * button only where `window.api.terminal.send` (the LOCAL, Electron-only
 * channel) is present.
 */
export function paneKeyToRemoteKeyId(key: PaneKey): RemoteKeyId | null {
  if (key.kind === 'escape') return 'escape';
  if (key.kind === 'back-tab') return 'back-tab';
  if (key.kind === 'backspace') return 'backspace';
  if (key.kind === 'enter' && !key.shift) return 'enter';
  if (key.kind === 'text' && key.text === ' ') return 'space';
  if (key.kind === 'text' && key.text === '\t') return 'tab';
  return null;
}
