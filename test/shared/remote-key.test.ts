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

describe('the twenty ids, closed', () => {
  it('is exactly this list, in this order', () => {
    expect(REMOTE_KEY_IDS).toEqual([
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
    ]);
    expect(REMOTE_KEY_IDS).toHaveLength(20);
  });

  it('isRemoteKeyId rejects every near miss: no prefix, no pattern, no chord', () => {
    for (const value of [
      'ctrl-b',
      'ctrl-x',
      'ctrl-',
      'C-c',
      'up',
      'Delete',
      'ctrl-c ',
      'ctrl-C',
      'arrow-',
      42,
      null,
      undefined,
      {},
    ]) {
      expect(isRemoteKeyId(value), `isRemoteKeyId(${JSON.stringify(value)})`).toBe(false);
    }
  });

  it('maps the new ids to the PaneKeys the local path already delivers', () => {
    expect(remoteKeyToPaneKey('ctrl-c')).toEqual({ kind: 'control', letter: 'c' });
    expect(remoteKeyToPaneKey('arrow-left')).toEqual({ kind: 'nav', nav: 'left' });
    expect(remoteKeyToPaneKey('delete')).toEqual({ kind: 'nav', nav: 'delete' });
    expect(remoteKeyToPaneKey('arrow-up')).toEqual({ kind: 'nav', nav: 'up' });
    expect(remoteKeyToPaneKey('ctrl-u')).toEqual({ kind: 'control', letter: 'u' });
  });

  it('round-trips each of the fourteen new ids', () => {
    const added = REMOTE_KEY_IDS.slice(6);
    expect(added).toHaveLength(14);
    for (const id of added) {
      expect(paneKeyToRemoteKeyId(remoteKeyToPaneKey(id)), id).toBe(id);
    }
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
      delete: { kind: 'nav', nav: 'delete' },
      'arrow-up': { kind: 'nav', nav: 'up' },
      'arrow-down': { kind: 'nav', nav: 'down' },
      'arrow-left': { kind: 'nav', nav: 'left' },
      'arrow-right': { kind: 'nav', nav: 'right' },
      'ctrl-c': { kind: 'control', letter: 'c' },
      'ctrl-d': { kind: 'control', letter: 'd' },
      'ctrl-l': { kind: 'control', letter: 'l' },
      'ctrl-z': { kind: 'control', letter: 'z' },
      'ctrl-r': { kind: 'control', letter: 'r' },
      'ctrl-a': { kind: 'control', letter: 'a' },
      'ctrl-e': { kind: 'control', letter: 'e' },
      'ctrl-w': { kind: 'control', letter: 'w' },
      'ctrl-u': { kind: 'control', letter: 'u' },
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
  it('round-trips every one of the twenty', () => {
    for (const id of REMOTE_KEY_IDS) {
      expect(paneKeyToRemoteKeyId(remoteKeyToPaneKey(id))).toBe(id);
    }
  });

  it('answers null for every key this route refuses', () => {
    const outside: readonly PaneKey[] = [
      { kind: 'nav', nav: 'home' },
      { kind: 'nav', nav: 'page-down' },
      { kind: 'control', letter: 'b' },
      { kind: 'control', letter: 'x' },
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
