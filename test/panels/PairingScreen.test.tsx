// @vitest-environment happy-dom

/**
 * THE FIELD THE OPERATOR COULD NOT FIND.
 *
 * Operator, holding the phone: "I still don't see anywhere to enter the
 * pairing code." Reproduced by rendering the browser build against a 401
 * origin: it drew the server's refusal as a banner over an empty canvas, with
 * ZERO inputs on the page. The door had been opened and the room behind it was
 * empty.
 *
 * WHAT THIS SCREEN OWES:
 *   - a field, obviously, and one a phone keyboard cooperates with: eight
 *     characters from a thirty-glyph alphabet with no I, L, O, U, 0 or 1, so
 *     autocapitalise helps and autocorrect hurts;
 *   - a name for this device, because the operator approves it by name on the
 *     desktop and "an unnamed device" is a poor thing to say yes to;
 *   - the server's refusal, verbatim and unembellished. Every failure is the
 *     same 401 by design, so guessing "wrong code" would be inventing a
 *     distinction vam is deliberately not told;
 *   - it must not claim success it did not get.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PairingScreen } from '../../src/renderer/panels/PairingScreen.js';

afterEach(cleanup);

const code = () => screen.getByLabelText(/pairing code/i) as HTMLInputElement;
const name = () => screen.getByLabelText(/device name/i) as HTMLInputElement;
const submit = () => screen.getByRole('button', { name: /pair/i });

function draw(over: Partial<Parameters<typeof PairingScreen>[0]> = {}) {
  const onPaired = vi.fn();
  const pair = vi.fn(async () => 'a-token');
  render(<PairingScreen onPaired={onPaired} pair={pair} {...over} />);
  return { onPaired, pair };
}

describe('the screen a phone lands on', () => {
  it('draws a field for the code, which was the whole complaint', () => {
    draw();
    expect(code()).not.toBeNull();
  });

  /**
   * THE KEYBOARD IS PART OF THE CONTROL on a phone. The alphabet is upper-case
   * Crockford base32 minus the confusable glyphs, so autocorrect and
   * spellcheck have nothing useful to offer and plenty to break.
   */
  it('asks the phone keyboard for the right kind of input', () => {
    draw();
    expect(code().getAttribute('autocapitalize')).toBe('characters');
    expect(code().getAttribute('autocorrect')).toBe('off');
    expect(code().getAttribute('spellcheck')).toBe('false');
    expect(code().getAttribute('maxlength')).toBe('8');
  });

  it('offers a name for this device, because the desktop approves it by name', () => {
    draw();
    expect(name()).not.toBeNull();
  });

  it('sends what was typed, upper-cased, with the device name', async () => {
    const { pair } = draw();
    fireEvent.change(code(), { target: { value: 'abcd2345' } });
    fireEvent.change(name(), { target: { value: 'the bedside phone' } });
    fireEvent.click(submit());
    await waitFor(() => expect(pair).toHaveBeenCalledWith('ABCD2345', 'the bedside phone'));
  });

  it('hands the token up once the server grants one', async () => {
    const { onPaired } = draw();
    fireEvent.change(code(), { target: { value: 'ABCD2345' } });
    fireEvent.click(submit());
    await waitFor(() => expect(onPaired).toHaveBeenCalledWith('a-token'));
  });

  it('will not submit an empty code', () => {
    const { pair } = draw();
    fireEvent.click(submit());
    expect(pair).not.toHaveBeenCalled();
  });

  /**
   * THE DESKTOP SHOWS THE CODE GROUPED, `XXXX-XXXX` (`PairingPanel.tsx`'s own
   * `grouped`) -- "a group of four is what a person holds while looking
   * away." An operator copying that grouping by eye onto the phone's keyboard
   * types the hyphen too, and `maxLength={8}` used to let it steal one of the
   * eight real characters: typed in full, `ABCD-2345` arrived at the server
   * as `ABCD-234` -- seven real characters and a dash, never a valid code, on
   * a route the operator's own report says is rate-limited.
   */
  it('drops a hyphen typed the way the desktop groups the code, keeping every real character', () => {
    draw();
    fireEvent.change(code(), { target: { value: 'ABCD-2345' } });
    expect(code().value).toBe('ABCD2345');
  });

  /**
   * 16px OR IOS ZOOMS THE PAGE ON FOCUS AND DOES NOT CLEANLY UNDO IT --
   * `styles.css`'s own rule for `[data-phone-shell] input`. This screen
   * mounts BEFORE any shell exists (there is nothing paired yet to host one),
   * so that rule's selector never reaches it, and `text-body` (13px) fell
   * through the gap. Reachable from a desktop browser too, so this checks the
   * class rather than the device: the floor is unconditional, not a media
   * query.
   */
  it('keeps the device-name field at the 16px iOS will not zoom for', () => {
    draw();
    expect(name().className).toContain('text-[16px]');
  });
});

describe('when the server says no', () => {
  const refusing = () =>
    vi.fn(async () => {
      throw { kind: 'refused', code: 'unauthenticated', message: 'not paired: check the screen' };
    });

  it('shows the server’s own words, and invents no diagnosis of its own', async () => {
    const pair = refusing();
    draw({ pair: pair as never });
    fireEvent.change(code(), { target: { value: 'WRONG123' } });
    fireEvent.click(submit());

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not paired'));
    const said = screen.getByRole('alert').textContent ?? '';
    // Every refusal is the same 401 by design; the phone cannot know which it
    // was, so it must not say. These are the guesses it would be tempted into.
    expect(said.toLowerCase()).not.toContain('wrong code');
    expect(said.toLowerCase()).not.toContain('expired');
  });

  it('does not report a pairing that did not happen', async () => {
    const { onPaired } = draw({ pair: refusing() as never });
    fireEvent.change(code(), { target: { value: 'WRONG123' } });
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(onPaired).not.toHaveBeenCalled();
  });

  it('lets the operator try again — the code is short-lived, so a retry is normal', async () => {
    const pair = vi
      .fn<(code: string, name: string) => Promise<string>>()
      .mockRejectedValueOnce({ kind: 'refused', code: 'unauthenticated', message: 'no' })
      .mockResolvedValueOnce('a-token');
    const { onPaired } = draw({ pair: pair as never });

    fireEvent.change(code(), { target: { value: 'WRONG123' } });
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    fireEvent.change(code(), { target: { value: 'RIGHT234' } });
    fireEvent.click(submit());
    await waitFor(() => expect(onPaired).toHaveBeenCalledWith('a-token'));
  });
});
