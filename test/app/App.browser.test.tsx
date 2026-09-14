// @vitest-environment happy-dom

/**
 * WHICH SERVER PUT THIS PAGE HERE.
 *
 * A browser has no preload, so the page asks its own origin for a descriptor.
 * vam's remote endpoint answers one and the canvas is that source; anything
 * else answers no route, and the page falls back to the factory feed it has
 * always rendered. A vam endpoint that answers and FAILS is reported rather
 * than quietly replaced -- a swapped data source is a canvas making a claim
 * nobody made.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionSource } from '../../src/renderer/sources/port.js';

vi.mock('../../src/renderer/canvas/Canvas.js', () => ({
  Canvas: ({ source }: { source?: { kind: string } }) => (
    <div data-testid="canvas" data-kind={source?.kind ?? 'none'} className="h-full" />
  ),
}));

// The factory feed's own fetching is not what is under test here, and a real
// one would reach for a port nothing in this suite is listening on.
vi.mock('../../src/renderer/adapter/useCanvas.js', () => ({
  useCanvas: () => ({ model: null, status: 'idle', error: null, refresh: () => {} }),
}));

const createSourceFromHttp = vi.fn();
vi.mock('../../src/renderer/sources/http-factory.js', () => ({
  createSourceFromHttp: () => createSourceFromHttp(),
}));

const { BrowserCanvas } = await import('../../src/renderer/App.js');
const { SmithClient } = await import('../../src/renderer/adapter/client.js');

const client = new SmithClient({ baseUrl: '' });

const remoteSource = {
  id: 'claude-code',
  label: 'Claude Code, over HTTP',
  capabilities: { recordPrompt: true },
  declines: {},
  viewerScope: { kind: 'connection', note: 'one operator' },
  load: async () => [],
} as unknown as SessionSource;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('a browser deciding what served it', () => {
  it('canvases the remote source when the origin answers a descriptor', async () => {
    createSourceFromHttp.mockResolvedValue(remoteSource);
    render(<BrowserCanvas client={client} />);
    await waitFor(() => expect(screen.getByTestId('canvas').dataset.kind).toBe('session'));
  });

  it('falls back to the factory feed when there is no vam endpoint here', async () => {
    createSourceFromHttp.mockRejectedValue({
      kind: 'unreachable',
      code: 'no-such-route',
      message: '/api/describe',
    });
    render(<BrowserCanvas client={client} />);
    await waitFor(() => expect(screen.getByTestId('canvas').dataset.kind).toBe('live'));
  });

  /**
   * THE EXAMPLE CHANGED, THE PROPERTY DID NOT. This case used `unauthenticated`
   * as its refusal, and that code now means something specific: "this device
   * has not been allowed yet", which is the state every new phone starts in
   * and is answered with the pairing screen rather than with a failure banner
   * (see the case below). Any OTHER refusal is still reported, which is what
   * this has always been about -- a refusal must not be swapped for the
   * factory feed.
   */
  it('reports a remote endpoint that answered and refused, rather than swapping sources', async () => {
    createSourceFromHttp.mockRejectedValue({
      kind: 'refused',
      code: 'read-only',
      message: 'this server was started read-only',
    });
    render(<BrowserCanvas client={client} />);
    await waitFor(() =>
      expect(screen.getByTestId('source-failure').textContent).toMatch(/read-only/),
    );
    // NO SOURCE WAS SWAPPED IN, which is what this asserts and what it read
    // as `'none'` while a sourceless canvas was passed nothing at all. It is
    // now passed `'connecting'` carrying the same failure -- still no session
    // source and still not the factory feed, but a source cell that says the
    // endpoint refused instead of a green dot or an amber read-only note.
    const kind = screen.getByTestId('canvas').dataset.kind;
    expect(kind).not.toBe('session');
    expect(kind).not.toBe('live');
    expect(kind).toBe('connecting');
  });

  /**
   * AND THE ONE REFUSAL THAT IS NOT A FAILURE. `unauthenticated` is where every
   * device that has never paired begins. Drawing it as a banner is what left
   * the operator holding a phone that read "check the pairing screen on the
   * desktop" with nothing on it to act on.
   */
  it('offers pairing for the one refusal that means "not allowed yet"', async () => {
    createSourceFromHttp.mockRejectedValue({
      kind: 'refused',
      code: 'unauthenticated',
      message: 'not paired: check the pairing screen on the desktop',
    });
    render(<BrowserCanvas client={client} />);
    await waitFor(() => expect(screen.getByLabelText(/pairing code/i)).toBeTruthy());
    expect(screen.queryByTestId('source-failure')).toBeNull();
  });
});
