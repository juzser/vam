// @vitest-environment happy-dom

/**
 * WHAT A PHONE'S CHROME IS FOR.
 *
 * Operator instruction: "on mobile the settings part can be removed; remote
 * only needs to show the paired devices". Both halves are about the same
 * thing -- a phone is a REMOTE CONTROL for sessions running on a desktop, and
 * the settings overlay is a desktop instrument that happens to render there.
 *
 * IT IS NOT MERELY CRAMPED, WHICH IS THE PART WORTH WRITING DOWN. Four of the
 * five sections cannot act from a phone at all. Appearance, Sessions, Keyboard
 * and Update read and write `prefs`, which is `localStorage` on whichever
 * device is looking -- so a theme chosen on the phone changes the phone, not
 * the machine the sessions are on, and a keyboard shortcut edited there binds
 * keys for a device with no keyboard. Update reaches
 * `window.api.update`, which the browser build does not have. A control that
 * looks like it configures vam and configures a copy of vam nobody is watching
 * is worse than an absent one.
 *
 * Remote is the exception and the reason the door stays: what it shows is a
 * fact about the DESKTOP's pairings, which is the one thing on that overlay a
 * phone has a reason to look at.
 *
 * THE NAV GOES WITH THEM. A nav with one destination is a control that cannot
 * do anything: every press lands where you already are.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
import { PHONE_QUERY } from '../../src/renderer/phone/viewport.js';
import { EMPTY_PREFS } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { SECTIONS } from '../../src/renderer/settings/sections.js';
import { baseProps, entriesOf } from '../panels/session-list-props.js';

/**
 * A `matchMedia` that answers PER QUERY, which the existing stubs do not: the
 * overlay reads two different media queries (`useWideNav` and
 * `usePhoneViewport`) and a stub that says `false` to both describes a narrow
 * DESKTOP, not a phone. Getting that wrong makes this whole file assert the
 * wrong shell.
 */
function atPhoneWidth(): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (media: string) => ({
      media,
      matches: media === PHONE_QUERY,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  return () => {
    if (original === undefined) Reflect.deleteProperty(window, 'matchMedia');
    else Object.defineProperty(window, 'matchMedia', original);
  };
}

/**
 * NO UNIT TEST MAKES A NETWORK CONNECTION. Remote is the one section a phone
 * draws, and it reads the paired devices over HTTP (`PairedDeviceList`) -- so
 * an un-stubbed render here resolves `/api/devices` against this environment's
 * default origin and really opens a socket. It showed up as an
 * `ECONNREFUSED` printed beside a green run, which is the shape of this that
 * gets ignored.
 */
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('the phone’s own chrome', () => {
  it('draws no settings control at all', () => {
    render(<SessionList {...baseProps(entriesOf([]))} phone />);
    expect(screen.queryByRole('button', { name: 'settings' })).toBeNull();
  });

  it('keeps remote access, which is the one the phone has a reason for', () => {
    render(<SessionList {...baseProps(entriesOf([]))} phone />);
    expect(screen.getByRole('button', { name: 'remote access' })).toBeTruthy();
  });

  /**
   * THE DESKTOP IS UNTOUCHED, and this is the assertion that says the change
   * is a phone decision rather than a deletion. `SessionList` is one component
   * drawn in two shells.
   */
  it('leaves the desktop’s settings control exactly where it was', () => {
    render(<SessionList {...baseProps(entriesOf([]))} />);
    expect(screen.getByRole('button', { name: 'settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'remote access' })).toBeTruthy();
  });
});

describe('the settings overlay at phone width', () => {
  it('shows Remote and no other section, with no nav to leave it by', () => {
    const restore = atPhoneWidth();
    try {
      render(
        <SettingsOverlay
          prefs={EMPTY_PREFS}
          theme="dark"
          onChange={() => {}}
          onClose={() => {}}
          initialSection="remote"
        />,
      );
      expect(document.querySelector('[data-settings-panel="remote"]')).not.toBeNull();
      for (const section of SECTIONS) {
        if (section.id === 'remote') continue;
        expect(
          document.querySelector(`[data-settings-panel="${section.id}"]`),
          `${section.id} is drawn on a phone, where it can only configure a copy of vam nobody is watching`,
        ).toBeNull();
      }
      // A nav with one destination is a control that cannot do anything.
      expect(document.querySelector('[data-settings-nav]')).toBeNull();
    } finally {
      restore();
    }
  });

  /**
   * THE WAY OUT SURVIVES. Withdrawing the nav must not withdraw the close
   * button with it -- an overlay a phone cannot leave is the worse bug, and it
   * is the one this shape could produce.
   */
  it('can still be closed', () => {
    const restore = atPhoneWidth();
    try {
      const closes: number[] = [];
      render(
        <SettingsOverlay
          prefs={EMPTY_PREFS}
          theme="dark"
          onChange={() => {}}
          onClose={() => closes.push(1)}
          initialSection="remote"
        />,
      );
      const close = screen.getByRole('button', { name: 'close' });
      close.click();
      expect(closes).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('still draws every section on a desktop', () => {
    render(
      <SettingsOverlay
        prefs={EMPTY_PREFS}
        theme="dark"
        onChange={() => {}}
        onClose={() => {}}
        initialSection="appearance"
      />,
    );
    expect(document.querySelector('[data-settings-nav]')).not.toBeNull();
    expect(document.querySelectorAll('[data-settings-nav-item]')).toHaveLength(SECTIONS.length);
  });
});
