// @vitest-environment happy-dom

/**
 * The two routes the error log grew, and the shape of each.
 *
 * `ErrorLogPanel.copy.test.tsx` and `report-route.test.tsx` are the tester's
 * measurements of the defects; this file is the contract of the fixes, and it
 * asserts the things those cannot: what is HANDED to main, and what is said
 * when an act does not work.
 *
 * WHAT IS HANDED TO MAIN is the load-bearing one. The whole reason there was
 * no route to github.com is a policy worth keeping -- this renderer may not
 * navigate off-origin, because a renderer that could reach github.com is a
 * renderer that could exfiltrate to it. The channel takes a TITLE and a BODY
 * and main builds the address (`src/main/issue/ipc.ts`), so a fix that passed
 * `report.url` over the bridge would be the capability the policy refuses,
 * wearing the new channel's name. That is what the second test measures.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorLogPanel } from '../../src/renderer/errors/ErrorLogPanel.js';
import { clearEvents, recordFailure, recordRefusal } from '../../src/renderer/errors/log.js';
import { composeReport } from '../../src/renderer/errors/report.js';

const MESSAGE = 'tmux failed while creating session vam-acme-payroll-a1b2c3: no server running';

type Bridge = {
  readonly issue?: { open: (title: string, body: string) => Promise<boolean> };
  readonly clipboard?: { writeText: (text: string) => Promise<boolean> };
};

function withBridge(api: Bridge): void {
  vi.stubGlobal('window', Object.assign(globalThis.window, { api }));
}

beforeEach(() => {
  clearEvents();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('opening the prefilled issue', () => {
  it('hands main the title and body — never a URL', async () => {
    const asked: Array<readonly [string, string]> = [];
    withBridge({
      issue: {
        open: async (title, body) => {
          asked.push([title, body]);
          return true;
        },
      },
      clipboard: { writeText: async () => true },
    });
    const event = recordFailure('new session', { code: 'tmux-failed', message: MESSAGE });
    render(<ErrorLogPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /report/i }));
    fireEvent.click(await screen.findByRole('button', { name: /open in browser/i }));

    const composed = composeReport(event);
    expect(asked).toEqual([[composed.title, composed.body]]);
    // THE NEGATIVE, spelled out: nothing that crossed the bridge was a
    // location. A `https://` in either field would mean the renderer had
    // named a destination after all.
    for (const field of asked.flat()) expect(field).not.toContain('https://');
  });

  it('says so when no browser opened, rather than claiming one did', async () => {
    withBridge({
      issue: { open: async () => false },
      clipboard: { writeText: async () => true },
    });
    recordFailure('new session', { code: 'tmux-failed', message: MESSAGE });
    render(<ErrorLogPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /report/i }));
    fireEvent.click(await screen.findByRole('button', { name: /open in browser/i }));
    expect(await screen.findByText(/no browser opened/i)).toBeTruthy();
  });

  /**
   * ABSENT, NOT DISABLED. The browser build has no bridge at all, and a
   * control drawn there could only apologise. The selectable URL is that
   * build's answer, which is why `select-text` had to land with this.
   */
  it('is not drawn at all where there is no bridge to open it', async () => {
    withBridge({ clipboard: { writeText: async () => true } });
    recordFailure('new session', { code: 'tmux-failed', message: MESSAGE });
    const { container } = render(<ErrorLogPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /report/i }));
    expect(await screen.findByTestId('report-preview')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /open in browser/i })).toBeNull();
    expect(container.querySelector('.select-text')).not.toBeNull();
  });
});

describe('copying one event', () => {
  it('copies the whole event, message included, and says it landed', async () => {
    const written: string[] = [];
    withBridge({
      clipboard: {
        writeText: async (text) => {
          written.push(text);
          return true;
        },
      },
    });
    recordFailure('new session', { code: 'tmux-failed', message: MESSAGE });
    render(<ErrorLogPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /copy this failure/i }));
    expect(await screen.findByText(/copied to the clipboard/i)).toBeTruthy();
    expect(written).toHaveLength(1);
    expect(written[0]).toContain(MESSAGE);
    expect(written[0]).toContain('tmux-failed');
    expect(written[0]).toContain('new session');
  });

  /**
   * THE DEFECT THIS REPO HAS SHIPPED BEFORE, in this exact shape: a floating
   * promise and the word "copied" one statement later, in a packaged app where
   * the write had already been refused. `panels/clipboard.ts` answers
   * truthfully; this asserts the panel repeats the answer rather than the hope.
   */
  it('says the clipboard refused when it did', async () => {
    withBridge({ clipboard: { writeText: async () => false } });
    recordFailure('new session', { code: 'tmux-failed', message: MESSAGE });
    render(<ErrorLogPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /copy this failure/i }));
    expect(await screen.findByText(/clipboard refused/i)).toBeTruthy();
  });

  /**
   * COPY IS OFFERED ON A REFUSAL, REPORT IS NOT. A "no" vam meant to say is
   * not a bug and must not become a public issue -- the panel's standing rule.
   * It is still text the operator may need to paste somewhere, which is a
   * different question, and both used to be answered "no".
   */
  it('offers copy on a refusal but still no report', () => {
    withBridge({ clipboard: { writeText: async () => true } });
    recordRefusal('new session', 'this source cannot start a session');
    render(<ErrorLogPanel onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /copy this refusal/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^report$/i })).toBeNull();
  });
});
