// @vitest-environment happy-dom

/**
 * THE PHONE'S WHOLE FIRST MINUTE, through the component that routes it.
 *
 * Operator: "I still don't see anywhere to enter the pairing code." Rendering
 * `BrowserCanvas` against a 401 origin reproduced it exactly -- the server's
 * refusal drawn as a failure banner over an empty canvas, and zero inputs on
 * the page. The refusal was being treated as "this source failed", which is
 * true and useless: `unauthenticated` is not a failure, it is the state every
 * new device starts in.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserCanvas } from '../../src/renderer/App.js';
import { SmithClient } from '../../src/renderer/adapter/client.js';
import { clearRemoteToken, readRemoteToken } from '../../src/renderer/sources/remote-token.js';

const REFUSAL = {
  ok: false,
  error: {
    kind: 'refused',
    code: 'unauthenticated',
    message: 'not paired: check the pairing screen on the desktop',
  },
};

const answer = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  cleanup();
  clearRemoteToken();
  vi.unstubAllGlobals();
});

const draw = () => render(<BrowserCanvas client={new SmithClient({ baseUrl: '' })} />);

describe('a browser the server has never seen', () => {
  it('offers the pairing screen instead of drawing the refusal as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer(REFUSAL, 401)),
    );
    draw();

    await waitFor(() => expect(screen.getByLabelText(/pairing code/i)).toBeTruthy());
    // The symptom, gone: the page has an input on it.
    expect(document.querySelectorAll('input').length).toBeGreaterThan(0);
  });

  it('keeps the token and comes back with the model once pairing succeeds', async () => {
    const fetch = vi.fn(async (url: unknown, init?: { method?: string }) => {
      const path = String(url);
      if (path.includes('/api/pair') && init?.method === 'POST') {
        return answer({ ok: true, value: { token: 'granted', deviceId: 'd', name: 'phone' } });
      }
      // Refused until a token exists; answered afterwards.
      if (readRemoteToken() === null) return answer(REFUSAL, 401);
      if (path.includes('/api/describe')) {
        return answer({
          ok: true,
          value: {
            id: 'claude-code',
            label: 'Claude Code',
            capabilities: {},
            declines: {},
          },
        });
      }
      return answer({ ok: true, value: [] });
    });
    vi.stubGlobal('fetch', fetch);
    draw();

    await waitFor(() => expect(screen.getByLabelText(/pairing code/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/pairing code/i), { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByRole('button', { name: /pair/i }));

    // THE TOKEN IS KEPT: the next visit must not ask again.
    await waitFor(() => expect(readRemoteToken()).toBe('granted'));
    // AND THE SCREEN GOES, because it has done its one job.
    await waitFor(() => expect(screen.queryByLabelText(/pairing code/i)).toBeNull());
  });

  /**
   * A REAL FAILURE IS STILL A FAILURE. Only `unauthenticated` means "this
   * device has not been allowed yet"; a source that answered and BROKE is
   * reported, because a refusal silently replaced by a pairing form would be
   * the swap `App.tsx` already refuses to make for the demo fixture.
   */
  it('does not offer pairing when the source failed for some other reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        answer({
          ok: false,
          error: { kind: 'unreachable', code: 'source-failed', message: 'the reader threw' },
        }),
      ),
    );
    draw();

    await waitFor(() => expect(document.body.textContent).toContain('the reader threw'));
    expect(screen.queryByLabelText(/pairing code/i)).toBeNull();
  });
});
