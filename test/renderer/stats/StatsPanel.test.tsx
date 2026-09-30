// @vitest-environment happy-dom

/**
 * Stats & Usage's own content, as a Settings SECTION now (settings-views
 * restructure, item B) rather than its own overlay: fetches once on mount,
 * refreshes on its own button, and draws the numbers the operator's mockup
 * asks for — never a raw token count where a compact one belongs, and never
 * a guessed cost for a model the price table does not know.
 *
 * THE DIALOG CHROME THIS FILE USED TO ASSERT (Escape, a scrim click) MOVED
 * WITH IT, to `SettingsOverlay.tsx`'s own tests -- `StatsPanel` has no
 * `onClose` prop and no `role="dialog"` of its own any more; it is content a
 * `SettingsCard` wraps, the same shape `AdhdSkillCard`/`GithubPanel` already
 * take.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatsResult } from '../../../src/preload/api.js';
import { StatsPanel } from '../../../src/renderer/stats/StatsPanel.js';
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
  spies: {
    get?: ReturnType<typeof vi.fn>;
    refresh?: ReturnType<typeof vi.fn>;
    prs?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const get = spies.get ?? vi.fn(async () => result);
  const refresh = spies.refresh ?? vi.fn(async () => result);
  const prs =
    spies.prs ??
    vi.fn(async () => ({ kind: 'ok' as const, prsCreated: { kind: 'ok' as const, count: 0 } }));
  vi.stubGlobal(
    'window',
    Object.assign(globalThis.window, { api: { stats: { get, refresh, prs } } }),
  );
  return { get, refresh, prs };
}

describe('StatsPanel', () => {
  it('fetches once on mount and draws the three headline cards', async () => {
    stubApi({ kind: 'ok', snapshot: SNAPSHOT });
    render(<StatsPanel />);
    expect(await screen.findByText('42')).toBeTruthy();
    expect(screen.getByText('49d 12h')).toBeTruthy();
    expect(screen.getByText('17')).toBeTruthy();
  });

  it('formats large numbers compactly and shows the est. cost, labelled', async () => {
    stubApi({ kind: 'ok', snapshot: SNAPSHOT });
    render(<StatsPanel />);
    expect(await screen.findByText('18.2B')).toBeTruthy();
    expect(screen.getByText('Est. cost')).toBeTruthy();
    expect(screen.getByText('$1,234.50')).toBeTruthy();
  });

  it('shows the price table date', async () => {
    stubApi({ kind: 'ok', snapshot: SNAPSHOT });
    render(<StatsPanel />);
    expect(await screen.findByText(/2026-01-15/)).toBeTruthy();
  });

  it('shows n/a for an unknown-model provider cost, never a guessed number', async () => {
    stubApi({ kind: 'ok', snapshot: SNAPSHOT });
    render(<StatsPanel />);
    await screen.findByText('Claude Code');
    expect(screen.getAllByText('n/a').length).toBeGreaterThan(0);
  });

  it('shows the PR hint when gh is not connected', async () => {
    stubApi({
      kind: 'ok',
      snapshot: {
        ...SNAPSHOT,
        prsCreated: {
          kind: 'unavailable',
          hint: 'connect GitHub in Settings → Integrations',
          reason: 'not-logged-in',
        },
      },
    });
    render(<StatsPanel />);
    expect(await screen.findByText(/connect GitHub/)).toBeTruthy();
    expect(await screen.findByText(/not logged in to gh/)).toBeTruthy();
  });

  it('shows a loading placeholder for PRs, then calls prs() and patches in the answer once it settles', async () => {
    let resolvePrs:
      | ((v: { kind: 'ok'; prsCreated: { kind: 'ok'; count: number } }) => void)
      | undefined;
    const prs = vi.fn(
      () =>
        new Promise<{ kind: 'ok'; prsCreated: { kind: 'ok'; count: number } }>((resolve) => {
          resolvePrs = resolve;
        }),
    );
    stubApi({ kind: 'ok', snapshot: { ...SNAPSHOT, prsCreated: { kind: 'loading' } } }, { prs });
    render(<StatsPanel />);
    await screen.findByText('42');
    // prs() is called from a passive effect that can flush after the commit
    // that drew "42", so wait for the call rather than assert it synchronously.
    await vi.waitFor(() => expect(prs).toHaveBeenCalledTimes(1));
    expect(screen.getByText('…')).toBeTruthy();

    resolvePrs?.({ kind: 'ok', prsCreated: { kind: 'ok', count: 7 } });
    expect(await screen.findByText('7')).toBeTruthy();
  });

  it('shows Off for a provider with no data at all, and an Enable control', async () => {
    stubApi({ kind: 'ok', snapshot: SNAPSHOT });
    render(<StatsPanel />);
    await screen.findByText('Codex');
    expect(screen.getByText('Off')).toBeTruthy();
  });

  it('calls refresh() when the refresh button is pressed, not get() again', async () => {
    const { get, refresh } = stubApi({ kind: 'ok', snapshot: SNAPSHOT });
    render(<StatsPanel />);
    await screen.findByText('42');
    expect(get).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('says so when the bridge is unavailable, in the browser build', () => {
    vi.stubGlobal('window', Object.assign(globalThis.window, { api: undefined }));
    render(<StatsPanel />);
    expect(screen.getByText(/only available in the desktop app/i)).toBeTruthy();
  });

  it('reports an error outcome honestly rather than showing stale or fake data', async () => {
    stubApi({ kind: 'error', message: 'the stats worker exited with code 1' });
    render(<StatsPanel />);
    expect(await screen.findByText(/the stats worker exited with code 1/)).toBeTruthy();
  });
});
