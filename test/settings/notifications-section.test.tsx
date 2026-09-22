// @vitest-environment happy-dom

/**
 * THE NOTIFICATIONS SECTION, and the button that is the reason it exists.
 *
 * Operator: "add a setting for notifications in the desktop app. Include a
 * test-notification button too."
 *
 * What this file holds: that the section is in the nav where it belongs and
 * not on the phone; that the switch #440 shipped still round-trips under its
 * new home; and that the Test notification button renders EACH of the three
 * verdicts main can answer, from the answer and nothing else. What it cannot
 * hold is that a banner appears -- that is the OS's, and the notifier's own
 * tests (`test/main/notify/notify.test.ts`) hold that the test path writes
 * the error log exactly as a real banner's does.
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NotifyApi } from '../../src/preload/api.js';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { NotifyTest } from '../../src/renderer/settings/NotifyTest.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { PHONE_SECTIONS, SECTIONS } from '../../src/renderer/settings/sections.js';
import type { NotifyVerdict } from '../../src/shared/notify.js';

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: (() => {
      const map = new Map<string, string>();
      return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
        clear: () => map.clear(),
        key: () => null,
        get length() {
          return map.size;
        },
      };
    })() as unknown as Storage,
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function open(prefs: Prefs = EMPTY_PREFS) {
  const onChange = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme="dark" onChange={onChange} onClose={vi.fn()} />);
  return { onChange };
}

/** The overlay at a phone's width: `usePhoneViewport` reads `matchMedia`. */
function onPhone<T>(body: () => T): T {
  const wide = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (media: string) => ({
      media,
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  try {
    return body();
  } finally {
    if (wide === undefined) Reflect.deleteProperty(window, 'matchMedia');
    else Object.defineProperty(window, 'matchMedia', wide);
  }
}

function fakeApi(answer: NotifyVerdict | (() => Promise<NotifyVerdict>)): NotifyApi & {
  readonly test: ReturnType<typeof vi.fn>;
} {
  return {
    show: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
    test: vi.fn(typeof answer === 'function' ? answer : async () => answer),
    onActivated: () => () => {},
  };
}

const button = () => document.querySelector<HTMLButtonElement>('[data-notify-test]');
const outcome = () => document.querySelector('[data-notify-test-outcome]')?.textContent ?? '';

describe('the section', () => {
  it('is in the nav once, between Behaviour and Sessions', () => {
    const ids = SECTIONS.map((section) => section.id);
    expect(ids.filter((id) => id === 'notifications')).toHaveLength(1);
    expect(ids.indexOf('notifications')).toBe(ids.indexOf('behaviour') + 1);
    expect(ids.indexOf('sessions')).toBe(ids.indexOf('notifications') + 1);
  });

  it('draws a panel of its own on the desktop, holding the switch and the button', () => {
    open();
    const panel = document.querySelector('[data-settings-panel="notifications"]');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('[data-settings-heading]')?.textContent).toBe('Notifications');
    expect(panel?.querySelector('[data-switch="notify-waiting"]')).not.toBeNull();
    expect(panel?.querySelector('[data-settings-block="notify-test"]')).not.toBeNull();
    // And it left Behaviour: moved, not duplicated.
    expect(
      document.querySelector('[data-settings-panel="behaviour"] [data-switch="notify-waiting"]'),
    ).toBeNull();
  });

  it('is not on the phone: PHONE_SECTIONS is untouched and the panel is not drawn', () => {
    // Desktop only. The list's own comment says a change to it is a decision,
    // and this section does not make one: a banner is raised by the desktop's
    // main process, which a phone has no bridge to.
    expect(PHONE_SECTIONS).toEqual(['remote']);
    onPhone(() => {
      open();
      expect(document.querySelector('[data-settings-panel="notifications"]')).toBeNull();
      expect(document.querySelector('[data-settings-nav-item="notifications"]')).toBeNull();
      expect(document.querySelector('[data-settings-panel="remote"]')).not.toBeNull();
    });
  });
});

describe('the switch, under its new home', () => {
  const toggle = () => document.querySelector<HTMLElement>('[data-switch="notify-waiting"]');

  it('still round-trips through prefs', () => {
    const { onChange } = open({ ...EMPTY_PREFS, focusView: true });
    expect(toggle()?.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(toggle() as HTMLElement);
    const next = onChange.mock.calls[0]?.[0] as Prefs;
    expect(next.notifyWaiting).toBe(false);
    expect(next.focusView).toBe(true);
    cleanup();
    const again = open({ ...EMPTY_PREFS, notifyWaiting: false });
    expect(toggle()?.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle() as HTMLElement);
    const back = again.onChange.mock.calls[0]?.[0] as Prefs | undefined;
    expect(back?.notifyWaiting).toBe(true);
  });
});

describe('the Test notification button', () => {
  it('is a button, and draws no outcome until pressed', () => {
    render(<NotifyTest api={fakeApi({ kind: 'sent' })} />);
    expect(button()).not.toBeNull();
    expect(button()?.textContent?.toLowerCase()).toContain('test notification');
    expect(document.querySelector('[data-notify-test-outcome]')).toBeNull();
  });

  it('asks main through the bridge exactly once per press', async () => {
    const api = fakeApi({ kind: 'sent' });
    render(<NotifyTest api={api} />);
    expect(api.test).not.toHaveBeenCalled();
    fireEvent.click(button() as HTMLButtonElement);
    await waitFor(() => expect(api.test).toHaveBeenCalledTimes(1));
    // And with NO argument: the renderer chooses neither title nor body.
    expect(api.test.mock.calls[0]).toEqual([]);
  });

  it('says it is waiting while main waits for the OS, and refuses a second press', async () => {
    let answer: (verdict: NotifyVerdict) => void = () => {};
    const api = fakeApi(
      () =>
        new Promise<NotifyVerdict>((resolve) => {
          answer = resolve;
        }),
    );
    render(<NotifyTest api={api} />);
    fireEvent.click(button() as HTMLButtonElement);
    await waitFor(() => expect(button()?.getAttribute('aria-busy')).toBe('true'));
    expect(button()?.disabled).toBe(true);
    expect(outcome().toLowerCase()).toContain('waiting');
    fireEvent.click(button() as HTMLButtonElement);
    expect(api.test).toHaveBeenCalledTimes(1);
    answer({ kind: 'sent' });
    await waitFor(() => expect(button()?.disabled).toBe(false));
  });

  it('sent: says the OS confirmed it, and where to look if nothing appeared', async () => {
    render(<NotifyTest api={fakeApi({ kind: 'sent' })} />);
    fireEvent.click(button() as HTMLButtonElement);
    await waitFor(() => expect(outcome()).not.toBe(''));
    await waitFor(() => expect(outcome().toLowerCase()).not.toContain('waiting'));
    const text = outcome();
    expect(text.toLowerCase()).toContain('sent');
    expect(text).toContain('System Settings');
    expect(text).toContain('Notifications');
    expect(text).toContain('vam');
  });

  it('failed: prints the OS text verbatim', async () => {
    // FALSIFIED BEFORE IT WAS TRUSTED: with the fake answering
    // `{ kind: 'sent' }` instead, this assertion read
    //   expected 'sent. If nothing appeared, look in Sy…' to contain
    //   'Notifications are not allowed for thi…'
    // and went red. The sentence is the OS's, not a paraphrase.
    render(
      <NotifyTest
        api={fakeApi({
          kind: 'failed',
          reason: 'Notifications are not allowed for this application',
        })}
      />,
    );
    fireEvent.click(button() as HTMLButtonElement);
    await waitFor(() =>
      expect(outcome()).toContain('Notifications are not allowed for this application'),
    );
    expect(outcome().toLowerCase()).not.toContain('sent.');
  });

  it('unconfirmed: says vam cannot tell', async () => {
    render(<NotifyTest api={fakeApi({ kind: 'unconfirmed' })} />);
    fireEvent.click(button() as HTMLButtonElement);
    await waitFor(() => expect(outcome().toLowerCase()).toContain('cannot tell'));
    expect(outcome()).toContain('10');
  });

  it('a bridge that rejects is reported as unconfirmed rather than a stuck button', async () => {
    render(
      <NotifyTest
        api={fakeApi(() => Promise.reject(new Error('No handler registered for vam:notify:test')))}
      />,
    );
    fireEvent.click(button() as HTMLButtonElement);
    await waitFor(() => expect(outcome().toLowerCase()).toContain('cannot tell'));
    expect(button()?.disabled).toBe(false);
  });

  it('with no bridge -- a browser tab -- draws no button and says why', () => {
    render(<NotifyTest api={undefined} />);
    expect(button()).toBeNull();
    expect(outcome().toLowerCase()).toContain('desktop');
  });
});
