/**
 * The channel that opens a link an agent wrote -- and the process boundary
 * that is the whole reason it can exist.
 *
 * THE RULE THIS IS BUILT INSIDE. `CHANNELS.remoteOpenLink` and
 * `CHANNELS.issueOpen` both state it: a channel that took a URL from the
 * renderer would be the navigate-anywhere capability the window's deny-by-
 * default policy exists to refuse. This channel is the first that DOES take
 * one, because a transcript's links are the agent's and vam cannot enumerate
 * them in advance -- so the thing that pays for it is the allowlist below,
 * enforced HERE, in main.
 *
 * EVERY TEST IN THIS FILE CALLS MAIN'S OWN HANDLER DIRECTLY. There is no
 * renderer in the room: the arguments go straight into the registered listener
 * the way a compromised page's `ipcRenderer.invoke` would deliver them. That
 * is the point -- `out-markdown.tsx` runs the same check before it ever calls,
 * and if that call were deleted tomorrow every assertion below would still
 * hold, which is what makes the renderer's copy a convenience and this one the
 * guarantee.
 *
 * THE ALLOWED SET IS DERIVED, NEVER RETYPED -- `test/shared/link.test.ts`'s
 * rule, for the same drift.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import { registerLinkIpc } from '../../../src/main/link/ipc.js';
import type { LinkOutcome } from '../../../src/shared/link.js';
import { MAX_LINK_LENGTH, OPENABLE_PROTOCOLS } from '../../../src/shared/link.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function harness(openExternal: (url: string) => Promise<void> = async () => {}) {
  const opened: string[] = [];
  const handlers = new Map<string, Handler>();
  registerLinkIpc({ handle: (channel, listener) => void handlers.set(channel, listener) }, (url) =>
    openExternal(url).then(() => void opened.push(url)),
  );
  const handler = handlers.get(CHANNELS.linkOpen);
  if (handler === undefined) throw new Error('the link channel was never registered');
  return {
    invoke: (...args: unknown[]) => handler({}, ...args) as Promise<LinkOutcome>,
    opened,
  };
}

describe('the channel that opens an agent-written link', () => {
  it('opens an https address and says where it went', async () => {
    const { invoke, opened } = harness();
    expect(await invoke('https://example.test/runbook')).toEqual({
      ok: true,
      url: 'https://example.test/runbook',
    });
    expect(opened).toEqual(['https://example.test/runbook']);
  });

  it('opens every scheme on the allowed set, read off the set itself', async () => {
    for (const protocol of OPENABLE_PROTOCOLS) {
      const { invoke, opened } = harness();
      expect(await invoke(`${protocol}//example.test/x`), protocol).toMatchObject({ ok: true });
      expect(opened, protocol).toHaveLength(1);
    }
  });

  /**
   * THE GUARANTEE, AND THE ONLY TEST THAT REALLY MATTERS HERE. The renderer
   * refuses this too -- and that refusal is a convenience that a bug, a
   * refactor or a compromised page removes. Main is where it is load-bearing,
   * so main is where it is proven: nothing reaches the shell.
   */
  it('refuses javascript: in MAIN, whatever the renderer believed', async () => {
    const { invoke, opened } = harness();
    const outcome = await invoke('javascript:alert(1)');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('javascript');
    expect(opened).toEqual([]);
  });

  it('refuses every other scheme a model can emit, and opens nothing', async () => {
    const { invoke, opened } = harness();
    for (const address of [
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'file:///etc/passwd',
      'vscode://file/etc/passwd:1',
      'slack://channel?team=T&id=C',
      'mailto:someone@example.test',
    ]) {
      expect((await invoke(address)).ok, address).toBe(false);
    }
    expect(opened).toEqual([]);
  });

  it('refuses an address that hides its host behind credentials', async () => {
    const { invoke, opened } = harness();
    expect((await invoke('https://github.com@evil.test/login')).ok).toBe(false);
    expect(opened).toEqual([]);
  });

  /**
   * WHAT THE SHELL IS HANDED IS WHAT THE OPERATOR WAS SHOWN: the PARSED form.
   * A unicode host reaches the browser -- and the panel -- as punycode, so
   * there is no gap between the address on screen and the one that resolves.
   */
  it('hands the shell the parsed address, never the typed one', async () => {
    const { invoke, opened } = harness();
    const outcome = await invoke('https://exämple.test/x');
    expect(outcome).toMatchObject({ ok: true });
    expect(opened[0]).toContain('xn--');
  });

  it('refuses an argument that is not a string, and the wrong arity', async () => {
    const { invoke, opened } = harness();
    for (const args of [[], [42], [null], [{}], ['https://a.test/', 'https://b.test/']]) {
      expect((await invoke(...args)).ok, JSON.stringify(args)).toBe(false);
    }
    expect(opened).toEqual([]);
  });

  it('refuses an address past the bound rather than parking it on main', async () => {
    const { invoke, opened } = harness();
    expect((await invoke(`https://example.test/${'a'.repeat(MAX_LINK_LENGTH)}`)).ok).toBe(false);
    expect(opened).toEqual([]);
  });

  /**
   * A REFUSAL TRAVELS AS DATA, like everywhere else on this bridge. A shell
   * that throws -- no browser, a sandbox that declined -- must not reach the
   * renderer as an electron-rewritten rejection, because the control's whole
   * job is to say what happened.
   */
  it('answers a refusal, never a rejection, when the shell will not open it', async () => {
    const { invoke } = harness(async () => {
      throw new Error('no browser');
    });
    const outcome = await invoke('https://example.test/x');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('example.test');
  });
});
