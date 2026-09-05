// @vitest-environment happy-dom

/**
 * A refusal has to land somewhere.
 *
 * `StatusCell` had exactly one host in the renderer, inside the footer the
 * phone shell does not draw — so every refusal vam writes was set into state
 * and rendered nowhere at phone width. That inverts the rule the rest of this
 * shell keeps: a phone has no second surface to infer a cause from, so a
 * refusal that names none is worse there, not better.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel } from '../../src/renderer/domain/model.js';
import { installPhoneGlobals, phoneSource, session } from './harness.js';

beforeAll(installPhoneGlobals);
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** A project with no source: its icon cannot be stored, and vam says so. */
const NO_SOURCE: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', sessions: [session('a1', { title: 'nightly sweep' })] }],
};

const statusText = () => document.querySelector('[data-phone-status]')?.textContent ?? '';

describe('refusals at phone width', () => {
  it('says why an icon cannot be picked, on the screen that refused', () => {
    render(<Canvas model={NO_SOURCE} source={phoneSource()} />);
    expect(document.querySelector('[data-phone-status]')).toBeNull();

    act(() => {
      fireEvent.click(document.querySelector('[data-project-icon]') as Element);
    });
    expect(statusText()).toContain('no source');
  });

  it('carries the same cell onto the session screen', () => {
    render(<Canvas model={NO_SOURCE} source={phoneSource()} />);
    act(() => {
      fireEvent.click(document.querySelector('[data-project-icon]') as Element);
    });
    act(() => {
      fireEvent.click(document.querySelector('[data-session-row]') as Element);
    });
    expect(document.querySelector('[data-phone-shell="session"]')).not.toBeNull();
    expect(statusText()).toContain('no source');
  });
});
