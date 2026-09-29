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
import type {
  AgentQuestion,
  CanvasModel,
  Decision,
  Session,
} from '../../src/renderer/domain/model.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
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
    // OPENED, because a menu that is shut renders no items and a sweep over
    // what is on screen would be green having examined none of them. The
    // per-project "new session" is a 19px `+` on the heading again (its own
    // `data-new-session-in-project` hook, swept by `sizedControls()` below
    // with no menu open at all) -- what is still only reachable through this
    // menu is rename, collapse, icon and worktree, so those four are why the
    // sweep still needs the menu open.
    act(() => {
      (document.querySelector('[data-phone-shell] [data-project-menu]') as HTMLElement).click();
    });
    const controls = sizedControls();
    // Two rules answer for this between them, and the split is the point. The
    // shell's own header, footer and chips are ENUMERATED in `styles.css`; the
    // project icon, collapse, menu and the project menu's own items below
    // belong to `SessionList`, and each opts in at the component by wearing
    // `vam-tap`. Every one of the hosted ones measured under 44 at 390px while
    // the enumeration alone was green -- and widening the enumeration to
    // `[data-phone-shell] button` is not the fix: that form burst a 21px
    // heading row by reaching markup it could not know the shape of. What this
    // assertion holds is the OUTCOME, so either mistake fails it.
    expect(controls.length).toBeGreaterThan(5);
    for (const hook of [
      'data-project-icon',
      'data-project-collapse',
      'data-project-menu',
      'data-project-menu-item',
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
        // THE ONE NAMED EXCEPTION: `[data-phone-toolbar]` (the Orca one-row
        // pass's own toolbar, `data-projects-header` on a phone) floors at
        // 30px, not 44 -- the operator's own follow-up request, after
        // looking at the shipped screenshot, to tighten this one row's
        // spacing. `sizedFloor` below is what states and checks the number;
        // this filter only carves the row out of the blanket floor so it is
        // judged against ITS OWN rule instead of silently exempted from
        // every rule.
        if (el.closest('[data-phone-toolbar]') !== null) return false;
        return cs.minHeight !== '44px' || cs.minWidth !== '44px';
      })
      .map((el) => `${el.tagName} ${el.getAttribute('aria-label') ?? ''}`);
    expect(missed, 'controls the 44px rule does not reach').toEqual([]);
  });

  it('floors the toolbar row at 30px instead of 44, at the operator’s own request', () => {
    // WCAG 2.2 SC 2.5.8 (AA, the level this repo must clear) sets a 24px
    // floor; SC 2.5.5 (AAA, the aspirational one `TOUCH_MIN` above cites)
    // asks for 44. This row trades the AAA figure for a denser toolbar on
    // the operator's own explicit instruction -- "reduce the spacing... ≤4px
    // between icons, compact ~28-32px painted icons" -- and stays 6px clear
    // of the AA floor this repo still has to clear. Every OTHER phone
    // control keeps 44; this is the one named, deliberate exception.
    phone();
    const toolbar = document.querySelector('[data-phone-toolbar]');
    expect(toolbar, 'the phone toolbar row').not.toBeNull();
    const toolbarControls = [
      ...(toolbar as HTMLElement).querySelectorAll('button, [role="button"]'),
    ].filter((el) => getComputedStyle(el).display !== 'none');
    expect(toolbarControls.length, 'controls inside the toolbar row').toBeGreaterThan(4);
    const wrong = toolbarControls
      .filter((el) => {
        const cs = getComputedStyle(el);
        return cs.minHeight !== '30px' || cs.minWidth !== '30px';
      })
      .map((el) => `${el.tagName} ${el.getAttribute('aria-label') ?? ''}`);
    expect(wrong, 'toolbar controls not floored at 30px').toEqual([]);
    // The two controls promoted out of the removed 3-dots menu must be in that
    // swept set, so the sweep cannot pass by never seeing them.
    for (const hook of ['data-remote-toggle', 'data-theme-toggle']) {
      const btn = (toolbar as HTMLElement).querySelector(`[${hook}]`);
      expect(btn, hook).not.toBeNull();
      expect(toolbarControls, `${hook} in the 30px sweep`).toContain(btn);
    }
  });

  it('floors the key-strip chips at 30px while an ordinary phone tap target stays 44px', () => {
    // The strip's painted chip is 30px; the blanket 44px floor drew ~7px of
    // invisible padding a side around it (~18px between painted chips). Same
    // named exception as the toolbar row, enumerated by `[data-key-strip]`.
    const decision: Decision = {
      id: 'd1',
      label: 'plan',
      input: 'ask',
      output: 'ok',
      commands: [],
    };
    const sess: Session = {
      id: 's1',
      title: 'sess',
      epic: null,
      branch: null,
      status: 'idle',
      runningAgents: 0,
      activity: null,
      age: '1m',
      decisions: [decision],
      vamControlled: true,
    };
    const props = {
      entry: { project: { id: 'p1', name: 'atlas', sessions: [sess] }, session: sess },
      decision,
      draft: '',
      onDraftChange: () => {},
      onSubmit: () => {},
      composing: false,
      onCompose: () => {},
      onStopComposing: () => {},
      active: false,
      actionIndex: 0,
      width: 390,
      resizeHandle: null,
      phone: true,
      delivers: true,
      terminal: true,
      pickImageAttachment: async () => null,
      onSetDefaultProvider: () => {},
    } satisfies DetailPanelProps;
    render(
      <div data-phone-shell className="vam-phone">
        <DetailPanel {...props} />
      </div>,
    );
    const keys = [...document.querySelectorAll('[data-key-strip] button')];
    expect(keys.length, 'key-strip buttons').toBeGreaterThan(3);
    const wrong = keys
      .filter((el) => {
        const cs = getComputedStyle(el);
        return cs.minHeight !== '30px' || cs.minWidth !== '30px';
      })
      .map((el) => el.getAttribute('data-key-strip-key') ?? el.tagName);
    expect(wrong, 'strip buttons not floored at 30px').toEqual([]);
    const composerTap = document.querySelector('[data-composer-bar] textarea');
    expect(composerTap, 'an ordinary vam-tap outside the strip').not.toBeNull();
    const cs = getComputedStyle(composerTap as Element);
    expect([cs.minHeight, cs.minWidth]).toEqual(['44px', '44px']);
  });

  it('does not leak the 30px floor into the workspace-options popover it opens', () => {
    // FALSIFIED ONCE ALREADY: the popover (`data-filter-menu`) is a DOM
    // sibling drawn inside this same `[data-phone-toolbar]` row (it anchors
    // to the row's own left edge), so a selector that floors "every
    // `.vam-tap` under the toolbar" at 30px catches the popover's own Group
    // by pills and Sort by/Hide-agent-worktrees rows too -- caught for real
    // by `e2e/workspace-options-shots.mjs`'s "every control clears the 44px
    // phone tap floor" on the real render, at 30px where it used to read
    // 44. Those controls are not the toolbar's own seven; they keep 44.
    phone();
    act(() => {
      (document.querySelector('[data-phone-shell] [data-group-toggle]') as HTMLElement).click();
    });
    const menu = document.querySelector('[data-filter-menu]');
    expect(menu, 'the workspace-options popover').not.toBeNull();
    const menuControls = [
      ...(menu as HTMLElement).querySelectorAll('button, [role="radio"]'),
    ].filter((el) => getComputedStyle(el).display !== 'none');
    expect(menuControls.length, 'controls inside the popover').toBeGreaterThan(4);
    const wrong = menuControls
      .filter((el) => {
        const cs = getComputedStyle(el);
        return cs.minHeight !== '44px' || cs.minWidth !== '44px';
      })
      .map((el) => `${el.tagName} ${el.getAttribute('aria-label') ?? el.textContent ?? ''}`);
    expect(wrong, 'popover controls dragged down to the toolbar’s own 30px floor').toEqual([]);
  });

  it('removes the hover-revealed close control rather than leaving it invisible', () => {
    phone();
    // `opacity: 0` removes no pointer events: revealed only by
    // `group-hover/row`, which a coarse pointer can never satisfy, that button
    // sat invisible over the row's own tap area.
    const rowCloses = [
      ...document.querySelectorAll("[data-phone-shell] button[aria-label^='close ']"),
    ].filter((el) => !el.hasAttribute('data-swipe-trash'));
    expect(rowCloses.length).toBeGreaterThan(0);
    for (const el of rowCloses) expect(getComputedStyle(el).display).toBe('none');
  });

  it('keeps the revealed swipe trash visible and above the 44px floor', () => {
    phone();
    const row = document.querySelector('[data-session-row]') as Element;
    act(() => {
      fireEvent.pointerDown(row, { clientX: 300, clientY: 100, pointerId: 1 });
      fireEvent.pointerMove(row, { clientX: 200, clientY: 100, pointerId: 1 });
      fireEvent.pointerUp(row, { clientX: 200, clientY: 100, pointerId: 1 });
    });
    const trash = document.querySelector('[data-swipe-trash]');
    expect(trash).not.toBeNull();
    // It reads `close session`, so the hide rule above would take it without
    // its exemption -- and then the swipe would reveal nothing.
    expect(trash?.getAttribute('aria-label')).toBe('close session');
    const cs = getComputedStyle(trash as Element);
    expect(cs.display).not.toBe('none');
    expect([cs.minHeight, cs.minWidth]).toEqual(['44px', '44px']);
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
