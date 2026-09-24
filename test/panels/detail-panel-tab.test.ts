// @vitest-environment happy-dom
/**
 * The extracted TAB-SELECTION hook, asserted through its own return value.
 * Three cases carry the load-bearing rules: uncontrolled state answers its
 * own `pickTab`, a controlled `tab` prop wins over that state and delegates
 * instead of setting it, and `pickTabRef.current` tracks `pickTab`'s current
 * identity across a re-render -- the guard against the stale-closure loop
 * this file's own header describes.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDetailPanelTab } from '../../src/renderer/panels/detail-panel-tab.js';

describe('useDetailPanelTab', () => {
  it('with no controlled tab, returns its own state and pickTab changes it', () => {
    const { result } = renderHook(() => useDetailPanelTab({}));

    expect(result.current.tab).toBe('Response');

    act(() => result.current.pickTab('Terminal'));

    expect(result.current.tab).toBe('Terminal');
  });

  it('with a controlled tab prop, the controlled value wins and pickTab delegates', () => {
    const onTabChange = vi.fn();
    const { result } = renderHook(() => useDetailPanelTab({ tab: 'Agents', onTabChange }));

    expect(result.current.tab).toBe('Agents');

    act(() => result.current.pickTab('Terminal'));

    // The controlled value still wins -- the hook never set its own state --
    // and the caller was told what the operator picked.
    expect(result.current.tab).toBe('Agents');
    expect(onTabChange).toHaveBeenCalledWith('Terminal');
  });

  it('pickTabRef.current is updated after a re-render that changes pickTab identity', () => {
    const { result, rerender } = renderHook(
      ({ onTabChange }: { onTabChange?: (tab: string) => void }) =>
        useDetailPanelTab({ onTabChange }),
      { initialProps: { onTabChange: vi.fn() } },
    );

    const firstPickTab = result.current.pickTab;
    expect(result.current.pickTabRef.current).toBe(firstPickTab);

    rerender({ onTabChange: vi.fn() });

    expect(result.current.pickTab).not.toBe(firstPickTab);
    expect(result.current.pickTabRef.current).toBe(result.current.pickTab);
  });
});
