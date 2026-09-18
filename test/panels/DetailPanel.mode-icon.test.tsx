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

/**
 * WHICH MODE IS CURRENT, SAID TO AN EYE — the operator's two asks about this
 * control, which arrived together and are one property in two channels:
 *
 *   "the auto/manual mode switcher in the prompt input needs to show the
 *    current mode in the tooltip. And the icon needs to be filled with colour
 *    (for example auto is yellow)."
 *
 * THE GAP THEY NAME. The `aria-label` has carried `mode: <name>` since the row
 * became an icon, so a screen reader was told which mode is current and an eye
 * was not: the `Note` explained what the CONTROL DOES and never named the mode,
 * and the glyph was `text-ink-dim` in all three states. Shape was the only
 * channel, and shape is the one an operator has to already know the key for.
 *
 * WHAT IS ASSERTED HERE AND WHAT IS NOT. These are DOM facts — the tooltip's
 * text, the `fill` attribute, one colour class per mode. The PAINT is not
 * assertable in this environment at all: no stylesheet is loaded, so
 * `getComputedStyle` would report that the class was typed rather than what it
 * drew. `e2e/prompt-mode-icon-shots.mjs` reads the computed colour off the real
 * bundle and holds the three apart there, and `test/renderer/
 * token-contrast.test.ts` holds each hue to WCAG 1.4.11 against the chip it
 * sits in. This file holds the wiring those two measure.
 */
describe('the mode icon says WHICH mode, in the tooltip and in colour', () => {
  it('names the current mode in the tooltip, not only in the accessible name', () => {
    draw({ draft: 'ship it' });
    expect(toggle()?.getAttribute('data-note')).toContain('mode: Auto');
    cleanup();
    draw({ draft: 'mode: Manual\nship it' });
    expect(toggle()?.getAttribute('data-note')).toContain('mode: Manual');
    cleanup();
    draw({ draft: 'mode: Plan\nship it' });
    expect(toggle()?.getAttribute('data-note')).toContain('mode: Plan');
  });

  it('spends the tooltip on what the mode MEANS, since the colour has no legend', () => {
    // A hue is only a name once something says what it names. The three
    // sentences were already written as a comment over `MODE_ICON`, explaining
    // why each glyph was picked; the tooltip is where they become something the
    // operator can read.
    draw({ draft: 'ship it' });
    expect(toggle()?.getAttribute('data-note')).toContain('decides its own next step');
    cleanup();
    draw({ draft: 'mode: Manual\nship it' });
    expect(toggle()?.getAttribute('data-note')).toContain('a hand on each step');
    cleanup();
    draw({ draft: 'mode: Plan\nship it' });
    expect(toggle()?.getAttribute('data-note')).toContain('writes the list before it touches');
  });

  it('keeps the two mechanisms in the tooltip, which is what it was there for', () => {
    // The sentence it replaces explained why there are two ways to move a mode
    // at all: this control writes a line into the draft, and Shift+Tab presses
    // the session's own chord. Leading with the mode name must not cost that.
    draw({ draft: 'ship it' });
    const note = toggle()?.getAttribute('data-note') ?? '';
    expect(note).toContain('Shift+Tab');
    expect(note).toContain('recorded');
  });

  it('carries its mode as a fact a guard can read, on the glyph itself', () => {
    // The e2e guard reads the computed colour off THIS node. Without a name on
    // it the guard would have to find the svg by position, which is how a shot
    // comes to photograph the wrong element and still pass.
    for (const [draft, mode] of [
      ['ship it', 'auto'],
      ['mode: Manual\nship it', 'manual'],
      ['mode: Plan\nship it', 'plan'],
    ] as const) {
      cleanup();
      draw({ draft });
      expect(q('[data-mode-glyph]')?.getAttribute('data-mode-glyph')).toBe(mode);
    }
  });

  it('gives each mode its own colour, and no two of them the same one', () => {
    const inks = new Set<string>();
    for (const draft of ['ship it', 'mode: Manual\nship it', 'mode: Plan\nship it']) {
      cleanup();
      draw({ draft });
      const glyph = q('[data-mode-glyph]');
      const ink = [...(glyph?.classList ?? [])].filter((c) => c.startsWith('text-mode-'));
      expect(ink, 'exactly one mode ink on the glyph').toHaveLength(1);
      inks.add(ink[0] as string);
    }
    expect(inks.size, 'three modes, three inks').toBe(3);
    // And the grey it replaced is gone from the glyph: two inks on one node
    // would be decided by source order rather than by intent.
    expect(q('[data-mode-glyph]')?.classList.contains('text-ink-dim')).toBe(false);
  });

  it('fills only the glyph that survives being filled — measured, not assumed', () => {
    // SCREENSHOT, NOT REASONING. Rendered at the real 12px and at 64px on the
    // card this control sits on, `Sparkles` fills into a solid four-point star
    // and reads BETTER filled than stroked. `Hand` does not: its four paths are
    // open finger outlines, and filling each one closes it into a wedge — the
    // glyph becomes a fist, which is a different gesture, not a bolder hand.
    // `ListChecks` is three zero-area rules and two check polylines, so a fill
    // paints nothing at all at 12px and turns the ticks into solid arrowheads
    // above it. So two of the three take their colour on the STROKE, which is
    // the "colour it another way rather than ship a smudge" branch.
    draw({ draft: 'ship it' });
    expect(q('[data-mode-glyph]')?.getAttribute('fill')).toBe('currentColor');
    cleanup();
    draw({ draft: 'mode: Manual\nship it' });
    expect(q('[data-mode-glyph]')?.getAttribute('fill')).toBe('none');
    cleanup();
    draw({ draft: 'mode: Plan\nship it' });
    expect(q('[data-mode-glyph]')?.getAttribute('fill')).toBe('none');
  });

  it('draws each glyph ONE way — filled or stroked, never both', () => {
    // The operator: "in the mode switch in the prompt input, when the mode is
    // filled it should not have a stroke, or the icon looks too thick." It was
    // drawn both ways at once: `Sparkles` filled in `currentColor` AND stroked
    // at 1.7 ON TOP of that fill, which at 12px lays most of a pixel of extra
    // ink outside every edge of a shape that is already solid. So the star read
    // as a blob beside two hairline glyphs, and the fix is not a lighter stroke
    // but NO stroke — the two channels are exclusive now.
    //
    // ASSERTED AS THE INVARIANT, not as three literals. A test that pinned
    // `'0'`, `'2.2'`, `'2.2'` would go on passing through an edit that filled
    // `Hand` and left its stroke on, which is the same defect one glyph over.
    for (const draft of ['ship it', 'mode: Manual\nship it', 'mode: Plan\nship it']) {
      draw({ draft });
      const glyph = q('[data-mode-glyph]');
      const fill = glyph?.getAttribute('fill');
      const stroke = Number(glyph?.getAttribute('stroke-width'));
      if (fill === 'currentColor') {
        expect(stroke, `${draft}: a filled glyph carries no stroke`).toBe(0);
      } else {
        expect(fill, draft).toBe('none');
        expect(stroke, `${draft}: a stroked glyph owes the matched 2.2 weight`).toBe(2.2);
      }
      cleanup();
    }
  });

  it('colours the popover’s three options too, which is the only legend there is', () => {
    // The picker is the one place all three appear at once, so it is where an
    // operator learns which hue is which. A coloured toggle over a grey list
    // would teach nothing and would read as a fourth state.
    draw({ draft: 'mode: Manual\nship it' });
    act(() => toggle()?.click());
    const options = all('[data-mode-option] [data-mode-glyph]');
    expect(options).toHaveLength(3);
    expect(options.map((el) => el.getAttribute('data-mode-glyph'))).toEqual([
      'auto',
      'manual',
      'plan',
    ]);
    const inks = options.map(
      (el) => [...el.classList].filter((c) => c.startsWith('text-mode-'))[0] ?? '',
    );
    expect(new Set(inks).size, 'three options, three inks').toBe(3);
  });
});
