// @vitest-environment happy-dom

/**
 * THE SEAM, END TO END: does the source's backward pager actually reach a pane?
 *
 * The unit tests either side of this one prove the halves. This one proves the
 * WIRE, and it exists because a context is exactly the kind of wiring that can
 * be dropped in silence: nothing stops compiling when a provider is deleted,
 * the consumer simply reads its default, and the column reports that the source
 * cannot page. Every other test in this repo would stay green.
 *
 * The canvas is mocked down to the one thing being asked about, the same way
 * `App.desktop-failure.test.tsx` does: what a pane below `App` can reach, and
 * where a call it makes ends up.
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopSourceApi } from '../../src/preload/api.js';
import type { TranscriptPage } from '../../src/shared/history.js';

vi.mock('../../src/renderer/canvas/Canvas.js', () => ({
  // Stands in for `DetailPanel`'s own use of the context: reach for the reader,
  // and if there is one, actually call it -- a provider that publishes a
  // function nobody can call would pass a presence check and fail an operator.
  Canvas: () => {
    const read = useHistoryReader();
    const [answered, setAnswered] = useState('');
    useEffect(() => {
      if (read === null) return;
      let live = true;
      void read('s-42', 'oldest-on-screen').then((page) => {
        if (live) setAnswered(page.kind === 'page' && page.reachedStart ? 'start' : page.kind);
      });
      return () => {
        live = false;
      };
    }, [read]);
    return (
      <div data-test-canvas data-has-reader={read === null ? 'no' : 'yes'} data-answer={answered} />
    );
  },
}));

const { useHistoryReader } = await import('../../src/renderer/sources/history-reader.js');
const { DesktopCanvas } = await import('../../src/renderer/App.js');

afterEach(cleanup);

const DESCRIPTOR = {
  id: 'claude-code',
  label: 'Claude Code',
  capabilities: {
    liveUpdates: false,
    recordPrompt: false,
    deliverPrompt: false,
    promptAttachments: false,
    slashCommands: false,
    renameSession: false,
    closeSession: false,
    createSession: false,
    governance: false,
    pullRequests: false,
    terminal: false,
    agentRoster: false,
  },
  declines: {},
  viewerScope: { kind: 'connection', note: 'one local process' },
};

const canvas = () => document.querySelector('[data-test-canvas]');

describe('the desktop shell publishes its source pager', () => {
  it('a pane below it reaches `source.history`, and the call lands on the bridge', async () => {
    const asked: string[] = [];
    const api = {
      describe: () => Promise.resolve(DESCRIPTOR),
      load: () => Promise.resolve([]),
      history: (sessionId: string, cursor: string | null): Promise<TranscriptPage> => {
        asked.push(`${sessionId}|${cursor}`);
        return Promise.resolve({ kind: 'page', turns: [], cursor: null, reachedStart: true });
      },
    } as unknown as DesktopSourceApi;

    render(<DesktopCanvas api={api} />);
    await waitFor(() => expect(canvas()?.getAttribute('data-has-reader')).toBe('yes'));
    // The session id and the cursor arrive at the bridge unaltered -- the
    // cursor is opaque, so anything between here and main that reshaped it
    // would be inventing one.
    await waitFor(() => expect(asked).toEqual(['s-42|oldest-on-screen']));
    await waitFor(() => expect(canvas()?.getAttribute('data-answer')).toBe('start'));
  });

  it('publishes NOTHING while the source has not been assembled', () => {
    // A reader that resolved empty here would say "there is nothing older"
    // about a source that has not answered yet -- the confusion the whole
    // `TranscriptPage` shape exists to prevent, one layer up.
    const quiet = { describe: () => new Promise(() => {}) } as unknown as DesktopSourceApi;
    render(<DesktopCanvas api={quiet} />);
    expect(canvas()?.getAttribute('data-has-reader')).toBe('no');
  });

  it('publishes NOTHING when the source could not be assembled at all', async () => {
    const broken = {
      describe: () => Promise.reject(new Error('no route to a source')),
    } as unknown as DesktopSourceApi;
    render(<DesktopCanvas api={broken} />);
    await waitFor(() =>
      expect(document.querySelector('[data-testid="source-failure"]')).not.toBeNull(),
    );
    expect(canvas()?.getAttribute('data-has-reader')).toBe('no');
  });
});
