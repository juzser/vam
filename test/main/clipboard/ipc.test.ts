/**
 * The clipboard channel. The renderer is the least trusted process in the
 * app, so what it sends is validated before it reaches electron's clipboard,
 * and the answer is the truth about whether the text landed -- that answer is
 * the only thing standing between the operator and a status bar that claims a
 * copy which never happened.
 */

import type { Clipboard as MainProcessClipboard } from 'electron/main';
import { describe, expect, it } from 'vitest';
import type { ClipboardLike } from '../../../src/main/clipboard/ipc.js';
import { MAX_CLIPBOARD_LENGTH, registerClipboardIpc } from '../../../src/main/clipboard/ipc.js';
import { CHANNELS } from '../../../src/main/ipc/channels.js';

/**
 * Invariant type equality. `extends` is useless for this question: TypeScript
 * deliberately lets a `Promise<void>`-returning function satisfy a
 * `void`-returning signature, so an assignability check passes whichever of
 * the two `ClipboardLike` declares. That rule is exactly why the wrong shape
 * compiled here for as long as it did, so this compares the return types
 * themselves, in both directions.
 */
type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/**
 * `ClipboardLike` is a hand-written stand-in for a module this test never
 * loads, which makes every runtime assertion below a statement about a fake.
 * This line is the one that is not: it reads the REAL main-process signature
 * out of electron's own shipped `electron.d.ts` -- `electron/main`, not
 * `electron`, because the renderer's `navigator.clipboard` is a different API
 * and confusing the two is the whole hazard this channel exists for -- and it
 * fails `tsc -p tsconfig.test.json` the moment the stand-in stops matching.
 *
 * Electron 44 rewrote the main-process clipboard into the W3C shape, so
 * `writeText` returns `Promise<void>`, not the historical `void`. If a future
 * Electron changes it back, or someone re-types `ClipboardLike` from memory,
 * this stops compiling instead of quietly going wrong.
 */
const _clipboardLikeMatchesElectron: Exact<
  ReturnType<ClipboardLike['writeText']>,
  ReturnType<MainProcessClipboard['writeText']>
> = true;

type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * The fakes below return `Promise<void>` because the real module does. A fake
 * that returned `void` would still satisfy `ClipboardLike` -- TypeScript's
 * void-return rule again -- and would then be a stand-in for an API that does
 * not exist, which is how a suite ends up green about the wrong thing.
 */
function harness(writeText: (text: string) => Promise<void> = async () => {}) {
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
    const invoke = harness(async (text) => void written.push(text));
    expect(invoke('smith gate run')).toBe(true);
    expect(written).toEqual(['smith gate run']);
  });

  // A SYNCHRONOUS throw, which is the only way the real `writeText` fails:
  // its promise has no reject path (see `src/main/clipboard/ipc.ts`), but gin
  // still throws out of argument conversion before any promise exists --
  // measured against the real module, which answers a non-string with
  // "Error processing argument at index 0, conversion failure from ...".
  // So this is the failure the channel has to keep turning into `false`.
  it('answers false rather than throwing when the clipboard fails', () => {
    const invoke = harness(() => {
      throw new Error('no clipboard on this platform');
    });
    expect(invoke('smith gate run')).toBe(false);
  });

  it('refuses anything that is not one non-empty string', () => {
    const written: string[] = [];
    const invoke = harness(async (text) => void written.push(text));
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
