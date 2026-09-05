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

  it('reports a remote endpoint that answered and refused, rather than swapping sources', async () => {
    createSourceFromHttp.mockRejectedValue({
      kind: 'refused',
      code: 'unauthenticated',
      message: 'no Access assertion on this request',
    });
    render(<BrowserCanvas client={client} />);
    await waitFor(() =>
      expect(screen.getByTestId('source-failure').textContent).toMatch(/unauthenticated/),
    );
    expect(screen.getByTestId('canvas').dataset.kind).toBe('none');
  });
});
