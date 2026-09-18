// @vitest-environment happy-dom

/**
 * THE ROW THAT ASKS THE AGENT FOR A SHORTER ANSWER, at the surface the
 * operator touches.
 *
 * Operator, translated: "turn this ADHD skill into a setting that can be
 * toggled on and off in vam, so the output the agent returns is easier to
 * understand and more concise. Put it next to the focus view setting."
 *
 * WHAT THIS FILE CAN AND CANNOT HOLD. It can hold that the control exists,
 * where it sits, what it writes, and -- the part that matters most for a row
 * like this -- WHAT IT TELLS THE OPERATOR BEFORE THEY THROW IT. It cannot hold
 * that anything is typed into a pane: that is main's, and
 * `test/sources/claude-code-reply-concise.test.ts` asserts the real argv.
 *
 * THE NOTE IS NOT DECORATION. This switch makes vam put a paragraph of its own
 * words into the operator's next prompt, in their own transcript, at their own
 * token cost, and it cannot be un-said afterwards. Every one of those facts is
 * asserted to be ON SCREEN, because a disclosure kept only in a source comment
 * is a disclosure the person consenting cannot read.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

beforeAll(() => {
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
});

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={vi.fn()} />);
  return { onChange };
}

const toggle = () => document.querySelector<HTMLElement>('[data-switch="concise-output"]');
const note = () =>
  document.querySelector<HTMLElement>('[data-concise-output-note]')?.textContent ?? '';

function changed(onChange: { mock: { calls: unknown[][] } }, index = 0): Prefs {
  const call = onChange.mock.calls[index];
  expect(call, `onChange was not called ${index + 1} time(s)`).toBeDefined();
  return (call ?? [])[0] as Prefs;
}

describe('the control', () => {
  it('is a switch in the Behaviour panel, next to focus view', () => {
    // NEXT TO, and the operator meant it literally: the two rows are the pair
    // that decides how much the operator has to read. Asserted as ADJACENCY
    // between the row boxes rather than "both are in the panel" -- the second
    // passes with a colour grid between them.
    open();
    const rows = [
      ...(document.querySelectorAll('[data-settings-panel="behaviour"] [data-settings-rows] > *') ??
        []),
    ];
    const focus = rows.findIndex((row) => row.querySelector('[data-switch="focus-view"]') !== null);
    const concise = rows.findIndex(
      (row) => row.querySelector('[data-switch="concise-output"]') !== null,
    );
    expect(focus, 'focus view is in the behaviour panel').toBeGreaterThanOrEqual(0);
    expect(concise).toBe(focus + 1);
  });

  it('is a switch, named for what it controls, and says which way it is thrown', () => {
    open();
    expect(toggle()?.getAttribute('role')).toBe('switch');
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
    expect(toggle()?.textContent).toBe('off');
    const off = toggle()?.getAttribute('aria-label') ?? '';
    cleanup();
    open({ ...EMPTY_PREFS, conciseOutput: true });
    // The accessible name may not flip with the value, or the control is a
    // different control on every press.
    expect(toggle()?.getAttribute('aria-label')).toBe(off);
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
    expect(toggle()?.textContent).toBe('on');
  });

  it('writes the choice, disturbing no neighbour', () => {
    const { onChange } = open({ ...EMPTY_PREFS, focusView: true, outFontSize: 15 });
    fireEvent.click(toggle() as HTMLElement);
    const next = changed(onChange, 0);
    expect(next.conciseOutput).toBe(true);
    expect(next.focusView).toBe(true);
    expect(next.outFontSize).toBe(15);
  });

  it('writes it back off', () => {
    const { onChange } = open({ ...EMPTY_PREFS, conciseOutput: true });
    fireEvent.click(toggle() as HTMLElement);
    expect(changed(onChange, 0).conciseOutput).toBe(false);
  });
});

describe('what the operator is told before they throw it', () => {
  it('says vam ASKS rather than rewrites, so nobody reads it as a summariser', () => {
    // THE MISREADING THIS ROW INVITES, and the one vam must never allow: that
    // it shortens what is drawn. vam has no model and never touches a turn.
    open();
    const said =
      `${note()} ${document.querySelector('[data-settings-panel="behaviour"]')?.textContent ?? ''}`.toLowerCase();
    // BOTH HALVES. "ask" alone would be satisfied by a row that also implied
    // vam trims the answer afterwards; the denial is what rules that out.
    expect(said).toMatch(/\bask/);
    expect(said).toMatch(/rewrite/);
  });

  it('says the words appear in the transcript, because they will', () => {
    // The rules are TYPED INTO THE PANE, so they are part of the operator's own
    // turn and there is no hiding them. Telling them first is the difference
    // between a design decision and a surprise.
    expect(open() && note().toLowerCase()).toMatch(/transcript|prompt/);
  });

  it('says it rides the first prompt to a session, not every prompt', () => {
    open();
    expect(note().toLowerCase()).toMatch(/first/);
  });

  it('names the limit vam cannot see, and the way round it', () => {
    // A `/clear` or a compaction empties the agent's context and NOTHING tells
    // vam. The honest row says so and names the only remedy there is --
    // turning the switch off and on again.
    open();
    expect(note().toLowerCase()).toMatch(/\/clear|compact|forget/);
    expect(note().toLowerCase()).toMatch(/off and on|again/);
  });

  it('says what turning it off does not do', () => {
    // It cannot un-say an instruction an agent has already read. A row that
    // left that out would promise a reversal vam cannot perform.
    open();
    expect(note().toLowerCase()).toMatch(/already|cannot|does not/);
  });
});
