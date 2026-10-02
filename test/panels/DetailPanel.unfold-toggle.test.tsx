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
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session, TurnStep } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';
import { DEFAULT_FOCUS_VIEW, setActiveFocusView } from '../../src/renderer/prefs/progress.js';

const step = (id: string): TurnStep => ({ id, label: `Bash: ${id}`, failed: false });
const steps = (n: number) => Array.from({ length: n }, (_, i) => step(`s${i}`));

function turn(id: string, over: Partial<Decision> = {}): Decision {
  return {
    id,
    label: `turn-${id}`,
    input: `ask ${id}`,
    output: `done ${id}`,
    commands: [],
    ...over,
  };
}

function draw(decisions: readonly Decision[], session: Partial<Session> = {}) {
  const built: Session = {
    id: 's1',
    title: 'Provider survey',
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: '3m',
    decisions,
    ...session,
  };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [built] };
  const entry: SessionEntry = { project, session: built };
  render(
    <DetailPanel
      entry={entry}
      decision={decisions[0] ?? null}
      draft=""
      onDraftChange={() => {}}
      onSubmit={() => {}}
      composing={false}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={false}
      actionIndex={0}
      width={408}
      resizeHandle={null}
    />,
  );
}

const toggle = () => document.querySelector<HTMLButtonElement>('[data-turn-unfold]') as HTMLElement;
const toggles = () => [...document.querySelectorAll<HTMLElement>('[data-turn-unfold]')];
const regions = () => document.querySelectorAll('[data-detail-block="progress"]');
const folded = (label = 'turn-a') => `show this turn's working — ${label}`;
const open = (label = 'turn-a') => `hide this turn's working — ${label}`;
const drawFolded = (over: Partial<Decision> = {}) => {
  setActiveFocusView(true);
  draw([turn('a', { steps: steps(3), ...over })]);
};

afterEach(() => {
  cleanup();
  setActiveFocusView(DEFAULT_FOCUS_VIEW);
});

describe('the mark is a right arrow, not three dots', () => {
  it('holds lucide’s chevron-right, aria-hidden, and no text mark', () => {
    drawFolded();
    const button = toggle();
    const svg = button.querySelector('svg');
    expect(svg?.classList.contains('lucide-chevron-right')).toBe(true);
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(button.textContent).not.toContain('···');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe(folded());
    expect(svg?.classList.contains('rotate-90')).toBe(false);
  });
});

describe('pressing it toggles the turn', () => {
  it('opens on click, turns the arrow, and folds again on a second click', () => {
    drawFolded();
    fireEvent.click(toggle());
    expect(regions()).toHaveLength(1);
    expect(toggles()).toHaveLength(1);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-label')).toBe(open());
    expect(toggle().querySelector('svg')?.classList.contains('rotate-90')).toBe(true);
    fireEvent.click(toggle());
    expect(regions()).toHaveLength(0);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-label')).toBe(folded());
  });

  // A native button turns Enter and Space into a click in a browser; happy-dom
  // does not, so the assertion that matters here is that the control IS a
  // native button (no role/keydown handler to forget) and that the click it
  // synthesises round-trips.
  it.each(['Enter', ' '])('is a native button, so %j is a click on it', (key) => {
    drawFolded();
    const button = toggle();
    expect(button.tagName).toBe('BUTTON');
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.keyDown(button, { key });
    fireEvent.keyUp(button, { key });
    fireEvent.click(button);
    expect(regions()).toHaveLength(1);
    fireEvent.click(toggle());
    expect(regions()).toHaveLength(0);
  });
});

describe('what it is drawn for', () => {
  it('is not drawn with focus view off', () => {
    draw([turn('a', { steps: steps(3) })]);
    expect(toggles()).toHaveLength(0);
  });

  it('is not drawn on a turn whose tools failed, which keeps its line', () => {
    setActiveFocusView(true);
    draw([turn('a', { steps: steps(3), errorCount: 2 })]);
    expect(toggles()).toHaveLength(0);
    expect(regions()).toHaveLength(1);
  });

  it('is not drawn on the newest turn while the session has a present to report', () => {
    setActiveFocusView(true);
    draw([turn('a', { steps: steps(3) })], { activity: 'coder · round 2' });
    expect(toggles()).toHaveLength(0);
    cleanup();
    draw([turn('a', { steps: steps(3) })], { status: 'waiting', waitingFor: 'permission prompt' });
    expect(toggles()).toHaveLength(0);
  });
});

describe('the tooltip says how many steps are folded', () => {
  const hover = (button: HTMLElement) => fireEvent.pointerMove(button, { pointerType: 'mouse' });
  const tipText = async () => (await screen.findByRole('tooltip')).textContent;

  it('reads "3 steps" on hover', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    drawFolded();
    hover(toggle());
    expect(await tipText()).toBe('3 steps');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('reads "3 steps" on keyboard focus', async () => {
    drawFolded();
    fireEvent.focus(toggle());
    expect(await tipText()).toBe('3 steps');
  });

  it('reads "1 step" for a single step', async () => {
    drawFolded({ steps: steps(1) });
    fireEvent.focus(toggle());
    expect(await tipText()).toBe('1 step');
  });

  it('reads "Show working" folded and "Hide working" open when the source lists no steps', async () => {
    drawFolded({ steps: undefined });
    fireEvent.focus(toggle());
    expect(await tipText()).toBe('Show working');
    cleanup();
    drawFolded({ steps: undefined });
    fireEvent.click(toggle());
    fireEvent.focus(toggle());
    expect(await tipText()).toBe('Hide working');
  });
});
