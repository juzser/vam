// @vitest-environment happy-dom

/**
 * What a browser is told about the terminal.
 *
 * The remote endpoint deliberately carries no terminal routes -- read, send,
 * answer and resize type into a running agent and need their own rate limit
 * and decision -- so in a browser these props are `undefined`. That must be a
 * sentence on screen, not an inert pane or a spinner that never resolves.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TerminalTab } from '../../src/renderer/panels/TerminalTab.js';

afterEach(cleanup);

describe('the terminal tab with no bridge behind it', () => {
  it('says why instead of drawing an empty pane', () => {
    render(
      <TerminalTab
        projectId="p1"
        rowId="s1"
        read={undefined}
        resize={undefined}
        send={undefined}
      />,
    );
    expect(screen.getByText(/only available in the vam desktop app/i)).toBeTruthy();
  });
});
