// @vitest-environment happy-dom

/**
 * The popover: visible for one outcome, silent for the other three,
 * dismissible for good, and a click that LEAVES vam rather than downloading
 * anything.
 *
 * The important assertions are negative. Nothing here fetches, nothing
 * navigates the window, nothing writes a file, and no test touches the
 * network -- `check` and `open` are stubs in every one of them.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateNotice } from '../../src/renderer/update/UpdateNotice.js';
import type { UpdateStatus } from '../../src/shared/update.js';

afterEach(cleanup);

const RELEASE_URL = 'https://github.com/juzser/vam/releases/tag/v0.1.0';
const AVAILABLE: UpdateStatus = { kind: 'available', version: '0.1.0', url: RELEASE_URL };

function api(status: UpdateStatus, opened = true) {
  return { check: vi.fn(async () => status), open: vi.fn(async () => opened) };
}

/** Lets the mount effect's promise settle before anything is asserted. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('UpdateNotice', () => {
  it('names the version, the destination, and what the click does', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<UpdateNotice update={api(AVAILABLE)} />);
    await settle();

    const notice = screen.getByTestId('update-notice');
    expect(notice.textContent).toContain('0.1.0');
    expect(screen.getByTestId('update-url').textContent).toBe(RELEASE_URL);
    // It says the click leaves vam, and that vam installs nothing.
    expect(notice.textContent).toMatch(/browser/i);
    expect(notice.textContent).toMatch(/install/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('sits in the top-right corner, under any overlay rather than over it', async () => {
    render(<UpdateNotice update={api(AVAILABLE)} />);
    await settle();
    const box = screen.getByTestId('update-notice').className;
    expect(box).toContain('top-3');
    expect(box).toContain('right-3');
    expect(box).toContain('z-40');
  });

  it('hands the click to the operating system, and downloads nothing itself', async () => {
    const update = api(AVAILABLE);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<UpdateNotice update={update} />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: /release page/i }));
    await settle();
    expect(update.open).toHaveBeenCalledTimes(1);
    // No argument crosses: main opens the URL from its own launch check.
    expect(update.open).toHaveBeenCalledWith();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('says so when the browser could not be opened, and still shows the URL', async () => {
    const update = api(AVAILABLE, false);
    render(<UpdateNotice update={update} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /release page/i }));
    await settle();

    expect(screen.getByTestId('update-open-failed')).toBeTruthy();
    expect(screen.getByTestId('update-url').textContent).toBe(RELEASE_URL);
  });

  it('says nothing when the repository has published no releases', async () => {
    render(<UpdateNotice update={api({ kind: 'none' })} />);
    await settle();
    expect(screen.queryByTestId('update-notice')).toBeNull();
  });

  it('says nothing when this build is current', async () => {
    render(<UpdateNotice update={api({ kind: 'up-to-date' })} />);
    await settle();
    expect(screen.queryByTestId('update-notice')).toBeNull();
  });

  it('says nothing when the question could not be answered', async () => {
    for (const reason of ['network', 'rate-limited', 'malformed'] as const) {
      render(<UpdateNotice update={api({ kind: 'unknown', reason })} />);
      await settle();
      expect(screen.queryByTestId('update-notice'), reason).toBeNull();
      cleanup();
    }
  });

  it('is dismissible, and dismissal survives a re-render', async () => {
    const update = api(AVAILABLE);
    const { rerender } = render(<UpdateNotice update={update} />);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByTestId('update-notice')).toBeNull();

    rerender(<UpdateNotice update={update} />);
    await settle();
    expect(screen.queryByTestId('update-notice')).toBeNull();
    // Re-rendering must not ask again either: launch is the only trigger.
    expect(update.check).toHaveBeenCalledTimes(1);
  });

  it('draws nothing, and does not throw, where there is no bridge', async () => {
    render(<UpdateNotice update={undefined} />);
    await settle();
    expect(screen.queryByTestId('update-notice')).toBeNull();
  });

  it('stays silent when the bridge itself rejects', async () => {
    const update = {
      check: vi.fn(async (): Promise<UpdateStatus> => {
        throw new Error('no handler');
      }),
      open: vi.fn(async () => false),
    };
    render(<UpdateNotice update={update} />);
    await settle();
    expect(screen.queryByTestId('update-notice')).toBeNull();
  });
});
