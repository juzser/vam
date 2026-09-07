/**
 * Real pixel geometry proving the sidebar's branch label
 * (`data-session-branch`) can never overlap the session's age
 * (`data-session-age`), at the sidebar's own narrowest width -- and, since
 * this test's first draft, the reason the fix is a structural CSS clip
 * rather than a character budget.
 *
 * PR #250 (`src/renderer/panels/SessionList.tsx`) first fixed the
 * operator's report -- "the branch overlaps the timer" -- with
 * `BRANCH_TAIL_MAX_CHARS`, a budget derived arithmetically from
 * `SIDEBAR_MIN` minus the row's own chrome. Its own unit tests
 * (`test/panels/SessionList.test.tsx`) assert the `truncate` class and an
 * inline `maxWidth` got applied, and that `data-session-age`'s TEXT
 * survives intact -- both necessary, neither the actual claim: `happy-dom`
 * computes no real layout, so nothing there can say whether two boxes
 * overlap. This is the one gate that can, and measured, the character
 * budget did not hold: `relativeTime` (`src/renderer/adapter/relative-time.ts`)
 * is UNBOUNDED in its day branch and can also return a raw ISO string
 * verbatim on a parse failure, so "the widest age is four characters" was
 * false on its face -- and even against the realistic four-character case
 * (`999d`) the 20-character budget measured 3.27px into the age at
 * `SIDEBAR_MIN`, because `20ch` does not render as an even 120px in this
 * font. See `BRANCH_TAIL_MAX_CHARS`'s doc comment in `SessionList.tsx` for
 * the fix this drove: `data-session-branch` now carries `overflow-hidden`,
 * a hard clip bounded by the row's own flex layout (computed from the
 * age's REAL rendered width, at paint time, in whatever font actually
 * loaded) -- correct at any width, any age string, any font, with no
 * arithmetic that can be wrong. `BRANCH_TAIL_MAX_CHARS` still exists, but
 * only as a PREFERRED ellipsis point now, not the guarantee.
 *
 * THE FIXTURE PROBLEM. `?demo=1` renders `DEMO_MODEL`
 * (`src/renderer/fixtures/demo.ts`), whose four sessions all carry
 * `branch: null` -- there is no way to ask the demo route for a branch name
 * without editing that file, and this test is scoped to add a test only
 * (`SessionList.tsx`'s own fix is the one source change this PR makes, and
 * it is the structural clip above, never a tuned constant). So this
 * intercepts vite's OWN dev-server response for that one module --
 * `page.route('**\/fixtures/demo.ts', ...)`, the same technique
 * `phone-shell.pw.ts` already uses for `/api/**` -- and rewrites three
 * `branch: null` fields (and one `age` string) to synthetic values before
 * the module ever reaches the page. No app file changes; the served TEXT
 * does, for the lifetime of this one page.
 *
 * THE THREE SHAPES, chosen per `BRANCH_TAIL_MAX_CHARS`'s own doc comment
 * (`SessionList.tsx`):
 *
 *   - `factory-sse-1` -- a branch with NO slash. `splitBranch` makes a
 *     no-slash name 100% tail, the worst case per that function's own
 *     comment, and an ordinary one (a release tag, `main`, anything
 *     unqualified).
 *   - `crosscheck-2` -- several slashes, a long FINAL segment. The head
 *     (plain `truncate`, ordinary flex-shrink) gives way first; only the
 *     tail's own clip stands between this and the age.
 *   - `dogfood-4` -- a long branch AND `999d`, the widest age the source
 *     realistically emits day-to-day (see the header above for why the
 *     TRUE ceiling is actually unbounded) -- together, so a branch that
 *     just barely clears a SHORT age cannot pass by accident when the age
 *     it will actually sit beside on a stale session is wider.
 *
 * Run on its own (never inside the git tree that carries live findings, and
 * outside vam's own gates -- see `e2e/README.md`):
 *
 *   e2e/node_modules/.bin/playwright test --config=e2e/playwright.config.ts e2e/branch-overlap.spec.ts
 *
 * WHAT THIS TEST MEASURES AND WHY. `getBoundingClientRect()` on a CHILD
 * element is unaffected by an ancestor's `overflow-hidden` -- the child's
 * own layout box stays whatever its content demands; only what PAINTS
 * changes. Two false starts before this test measured the right thing:
 *
 *   1. First draft measured `[data-session-branch]`'s own box before the
 *      structural fix existed, when that box had no `overflow-hidden` at
 *      all. It stayed green even with the character cap disabled
 *      (`BRANCH_TAIL_MAX_CHARS = 80`) because the box does not enlarge to
 *      contain an overflowing child -- a false pass.
 *   2. Second draft switched to `[data-branch-tail]`, the overflowing
 *      child itself, which correctly went red both before AND after the
 *      structural `overflow-hidden` fix landed on the parent -- because a
 *      CHILD's own `getBoundingClientRect()` does not shrink when an
 *      ancestor clips its paint. Measuring it after the fix would report a
 *      permanent, un-fixable "overlap" that no longer exists on screen.
 *
 * This final version measures `[data-session-branch]` -- the ANCESTOR that
 * now actually carries `overflow-hidden` -- because once painting is
 * clipped there, that ancestor's own box IS the true visible right edge:
 * nothing paints past it anymore, by construction. A `elementFromPoint`
 * hit-test just past that edge is added as an independent proof the clip
 * is real (not merely that the numbers happen to line up): the point must
 * resolve to the age or the gap between them, never to
 * `[data-branch-tail]`, which is exactly what CSS `overflow-hidden` also
 * does to hit-testing.
 */

import { expect, type Page, type Route, test } from '@playwright/test';

const SIDEBAR_MIN = 200;

type Box = { x: number; y: number; width: number; height: number };

async function requireBox(locator: ReturnType<Page['locator']>): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('expected a bounding box, got null — the element is not rendered/visible');
  }
  return box;
}

/**
 * A synthetic branch (and, optionally, age) for one demo session, applied by
 * rewriting the SERVED TEXT of `fixtures/demo.ts` — never the file on disk.
 * Each session id is unique in the fixture (`id: "…"`, vite's own esbuild
 * transform turns the source's single quotes into double), so the search
 * anchors on that and only replaces the `branch: null,`/`age: "…",` field
 * belonging to that one session, not the next one down.
 */
type Override = { readonly sessionId: string; readonly branch: string; readonly age?: string };

function applyOverride(body: string, override: Override): string {
  const idMarker = `"${override.sessionId}"`;
  const idIdx = body.indexOf(idMarker);
  if (idIdx === -1) {
    throw new Error(`session ${override.sessionId} not found in the served fixture`);
  }

  const branchMarker = 'branch: null,';
  const branchIdx = body.indexOf(branchMarker, idIdx);
  if (branchIdx === -1) {
    throw new Error(`"branch: null," not found after ${override.sessionId}`);
  }
  let out =
    body.slice(0, branchIdx) +
    `branch: ${JSON.stringify(override.branch)},` +
    body.slice(branchIdx + branchMarker.length);

  if (override.age !== undefined) {
    const ageRe = /age: "[^"]*",/;
    const tail = out.slice(idIdx);
    const match = ageRe.exec(tail);
    if (match === null) {
      throw new Error(`age field not found after ${override.sessionId}`);
    }
    const ageIdx = idIdx + match.index;
    out = out.slice(0, ageIdx) + `age: ${JSON.stringify(override.age)},` + out.slice(ageIdx + match[0].length);
  }
  return out;
}

async function gotoDemoWithBranches(page: Page, overrides: readonly Override[]): Promise<void> {
  await page.route('**/fixtures/demo.ts', async (route: Route) => {
    const response = await route.fetch();
    let body = await response.text();
    for (const override of overrides) {
      body = applyOverride(body, override);
    }
    await route.fulfill({ response, body, headers: response.headers() });
  });
  await page.goto('/?demo=1');
  await expect(page.locator('[data-session-row]').first()).toBeVisible();
}

// The three worst-case shapes `BRANCH_TAIL_MAX_CHARS`'s own doc comment
// argues from — see the file header. Every tail below is well past the
// shipped 20-character preferred cut point, so the structural clip is what
// this test is actually proving holds, on all three.
const NO_SLASH_TAIL = 'release-no-slash-branch-name-well-past-budget';
const LONG_FINAL_SEGMENT = 'smith/specs/vam-canvas-topology-constraints-and-more-detail-past-budget';
const WIDE_AGE_BRANCH = 'smith/specs/another-quite-long-final-segment-name-here-too';
const WIDE_AGE = '999d';

const CASES: readonly { readonly name: string; readonly override: Override }[] = [
  {
    name: 'a no-slash branch (100% tail, splitBranch\'s own worst case)',
    override: { sessionId: 'factory-sse-1', branch: NO_SLASH_TAIL },
  },
  {
    name: 'several slashes, a long final segment',
    override: { sessionId: 'crosscheck-2', branch: LONG_FINAL_SEGMENT },
  },
  {
    name: 'a long branch paired with the widest realistic age string',
    override: { sessionId: 'dogfood-4', branch: WIDE_AGE_BRANCH, age: WIDE_AGE },
  },
];

test.describe('sidebar branch label never overlaps the session age — real geometry (PR #250 follow-up)', () => {
  test('at SIDEBAR_MIN, the clipped branch never crosses the age, for every worst-case shape', async ({
    page,
  }) => {
    await gotoDemoWithBranches(
      page,
      CASES.map((c) => c.override),
    );

    // The resizer's floor, not a comfortable width — the bug lives here.
    // The same technique `pane-resize.spec.ts` uses to force both panes to
    // their MIN: shrink the viewport until the resize listener's own
    // re-render settles at the bound.
    await page.setViewportSize({ width: 700, height: 800 });
    await page.waitForTimeout(150);

    const sidebarAside = page
      .locator('[data-pane-resize-handle="sidebar"]')
      .locator('xpath=ancestor::aside[1]');
    const sidebarBox = await requireBox(sidebarAside);
    expect(Math.round(sidebarBox.width)).toBe(SIDEBAR_MIN);

    const margins: Record<string, number> = {};

    for (const { name, override } of CASES) {
      const row = page.locator(`[data-session-row="${override.sessionId}"]`);
      await expect(row).toBeVisible();
      const rowBox = await requireBox(row);

      // `[data-session-branch]` — now carrying `overflow-hidden`
      // (`SessionList.tsx`) — not `[data-branch-tail]`. See the file header
      // for why the tail's own box is the WRONG element to measure once the
      // clip exists: a child's `getBoundingClientRect()` does not shrink
      // when an ancestor clips its paint, so it would report a permanent,
      // un-fixable "overlap" for content nothing on screen actually shows
      // anymore. The clipping ancestor's own box is the true visible edge.
      const branchBox = await requireBox(row.locator('[data-session-branch]'));
      const ageBox = await requireBox(row.locator('[data-session-age]'));

      // The actual claim: the branch's right edge stops before the age's
      // left edge starts. Not merely "does not visually overlap" -- crossing
      // by even a fraction of a pixel is the operator's exact complaint.
      const margin = ageBox.x - (branchBox.x + branchBox.width);
      margins[override.sessionId] = margin;
      expect(margin, `${name}: branch (right=${branchBox.x + branchBox.width}) vs age (left=${ageBox.x})`).toBeGreaterThanOrEqual(0);

      // A naive overlap check passes trivially if the age has been squeezed
      // to nothing or pushed out of its own row — the same bug wearing a
      // different mask. Both are ruled out explicitly.
      expect(ageBox.width, `${name}: age box width`).toBeGreaterThan(0);
      expect(ageBox.x, `${name}: age left edge inside row`).toBeGreaterThanOrEqual(rowBox.x);
      expect(ageBox.x + ageBox.width, `${name}: age right edge inside row`).toBeLessThanOrEqual(
        rowBox.x + rowBox.width + 0.5, // sub-pixel layout rounding
      );
      expect(ageBox.y, `${name}: age top edge inside row`).toBeGreaterThanOrEqual(rowBox.y);
      expect(ageBox.y + ageBox.height, `${name}: age bottom edge inside row`).toBeLessThanOrEqual(
        rowBox.y + rowBox.height + 0.5,
      );

      // Independent proof the clip is REAL, not a coincidence of these
      // particular numbers: a point 2px to the right of the branch box's
      // own edge — still left of the age — must not hit-test into
      // `[data-branch-tail]`. `overflow-hidden` clips hit-testing exactly
      // as it clips paint, so if the tail's oversized content were still
      // reachable there, the clip would not be doing what this test claims.
      const probeX = branchBox.x + branchBox.width + 2;
      const probeY = branchBox.y + branchBox.height / 2;
      const hitTail = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-branch-tail]') !== null,
        [probeX, probeY] as const,
      );
      expect(hitTail, `${name}: a point just past the clip must not hit the tail`).toBe(false);
    }

    // Printed for the record — the PR description quotes this run's numbers.
    console.log('measured margins (age.left - branch.right), px:', margins);
  });
});
