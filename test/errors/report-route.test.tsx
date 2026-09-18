// @vitest-environment happy-dom

/**
 * "CANNOT CREATE AN ISSUE." Reported from use, and it is three separate
 * questions that were worth telling apart.
 *
 *   1. IS THE CONTROL REACHABLE for the failures the operator actually hits?
 *      `ErrorLogPanel` draws `Report` only for `kind === 'failure'`, and the
 *      first test below pins that the two paths in the complaint -- creating a
 *      session and sending a prompt -- do land there. They do: `Canvas.tsx`
 *      routes both through `noteFailure`, which always records a `'failure'`,
 *      whatever `SourceError.kind` the source said. This test exists to keep
 *      it that way, not because it is broken.
 *
 *   2. CAN THE OPERATOR GET TO GITHUB? Nothing in this app opens the composed
 *      URL. `report.ts` copies it and says why (`window.open` is denied, every
 *      off-origin navigation is denied) -- but main already owns
 *      `shell.openExternal` and two other panels use it through the bridge
 *      (`src/main/update/ipc.ts`, `src/main/remote/ipc.ts`), so "the renderer
 *      may not navigate" does not imply "the operator may not be taken
 *      there". The second test is about the case that makes it a dead end
 *      rather than an inconvenience: WHEN THE COPY FAILS. `copyText` answers
 *      `false` honestly, the panel then says "the URL is below" -- and the URL
 *      below cannot be selected (`ErrorLogPanel.copy.test.tsx`, route 1) and
 *      cannot be opened. There is no fourth route.
 *
 *   3. WOULD A LONG BODY BREAK THE URL? The third test measures it rather
 *      than asserting a guess; see its own comment.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorLogPanel } from '../../src/renderer/errors/ErrorLogPanel.js';
import { clearEvents, noteFailure, recordFailure } from '../../src/renderer/errors/log.js';
import { composeReport, NEW_ISSUE_URL } from '../../src/renderer/errors/report.js';

/** What `preload/api.ts`'s `unwrap` throws: main's `SourceError`, structured-cloned. */
const TMUX_FAILED = {
  kind: 'refused',
  code: 'tmux-failed',
  message: 'tmux failed while creating session vam-acme-payroll-a1b2c3: no server running',
};
const SESSION_RUNNING = {
  kind: 'refused',
  code: 'session-running',
  message:
    'session 9f1c2a84-3b7e-4d21-9c5a-6e0b8d7f1234 is running, so Claude Code will not resume it here.',
};

/** A clipboard bridge that refuses, which is the case the fallback is for. */
function refusingClipboard(): void {
  vi.stubGlobal(
    'window',
    Object.assign(globalThis.window, { api: { clipboard: { writeText: async () => false } } }),
  );
}

beforeEach(() => {
  clearEvents();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('reaching github from a recorded failure', () => {
  it('offers Report for the create-session and send-prompt failures (refutes "unreachable")', () => {
    // The exact call `Canvas.tsx` makes on each path.
    noteFailure('new session', TMUX_FAILED);
    noteFailure('send prompt', SESSION_RUNNING);
    render(<ErrorLogPanel onClose={() => {}} />);
    expect(screen.getAllByRole('button', { name: /report/i })).toHaveLength(2);
  });

  it('leaves a route to the issue page when the copy is refused', async () => {
    refusingClipboard();
    noteFailure('new session', TMUX_FAILED);
    const { container } = render(<ErrorLogPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /report/i }));
    // The panel's own fallback wording, so this test fails for the right
    // reason if the copy ever starts succeeding here. It read `copy failed`
    // when this was written; the panel says which side refused now, and what
    // the two remaining routes are -- the wording changed WITH the routes,
    // which is the point rather than a rename.
    expect(await screen.findByText(/clipboard refused/i)).toBeTruthy();
    // Any of the three would do: an anchor, a control that asks main to open
    // it, or a selectable element holding the URL.
    const anchor = container.querySelector(`a[href^="${NEW_ISSUE_URL}"]`);
    const opener = screen.queryByRole('button', { name: /open|github|browser/i });
    const selectableUrl = container.querySelector('.select-text');
    expect(
      anchor !== null || opener !== null || selectableUrl !== null,
      'the copy was refused, so the prefilled URL is on screen as unselectable text with nothing that can open it',
    ).toBe(true);
  });

  it('keeps the prefilled URL under the length a server will accept', () => {
    // 8192 bytes is the request-line limit GitHub's front end enforces; over
    // it the browser is answered 414 rather than shown the form, which from
    // the operator's side is "cannot create an issue" again. The longest
    // message vam can actually produce on this path is a `cli-failed`, whose
    // stderr is clipped to 600 characters by `deliver.ts`/`spawn.ts` --
    // deliberately bounded, and this is the test that says the bound is the
    // one that matters.
    const worst = recordFailure('send prompt', {
      code: 'cli-failed',
      message: `delivering to session 9f1c2a84-3b7e-4d21-9c5a-6e0b8d7f1234 failed: ${'x'.repeat(600)}...`,
    });
    expect(composeReport(worst).url.length).toBeLessThan(8192);
  });
});
