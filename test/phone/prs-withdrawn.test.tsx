// @vitest-environment happy-dom

/**
 * THE PRs VIEW IS OFF THE PHONE, AND THERE IS NO BACK DOOR.
 *
 * Operator instruction, after the mobile audit: "cut the PRs view from mobile
 * entirely". The audit's finding is the reason, and it has two halves:
 *
 *  - vam on a phone exists to SEND A PROMPT AND READ THE ANSWER. A list of
 *    pull requests serves neither. It is not even a place a prompt can be
 *    typed -- `drawsComposer` in `tabs.ts` already says so, in the operator's
 *    own words, for the desktop.
 *  - it is the ONLY place a phone can do something IRREVERSIBLE to a real
 *    GitHub repository. `data-pr-merge` merges on GitHub with the operator's
 *    own credentials and `data-pr-delete-branch` deletes a remote branch; vam
 *    can undo neither, and both sit a few pixels from a view switch on a
 *    390px bar.
 *
 * WHY THIS FILE ASSERTS ABSENCE THREE WAYS RATHER THAN ONCE. "The icon is
 * gone" is a fact about a row. A WITHDRAWAL is a fact about every route, and
 * this repo has already shipped one control that was withdrawn from its own
 * list and still reachable by a digit (A5.4, A15.6 -- `tabs.ts`' header). So
 * the routes are enumerated and each is closed against a source that CAN serve
 * pull requests, a session that HAS them, and a desktop bridge that CAN act on
 * them -- never against a fixture that simply has nothing to show.
 *
 * THE THIRD ROUTE IS THE ONE THAT IS EASY TO MISS: `window.api` is absent in
 * the browser build, so a phone over Tailscale Serve draws the list with no
 * controls at all. But `usePhoneViewport` is a MEDIA QUERY, not a build flag
 * (`PHONE_MAX_WIDTH`, 519px), so an Electron window dragged under 519px gets
 * the phone shell WITH the bridge -- and that is the shell where Merge and
 * Delete branch were one tap away. The last describe below installs that
 * bridge on purpose.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Project, Session } from '../../src/renderer/domain/model.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';
import { TABS } from '../../src/renderer/panels/tabs.js';
import type { PrAction } from '../../src/shared/pr-action.js';
import { makePullRequest } from '../support/pull-request.js';
import { FIVE_STEPS, installPhoneGlobals, phoneSource, rows, session, views } from './harness.js';

/**
 * A session with real pull requests in real states, so every absence below is
 * a withdrawal and not an empty list. One open (which is what `mayMerge`
 * wants) and one merged with a head branch (which is what `mayDeleteBranch`
 * wants) -- between them they are the only two rows that can draw the two
 * irreversible controls at all.
 */
const PRS: Session['pullRequests'] = {
  kind: 'ok',
  prs: [
    makePullRequest({ number: 41, title: 'the transport', state: 'open', headRefName: 'feat/sse' }),
    makePullRequest({
      number: 40,
      title: 'the reader',
      state: 'merged',
      headRefName: 'feat/reader',
    }),
  ],
};

/**
 * A source that CAN serve pull requests. The harness defaults `pullRequests`
 * to `false`, which would make every assertion here pass for the wrong reason.
 */
const MODEL_WITH_PRS: CanvasModel = {
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
          pullRequests: PRS,
        }),
        session('a2', { title: 'second thing' }),
      ],
    },
  ],
};

beforeAll(installPhoneGlobals);
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
  Reflect.deleteProperty(window, 'api');
});

/** Screen two, opened the only way a phone can open it: by tapping a row. */
function openSession(): void {
  render(
    <Canvas
      model={MODEL_WITH_PRS}
      source={phoneSource({ capabilities: { pullRequests: true } })}
    />,
  );
  const row = rows()[0];
  if (row === undefined) throw new Error('no session row');
  act(() => {
    fireEvent.click(row);
  });
}

/** What the census below is FOR -- proved reachable before it is trusted. */
const viewNames = () => views().map((b) => b.getAttribute('data-phone-view'));

describe('no route on a phone reaches a PRs pane', () => {
  it('draws no PRs icon, from a source that serves pull requests', () => {
    openSession();
    // THE CENSUS IS PROVED NON-EMPTY FIRST: a selector that matched nothing
    // would report a clean screen and a clean screen is what this asserts.
    expect(viewNames().length, 'the view row was found at all').toBeGreaterThan(0);
    expect(viewNames()).toEqual(['response', 'agents']);
    expect(document.querySelector('[data-phone-view="prs"]')).toBeNull();
  });

  it('draws no PRs pane, and no tab strip that could offer one', () => {
    openSession();
    expect(document.querySelector('[data-prs]')).toBeNull();
    // The body strip is off the phone too, so there is no second row of names.
    expect(document.querySelector('[data-view-tabs]')).toBeNull();
    expect(document.querySelectorAll('[data-view="prs"]')).toHaveLength(0);
  });

  /**
   * TAPPING EVERY ICON THERE IS. Not "tapping the PRs icon fails" -- that
   * control does not exist and a test of it would be a tautology. This walks
   * the whole row and asserts that NO tap anywhere in it lands on a PRs pane,
   * which is the property a withdrawal actually claims.
   */
  it('reaches no PRs pane by tapping any icon the row does offer', () => {
    openSession();
    for (const [index, icon] of views().entries()) {
      act(() => {
        fireEvent.click(icon);
      });
      expect(document.querySelector('[data-prs]'), `after tapping icon ${index}`).toBeNull();
    }
  });

  /**
   * THE PERSISTED PREFERENCE, which is the route that strands rather than the
   * route that acts. `prefs.detailTab` is what the NEXT RUN opens on: an
   * operator who left the desktop on PRs has `"PRs"` in `localStorage`, and a
   * phone that honoured it would open on a view with no icon selected over a
   * pane that is not offered -- a blank screen with no way back but a reload.
   *
   * TWO THINGS MAKE THIS SAFE AND THEY ARE ASSERTED TOGETHER. `PhoneShell`
   * names the pane's tab from its own state, which starts at Response; and
   * `DetailPanel` re-derives `current` from `visibleTabs`, which on a phone no
   * longer contains PRs, so even a tab arriving from somewhere else falls back
   * to Response rather than drawing nothing.
   */
  it('lands on Response when the last desktop view was PRs', () => {
    localStorage.setItem('vam.prefs.v1', JSON.stringify({ detailTab: 'PRs' }));
    openSession();
    expect(viewNames()).toEqual(['response', 'agents']);
    expect(views().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(document.querySelector('[data-prs]'), 'no stranded PRs pane').toBeNull();
    // NOT A BLANK PANE, which is the other half of "somewhere sensible": the
    // session's newest output is on the screen.
    expect(document.querySelector('[data-action-pane]')?.textContent).toContain(
      'the gate said yes',
    );
  });

  it('is unmoved by any other stored view name, including one no vam ever had', () => {
    for (const stored of [...TABS, 'Nonsense']) {
      localStorage.setItem('vam.prefs.v1', JSON.stringify({ detailTab: stored }));
      openSession();
      expect(document.querySelector('[data-prs]'), `stored: ${stored}`).toBeNull();
      expect(document.querySelector('[data-action-pane]'), `stored: ${stored}`).not.toBeNull();
      cleanup();
      localStorage.clear();
    }
  });
});

/**
 * THE TWO IRREVERSIBLE CONTROLS, with a bridge that could really run them.
 *
 * This is the narrow-Electron case described in this file's header: the phone
 * shell is chosen by a media query, so `window.api.prs.act` can be present
 * underneath it. Before this change, a phone-width Electron window drew the
 * PRs icon, and one tap put Merge and Delete branch on a 390px bar beside the
 * close control.
 */
describe('merge and delete-branch cannot be reached from a phone at all', () => {
  const acted: { sessionId: string; action: PrAction }[] = [];

  beforeEach(() => {
    acted.length = 0;
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        prs: {
          open: async (url: string) => ({ ok: true, url }),
          act: async (sessionId: string, action: PrAction) => {
            acted.push({ sessionId, action });
            return { ok: true, message: 'done' };
          },
        },
      },
    });
  });

  /**
   * THE CORPUS, PROVED FIRST. Every assertion below is an ABSENCE, and an
   * absence caused by a fixture that could never have drawn the control is a
   * green test about nothing. So this case draws the SAME session with the
   * SAME bridge on a DESKTOP panel and watches both controls appear. If this
   * one ever goes green-by-emptiness the two after it are worthless, and it
   * is the one that would fail.
   */
  it('the same session and the same bridge DO draw them on a desktop', () => {
    const target = MODEL_WITH_PRS.projects[0]?.sessions[0] as Session;
    render(
      <DetailPanel
        entry={{ project: MODEL_WITH_PRS.projects[0] as Project, session: target }}
        decision={target.decisions[0] ?? null}
        draft=""
        onDraftChange={() => {}}
        onSubmit={() => {}}
        composing={false}
        onCompose={() => {}}
        onStopComposing={() => {}}
        active={false}
        actionIndex={0}
        width={408}
        resizeHandle={null}
        tab="PRs"
      />,
    );
    expect(window.api?.prs?.act, 'the bridge that makes them drawable').toBeTypeOf('function');
    expect(document.querySelector('[data-pr-merge]'), 'Merge, on a desktop').not.toBeNull();
    expect(
      document.querySelector('[data-pr-delete-branch]'),
      'Delete branch, on a desktop',
    ).not.toBeNull();
  });

  /**
   * ASSERTED INSIDE THE LOOP, not after it. Checking once at the end measures
   * only whichever view the LAST tap landed on, which is how a sweep reports a
   * clean screen it never looked at.
   */
  it('draws neither control at any icon the phone row offers', () => {
    openSession();
    expect(views().length, 'the row was found at all').toBeGreaterThan(0);
    for (const [index, icon] of views().entries()) {
      act(() => {
        fireEvent.click(icon);
      });
      const where = `at icon ${index} (${viewNames()[index]})`;
      expect(document.querySelector('[data-pr-merge]'), `Merge ${where}`).toBeNull();
      expect(document.querySelector('[data-pr-delete-branch]'), `Delete ${where}`).toBeNull();
      expect(document.querySelector('[data-pr-actions]'), `the action row ${where}`).toBeNull();
    }
    expect(acted, 'nothing reached the pull-request bridge').toEqual([]);
  });
});
