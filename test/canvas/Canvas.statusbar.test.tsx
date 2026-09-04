// @vitest-environment happy-dom

/**
 * What the status bar is allowed to say.
 *
 * The operator asked for two removals: the session tallies ("statusbar khong
 * can list so session va session status") and everything on the right except
 * the `?` hint ("Phan ben phai status bar, chi de `?` keyboard shortcut
 * thoi"). This file pins BOTH as absences, so a re-add fails a test rather
 * than quietly landing.
 *
 * It also pins what must survive: the mode indicator, which a modal app
 * cannot do without, and the usage cell and bars beside it -- neither was
 * part of the request, and a removal that took them too would be a
 * different, unasked-for change.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas, StatusCell } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { clearEvents, recordFailure, recordRefusal } from '../../src/renderer/errors/log.js';
import { describeFailure } from '../../src/renderer/sources/port.js';

function session(id: string, status: Session['status']): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status,
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

/** One session of every status, so every tally cell that could render would. */
const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'black-smith',
      sessions: [session('a1', 'running'), session('a2', 'waiting')],
    },
    { id: 'p2', name: 'beta', source: 'orca', sessions: [session('b1', 'done')] },
    { id: 'p3', name: 'gamma', sessions: [session('c1', 'failed')] },
  ],
};

const statusBar = () => document.querySelector('[data-status-bar]');
const statusText = () => statusBar()?.textContent ?? '';

beforeAll(() => {
  // ReactFlow measures with APIs happy-dom does not implement.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
  globalThis.localStorage ??= (() => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, String(value)),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
      key: (index: number) => [...map.keys()][index] ?? null,
      get length() {
        return map.size;
      },
    };
  })() as unknown as Storage;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the status bar after the trim', () => {
  it('counts nothing: no session tally, no per-status tally, no project count', () => {
    render(<Canvas model={MODEL} />);
    const text = statusText();
    expect(text).not.toMatch(/sessions/);
    expect(text).not.toMatch(/\d+ running/);
    expect(text).not.toMatch(/need you/);
    expect(text).not.toMatch(/\d+ done/);
    expect(text).not.toMatch(/\d+ failed/);
    expect(text).not.toMatch(/projects/);
  });

  it('drops the budget cell with the rest of the right-hand end', () => {
    render(<Canvas model={MODEL} />);
    expect(statusBar()?.querySelector('[data-budget]')).toBeNull();
    expect(statusText()).not.toMatch(/cap/);
  });

  it('leaves `?` as the only thing right of the spacer', () => {
    render(<Canvas model={MODEL} />);
    const bar = statusBar();
    expect(bar).not.toBeNull();
    const children = [...(bar?.children ?? [])];
    const spacer = children.findIndex((el) => el.className.split(/\s+/).includes('flex-1'));
    expect(spacer).toBeGreaterThanOrEqual(0);
    const right = children.slice(spacer + 1);
    expect(right.map((el) => el.textContent)).toEqual(['?Keyboard shortcut']);
  });

  it('draws `?` as a tag and names what it opens', () => {
    render(<Canvas model={MODEL} />);
    const hint = statusBar()?.querySelector('[data-keysheet-hint]');
    // The key is a tag, not loose text: it has to read as a key you press,
    // which is what a bordered cap does and a bare glyph does not.
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe('?');
    expect(hint?.className).toMatch(/border/);
    // And the label beside it says what pressing it does -- a lone `?` in a
    // corner is discoverable only to someone who already knows.
    expect(statusText()).toContain('Keyboard shortcut');
  });

  it('still prints the key the keysheet is actually bound to', () => {
    render(<Canvas model={MODEL} />);
    // `?` is the `help` chord in the binding tables; the hint must not name
    // a key the grammar does not answer to.
    expect(statusText()).toMatch(/\?/);
    expect(statusText()).not.toMatch(/hjkl/);
  });

  it('keeps the mode indicator and the usage cell, which nobody asked to lose', () => {
    render(<Canvas model={MODEL} />);
    expect(statusBar()?.querySelector('[data-mode]')?.textContent).toBe('NORMAL');
    expect(statusBar()?.querySelector('[data-usage]')).not.toBeNull();
  });
});

/**
 * The status cell carries `code: message` from `describeFailure`, and those
 * messages are long on purpose -- a code per distinct failure, and a sentence
 * that says what to do about it. Shortening them at the source would undo
 * that, so the cell shortens the PRESENTATION and keeps the whole string
 * reachable.
 */
describe('the status cell with a long failure in it', () => {
  // A real one: `stopSession`'s refusal for an interactive row, as
  // `describeFailure` renders it. Not lorem ipsum -- the shape being tested
  // is `code: message`, and only a real pair has a real code on the front.
  const REFUSAL = describeFailure({
    kind: 'refused',
    code: 'interactive-session',
    message:
      '"orca-3" is an interactive session — a terminal you are sitting in. Claude Code can only stop background sessions, and vam will not kill the process behind your window: close that terminal yourself.',
  });

  const cell = () => document.querySelector('[data-status]');

  it('renders it shorter than it is', () => {
    render(<StatusCell text={REFUSAL} />);
    const shown = cell()?.textContent ?? '';
    expect(shown.length).toBeLessThan(REFUSAL.length);
    expect(shown).toMatch(/…$/);
  });

  it('keeps the code, which is the half that says WHICH failure this is', () => {
    render(<StatusCell text={REFUSAL} />);
    // The code leads, so what survives is the identifying part; a truncation
    // that kept the sentence and dropped `interactive-session` would leave a
    // cell that cannot be told apart from any other refusal.
    expect(cell()?.textContent).toMatch(/^interactive-session: /);
  });

  it('hands the whole message to the tooltip', () => {
    render(<StatusCell text={REFUSAL} />);
    // `Note` is Radix, which opens on focus as well as hover; `data-note`
    // is the string it will show, queryable without an open portal.
    expect(cell()?.getAttribute('data-note')).toBe(REFUSAL);
  });

  it('is reachable by keyboard, which is how the tooltip opens on focus', () => {
    render(<StatusCell text={REFUSAL} />);
    expect(cell()?.getAttribute('tabindex')).toBe('0');
  });

  it('leaves a message that already fits exactly as it was', () => {
    const short = describeFailure({
      kind: 'refused',
      code: 'unknown-session',
      message: 'no such session',
    });
    render(<StatusCell text={short} />);
    expect(cell()?.textContent).toBe(short);
    expect(cell()?.textContent).not.toMatch(/…/);
  });

  it('can shrink further than the character backstop when the window is narrow', () => {
    render(<StatusCell text={REFUSAL} />);
    // The backstop is a cap on how much of the bar one cell may claim; the
    // width-responsive half is CSS, and `min-w-0` is what lets a flex child
    // shrink below its content at all -- without it the cell pushes the line
    // out instead of ellipsing.
    const classes = (cell()?.className ?? '').split(/\s+/);
    expect(classes).toContain('min-w-0');
    expect(classes).toContain('truncate');
  });
});

/**
 * The one new cell: the way back to a failure the status line has already
 * replaced. It is left of the spacer, so the "`?` is the only thing on the
 * right" assertion above still holds and still means what it says.
 */
describe('the failure cell', () => {
  afterEach(() => {
    clearEvents();
  });

  it('is absent while nothing has broken -- a permanent 0 is noise', () => {
    render(<Canvas model={MODEL} />);
    expect(statusBar()?.querySelector('[data-error-log-button]')).toBeNull();
  });

  it('counts failures and opens the log', () => {
    recordFailure('close session', { code: 'cli-failed', message: 'pairing refused' });
    render(<Canvas model={MODEL} />);
    const button = statusBar()?.querySelector('[data-error-log-button]');
    expect(button?.textContent).toBe('1 failure');
    fireEvent.click(button as Element);
    expect(document.querySelector('[data-error-log]')).not.toBeNull();
  });

  it('does not count an intended refusal', () => {
    recordRefusal('new project', 'this source cannot start sessions');
    render(<Canvas model={MODEL} />);
    expect(statusBar()?.querySelector('[data-error-log-button]')).toBeNull();
  });
});
