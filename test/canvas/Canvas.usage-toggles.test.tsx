// @vitest-environment happy-dom

/**
 * Window & Sidebar settings' three status-bar toggles: whether Claude's cell
 * draws at all (on by default), whether Codex's does (off by default -- a
 * brand-new cell, and a brand-new poll, must not appear uninvited), and the
 * `used`/`remaining` mode shared by both.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel } from '../../src/renderer/domain/model.js';
import type { CodexUsageSnapshot } from '../../src/shared/codex-usage.js';
import type { UsageSnapshot } from '../../src/shared/usage.js';

const EMPTY: CanvasModel = { projects: [] };

const claudeCell = () => document.querySelector('[data-usage]');
const codexCell = () => document.querySelector('[data-codex-usage]');

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
  Reflect.deleteProperty(window, 'api');
  vi.restoreAllMocks();
});

const CLAUDE_SNAPSHOT: UsageSnapshot = {
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
      resetsAt: new Date(Date.now() + 100 * 60 * 60_000).toISOString(),
    },
  },
  observedAt: new Date().toISOString(),
};

const CODEX_SNAPSHOT: CodexUsageSnapshot = {
  kind: 'ok',
  limits: {
    primary: {
      kind: 'known',
      percent: 11,
      windowMinutes: 300,
      resetsAt: new Date(Date.now() + 75 * 60_000).toISOString(),
    },
    secondary: { kind: 'unknown' },
  },
  observedAt: new Date().toISOString(),
};

function serve(): void {
  (window as unknown as { api: unknown }).api = {
    usage: {
      get: vi.fn(async () => CLAUDE_SNAPSHOT),
      getCodex: vi.fn(async () => CODEX_SNAPSHOT),
    },
  };
}

function seed(prefs: Record<string, unknown>): void {
  localStorage.setItem('vam.prefs.v1', JSON.stringify(prefs));
}

describe('statusBarShowClaudeUsage', () => {
  it('defaults to shown -- unchanged from before the switch existed', async () => {
    serve();
    render(<Canvas model={EMPTY} />);
    await act(async () => {});
    expect(claudeCell()).not.toBeNull();
  });

  it('hides the cell entirely when off, and makes no poll for it', async () => {
    serve();
    seed({ statusBarShowClaudeUsage: false });
    render(<Canvas model={EMPTY} />);
    await act(async () => {});
    expect(claudeCell()).toBeNull();
  });
});

describe('statusBarShowCodexUsage', () => {
  it('defaults to hidden -- a brand-new cell must not appear uninvited', async () => {
    serve();
    render(<Canvas model={EMPTY} />);
    await act(async () => {});
    expect(codexCell()).toBeNull();
  });

  it('draws the cell, formatted, once the operator turns it on', async () => {
    serve();
    seed({ statusBarShowCodexUsage: true });
    render(<Canvas model={EMPTY} />);
    await act(async () => {});
    expect(codexCell()?.textContent).toContain('11% used');
  });
});

describe('statusBarUsageMode', () => {
  it('reads Claude’s cell as remaining when set, countdown unchanged', async () => {
    serve();
    seed({ statusBarUsageMode: 'remaining' });
    render(<Canvas model={EMPTY} />);
    await act(async () => {});
    expect(claudeCell()?.textContent).toContain('60% left');
    expect(claudeCell()?.textContent).toContain('70% left');
  });

  it('reads Codex’s cell as remaining too, from the same one setting', async () => {
    serve();
    seed({ statusBarShowCodexUsage: true, statusBarUsageMode: 'remaining' });
    render(<Canvas model={EMPTY} />);
    await act(async () => {});
    expect(codexCell()?.textContent).toContain('89% left');
  });
});
