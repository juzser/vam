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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import {
  countTurns,
  countTurnsWithInput,
  PAINT_LIFETIME_MS,
  PAINT_SWEEP_INTERVAL_MS,
  type PendingPrompt,
  reconcile,
  withPending,
} from '../../src/renderer/domain/optimistic.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';
import { SOURCE_POLL_INTERVAL_MS } from '../../src/renderer/sources/useSourceModel.js';

afterEach(cleanup);

function decision(id: string, input: string, output: string | null = 'done'): Decision {
  return { id, label: id, input, output, commands: [] };
}

function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
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

/**
 * An arbitrary fixed instant, and a `now` one second past it -- `reconcile`
 * takes the time as an argument, so the whole of it is asserted with no clock
 * and no timers. `FRESH` is inside `PAINT_LIFETIME_MS`; tests about the expiry
 * name their own `now` instead.
 */
const SENT_AT = 1_700_000_000_000;
const FRESH = SENT_AT + 1_000;

const pendingOf = (over: Partial<PendingPrompt> = {}): PendingPrompt => ({
  id: 'vam-pending-1',
  sessionId: 'a1',
  input: 'ship it',
  seen: 0,
  seenAll: 0,
  live: false,
  sentAt: SENT_AT,
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
    const painted = model.projects[0]?.sessions[0];
    expect(painted?.decisions.map((d) => d.input)).toEqual(['ship it', 'old']);
    expect(painted?.decisions[0]?.output).toBeNull();
  });

  it('paints the session running only where delivery is real', () => {
    const recorded = withPending(modelOf(session('a1')), [pendingOf({ live: false })]);
    expect(recorded.projects[0]?.sessions[0]?.status).toBe('done');
    const delivered = withPending(modelOf(session('a1')), [pendingOf({ live: true })]);
    expect(delivered.projects[0]?.sessions[0]?.status).toBe('running');
  });

  it('keeps the pending prompt while the model has no more of those words than before', () => {
    // A refresh that landed mid-flight: the turn the operator typed is not in
    // it yet, so the paint has to survive.
    const before = modelOf(session('a1', { decisions: [decision('d1', 'ship it')] }));
    const pending = [
      pendingOf({
        seen: countTurnsWithInput(before, 'a1', 'ship it'),
        seenAll: countTurns(before, 'a1'),
      }),
    ];
    expect(reconcile(before, pending, FRESH)).toEqual(pending);
  });

  it('drops it once one more turn with those words has arrived', () => {
    const before = modelOf(session('a1', { decisions: [decision('d1', 'ship it')] }));
    const pending = [
      pendingOf({
        seen: countTurnsWithInput(before, 'a1', 'ship it'),
        seenAll: countTurns(before, 'a1'),
      }),
    ];
    const after = modelOf(
      session('a1', { decisions: [decision('d2', 'ship it', null), decision('d1', 'ship it')] }),
    );
    expect(reconcile(after, pending, FRESH)).toEqual([]);
  });

  it('drops one of two identical prompts per real turn, oldest first', () => {
    const pending = [
      pendingOf({ id: 'vam-pending-1', seen: 0 }),
      pendingOf({ id: 'vam-pending-2', seen: 0 }),
    ];
    const after = modelOf(session('a1', { decisions: [decision('d1', 'ship it')] }));
    expect(reconcile(after, pending, FRESH).map((p) => p.id)).toEqual(['vam-pending-2']);
  });

  it('marks the turn it paints as vam’s own, and nothing else in the model', () => {
    const model = withPending(modelOf(session('a1', { decisions: [decision('d1', 'old')] })), [
      pendingOf(),
    ]);
    const painted = model.projects[0]?.sessions[0]?.decisions;
    expect(painted?.[0]?.unconfirmed).toBe(true);
    expect(painted?.[1]?.unconfirmed).toBeUndefined();
  });
});

/**
 * THE SECOND AND THIRD WAYS OUT. Before these, the exact-input match was the
 * ONLY thing that could retire a paint, so words the source recorded back
 * differently kept it up for the life of the renderer -- see the module head.
 */
describe('how a paint dies when its words never come back', () => {
  it('counts a session’s turns whatever their words', () => {
    const model = modelOf(
      session('a1', { decisions: [decision('d2', 'ship it'), decision('d1', 'other')] }),
      session('a2', { decisions: [decision('d3', 'ship it')] }),
    );
    expect(countTurns(model, 'a1')).toBe(2);
    expect(countTurns(model, 'a2')).toBe(1);
    expect(countTurns(model, 'nobody')).toBe(0);
  });

  it('drops a paint the session has recorded a turn past, with words that differ', () => {
    // The mangling the operator hit: one `send-keys -l` with no bracketed
    // paste, and what the TUI wrote down is not what vam sent.
    const before = modelOf(session('a1'));
    const pending = [pendingOf({ input: 'hello, who are you?', seen: 0, seenAll: 0 })];
    const after = modelOf(
      session('a1', { decisions: [decision('real-1', 'hello, whohello, who are you?')] }),
    );
    expect(reconcile(before, pending, FRESH)).toEqual(pending);
    expect(reconcile(after, pending, FRESH)).toEqual([]);
  });

  it('keeps a paint while the session has gained no turn at all', () => {
    // The first reload after a send, answering before the source has written
    // the prompt down. Nothing has been overtaken; the paint is still covering
    // the round trip it exists for.
    const model = modelOf(session('a1', { decisions: [decision('d1', 'older')] }));
    const pending = [pendingOf({ seenAll: countTurns(model, 'a1') })];
    expect(reconcile(model, pending, FRESH)).toEqual(pending);
  });

  it('spends one turn per paint overtaken, oldest first', () => {
    // Two different prompts in flight and ONE turn arrived. An unbudgeted rule
    // retires both -- the second on the strength of the first one's turn.
    const pending = [
      pendingOf({ id: 'vam-pending-1', input: 'first', seenAll: 0 }),
      pendingOf({ id: 'vam-pending-2', input: 'second', seenAll: 0 }),
    ];
    const one = modelOf(session('a1', { decisions: [decision('real-1', 'mangled')] }));
    expect(reconcile(one, pending, FRESH).map((p) => p.id)).toEqual(['vam-pending-2']);
    const two = modelOf(
      session('a1', { decisions: [decision('real-2', 'mangled too'), decision('real-1', 'x')] }),
    );
    expect(reconcile(two, pending, FRESH)).toEqual([]);
  });

  it('never lets one real turn retire both the paint it matches and another', () => {
    // The turn matches the first paint exactly, so it is spent there. The
    // second must NOT then be retired as overtaken by that same turn.
    const pending = [
      pendingOf({ id: 'vam-pending-1', input: 'ship it', seen: 0, seenAll: 0 }),
      pendingOf({ id: 'vam-pending-2', input: 'and again', seen: 0, seenAll: 0 }),
    ];
    const after = modelOf(session('a1', { decisions: [decision('real-1', 'ship it')] }));
    expect(reconcile(after, pending, FRESH).map((p) => p.id)).toEqual(['vam-pending-2']);
  });

  it('counts each session’s turns against its own paints', () => {
    // a2 gained a turn; a1's paint has no business being retired by it.
    const pending = [pendingOf({ id: 'vam-pending-1', sessionId: 'a1', seenAll: 0 })];
    const after = modelOf(
      session('a1'),
      session('a2', { decisions: [decision('real-1', 'mangled')] }),
    );
    expect(reconcile(after, pending, FRESH)).toEqual(pending);
  });

  it('drops a paint that has stood past its lifetime with nothing to show for it', () => {
    // The source recorded nothing at all -- no match, no new turn, so neither
    // rule above can fire. This is the one that makes "forever" impossible.
    const model = modelOf(session('a1'));
    const pending = [pendingOf()];
    expect(reconcile(model, pending, SENT_AT + PAINT_LIFETIME_MS - 1)).toEqual(pending);
    expect(reconcile(model, pending, SENT_AT + PAINT_LIFETIME_MS)).toEqual([]);
  });

  it('retires an expired paint on the evidence when there is evidence', () => {
    // A paint that is BOTH expired and overtaken must be retired as overtaken,
    // so that the turn it was overtaken by is spent. Let the clock take it
    // first and that turn is left unspent for the paint behind it to be
    // retired by -- one real turn retiring two paints, which is the duplicate
    // both budgets exist to prevent. Only a paint in each state at once can
    // tell the two orderings apart.
    const pending = [
      pendingOf({ id: 'vam-pending-1', input: 'stale', seenAll: 0, sentAt: SENT_AT }),
      pendingOf({
        id: 'vam-pending-2',
        input: 'just sent',
        seenAll: 0,
        sentAt: SENT_AT + PAINT_LIFETIME_MS,
      }),
    ];
    const after = modelOf(session('a1', { decisions: [decision('real-1', 'mangled')] }));
    expect(reconcile(after, pending, SENT_AT + PAINT_LIFETIME_MS).map((p) => p.id)).toEqual([
      'vam-pending-2',
    ]);
  });

  it('expires each paint on its own send time, not on the oldest', () => {
    const model = modelOf(session('a1'));
    const pending = [
      pendingOf({ id: 'vam-pending-1', input: 'first', sentAt: SENT_AT }),
      pendingOf({ id: 'vam-pending-2', input: 'second', sentAt: SENT_AT + 20_000 }),
    ];
    expect(reconcile(model, pending, SENT_AT + PAINT_LIFETIME_MS).map((p) => p.id)).toEqual([
      'vam-pending-2',
    ]);
  });

  it('leaves the lifetime room for the reload a slow source is still owed', () => {
    // `sendPrompt` asks for a reload at once and a `liveUpdates: false` source
    // is re-read every `SOURCE_POLL_INTERVAL_MS` besides. The expiry has to sit
    // clear of both, or it takes paints down that are legitimately waiting --
    // so moving the poll interval must fail HERE rather than in the field.
    expect(PAINT_LIFETIME_MS).toBeGreaterThanOrEqual(SOURCE_POLL_INTERVAL_MS * 3);
    // And the sweep decides the granularity: a paint may stand this much past
    // its lifetime, which has to stay small beside the lifetime itself.
    expect(PAINT_SWEEP_INTERVAL_MS).toBeLessThanOrEqual(PAINT_LIFETIME_MS / 10);
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
const inBlock = () => document.querySelector('[data-detail-scroll="in"]')?.textContent ?? '';
const outBlock = () => document.querySelector('[data-detail-scroll="out"]')?.textContent ?? '';
const runningWord = () => document.querySelector('[data-out-running-word]');
const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
// Relocated from `stepInputs()` (0.2 migration step 2): the graph drew one
// card per decision, so counting how many carried "ship it" caught a
// reconciled model that still held a duplicate. The shell's `in` block shows
// only the focused decision, but the progress count is drawn straight off
// `entry.session.decisions.length` — a direct read of the same array, not an
// incidental side effect of what one region happens to paint. A12.2 moved
// this text off a toggle button (retired) onto its own
// `[data-progress-count]` span, which is now the whole of the control's
// non-interactive half — see `DetailPanel.tsx`.
const turnsRead = () =>
  Number(document.querySelector('[data-progress-count]')?.textContent?.match(/^\d+/)?.[0] ?? -1);

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

  it('shows the words in the pane while the write is in flight', async () => {
    const { release, done } = gate();
    const source = gatedSource(false, async () => {
      await done;
    });
    render(<Canvas model={MODEL} source={source} />);
    sendWithoutWaiting('ship it');

    expect(inBlock()).toContain('ship it');
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
    expect(turnsRead()).toBe(1);

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
    expect(turnsRead()).toBe(1);
  });
});

/**
 * THE GHOST TURN. The operator reported the Terminal tab showing the agent's
 * answer while the Response view said the turn had ended without one, and a
 * second screenshot showed one typed prompt drawn as two turns -- the first a
 * mangled concatenation of the prompt with itself.
 *
 * Both are the same mechanism. `reconcile` retired a paint on exactly one
 * condition, an EXACT string match on the input, so a source that recorded the
 * words back even one character differently kept the paint alive for the life
 * of the renderer: drawn as the newest turn with `output: null`, above the real
 * turn carrying the real answer. Divergence is not hypothetical -- the prompt
 * goes into a tmux pane as one `send-keys -l` with no bracketed paste to frame
 * it (`sources/claude-code/reply.ts`), and a TUI that is booting, re-wrapping
 * or echoing records something that is not byte-identical.
 */
describe('a paint whose words the source never reports back', () => {
  function gate(): { release: () => void; done: Promise<void> } {
    let release: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { release, done };
  }

  it('gives the paint up once the session has recorded a turn it cannot match', async () => {
    const { release, done } = gate();
    const source = gatedSource(true, async () => {
      await done;
    });
    const { rerender } = render(<Canvas model={MODEL} source={source} />);
    sendWithoutWaiting('hello, who are you?');
    await act(async () => {
      release();
      await done;
    });

    // What the source came back with: ONE turn, carrying the real answer,
    // whose input is NOT what vam sent. The round trip demonstrably completed.
    const mangled = modelOf(
      session('a1', {
        title: 'nightly sweep',
        status: 'done',
        decisions: [decision('real-1', 'hello, whohello, who are you?', 'I am Claude.')],
      }),
    );
    await act(async () => {
      rerender(<Canvas model={mangled} source={source} />);
    });

    expect(turnsRead()).toBe(1);
    expect(outBlock()).not.toContain('ended without an answer');
  });

  /**
   * BOTH BASELINES ARE READ FROM THE MODEL, and a session that already has
   * turns is the only place where that can be seen. Send into an empty one --
   * which is what every other test here does -- and both baselines are zero
   * whether they were measured or assumed, so a `seenAll: 0` or a `seen: 0`
   * passes the whole suite while retiring every paint on the first reconcile,
   * before the operator's words have been on screen for a frame. That is the
   * OTHER direction of this fix's cost, and it is the expensive one.
   */
  it('keeps a paint sent into a session that already had turns', async () => {
    const { release, done } = gate();
    const source = gatedSource(true, async () => {
      await done;
    });
    const busy = modelOf(
      session('a1', {
        title: 'nightly sweep',
        decisions: [decision('d1', 'an older prompt', 'an older answer')],
      }),
    );
    render(<Canvas model={busy} source={source} />);
    sendWithoutWaiting('ship it');
    await act(async () => {});

    // The turn the session already had, plus vam's paint -- not the paint
    // retired as "overtaken" by a turn that arrived long before the send.
    expect(turnsRead()).toBe(2);

    await act(async () => {
      release();
      await done;
    });
  });

  it('keeps a paint resending words the session has heard before', async () => {
    const { release, done } = gate();
    const source = gatedSource(true, async () => {
      await done;
    });
    const before = modelOf(
      session('a1', {
        title: 'nightly sweep',
        decisions: [decision('d1', 'ship it', 'shipped')],
      }),
    );
    render(<Canvas model={before} source={source} />);
    sendWithoutWaiting('ship it');
    await act(async () => {});

    // Matched against the OLD turn rather than against a baseline, this paint
    // is retired the instant it goes up and the operator sees nothing happen.
    expect(turnsRead()).toBe(2);

    await act(async () => {
      release();
      await done;
    });
  });

  it('takes the paint down on its own timer, with no new model from the source', async () => {
    // The expiry is the backstop for a source that reports NOTHING back, and
    // `load()` keeps the last good model when it fails -- so a source that has
    // started erroring produces no new model to reconcile against. Hanging the
    // sweep on the next model would make the safety valve depend on exactly the
    // thing it insures against. This renders once and never re-renders.
    vi.useFakeTimers();
    try {
      const source = gatedSource(true, async () => {});
      render(<Canvas model={MODEL} source={source} />);
      sendWithoutWaiting('ship it');
      await act(async () => {});
      expect(inBlock()).toContain('ship it');

      await act(async () => {
        vi.advanceTimersByTime(PAINT_LIFETIME_MS + PAINT_SWEEP_INTERVAL_MS);
      });
      expect(inBlock()).not.toContain('ship it');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not name the last turn’s tool call as this paint’s working', async () => {
    const { release, done } = gate();
    const source = gatedSource(true, async () => {
      await done;
    });
    const working = modelOf(
      session('a1', {
        title: 'nightly sweep',
        status: 'running',
        activity: 'Bash: run the tests',
        decisions: [decision('d1', 'an older prompt', 'an older answer')],
      }),
    );
    render(<Canvas model={working} source={source} />);
    sendWithoutWaiting('ship it');
    await act(async () => {});

    // `activity` is the newest tool call the SOURCE read, and that reading was
    // taken before this prompt was sent. Drawn on the paint it names the
    // agent's previous work as this turn's working -- the same unsupported
    // claim as "ended without an answer", one line up.
    expect(runningWord()?.textContent).not.toContain('Bash: run the tests');
    expect(runningWord()?.textContent).toContain('waiting for the source to report this turn back');

    await act(async () => {
      release();
      await done;
    });
  });

  it('says nothing about the turn having ended while the paint is still up', async () => {
    const { release, done } = gate();
    const source = gatedSource(false, async () => {
      await done;
    });
    render(<Canvas model={MODEL} source={source} />);
    sendWithoutWaiting('ship it');

    // Nothing ended. Vam has not heard back -- which is a different sentence,
    // and the only one it can support.
    expect(outBlock()).not.toContain('ended without an answer');
    expect(outBlock()).toContain('waiting for the source to report this turn back');

    await act(async () => {
      release();
      await done;
    });
  });
});
