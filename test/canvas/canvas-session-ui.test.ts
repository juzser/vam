// @vitest-environment happy-dom
/**
 * The extracted PER-SESSION EPHEMERAL UI hook, asserted through its own
 * return value -- not through `Canvas`'s DOM. Three load-bearing rules:
 * `setDraftFor` isolates sessions from each other, `setViewFor` records a
 * per-session tab (without disturbing another session's), and
 * `setSendFailureFor(id, null)` clears a verdict rather than storing a
 * false-positive failure.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCanvasSessionUi } from '../../src/renderer/canvas/canvas-session-ui.js';
import { EMPTY_PREFS, type Prefs, setDetailTab } from '../../src/renderer/prefs/prefs.js';

describe('useCanvasSessionUi', () => {
  it('setDraftFor isolates sessions', () => {
    const { result } = renderHook(() => useCanvasSessionUi(EMPTY_PREFS, () => {}));

    act(() => {
      result.current.setDraftFor('s1', 'hello from s1');
    });
    act(() => {
      result.current.setDraftFor('s2', 'hello from s2');
    });

    expect(result.current.draftsBySession.s1).toBe('hello from s1');
    expect(result.current.draftsBySession.s2).toBe('hello from s2');
  });

  it('setViewFor records a per-session tab', () => {
    const { result } = renderHook(() => useCanvasSessionUi(EMPTY_PREFS, () => {}));

    act(() => {
      result.current.setViewFor('s1', 'PRs');
    });

    expect(result.current.viewBySession.s1).toBe('PRs');
    expect(result.current.viewBySession.s2).toBeUndefined();
  });

  it('setSendFailureFor(id, null) clears rather than storing a false-positive failure', () => {
    const { result } = renderHook(() => useCanvasSessionUi(EMPTY_PREFS, () => {}));

    act(() => {
      result.current.setSendFailureFor('s1', 'send failed');
    });
    expect(result.current.sendFailureBySession.s1).toBe('send failed');

    act(() => {
      result.current.setSendFailureFor('s1', null);
    });

    expect(result.current.sendFailureBySession.s1).toBeUndefined();
  });

  it('setComposingFor isolates sessions', () => {
    const { result } = renderHook(() => useCanvasSessionUi(EMPTY_PREFS, () => {}));

    act(() => {
      result.current.setComposingFor('s1', true);
    });

    expect(result.current.composingBySession.s1).toBe(true);
    expect(result.current.composingBySession.s2).toBeUndefined();
  });

  it('setActionIndexFor accepts a plain value, keyed by session', () => {
    const { result } = renderHook(() => useCanvasSessionUi(EMPTY_PREFS, () => {}));

    act(() => {
      result.current.setActionIndexFor('s1', 2);
    });
    act(() => {
      result.current.setActionIndexFor('s2', 5);
    });

    expect(result.current.actionIndexBySession.s1).toBe(2);
    expect(result.current.actionIndexBySession.s2).toBe(5);
  });

  it('setActionIndexFor accepts an updater fed the current per-session value (defaulting to 0)', () => {
    const { result } = renderHook(() => useCanvasSessionUi(EMPTY_PREFS, () => {}));

    act(() => {
      result.current.setActionIndexFor('s1', (current) => current + 1);
    });
    expect(result.current.actionIndexBySession.s1).toBe(1);

    act(() => {
      result.current.setActionIndexFor('s1', (current) => current + 1);
    });
    expect(result.current.actionIndexBySession.s1).toBe(2);
    // untouched session's counter must not move
    expect(result.current.actionIndexBySession.s2).toBeUndefined();
  });

  it('setWritingFor isolates sessions', () => {
    const { result } = renderHook(() => useCanvasSessionUi(EMPTY_PREFS, () => {}));

    act(() => {
      result.current.setWritingFor('s1', true);
    });

    expect(result.current.writingBySession.s1).toBe(true);
    expect(result.current.writingBySession.s2).toBeUndefined();

    act(() => {
      result.current.setWritingFor('s1', false);
    });
    expect(result.current.writingBySession.s1).toBe(false);
  });

  it('setViewFor writes the preference when the view changes, and leaves another session alone', () => {
    const saved: Prefs[] = [];
    const { result } = renderHook(() =>
      useCanvasSessionUi(EMPTY_PREFS, (next) => saved.push(next)),
    );

    act(() => {
      result.current.setViewFor('s1', 'PRs');
    });

    expect(result.current.viewBySession.s1).toBe('PRs');
    expect(result.current.viewBySession.s2).toBeUndefined();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.detailTab).toBe('PRs');
  });

  it('setViewFor does not call savePrefs when the view already matches prefs.detailTab', () => {
    const saved: Prefs[] = [];
    const prefsOnPRs = setDetailTab(EMPTY_PREFS, 'PRs');
    const { result } = renderHook(() => useCanvasSessionUi(prefsOnPRs, (next) => saved.push(next)));

    act(() => {
      result.current.setViewFor('s1', 'PRs');
    });

    expect(result.current.viewBySession.s1).toBe('PRs');
    expect(saved).toHaveLength(0);
  });
});
