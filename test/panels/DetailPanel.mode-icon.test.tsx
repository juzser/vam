// @vitest-environment happy-dom

/**
 * The mode control, moved into the prompt block and shrunk to one icon.
 *
 * The operator's request: the auto/manual switcher that sat in a row BELOW the
 * prompt input moves up beside the model field, and shows only the mode that
 * is current rather than three pills of which two are not.
 *
 * Two properties survive that move and are pinned here, because both are ones
 * this pane has lost before:
 *
 * ICON-ONLY IS NOT UNLABELLED. `ViewIcons` states the rule for this file — a
 * real `<button>`, in the tab order, whose `aria-label` carries the NAME. A
 * `title` is refused there: it never opens on keyboard focus and no screen
 * reader is required to read it. The icon must therefore say which mode it is
 * showing, in text, to something other than an eye.
 *
 * THE REFUSAL KEEPS A HOME. `data-mode-cycle` is the only channel that reports
 * what Shift+Tab did — sent, busy, or refused by tmux. Deleting the row it
 * lived in without re-homing it would turn every refusal into silence, which
 * is this repo's dominant defect, not a tidy-up.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import type { PaneSendResult } from '../../src/shared/terminal.js';

const DECISION: Decision = {
  id: 'd1',
  label: 'plan',
  input: 'ask',
  output: 'answered',
  commands: [],
};

const SESSION: Session = {
  id: 's1',
  title: 'Sprint board reorder',
  icon: null,
  epic: 'board',
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '12m',
  decisions: [DECISION],
  // vam started this pane, so a mode is really choosable here.
  vamControlled: true,
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ENTRY: SessionEntry = { project: PROJECT, session: SESSION };

function draw(over: Partial<DetailPanelProps> = {}) {
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

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const all = (selector: string) => [...document.querySelectorAll(selector)];
const toggle = () => q<HTMLButtonElement>('[data-mode-toggle]');

/** Shift+Tab in the prompt box, where the session's own chord is bound. */
async function pressCycle() {
  const box = q<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
  await act(async () => {
    fireEvent.keyDown(box, { key: 'Tab', shiftKey: true });
    await Promise.resolve();
  });
}

function withBridge(send: (...args: unknown[]) => Promise<PaneSendResult>) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { terminal: { send } },
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'api');
  cleanup();
});

describe('the mode control is one icon, in the prompt block', () => {
  it('sits in the same tools row as the model field, not in a row below the input', () => {
    draw();
    const tools = q<HTMLElement>('[data-prompt-tools]');
    expect(tools).not.toBeNull();
    expect(tools?.querySelector('[data-model-request]')).not.toBeNull();
    expect(tools?.querySelector('[data-mode-toggle]')).not.toBeNull();
    // The row it came from is gone, pills and all.
    expect(q('[data-mode-row]')).toBeNull();
    expect(q('[data-mode-pill]')).toBeNull();
  });

  it('shows the CURRENT mode only — one control, not three', () => {
    draw({ draft: 'mode: Plan\nship it' });
    expect(toggle()).not.toBeNull();
    expect(all('[data-mode-toggle]')).toHaveLength(1);
    // Nothing is drawn for the two modes that are not current until it is opened.
    expect(all('[data-mode-option]')).toHaveLength(0);
  });

  it('carries the current mode NAME in its accessible name, not only in a tooltip', () => {
    draw({ draft: 'mode: Manual\nship it' });
    expect(toggle()?.tagName).toBe('BUTTON');
    expect(toggle()?.getAttribute('aria-label')).toContain('Manual');
    // Auto is what a draft with no mode line reads as.
    cleanup();
    draw({ draft: 'ship it' });
    expect(toggle()?.getAttribute('aria-label')).toContain('Auto');
  });

  it('draws a different glyph per mode, so the icon is the state', () => {
    draw({ draft: 'ship it' });
    const auto = toggle()?.innerHTML ?? '';
    cleanup();
    draw({ draft: 'mode: Plan\nship it' });
    const plan = toggle()?.innerHTML ?? '';
    expect(auto).not.toBe('');
    expect(plan).not.toBe(auto);
  });

  it('opens a popover listing all three modes, the provider picker’s own pattern', () => {
    draw({ draft: 'mode: Manual\nship it' });
    expect(q('[data-mode-picker]')).toBeNull();
    act(() => toggle()?.click());
    expect(q('[data-mode-picker]')?.getAttribute('role')).toBe('listbox');
    expect(all('[data-mode-option]').map((el) => el.getAttribute('data-mode-option'))).toEqual([
      'auto',
      'manual',
      'plan',
    ]);
    expect(q('[data-mode-option="manual"]')?.getAttribute('aria-selected')).toBe('true');
    expect(q('[data-mode-option="auto"]')?.getAttribute('aria-selected')).toBe('false');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
  });

  it('writes the pick into the draft and closes, keeping the draft the only copy', () => {
    const seen: string[] = [];
    draw({ draft: 'ship it', onDraftChange: (next) => seen.push(next) });
    act(() => toggle()?.click());
    act(() => q<HTMLButtonElement>('[data-mode-option="plan"]')?.click());
    expect(seen).toEqual(['mode: Plan\nship it']);
    expect(q('[data-mode-picker]')).toBeNull();
  });

  it('clears the line for the default mode rather than writing "Auto"', () => {
    const seen: string[] = [];
    draw({ draft: 'mode: Plan\nship it', onDraftChange: (next) => seen.push(next) });
    act(() => toggle()?.click());
    act(() => q<HTMLButtonElement>('[data-mode-option="auto"]')?.click());
    expect(seen).toEqual(['ship it']);
  });

  it('is absent, not disabled, where no mode can be chosen', () => {
    draw({ entry: { project: PROJECT, session: { ...SESSION, vamControlled: false } } });
    expect(toggle()).toBeNull();
    expect(q('[data-mode-picker]')).toBeNull();
  });
});

describe('the cycle note keeps a home in the prompt block', () => {
  it('costs no width at rest, and says the chord in the icon’s own name', () => {
    draw();
    expect(q('[data-mode-cycle]')).toBeNull();
    expect(toggle()?.getAttribute('aria-label')).toContain('Tab');
  });

  it('draws the refusal in the tools row when the press did not land', async () => {
    withBridge(async () => 'refused');
    draw();
    await pressCycle();
    const said = q<HTMLElement>('[data-mode-cycle]');
    expect(said).not.toBeNull();
    expect(said?.getAttribute('data-mode-cycle-state')).toBe('refused');
    expect(said?.getAttribute('data-mode-refusal')).toBe('true');
    expect(said?.textContent).toContain('tmux');
    // In the prompt block, where the control now is -- not orphaned below it.
    expect(said?.closest('[data-prompt-tools]')).not.toBeNull();
  });

  it('draws the in-flight state before the pane has answered', async () => {
    let land: (result: PaneSendResult) => void = () => {};
    withBridge(
      () =>
        new Promise<PaneSendResult>((resolve) => {
          land = resolve;
        }),
    );
    draw();
    await pressCycle();
    expect(q<HTMLElement>('[data-mode-cycle]')?.getAttribute('data-mode-cycle-state')).toBe('busy');
    expect(q('[data-mode-refusal]')).toBeNull();
    await act(async () => {
      land('sent');
      await Promise.resolve();
    });
    expect(q<HTMLElement>('[data-mode-cycle]')?.getAttribute('data-mode-cycle-state')).toBe('sent');
  });
});
