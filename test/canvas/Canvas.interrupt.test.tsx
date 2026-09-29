// @vitest-environment happy-dom

/**
 * `Mod-.` SENDS ESCAPE INTO THE FOCUSED SESSION'S PANE — the operator's
 * reversal, and then a regression the reversal introduced.
 *
 * Escape used to do this, first inside the terminal pane and then, briefly,
 * from the composer too. Asked "should Esc leave Insert, with
 * cancel-previous-prompt on a different key?", the operator chose exactly
 * that, so this moved to a chord of its own: `Cmd+.` on macOS, `Ctrl+.`
 * elsewhere over the SAME `Mod-` fold every other command-modifier chord in
 * this grammar already gets.
 *
 * BOUND HERE, AT THE WINDOW LEVEL, rather than inside `DetailPanel`'s own
 * composer — the operator's own words were "whenever a session is focused",
 * not "while its composer is open", and `Canvas.tsx` is where every other
 * per-session global chord already lives (`x`/`Mod-w` close, `r` rename,
 * `yy` copy). `DetailPanel`'s existing `interruptRun` stays exactly as it
 * was (the bubble menu's "Cancel prompt", the phone strip's `Escape` tap).
 *
 * WHAT CHANGED FROM THE FIRST LANDING: this case used to reuse
 * `interruptRefusal`, the SAME status-gated ternary "Cancel this turn" reads
 * — refusing "nothing running to interrupt" the instant a session left
 * `running`. That made this the interrupt's twin bug: an idle or waiting
 * session still has a pane, and a literal Escape is what dismisses Claude
 * Code's own menus, drives its Esc-Esc rewind, and reaches vim — none of
 * which needs the agent mid-turn. This case now reads
 * `domain/selectors.ts`'s `sendEscapeRefusal`, which drops the status check
 * entirely and keeps only the three refusals that are actually about
 * WHETHER THE PANE IS REACHABLE (no terminal, no session focused, a session
 * vam did not start) — covered on its own in
 * `test/domain/interrupt-refusal.test.ts`. `cancelPromptRefusal` is the
 * other half of that split, still status-gated, still what "Cancel this
 * turn" reads.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';
import type { PaneSendResult } from '../../src/shared/terminal.js';

function session(over: Partial<Session> = {}): Session {
  return {
    id: 'a1',
    title: 'a1',
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 1,
    activity: null,
    age: '2m',
    decisions: [],
    vamControlled: true,
    ...over,
  };
}

function modelWith(over: Partial<Session> = {}): CanvasModel {
  return {
    projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session(over)] }],
  };
}

/** A `claude-code` source, with the terminal capability the interrupt needs. */
function sourceWith(hasTerminal: boolean): CanvasSource {
  const inner = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: {
      liveUpdates: false,
      recordPrompt: true,
      deliverPrompt: true,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      closeSession: false,
      createSession: false,
      governance: false,
      pullRequests: false,
      terminal: hasTerminal,
      agentRoster: false,
      resumeSession: false,
    },
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: { recordPrompt: async () => {} },
  };
  return { kind: 'session', source: inner as unknown as SessionSource, onWrote: () => {} };
}

function withBridge(result: PaneSendResult = 'sent') {
  const send = vi.fn(async (): Promise<PaneSendResult> => result);
  Object.defineProperty(window, 'api', {
    value: { terminal: { send } },
    configurable: true,
    writable: true,
  });
  return send;
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  Object.defineProperty(window, 'api', { value: undefined, configurable: true, writable: true });
});

const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';

async function pressInterrupt() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '.', metaKey: true, bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Cmd+. sends Escape into the focused session', () => {
  it('presses Escape into the focused session’s pane, over the desktop bridge', async () => {
    const send = withBridge('sent');
    render(<Canvas model={modelWith()} source={sourceWith(true)} />);
    await pressInterrupt();
    expect(send).toHaveBeenCalledWith('p1', { kind: 'escape' }, 'a1');
  });

  it('works with the keyboard on the session list — Select, not only Insert', async () => {
    // No `i`/`I` here at all: the operator's own words were "in and out of
    // Insert mode, whenever a session is focused", and the sidebar's own
    // cursor is what "focused" means with the keyboard on the list.
    const send = withBridge('sent');
    render(<Canvas model={modelWith()} source={sourceWith(true)} />);
    expect(document.activeElement).toBe(document.body);
    await pressInterrupt();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports a bridge that refused, rather than looking like an interrupt that landed', async () => {
    const send = withBridge('refused');
    render(<Canvas model={modelWith()} source={sourceWith(true)} />);
    await pressInterrupt();
    expect(send).toHaveBeenCalledTimes(1);
    expect(statusBar().toLowerCase()).toContain('not sent');
  });

  /**
   * THE REGRESSION THIS FILE EXISTS TO CATCH. `sendEscapeRefusal` drops the
   * status check `interruptRefusal` used to make here, so an idle or a
   * waiting session sends Escape exactly as a running one does — the only
   * way left to reach Claude Code's own Esc-Esc rewind, dismiss its `/model`
   * or `/resume` menus, clear its input, or leave vim's insert mode once a
   * turn has actually finished.
   */
  it.each(['idle', 'waiting', 'done', 'failed'] as const)(
    'sends Escape to a %s session too — its pane still exists',
    async (status) => {
      const send = withBridge('sent');
      render(<Canvas model={modelWith({ status })} source={sourceWith(true)} />);
      await pressInterrupt();
      expect(send).toHaveBeenCalledWith('p1', { kind: 'escape' }, 'a1');
    },
  );

  it('sends two Escs for two presses, so Esc-Esc rewind still works on an idle session', async () => {
    const send = withBridge('sent');
    render(<Canvas model={modelWith({ status: 'idle' })} source={sourceWith(true)} />);
    await pressInterrupt();
    await pressInterrupt();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, 'p1', { kind: 'escape' }, 'a1');
    expect(send).toHaveBeenNthCalledWith(2, 'p1', { kind: 'escape' }, 'a1');
  });
});

describe('an interrupt with nothing to reach says so, and sends nothing', () => {
  it('refuses on no session focused at all', async () => {
    const send = withBridge();
    render(<Canvas model={{ projects: [] }} source={sourceWith(true)} />);
    await pressInterrupt();
    expect(send).not.toHaveBeenCalled();
    expect(statusBar()).not.toBe('');
  });

  it('refuses on a session vam did not start, distinctly from "nothing running"', async () => {
    const send = withBridge();
    // `hideForeign` (`session-filter.ts`) hides a `vamControlled: false`
    // session from the list by default — right for a rule that answers "is
    // this vam's to act on", wrong for this test, which needs exactly such
    // a session focused to prove the refusal names it correctly rather than
    // finding no session at all.
    localStorage.setItem('vam.prefs.v1', JSON.stringify({ filters: { hideForeign: false } }));
    render(<Canvas model={modelWith({ vamControlled: false })} source={sourceWith(true)} />);
    await pressInterrupt();
    expect(send).not.toHaveBeenCalled();
    expect(statusBar().toLowerCase()).toContain('did not start');
    expect(statusBar().toLowerCase()).not.toContain('nothing running');
  });

  it('refuses on a source with no terminal at all, distinctly from the other two', async () => {
    const send = withBridge();
    render(<Canvas model={modelWith()} source={sourceWith(false)} />);
    await pressInterrupt();
    expect(send).not.toHaveBeenCalled();
    expect(statusBar().toLowerCase()).toContain('terminal');
    expect(statusBar().toLowerCase()).not.toContain('did not start');
  });

  it('refuses without a crash when this build has no keyboard into any pane at all', async () => {
    // No `window.api` — the web build with no Electron bridge.
    render(<Canvas model={modelWith()} source={sourceWith(true)} />);
    await pressInterrupt();
    expect(statusBar()).not.toBe('');
  });
});

describe('Cmd+. is never eaten by a focused text field', () => {
  it('fires from inside the prompt box, where the operator’s hands often are', async () => {
    const send = withBridge('sent');
    const { container } = render(<Canvas model={modelWith()} source={sourceWith(true)} />);
    await act(async () => {
      (document.querySelector('[data-row-cursor]') as HTMLElement | null)?.click();
    });
    const box = container.querySelector('textarea[aria-label="prompt to session"]');
    expect(box).not.toBeNull();
    await act(async () => {
      (box as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: '.', metaKey: true, bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledWith('p1', { kind: 'escape' }, 'a1');
  });
});
