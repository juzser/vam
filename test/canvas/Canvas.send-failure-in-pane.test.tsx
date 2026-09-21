// @vitest-environment happy-dom

/**
 * A SEND THAT FAILED SAYS SO WHERE THE OPERATOR IS LOOKING.
 *
 * Operator instruction: when a send errors, a line has to appear in the out
 * area too, not only in the status bar. The status bar is one line at the
 * bottom of the window that the next act overwrites, and the operator is
 * reading the transcript -- so a refused send rolled the optimistic turn back,
 * put the words back in the composer, and left nothing on screen where the
 * turn had been. From the pane, an act that failed and an act that was never
 * attempted looked identical.
 *
 * This does NOT replace the status bar line or the error log: three surfaces,
 * three jobs. The status bar is the running commentary, the error log is the
 * history with a report attached, and this is the one that survives in place
 * until the operator does something about it.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

afterEach(cleanup);

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    ...over,
  };
}

const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [session('a1', { title: 'nightly sweep' }), session('a2', { title: 'docs pass' })],
    },
  ],
};

function sourceThat(write: (sessionId: string, prompt: string) => Promise<void>): CanvasSource {
  const inner = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: {
      liveUpdates: false,
      recordPrompt: true,
      deliverPrompt: true,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      closeSession: false,
      createSession: false,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
      resumeSession: false,
    },
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: { recordPrompt: write },
  };
  return { kind: 'session', source: inner as SessionSource, onWrote: () => {} };
}

const promptInput = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');
const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const paneNote = () => document.querySelector('[data-send-failed]');

function press(key: string, modifiers: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

function typeInto(input: HTMLTextAreaElement, text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set as (
      this: HTMLElement,
      v: string,
    ) => void;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function send(text: string) {
  press('i');
  const input = promptInput() as HTMLTextAreaElement;
  typeInto(input, text);
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

describe('a refused send leaves a line in the pane, not only in the status bar', () => {
  it('draws the failure where the turn would have been', async () => {
    const source = sourceThat(async () => {
      throw { kind: 'refused', code: 'session-running', message: 'session a1 is running' };
    });
    render(<Canvas model={MODEL} source={source} />);
    await send('ship it');

    // The status bar still says it -- this adds a surface, it replaces none.
    expect(statusBar()).toContain('session-running');
    const note = paneNote();
    expect(note).not.toBeNull();
    // And it carries the code, because a sentence the operator cannot act on
    // is the "something went wrong" this repo refuses to ship.
    expect(note?.textContent ?? '').toContain('session-running');
  });

  it('is announced, not merely painted', async () => {
    const source = sourceThat(async () => {
      throw { kind: 'refused', code: 'session-running', message: 'session a1 is running' };
    });
    render(<Canvas model={MODEL} source={source} />);
    await send('ship it');
    // It appears after the act that caused it, in a region nothing focuses, so
    // a screen reader learns of it only if the region says so.
    expect(paneNote()?.getAttribute('role')).toBe('status');
  });

  it('belongs to the session it happened in', async () => {
    const source = sourceThat(async (sessionId) => {
      if (sessionId === 'a1') {
        throw { kind: 'refused', code: 'session-running', message: 'session a1 is running' };
      }
    });
    render(<Canvas model={MODEL} source={source} />);
    await send('ship it');
    expect(paneNote()).not.toBeNull();

    // Cmd+2 -- the other session in this pane. It has not failed at anything.
    press('2', { metaKey: true, code: 'Digit2' });
    expect(paneNote()).toBeNull();

    press('1', { metaKey: true, code: 'Digit1' });
    expect(paneNote()).not.toBeNull();
  });

  it('is cleared by the next attempt, so it never outlives its own verdict', async () => {
    let refuse = true;
    const source = sourceThat(async () => {
      if (refuse) {
        throw { kind: 'refused', code: 'session-running', message: 'session a1 is running' };
      }
    });
    render(<Canvas model={MODEL} source={source} />);
    await send('ship it');
    expect(paneNote()).not.toBeNull();

    refuse = false;
    await send('ship it');
    expect(paneNote()).toBeNull();
  });

  it('says nothing at all when nothing has failed', () => {
    const source = sourceThat(async () => {});
    render(<Canvas model={MODEL} source={source} />);
    expect(paneNote()).toBeNull();
  });
});
