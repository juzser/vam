// @vitest-environment happy-dom

/**
 * THE CONTROL FOR THE VIEWS' WIDTH, at the surface the operator touches.
 *
 * Two halves, and the second is the one that matters — the shape
 * `focus-view.test.tsx` established here. A row that writes a field into
 * `prefs` and a row that changes the screen are different things, so the last
 * block goes through the whole seam an operator's click really travels:
 * overlay → `onChange` → `writePrefs` → `activatePrefs` → the module store →
 * the element the cap lands on.
 *
 * WHAT IT CANNOT SAY. happy-dom lays nothing out, so no assertion here is
 * about pixels or about characters on a line; `e2e/view-width-shots.mjs`
 * measures both in Chromium.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import {
  browserStorage,
  EMPTY_PREFS,
  type Prefs,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';
import {
  DEFAULT_NARROW_VIEWS,
  narrowProseMaxWidth,
  setActiveNarrowViews,
} from '../../src/renderer/prefs/view-width.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

/** One character of prose, as some platform might report it. Any number does;
 *  the cap is divided out of it rather than looked up. */
const ADVANCE = 6.0079;
/** The `ResizeObserver` callbacks happy-dom will never fire on its own. */
const OBSERVERS: (() => void)[] = [];

beforeAll(() => {
  // happy-dom has no `ResizeObserver`, and the panel's prose ruler needs one
  // to report its rectangle. Collected rather than run: the rectangle is
  // written by hand below, and a callback fired before that would measure the
  // zeros happy-dom reports for everything.
  class Collected {
    constructor(callback: () => void) {
      OBSERVERS.push(callback);
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', Collected);
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: (() => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: () => null,
        get length() {
          return map.size;
        },
      };
    })() as unknown as Storage,
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  setActiveNarrowViews(DEFAULT_NARROW_VIEWS);
});

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={() => {}} />);
  return { onChange };
}

const toggle = () => document.querySelector<HTMLButtonElement>('[data-switch="narrow-views"]');

function changed(onChange: { mock: { calls: unknown[][] } }, index = 0): Prefs {
  const call = onChange.mock.calls[index];
  expect(call, `onChange was not called ${index + 1} time(s)`).toBeDefined();
  return (call ?? [])[0] as Prefs;
}

describe('the appearance section offers the views’ width', () => {
  it('is a switch, and says which way it is thrown', () => {
    // A SWITCH AND NOT TWO BUTTONS, the choice `focus view` made one row up:
    // there is one thing being turned on, and `role="switch"` plus
    // `aria-checked` is how a state reaches a screen reader as a state.
    open();
    expect(toggle()?.getAttribute('role')).toBe('switch');
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
    expect(toggle()?.textContent).toBe('full pane');
  });

  it('names the two states in the operator’s own words', () => {
    open({ ...EMPTY_PREFS, narrowViews: true });
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
    expect(toggle()?.textContent).toBe('narrowed');
  });

  it('is named for what it controls, never for the state it is in', () => {
    const off = (() => {
      open();
      return toggle()?.getAttribute('aria-label') ?? '';
    })();
    cleanup();
    open({ ...EMPTY_PREFS, narrowViews: true });
    expect(toggle()?.getAttribute('aria-label')).toBe(off);
    expect(off.toLowerCase()).toContain('width');
  });

  it('says on the row which views it reaches, and that the terminal is not one', () => {
    // THE ROW IS THE WHOLE DOCUMENTATION. Two facts an operator cannot guess:
    // that the fraction has a THRESHOLD, so a pane too narrow for two thirds
    // of it to hold 80 characters is left whole (the operator met the older
    // floor as a defect in a split), and that the Terminal is NOT one of the
    // views this reaches -- it was one of them a release ago, and an operator
    // who watched a running screen re-wrap then needs to read that it will
    // not again.
    //
    // RE-AIMED, NOT LOOSENED. This asserted the word `tmux`, from the clause
    // "so tmux is never asked to re-wrap a running screen" -- which is the
    // REASON for the exception and went in the conciseness pass, into
    // `strings.ts`'s own comment beside the string. What the operator has to
    // be able to read is the exception itself, so that is what is asserted
    // now: the terminal, and what it does with its pane. Deleting that
    // sentence still reddens this; naming the plumbing again is no longer
    // required to keep it green.
    open();
    const row = toggle()?.closest('section, div')?.parentElement?.textContent?.toLowerCase() ?? '';
    expect(row).toContain('80 characters');
    expect(row).toMatch(/terminal[^.;—]*fills its pane/);
  });

  it('writes the choice, disturbing no neighbour', () => {
    const { onChange } = open({ ...EMPTY_PREFS, outFontSize: 15, theme: 'light' });
    fireEvent.click(toggle() as HTMLElement);
    const next = changed(onChange, 0);
    expect(next.narrowViews).toBe(true);
    expect(next.outFontSize).toBe(15);
    expect(next.theme).toBe('light');
  });

  it('writes it back', () => {
    const { onChange } = open({ ...EMPTY_PREFS, narrowViews: true });
    fireEvent.click(toggle() as HTMLElement);
    expect(changed(onChange, 0).narrowViews).toBe(false);
  });
});

const DECISION: Decision = {
  id: 'd1',
  label: 'step 1',
  input: 'ask',
  output: 'answered',
  commands: [],
};
const SESSION: Session = {
  id: 's1',
  title: 'atlas work',
  icon: null,
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '12m',
  decisions: [DECISION],
};
const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ENTRY: SessionEntry = { project: PROJECT, session: SESSION };

function panel(over: Partial<DetailPanelProps> = {}) {
  const props: DetailPanelProps = {
    entry: ENTRY,
    decision: DECISION,
    draft: '',
    onDraftChange: () => {},
    onSubmit: () => {},
    composing: false,
    onCompose: () => {},
    onStopComposing: () => {},
    active: false,
    actionIndex: 0,
    width: 408,
    resizeHandle: null,
    ...over,
  };
  render(<DetailPanel {...props} />);
}

describe('throwing the switch changes a pane, not only the store', () => {
  it('reaches a pane that is already mounted, with no reload and no prop', () => {
    // THE SEAM THIS EXISTS FOR. `Canvas.tsx` mounts one `DetailPanel` per
    // split leaf and `PhoneShell` mounts another; none of them is passed this
    // preference, and a pane opened by a keystroke has no dialogue in which it
    // could be asked. So the value has to travel `writePrefs` →
    // `activatePrefs` → the store → `useSyncExternalStore`, and a break
    // anywhere on that path is a setting that writes a field and changes
    // nothing.
    panel();
    const body = () => document.querySelector<HTMLElement>('[data-detail-body]');
    // The ruler gets the rectangle happy-dom will not lay out for it; the
    // measurement itself is `DetailPanel.view-width.test.tsx`'s subject, and
    // what is being asked here is only whether the flag reaches this pane.
    const ruler = document.querySelector<HTMLElement>('[data-prose-ruler]');
    const characters = (ruler?.textContent ?? '').length;
    if (ruler === null) throw new Error('the panel drew no prose ruler');
    ruler.getBoundingClientRect = () => ({ width: ADVANCE * characters, height: 16 }) as DOMRect;
    act(() => {
      for (const observer of OBSERVERS) observer();
    });
    expect(body()?.style.maxWidth).toBe('');

    act(() => {
      writePrefs(browserStorage(), { ...EMPTY_PREFS, narrowViews: true });
    });
    expect(body()?.style.maxWidth).toBe(narrowProseMaxWidth(ADVANCE));

    act(() => {
      writePrefs(browserStorage(), { ...EMPTY_PREFS, narrowViews: false });
    });
    expect(body()?.style.maxWidth).toBe('');
  });
});
