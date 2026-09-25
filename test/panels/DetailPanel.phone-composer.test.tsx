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

function propsFor(over: Partial<DetailPanelProps> = {}): DetailPanelProps {
  return {
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
}

function draw(over: Partial<DetailPanelProps> = {}) {
  return render(<DetailPanel {...propsFor(over)} />);
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

  it('keeps the textarea and the tools row as two real, separate flex rows', () => {
    draw({ phone: false, width: 700 });
    const box = q<HTMLElement>('[data-prompt-box]');
    const textareaRow = q<HTMLElement>('textarea[aria-label="prompt to session"]')?.parentElement;
    const toolsRow = q<HTMLElement>('[data-prompt-tools]');
    expect(box?.className).toContain('flex-col');
    expect(box?.className).not.toContain('flex-row');
    expect(textareaRow?.className).not.toContain('contents');
    expect(toolsRow?.className).not.toContain('contents');
  });
});

describe("AC-7's height half: the phone row is merged, not stacked (docs/design/phone-core-loop.md §4.1)", () => {
  /**
   * jsdom/happy-dom compute no real layout (`getBoundingClientRect` is
   * always 0), so the actual pixel height this section closes -- 145px down
   * to the real, measured figure -- is only provable in a browser
   * (`e2e/phone-question-shots.mjs`, wired into `run-web-guards.mjs` once
   * this shipped). What a unit test CAN pin is the shape that height change
   * depends on: one merged flex row rather than two stacked ones, in the
   * exact box each side must carry it in.
   */
  it('data-prompt-box becomes the merged row: flex-row, flex-wrap, no flex-col', () => {
    draw();
    const box = q<HTMLElement>('[data-prompt-box]');
    expect(box?.className).toContain('flex-row');
    expect(box?.className).toContain('flex-wrap');
    expect(box?.className).not.toContain('flex-col');
  });

  it('the textarea row and the tools row both disclaim their own box (display: contents), so their children join ONE row', () => {
    draw();
    const textareaRow = q<HTMLElement>('textarea[aria-label="prompt to session"]')?.parentElement;
    const toolsRow = q<HTMLElement>('[data-prompt-tools]');
    expect(textareaRow?.className).toBe('contents');
    expect(toolsRow?.className).toBe('contents');
  });

  it('the "+" is pulled to the front of the merged row (order-first), the textarea keeps growing (flex-1)', () => {
    draw();
    const plus = q<HTMLElement>('[data-popover-root="phone-overflow"]');
    const textarea = q<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');
    expect(plus?.className).toContain('order-first');
    expect(textarea?.className).toContain('flex-1');
  });

  /**
   * AC-7's stretch target, closed: `field-sizing: content` removed from the
   * phone box, so growth is now the SAME `scrollHeight` effect the desktop
   * box already had (`inputRef`'s own `useEffect`, below `pickImage` in
   * `DetailPanel.tsx`) -- see that effect's own comment for the real-browser
   * measurement this closes (docs/design/phone-core-loop.md §4.7's
   * postmortem, followed up).
   *
   * NOT ASSERTED HERE VIA A MOCKED `scrollHeight`: tried first, and it does
   * not distinguish the fix from its absence -- happy-dom does not implement
   * `field-sizing` at all, so the shared effect's OWN `style.height` write
   * reads back identically whether or not the class removed here is still
   * present in the className string. The one thing a unit test CAN still pin
   * is the className/attribute SHAPE; the actual pixel figure is only
   * provable in a browser (`e2e/phone-question-shots.mjs`, updated
   * alongside this).
   */
  it('grows by the shared scrollHeight effect, not field-sizing: content, and still caps at 132px', () => {
    draw();
    const textarea = q<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');
    expect(textarea?.className).not.toContain('field-sizing');
    expect(textarea?.className).toMatch(/max-h-\[132px\]/);
    expect(textarea?.getAttribute('rows')).toBe('1');
  });

  it('desktop never carried field-sizing either -- its own rows stay 2, untouched', () => {
    draw({ phone: false });
    const textarea = q<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');
    expect(textarea?.className).not.toContain('field-sizing');
    expect(textarea?.getAttribute('rows')).toBe('2');
  });

  it("the row's own second flex-1 spacer is hidden, so it cannot split growth with the textarea", () => {
    draw();
    // The spacer is the lone empty `<span>` directly inside `data-prompt-tools`.
    const spacer = [...(q<HTMLElement>('[data-prompt-tools]')?.children ?? [])].find(
      (el) => el.tagName === 'SPAN' && el.textContent === '' && el.children.length === 0,
    );
    expect(spacer?.className).toBe('hidden');
  });

  /**
   * THE PLACEHOLDER, SHRUNK WITH THE BOX. The desktop sentence ("Reply to
   * agent, answer with a number, or paste a plan…") wraps to three lines at
   * the merged row's own width and reads as cramped inside a box now pinned
   * to one line's height (`e2e/phone-shell.pw.ts`'s own hidden-probe
   * measurement proves the real-browser fit; jsdom/happy-dom lay nothing
   * out, so this only pins which STRING is on screen, not its wrap). Phone
   * gets its own, shorter copy; desktop's is untouched.
   */
  it('carries a short, phone-only placeholder -- not the desktop sentence', () => {
    draw();
    const textarea = q<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');
    expect(textarea?.placeholder).not.toContain('paste a plan');
    expect(textarea?.placeholder).toBe('Reply or answer 1–9');
  });

  it('desktop keeps its own, longer sentence, untouched', () => {
    draw({ phone: false });
    const textarea = q<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');
    expect(textarea?.placeholder).toBe('Reply to agent, answer with a number, or paste a plan…');
  });
});
