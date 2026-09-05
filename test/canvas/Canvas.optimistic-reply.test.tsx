// @vitest-environment happy-dom

/**
 * The reply paints before the write comes back.
 *
 * `sendPrompt` used to await the round trip, then clear the draft and ask for
 * a reload -- so nothing at all moved until a subprocess had answered and a
 * whole model had been rebuilt. The prompt the operator had just typed was on
 * screen nowhere in between, which reads as the app having missed the key.
 *
 * Two halves, because the truth lives in two places. `optimistic.ts` decides
 * what a pending prompt is and when the real turn has replaced it; `Canvas`
 * decides when one is created and when it is rolled back. The reconciliation
 * half is the one most likely to be subtly wrong -- a pending prompt that is
 * never dropped is the operator's own message shown twice -- so it is asserted
 * against a refresh landing WHILE the write is still in flight, which is the
 * case a naive "drop it on the next model" would get wrong.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import {
  countTurnsWithInput,
  type PendingPrompt,
  reconcile,
  withPending,
} from '../../src/renderer/canvas/optimistic.js';
import type { CanvasSource } from '../../src/renderer/canvas/source.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';

afterEach(cleanup);

function decision(id: string, input: string, output: string | null = 'done'): Decision {
  return { id, label: id, input, output, commands: [] };
}

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

const modelOf = (...sessions: Session[]): CanvasModel => ({
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions }],
});

const MODEL = modelOf(session('a1', { title: 'nightly sweep' }));

const pendingOf = (over: Partial<PendingPrompt> = {}): PendingPrompt => ({
  id: 'vam-pending-1',
  sessionId: 'a1',
  input: 'ship it',
  seen: 0,
  live: false,
  ...over,
});

describe('what a pending prompt is, and when the real turn has replaced it', () => {
  it('counts the turns a session already had with the same words', () => {
    const model = modelOf(
      session('a1', { decisions: [decision('d2', 'ship it'), decision('d1', 'ship it')] }),
      session('a2', { decisions: [decision('d3', 'ship it')] }),
    );
    expect(countTurnsWithInput(model, 'a1', 'ship it')).toBe(2);
    expect(countTurnsWithInput(model, 'a1', 'other')).toBe(0);
    expect(countTurnsWithInput(model, 'nobody', 'ship it')).toBe(0);
  });

  it('paints the prompt as the newest turn, still working', () => {
    const model = withPending(modelOf(session('a1', { decisions: [decision('d1', 'old')] })), [
      pendingOf(),
    ]);
    const painted = model.projects[0].sessions[0];
    expect(painted.decisions.map((d) => d.input)).toEqual(['ship it', 'old']);
    expect(painted.decisions[0].output).toBeNull();
  });

  it('paints the session running only where delivery is real', () => {
    const recorded = withPending(modelOf(session('a1')), [pendingOf({ live: false })]);
    expect(recorded.projects[0].sessions[0].status).toBe('done');
    const delivered = withPending(modelOf(session('a1')), [pendingOf({ live: true })]);
    expect(delivered.projects[0].sessions[0].status).toBe('running');
  });

  it('keeps the pending prompt while the model has no more of those words than before', () => {
    // A refresh that landed mid-flight: the turn the operator typed is not in
    // it yet, so the paint has to survive.
    const before = modelOf(session('a1', { decisions: [decision('d1', 'ship it')] }));
    const pending = [pendingOf({ seen: countTurnsWithInput(before, 'a1', 'ship it') })];
    expect(reconcile(before, pending)).toEqual(pending);
  });

  it('drops it once one more turn with those words has arrived', () => {
    const before = modelOf(session('a1', { decisions: [decision('d1', 'ship it')] }));
    const pending = [pendingOf({ seen: 1 })];
    const after = modelOf(
      session('a1', { decisions: [decision('d2', 'ship it', null), decision('d1', 'ship it')] }),
    );
    expect(reconcile(after, pending)).toEqual([]);
  });

  it('drops one of two identical prompts per real turn, oldest first', () => {
    const pending = [
      pendingOf({ id: 'vam-pending-1', seen: 0 }),
      pendingOf({ id: 'vam-pending-2', seen: 0 }),
    ];
    const after = modelOf(session('a1', { decisions: [decision('d1', 'ship it')] }));
    expect(reconcile(after, pending).map((p) => p.id)).toEqual(['vam-pending-2']);
  });
});

/** A `SessionSource` whose write is gated by the promise the test releases. */
function gatedSource(
  deliverPrompt: boolean,
  write: (sessionId: string, prompt: string) => Promise<void>,
): CanvasSource {
  const inner = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: {
      liveUpdates: false,
      recordPrompt: true,
      deliverPrompt,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      closeSession: false,
      createSession: false,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
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
const inBlock = () => document.querySelector('[data-detail-scroll="in"]')?.textContent ?? '';
const runningWord = () => document.querySelector('[data-out-running-word]');
const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const stepInputs = () =>
  [...document.querySelectorAll('[data-step-input]')].map((el) => el.textContent ?? '');

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
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

/** Types `text` and presses Enter WITHOUT awaiting: the write stays in flight. */
function sendWithoutWaiting(text: string) {
  press('i');
  const input = promptInput() as HTMLTextAreaElement;
  typeInto(input, text);
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

describe('the canvas reacts to a reply before the write has landed', () => {
  function gate(): { release: () => void; done: Promise<void> } {
    let release: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { release, done };
  }

  it('shows the words in the pane and on a step node while the write is in flight', async () => {
    const { release, done } = gate();
    const source = gatedSource(false, async () => {
      await done;
    });
    render(<Canvas model={MODEL} source={source} />);
    sendWithoutWaiting('ship it');

    expect(inBlock()).toContain('ship it');
    expect(stepInputs().some((text) => text.includes('ship it'))).toBe(true);
    // And the composer is already empty, so the operator is not looking at
    // their own words in two places at once.
    expect(promptInput()?.value).toBe('');

    await act(async () => {
      release();
      await done;
    });
  });

  it('starts the running word immediately where delivery is real', async () => {
    const { release, done } = gate();
    const source = gatedSource(true, async () => {
      await done;
    });
    render(<Canvas model={MODEL} source={source} />);
    sendWithoutWaiting('ship it');

    expect(runningWord()).not.toBeNull();

    await act(async () => {
      release();
      await done;
    });
  });

  it('starts no running word where the prompt is only recorded', async () => {
    const { release, done } = gate();
    const source = gatedSource(false, async () => {
      await done;
    });
    render(<Canvas model={MODEL} source={source} />);
    sendWithoutWaiting('ship it');

    // The words are on screen -- that much is true either way -- but nothing
    // claims an agent is composing an answer, because nothing was told.
    expect(inBlock()).toContain('ship it');
    expect(runningWord()).toBeNull();

    await act(async () => {
      release();
      await done;
    });
  });

  it('takes the paint back when the write is refused, and gives the words back', async () => {
    const source = gatedSource(true, async () => {
      throw { kind: 'refused', code: 'session-running', message: 'session a1 is running' };
    });
    render(<Canvas model={MODEL} source={source} />);
    press('i');
    const input = promptInput() as HTMLTextAreaElement;
    typeInto(input, 'ship it');
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(statusBar()).toContain('session-running');
    expect(stepInputs().some((text) => text.includes('ship it'))).toBe(false);
    expect(inBlock()).not.toContain('ship it');
    expect(runningWord()).toBeNull();
    expect(promptInput()?.value).toBe('ship it');
  });

  it('shows exactly one turn when a refresh lands mid-flight and the real one follows', async () => {
    const { release, done } = gate();
    const source = gatedSource(true, async () => {
      await done;
    });
    const { rerender } = render(<Canvas model={MODEL} source={source} />);
    sendWithoutWaiting('ship it');

    // A poll answering while the write is still in flight. It cannot carry the
    // new turn yet, so the paint must survive it.
    rerender(<Canvas model={modelOf(session('a1', { title: 'nightly sweep' }))} source={source} />);
    expect(stepInputs().filter((text) => text.includes('ship it'))).toHaveLength(1);

    await act(async () => {
      release();
      await done;
    });

    // And now the real turn, as the source reports it -- its own id, not vam's.
    const real = modelOf(
      session('a1', {
        title: 'nightly sweep',
        status: 'running',
        decisions: [decision('real-1', 'ship it', null)],
      }),
    );
    await act(async () => {
      rerender(<Canvas model={real} source={source} />);
    });
    expect(stepInputs().filter((text) => text.includes('ship it'))).toHaveLength(1);
  });
});
