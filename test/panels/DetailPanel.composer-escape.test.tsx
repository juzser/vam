// @vitest-environment happy-dom

/**
 * ESCAPE LEAVES THE COMPOSER AGAIN; THE INTERRUPT MOVED TO `Mod-.`.
 *
 * THIS IS THE SECOND REVERSAL OF THIS KEY. It used to be vam's own way out of
 * the box. A prior change made it the interrupt instead — Claude Code's own
 * default, sent over `pressPaneKey`/`interruptRun` — which meant leaving the
 * box needed a key of its own (`Mod-[`). Asked "should Esc leave Insert, with
 * cancel-previous-prompt on a different key?", the operator chose exactly
 * that: Escape rejoins `Mod-[` as the way out, and the interrupt is `Mod-.`
 * now (`chords.ts`'s `interrupt` action, `Canvas.tsx`'s `case 'interrupt'`,
 * covered in `test/canvas/Canvas.interrupt.test.tsx`) — a GLOBAL chord that
 * reaches the focused session's pane whether or not this box holds the
 * keyboard, unlike a key this box could only ever answer while it did.
 *
 * `interruptRun` ITSELF IS UNCHANGED AND STILL TESTED — it is what the
 * bubble menu's "Cancel prompt" row calls (`DetailPanel.bubble-menu.test.tsx`
 * covers its three refusal outcomes in full); what moved is only which
 * keystroke reaches it from inside the composer, which is now none.
 *
 * WHAT THIS FILE HOLDS: that Escape and `Mod-[` are the SAME act (both leave,
 * neither sends anything to the pane), that the two typeahead lists and the
 * two popovers still take Escape before the box lets go of anything (Claude
 * Code's own rule survives the reversal even though nothing downstream of it
 * is an interrupt any more), and that the box claims only its own keys.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import {
  DEFAULT_PROMPT_SUBMIT_KEY,
  setActivePromptSubmitKey,
} from '../../src/renderer/prefs/submit-key.js';
import type { PaneSendResult } from '../../src/shared/terminal.js';

const COMMANDS = [{ id: 'c1', label: 'open the PR', command: 'gh pr create --fill' }];

const DECISION: Decision = {
  id: 'd9',
  label: 'sign-off',
  input: 'ship it',
  output: 'here is what to run',
  commands: COMMANDS,
};

const SLASH_COMMANDS = [
  { id: 'compact', name: 'compact', description: 'summarise the conversation so far' },
];

function sessionWith(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: 'Provider survey',
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 1,
    activity: null,
    age: '3m',
    decisions: [DECISION],
    slashCommands: SLASH_COMMANDS,
    vamControlled: true,
    ...over,
  };
}

function Harness({
  session,
  onStopComposing,
  over,
}: {
  readonly session: Session;
  readonly onStopComposing: () => void;
  readonly over?: Partial<DetailPanelProps>;
}) {
  const [draft, setDraft] = useState('');
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  const entry: SessionEntry = { project, session };
  return (
    <DetailPanel
      entry={entry}
      decision={DECISION}
      draft={draft}
      onDraftChange={setDraft}
      onSubmit={() => {}}
      composing={true}
      onCompose={() => {}}
      onStopComposing={onStopComposing}
      active={false}
      actionIndex={0}
      width={408}
      resizeHandle={null}
      {...over}
    />
  );
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const box = () => q('textarea[aria-label="prompt to session"]') as unknown as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

/** A bridge into a pane, typed as the real member is so calls can be read. */
function bridge(result: PaneSendResult = 'sent') {
  const send = vi.fn(async (): Promise<PaneSendResult> => result);
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { terminal: { send } },
  });
  return send;
}

function draw(over: Partial<Session> = {}, props: Partial<DetailPanelProps> = {}) {
  const stopped = vi.fn();
  render(<Harness session={sessionWith(over)} onStopComposing={stopped} over={props} />);
  return stopped;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'api');
  setActivePromptSubmitKey(DEFAULT_PROMPT_SUBMIT_KEY);
});

describe('Escape is the way out of the box again', () => {
  it('lets go of the keyboard and stops composing, sending nothing to the pane', async () => {
    const send = bridge();
    const stopped = draw();
    box().focus();
    expect(fireEvent.keyDown(box(), { key: 'Escape' })).toBe(false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(box());
    expect(send).not.toHaveBeenCalled();
  });

  it('claims the keystroke, so no shell-level handler also sees it', () => {
    bridge();
    draw();
    expect(fireEvent.keyDown(box(), { key: 'Escape' })).toBe(false);
  });

  it('leaves the draft exactly where it was — an exit is not a discard', () => {
    bridge();
    draw();
    box().focus();
    type('half a thought');
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(box().value).toBe('half a thought');
  });

  it('does not interrupt on the way out, for a session that would otherwise refuse loudly', () => {
    // A session vam did not start still lets the operator LEAVE the box —
    // only `interruptRun` (reached from the bubble menu, not from here any
    // more) has anything to refuse.
    const send = bridge();
    draw({ vamControlled: false });
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('the typeahead lists still answer Escape first', () => {
  it('closes the ! list without leaving the box', () => {
    const stopped = draw();
    type('!pr');
    expect(q('[data-bang-suggest]')).not.toBeNull();
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(q('[data-bang-suggest]')).toBeNull();
    expect(stopped).not.toHaveBeenCalled();
    // And the typed `!` is left exactly where it was.
    expect(box().value).toBe('!pr');
    // A SECOND Escape, with the list gone, is the way out.
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it('closes the / list without leaving the box', () => {
    const stopped = draw();
    type('/comp');
    expect(q('[data-slash-suggest]')).not.toBeNull();
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(q('[data-slash-suggest]')).toBeNull();
    expect(stopped).not.toHaveBeenCalled();
  });
});

/**
 * A DIALOG TAKES ESCAPE BEFORE THE BOX LETS GO OF ANYTHING.
 *
 * Claude Code's own rule survives the reversal even though nothing downstream
 * of it interrupts an agent any more: a popover opened from the tools row is
 * still a layer of its own, and Escape closing it rather than also leaving
 * the composer is the same "one Escape, one dismissal" rule every overlay in
 * this app keeps (`Canvas.tsx`'s own `cancel` case).
 */
describe('an open popover takes Escape before the box lets go', () => {
  it('closes the mode popover instead of leaving, from inside the box', () => {
    const stopped = draw();
    fireEvent.click(q('[data-mode-toggle]') as HTMLElement);
    expect(q('[data-mode-picker]')).not.toBeNull();
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(q('[data-mode-picker]')).toBeNull();
    expect(stopped).not.toHaveBeenCalled();
    // And with it closed, Escape is the way out again.
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it('closes the model menu instead of leaving, from inside the box', () => {
    const stopped = draw({ vamControlled: true }, { delivers: true, terminal: true });
    fireEvent.click(q('[data-model-picker]') as HTMLElement);
    expect(q('[data-model-picker-menu]')).not.toBeNull();
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(q('[data-model-picker-menu]')).toBeNull();
    expect(stopped).not.toHaveBeenCalled();
  });

  it('closes it from the toggle itself, where the pointer left the keyboard', () => {
    draw();
    const toggle = q('[data-mode-toggle]') as HTMLElement;
    fireEvent.click(toggle);
    expect(q('[data-mode-picker]')).not.toBeNull();
    expect(fireEvent.keyDown(toggle, { key: 'Escape' })).toBe(false);
    expect(q('[data-mode-picker]')).toBeNull();
  });

  it('closes it from an option row, where the keyboard walks to', () => {
    draw();
    fireEvent.click(q('[data-mode-toggle]') as HTMLElement);
    const option = q('[data-mode-option="plan"]') as HTMLElement;
    expect(option).not.toBeNull();
    fireEvent.keyDown(option, { key: 'Escape' });
    expect(q('[data-mode-picker]')).toBeNull();
  });

  it('does not swallow Escape when no popover is open, so leaving still works', () => {
    const stopped = draw();
    fireEvent.keyDown(q('[data-mode-toggle]') as HTMLElement, { key: 'Escape' });
    expect(q('[data-mode-picker]')).toBeNull();
    expect(stopped).not.toHaveBeenCalled();
  });
});

describe('Mod-[ answers the identical way out, unchanged', () => {
  it('lets go of the keyboard and stops composing', () => {
    const stopped = draw();
    box().focus();
    expect(fireEvent.keyDown(box(), { key: '[', code: 'BracketLeft', metaKey: true })).toBe(false);
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(box());
  });

  it('answers Ctrl+[ as well — Mod folds the two, and Ctrl+[ IS vim’s Escape', () => {
    const stopped = draw();
    box().focus();
    fireEvent.keyDown(box(), { key: '[', code: 'BracketLeft', ctrlKey: true });
    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it('leaves a bare [ to the draft', () => {
    const stopped = draw();
    expect(fireEvent.keyDown(box(), { key: '[', code: 'BracketLeft' })).toBe(true);
    expect(stopped).not.toHaveBeenCalled();
  });

  it('leaves Mod-Shift-[ alone, so stepping a tab does not drop the keyboard', () => {
    const stopped = draw();
    expect(
      fireEvent.keyDown(box(), {
        key: '{',
        code: 'BracketLeft',
        metaKey: true,
        shiftKey: true,
      }),
    ).toBe(true);
    expect(stopped).not.toHaveBeenCalled();
  });
});

/**
 * THE BOX CLAIMS ONLY ITS OWN KEYS -- the boundary between this handler and
 * the two that sit above it.
 *
 * Written when the half-page scroll (`Mod-d` / `Mod-u`, `isSelectOnly`) and
 * this composer's Escape/`Mod-[` work landed on the same keydown path from two
 * branches. Each was correct alone; what neither could see is whether the box
 * swallows a chord the other side is standing down for. `Mod-d` is
 * delete-forward in every macOS text view, so a box that claimed it would
 * break editing to serve a scroll gesture that deliberately refuses to run
 * here -- and the refusal would be invisible, because the canvas returns
 * BEFORE `preventDefault` and says nothing.
 */
describe('the box does not claim the chords that belong above or below it', () => {
  it('leaves Mod-d and Mod-u alone, so the textarea keeps its editing keys', () => {
    draw();
    for (const key of ['d', 'u']) {
      expect(fireEvent.keyDown(box(), { key, metaKey: true }), `Mod-${key}`).toBe(true);
      expect(fireEvent.keyDown(box(), { key, ctrlKey: true }), `Ctrl-${key}`).toBe(true);
    }
  });

  it('leaves Mod-0 alone, which is how the canvas chord gets out of the box', () => {
    // `focusList` is a CANVAS chord and reaches this box through the window
    // listener. Claiming it here would stop it dead -- the listener returns on
    // `event.defaultPrevented`.
    draw();
    expect(fireEvent.keyDown(box(), { key: '0', code: 'Digit0', metaKey: true })).toBe(true);
  });

  it('leaves Mod-. alone too — the interrupt is the window listener’s now', () => {
    // `case 'interrupt'` (`Canvas.tsx`) is what actually presses Escape into
    // the pane; this box must not claim the chord that reaches it or the
    // window listener never sees the keydown at all.
    draw();
    expect(fireEvent.keyDown(box(), { key: '.', metaKey: true })).toBe(true);
  });

  it('claims Mod-[ and Escape, which ARE its own', () => {
    draw();
    expect(fireEvent.keyDown(box(), { key: '[', code: 'BracketLeft', metaKey: true })).toBe(false);
    expect(fireEvent.keyDown(box(), { key: 'Escape' })).toBe(false);
  });
});

/**
 * THE KEYS THE BOX IS OPERATED WITH ARE NO LONGER PRINTED UNDER IT.
 *
 * Escape used to be the only way out of the composer, and the only place that
 * was written down was a caption saying `Esc → sidebar`. Both halves of that
 * went false, and the row that replaced it was then cut three more times by the
 * person who reads it on every prompt they type. The end state is asserted
 * once, structurally, in `DetailPanel.test.tsx` ("nothing is drawn beneath the
 * prompt input, on any route").
 */
describe('the composer names the keys that operate it', () => {
  it('still lets the box go on the key it never printed', () => {
    draw();
    expect(q('[data-prompt-keys]')).toBeNull();
    expect(fireEvent.keyDown(box(), { key: '[', code: 'BracketLeft', metaKey: true })).toBe(false);
  });

  it('draws nothing under the input on a phone either, where the row was unconditional', () => {
    draw({}, { phone: true, terminal: true });
    expect(q('[data-prompt-keys]')).toBeNull();
    // And the control that DOES interrupt on a phone is still on screen: it
    // was never reached from the box's own Escape to begin with.
    expect(q('[data-key-strip-key="escape"]')).not.toBeNull();
  });
});
