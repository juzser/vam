// @vitest-environment happy-dom

/**
 * THE CELL THAT SAYS WHETHER VAM IS CONNECTED (F-6).
 *
 * Its own comment in `Canvas.tsx` states the rule: "the one thing a dashboard
 * must never do is look the same whether or not it is connected". The
 * `'session'` arm -- the only arm the desktop build ever reaches -- broke it
 * twice. It hard-coded a green dot and the source's name, so a source whose
 * every poll was failing read exactly like a healthy one; and before the
 * source was assembled at all there was no `'session'` source yet, so the
 * canvas fell back to `READ_ONLY_SOURCE` and the opening window claimed "no
 * write route — this canvas is read-only" about a source that was still
 * loading and would turn out to be writable.
 *
 * Asserted on the cell's own text and its colour class, because the colour is
 * the whole claim: the failure badge in the status bar was already correct,
 * and it was the green dot beside it that contradicted it.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

const MODEL: CanvasModel = { projects: [] };

const inner = {
  id: 'claude-code',
  label: 'Claude Code',
  capabilities: {
    liveUpdates: false,
    recordPrompt: true,
    deliverPrompt: false,
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
  write: { recordPrompt: async () => {} },
} as unknown as SessionSource;

const cell = () => document.querySelector('[data-source]') as HTMLElement;
const dot = () => cell().firstElementChild as HTMLElement;

/**
 * What the cell PAINTS, which is no longer the same as what it says.
 *
 * `textContent` cannot answer "is the name on the bar" any more: the healthy
 * arm keeps the source names in `sr-only` text so a screen reader still has
 * them, and `sr-only` text is in `textContent` like any other. A check written
 * against `textContent` would have gone on passing while the joined label came
 * back on screen -- which is exactly the regression the operator asked to be
 * rid of. So the sr-only nodes are removed from a clone and what is left is
 * what an eye gets.
 */
const painted = () => {
  const clone = cell().cloneNode(true) as HTMLElement;
  for (const hidden of clone.querySelectorAll('.sr-only')) hidden.remove();
  return (clone.textContent ?? '').trim();
};

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

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the source cell', () => {
  /**
   * THE HEALTHY ARM STOPPED SPENDING THE BAR ON NAMES (operator: "status bar
   * — show only the provider of the session that is open, not Claude Code +
   * Codex"). With two desktop sources registered, `combine.ts` joins their
   * labels with " + " and that string was the whole of this cell's resting
   * state: it named every source vam is connected to, on every frame, while
   * the `SourceGlyph` two cells along already says which one the FOCUSED
   * session came from -- and says it better, because it answers the question
   * an operator actually has.
   *
   * The cell is not deleted and its job is unchanged. What it must still do,
   * and what these three assertions are, is: report health, keep the names
   * reachable rather than destroying them, and stay readable without hue.
   */
  it('reports health without spending the bar on the joined source names', () => {
    const joined = { ...inner, label: 'Claude Code + Codex' } as SessionSource;
    const source: CanvasSource = { kind: 'session', source: joined, onWrote: () => {} };
    render(<Canvas model={MODEL} source={source} />);
    // NOTHING PAINTED BUT THE MARK. `painted()` and not `textContent`, for the
    // reason written above it.
    expect(painted()).not.toContain('Claude Code');
    expect(painted()).not.toContain('+');
    expect(painted()).toBe('●');
    expect(dot().className).toContain('text-done');
  });

  it('keeps the names reachable — in the accessible name and in the tooltip', () => {
    const joined = { ...inner, label: 'Claude Code + Codex' } as SessionSource;
    render(
      <Canvas model={MODEL} source={{ kind: 'session', source: joined, onWrote: () => {} }} />,
    );
    // The answer to "which sources am I connected to" is still in the DOM for
    // a screen reader, and on the tooltip `Note` puts on the trigger for a
    // pointer or a keyboard. Both, because neither alone serves everyone.
    expect(cell().textContent).toContain('Claude Code + Codex');
    expect(cell().querySelector('.sr-only')?.textContent).toContain('Claude Code + Codex');
    expect(dot().getAttribute('data-note')).toContain('Claude Code + Codex');
  });

  it('says "connected" in words, so the green dot is not the only signal', () => {
    // WCAG 1.4.1. A bare coloured dot is a claim made in hue alone; the word
    // is what carries it for a reader who receives no hue. `status-mark.tsx`
    // is the standing reference for this rule in this codebase.
    render(<Canvas model={MODEL} source={{ kind: 'session', source: inner, onWrote: () => {} }} />);
    expect(cell().querySelector('.sr-only')?.textContent).toMatch(/connected/i);
  });

  it('does not draw green while the source is in error, and says what failed', () => {
    const source: CanvasSource = {
      kind: 'session',
      source: inner,
      error: 'could not load projects — the `claude` command was not found',
      onWrote: () => {},
    };
    render(<Canvas model={MODEL} source={source} />);
    expect(dot().className).not.toContain('text-done');
    expect(dot().className).toContain('text-failed');
    expect(cell().textContent).toContain('was not found');
  });

  it('start-up is distinguishable from connected-and-empty, and claims nothing about writing', () => {
    render(<Canvas model={MODEL} source={{ kind: 'connecting' }} />);
    expect(cell().textContent).toMatch(/connecting/i);
    // The old start-up sentence, which was a false statement about a source
    // that had not answered yet.
    expect(cell().textContent).not.toMatch(/read-only/i);
    expect(dot().className).not.toContain('text-done');
    // Not `ink-faint`: 3.27:1 dark, 3.01:1 light (issue 188).
    expect(dot().className).not.toContain('ink-faint');
  });

  /**
   * ONE SOURCE, ONE CLAIM ABOUT IT.
   *
   * The cell reads the failure off `source.error`; `newSessionRoute` did not,
   * so with a source that had answered and refused permanently the cell said
   * so in red while the `+` tooltip and the status bar on click both said
   * "still connecting" -- an in-progress connection that had already ended.
   * `source.ts` says this field exists to stop exactly that.
   */
  it('the + refuses in the same words the cell is showing, not "still connecting"', async () => {
    const failed = 'the endpoint refused: unauthenticated';
    render(<Canvas model={MODEL} source={{ kind: 'connecting', error: failed }} />);
    expect(cell().textContent).toContain(failed);

    // The refusal now surfaces through the Radix ShortcutTip (no native
    // `title` any more — see SessionList.tsx), so it is read by opening the
    // tooltip on focus rather than off the `title` attribute.
    const plus = screen.getByLabelText('new project') as HTMLButtonElement;
    fireEvent.focus(plus);
    const tipText = screen.getByRole('tooltip').textContent ?? '';
    expect(tipText).toContain(failed);
    expect(tipText).not.toMatch(/still connecting/i);

    await act(async () => {
      plus.click();
    });
    const bar = document.querySelector('[data-status-bar]')?.textContent ?? '';
    expect(bar).toContain('unauthenticated');
    expect(bar).not.toMatch(/still connecting/i);
  });

  it('still says "connecting" while it genuinely is', async () => {
    render(<Canvas model={MODEL} source={{ kind: 'connecting' }} />);
    const plus = screen.getByLabelText('new project') as HTMLButtonElement;
    await act(async () => {
      plus.click();
    });
    const bar = document.querySelector('[data-status-bar]')?.textContent ?? '';
    expect(bar).toMatch(/still connecting/i);
  });

  it('a source that could not be assembled at all says so rather than connecting forever', () => {
    render(<Canvas model={MODEL} source={{ kind: 'connecting', error: 'no route to a source' }} />);
    expect(cell().textContent).toContain('no route to a source');
    expect(cell().textContent).not.toMatch(/connecting/i);
    expect(dot().className).toContain('text-failed');
  });
});
