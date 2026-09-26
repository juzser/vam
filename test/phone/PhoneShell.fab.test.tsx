// @vitest-environment happy-dom

/**
 * The floating "+" over the phone list screen, and the sheet it opens.
 *
 * It is not a new create-session implementation: picking a row in the sheet
 * calls `onAddInProject` with THAT project -- the SAME handler the
 * per-project heading `+` already wears end to end (`Canvas.tsx`'s
 * `onSidebarAddInProject` → `createSession(project.id, …)`), which is also
 * why it needs no directory picker and works on the browser build a phone
 * always is. The FAB itself no longer guesses a project (the operator's own
 * call, after a first cut that targeted the topmost one): it opens
 * `SessionCreatePicker`, a sheet listing every project, and the choice is
 * the operator's.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel } from '../../src/renderer/domain/model.js';
import { installPhoneGlobals, MODEL, phoneSource, session } from './harness.js';

beforeAll(installPhoneGlobals);
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const fab = () => document.querySelector('[data-phone-fab]') as HTMLButtonElement | null;
const sheet = () => document.querySelector('[data-session-create-picker]');
const choiceButton = (projectId: string) =>
  document.querySelector(`[data-project-choice-create="${projectId}"]`) as HTMLButtonElement | null;

/** Two projects: "alpha" with a live, waiting session, and "beta" whose only
 *  session has never been started -- the renderer-visible shape of a
 *  pane-only project (`SessionCreatePicker.tsx`'s own `paneOnly` doc). */
const TWO_PROJECTS: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [session('a1', { title: 'nightly sweep', status: 'waiting' })],
    },
    {
      id: 'p2',
      name: 'beta',
      source: 'claude-code',
      sessions: [session('b1', { title: 'beta', status: 'unstarted' })],
    },
  ],
};

describe('the phone list screen’s floating +', () => {
  it('opens a sheet rather than creating directly', async () => {
    render(<Canvas model={MODEL} source={phoneSource({ createSession: async () => {} })} />);
    expect(sheet()).toBeNull();

    const button = fab();
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(button as HTMLButtonElement);
    });
    expect(sheet()).not.toBeNull();
  });

  it('lists every project the list screen draws, once each', async () => {
    render(<Canvas model={TWO_PROJECTS} source={phoneSource({ createSession: async () => {} })} />);
    await act(async () => {
      fireEvent.click(fab() as HTMLButtonElement);
    });
    expect(choiceButton('p1')).not.toBeNull();
    expect(choiceButton('p2')).not.toBeNull();
    expect(document.querySelectorAll('[data-project-choice-create]')).toHaveLength(2);
  });

  it('names a pane-only project as such, and a live one not at all', async () => {
    render(<Canvas model={TWO_PROJECTS} source={phoneSource({ createSession: async () => {} })} />);
    await act(async () => {
      fireEvent.click(fab() as HTMLButtonElement);
    });
    expect(
      choiceButton('p2')?.querySelector('[data-project-choice-pane-only]'),
      'beta, whose only session is unstarted',
    ).not.toBeNull();
    expect(
      choiceButton('p1')?.querySelector('[data-project-choice-pane-only]'),
      'alpha, which has a real waiting session',
    ).toBeNull();
  });

  it('picking a row calls onAddInProject with THAT project, and closes the sheet', async () => {
    const asked: Array<{ id: string; name: string }> = [];
    render(
      <Canvas
        model={TWO_PROJECTS}
        source={phoneSource({
          createSession: async (id, name) => {
            asked.push({ id, name });
          },
        })}
      />,
    );
    await act(async () => {
      fireEvent.click(fab() as HTMLButtonElement);
    });
    await act(async () => {
      fireEvent.click(choiceButton('p2') as HTMLButtonElement);
    });
    expect(asked).toEqual([{ id: 'p2', name: 'beta' }]);
    expect(sheet()).toBeNull();
  });

  it('cancelling — Escape, or the scrim — creates nothing', async () => {
    const asked: string[] = [];
    render(
      <Canvas
        model={TWO_PROJECTS}
        source={phoneSource({ createSession: async (id) => void asked.push(id) })}
      />,
    );

    await act(async () => {
      fireEvent.click(fab() as HTMLButtonElement);
    });
    expect(sheet()).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(sheet() as Element, { key: 'Escape' });
    });
    expect(sheet()).toBeNull();

    await act(async () => {
      fireEvent.click(fab() as HTMLButtonElement);
    });
    expect(sheet()).not.toBeNull();
    const scrim = document.querySelector('[data-overlay-host] > button') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(scrim);
    });
    expect(sheet()).toBeNull();
    expect(asked).toEqual([]);
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
