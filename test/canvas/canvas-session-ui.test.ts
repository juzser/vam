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
import { EMPTY_PREFS } from '../../src/renderer/prefs/prefs.js';

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
});
