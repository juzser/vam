/**
 * The remote key allowlist, at the one place both the server route and the
 * phone strip read it from -- see `shared/remote-key.ts`'s own header.
 */

import { describe, expect, it } from 'vitest';
import {
  isRemoteKeyId,
  paneKeyToRemoteKeyId,
  REMOTE_KEY_IDS,
  remoteKeyToPaneKey,
} from '../../src/shared/remote-key.js';
import type { PaneKey } from '../../src/shared/terminal.js';

describe('the six ids, closed', () => {
  it('is exactly this list, in this order', () => {
    expect(REMOTE_KEY_IDS).toEqual(['escape', 'tab', 'enter', 'back-tab', 'space', 'backspace']);
  });

  it('isRemoteKeyId accepts every one of them and nothing else', () => {
    for (const id of REMOTE_KEY_IDS) expect(isRemoteKeyId(id)).toBe(true);
    for (const value of [
      'Escape',
      'Tab',
      'Enter',
      'BTab',
      'Space',
      'BSpace',
      'up',
      'down',
      'control',
      'wheel',
      'paste',
      '',
      ' escape',
      123,
      null,
      undefined,
      {},
      ['escape'],
    ]) {
      expect(isRemoteKeyId(value), `isRemoteKeyId(${JSON.stringify(value)})`).toBe(false);
    }
  });
});

describe('remoteKeyToPaneKey: the id, as the tmux-sending path already understands it', () => {
  it('maps each id to the exact PaneKey sendToPane dispatches on', () => {
    const expected: Record<(typeof REMOTE_KEY_IDS)[number], PaneKey> = {
      escape: { kind: 'escape' },
      enter: { kind: 'enter', shift: false },
      'back-tab': { kind: 'back-tab' },
      backspace: { kind: 'backspace' },
      space: { kind: 'text', text: ' ' },
      tab: { kind: 'text', text: '\t' },
    };
    for (const id of REMOTE_KEY_IDS) {
      expect(remoteKeyToPaneKey(id)).toEqual(expected[id]);
    }
  });

  it('tab is the literal-text path, never a bare word', () => {
    // FALSIFICATION TARGET: change this arm to `{ kind: 'text', text: 'Tab' }`
    // (the word) and this red-lines -- `sendTextArgv` types whatever string
    // it is given literally, so the six ASCII letters would land in the pane
    // instead of a single 0x09 byte (measured against a real tmux 3.7b; see
    // this module's own header).
    const key = remoteKeyToPaneKey('tab');
    expect(key).toEqual({ kind: 'text', text: '\t' });
    expect(key.kind === 'text' ? key.text.length : -1).toBe(1);
  });
});

describe('paneKeyToRemoteKeyId: the strip button, asked whether this route can carry it', () => {
  it('round-trips every one of the six', () => {
    for (const id of REMOTE_KEY_IDS) {
      expect(paneKeyToRemoteKeyId(remoteKeyToPaneKey(id))).toBe(id);
    }
  });

  it('answers null for every key this route refuses', () => {
    const outside: readonly PaneKey[] = [
      { kind: 'nav', nav: 'up' },
      { kind: 'nav', nav: 'down' },
      { kind: 'nav', nav: 'left' },
      { kind: 'control', letter: 'c' },
      { kind: 'wheel', ticks: 1, direction: 'up', column: 1, row: 1 },
      { kind: 'paste', text: 'anything' },
      { kind: 'enter', shift: true }, // Shift+Return is a literal newline, not this route's Enter
      { kind: 'text', text: 'hello' }, // free text is never allowlisted, only the two single characters above
    ];
    for (const key of outside) {
      expect(paneKeyToRemoteKeyId(key), JSON.stringify(key)).toBeNull();
    }
  });
});
