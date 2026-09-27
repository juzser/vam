// @vitest-environment happy-dom

/**
 * THE PERSISTENT YOLO MARK -- a small, quiet chip on a session's tab, saying
 * permission prompts were skipped when vam started that session
 * (`prefs/yolo-starts.ts`'s own header for the whole story).
 *
 * DRIVEN BY `session.startedWithYolo` ALONE, a start-time fact
 * (`prefs/prefs.ts`'s `applyYoloStarts`), never by the LIVE `agentPermissions`
 * preference -- the coordinator's own scope for this feature. The describe
 * block below titled "survives a later change to the pref" is the one that
 * pins that down at the rendered-DOM layer; `test/prefs/prefs.yolo-starts.
 * test.ts` already pins the same guarantee one layer down, at the prefs
 * functions themselves.
 *
 * SHOWN UNCONDITIONALLY, unlike `draft`/`pending`/`agents`
 * (`prefs/tab-indicators.ts`): there is no setting that hides this mark,
 * because it is a safety-relevant fact rather than an operator preference
 * about clutter.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    ...over,
  };
}

function modelWith(...sessions: readonly Session[]): CanvasModel {
  return { projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions }] };
}

const tabs = () => [...document.querySelectorAll('[data-session-tab]')];
const tabOf = (id: string) =>
  tabs().find(
    (tab) =>
      tab.querySelector('[data-tab-close]')?.getAttribute('aria-label') === `close session ${id}`,
  ) ?? null;
const yoloMarkOf = (id: string) => tabOf(id)?.querySelector('[data-tab-mark="yolo"]') ?? null;

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
});

describe('a session started with the permission-skip flag', () => {
  it('shows the yolo mark on its tab', () => {
    render(<Canvas model={modelWith(session('yolo-1', { startedWithYolo: true }))} />);
    expect(yoloMarkOf('yolo-1')).not.toBeNull();
  });

  it('names it for a screen reader, and gives it a keyboard-reachable tooltip', () => {
    render(<Canvas model={modelWith(session('yolo-1', { startedWithYolo: true }))} />);
    const mark = yoloMarkOf('yolo-1');
    expect(mark?.getAttribute('role')).toBe('img');
    expect(mark?.getAttribute('aria-label')).toBe(
      'permission prompts are skipped for this session',
    );
    // `Note` (`panels/Note.tsx`) merges `data-note` onto this same element via
    // `Tooltip.Trigger asChild` -- a `title` attribute would say the same
    // thing to a mouse and nothing to a keyboard.
    expect(mark?.getAttribute('data-note')).toBe('permission prompts are skipped for this session');
  });
});

describe('a session started without it', () => {
  it('draws no yolo mark at all', () => {
    render(<Canvas model={modelWith(session('manual-1'))} />);
    expect(yoloMarkOf('manual-1')).toBeNull();
  });
});

describe('driven by the recorded fact, never the live pref', () => {
  it('keeps showing the mark after agentPermissions changes to manual', async () => {
    // The session's own mark came from `startedWithYolo`, set once at
    // creation -- a later change to the live preference (an operator
    // toggling Settings, or simply the shipped default) must not repaint it.
    localStorage.setItem('vam.prefs.v1', JSON.stringify({ agentPermissions: 'yolo' }));
    render(<Canvas model={modelWith(session('yolo-1', { startedWithYolo: true }))} />);
    expect(yoloMarkOf('yolo-1')).not.toBeNull();

    localStorage.setItem('vam.prefs.v1', JSON.stringify({ agentPermissions: 'manual' }));
    // Nothing here re-derives the mark from the pref: the model passed to
    // `Canvas` already carries `startedWithYolo`, independent of whatever
    // `agentPermissions` a later render reads.
    await act(async () => {});
    expect(yoloMarkOf('yolo-1')).not.toBeNull();
  });
});

describe('not gated behind the optional tab-indicator settings', () => {
  it('draws even though "yolo" is not one of the operator-togglable indicator ids', () => {
    // No prefs seeded at all -- `prefs/tab-indicators.ts`'s `TAB_INDICATORS`
    // constant has no "yolo" entry to switch off in the first place; this
    // mark simply is not read through `isTabIndicatorOn`.
    render(<Canvas model={modelWith(session('yolo-1', { startedWithYolo: true }))} />);
    expect(yoloMarkOf('yolo-1')).not.toBeNull();
  });
});
