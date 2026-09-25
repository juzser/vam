// @vitest-environment happy-dom

/**
 * The account-icon popover the sidebar avatar opens: usage for every provider
 * vam knows (`src/shared/providers.ts`), read through `window.api.usage`
 * (Claude) and `window.api.usage.getCodex` (Codex) -- never a token, never a
 * real request in the browser build.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsagePopover } from '../../src/renderer/panels/UsagePopover.js';
import type { CodexUsageSnapshot } from '../../src/shared/codex-usage.js';
import type { UsageSnapshot } from '../../src/shared/usage.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'api');
  vi.restoreAllMocks();
});

function claudeSnapshot(): UsageSnapshot {
  return {
    kind: 'ok',
    windows: {
      fiveHour: {
        kind: 'known',
        percent: 40,
        resetsAt: new Date(Date.now() + 75 * 60_000).toISOString(),
      },
      sevenDay: {
        kind: 'known',
        percent: 30,
        resetsAt: new Date(Date.now() + (4 * 24 + 20) * 60 * 60_000).toISOString(),
      },
    },
    observedAt: new Date().toISOString(),
    limits: [
      {
        id: 'weekly_scoped',
        label: 'Weekly · Opus',
        window: {
          kind: 'known',
          percent: 55,
          resetsAt: new Date(Date.now() + (4 * 24 + 20) * 60 * 60_000).toISOString(),
        },
      },
    ],
  };
}

function codexSnapshot(): CodexUsageSnapshot {
  return {
    kind: 'ok',
    limits: {
      primary: {
        kind: 'known',
        percent: 11,
        windowMinutes: 300,
        resetsAt: new Date(Date.now() + 75 * 60_000).toISOString(),
      },
      secondary: {
        kind: 'known',
        percent: 2,
        windowMinutes: 10_080,
        resetsAt: new Date(Date.now() + (4 * 24 + 20) * 60 * 60_000).toISOString(),
      },
    },
    observedAt: new Date().toISOString(),
  };
}

function serve(claude: UsageSnapshot, codex: CodexUsageSnapshot) {
  (window as unknown as { api: unknown }).api = {
    usage: {
      get: vi.fn(async () => claude),
      getCodex: vi.fn(async () => codex),
    },
  };
}

const toggle = () => screen.getByLabelText('usage');
const panel = () => document.querySelector('[data-usage-panel]');

describe('the usage popover trigger', () => {
  it('replaces the letter avatar with an icon button named "usage"', () => {
    render(<UsagePopover />);
    const button = toggle();
    expect(button.tagName).toBe('BUTTON');
    expect(button.textContent).not.toContain('V');
    expect(panel()).toBeNull();
  });

  it('opens the panel on click, and closes it again on a second click', async () => {
    serve(claudeSnapshot(), codexSnapshot());
    render(<UsagePopover />);

    await act(async () => {
      toggle().click();
    });
    expect(panel()).not.toBeNull();

    await act(async () => {
      toggle().click();
    });
    expect(panel()).toBeNull();
  });

  it('closes on Escape', async () => {
    serve(claudeSnapshot(), codexSnapshot());
    render(<UsagePopover />);

    await act(async () => {
      toggle().click();
    });
    expect(panel()).not.toBeNull();

    await act(async () => {
      toggle().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(panel()).toBeNull();
  });

  it('closes on a press outside the panel and the toggle', async () => {
    serve(claudeSnapshot(), codexSnapshot());
    render(<UsagePopover />);

    await act(async () => {
      toggle().click();
    });
    expect(panel()).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(panel()).toBeNull();
  });

  it('does NOT close on a press inside the panel', async () => {
    serve(claudeSnapshot(), codexSnapshot());
    render(<UsagePopover />);

    await act(async () => {
      toggle().click();
    });
    const node = panel();
    expect(node).not.toBeNull();

    await act(async () => {
      node?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(panel()).not.toBeNull();
  });
});

describe('the usage popover, in the browser build (no window.api)', () => {
  it('states usage is desktop-only, and calls nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch must not be called in the browser build');
    });
    render(<UsagePopover />);

    await act(async () => {
      toggle().click();
    });

    expect(document.querySelector('[data-usage-unavailable]')?.textContent).toMatch(/desktop app/i);
    expect(document.querySelectorAll('[data-usage-provider]')).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the usage popover, with both providers reachable', () => {
  it('draws one section per provider, in the providers table order', async () => {
    serve(claudeSnapshot(), codexSnapshot());
    render(<UsagePopover />);

    await act(async () => {
      toggle().click();
    });

    const sections = [...document.querySelectorAll('[data-usage-provider]')];
    expect(sections.map((s) => s.getAttribute('data-usage-provider'))).toEqual([
      'claude-code',
      'codex',
    ]);
    expect(sections[0]?.textContent).toContain('Claude Code');
    expect(sections[1]?.textContent).toContain('Codex');
  });

  it("renders Claude's 5-hour and Weekly windows, and the per-model weekly row", async () => {
    serve(claudeSnapshot(), codexSnapshot());
    render(<UsagePopover />);

    await act(async () => {
      toggle().click();
    });

    const claude = document.querySelector('[data-usage-provider="claude-code"]');
    expect(claude?.querySelector('[data-usage-window="5-hour"]')?.textContent).toContain('40%');
    expect(claude?.querySelector('[data-usage-window="Weekly"]')?.textContent).toContain('30%');
    expect(claude?.querySelector('[data-usage-window="Weekly · Opus"]')?.textContent).toContain(
      '55%',
    );
  });

  it("renders Codex's 5-hour and Weekly windows, dated as of the last session read", async () => {
    serve(claudeSnapshot(), codexSnapshot());
    render(<UsagePopover />);

    await act(async () => {
      toggle().click();
    });

    const codex = document.querySelector('[data-usage-provider="codex"]');
    expect(codex?.querySelector('[data-usage-window="5-hour"]')?.textContent).toContain('11%');
    expect(codex?.querySelector('[data-usage-window="Weekly"]')?.textContent).toContain('2%');
    expect(codex?.querySelector('[data-usage-observed]')?.textContent).toMatch(
      /as of .+ from the last codex session/i,
    );
  });

  it('shows a distinguishing reason, never a fabricated percent, when a provider is unknown', async () => {
    serve({ kind: 'unknown', reason: 'no-token' }, { kind: 'unknown', reason: 'no-session' });
    render(<UsagePopover />);

    await act(async () => {
      toggle().click();
    });

    const claude = document.querySelector('[data-usage-provider="claude-code"]');
    const codex = document.querySelector('[data-usage-provider="codex"]');
    expect(claude?.querySelector('[data-usage-reason]')?.textContent).toMatch(/keychain|token/i);
    expect(codex?.querySelector('[data-usage-reason]')?.textContent).toMatch(/no codex session/i);
    expect(claude?.textContent).not.toMatch(/\b0%/);
    expect(codex?.textContent).not.toMatch(/\b0%/);
  });

  it('refreshes when the panel opens, calling usage.get and usage.getCodex', async () => {
    const get = vi.fn(async () => claudeSnapshot());
    const getCodex = vi.fn(async () => codexSnapshot());
    (window as unknown as { api: unknown }).api = { usage: { get, getCodex } };
    render(<UsagePopover />);

    await act(async () => {
      toggle().click();
    });

    expect(get).toHaveBeenCalledTimes(1);
    expect(getCodex).toHaveBeenCalledTimes(1);
  });
});
