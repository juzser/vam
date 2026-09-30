// @vitest-environment happy-dom

/**
 * THE UPDATE SECTION: which vam this is, whether it checks by itself, and a
 * way to ask now.
 *
 * ── THE RULES THIS SURFACE KEEPS ──────────────────────────────────────────
 *  1. THE VERSION IS ALWAYS THERE, in both builds. It needs no bridge, no
 *     network and no permission.
 *  2. CONTROLS ARE DRAWN ONLY WHERE THEY CAN ACT. The browser build (and so
 *     the phone) has no preload bridge: no switch, no button, and a sentence
 *     saying why.
 *  3. EVERY STATUS IS A SENTENCE, never a silence and never a code.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateApi } from '../../src/preload/api.js';
import { EMPTY_PREFS } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { UpdatePanel } from '../../src/renderer/settings/UpdatePanel.js';
import type { UpdateStatus } from '../../src/shared/update.js';
import { VERSION } from '../../src/shared/update.js';

afterEach(cleanup);

const version = () => document.querySelector('[data-update-version]')?.textContent ?? '';
const button = () => document.querySelector<HTMLButtonElement>('[data-update-check]');
const outcome = () => document.querySelector('[data-update-outcome]')?.textContent ?? '';
const install = () => document.querySelector<HTMLButtonElement>('[data-update-install]');
const notes = () => document.querySelector<HTMLButtonElement>('[data-update-open]');
const autoSwitch = () => document.querySelector<HTMLButtonElement>('[data-switch="auto-update"]');

const IDLE: UpdateStatus = { kind: 'idle' };
const UP_TO_DATE: UpdateStatus = { kind: 'not-available', manual: true, reason: 'up-to-date' };
const AVAILABLE: UpdateStatus = {
  kind: 'available',
  version: '9.9.9',
  notesUrl: 'https://github.com/juzser/vam/releases',
};

/** Every member of the bridge, so the fake catches a subject reaching for another. */
function fullApi(overrides: Partial<UpdateApi> = {}) {
  let push: (status: UpdateStatus) => void = () => {};
  const bridge = {
    getStatus: vi.fn(async () => IDLE),
    check: vi.fn(async () => UP_TO_DATE),
    download: vi.fn(
      async () => ({ kind: 'downloading', version: '9.9.9', percent: 0 }) as UpdateStatus,
    ),
    dismiss: vi.fn(async () => IDLE),
    getAutoCheck: vi.fn(async () => true),
    setAutoCheck: vi.fn(async (enabled: boolean) => enabled),
    openNotes: vi.fn(async () => true),
    onStatus: vi.fn((listener: (status: UpdateStatus) => void) => {
      push = listener;
      return () => {};
    }),
    ...overrides,
  } satisfies UpdateApi;
  return { bridge, push: (s: UpdateStatus) => act(() => push(s)) };
}

/** A bridge whose check answers one status. */
function checkApi(answer: UpdateStatus | (() => Promise<UpdateStatus>)) {
  return fullApi({ check: vi.fn(typeof answer === 'function' ? answer : async () => answer) });
}

async function mount(api: UpdateApi) {
  render(<UpdatePanel api={api} />);
  // The mount effects read the stored status and preference.
  await waitFor(() => expect(autoSwitch()).not.toBeNull());
}

describe('the update section says which vam this is', () => {
  it('draws the version with no bridge', () => {
    render(<UpdatePanel api={undefined} />);
    expect(version()).toContain(VERSION);
  });

  it('draws it in the Electron build too', async () => {
    await mount(fullApi().bridge);
    expect(version()).toContain(VERSION);
  });
});

describe('without a bridge (browser tab, paired phone)', () => {
  it('draws no button and no switch, and says why', () => {
    render(<UpdatePanel api={undefined} />);
    expect(button()).toBeNull();
    expect(autoSwitch()).toBeNull();
    expect(outcome().toLowerCase()).toMatch(/desktop|app/);
  });
});

describe('the automatic-check switch', () => {
  it('reads the stored preference', async () => {
    const off = fullApi({ getAutoCheck: vi.fn(async () => false) });
    await mount(off.bridge);
    await waitFor(() => expect(autoSwitch()?.getAttribute('aria-checked')).toBe('false'));
    cleanup();
    const on = fullApi();
    await mount(on.bridge);
    await waitFor(() => expect(autoSwitch()?.getAttribute('aria-checked')).toBe('true'));
  });

  it('is named for what it controls', async () => {
    await mount(fullApi().bridge);
    expect(autoSwitch()?.getAttribute('aria-label')).toMatch(/automatically check for updates/i);
  });

  it('sits in a settings row with a visible label and hint, like every other switch', async () => {
    await mount(fullApi().bridge);
    const row = autoSwitch()?.closest('[role="group"]');
    expect(row).not.toBeNull();
    const labelId = row?.getAttribute('aria-labelledby') ?? '';
    const heading = document.getElementById(labelId);
    expect(heading?.textContent).toMatch(/automatically check for updates/i);
    // Not the switch's own aria-label: text a sighted operator can read.
    expect(autoSwitch()?.contains(heading ?? null)).toBe(false);
    expect(row?.textContent).toMatch(/once a day/i);
  });

  it('stores the flip through main and shows what main answered', async () => {
    const { bridge } = fullApi();
    await mount(bridge);
    await waitFor(() => expect(autoSwitch()?.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(autoSwitch() as HTMLElement);
    await waitFor(() => expect(bridge.setAutoCheck).toHaveBeenCalledWith(false));
    await waitFor(() => expect(autoSwitch()?.getAttribute('aria-checked')).toBe('false'));
  });
});

describe('Check now', () => {
  it('really asks when pressed, and not before', async () => {
    const { bridge } = checkApi(UP_TO_DATE);
    await mount(bridge);
    expect(bridge.check).not.toHaveBeenCalled();
    fireEvent.click(button() as HTMLElement);
    await waitFor(() => expect(bridge.check).toHaveBeenCalledTimes(1));
  });

  it('cannot be pressed twice into two requests at once', async () => {
    let release: (status: UpdateStatus) => void = () => {};
    const { bridge } = checkApi(
      () =>
        new Promise<UpdateStatus>((resolve) => {
          release = resolve;
        }),
    );
    await mount(bridge);
    fireEvent.click(button() as HTMLElement);
    await waitFor(() => expect(button()?.disabled).toBe(true));
    expect(button()?.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button() as HTMLElement);
    expect(bridge.check).toHaveBeenCalledTimes(1);
    await act(async () => release(UP_TO_DATE));
    await waitFor(() => expect(button()?.disabled).toBe(false));
  });

  it('survives a bridge that rejects, rather than leaving the button stuck', async () => {
    const { bridge } = checkApi(async () => {
      throw new Error('channel gone');
    });
    await mount(bridge);
    fireEvent.click(button() as HTMLElement);
    await waitFor(() => expect(outcome()).toMatch(/reached/i));
    expect(button()?.disabled).toBe(false);
  });
});

describe('the status line is a sentence for every status', () => {
  const cases: ReadonlyArray<readonly [UpdateStatus, RegExp]> = [
    [IDLE, /check now/i],
    [{ kind: 'checking', manual: false }, /checking/i],
    [UP_TO_DATE, /newest/i],
    [{ kind: 'not-available', manual: true, reason: 'none' }, /no release/i],
    [{ kind: 'not-available', manual: true, reason: 'incomplete' }, /still being published/i],
    [AVAILABLE, /9\.9\.9/],
    [{ kind: 'downloading', version: '9.9.9', percent: 37 }, /37%/],
    [{ kind: 'installing', version: '9.9.9' }, /restarting/i],
    [{ kind: 'error', code: 'network', message: 'x' }, /reached/i],
    [{ kind: 'error', code: 'rate-limited', message: 'x' }, /rate-limiting/i],
    [{ kind: 'error', code: 'checksum', message: 'x' }, /checksum/i],
  ];

  for (const [status, pattern] of cases) {
    it(`says something specific for ${status.kind}`, async () => {
      const { bridge } = fullApi({ getStatus: vi.fn(async () => status) });
      await mount(bridge);
      await waitFor(() => expect(outcome()).toMatch(pattern));
      // NEVER A RAW CODE.
      expect(outcome()).not.toMatch(/^[a-z-]+$/);
    });
  }

  it('follows statuses main pushes', async () => {
    const { bridge, push } = fullApi();
    await mount(bridge);
    push({ kind: 'downloading', version: '9.9.9', percent: 80 });
    expect(outcome()).toMatch(/80%/);
  });
});

describe('what the operator can press when a release is available', () => {
  it('offers Update, which starts the download, and Release notes', async () => {
    const { bridge } = fullApi({ getStatus: vi.fn(async () => AVAILABLE) });
    await mount(bridge);
    await waitFor(() => expect(install()).not.toBeNull());
    fireEvent.click(notes() as HTMLElement);
    await waitFor(() => expect(bridge.openNotes).toHaveBeenCalledWith());
    fireEvent.click(install() as HTMLElement);
    await waitFor(() => expect(bridge.download).toHaveBeenCalledTimes(1));
  });

  it('offers neither for any other status', async () => {
    const { bridge } = fullApi({ getStatus: vi.fn(async () => UP_TO_DATE) });
    await mount(bridge);
    await waitFor(() => expect(outcome()).toMatch(/newest/i));
    expect(install()).toBeNull();
    expect(notes()).toBeNull();
  });

  it('holds Check now while a download is under way', async () => {
    const { bridge } = fullApi({
      getStatus: vi.fn(
        async () => ({ kind: 'downloading', version: '9.9.9', percent: 5 }) as UpdateStatus,
      ),
    });
    await mount(bridge);
    await waitFor(() => expect(button()?.disabled).toBe(true));
  });
});

describe('the section is reachable from the dialog it belongs to', () => {
  it('has its own nav item, and opens a panel with the version in it', () => {
    render(
      <SettingsOverlay prefs={EMPTY_PREFS} theme="dark" onChange={() => {}} onClose={() => {}} />,
    );
    // NOT `getByRole('button', { name: 'Update' })`: the card's own header is
    // a button with the same accessible name, so the query is ambiguous.
    const navItem = document.querySelector('[data-settings-nav-item="update"]') as HTMLElement;
    fireEvent.click(navItem);
    expect(version()).toContain(VERSION);
    expect(screen.queryByText(/downloads nothing/i)).toBeNull();
  });
});
