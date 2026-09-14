// @vitest-environment happy-dom

/**
 * CAN THE OPERATOR GET THE TEXT OUT OF THE ERROR LOG? Reported from use:
 * "the error log cannot copy text and cannot create an issue."
 *
 * There are four routes text can leave a panel by in this app, and the error
 * log has none of them:
 *
 *   1. DRAG-SELECT + Cmd-C. `src/renderer/styles.css` sets
 *      `body { user-select: none }` for the whole app and exactly one subtree
 *      opts back in (`select-text`, `DetailPanel.tsx`). `ErrorLogPanel` is
 *      mounted from `Canvas.tsx` as a sibling overlay, outside that subtree,
 *      so nothing in it is selectable. The computed-style proof is in
 *      `e2e/error-log-select.spec.ts`; this file pins the mechanism -- the
 *      class that would grant it -- so a regression is caught without a
 *      browser.
 *   2. THE `yy` KEY the stylesheet's own comment points at ("text meant to be
 *      copied is copied with `yy`"). `Canvas.tsx`'s keydown handler returns on
 *      every key but Escape while any overlay is open, so no chord reaches the
 *      canvas while this panel is up -- and `yy` copies a DECISION's commands
 *      in any case, never a logged event.
 *   3. A COPY CONTROL. There is none. The only button on a row is `Report`,
 *      and it copies the composed GitHub URL, not the message.
 *   4. READING IT OFF THE SCREEN and retyping. The message cell is
 *      `truncate` -- one line, clipped, with no `title` and no expansion --
 *      so for anything longer than the row the text is not even legible.
 *
 * Each test below names the route it is about.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErrorLogPanel } from '../../src/renderer/errors/ErrorLogPanel.js';
import { clearEvents, recordFailure } from '../../src/renderer/errors/log.js';

/**
 * A real one. This is what `src/main/sources/tmux/spawn.ts` produces when a
 * create fails, carried to the renderer by `preload/api.ts`'s `unwrap` and
 * recorded by `Canvas.tsx`'s `noteFailure('new session', cause)`.
 */
const LONG_MESSAGE =
  "tmux failed while creating session vam-acme-payroll-a1b2c3: can't create session: " +
  '/Users/opname/code/acme-payroll: No such file or directory';

beforeEach(() => {
  clearEvents();
});
afterEach(cleanup);

describe('getting the text out of the error log', () => {
  it('route 4 -- the whole message is reachable, not only a clipped line', () => {
    recordFailure('new session', { code: 'tmux-failed', message: LONG_MESSAGE });
    render(<ErrorLogPanel onClose={() => {}} />);
    const cell = screen.getByText(LONG_MESSAGE);
    // `truncate` is `overflow: hidden; text-overflow: ellipsis; white-space:
    // nowrap` -- the text is in the DOM and off the screen. Something has to
    // carry it: a `title`, or a row that wraps rather than clips.
    const carriesItOnHover = cell.getAttribute('title') === LONG_MESSAGE;
    const wraps = !cell.className.includes('truncate');
    expect(
      carriesItOnHover || wraps,
      'the failure message is clipped to one line with no title and no expansion',
    ).toBe(true);
  });

  it('route 3 -- a recorded failure offers a way to copy its own text', () => {
    recordFailure('send prompt', { code: 'session-running', message: LONG_MESSAGE });
    render(<ErrorLogPanel onClose={() => {}} />);
    // Deliberately broad: any control whose accessible name mentions copying
    // would satisfy this. `Report` does not -- it copies a github.com URL.
    const copy = screen.queryByRole('button', { name: /copy/i });
    expect(copy, 'no control copies the failure text itself').not.toBeNull();
  });

  it('route 1 -- the panel opts back into text selection', () => {
    recordFailure('send prompt', { code: 'session-running', message: LONG_MESSAGE });
    const { container } = render(<ErrorLogPanel onClose={() => {}} />);
    const dialog = container.querySelector('[data-error-log]');
    expect(dialog).not.toBeNull();
    // `body { user-select: none }` is global (styles.css). Tailwind's
    // `select-text` is the only opt-in the app uses, and nothing in this
    // subtree carries it -- so the operator cannot drag over a message, and
    // cannot drag over the fallback URL the panel prints when a copy fails
    // either.
    const selectable = dialog?.querySelector('.select-text') ?? null;
    const selfSelectable = dialog?.className.includes('select-text') ?? false;
    expect(
      selectable !== null || selfSelectable,
      'nothing in the error log re-enables user-select, so no text in it can be selected',
    ).toBe(true);
  });
});
