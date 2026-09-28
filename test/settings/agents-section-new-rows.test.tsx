// @vitest-environment happy-dom

/**
 * Agents' second PR: keep computer awake, auto tab titles, agent
 * permissions (SECURITY-SENSITIVE -- Manual is the default, Yolo requires an
 * explicit confirmation naming the risk), and default agent.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

afterEach(() => {
  // `cleanup()` unmounts every root this file rendered -- not decoration:
  // React's scheduler defers some commits to a macrotask
  // (`performWorkOnRootViaSchedulerTask`/`setImmediate`), and an un-unmounted
  // root can still have one pending when this FILE's happy-dom `window` is
  // torn down, throwing "window is not defined" from inside react-dom
  // (reproduced under load: `vitest run test/settings/`, ~1 in 12 runs, this
  // file named in the stack). A bare `document.body.innerHTML = ''` removes
  // the DOM but never tells React to unmount, so that pending work survives
  // the wipe. `cleanup()` cancels it per root, the same idiom
  // `test/canvas/Canvas.*` already uses.
  cleanup();
  document.body.innerHTML = '';
  Reflect.deleteProperty(window, 'api');
});

/** Stubs a truthy, minimal `window.api` -- `isDesktopShell()`'s own signal
 *  (`prefs/agent-permissions.ts`) for "this is the real Electron shell, not a
 *  paired browser tab at any viewport width." */
function markDesktopShell(): void {
  (window as unknown as { api: unknown }).api = {};
}

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  render(
    <SettingsOverlay
      prefs={prefs}
      theme="dark"
      onChange={onChange}
      onClose={() => {}}
      initialSection="agents"
    />,
  );
  return { onChange };
}

function changed(onChange: { mock: { calls: unknown[][] } }, index = 0): Prefs {
  const call = onChange.mock.calls[index];
  expect(call, `onChange was not called ${index + 1} time(s)`).toBeDefined();
  return (call ?? [])[0] as Prefs;
}

describe('keep computer awake', () => {
  const option = (choice: string) =>
    document.querySelector<HTMLButtonElement>(`[data-keep-awake-option="${choice}"]`);

  it('offers three choices, off pressed by default', () => {
    open();
    expect(option('off')?.getAttribute('aria-pressed')).toBe('true');
    expect(option('on')?.getAttribute('aria-pressed')).toBe('false');
    expect(option('while-running')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('writes the choice', () => {
    const { onChange } = open();
    fireEvent.click(option('while-running') as HTMLElement);
    expect(changed(onChange, 0).keepAwake).toBe('while-running');
  });
});

describe('auto tab titles', () => {
  const toggle = () => document.querySelector<HTMLButtonElement>('[data-switch="auto-tab-titles"]');

  it('defaults on -- both derivations already ship unconditionally', () => {
    open();
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
  });

  it('writes off', () => {
    const { onChange } = open();
    fireEvent.click(toggle() as HTMLElement);
    expect(changed(onChange, 0).autoTabTitles).toBe(false);
  });
});

describe('agent permissions -- SECURITY-SENSITIVE', () => {
  const manual = () =>
    document.querySelector<HTMLButtonElement>('[data-agent-permissions-option="manual"]');
  const yolo = () =>
    document.querySelector<HTMLButtonElement>('[data-agent-permissions-option="yolo"]');
  const confirmYes = () => document.querySelector<HTMLButtonElement>('[data-yolo-confirm-yes]');
  const confirmCancel = () =>
    document.querySelector<HTMLButtonElement>('[data-yolo-confirm-cancel]');
  const risk = () => document.querySelector('[data-yolo-risk]');

  it('manual is pressed by default, and yolo is not', () => {
    markDesktopShell();
    open();
    expect(manual()?.getAttribute('aria-pressed')).toBe('true');
    expect(yolo()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('picking manual writes immediately -- no confirmation for the safe direction', () => {
    markDesktopShell();
    const { onChange } = open({ ...EMPTY_PREFS, agentPermissions: 'yolo' });
    fireEvent.click(manual() as HTMLElement);
    expect(changed(onChange, 0).agentPermissions).toBe('manual');
  });

  it('picking yolo does NOT write yet -- it opens a confirmation naming the risk', () => {
    markDesktopShell();
    const { onChange } = open();
    fireEvent.click(yolo() as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
    expect(risk()).not.toBeNull();
    expect(risk()?.textContent ?? '').toMatch(/skip|permission|risk|danger/i);
  });

  it('cancelling the confirmation writes nothing and leaves manual pressed', () => {
    markDesktopShell();
    const { onChange } = open();
    fireEvent.click(yolo() as HTMLElement);
    fireEvent.click(confirmCancel() as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
    expect(manual()?.getAttribute('aria-pressed')).toBe('true');
    expect(risk()).toBeNull();
  });

  it('confirming writes yolo', () => {
    markDesktopShell();
    const { onChange } = open();
    fireEvent.click(yolo() as HTMLElement);
    fireEvent.click(confirmYes() as HTMLElement);
    expect(changed(onChange, 0).agentPermissions).toBe('yolo');
  });

  it('once yolo is already the stored choice, it is pressed with no confirmation offered', () => {
    markDesktopShell();
    open({ ...EMPTY_PREFS, agentPermissions: 'yolo' });
    expect(yolo()?.getAttribute('aria-pressed')).toBe('true');
    expect(risk()).toBeNull();
  });

  it('is ABSENT outside the real desktop shell -- a paired browser tab at any viewport width has no window.api', () => {
    // No markDesktopShell() call: `window.api` stays undefined, the same
    // state a paired browser tab is in regardless of its own layout width
    // (#529/S2's own finding: viewport width and "is this the desktop app"
    // are two different questions, and only the second one is the gate).
    open();
    expect(manual()).toBeNull();
    expect(yolo()).toBeNull();
    expect(risk()).toBeNull();
  });
});

describe('default agent', () => {
  const option = (choice: string) =>
    document.querySelector<HTMLButtonElement>(`[data-default-agent-option="${choice}"]`);

  it('offers all four, auto pressed by default', () => {
    open();
    expect(option('auto')?.getAttribute('aria-pressed')).toBe('true');
    expect(option('none')?.getAttribute('aria-pressed')).toBe('false');
    expect(option('claude-code')?.getAttribute('aria-pressed')).toBe('false');
    expect(option('codex')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('writes the choice', () => {
    const { onChange } = open();
    fireEvent.click(option('none') as HTMLElement);
    expect(changed(onChange, 0).defaultAgent).toBe('none');
  });
});
