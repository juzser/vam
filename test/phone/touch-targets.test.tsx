// @vitest-environment happy-dom

/**
 * The phone shell's hit areas, resolved against the RENDERED tree.
 *
 * WHY THIS FILE STOPPED READING BYTES. Until now it asserted that `styles.css`
 * CONTAINED two rules. A content scan proves a rule was typed; it cannot prove
 * the rule matches anything -- and one of the two matched nothing at all. It
 * read `[data-phone-shell] [data-session-row] button[aria-label^='close ']`,
 * and the row's `x` is a SIBLING of `[data-session-row]`, not a descendant, so
 * the control this repo removed on purpose stayed hittable at 390px for a
 * whole release behind a green assertion about the stylesheet's contents.
 *
 * So the stylesheet is loaded into the document and every question below is
 * put to the CASCADE about an actual node. happy-dom matches selectors and
 * resolves the cascade, which is what settles "does this rule apply"; it lays
 * nothing out, so it cannot settle "how big is this box". That is Playwright's,
 * at a real 390px, in `e2e/phone-shell.pw.ts` -- which measures the same two
 * properties as geometry and hit-testing.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { AgentQuestion, CanvasModel } from '../../src/renderer/domain/model.js';
import { FIVE_STEPS, installPhoneGlobals, MODEL, phoneSource, session } from './harness.js';

const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');

beforeAll(() => {
  installPhoneGlobals();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
});
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const QUESTION = (id: string, header: string): AgentQuestion => ({
  id,
  header,
  question: `Which ${header.toLowerCase()} do you prefer?`,
  multiSelect: false,
  options: [{ label: 'one', description: null }],
  answer: null,
});

/** A call carrying TWO questions, which is what draws `data-question-steps`. */
const ASKING: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [
        session('a1', {
          title: 'nightly sweep',
          status: 'waiting',
          decisions: FIVE_STEPS,
          questions: [QUESTION('t:0', 'Colour'), QUESTION('t:1', 'Fruit')],
        }),
      ],
    },
  ],
};

const phone = () =>
  render(<Canvas model={MODEL} source={phoneSource({ closeSession: async () => {} })} />);

/** Everything the 44px rule claims, asked of the tree rather than of the file. */
const sizedControls = () => [
  ...document.querySelectorAll(
    '[data-phone-shell] button, [data-phone-shell] summary,' +
      ' [data-phone-shell] [role="button"],' +
      ' [data-phone-shell] input:not([type="file"]), [data-phone-shell] textarea',
  ),
];

describe('the phone shell’s hit areas', () => {
  it('gives every control it renders a 44px floor, hosted panels included', () => {
    phone();
    const controls = sizedControls();
    // Two rules answer for this between them, and the split is the point. The
    // shell's own header, footer and chips are ENUMERATED in `styles.css`; the
    // project icon, collapse, menu and per-project new session below belong to
    // `SessionList`, and each opts in at the component by wearing `vam-tap`.
    // Every one of the hosted ones measured under 44 at 390px while the
    // enumeration alone was green -- and widening the enumeration to
    // `[data-phone-shell] button` is not the fix: that form burst a 21px
    // heading row by reaching markup it could not know the shape of. What this
    // assertion holds is the OUTCOME, so either mistake fails it.
    expect(controls.length).toBeGreaterThan(5);
    for (const hook of [
      'data-project-icon',
      'data-project-collapse',
      'data-project-menu',
      'data-new-session-in-project',
      'data-session-row',
    ]) {
      expect(document.querySelector(`[data-phone-shell] [${hook}]`), hook).not.toBeNull();
    }
    const missed = controls
      .filter((el) => {
        const cs = getComputedStyle(el);
        // A control the phone does not draw at all has no hit area to be
        // wrong about -- the row's close `x` is `display: none` here on
        // purpose, and the test below is what holds that.
        if (cs.display === 'none') return false;
        return cs.minHeight !== '44px' || cs.minWidth !== '44px';
      })
      .map((el) => `${el.tagName} ${el.getAttribute('aria-label') ?? ''}`);
    expect(missed, 'controls the 44px rule does not reach').toEqual([]);
  });

  it('removes the hover-revealed close control rather than leaving it invisible', () => {
    phone();
    // `opacity: 0` removes no pointer events: revealed only by
    // `group-hover/row`, which a coarse pointer can never satisfy, that button
    // sat invisible over the row's own tap area.
    const rowCloses = [
      ...document.querySelectorAll("[data-phone-shell] button[aria-label^='close ']"),
    ].filter((el) => !el.hasAttribute('data-phone-close'));
    expect(rowCloses.length).toBeGreaterThan(0);
    for (const el of rowCloses) expect(getComputedStyle(el).display).toBe('none');
  });

  it('leaves the session bar’s own close control alone, label and all', () => {
    phone();
    act(() => {
      fireEvent.click(document.querySelector('[data-session-row]') as Element);
    });
    const close = document.querySelector('[data-phone-close]');
    expect(close).not.toBeNull();
    // It reads `close session`, so the rule above would take it too without
    // its exemption -- and then a phone would have no way to close one.
    expect(close?.getAttribute('aria-label')).toMatch(/^close /);
    expect(getComputedStyle(close as Element).display).not.toBe('none');
  });

  it('sets 16px on every box you type in, which is the iOS zoom threshold', () => {
    phone();
    act(() => {
      fireEvent.click(document.querySelector('[data-session-row]') as Element);
    });
    const typed = [
      ...document.querySelectorAll('[data-phone-shell] input, [data-phone-shell] textarea'),
    ];
    expect(typed.length).toBeGreaterThan(0);
    for (const el of typed) expect(getComputedStyle(el).fontSize).toBe('16px');
  });

  it('draws no view tabs at all, and leaves the question strip alone while typing', () => {
    // WAS: `.vam-phone-typing [data-view-tabs] { display: none }` hides the
    // view tab bar while the keyboard is up. The bar is not rendered on a
    // phone any more, so that rule matched nothing and went with it -- a rule
    // that matches nothing is indistinguishable from a rule that works.
    //
    // What is still worth measuring is the half that rule kept getting wrong:
    // `data-question-steps`, the strip that chooses WHICH question of a
    // multi-question call you are answering, must stay visible while you type
    // -- an earlier `[role='tablist']` form took it away at exactly the moment
    // it was needed. Nothing may hide it now either.
    //
    // The typing STATE is put on by hand here: this fixture draws no composer,
    // so there is no box to focus. That costs nothing, because the state is one
    // `typing` flag writing both `vam-phone-typing` and `data-phone-keyboard`
    // onto the same element, and `PhoneShell.anchor.test.tsx` already drives
    // that flag from a real focus and asserts the attribute.
    render(<Canvas model={ASKING} source={phoneSource()} />);
    act(() => {
      fireEvent.click(document.querySelector('[data-session-row]') as Element);
    });
    // Set BEFORE anything is read: happy-dom snapshots an element's computed
    // style on first read.
    (document.querySelector('[data-phone-shell]') as HTMLElement).classList.add('vam-phone-typing');
    expect(document.querySelector('[data-view-tabs]'), 'the view tab bar').toBeNull();
    const strip = document.querySelector('[data-question-steps]') as HTMLElement;
    expect(strip, 'a two-question call draws the strip').not.toBeNull();
    expect(
      getComputedStyle(strip).display,
      'the strip that chooses WHICH question you are answering, while typing',
    ).not.toBe('none');
  });
});
