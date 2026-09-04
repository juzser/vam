// @vitest-environment happy-dom

/**
 * The panel: the place a failure that flashed in the status bar can still be
 * read a minute later, and the only control that turns one into a report.
 *
 * The report assertions are negative on purpose -- no network, no navigation,
 * nothing submitted. The panel's most important property is a thing it does
 * NOT do.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorLogPanel } from '../../src/renderer/errors/ErrorLogPanel.js';
import { clearEvents, recordFailure, recordRefusal } from '../../src/renderer/errors/log.js';

beforeEach(() => {
  clearEvents();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function writeText(): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => true);
  vi.stubGlobal('window', Object.assign(globalThis.window, { api: { clipboard: { writeText: spy } } }));
  return spy;
}

describe('ErrorLogPanel', () => {
  it('shows the recorded failures, newest first', () => {
    recordFailure('send prompt', { code: 'session-running', message: 'busy' });
    recordFailure('close session', { code: 'cli-failed', message: 'pairing refused' });
    render(<ErrorLogPanel onClose={() => {}} />);
    const codes = screen.getAllByTestId('event-code').map((node) => node.textContent);
    expect(codes).toEqual(['cli-failed', 'session-running']);
    expect(screen.getByText('pairing refused')).toBeTruthy();
  });

  it('marks an intended refusal as a refusal, not as an error', () => {
    recordRefusal('close session', 'this source cannot close sessions');
    render(<ErrorLogPanel onClose={() => {}} />);
    expect(screen.getByTestId('event-kind').textContent).toBe('refusal');
    // And it is not offered as a bug report: vam meant to say no.
    expect(screen.queryByRole('button', { name: /report/i })).toBeNull();
  });

  it('says so when there is nothing to read', () => {
    render(<ErrorLogPanel onClose={() => {}} />);
    expect(screen.getByTestId('error-log-empty')).toBeTruthy();
  });

  it('composes a scrubbed report and copies it -- it does not send it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const copy = writeText();
    recordFailure('close session', {
      code: 'cli-failed',
      message: 'refused for /Users/ada/code/sonnet-lane',
    });
    render(<ErrorLogPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /report/i }));
    const preview = await screen.findByTestId('report-preview');
    expect(preview.textContent).toContain('cli-failed');
    expect(preview.textContent).not.toContain('/Users/ada');
    expect(preview.textContent).not.toContain('sonnet-lane');
    expect(copy).toHaveBeenCalledTimes(1);
    expect(String(copy.mock.calls[0]?.[0])).not.toContain('sonnet-lane');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('clears the log on request', () => {
    recordFailure('close session', { code: 'cli-failed', message: 'pairing refused' });
    render(<ErrorLogPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.getByTestId('error-log-empty')).toBeTruthy();
  });

  it('closes', () => {
    const onClose = vi.fn();
    render(<ErrorLogPanel onClose={onClose} />);
    // `mouseDown`, matching the scrim idiom `KeySheet` and `CommandPalette`
    // already use: a click that STARTS on the scrim dismisses, so a drag that
    // ends there after selecting text in the panel does not.
    fireEvent.mouseDown(screen.getByRole('button', { name: /close the error log/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
