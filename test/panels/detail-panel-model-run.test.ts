// @vitest-environment happy-dom
/**
 * The extracted MODEL-RUN status hook, asserted through its own return
 * value, in sequence: `running` starts `null`, an on-demand lookup that
 * answers `last-turn` sets `running` to that answer WITH its arm (not the
 * bare name), and the differential case -- a lookup that answers `unknown`
 * after a good answer has landed returns `running` to `null` rather than
 * latching the previous value.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDetailPanelModelRun } from '../../src/renderer/panels/detail-panel-model-run.js';

describe('useDetailPanelModelRun', () => {
  it('starts null, then reflects an on-demand answer, then drops a failed one', async () => {
    const model = vi.fn().mockResolvedValue({ kind: 'last-turn', name: 'sonnet' });
    const { result } = renderHook(() =>
      useDetailPanelModelRun({ modelControl: 'picker', model, projectId: 'p1', rowId: 'r1' }),
    );

    expect(result.current.running).toBeNull();

    await waitFor(() =>
      expect(result.current.running).toEqual({ kind: 'last-turn', name: 'sonnet' }),
    );
    model.mockClear();

    await act(async () => {
      result.current.lookForModel.current?.();
      await Promise.resolve();
    });

    expect(model).toHaveBeenCalledWith('p1', 'r1');
    expect(result.current.running).toEqual({ kind: 'last-turn', name: 'sonnet' });

    model.mockResolvedValue({ kind: 'unknown' });
    await act(async () => {
      result.current.lookForModel.current?.();
      await Promise.resolve();
    });

    expect(result.current.running).toBeNull();
  });
});
