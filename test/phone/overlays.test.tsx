// @vitest-environment happy-dom

/**
 * The overlays, as bottom sheets.
 *
 * Two halves, and they are different KINDS of assertion. This file holds the
 * half a rendered tree can answer: that the phone shell puts `vam-phone` on
 * the root the overlays are siblings of, that the reachable overlays carry the
 * `data-overlay-host` hook the sheet rules key on, and that the anchored
 * filter popover deliberately does not. The geometry those rules produce is a
 * content scan and lives in `overlay-sheets.test.ts`, which says so.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import { installPhoneGlobals, MODEL, phoneSource, rows } from './harness.js';

beforeAll(installPhoneGlobals);
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const root = () => document.querySelector('.vam-phone');

describe('the overlays at phone width', () => {
  it('marks the root the overlays are siblings of, since they are not in the shell', () => {
    render(<Canvas model={MODEL} source={phoneSource()} />);
    expect(root()).not.toBeNull();
    // The shell itself is a CHILD of that root, not the root: an overlay is
    // not inside it, which is the whole reason the class exists.
    expect(root()?.querySelector('[data-phone-shell]')).not.toBeNull();
    expect(document.querySelector('[data-phone-shell] [data-settings-overlay]')).toBeNull();
  });

  it('opens settings as a marked host, reachable from the list', () => {
    render(<Canvas model={MODEL} source={phoneSource()} />);
    act(() => {
      fireEvent.click(document.querySelector('button[aria-label="settings"]') as Element);
    });
    const host = document.querySelector('[data-settings-overlay]');
    expect(host).not.toBeNull();
    expect(host?.hasAttribute('data-overlay-host')).toBe(true);
    // The sheet is the host's non-button child; the scrim is the button.
    const panel = [...(host?.children ?? [])].filter((c) => c.tagName !== 'BUTTON');
    expect(panel).toHaveLength(1);
  });

  it('opens the icon picker as a marked host', () => {
    render(<Canvas model={MODEL} source={phoneSource()} />);
    act(() => {
      fireEvent.click(rows()[0] as Element);
    });
    act(() => {
      fireEvent.click(document.querySelector('[data-phone-back]') as Element);
    });
    act(() => {
      fireEvent.click(document.querySelector('[data-project-icon]') as Element);
    });
    const hosts = [...document.querySelectorAll('[data-overlay-host]')];
    expect(hosts.length).toBeGreaterThan(0);
  });

  it('leaves the anchored filter popover alone — it belongs to its control', () => {
    render(<Canvas model={MODEL} source={phoneSource()} />);
    act(() => {
      fireEvent.click(document.querySelector('[data-filter-toggle]') as Element);
    });
    const menu = document.querySelector('[data-filter-menu]');
    expect(menu).not.toBeNull();
    // Positioned against the toggle it belongs to, not against the viewport:
    // turning it into a bottom sheet would move it away from its own control.
    expect(menu?.hasAttribute('data-overlay-host')).toBe(false);
  });
});
