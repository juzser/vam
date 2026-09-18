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
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
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
  icon: null,
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

  it('shows the author, the review decision, the labels and when it last moved', () => {
    draw(list(FULL));
    expect(q('[data-pr-author]')?.textContent).toContain('juzser');
    expect(q('[data-pr-review]')?.textContent?.toLowerCase()).toContain('approved');
    expect(all('[data-pr-label]').map((el) => el.textContent)).toEqual([
      'enhancement',
      'needs review',
    ]);
    // Relative, not an ISO string: the question is "is this fresh".
    expect(q('[data-pr-updated]')?.textContent).toContain('3h');
    expect(q('[data-pr-updated]')?.textContent).not.toContain('T');
  });

  it('keeps the check status exactly as it was', () => {
    draw(list(FULL));
    expect(q('[data-pr-row]')?.getAttribute('data-pr-checks')).toBe('passing');
    expect(q('[data-pr-checks-mark]')).not.toBeNull();
    expect(q('[data-pr-state-label]')?.textContent).toBe('open');
    expect(q('[data-pr-number]')?.textContent).toBe('#411');
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
      '[data-pr-files]',
      '[data-pr-branches]',
      '[data-pr-author]',
      '[data-pr-review]',
      '[data-pr-updated]',
      '[data-pr-label]',
    ]) {
      expect(q(selector), selector).toBeNull();
    }
    // A zero is NOT an absence: a pull request that only deletes still says so.
    cleanup();
    draw(list(makePullRequest({ number: 8, title: 'deletions only', additions: 0, deletions: 4 })));
    expect(q('[data-pr-additions]')?.textContent).toContain('0');
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
