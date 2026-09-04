/**
 * The clipboard channel. The renderer is the least trusted process in the
 * app, so what it sends is validated before it reaches electron's clipboard,
 * and the answer is the truth about whether the text landed -- that answer is
 * the only thing standing between the operator and a status bar that claims a
 * copy which never happened.
 */

import { describe, expect, it } from 'vitest';
import { MAX_CLIPBOARD_LENGTH, registerClipboardIpc } from '../../../src/main/clipboard/ipc.js';
import { CHANNELS } from '../../../src/main/ipc/channels.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function harness(writeText: (text: string) => void = () => {}) {
  const handlers = new Map<string, Handler>();
  registerClipboardIpc(
    { handle: (channel, listener) => void handlers.set(channel, listener) },
    {
      writeText,
    },
  );
  const handler = handlers.get(CHANNELS.clipboardWrite);
  if (handler === undefined) throw new Error('the clipboard channel was never registered');
  return (...args: unknown[]) => handler({}, ...args);
}

describe('the clipboard channel', () => {
  it('writes the text and answers true', () => {
    const written: string[] = [];
    const invoke = harness((text) => void written.push(text));
    expect(invoke('smith gate run')).toBe(true);
    expect(written).toEqual(['smith gate run']);
  });

  it('answers false rather than throwing when the clipboard fails', () => {
    const invoke = harness(() => {
      throw new Error('no clipboard on this platform');
    });
    expect(invoke('smith gate run')).toBe(false);
  });

  it('refuses anything that is not one non-empty string', () => {
    const written: string[] = [];
    const invoke = harness((text) => void written.push(text));
    expect(invoke()).toBe(false);
    expect(invoke('')).toBe(false);
    expect(invoke(42)).toBe(false);
    expect(invoke('a', 'b')).toBe(false);
    expect(invoke('x'.repeat(MAX_CLIPBOARD_LENGTH + 1))).toBe(false);
    expect(written).toEqual([]);
  });

  it('accepts text right up to the bound', () => {
    const invoke = harness();
    expect(invoke('x'.repeat(MAX_CLIPBOARD_LENGTH))).toBe(true);
  });
});
