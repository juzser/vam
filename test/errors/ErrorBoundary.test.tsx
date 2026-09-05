// @vitest-environment happy-dom

/**
 * The boundary: a render throw becomes a surface the operator can act on,
 * and stops there instead of taking the window with it.
 *
 * Four properties, and three of them are about containment rather than
 * about the card: the throw is caught, the NEIGHBOURING boundary still
 * renders, the message names the failure rather than apologising for it,
 * and the report route composes a URL and sends nothing. The last one is
 * asserted as an absence -- no `fetch`, no `sendBeacon`, no `window.open`
 * -- because "vam never posts" is a property that can only be checked by
 * looking for the calls that would break it.
 *
 * CONSOLE NOISE IS SUPPRESSED NARROWLY. React prints every error a boundary
 * catches, and these tests throw on purpose, so an unfiltered run buries the
 * real output. The filter drops only lines that mention the two sentences
 * this file throws; anything else is passed straight through to the real
 * console, because a blanket silence here would hide the next genuine
 * warning from a component nobody is looking at.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../../src/renderer/errors/ErrorBoundary.js';
import { clearEvents, failureEvents } from '../../src/renderer/errors/log.js';
import { NEW_ISSUE_URL } from '../../src/renderer/errors/report.js';

const THROWN = 'the canvas asked for a node that is not there';
const OTHER_THROWN = 'the detail panel could not read its tab';

function Boom({ message = THROWN }: { readonly message?: string }): never {
  throw new Error(message);
}

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  clearEvents();
  const real = console.error.bind(console);
  consoleSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const text = args.map(String).join(' ');
    if (text.includes(THROWN) || text.includes(OTHER_THROWN)) return;
    real(...args);
  });
});

afterEach(() => {
  cleanup();
  consoleSpy.mockRestore();
  vi.unstubAllGlobals();
});

/** Spies for every route out of the renderer. None of them may be called. */
function noNetwork() {
  const spies = {
    fetch: vi.fn(),
    sendBeacon: vi.fn(),
    open: vi.fn(),
    writeText: vi.fn(async (_text: string) => true),
  };
  vi.stubGlobal('fetch', spies.fetch);
  vi.stubGlobal('navigator', Object.assign(globalThis.navigator, { sendBeacon: spies.sendBeacon }));
  vi.stubGlobal(
    'window',
    Object.assign(globalThis.window, {
      open: spies.open,
      api: { clipboard: { writeText: spies.writeText } },
    }),
  );
  return spies;
}

describe('ErrorBoundary', () => {
  it('renders its children untouched while nothing throws', () => {
    render(
      <ErrorBoundary surface="the canvas">
        <p>a live canvas</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('a live canvas')).toBeTruthy();
    expect(screen.queryByTestId('render-failure')).toBeNull();
  });

  it('catches a render throw and leaves the neighbouring surface rendering', () => {
    render(
      <>
        <ErrorBoundary surface="the canvas">
          <Boom />
        </ErrorBoundary>
        <ErrorBoundary surface="the update notice">
          <p>still here</p>
        </ErrorBoundary>
      </>,
    );
    expect(screen.getByTestId('render-failure')).toBeTruthy();
    expect(screen.getByText('still here')).toBeTruthy();
  });

  it('names the surface that died and the failure, never "something went wrong"', () => {
    render(
      <ErrorBoundary surface="the canvas">
        <Boom />
      </ErrorBoundary>,
    );
    const card = screen.getByTestId('render-failure');
    expect(card.textContent).toContain('the canvas');
    expect(card.textContent).toContain(THROWN);
    expect(card.textContent?.toLowerCase()).not.toContain('something went wrong');
  });

  it('records the throw once in the error log, as a failure', () => {
    render(
      <ErrorBoundary surface="the canvas">
        <Boom />
      </ErrorBoundary>,
    );
    const failures = failureEvents();
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toBe(THROWN);
    expect(failures[0]?.kind).toBe('failure');
  });

  it('offers the report route: a prefilled issue URL, on the clipboard, sent nowhere', async () => {
    const spies = noNetwork();
    render(
      <ErrorBoundary surface="the canvas">
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: /report/i }));
    const preview = await screen.findByTestId('report-preview');
    expect(preview.textContent).toContain(THROWN);
    expect(spies.writeText).toHaveBeenCalledTimes(1);
    expect(spies.writeText.mock.calls[0]?.[0] ?? '').toContain(NEW_ISSUE_URL);
    expect(spies.fetch).not.toHaveBeenCalled();
    expect(spies.sendBeacon).not.toHaveBeenCalled();
    expect(spies.open).not.toHaveBeenCalled();
  });

  it('widens nothing: no stack trace or component tree reaches the report body', async () => {
    noNetwork();
    render(
      <ErrorBoundary surface="the canvas">
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: /report/i }));
    const body = (await screen.findByTestId('report-preview')).textContent ?? '';
    expect(body).not.toContain('at Boom');
    expect(body).not.toContain('ErrorBoundary');
    expect(body).not.toContain('.tsx');
  });
});
