// @vitest-environment happy-dom

/**
 * WHAT A PULL REQUEST ROW SHOWS, WHERE IT GOES, AND WHAT IT CAN DO -- the
 * three things the operator reported missing on 2026-09-18, reviewing this
 * tab: it does not show line changes, it needs more information, clicking a
 * pull request does not link to its detail, and there are no actions yet.
 *
 * `prs.open` and `prs.act` are read off `window.api` INSIDE `DetailPanel`, the
 * idiom the Files and Terminal tabs already use, so every test here installs a
 * bridge on the window rather than passing a prop. That is not incidental: the
 * BROWSER BUILD HAS NO `window.api` AT ALL, and the last describe block below
 * asserts what that absence draws -- a list that still reads, with no controls
 * that could not act.
 *
 * THE ACTIONS ARE ASSERTED FOR WHAT THEY DO NOT DO as much as for what they
 * do. A merge is irreversible and runs against the operator's real
 * repositories: so nothing is spawned before a confirm that names the pull
 * request, cancelling spawns nothing at all, a draft is not offered a merge,
 * and a second click while one is in flight is refused in words rather than
 * quietly dropped.
 */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, PullRequest, Session } from '../../src/renderer/domain/model.js';
import {
  DetailPanel,
  type DetailPanelProps,
  PR_SPLIT_PX,
} from '../../src/renderer/panels/DetailPanel.js';
import type { PrAction, PrActionOutcome } from '../../src/shared/pr-action.js';
import type { PrLinkOutcome } from '../../src/shared/pr-link.js';
import { makePullRequest } from '../support/pull-request.js';

const DECISION: Decision = {
  id: 'd1',
  label: 'step 1',
  input: 'ask',
  output: 'answered',
  commands: [],
};

const BASE: Session = {
  id: 's1',
  title: 'atlas work',
  epic: null,
  branch: 'feature/atlas',
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '12m',
  decisions: [DECISION],
};

class FakeResizeObserver {
  constructor(readonly callback: () => void) {}
  observe() {}
  disconnect() {}
}

type Bridge = {
  open?: (url: string) => Promise<PrLinkOutcome>;
  act?: (sessionId: string, action: PrAction) => Promise<PrActionOutcome>;
};

const opened: string[] = [];
const acted: { sessionId: string; action: PrAction }[] = [];

function withBridge(bridge: Bridge = {}) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      prs: {
        open: async (url: string) => {
          opened.push(url);
          return (await bridge.open?.(url)) ?? { ok: true, url };
        },
        act: async (sessionId: string, action: PrAction) => {
          acted.push({ sessionId, action });
          return (await bridge.act?.(sessionId, action)) ?? { ok: true, message: 'done' };
        },
      },
    },
  });
}

beforeEach(() => {
  opened.length = 0;
  acted.length = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  withBridge();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'api');
  vi.unstubAllGlobals();
});

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const all = (selector: string) => [...document.querySelectorAll(selector)];

function draw(prs: Session['pullRequests'], over: Partial<DetailPanelProps> = {}) {
  const session: Session = { ...BASE, ...(prs === undefined ? {} : { pullRequests: prs }) };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  const props: DetailPanelProps = {
    entry: { project, session },
    decision: DECISION,
    draft: '',
    onDraftChange: () => {},
    onSubmit: () => {},
    composing: false,
    onCompose: () => {},
    onStopComposing: () => {},
    active: false,
    actionIndex: 0,
    width: 408,
    resizeHandle: null,
    ...over,
  };
  render(<DetailPanel {...props} />);
  act(() => {
    q<HTMLButtonElement>('[data-view="prs"]')?.click();
  });
}

const FULL = makePullRequest({
  number: 411,
  title: 'The prompt row, the settings split',
  state: 'open',
  checks: 'passing',
  additions: 6269,
  deletions: 317,
  changedFiles: 76,
  headRefName: 'smith/atlas/tab-shell',
  baseRefName: 'main',
  author: 'juzser',
  review: 'approved',
  updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  labels: ['enhancement', 'needs review'],
  url: 'https://github.com/juzser/atlas/pull/411',
  mergeable: 'mergeable',
});

const list = (...prs: readonly ReturnType<typeof makePullRequest>[]): Session['pullRequests'] => ({
  kind: 'ok',
  prs,
});

describe('the information a row carries', () => {
  it('shows the line changes as a plus and a minus, which is the operator’s own ask', () => {
    draw(list(FULL));
    expect(q('[data-pr-additions]')?.textContent).toContain('6269');
    expect(q('[data-pr-additions]')?.textContent).toContain('+');
    expect(q('[data-pr-deletions]')?.textContent).toContain('317');
    // The MINUS SIGN, not a hyphen: `−` is what a diff reads as beside a `+`.
    expect(q('[data-pr-deletions]')?.textContent).toMatch(/[−-]/);
  });

  it('shows how many files moved', () => {
    draw(list(FULL));
    expect(q('[data-pr-files]')?.textContent).toContain('76');
  });

  it('shows where it goes, head then base', () => {
    draw(list(FULL));
    const branches = q('[data-pr-branches]')?.textContent ?? '';
    expect(branches).toContain('smith/atlas/tab-shell');
    expect(branches).toContain('main');
    // The ORDER is the sentence: this branch INTO that one.
    expect(branches.indexOf('smith/atlas/tab-shell')).toBeLessThan(branches.indexOf('main'));
  });

  it('shows the author, the labels and when it last moved', () => {
    draw(list(FULL));
    expect(q('[data-pr-author]')?.textContent).toContain('juzser');
    expect(all('[data-pr-label]').map((el) => el.textContent)).toEqual([
      'enhancement',
      'needs review',
    ]);
    // Relative, not an ISO string: the question is "is this fresh".
    expect(q('[data-pr-updated]')?.textContent).toContain('3h');
    expect(q('[data-pr-updated]')?.textContent).not.toContain('T');
  });

  /**
   * THE REVIEW DECISION IS NOT A PAINTED WORD ANY MORE, and this is the test
   * that says where it went rather than letting it disappear.
   *
   * `review required` is GitHub's default for every open pull request with a
   * reviewer requested: it is implied by `open`, it never changes a decision,
   * and it was the field doing most of the wrapping in the rail. `approved`
   * says what `open` + `checks pass` already says. So the rail draws ONE word
   * -- the most severe live blocker -- and both review words move to the row
   * control's accessible name, where they cost no pixels and no `innerText`.
   */
  it('keeps the review decision in the row’s accessible sentence, not on the rail', () => {
    draw(list(FULL));
    expect(q('[data-pr-review]')).toBeNull();
    expect(q('[data-pr-verdict]')?.textContent).toBe('checks pass');
    expect(q('[data-pr-open]')?.getAttribute('aria-label')).toContain('approved');

    cleanup();
    draw(list(makePullRequest({ ...FULL, review: 'review-required' })));
    expect(q('[data-pr-verdict]')?.textContent).toBe('checks pass');
    expect(q('[data-pr-open]')?.getAttribute('aria-label')).toContain('review required');
    expect(q('[data-prs]')?.textContent ?? '').not.toContain('review required');
  });

  /**
   * THE LADDER ORDERS, IT DOES NOT CONCATENATE. One slot, one word, and the
   * word is the blocker that is in the way next -- which is only a testable
   * claim on a row that has SEVERAL things wrong with it at once.
   */
  it('draws the most severe live blocker and only that one', () => {
    const cases: readonly (readonly [Partial<PullRequest>, string])[] = [
      // Everything wrong at once: the conflict is the one that stops a merge.
      [{ mergeable: 'conflicting', review: 'changes-requested', checks: 'failing' }, 'conflicts'],
      // No conflict, so the review outranks the checks below it.
      [
        { mergeable: 'mergeable', review: 'changes-requested', checks: 'failing' },
        'changes requested',
      ],
      [{ review: 'review-required', checks: 'failing' }, 'checks fail'],
      [{ review: 'approved', checks: 'pending' }, 'checks running'],
      [{ review: 'approved', checks: 'passing' }, 'checks pass'],
      [{ checks: 'none' }, 'no checks'],
    ];
    for (const [over, word] of cases) {
      cleanup();
      draw(list(makePullRequest({ ...FULL, ...over })));
      expect(all('[data-pr-verdict]'), JSON.stringify(over)).toHaveLength(1);
      expect(q('[data-pr-verdict]')?.textContent, JSON.stringify(over)).toBe(word);
    }
  });

  it('keeps the check status exactly as it was', () => {
    draw(list(FULL));
    expect(q('[data-pr-row]')?.getAttribute('data-pr-checks')).toBe('passing');
    expect(q('[data-pr-checks-mark]')).not.toBeNull();
    expect(q('[data-pr-state-label]')?.textContent).toBe('open');
    expect(q('[data-pr-number]')?.textContent).toBe('#411');
  });

  /**
   * THE MARK IS A SHAPE, AND `none` IS NO LONGER INVISIBLE.
   *
   * It was four 6px discs differing only in hue -- the thing `status-mark.tsx`
   * exists to forbid -- and one of the four could not be seen at all:
   * `bg-line-strong` on `bg-card` measures 1.713:1 in dark and 1.457:1 in
   * light against WCAG 1.4.11's 3:1 for a non-text mark. The CONTRAST is
   * measured as paint in `e2e/prs-tab-shots.mjs`, which is the only place it
   * can be; what is answerable here is that the mark is a glyph, that the four
   * verdicts do not draw the same one, and that no background is carrying the
   * meaning any more.
   */
  it('draws the checks verdict as a glyph rather than a coloured disc', () => {
    const marks = new Map<string, string>();
    for (const checks of ['passing', 'failing', 'pending', 'none'] as const) {
      cleanup();
      draw(list(makePullRequest({ ...FULL, checks })));
      const mark = q('[data-pr-checks-mark]');
      expect(mark, checks).not.toBeNull();
      expect(mark?.querySelector('svg'), checks).not.toBeNull();
      // The ink is a `color`, not a fill: a `bg-*` here would be the disc back.
      expect(mark?.className ?? '', checks).not.toContain('bg-');
      marks.set(checks, mark?.innerHTML ?? '');
    }
    // Four verdicts, four different shapes -- not one shape recoloured.
    expect(new Set(marks.values()).size).toBe(4);
  });

  /**
   * ABSENT, NOT BLANK. Every added field is `| null` because gh may not have
   * said, and `null` must draw NOTHING -- not "+0", not an empty pill, not a
   * dangling arrow. A row built with no overrides is exactly what the reader
   * produces from an older gh's payload, so this is a real shape.
   */
  it('draws nothing at all for a field gh did not answer', () => {
    draw(list(makePullRequest({ number: 7, title: 'a minimal row' })));
    expect(q('[data-pr-row]')).not.toBeNull();
    for (const selector of [
      '[data-pr-additions]',
      '[data-pr-deletions]',
      '[data-pr-diff]',
      '[data-pr-files]',
      '[data-pr-branches]',
      '[data-pr-author]',
      '[data-pr-updated]',
      '[data-pr-label]',
    ]) {
      expect(q(selector), selector).toBeNull();
    }
    // THE TWO THAT ARE ALWAYS DRAWN, and it is not an exception to the rule
    // above: neither is a field gh may decline to answer. A state is a state,
    // and the verdict's own bottom rung is `no checks`, which is the answer
    // for a repository that runs none.
    expect(q('[data-pr-state-label]')?.textContent).toBe('open');
    expect(q('[data-pr-verdict]')?.textContent).toBe('no checks');
    // A zero is NOT an absence: a pull request that only deletes still says so.
    cleanup();
    draw(list(makePullRequest({ number: 8, title: 'deletions only', additions: 0, deletions: 4 })));
    expect(q('[data-pr-additions]')?.textContent).toContain('0');
    expect(q('[data-pr-diff]')?.textContent).toContain('+0');
  });
});

describe('clicking a pull request opens it', () => {
  it('hands the address to the browser through the bridge', async () => {
    draw(list(FULL));
    await act(async () => {
      q<HTMLButtonElement>('[data-pr-open]')?.click();
    });
    expect(opened).toEqual(['https://github.com/juzser/atlas/pull/411']);
  });

  /**
   * A ROW VAM WOULD REFUSE TO OPEN IS NOT A CONTROL. The reader already drops
   * an address that is not https on github.com (`pull-requests.ts`), so `null`
   * here is the ordinary shape for "there is nothing to open", and drawing a
   * button that refuses when pressed is this file's own rule broken: absent,
   * not dimmed.
   */
  it('draws no link at all when there is no address to open', () => {
    draw(list(makePullRequest({ number: 9, title: 'no address', url: null })));
    expect(q('[data-pr-row]')).not.toBeNull();
    expect(q('[data-pr-open]')).toBeNull();
  });

  it('says so when the browser refused, rather than looking like it worked', async () => {
    withBridge({ open: async () => ({ ok: false, reason: 'vam could not get a browser.' }) });
    draw(list(FULL));
    await act(async () => {
      q<HTMLButtonElement>('[data-pr-open]')?.click();
    });
    await waitFor(() => expect(q('[data-pr-note]')?.textContent).toContain('could not get a'));
  });
});

describe('merging, and the confirm in front of it', () => {
  const openPr = makePullRequest({
    number: 411,
    title: 'The prompt row',
    state: 'open',
    url: 'https://github.com/juzser/atlas/pull/411',
    headRefName: 'feature/x',
    baseRefName: 'main',
  });

  it('offers a merge on an open pull request', () => {
    draw(list(openPr));
    expect(q('[data-pr-merge]')).not.toBeNull();
  });

  /**
   * NOT ON A DRAFT, AND NOT ON SOMETHING ALREADY DECIDED. A draft is an
   * explicit "not yet" from its author; a merged or closed pull request has
   * nothing to merge. In every case the control is WITHDRAWN rather than
   * disabled.
   */
  it('offers no merge on a draft, a merged or a closed pull request', () => {
    for (const state of ['draft', 'merged', 'closed'] as const) {
      cleanup();
      draw(list(makePullRequest({ ...openPr, state })));
      expect(q('[data-pr-merge]'), state).toBeNull();
    }
  });

  it('spawns nothing until the operator confirms, and names the pull request while asking', () => {
    draw(list(openPr));
    act(() => {
      q<HTMLButtonElement>('[data-pr-merge]')?.click();
    });
    const confirm = q('[data-confirm-pr-action]');
    expect(confirm).not.toBeNull();
    // THE NUMBER AND THE TITLE, both, in the question itself: "are you sure?"
    // over an unnamed row is not adequate for something irreversible.
    expect(confirm?.textContent).toContain('411');
    expect(confirm?.textContent).toContain('The prompt row');
    expect(acted).toEqual([]);
  });

  it('runs the merge once confirmed, naming the session and the method', async () => {
    draw(list(openPr));
    act(() => {
      q<HTMLButtonElement>('[data-pr-merge]')?.click();
    });
    await act(async () => {
      q<HTMLButtonElement>('[data-confirm-pr-action-go]')?.click();
    });
    expect(acted).toEqual([
      { sessionId: 's1', action: { kind: 'merge', number: 411, method: 'squash' } },
    ]);
  });

  it('runs nothing when the operator cancels, and closes the question', () => {
    draw(list(openPr));
    act(() => {
      q<HTMLButtonElement>('[data-pr-merge]')?.click();
    });
    act(() => {
      q<HTMLButtonElement>('[data-confirm-pr-action-cancel]')?.click();
    });
    expect(q('[data-confirm-pr-action]')).toBeNull();
    expect(acted).toEqual([]);
  });

  it('escapes out of the question without acting', () => {
    draw(list(openPr));
    act(() => {
      q<HTMLButtonElement>('[data-pr-merge]')?.click();
    });
    act(() => {
      const dialog = q('[data-confirm-pr-action]');
      if (dialog !== null) fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    expect(q('[data-confirm-pr-action]')).toBeNull();
    expect(acted).toEqual([]);
  });

  it('shows gh’s own sentence when the merge fails, not a house one', async () => {
    withBridge({
      act: async () => ({
        ok: false,
        code: 'gh-failed',
        message: 'merge #411 failed: Pull request is not mergeable: the base branch was modified.',
      }),
    });
    draw(list(openPr));
    act(() => {
      q<HTMLButtonElement>('[data-pr-merge]')?.click();
    });
    await act(async () => {
      q<HTMLButtonElement>('[data-confirm-pr-action-go]')?.click();
    });
    await waitFor(() =>
      expect(q('[data-pr-note]')?.textContent).toContain('the base branch was modified'),
    );
  });

  /**
   * THE SECOND CLICK. A merge waits on GitHub, so the button is slow, so it
   * gets pressed again. Main's runner refuses a second write outright; this is
   * the half that must be visible -- a refusal the operator can READ, not a
   * click that vanishes.
   */
  it('refuses a second action aloud while one is in flight', async () => {
    let release = (_: PrActionOutcome) => {};
    withBridge({ act: () => new Promise<PrActionOutcome>((resolve) => (release = resolve)) });
    draw(list(openPr));
    act(() => {
      q<HTMLButtonElement>('[data-pr-merge]')?.click();
    });
    await act(async () => {
      q<HTMLButtonElement>('[data-confirm-pr-action-go]')?.click();
    });
    expect(acted).toHaveLength(1);

    act(() => {
      q<HTMLButtonElement>('[data-pr-merge]')?.click();
    });
    await waitFor(() => expect(q('[data-pr-note]')?.textContent).toMatch(/already|wait/i));
    // And it opened no second question and ran no second action.
    expect(q('[data-confirm-pr-action]')).toBeNull();
    expect(acted).toHaveLength(1);

    await act(async () => {
      release({ ok: true, message: 'merged' });
    });
  });
});

describe('deleting the branch', () => {
  const merged = makePullRequest({
    number: 97,
    title: 'Carry the branch to the sidebar',
    state: 'merged',
    headRefName: 'feature/done',
    baseRefName: 'main',
  });

  it('offers the delete on a pull request that is finished with its branch', () => {
    draw(list(merged));
    expect(q('[data-pr-delete-branch]')).not.toBeNull();
  });

  /**
   * NOT WHILE IT IS OPEN. Deleting the head branch of an OPEN pull request
   * closes that pull request on GitHub -- so a button labelled "delete branch"
   * would silently be a second, unannounced "close this pull request". Two
   * acts behind one word is not a thing this pane offers.
   */
  it('offers no delete while the pull request is still open or a draft', () => {
    for (const state of ['open', 'draft'] as const) {
      cleanup();
      draw(list(makePullRequest({ ...merged, state })));
      expect(q('[data-pr-delete-branch]'), state).toBeNull();
    }
  });

  it('offers no delete when vam does not know the branch name', () => {
    draw(list(makePullRequest({ ...merged, headRefName: null })));
    expect(q('[data-pr-delete-branch]')).toBeNull();
  });

  it('names the branch in the question, and deletes only once confirmed', async () => {
    draw(list(merged));
    act(() => {
      q<HTMLButtonElement>('[data-pr-delete-branch]')?.click();
    });
    expect(q('[data-confirm-pr-action]')?.textContent).toContain('feature/done');
    expect(acted).toEqual([]);
    await act(async () => {
      q<HTMLButtonElement>('[data-confirm-pr-action-go]')?.click();
    });
    expect(acted).toEqual([
      { sessionId: 's1', action: { kind: 'delete-branch', branch: 'feature/done' } },
    ]);
  });
});

describe('a build with no bridge', () => {
  /**
   * THE BROWSER BUILD AND THE PHONE. `window.api` is the Electron shell's, so
   * neither has one -- and these channels are deliberately not on
   * `remote/server.ts`'s table either: a paired phone authenticated once over
   * the network must not be able to merge the operator's pull requests.
   *
   * What must survive that absence is the LIST, which is read through the
   * source and works everywhere. What must not appear is a control that
   * cannot act.
   */
  it('still draws every row and its information, with no controls', () => {
    Reflect.deleteProperty(window, 'api');
    draw(list(FULL));
    expect(q('[data-pr-row]')).not.toBeNull();
    expect(q('[data-pr-additions]')?.textContent).toContain('6269');
    expect(q('[data-pr-open]')).toBeNull();
    expect(q('[data-pr-merge]')).toBeNull();
    expect(q('[data-pr-delete-branch]')).toBeNull();
  });
});

/**
 * THE ROW HAS TWO SIDES: WHAT THE PULL REQUEST IS, AND WHAT STATE IT IS IN.
 *
 * The operator's ask on 2026-09-19 was to separate the information and split
 * it left and right. The split is not decoration: a fifteen-fact row stacked
 * in one column makes the reader scan every line to find the one fact they
 * came for. Identity goes LEFT -- title, number, branches, author, labels,
 * the facts that do not change while the pull request is open. Status goes
 * RIGHT -- state, checks, the diff, review, conflicts, freshness, and the two
 * controls that act on them.
 *
 * WHAT IS ASSERTED HERE AND WHAT IS NOT. This environment performs NO LAYOUT,
 * so "to the right" is unanswerable here and is measured as rectangles in
 * `e2e/prs-tab-shots.mjs`. What IS answerable is which side each field is on
 * -- the claim a later edit would silently break by moving one field back
 * across the seam.
 */
describe('the two sides of a row', () => {
  const inSide = (side: string, selector: string) => q(`[data-pr-${side}] ${selector}`) !== null;

  it('puts what the pull request IS on the left', () => {
    draw(list(FULL));
    for (const selector of [
      '[data-pr-title]',
      '[data-pr-number]',
      '[data-pr-branches]',
      '[data-pr-author]',
      '[data-pr-label]',
      // THE AGE CROSSED THE SEAM, and it is on this list rather than the one
      // below because of what it IS: a fact about the row, not a magnitude of
      // the diff. It was the third quantity on the rail's number line, sharing
      // one size and one gap with `+6269 −317` and `76 files`; it now sits
      // where `SessionList.tsx` already puts an age, at the end of the meta
      // line, after a `·`.
      '[data-pr-updated]',
    ]) {
      expect(inSide('identity', selector), selector).toBe(true);
      expect(inSide('status', selector), `${selector} must not be on the right`).toBe(false);
    }
  });

  it('puts what STATE it is in on the right', () => {
    draw(list(makePullRequest({ ...FULL, mergeable: 'conflicting' })));
    for (const selector of [
      '[data-pr-state-label]',
      // `[data-pr-checks-label]`, `[data-pr-review]` and `[data-pr-mergeable]`
      // were three of the four words this line used to name. They are one slot
      // now: `[data-pr-verdict]` draws the most severe live blocker and
      // nothing else -- `conflicts` on this very row, which is what the
      // `mergeable: 'conflicting'` override above is here to produce.
      '[data-pr-verdict]',
      '[data-pr-diff]',
      '[data-pr-additions]',
      '[data-pr-deletions]',
      '[data-pr-files]',
      '[data-pr-merge]',
    ]) {
      expect(inSide('status', selector), selector).toBe(true);
      expect(inSide('identity', selector), `${selector} must not be on the left`).toBe(false);
    }
    expect(q('[data-pr-verdict]')?.textContent).toBe('conflicts');
  });

  /**
   * TRUNCATED, WITH SOMEWHERE TO READ THE REST. Both sides are narrower than
   * the old single column, so both of these can clip -- and a truncated name
   * with no `title` behind it is information the pane HAD and threw away.
   */
  it('keeps the whole title and the whole branch pair reachable', () => {
    draw(list(FULL));
    expect(q('[data-pr-title]')?.className).toContain('truncate');
    expect(q('[data-pr-title]')?.getAttribute('title')).toBe(FULL.title);
    expect(q('[data-pr-branches]')?.className).toContain('truncate');
    expect(q('[data-pr-branches]')?.getAttribute('title')).toBe('smith/atlas/tab-shell → main');
  });

  /** The split is a CONTAINER query: a 320px pane may be narrower than a phone. */
  it('asks its own box how wide it is, not the viewport', () => {
    draw(list(FULL));
    expect(q('[data-pr-row]')?.className).toContain('@container');
    expect(q('[data-pr-split]')?.className).toContain(`@min-[${PR_SPLIT_PX}px]:flex-row`);
  });
});

/**
 * MERGE IS GREEN, AND IT IS GREY ONLY WHEN GITHUB ACTUALLY SAID SO.
 *
 * `mergeable` HAS THREE VALUES AND THIS IS THE WHOLE TEST. GitHub computes
 * mergeability lazily, so `UNKNOWN` -- read as `null` -- is what MOST rows
 * carry: a button greyed on `null` would refuse a legitimate merge on nearly
 * every pull request the operator owns. Only the literal `'conflicting'` may
 * grey it, and when it does the control STAYS ON SCREEN and says why, because
 * this repo's rule for a case GitHub has already ruled on is DISABLED, NOT
 * ABSENT -- the same bargain `data-model-picker-state="disabled"` makes.
 *
 * The COLOUR is measured as paint in `e2e/prs-tab-shots.mjs`; what is pinned
 * here is the state machine behind it.
 */
describe('the colour and the state of the merge control', () => {
  const openPr = makePullRequest({
    number: 411,
    title: 'The prompt row',
    state: 'open',
    url: 'https://github.com/juzser/atlas/pull/411',
    headRefName: 'feature/x',
    baseRefName: 'main',
  });

  it('is offered and actionable when GitHub says it merges', () => {
    draw(list(makePullRequest({ ...openPr, mergeable: 'mergeable' })));
    const merge = q<HTMLButtonElement>('[data-pr-merge]');
    expect(merge?.getAttribute('data-pr-merge-state')).toBe('ready');
    expect(merge?.disabled).toBe(false);
  });

  /**
   * THE ONE THAT MATTERS. `null` is "GitHub has not computed it", the ordinary
   * state of an open pull request nobody has asked about yet.
   */
  it('is offered and actionable when GitHub has not said — which is most rows', () => {
    draw(list(makePullRequest({ ...openPr, mergeable: null })));
    const merge = q<HTMLButtonElement>('[data-pr-merge]');
    expect(merge?.getAttribute('data-pr-merge-state')).toBe('ready');
    expect(merge?.disabled).toBe(false);
  });

  it('is drawn grey and refuses, naming the reason, only on a real conflict', () => {
    draw(list(makePullRequest({ ...openPr, mergeable: 'conflicting' })));
    const merge = q<HTMLButtonElement>('[data-pr-merge]');
    // THERE, not gone: a withdrawn control says "there is no action here",
    // which is false -- there is one, blocked on a cause that has a name.
    expect(merge).not.toBeNull();
    expect(merge?.getAttribute('data-pr-merge-state')).toBe('conflicting');
    expect(merge?.disabled).toBe(true);
    expect(merge?.getAttribute('aria-disabled')).toBe('true');
    // AND IT SAYS WHY, on a stop the keyboard can reach -- a disabled button
    // takes no focus and no pointer events, so the note hangs on its wrapper.
    const note = q('[data-pr-merge-note]');
    expect(note?.getAttribute('data-note')).toMatch(/conflict/i);
    expect(note?.getAttribute('tabindex')).toBe('0');
  });

  it('spawns no question when the greyed control is pressed anyway', () => {
    draw(list(makePullRequest({ ...openPr, mergeable: 'conflicting' })));
    act(() => {
      q<HTMLButtonElement>('[data-pr-merge]')?.click();
    });
    expect(q('[data-confirm-pr-action]')).toBeNull();
    expect(acted).toEqual([]);
  });

  /**
   * TWO CONTROLS THAT DO OPPOSITE THINGS MUST NOT LOOK THE SAME AT REST. They
   * were byte-identical until now -- `border-line … text-ink-dim` on both --
   * and differed only on hover, which is a distinction a reader gets only
   * after they have already reached for one of them.
   */
  it('draws Merge and Delete branch differently before either is touched', () => {
    // The SKIN, not the hit box: the hit box is a 44px-on-a-phone envelope
    // and carries no colour by design (`PR_ACTION_HIT`), so comparing those
    // two strings would compare the one part of the pair that is shared.
    draw(list(makePullRequest({ ...openPr, mergeable: 'mergeable' })));
    const merge = q('[data-pr-merge] [data-tap-skin]')?.className ?? '';
    cleanup();
    draw(list(makePullRequest({ ...openPr, state: 'merged', headRefName: 'feature/x' })));
    const del = q('[data-pr-delete-branch] [data-tap-skin]')?.className ?? '';
    expect(merge).not.toBe('');
    expect(del).not.toBe('');
    // The REST ink of each, with every `hover:` and `focus` rule stripped, is
    // what an untouched eye sees.
    const rest = (cls: string) =>
      cls
        .split(/\s+/)
        .filter((c) => !c.startsWith('hover:') && !c.startsWith('focus'))
        .join(' ');
    expect(rest(merge)).not.toBe(rest(del));
  });

  /**
   * BIGGER, AND ON THE RIGHT -- the operator's second report on this row.
   *
   * The old chips were `px-2 py-0.5 text-meta`, and `--text-meta` is the type
   * scale's own FLOOR, documented there as "chrome ANNOTATING what is being
   * read" and "never the only thing in its container". A control that merges
   * somebody's pull request was being drawn at the size of a timestamp.
   *
   * THE PAIR OF BOXES IS THE POINT. `vam-tap` is this repo's per-control
   * opt-in to the phone's 44px floor, and `data-tap-pill` is the half that
   * keeps a WORD from being clamped into the 30x30 square the shared skin
   * rule pins every icon skin to -- the failure that a `getBoundingClientRect`
   * check asking only "is it at least 44?" stays green through. Both boxes
   * are then measured as real rectangles at 390px in `e2e/prs-tab-shots.mjs`.
   */
  for (const [what, pr, hook] of [
    ['Merge', makePullRequest({ ...openPr, mergeable: 'mergeable' }), 'data-pr-merge'],
    ['the greyed Merge', makePullRequest({ ...openPr, mergeable: 'conflicting' }), 'data-pr-merge'],
    [
      'Delete branch',
      makePullRequest({ ...openPr, state: 'merged', headRefName: 'feature/x' }),
      'data-pr-delete-branch',
    ],
  ] as const) {
    it(`draws ${what} as a 44-on-a-phone hit box around a word-shaped skin`, () => {
      draw(list(pr));
      const button = q(`[${hook}]`);
      expect(button?.classList.contains('vam-tap'), 'the phone 44px floor is opted into').toBe(
        true,
      );
      const skin = q(`[${hook}] [data-tap-skin]`);
      expect(skin, 'the paint comes inward from a skin').not.toBeNull();
      expect(skin?.hasAttribute('data-tap-pill'), 'a skin holding a word is a pill').toBe(true);
      // The size the operator asked to grow, and NOT the scale's floor.
      expect(skin?.className).toContain('text-control');
      expect(skin?.className).not.toContain('text-meta');
      // And it is on the RIGHT: inside the status rail, never the identity.
      expect(q(`[data-pr-status] [${hook}]`)).not.toBeNull();
      expect(q(`[data-pr-identity] [${hook}]`)).toBeNull();
    });
  }
});
