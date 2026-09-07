// @vitest-environment happy-dom

/**
 * `DesktopCanvas` wires `bridgeMainErrors` (`src/renderer/errors/main-errors-bridge.ts`)
 * to `window.api.mainErrors`, so a main-process failure recorded before this
 * component ever mounted still reaches the operator's own error log once it
 * does.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopSourceApi } from '../../src/preload/api.js';
import { clearEvents, loggedEvents } from '../../src/renderer/errors/log.js';

vi.mock('../../src/renderer/canvas/Canvas.js', () => ({
  Canvas: () => <div data-test-canvas />,
}));

const { DesktopCanvas } = await import('../../src/renderer/App.js');

afterEach(() => {
  cleanup();
  clearEvents();
});

const quietApi = { describe: () => new Promise(() => {}) } as unknown as DesktopSourceApi;

describe('DesktopCanvas and main-process failures', () => {
  it('feeds a backlog recorded before mount into the error log once mounted', async () => {
    const mainErrors = {
      list: () =>
        Promise.resolve([
          {
            id: 1,
            at: '2024-01-01T00:00:00.000Z',
            action: 'start the remote endpoint',
            code: 'remote-port-in-use',
            message: 'port 58217 is taken',
          },
        ]),
      subscribe: () => () => {},
    };

    render(<DesktopCanvas api={quietApi} mainErrors={mainErrors} />);
    await Promise.resolve();
    await Promise.resolve();

    expect(loggedEvents().map((event) => event.message)).toContain('port 58217 is taken');
  });

  it('does nothing when mainErrors is absent -- the browser build has no bridge at all', () => {
    expect(() => render(<DesktopCanvas api={quietApi} />)).not.toThrow();
    expect(loggedEvents()).toHaveLength(0);
  });
});
