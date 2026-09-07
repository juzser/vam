// @vitest-environment happy-dom

/**
 * The sidebar's three answers to "what is in the list", pinned apart.
 *
 * Opening vam and waiting for the first read used to render nothing -- no
 * spinner, no sentence, just an empty list indistinguishable from "you have no
 * sessions". `useSourceModel` now says which of the two it is; this is the
 * sidebar's side of wiring that through, and the property it defends is the
 * one `pull-requests.ts` states for a different feature: "no sessions" and
 * "still asking" must never look the same.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
import { baseProps } from './session-list-props.js';

afterEach(cleanup);

describe('the sidebar tells loading, empty, and failed apart', () => {
  it('shows a loading row, not "No sessions yet", while the first read is still out', () => {
    render(<SessionList {...baseProps([])} loading={true} />);
    expect(screen.queryByText('No sessions yet')).toBeNull();
    expect(screen.getByText(/loading/i)).not.toBeNull();
  });

  it('shows "No sessions yet" once loading is done and the source truly has none', () => {
    render(<SessionList {...baseProps([])} loading={false} />);
    expect(screen.getByText('No sessions yet')).not.toBeNull();
    expect(screen.queryByText(/loading/i)).toBeNull();
  });

  it('defaults to not-loading, so every existing caller keeps today’s behaviour', () => {
    render(<SessionList {...baseProps([])} />);
    expect(screen.getByText('No sessions yet')).not.toBeNull();
  });
});
