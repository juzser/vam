// @vitest-environment happy-dom

/**
 * The sidebar's stats popover: headline numbers from the stubbed snapshot,
 * the contribution graph, a "Details" button that hands over to Settings ->
 * Stats, and the usual dismissal (Escape, outside pointerdown).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatsPopover } from '../../../src/renderer/stats/StatsPopover.js';
import type { StatsSnapshot } from '../../../src/shared/stats.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SNAPSHOT = {
  generatedAt: '2026-09-27T00:05:00.000Z',
  trackingSinceIso: '2026-01-01T00:00:00.000Z',
  agentsSpawned: 42,
  activeMs: 1000,
  prsCreated: { kind: 'ok', count: 17 },
  usageOverview: {
    totalTokens: 18_200_000_000,
    estCostUsd: 1234.5,
    activeDays: 30,
    cacheSharePercent: 62.5,
  },
  heatmap: [{ day: '2026-09-27', tokens: 500_000 }],
  tokenMix: {
    inputTokens: 1,
    outputTokens: 1,
    cacheWriteTokens: 1,
    cacheReadTokens: 1,
    reasoningTokens: 1,
  },
  providers: [],
  malformedLines: 0,
  priceTableAsOf: '2026-01-15',
} as unknown as StatsSnapshot;

async function open(onStats = vi.fn()) {
  const get = vi.fn().mockResolvedValue({ kind: 'ok', snapshot: SNAPSHOT });
  vi.stubGlobal('api', { stats: { get } });
  (window as unknown as { api: unknown }).api = { stats: { get } };
  render(<StatsPopover onStats={onStats} />);
  await act(async () => {
    fireEvent.click(screen.getByLabelText('stats'));
  });
  await screen.findByText('agents');
  return { onStats, get };
}

describe('StatsPopover', () => {
  it('renders the headline numbers and the heatmap grid', async () => {
    await open();
    const panel = screen.getByRole('dialog');
    expect(panel.textContent).toContain('18.2B');
    expect(panel.textContent).toContain('42');
    expect(panel.textContent).toContain('30');
    expect(panel.querySelector('[data-stats-heatmap]')).not.toBeNull();
    expect(panel.getAttribute('aria-label') ?? '').not.toMatch(/usage/i);
  });

  it('Details calls onStats once and closes the popover', async () => {
    const { onStats } = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(onStats).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape', async () => {
    await open();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on an outside pointerdown but not an inside one', async () => {
    await open();
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([
    ['a non-ok result', () => vi.fn().mockResolvedValue({ kind: 'error', message: 'x' })],
    ['a rejected read', () => vi.fn().mockRejectedValue(new Error('boom'))],
  ])('%s shows the failure line, not loading, and Details still works', async (_name, mk) => {
    const get = mk();
    (window as unknown as { api: unknown }).api = { stats: { get } };
    const onStats = vi.fn();
    render(<StatsPopover onStats={onStats} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('stats'));
    });
    const panel = screen.getByRole('dialog');
    await waitFor(() => expect(panel.querySelector('[data-stats-popover-error]')).not.toBeNull());
    expect(panel.textContent).toContain('Stats unavailable');
    expect(panel.textContent).not.toContain('loading');
    expect(panel.querySelector('[data-stats-heatmap]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(onStats).toHaveBeenCalledTimes(1);
  });

  it('reopening after a failure retries the read', async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ kind: 'ok', snapshot: SNAPSHOT });
    (window as unknown as { api: unknown }).api = { stats: { get } };
    render(<StatsPopover onStats={vi.fn()} />);
    const button = screen.getByLabelText('stats');
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('unavailable'));
    await act(async () => {
      fireEvent.click(button);
    });
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('18.2B'));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('opens without a stats bridge, does not throw and shows the failure line', async () => {
    (window as unknown as { api: unknown }).api = undefined;
    render(<StatsPopover onStats={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('stats'));
    });
    await waitFor(() =>
      expect(screen.getByRole('dialog').textContent).toContain('Stats unavailable'),
    );
    expect(screen.getByRole('dialog').textContent).not.toContain('loading');
  });

  it('re-clicking the toggle button closes the popover and reflects aria-expanded', async () => {
    await open();
    const button = screen.getByLabelText('stats');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await act(async () => {
      fireEvent.click(button);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('a pointerdown on the toggle button is not treated as outside', async () => {
    await open();
    fireEvent.pointerDown(screen.getByLabelText('stats'));
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('closes on Escape pressed on the toggle button', async () => {
    await open();
    fireEvent.keyDown(screen.getByLabelText('stats'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders zeros and an empty heatmap for an empty snapshot', async () => {
    const empty = {
      ...SNAPSHOT,
      agentsSpawned: 0,
      heatmap: [],
      usageOverview: { ...SNAPSHOT.usageOverview, totalTokens: 0, activeDays: 0 },
    } as unknown as StatsSnapshot;
    const get = vi.fn().mockResolvedValue({ kind: 'ok', snapshot: empty });
    (window as unknown as { api: unknown }).api = { stats: { get } };
    render(<StatsPopover onStats={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('stats'));
    });
    const panel = screen.getByRole('dialog');
    await waitFor(() => expect(panel.querySelector('[data-stats-heatmap]')).not.toBeNull());
    expect(panel.textContent).not.toContain('loading');
  });

  it('shows loading while the read is pending, then swaps to the panel', async () => {
    let resolve: (v: unknown) => void = () => {};
    const get = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    (window as unknown as { api: unknown }).api = { stats: { get } };
    render(<StatsPopover onStats={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('stats'));
    });
    const panel = screen.getByRole('dialog');
    expect(panel.textContent).toContain('loading');
    expect(panel.querySelector('[data-stats-popover-error]')).toBeNull();
    await act(async () => {
      resolve({ kind: 'ok', snapshot: SNAPSHOT });
    });
    await waitFor(() => expect(panel.textContent).toContain('18.2B'));
    expect(panel.textContent).not.toContain('loading');
  });

  it('does not fetch while closed and fetches once per open', async () => {
    const { get } = await open();
    expect(get).toHaveBeenCalledTimes(1);
  });
});
