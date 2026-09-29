// @vitest-environment happy-dom

/**
 * The sidebar's stats popover: headline numbers from the stubbed snapshot,
 * the contribution graph, a "Details" button that hands over to Settings ->
 * Stats, and the usual dismissal (Escape, outside pointerdown).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});
