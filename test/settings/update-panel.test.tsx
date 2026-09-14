// @vitest-environment happy-dom

/**
 * THE UPDATE SECTION: which vam this is, and a way to ask whether it is the
 * newest one.
 *
 * Operator: "add an update section in settings, show the version and a check
 * for updates button."
 *
 * ── WHAT WAS ALREADY THERE, AND WHY IT WAS NOT ENOUGH ─────────────────────
 * vam has checked for updates since before this: one unauthenticated GET at
 * launch, and a popover in the top-right corner that draws for exactly one
 * outcome -- `available`. Every other answer is silence, deliberately, because
 * a banner about a failed update check is a daily error message about a
 * question nobody asked.
 *
 * That leaves an operator with no way to ASK. Silence covers "you are on the
 * newest release", "the repository has published none", "GitHub is
 * rate-limiting this IP" and "the check never ran", and those are four
 * different things. A section the operator opens on purpose is where all four
 * can be said, because they are answering a question that was just asked.
 *
 * ── THE THREE RULES THIS SURFACE KEEPS ────────────────────────────────────
 *  1. THE VERSION IS ALWAYS THERE, in both builds. It needs no bridge, no
 *     network and no permission, and it is the one fact an operator filing a
 *     bug needs to read off the screen.
 *  2. THE BUTTON IS DRAWN ONLY WHERE IT CAN ACT -- this file's rule for the
 *     directory picker, the attach input and, since the deny-all policy was
 *     traced, the microphone. The browser build has no preload bridge, so
 *     there is no channel to check over and no button.
 *  3. EVERY OUTCOME IS A SENTENCE, never a silence and never a code. The
 *     operator pressed a button; a button that can answer nothing is worse
 *     than one that is not there.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PREFS } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { UpdatePanel } from '../../src/renderer/settings/UpdatePanel.js';
import type { UpdateStatus } from '../../src/shared/update.js';
import { VERSION } from '../../src/shared/update.js';

afterEach(cleanup);

const version = () => document.querySelector('[data-update-version]')?.textContent ?? '';
const button = () => document.querySelector<HTMLButtonElement>('[data-update-check]');
const outcome = () => document.querySelector('[data-update-outcome]')?.textContent ?? '';
const release = () => document.querySelector<HTMLButtonElement>('[data-update-open]');

/** A bridge that answers one status, and counts how often it was asked. */
function fakeApi(answer: UpdateStatus | (() => Promise<UpdateStatus>)) {
  const recheck = vi.fn(typeof answer === 'function' ? answer : async () => answer);
  return {
    check: vi.fn(async () => ({ kind: 'none' }) as UpdateStatus),
    recheck,
    open: vi.fn(async () => true),
  };
}

describe('the update section says which vam this is', () => {
  it('draws the version with no bridge, no network and no permission', () => {
    render(<UpdatePanel api={undefined} />);
    expect(version()).toContain(VERSION);
  });

  it('draws it in the Electron build too, from the same constant', () => {
    render(<UpdatePanel api={fakeApi({ kind: 'up-to-date' })} />);
    expect(version()).toContain(VERSION);
  });
});

describe('the check button', () => {
  it('is not drawn in a browser, which has no channel to check over', () => {
    // ABSENT, NOT DISABLED. The rule this file keeps everywhere: a control
    // that cannot act is not drawn dimmed, it is not drawn. The version stays,
    // because that half needs nothing.
    render(<UpdatePanel api={undefined} />);
    expect(button()).toBeNull();
    expect(version()).toContain(VERSION);
  });

  it('says why, rather than leaving a gap where a control was', () => {
    // A missing button with no explanation reads as a broken screen. This is
    // the phone, and the phone cannot reach GitHub through vam.
    render(<UpdatePanel api={undefined} />);
    expect(outcome().toLowerCase()).toMatch(/desktop|app/);
  });

  it('is drawn where the bridge is, and really asks when pressed', async () => {
    const api = fakeApi({ kind: 'up-to-date' });
    render(<UpdatePanel api={api} />);
    expect(api.recheck).not.toHaveBeenCalled();
    fireEvent.click(button() as HTMLElement);
    await waitFor(() => expect(api.recheck).toHaveBeenCalledTimes(1));
  });

  it('asks again on a second press, because that is what the operator meant', async () => {
    const api = fakeApi({ kind: 'up-to-date' });
    render(<UpdatePanel api={api} />);
    fireEvent.click(button() as HTMLElement);
    await waitFor(() => expect(outcome()).not.toBe(''));
    fireEvent.click(button() as HTMLElement);
    await waitFor(() => expect(api.recheck).toHaveBeenCalledTimes(2));
  });

  it('cannot be pressed twice into two requests at once', async () => {
    // A mashed button is the one way this becomes a rate-limit problem. It is
    // held closed for the length of the request and no longer: there is no
    // time-based throttle here, for the reason `main/update/ipc.ts` gives.
    let release: (status: UpdateStatus) => void = () => {};
    const api = fakeApi(
      () =>
        new Promise<UpdateStatus>((resolve) => {
          release = resolve;
        }),
    );
    render(<UpdatePanel api={api} />);
    fireEvent.click(button() as HTMLElement);
    await waitFor(() => expect(button()?.disabled).toBe(true));
    fireEvent.click(button() as HTMLElement);
    fireEvent.click(button() as HTMLElement);
    expect(api.recheck).toHaveBeenCalledTimes(1);
    release({ kind: 'up-to-date' });
    await waitFor(() => expect(button()?.disabled).toBe(false));
  });
});

describe('every outcome is a sentence', () => {
  const cases: ReadonlyArray<readonly [UpdateStatus, RegExp]> = [
    [{ kind: 'up-to-date' }, /newest|up to date|latest/i],
    [{ kind: 'none' }, /no release/i],
    [{ kind: 'unknown', reason: 'network' }, /reach|network|connect/i],
    [{ kind: 'unknown', reason: 'rate-limited' }, /github|later|limit/i],
    [{ kind: 'unknown', reason: 'malformed' }, /understand|answer/i],
    [
      { kind: 'available', version: '9.9.9', url: 'https://github.com/juzser/vam/releases' },
      /9\.9\.9/,
    ],
  ];

  for (const [status, pattern] of cases) {
    it(`says something specific for ${status.kind}/${'reason' in status ? status.reason : '-'}`, async () => {
      const api = fakeApi(status);
      render(<UpdatePanel api={api} />);
      fireEvent.click(button() as HTMLElement);
      await waitFor(() => expect(outcome()).toMatch(pattern));
      // NEVER A RAW CODE. `rate-limited` on screen is a developer's word for
      // a state an operator has to act on by waiting.
      expect(outcome()).not.toMatch(/^[a-z-]+$/);
    });
  }

  it('offers the release page only when there is one, and vam opens nothing itself', async () => {
    const api = fakeApi({
      kind: 'available',
      version: '9.9.9',
      url: 'https://github.com/juzser/vam/releases',
    });
    render(<UpdatePanel api={api} />);
    expect(release(), 'nothing is offered before a check has answered').toBeNull();
    fireEvent.click(button() as HTMLElement);
    await waitFor(() => expect(release()).not.toBeNull());
    fireEvent.click(release() as HTMLElement);
    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(1));
  });

  it('draws no release control for any other outcome', async () => {
    const api = fakeApi({ kind: 'up-to-date' });
    render(<UpdatePanel api={api} />);
    fireEvent.click(button() as HTMLElement);
    await waitFor(() => expect(outcome()).not.toBe(''));
    expect(release()).toBeNull();
  });

  it('survives a bridge that rejects, rather than leaving the button stuck', async () => {
    const api = {
      check: vi.fn(async () => ({ kind: 'none' }) as UpdateStatus),
      recheck: vi.fn(async () => {
        throw new Error('channel gone');
      }),
      open: vi.fn(async () => false),
    };
    render(<UpdatePanel api={api} />);
    fireEvent.click(button() as HTMLElement);
    await waitFor(() => expect(outcome()).not.toBe(''));
    expect(button()?.disabled).toBe(false);
  });
});

describe('the section is reachable from the dialog it belongs to', () => {
  it('has its own nav item, and opens a panel with the version in it', () => {
    render(
      <SettingsOverlay prefs={EMPTY_PREFS} theme="dark" onChange={() => {}} onClose={() => {}} />,
    );
    const tab = screen.getByRole('tab', { name: 'Update' });
    fireEvent.click(tab);
    expect(version()).toContain(VERSION);
  });
});
