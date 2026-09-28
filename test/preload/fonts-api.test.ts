/**
 * `createFontsApi`'s two members, each a bare `ipc.invoke` forward -- no
 * `unwrap`, the same reasoning `preload/api.ts`'s own header gives for
 * `listMonospace`: an enumeration failure is a fact about this machine's
 * disk, not a `SourceError` there is a source to phrase in the words of.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import { createFontsApi } from '../../src/preload/api.js';

function fakeInvoker(answers: Record<string, unknown>) {
  const calls: string[] = [];
  return {
    invoke: vi.fn((channel: string) => {
      calls.push(channel);
      return Promise.resolve(answers[channel]);
    }),
    calls,
  };
}

describe('createFontsApi', () => {
  it('listMonospace invokes the monospace channel and forwards the answer', async () => {
    const invoker = fakeInvoker({ [CHANNELS.fontsListMonospace]: ['Menlo'] });
    const api = createFontsApi(invoker);
    await expect(api.listMonospace()).resolves.toEqual(['Menlo']);
    expect(invoker.calls).toEqual([CHANNELS.fontsListMonospace]);
  });

  it('listSans invokes the sans channel and forwards the answer, never the monospace one', async () => {
    const invoker = fakeInvoker({ [CHANNELS.fontsListSans]: ['Futura', 'Optima'] });
    const api = createFontsApi(invoker);
    await expect(api.listSans()).resolves.toEqual(['Futura', 'Optima']);
    expect(invoker.calls).toEqual([CHANNELS.fontsListSans]);
  });
});
