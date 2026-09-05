// @vitest-environment happy-dom

/**
 * What this connection cannot do, in the SOURCE'S words.
 *
 * The port already requires every false capability to carry a sentence its own
 * source authored, and until now the renderer read exactly two of them. This
 * test is what keeps that honest: a sentence hard-coded in the phone shell
 * would pass a weaker assertion and fails this one.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
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

function openWith(declines: Record<string, string>): void {
  render(<Canvas model={MODEL} source={phoneSource({ declines })} />);
  const row = rows()[0];
  if (row === undefined) throw new Error('no session row');
  act(() => {
    fireEvent.click(row);
  });
}

describe('the remote limits list', () => {
  it('prints one line per declined capability, in the source’s own words', () => {
    openWith({ terminal: TERMINAL_WORDS, deliverPrompt: DELIVER_WORDS });
    const list = document.querySelector('[data-remote-limits]');
    expect(list).not.toBeNull();
    expect(list?.querySelectorAll('[data-remote-limit]')).toHaveLength(2);
    expect(list?.textContent).toContain(TERMINAL_WORDS);
    expect(list?.textContent).toContain(DELIVER_WORDS);
  });

  it('is not drawn at all when the source declares no declines', () => {
    openWith({});
    expect(document.querySelector('[data-remote-limits]')).toBeNull();
  });
});
