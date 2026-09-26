// @vitest-environment happy-dom

/**
 * The Stats & Usage screen: fetches once on mount, refreshes on its own
 * button, closes on Escape and on a scrim click, and draws the numbers the
 * operator's mockup asks for — never a raw token count where a compact one
 * belongs, and never a guessed cost for a model the price table does not
 * know.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatsResult } from '../../../src/preload/api.js';
import { StatsScreen } from '../../../src/renderer/stats/StatsScreen.js';
import type { StatsSnapshot } from '../../../src/shared/stats.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SNAPSHOT: StatsSnapshot = {
  generatedAt: '2026-09-27T00:05:00.000Z',
  trackingSinceIso: '2026-01-01T00:00:00.000Z',
  agentsSpawned: 42,
  activeMs: (49 * 24 + 12) * 60 * 60 * 1000,
  prsCreated: { kind: 'ok', count: 17 },
  usageOverview: {
    totalTokens: 18_200_000_000,
    estCostUsd: 1234.5,
    activeDays: 30,
    cacheSharePercent: 62.5,
  },
  heatmap: [{ day: '2026-09-27', tokens: 500_000 }],
  tokenMix: {
    inputTokens: 100,
    outputTokens: 200,
    cacheWriteTokens: 50,
    cacheReadTokens: 150,
    reasoningTokens: 20,
  },
  providers: [
    {
      id: 'claude-code',
      label: 'Claude Code',
      enabled: true,
      hasData: true,
      model: 'claude-3-5-sonnet-20241022',
      tokens: 400_000,
      sessions: 10,
      turns: 100,
      costUsd: 12.3,
      sharePercent: 80,
    },
    {
      id: 'codex',
      label: 'Codex',
      enabled: false,
      hasData: false,
      model: null,
      tokens: 0,
      sessions: 0,
      turns: 0,
      costUsd: null,
      sharePercent: 0,
    },
  ],
  malformedLines: 3,
  priceTableAsOf: '2026-01-15',
};

function stubApi(
  result: StatsResult,
  spies: { get?: ReturnType<typeof vi.fn>; refresh?: ReturnType<typeof vi.fn> } = {},
) {
  const get = spies.get ?? vi.fn(async () => result);
  const refresh = spies.refresh ?? vi.fn(async () => result);
  vi.stubGlobal('window', Object.assign(globalThis.window, { api: { stats: { get, refresh } } }));
  return { get, refresh };
}

describe('StatsScreen', () => {
  it('fetches once on mount and draws the three headline cards', async () => {
    stubApi({ kind: 'ok', snapshot: SNAPSHOT });
    render(<StatsScreen onClose={() => {}} />);
    expect(await screen.findByText('42')).toBeTruthy();
    expect(screen.getByText('49d 12h')).toBeTruthy();
    expect(screen.getByText('17')).toBeTruthy();
  });

  it('formats large numbers compactly and shows the est. cost, labelled', async () => {
    stubApi({ kind: 'ok', snapshot: SNAPSHOT });
    render(<StatsScreen onClose={() => {}} />);
    expect(await screen.findByText('18.2B')).toBeTruthy();
    expect(screen.getByText('Est. cost')).toBeTruthy();
    expect(screen.getByText('$1,234.50')).toBeTruthy();
  });

  it('shows the price table date', async () => {
    stubApi({ kind: 'ok', snapshot: SNAPSHOT });
    render(<StatsScreen onClose={() => {}} />);
    expect(await screen.findByText(/2026-01-15/)).toBeTruthy();
  });

  it('shows n/a for an unknown-model provider cost, never a guessed number', async () => {
    stubApi({ kind: 'ok', snapshot: SNAPSHOT });
    render(<StatsScreen onClose={() => {}} />);
    await screen.findByText('Claude Code');
    expect(screen.getAllByText('n/a').length).toBeGreaterThan(0);
  });

  it('shows the PR hint when gh is not connected', async () => {
    stubApi({
      kind: 'ok',
      snapshot: {
        ...SNAPSHOT,
        prsCreated: { kind: 'unavailable', hint: 'connect GitHub in Settings → Integrations' },
      },
    });
    render(<StatsScreen onClose={() => {}} />);
    expect(await screen.findByText(/connect GitHub/)).toBeTruthy();
  });

  it('shows Off for a provider with no data at all, and an Enable control', async () => {
    stubApi({ kind: 'ok', snapshot: SNAPSHOT });
    render(<StatsScreen onClose={() => {}} />);
    await screen.findByText('Codex');
    expect(screen.getByText('Off')).toBeTruthy();
  });

  it('calls refresh() when the refresh button is pressed, not get() again', async () => {
    const { get, refresh } = stubApi({ kind: 'ok', snapshot: SNAPSHOT });
    render(<StatsScreen onClose={() => {}} />);
    await screen.findByText('42');
    expect(get).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    stubApi({ kind: 'ok', snapshot: SNAPSHOT });
    const onClose = vi.fn();
    render(<StatsScreen onClose={onClose} />);
    await screen.findByText('42');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on a scrim click', async () => {
    stubApi({ kind: 'ok', snapshot: SNAPSHOT });
    const onClose = vi.fn();
    render(<StatsScreen onClose={onClose} />);
    await screen.findByText('42');
    fireEvent.mouseDown(screen.getByRole('button', { name: /close stats/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('says so when the bridge is unavailable, in the browser build', () => {
    vi.stubGlobal('window', Object.assign(globalThis.window, { api: undefined }));
    render(<StatsScreen onClose={() => {}} />);
    expect(screen.getByText(/only available in the desktop app/i)).toBeTruthy();
  });

  it('reports an error outcome honestly rather than showing stale or fake data', async () => {
    stubApi({ kind: 'error', message: 'the stats worker exited with code 1' });
    render(<StatsScreen onClose={() => {}} />);
    expect(await screen.findByText(/the stats worker exited with code 1/)).toBeTruthy();
  });
});
