// @vitest-environment happy-dom

/**
 * The floating "+" over the phone list screen.
 *
 * It is not a new create-session implementation: it calls `onAddInProject`
 * with `sidebar.entries[0].project` -- the SAME handler the per-project
 * heading `+` already wears end to end (`Canvas.tsx`'s `onSidebarAddInProject`
 * → `createSession(project.id, …)`), which is also why it needs no directory
 * picker and works on the browser build a phone always is. This file is
 * therefore about THIS button's own three questions: is it there, does it
 * call the right handler with the right project, and does it caption and
 * disable itself exactly as the two `+` controls beside it already do.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import { installPhoneGlobals, MODEL, phoneSource } from './harness.js';

beforeAll(installPhoneGlobals);
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const fab = () => document.querySelector('[data-phone-fab]') as HTMLButtonElement | null;

describe('the phone list screen’s floating +', () => {
  it('creates a session in the topmost project — the one the operator is already looking at', async () => {
    const asked: Array<{ id: string; name: string }> = [];
    const source = phoneSource({
      createSession: async (id, name) => {
        asked.push({ id, name });
      },
    });
    render(<Canvas model={MODEL} source={source} />);

    const button = fab();
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(button as HTMLButtonElement);
    });
    // MODEL (harness.tsx) is one project, `p1` / "alpha".
    expect(asked).toEqual([{ id: 'p1', name: 'alpha' }]);
  });

  it('is captioned and disabled with the source’s own words when it cannot create', () => {
    render(<Canvas model={MODEL} source={phoneSource()} />); // no createSession at all
    const button = fab();
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-label')).toContain('cannot start a session');
  });

  it('is not drawn at all with no sessions — `GettingStarted` owns that screen’s one creation route', () => {
    render(
      <Canvas model={{ projects: [] }} source={phoneSource({ createSession: async () => {} })} />,
    );
    expect(fab()).toBeNull();
  });
});
