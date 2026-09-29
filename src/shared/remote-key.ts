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
 * TWENTY IDS, closed: the original six, then `delete`, the four arrows and
 * nine named Ctrl chords (vam-ux-1). Vam's own naming (`escape`, `back-tab`,
 * `arrow-up`, `ctrl-c`, ...), not tmux's key names and not Claude Code's --
 * see `PaneKey` in `terminal.ts`, which this is a closed SUBSET of. Every
 * id is matched by exact string equality and maps to one fixed `PaneKey`;
 * nothing is parsed, prefixed or pattern-matched. `ctrl-b` (tmux's prefix)
 * and every Ctrl letter not named are deliberately absent.
 */

import type { PaneKey } from './terminal.js';

export const REMOTE_KEY_IDS = [
  'escape',
  'tab',
  'enter',
  'back-tab',
  'space',
  'backspace',
  'delete',
  'arrow-up',
  'arrow-down',
  'arrow-left',
  'arrow-right',
  'ctrl-c',
  'ctrl-d',
  'ctrl-l',
  'ctrl-z',
  'ctrl-r',
  'ctrl-a',
  'ctrl-e',
  'ctrl-w',
  'ctrl-u',
] as const;

export type RemoteKeyId = (typeof REMOTE_KEY_IDS)[number];

const REMOTE_KEY_SET: ReadonlySet<string> = new Set(REMOTE_KEY_IDS);

export function isRemoteKeyId(value: unknown): value is RemoteKeyId {
  return typeof value === 'string' && REMOTE_KEY_SET.has(value);
}

/**
 * The allowlisted id, turned into the `PaneKey` the tmux-sending path already
 * knows how to deliver (`main/terminal/pane.ts`'s `sendToPane`). A closed
 * `switch` over `REMOTE_KEY_IDS`: every id has exactly one case. The default
 * arm assigns the id to a `never` (`const unreachable: never = id`), so adding
 * a further id to the array without adding its arm here is a compile error,
 * never a silently-`undefined` key.
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
    case 'delete':
      return { kind: 'nav', nav: 'delete' };
    case 'arrow-up':
      return { kind: 'nav', nav: 'up' };
    case 'arrow-down':
      return { kind: 'nav', nav: 'down' };
    case 'arrow-left':
      return { kind: 'nav', nav: 'left' };
    case 'arrow-right':
      return { kind: 'nav', nav: 'right' };
    case 'ctrl-c':
      return { kind: 'control', letter: 'c' };
    case 'ctrl-d':
      return { kind: 'control', letter: 'd' };
    case 'ctrl-l':
      return { kind: 'control', letter: 'l' };
    case 'ctrl-z':
      return { kind: 'control', letter: 'z' };
    case 'ctrl-r':
      return { kind: 'control', letter: 'r' };
    case 'ctrl-a':
      return { kind: 'control', letter: 'a' };
    case 'ctrl-e':
      return { kind: 'control', letter: 'e' };
    case 'ctrl-w':
      return { kind: 'control', letter: 'w' };
    case 'ctrl-u':
      return { kind: 'control', letter: 'u' };
    default: {
      const unreachable: never = id;
      return unreachable;
    }
  }
}

/**
 * The other direction, for the phone strip: which of ITS keys can even be
 * offered over the remote route. `null` for anything outside the twenty --
 * Home, PageUp, an unnamed Ctrl letter -- which is what tells the strip to
 * render that button only where `window.api.terminal.send` (the LOCAL, Electron-only
 * channel) is present.
 */
export function paneKeyToRemoteKeyId(key: PaneKey): RemoteKeyId | null {
  if (key.kind === 'escape') return 'escape';
  if (key.kind === 'back-tab') return 'back-tab';
  if (key.kind === 'backspace') return 'backspace';
  if (key.kind === 'enter' && !key.shift) return 'enter';
  if (key.kind === 'text' && key.text === ' ') return 'space';
  if (key.kind === 'text' && key.text === '\t') return 'tab';
  if (key.kind === 'nav') {
    switch (key.nav) {
      case 'delete':
        return 'delete';
      case 'up':
        return 'arrow-up';
      case 'down':
        return 'arrow-down';
      case 'left':
        return 'arrow-left';
      case 'right':
        return 'arrow-right';
      default:
        return null;
    }
  }
  if (key.kind === 'control') {
    switch (key.letter) {
      case 'c':
        return 'ctrl-c';
      case 'd':
        return 'ctrl-d';
      case 'l':
        return 'ctrl-l';
      case 'z':
        return 'ctrl-z';
      case 'r':
        return 'ctrl-r';
      case 'a':
        return 'ctrl-a';
      case 'e':
        return 'ctrl-e';
      case 'w':
        return 'ctrl-w';
      case 'u':
        return 'ctrl-u';
      default:
        return null;
    }
  }
  return null;
}
