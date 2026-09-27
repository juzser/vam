// @vitest-environment happy-dom

/**
 * "Keep computer awake" (`prefs/keep-awake.ts`) crossing into main: the
 * renderer pushes `{mode, anyAgentRunning}` through `window.api.power.
 * setKeepAwake` whenever either changes, and main's `KeepAwakeController`
 * is the state machine that turns that into a real `powerSaveBlocker`
 * (`test/main/power/power-save.test.ts` owns THAT half). Off by default, so
 * a build with no bridge member at all (a packaged preload that predates
 * this feature) must not throw.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

const EMPTY: CanvasModel = { projects: [] };

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
  Reflect.deleteProperty(window, 'api');
  vi.restoreAllMocks();
});

function seed(prefs: Record<string, unknown>): void {
  localStorage.setItem('vam.prefs.v1', JSON.stringify(prefs));
}

function session(id: string, status: Session['status']): Session {
  return {
    id,
    title: id,
    epic: null,
    branch: null,
    status,
    runningAgents: status === 'running' ? 1 : 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

describe('the keep-awake bridge call', () => {
  it('is never made in the browser build -- no window.api, no throw', async () => {
    render(<Canvas model={EMPTY} />);
    await act(async () => {});
    // Absence of a crash is the assertion; there is nothing to spy on.
  });

  it('pushes off with no agents running, off by default', async () => {
    const setKeepAwake = vi.fn();
    (window as unknown as { api: unknown }).api = { power: { setKeepAwake } };
    render(<Canvas model={EMPTY} />);
    await act(async () => {});
    expect(setKeepAwake).toHaveBeenCalledWith({ mode: 'off', anyAgentRunning: false });
  });

  it('reports anyAgentRunning true the moment a session is running', async () => {
    const setKeepAwake = vi.fn();
    (window as unknown as { api: unknown }).api = { power: { setKeepAwake } };
    seed({ keepAwake: 'while-running' });
    const model: CanvasModel = {
      projects: [{ id: 'p1', name: 'alpha', sessions: [session('a1', 'running')] }],
    };
    render(<Canvas model={model} />);
    await act(async () => {});
    expect(setKeepAwake).toHaveBeenCalledWith({ mode: 'while-running', anyAgentRunning: true });
  });

  it('reports anyAgentRunning false when nothing is running', async () => {
    const setKeepAwake = vi.fn();
    (window as unknown as { api: unknown }).api = { power: { setKeepAwake } };
    seed({ keepAwake: 'while-running' });
    const model: CanvasModel = {
      projects: [{ id: 'p1', name: 'alpha', sessions: [session('a1', 'idle')] }],
    };
    render(<Canvas model={model} />);
    await act(async () => {});
    expect(setKeepAwake).toHaveBeenCalledWith({ mode: 'while-running', anyAgentRunning: false });
  });

  it('pushes on unconditionally', async () => {
    const setKeepAwake = vi.fn();
    (window as unknown as { api: unknown }).api = { power: { setKeepAwake } };
    seed({ keepAwake: 'on' });
    render(<Canvas model={EMPTY} />);
    await act(async () => {});
    expect(setKeepAwake).toHaveBeenCalledWith({ mode: 'on', anyAgentRunning: false });
  });

  it('does nothing when the bridge member is absent (a preload that predates it)', async () => {
    (window as unknown as { api: unknown }).api = {};
    render(<Canvas model={EMPTY} />);
    await act(async () => {});
    // No throw is the assertion.
  });
});
