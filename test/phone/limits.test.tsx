// @vitest-environment happy-dom

/**
 * What this connection cannot do, in the SOURCE'S words.
 *
 * The port already requires every false capability to carry a sentence its own
 * source authored, and until now the renderer read exactly two of them. This
 * test is what keeps that honest: a sentence hard-coded in a component would
 * pass a weaker assertion and fails this one.
 *
 * WHERE IT IS DRAWN HAS MOVED, AND THE TWO HALVES ARE ASSERTED SEPARATELY. It
 * was a `<details>` band above the transcript on the phone's session screen,
 * costing 45px of every session on every real phone -- and 0px under
 * `?demo=1`, which declines nothing, which is why the repo's phone e2e suite
 * never saw what it was spending. It is a standing fact about the CONNECTION
 * rather than about the session on screen, so it lives in the Remote settings
 * section now: the one section whose subject is the desktop rather than the
 * device holding it.
 *
 * Both halves are here because either alone is satisfiable by the wrong
 * change -- a deletion passes "not on the session screen", and a copy passes
 * "in settings".
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import { EMPTY_PREFS } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { installPhoneGlobals, MODEL, phoneSource, rows } from './harness.js';

beforeAll(installPhoneGlobals);
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const TERMINAL_WORDS =
  'vam over HTTP has no terminal: the tmux surface is reachable only from the desktop shell';
const DELIVER_WORDS = 'nothing goes back to the session from here';

/** The overlay opened where the phone's one door lands: the Remote section. */
function openSettings(declines?: Record<string, string>): void {
  render(
    <SettingsOverlay
      prefs={EMPTY_PREFS}
      theme="dark"
      onChange={() => {}}
      onClose={() => {}}
      initialSection="remote"
      declines={declines}
    />,
  );
}

describe('the remote limits list', () => {
  it('prints one line per declined capability, in the source’s own words', () => {
    openSettings({ terminal: TERMINAL_WORDS, deliverPrompt: DELIVER_WORDS });
    const list = document.querySelector('[data-remote-limits]');
    expect(list).not.toBeNull();
    expect(list?.querySelectorAll('[data-remote-limit]')).toHaveLength(2);
    expect(list?.textContent).toContain(TERMINAL_WORDS);
    expect(list?.textContent).toContain(DELIVER_WORDS);
  });

  it('is not drawn at all when the source declares no declines', () => {
    openSettings({});
    expect(document.querySelector('[data-remote-limits]')).toBeNull();
  });

  it('is not drawn when a caller does not say — the same picture, honestly', () => {
    // `declines` is optional on the overlay and `{}` is its default: a source
    // that declines nothing and a caller that has not wired it are the same
    // fact on screen, which is no list.
    openSettings();
    expect(document.querySelector('[data-remote-limits]')).toBeNull();
  });

  it('sizes its own disclosure row for a finger, where the shell used to', () => {
    // The 44px floor it had was `[data-phone-shell] [data-remote-limits]
    // summary` in `styles.css`, and the settings dialog is NOT inside
    // `[data-phone-shell]` -- it is a sibling under the common `.vam-phone`
    // root. So the floor travels with the component, as the `vam-tap` opt-in
    // the stylesheet asks for. The SIZE is `e2e/phone-shell.pw.ts`'s settings
    // census; happy-dom lays nothing out.
    openSettings({ terminal: TERMINAL_WORDS });
    expect(document.querySelector('[data-remote-limits] summary')?.className).toContain('vam-tap');
  });

  it('costs the session screen nothing: it is not drawn there at all', () => {
    render(
      <Canvas model={MODEL} source={phoneSource({ declines: { terminal: TERMINAL_WORDS } })} />,
    );
    const row = rows()[0];
    if (row === undefined) throw new Error('no session row');
    act(() => {
      fireEvent.click(row);
    });
    // The fixture really does decline something -- otherwise this passes
    // against a source with nothing to say and proves nothing.
    expect(document.querySelector('[data-phone-shell="session"]')).not.toBeNull();
    expect(document.querySelector('[data-remote-limits]')).toBeNull();
  });
});
