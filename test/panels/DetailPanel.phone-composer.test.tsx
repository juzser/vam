// @vitest-environment happy-dom

/**
 * The phone composer diet (docs/design/phone-core-loop.md §3.4, spec step 1).
 *
 * Operator: "the phone composer should be ≤108px and carry ≤4 controls;
 * model/mode pickers leave it, reachable from an overflow; attach folds
 * behind one '+'." This file pins the SHAPE of that: on phone, the model
 * picker, mode picker, provider picker, and the two attach buttons are gone
 * from the tools row; a single "+" (`data-composer-overflow`) opens a sheet
 * that reaches every one of them through the SAME state/handlers the
 * desktop's own resident controls already use (`setOpenPopover`,
 * `fileRef.current?.click()`, `pickImage()`) -- nothing here is a new write
 * path, only a new way to reach an old one. Desktop (`phone` unset) is
 * asserted unchanged at the end of the file.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

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
  epic: null,
  branch: null,
  status: 'idle',
  runningAgents: 0,
  activity: null,
  age: '12m',
  decisions: [DECISION],
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
    width: 390,
    resizeHandle: null,
    phone: true,
    delivers: true,
    terminal: true,
    pickImageAttachment: async () => null,
    onSetDefaultProvider: () => {},
    ...over,
  };
  render(<DetailPanel {...props} />);
}

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const all = (selector: string) => [...document.querySelectorAll(selector)];
const tools = () => q('[data-prompt-tools]');
const overflowButton = () => q<HTMLButtonElement>('[data-composer-overflow]');
const openOverflow = () => {
  act(() => overflowButton()?.click());
};

afterEach(() => {
  cleanup();
});

describe('the phone composer row', () => {
  it('draws no resident attach, provider, model or mode control', () => {
    draw();
    expect(q('[data-attach]')).toBeNull();
    expect(q('[data-attach-image]')).toBeNull();
    expect(q('[data-provider-picker-toggle]')).toBeNull();
    expect(q('[data-model-picker]')).toBeNull();
    expect(q('[data-mode-toggle]')).toBeNull();
  });

  it('draws exactly the four controls AC-7 names: textarea, "+", mic, Send', () => {
    draw();
    expect(q('textarea[aria-label="prompt to session"]')).not.toBeNull();
    expect(q('[data-composer-overflow]')).not.toBeNull();
    expect(q('[data-prompt-record]')).not.toBeNull();
    // Every OTHER button left in the tools row is the mic -- nothing else.
    const row = tools();
    const buttons = row === null ? [] : [...row.querySelectorAll('button')];
    const unexpected = buttons.filter(
      (b) =>
        !b.hasAttribute('data-composer-overflow') &&
        !b.hasAttribute('data-prompt-dictate') &&
        !b.hasAttribute('data-prompt-suggestion-use') &&
        !b.hasAttribute('data-prompt-record'),
    );
    expect(unexpected).toHaveLength(0);
  });

  it('the "+" is a single control that opens a menu on tap', () => {
    draw();
    expect(q('[data-composer-overflow-menu]')).toBeNull();
    openOverflow();
    expect(q('[data-composer-overflow-menu]')).not.toBeNull();
    expect(overflowButton()?.getAttribute('aria-expanded')).toBe('true');
  });

  it('the "+" and its menu items each clear the 44px floor via vam-tap', () => {
    draw();
    expect(overflowButton()?.className).toContain('vam-tap');
    openOverflow();
    for (const item of all('[data-composer-overflow-menu] button')) {
      expect(item.className).toContain('vam-tap');
    }
  });

  it('the overflow attach row calls the SAME file input the desktop button clicks', () => {
    draw();
    const input = q<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const clicked: boolean[] = [];
    if (input !== null) input.addEventListener('click', () => clicked.push(true));
    openOverflow();
    act(() => q<HTMLButtonElement>('[data-composer-overflow-attach]')?.click());
    expect(clicked).toHaveLength(1);
    // The menu closes behind the action, like any menu item.
    expect(q('[data-composer-overflow-menu]')).toBeNull();
  });

  it('the overflow attach-image row calls pickImageAttachment for this session', async () => {
    const asked: string[] = [];
    draw({
      pickImageAttachment: async (sessionId) => {
        asked.push(sessionId);
        return null;
      },
    });
    openOverflow();
    await act(async () => {
      q<HTMLButtonElement>('[data-composer-overflow-attach-image]')?.click();
      await Promise.resolve();
    });
    expect(asked).toEqual(['s1']);
  });

  it('the overflow model row opens the SAME listbox the desktop picker opens', () => {
    draw();
    openOverflow();
    expect(q('[data-model-picker-menu]')).toBeNull();
    act(() => q<HTMLButtonElement>('[data-composer-overflow-model]')?.click());
    // Drill-down: asking for the model listbox closes the overflow sheet,
    // since both live in the one-slot `openPopover` state.
    expect(q('[data-composer-overflow-menu]')).toBeNull();
    expect(q('[data-model-picker-menu]')).not.toBeNull();
  });

  it('the overflow mode row opens the SAME listbox the desktop chip opens', () => {
    draw();
    openOverflow();
    act(() => q<HTMLButtonElement>('[data-composer-overflow-mode]')?.click());
    expect(q('[data-composer-overflow-menu]')).toBeNull();
    expect(q('[data-mode-picker]')).not.toBeNull();
  });

  it('the overflow provider row opens the SAME listbox the desktop toggle opens', () => {
    draw();
    openOverflow();
    act(() => q<HTMLButtonElement>('[data-composer-overflow-provider]')?.click());
    expect(q('[data-composer-overflow-menu]')).toBeNull();
    expect(q('[data-provider-picker]')).not.toBeNull();
  });

  it('a disabled model (no pane vam owns) draws an informational row, not a control', () => {
    draw({
      entry: { project: PROJECT, session: { ...SESSION, vamControlled: false } },
    });
    openOverflow();
    expect(q('[data-composer-overflow-model]')?.tagName).toBe('DIV');
    expect(q('button[data-composer-overflow-model]')).toBeNull();
  });

  it('a record-only source (no delivers) gets an inline model field in the sheet', () => {
    let draft = 'redo it';
    draw({
      delivers: undefined,
      draft,
      onDraftChange: (next) => {
        draft = next;
      },
    });
    openOverflow();
    const field = q<HTMLInputElement>(
      '[data-composer-overflow-model-request] [data-model-request]',
    );
    expect(field).not.toBeNull();
    if (field !== null) fireEvent.change(field, { target: { value: 'opus' } });
    expect(draft).toBe('model: opus\nredo it');
  });
});

describe('the desktop composer row is unchanged', () => {
  it('still draws the resident attach, provider, model and mode controls, and no "+"', () => {
    draw({ phone: false, width: 700 });
    expect(q('[data-attach]')).not.toBeNull();
    expect(q('[data-provider-picker-toggle]')).not.toBeNull();
    expect(q('[data-model-picker]')).not.toBeNull();
    expect(q('[data-mode-toggle]')).not.toBeNull();
    expect(q('[data-composer-overflow]')).toBeNull();
  });
});
