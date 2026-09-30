// @vitest-environment happy-dom

/**
 * The update card: one state per updater status, prompt-then-download.
 *
 * `available` asks (Update / Later / Release notes); only Update starts a
 * download. Nothing here touches the network -- every bridge member is a stub.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateApi } from '../../src/preload/api.js';
import { UpdateNotice } from '../../src/renderer/update/UpdateNotice.js';
import type { UpdateStatus } from '../../src/shared/update.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const RELEASE_URL = 'https://github.com/juzser/vam/releases/tag/v0.2.0';
const AVAILABLE: UpdateStatus = { kind: 'available', version: '0.2.0', notesUrl: RELEASE_URL };
const IDLE: UpdateStatus = { kind: 'idle' };

function api(status: UpdateStatus, opened = true) {
  let push: (status: UpdateStatus) => void = () => {};
  const bridge = {
    getStatus: vi.fn(async () => status),
    check: vi.fn(async () => status),
    download: vi.fn(async () => status),
    dismiss: vi.fn(async () => IDLE),
    getAutoCheck: vi.fn(async () => true),
    setAutoCheck: vi.fn(async (enabled: boolean) => enabled),
    openNotes: vi.fn(async () => opened),
    onStatus: vi.fn((listener: (status: UpdateStatus) => void) => {
      push = listener;
      return () => {};
    }),
  } satisfies UpdateApi;
  return { bridge, push: (s: UpdateStatus) => act(() => push(s)) };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(status: UpdateStatus, opened = true) {
  const a = api(status, opened);
  render(<UpdateNotice update={a.bridge} />);
  await settle();
  return a;
}

describe('UpdateNotice: available', () => {
  it('names the version and offers Update / Later / Release notes', async () => {
    await mount(AVAILABLE);
    const card = screen.getByTestId('update-notice');
    expect(card.textContent).toContain('v0.2.0 available');
    expect(screen.getByRole('button', { name: /^update$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^later$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /release notes/i })).toBeTruthy();
  });

  it('says nothing about downloading nothing or opening a browser', async () => {
    await mount(AVAILABLE);
    const text = screen.getByTestId('update-notice').textContent ?? '';
    expect(text).not.toMatch(/does not download|browser|release page/i);
  });

  it('keeps its top-right place, role and z-order', async () => {
    await mount(AVAILABLE);
    const card = screen.getByTestId('update-notice');
    expect(card.getAttribute('role')).toBe('status');
    expect(card.className).toContain('top-3');
    expect(card.className).toContain('right-3');
    expect(card.className).toContain('z-40');
  });

  it('Update starts the download, and downloads nothing until then', async () => {
    const { bridge } = await mount(AVAILABLE);
    expect(bridge.download).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^update$/i }));
    await settle();
    expect(bridge.download).toHaveBeenCalledTimes(1);
  });

  it('Later dismisses through main and the card goes away', async () => {
    const { bridge } = await mount(AVAILABLE);
    fireEvent.click(screen.getByRole('button', { name: /^later$/i }));
    await settle();
    expect(bridge.dismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('update-notice')).toBeNull();
  });

  it('Release notes hands the click to main with no argument', async () => {
    const { bridge } = await mount(AVAILABLE);
    fireEvent.click(screen.getByRole('button', { name: /release notes/i }));
    await settle();
    expect(bridge.openNotes).toHaveBeenCalledWith();
  });

  it('shows the URL when the browser could not be opened', async () => {
    await mount(AVAILABLE, false);
    fireEvent.click(screen.getByRole('button', { name: /release notes/i }));
    await settle();
    expect(screen.getByTestId('update-open-failed').textContent).toBe(RELEASE_URL);
  });

  it('follows pushed statuses', async () => {
    const { push } = await mount(IDLE);
    expect(screen.queryByTestId('update-notice')).toBeNull();
    push(AVAILABLE);
    expect(screen.getByTestId('update-notice').textContent).toContain('v0.2.0');
  });
});

describe('UpdateNotice: downloading and installing', () => {
  it('draws a progress bar with the percent, and nothing to click away', async () => {
    await mount({ kind: 'downloading', version: '0.2.0', percent: 42 });
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(screen.getByTestId('update-percent').textContent).toBe('42%');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('clamps a wild percent into the bar', async () => {
    await mount({ kind: 'downloading', version: '0.2.0', percent: 240 });
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('says it is restarting', async () => {
    await mount({ kind: 'installing', version: '0.2.0' });
    expect(screen.getByTestId('update-notice').textContent).toContain('Restarting to update…');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('UpdateNotice: error', () => {
  it('shows a sentence, never the raw code, with Retry that re-checks', async () => {
    const { bridge } = await mount({ kind: 'error', code: 'network', message: 'ENOTFOUND' });
    const text = screen.getByTestId('update-notice').textContent ?? '';
    expect(text).toMatch(/could not be reached/i);
    expect(text).not.toContain('ENOTFOUND');
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await settle();
    expect(bridge.check).toHaveBeenCalledTimes(1);
    expect(bridge.download).not.toHaveBeenCalled();
  });

  it('Retry after a failed download downloads again', async () => {
    const { bridge } = await mount({ kind: 'error', code: 'checksum', message: 'x' });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await settle();
    expect(bridge.download).toHaveBeenCalledTimes(1);
  });

  it('offers no Retry where the operator has to act first', async () => {
    await mount({ kind: 'error', code: 'translocated', message: 'x' });
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeTruthy();
  });

  it('can be dismissed', async () => {
    const { bridge } = await mount({ kind: 'error', code: 'read-only', message: 'x' });
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await settle();
    expect(bridge.dismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('update-notice')).toBeNull();
  });
});

describe('UpdateNotice: not-available and silence', () => {
  it('says "vam is up to date" for a manual check, then hides itself', async () => {
    vi.useFakeTimers();
    const a = api({ kind: 'not-available', manual: true, reason: 'up-to-date' });
    render(<UpdateNotice update={a.bridge} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('update-notice').textContent).toContain('vam is up to date');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(a.bridge.dismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('update-notice')).toBeNull();
  });

  it('is silent for an automatic check that found nothing', async () => {
    await mount({ kind: 'not-available', manual: false, reason: 'up-to-date' });
    expect(screen.queryByTestId('update-notice')).toBeNull();
  });

  it('is silent for idle and checking', async () => {
    await mount(IDLE);
    expect(screen.queryByTestId('update-notice')).toBeNull();
    cleanup();
    await mount({ kind: 'checking', manual: true });
    expect(screen.queryByTestId('update-notice')).toBeNull();
  });

  it('draws nothing, and does not throw, where there is no bridge', async () => {
    render(<UpdateNotice update={undefined} />);
    await settle();
    expect(screen.queryByTestId('update-notice')).toBeNull();
  });

  it('stays silent when the bridge itself rejects', async () => {
    const a = api(AVAILABLE);
    a.bridge.getStatus.mockRejectedValue(new Error('no handler'));
    render(<UpdateNotice update={a.bridge} />);
    await settle();
    expect(screen.queryByTestId('update-notice')).toBeNull();
  });
});
