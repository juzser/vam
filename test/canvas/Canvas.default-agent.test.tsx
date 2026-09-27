// @vitest-environment happy-dom

/**
 * Settings -> Agents -> Default agent: `Auto` (today's exact behaviour --
 * whatever `defaultProvider` already names), a specific provider FORCED
 * regardless of `defaultProvider`, or `No agent` -- read a second way,
 * `preferNoAgent` (`resolveDefaultAgentSelection`'s own header, `prefs.ts`,
 * for why). Wired into the one place `defaultProvider` already seeded a
 * picker: the Start-session screen.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

const PANE = 'vam-alpha-aa11bb';

const UNSTARTED: Session = {
  id: `pane:${PANE}`,
  title: PANE,
  epic: null,
  branch: null,
  status: 'unstarted',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [],
  source: 'claude-code',
  vamControlled: true,
  pane: PANE,
};

function modelWith(...sessions: readonly Session[]): CanvasModel {
  return { projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions }] };
}

function seed(prefs: Record<string, unknown>): void {
  localStorage.setItem('vam.prefs.v1', JSON.stringify(prefs));
}

const chosenProvider = () =>
  document
    .querySelector('[data-start-providers] [aria-pressed="true"]')
    ?.getAttribute('data-start-provider');
const startSession = () => document.querySelector('[data-start-session]');

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
  vi.useRealTimers();
});

describe('defaultAgent: auto (the default) changes nothing', () => {
  it('seeds the picker from defaultProvider, exactly as before this setting existed', async () => {
    seed({ defaultProvider: 'codex' });
    render(<Canvas model={modelWith(UNSTARTED)} />);
    await act(async () => {});
    expect(chosenProvider()).toBe('codex');
    expect(startSession()?.getAttribute('data-prefer-no-agent')).toBeNull();
  });
});

describe('defaultAgent: a forced provider overrides defaultProvider outright', () => {
  it('claude-code wins even when defaultProvider says codex', async () => {
    seed({ defaultProvider: 'codex', defaultAgent: 'claude-code' });
    render(<Canvas model={modelWith(UNSTARTED)} />);
    await act(async () => {});
    expect(chosenProvider()).toBe('claude-code');
  });

  it('codex wins even when defaultProvider says claude-code', async () => {
    seed({ defaultProvider: 'claude-code', defaultAgent: 'codex' });
    render(<Canvas model={modelWith(UNSTARTED)} />);
    await act(async () => {});
    expect(chosenProvider()).toBe('codex');
  });
});

describe('defaultAgent: none', () => {
  it('still seeds the picker from defaultProvider (a component constraint), and marks preferNoAgent', async () => {
    seed({ defaultProvider: 'codex', defaultAgent: 'none' });
    render(<Canvas model={modelWith(UNSTARTED)} />);
    await act(async () => {});
    expect(chosenProvider()).toBe('codex');
    expect(startSession()?.getAttribute('data-prefer-no-agent')).toBe('true');
    // The mark that would otherwise push one provider's brand at the operator
    // is withdrawn -- see `StartSession`'s own header.
    expect(document.querySelector('[data-start-session-mark]')).toBeNull();
  });
});
