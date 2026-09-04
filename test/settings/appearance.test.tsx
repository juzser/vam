// @vitest-environment happy-dom

/**
 * The two operator-facing halves of this feature, at the surface the operator
 * touches: an Appearance section that can adjust colours, and a keyboard
 * reference that can be edited by pressing the key you want.
 *
 * The binding half is asserted end to end in the last block — a captured key
 * has to FIRE, not merely land in `prefs`, which is the difference between a
 * settings pane and a settings pane that lies.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import {
  EMPTY_PREFS,
  OUT_FONT_SIZE_MAX,
  OUT_FONT_SIZE_MIN,
  PALETTE_TOKENS,
  type Prefs,
} from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

function session(id: string): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

const MODEL: CanvasModel = {
  projects: [
    { id: 'p1', name: 'alpha', source: 'black-smith', sessions: [session('a1'), session('a2')] },
  ],
};

const FIRST = PALETTE_TOKENS[0] ?? { token: '', label: '' };
const BLUE = `#${'2f6feb'}`;

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
  document.documentElement.style.cssText = '';
});

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const view = render(<SettingsOverlay prefs={prefs} onChange={onChange} onClose={onClose} />);
  return { onChange, onClose, view };
}

/** The prefs one `onChange` call carried. A helper rather than an inline cast:
 *  a cast over an optional chain reads as a value that might not exist, and the
 *  assertion is the point — if the call is missing, say so. */
function changed(onChange: { mock: { calls: unknown[][] } }, index = 0): Prefs {
  const call = onChange.mock.calls[index];
  expect(call, `onChange was not called ${index + 1} time(s)`).toBeDefined();
  return (call ?? [])[0] as Prefs;
}

const slot = (id: string, index: number) =>
  document.querySelector<HTMLElement>(`[data-binding-slot="${id}:${index}"]`);
const capture = () => document.querySelector<HTMLInputElement>('[data-binding-capture]');
const message = () => document.querySelector('[data-binding-message]')?.textContent ?? '';

describe('the appearance section adjusts colours', () => {
  it('groups the visual settings under one heading', () => {
    open();
    const heading = screen.getByText('appearance');
    const section = heading.closest('section');
    expect(section?.textContent).toContain('dark');
    expect(section?.querySelectorAll('input[type="color"]').length).toBeGreaterThan(3);
  });

  it('writes the picked colour into prefs as an override', () => {
    const { onChange } = open();
    const input = screen.getByLabelText(`${FIRST.label} colour`);
    fireEvent.change(input, { target: { value: BLUE } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(changed(onChange, 0).palette[FIRST.token]).toBe(BLUE);
  });

  it('resets one colour by clearing the override, not by writing a value back', () => {
    const prefs: Prefs = { ...EMPTY_PREFS, palette: { [FIRST.token]: BLUE } };
    const { onChange } = open(prefs);
    fireEvent.click(screen.getByLabelText(`reset ${FIRST.label} colour`));
    const next = onChange.mock.calls[0]?.[0] as Prefs;
    expect(Object.hasOwn(next.palette, FIRST.token)).toBe(false);
  });

  it('offers no per-colour reset for a colour that was never overridden', () => {
    open();
    expect(screen.queryByLabelText(`reset ${FIRST.label} colour`)).toBeNull();
  });

  it('resets every colour at once', () => {
    const prefs: Prefs = { ...EMPTY_PREFS, palette: { [FIRST.token]: BLUE } };
    const { onChange } = open(prefs);
    fireEvent.click(screen.getByRole('button', { name: 'reset colours' }));
    expect(changed(onChange, 0).palette).toEqual({});
  });
});

describe('the override reaches the document', () => {
  it('puts the operator’s colour on the root, and reset takes it off again', () => {
    render(<Canvas model={MODEL} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', bubbles: true }));
    });
    fireEvent.change(screen.getByLabelText(`${FIRST.label} colour`), { target: { value: BLUE } });
    expect(document.documentElement.style.getPropertyValue(FIRST.token)).toBe(BLUE);
    fireEvent.click(screen.getByLabelText(`reset ${FIRST.label} colour`));
    expect(document.documentElement.style.getPropertyValue(FIRST.token)).toBe('');
  });
});

describe('a binding is edited by pressing the key', () => {
  it('turns a binding into a capture box and takes the next keypress', () => {
    const { onChange } = open();
    fireEvent.click(slot('rename', 0) as HTMLElement);
    const box = capture();
    expect(box).not.toBeNull();
    // `q`, not `p`: `p` used to be free and is now `revealProject` in the
    // chord table, so capturing it here would be refused as a conflict — which
    // is the capture box working, not this test's subject.
    const event = new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true });
    act(() => void box?.dispatchEvent(event));
    expect(event.defaultPrevented, 'the keystroke must not also reach the app').toBe(true);
    expect(changed(onChange, 0).keyBindings['rename']).toEqual(['q']);
  });

  it('cancels on Escape without binding anything and without closing the panel', () => {
    const { onChange, onClose } = open();
    fireEvent.click(slot('rename', 0) as HTMLElement);
    fireEvent.keyDown(capture() as HTMLElement, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(capture()).toBeNull();
  });

  /**
   * The same subject as the test above, driven the way an operator drives it.
   *
   * The isolated version passes against the bug for two reasons that both
   * disappear in a real window: it dispatches the keydown ON the box, so focus
   * is irrelevant, and it mounts the overlay alone, so `Canvas`'s window
   * listener does not exist. Armed and unfocused, the box was DEAF — every key
   * but Escape was swallowed by the overlay guard, and Escape closed settings.
   */
  it('arms the box with the keyboard in it, so the first Escape cancels and the second closes', () => {
    render(<Canvas model={MODEL} />);
    const press = (key: string) =>
      act(() => {
        (document.activeElement ?? window).dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        );
      });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', bubbles: true }));
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Keyboard' }));
    fireEvent.click(slot('rename', 0) as HTMLElement);

    // The whole bug in one assertion: without it the capture box is armed with
    // focus on <body>, outside React's root, where neither guard can run.
    expect(document.activeElement, 'the armed box must hold the keyboard').toBe(capture());

    press('Escape');
    expect(document.querySelector('[data-settings-overlay]')).not.toBeNull();
    expect(capture()).toBeNull();
    press('Escape');
    expect(document.querySelector('[data-settings-overlay]')).toBeNull();
  });

  it('takes a real keystroke at the armed box, dispatched where the keyboard is', () => {
    render(<Canvas model={MODEL} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', bubbles: true }));
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Keyboard' }));
    fireEvent.click(slot('rename', 0) as HTMLElement);
    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true }),
      );
    });
    expect(capture(), 'a captured key closes the box').toBeNull();
    expect(
      [...document.querySelectorAll('[data-settings-keys]')].map((el) => el.textContent),
    ).toContain('q');
  });

  /** `onBlur` on the capture box was dead code until it had focus to lose:
   *  clicking a second slot now fires blur before click, so the later
   *  `setCapturing` has to win. Exercised rather than reasoned about. */
  it('moves the armed box when a second slot is clicked', () => {
    open();
    fireEvent.click(slot('rename', 0) as HTMLElement);
    fireEvent.click(slot('icon', 0) as HTMLElement);
    expect(capture()).not.toBeNull();
    expect(slot('rename', 0)).not.toBeNull();
    expect(slot('icon', 0)).toBeNull();
  });

  it('refuses a reserved key and says which it was', () => {
    const { onChange } = open();
    fireEvent.click(slot('rename', 0) as HTMLElement);
    fireEvent.keyDown(capture() as HTMLElement, { key: 'g' });
    expect(onChange).not.toHaveBeenCalled();
    expect(message()).toContain('g');
  });

  it('refuses a conflicting key and names the action it collides with', () => {
    const { onChange } = open();
    fireEvent.click(slot('rename', 0) as HTMLElement);
    fireEvent.keyDown(capture() as HTMLElement, { key: 'i' });
    expect(onChange).not.toHaveBeenCalled();
    expect(message()).toContain('write a prompt to this session');
  });

  it('takes a second binding on the same action', () => {
    const prefs: Prefs = { ...EMPTY_PREFS, keyBindings: { rename: ['p'] } };
    const { onChange } = open(prefs);
    fireEvent.click(slot('rename', 1) as HTMLElement);
    fireEvent.keyDown(capture() as HTMLElement, { key: 'u' });
    expect(changed(onChange, 0).keyBindings['rename']).toEqual(['p', 'u']);
  });

  it('resets one action, and all of them', () => {
    const prefs: Prefs = { ...EMPTY_PREFS, keyBindings: { rename: ['p'], icon: ['q'] } };
    const { onChange } = open(prefs);
    fireEvent.click(document.querySelector('[data-binding-reset="rename"]') as HTMLElement);
    expect(changed(onChange, 0).keyBindings).toEqual({ icon: ['q'] });
    // The overlay opens on Appearance, and the three panels it is not showing
    // carry the HTML `hidden` attribute — which `getByRole` respects, unlike
    // the `querySelector` above. Navigating is what an operator does anyway.
    fireEvent.click(screen.getByRole('tab', { name: 'Keyboard' }));
    fireEvent.click(screen.getByRole('button', { name: 'reset shortcuts' }));
    expect(changed(onChange, 1).keyBindings).toEqual({});
  });

  it('says out loud that it is swallowing keys, and draws the ring while it is', () => {
    // An armed chip eats Ctrl-Tab and everything else for one keystroke. The
    // only thing that makes that state honest is the chip saying so, and the
    // focus ring being drawn rather than merely `focus-visible`.
    open();
    fireEvent.click(slot('rename', 0) as HTMLElement);
    const box = capture() as HTMLInputElement;
    expect(box.placeholder).toContain('Esc to cancel');
    expect(box.className).toContain('outline-ink');
    expect(box.className).not.toContain('focus-visible:outline-ink');
  });

  it('shows the operator’s binding in the reference, not the default', () => {
    open({ ...EMPTY_PREFS, keyBindings: { rename: ['p'] } });
    const printed = [...document.querySelectorAll('[data-settings-keys]')].map(
      (el) => el.textContent ?? '',
    );
    expect(printed).toContain('p');
    expect(printed).not.toContain('r');
  });
});

describe('the captured key is really in force', () => {
  it('fires the rebound chord after the panel is closed', () => {
    render(<Canvas model={MODEL} />);
    const press = (key: string) =>
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    press(',');
    fireEvent.click(slot('help', 0) as HTMLElement);
    fireEvent.keyDown(capture() as HTMLElement, { key: 'q' });
    press('Escape');
    expect(document.querySelector('[data-settings-overlay]')).toBeNull();
    press('?');
    expect(
      document.querySelector('[data-key-sheet]'),
      '? must no longer open the sheet',
    ).toBeNull();
    press('q');
    expect(document.querySelector('[data-key-sheet]')).not.toBeNull();
  });
});

/**
 * Where an `out` text size belongs: with the paint, alongside the theme and the
 * palette. It is not a canvas setting — `out` is the right pane, and layouts
 * that hide the canvas still draw it.
 *
 * This used to be asserted twice, the second time as "not in the same section
 * as focus zoom". Both that control and the Canvas section it lived in are
 * gone, so the second assertion has no subject left and is deleted rather than
 * pointed at a `querySelector` that now returns null and could not fail.
 */
describe('the out text size is an appearance setting', () => {
  const control = () => screen.getByLabelText('out text size');

  it('lives in Appearance, beside the theme and the colours', () => {
    open();
    expect(control().closest('section')?.querySelector('h2, h3')?.textContent).toBe('appearance');
  });

  it('shows the size in force and writes the one you pick', () => {
    const { onChange } = open({ ...EMPTY_PREFS, outFontSize: 15 });
    expect((control() as HTMLInputElement).value).toBe('15');
    fireEvent.change(control(), { target: { value: '18' } });
    expect(changed(onChange, 0).outFontSize).toBe(18);
    // And offers only sizes inside the readable bounds.
    expect(Number((control() as HTMLInputElement).min)).toBe(OUT_FONT_SIZE_MIN);
    expect(Number((control() as HTMLInputElement).max)).toBe(OUT_FONT_SIZE_MAX);
  });
});
