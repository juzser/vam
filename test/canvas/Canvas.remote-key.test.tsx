// @vitest-environment happy-dom

/**
 * The Remote surface, promoted to a top-level control (the operator's
 * request: an icon beside Settings, carrying unpair and the rest).
 *
 * This asserts the KEYSTROKE actually opens the surface — dispatched at
 * `window`, the way an operator's press arrives — not merely that a binding
 * string exists in a table, the substitution this repo has shipped a defect
 * from before (see `Canvas.zoom-keys.test.tsx`, the same pattern).
 *
 * It also asserts unpair (`onRemove`) and `Revoke all` are reachable from
 * the exact surface `.` opens, by stubbing the desktop bridge with a paired
 * device.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RemoteApi, RemoteState } from '../../src/preload/api.js';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel } from '../../src/renderer/domain/model.js';

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'black-smith',
      sessions: [
        {
          id: 'a1',
          title: 'a1',
          icon: null,
          epic: null,
          branch: null,
          status: 'done',
          runningAgents: 0,
          activity: null,
          age: null,
          decisions: [],
        },
      ],
    },
  ],
};

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function activePanel(): string | null {
  const panel = document.querySelector('[data-settings-panel]:not([hidden])');
  return panel?.getAttribute('data-settings-panel') ?? null;
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

afterEach(() => {
  cleanup();
  // biome-ignore lint/suspicious/noExplicitAny: the bridge is not part of the browser build's Window type
  delete (window as any).api;
});

describe('the Remote surface is reachable by keystroke', () => {
  it('opens Settings directly on the Remote section on `.`', () => {
    render(<Canvas model={MODEL} />);
    expect(document.querySelector('[data-settings-overlay]')).toBeNull();
    press('.');
    expect(document.querySelector('[data-settings-overlay]')).not.toBeNull();
    expect(activePanel()).toBe('remote');
  });

  it('`,` still opens Settings on Appearance — the two keys stay distinct', () => {
    render(<Canvas model={MODEL} />);
    press(',');
    expect(activePanel()).toBe('appearance');
  });

  it('lists `.` in the generated shortcut sheet, labelled', async () => {
    const { buildKeySheet } = await import('../../src/renderer/keyboard/keysheet.js');
    const rows = buildKeySheet().flatMap((group) => group.rows);
    expect(rows.some((r) => r.keys === '.' && /remote/i.test(r.label))).toBe(true);
  });
});

describe('unpair and Revoke all are reachable from the surface `.` opens', () => {
  const NOW = 1_700_000_000_000;
  const STATE: RemoteState = {
    view: {
      code: null,
      expiresAtMs: 0,
      burned: false,
      throttledUntilMs: 0,
      awaiting: null,
      pairedName: 'a-phone',
    },
    devices: [{ deviceId: 'd1', name: 'a-phone', pairedAt: NOW, lastSeenAt: NOW }],
    address: { kind: 'unavailable', reason: 'no-cli' },
    allowWrites: true,
    registry: null,
    nowMs: NOW,
  };

  function stubRemote(): RemoteApi {
    const api: RemoteApi = {
      state: vi.fn(async () => STATE),
      open: vi.fn(async () => STATE),
      approve: vi.fn(async () => STATE),
      deny: vi.fn(async () => STATE),
      remove: vi.fn(async () => STATE),
      revokeAll: vi.fn(async () => STATE),
    };
    // biome-ignore lint/suspicious/noExplicitAny: the bridge widens past Window's declared api type, same as RemotePanel.tsx's own BridgeWithRemote
    (window as any).api = { remote: api };
    return api;
  }

  it('presses `.` and finds Remove and Revoke all', async () => {
    stubRemote();
    render(<Canvas model={MODEL} />);
    press('.');
    expect(await screen.findByLabelText('Remove a-phone')).not.toBeNull();
    expect(await screen.findByText('Revoke all')).not.toBeNull();
  });
});
