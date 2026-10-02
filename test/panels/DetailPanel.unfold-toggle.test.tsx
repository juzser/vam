// @vitest-environment happy-dom

/**
 * THE UNFOLD ARROW, AS A TOGGLE.
 *
 * Operator event 49: the three-dot mark on a folded turn becomes a right arrow
 * that expands the turn on click, with a tooltip giving the step count. The
 * arrow stays drawn once the turn is open and turns, and pressing it again
 * folds the turn: a way back that only ever added to the set had no way to
 * undo itself.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Session, TurnStep } from '../../src/renderer/domain/model.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';
import { DEFAULT_FOCUS_VIEW, setActiveFocusView } from '../../src/renderer/prefs/progress.js';

const step = (id: string): TurnStep => ({ id, label: `Bash: ${id}`, failed: false });
const steps = (n: number) => Array.from({ length: n }, (_, i) => step(`s${i}`));

const turn = (id: string, over: Partial<Decision> = {}): Decision => ({
  id,
  label: `turn-${id}`,
  input: `ask ${id}`,
  output: `done ${id}`,
  commands: [],
  ...over,
});

const noop = () => {};
const base = { draft: '', onDraftChange: noop, onSubmit: noop, onCompose: noop, width: 408 };
type Props = ComponentProps<typeof DetailPanel>;

function draw(decisions: readonly Decision[], session: Partial<Session> = {}) {
  const built = { id: 's1', title: 'T', status: 'running', activity: null, decisions, ...session };
  const entry = { project: { id: 'p1', name: 'atlas', sessions: [built] }, session: built };
  const rest = { composing: false, active: false, actionIndex: 0, resizeHandle: null };
  const props = { ...base, ...rest, onStopComposing: noop, entry, decision: decisions[0] ?? null };
  render(<DetailPanel {...(props as unknown as Props)} />);
}

const toggles = () => [...document.querySelectorAll<HTMLElement>('[data-turn-unfold]')];
const toggle = () => toggles()[0] as HTMLElement;
const regions = () => document.querySelectorAll('[data-detail-block="progress"]');
const folded = "show this turn's working — turn-a";
const open = "hide this turn's working — turn-a";
const drawFolded = (over: Partial<Decision> = {}) => {
  setActiveFocusView(true);
  draw([turn('a', { steps: steps(3), ...over })]);
};
const drawQuiet = (over: Partial<Decision>, session: Partial<Session> = {}) => {
  setActiveFocusView(true);
  draw([turn('a', { steps: steps(3), ...over })], session);
};

afterEach(() => {
  cleanup();
  setActiveFocusView(DEFAULT_FOCUS_VIEW);
});

it('holds lucide’s chevron-right, aria-hidden, and no text mark', () => {
  drawFolded();
  const svg = toggle().querySelector('svg');
  expect(svg?.classList.contains('lucide-chevron-right')).toBe(true);
  expect(svg?.getAttribute('aria-hidden')).toBe('true');
  expect(toggle().textContent).not.toContain('···');
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(toggle().getAttribute('aria-label')).toBe(folded);
  expect(svg?.classList.contains('rotate-90')).toBe(false);
});

// A native button turns Enter and Space into a click in a browser; happy-dom
// does not, so the keyed cases assert the control IS a native button (no
// role/keydown handler to forget) and that the click it synthesises round-trips.
it.each([
  ['click', null],
  ['Enter', 'Enter'],
  ['Space', ' '],
])('%s opens the turn, turns the arrow, and folds it again', (_name, key) => {
  drawFolded();
  const press = () => {
    const button = toggle();
    if (key === null) return fireEvent.click(button);
    expect(button.tagName).toBe('BUTTON');
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.keyDown(button, { key });
    fireEvent.keyUp(button, { key });
    fireEvent.click(button);
  };
  press();
  expect(regions()).toHaveLength(1);
  expect(toggles()).toHaveLength(1);
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  expect(toggle().getAttribute('aria-label')).toBe(open);
  expect(toggle().querySelector('svg')?.classList.contains('rotate-90')).toBe(true);
  press();
  expect(regions()).toHaveLength(0);
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(toggle().getAttribute('aria-label')).toBe(folded);
});

describe('what it is drawn for', () => {
  it('is not drawn with focus view off', () => {
    draw([turn('a', { steps: steps(3) })]);
    expect(toggles()).toHaveLength(0);
  });

  it('is not drawn on a turn whose tools failed, which keeps its line', () => {
    drawQuiet({ errorCount: 2 });
    expect(toggles()).toHaveLength(0);
    expect(regions()).toHaveLength(1);
  });

  it.each([
    { activity: 'coder · round 2' },
    { status: 'waiting', waitingFor: 'permission prompt' } as const,
  ])(
    'is not drawn on the newest turn while the session has a present to report (%j)',
    (session) => {
      drawQuiet({}, session);
      expect(toggles()).toHaveLength(0);
    },
  );
});

describe('the tooltip says how many steps are folded', () => {
  const tipText = async () => (await screen.findByRole('tooltip')).textContent;

  it('reads "3 steps" on hover, with no fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    drawFolded();
    fireEvent.pointerMove(toggle(), { pointerType: 'mouse' });
    expect(await tipText()).toBe('3 steps');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each([
    ['3 steps', 3, false, '3 steps'],
    ['1 step', 1, false, '1 step'],
    ['no steps, folded', undefined, false, 'Show working'],
    ['no steps, open', undefined, true, 'Hide working'],
    ['empty steps, folded', 0, false, 'Show working'],
    ['empty steps, open', 0, true, 'Hide working'],
  ])('reads the right text on keyboard focus: %s', async (_name, n, expand, text) => {
    drawFolded({ steps: n === undefined ? undefined : steps(n) });
    if (expand) fireEvent.click(toggle());
    fireEvent.focus(toggle());
    expect(await tipText()).toBe(text);
  });
});
