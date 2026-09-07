/**
 * The measurement PR #250 shipped without: real pixel geometry proving the
 * sidebar's branch label (`data-session-branch`) can never overlap the
 * session's age (`data-session-age`), at the sidebar's own narrowest width.
 *
 * PR #250 (`src/renderer/panels/SessionList.tsx`) fixed the operator's
 * report -- "the branch overlaps the timer" -- with `BRANCH_TAIL_MAX_CHARS`,
 * a budget derived arithmetically from `SIDEBAR_MIN` minus the row's own
 * chrome (see that constant's doc comment). Its own unit tests
 * (`test/panels/SessionList.test.tsx`) assert the `truncate` class and an
 * inline `maxWidth` got applied, and that `data-session-age`'s TEXT survives
 * intact -- both necessary, neither the actual claim. `happy-dom`, which
 * those tests run under, computes no real layout at all: it cannot say
 * whether two boxes overlap, only whether a class name is present. This is
 * the one gate that can.
 *
 * THE FIXTURE PROBLEM. `?demo=1` renders `DEMO_MODEL`
 * (`src/renderer/fixtures/demo.ts`), whose four sessions all carry
 * `branch: null` -- there is no way to ask the demo route for a branch name
 * without editing source, which this task is scoped never to do (see
 * `e2e/README.md`'s neighbours on why `e2e/` stays outside the app's own
 * gates). So this intercepts vite's OWN dev-server response for that one
 * module -- `page.route('**\/fixtures/demo.ts', ...)`, the same technique
 * `phone-shell.pw.ts` already uses for `/api/**` -- and rewrites three
 * `branch: null` fields (and one `age` string) to synthetic values before
 * the module ever reaches the page. No app file changes; the served TEXT
 * does, for the lifetime of this one page.
 *
 * THE THREE SHAPES, chosen per the epic's own worst-case comment
 * (`BRANCH_TAIL_MAX_CHARS`'s doc, `SessionList.tsx`):
 *
 *   - `factory-sse-1` -- a branch with NO slash. `splitBranch` makes a
 *     no-slash name 100% tail, the worst case per that function's own
 *     comment, and an ordinary one (a release tag, `main`, anything
 *     unqualified).
 *   - `crosscheck-2` -- several slashes, a long FINAL segment. The head can
 *     shrink to nothing (`flex-1`/`truncate`); only the tail's own cap
 *     stands between this and the age.
 *   - `dogfood-4` -- a long branch AND a wide age string (`999d`, the
 *     four-character worst case the budget's own comment reserves 24px
 *     for) together, so a branch that just barely fits against a SHORT age
 *     cannot pass by accident when the age it will actually sit beside on a
 *     stale session is wider.
 *
 * Run on its own (never inside the git tree that carries live findings, and
 * outside vam's own gates -- see `e2e/README.md`):
 *
 *   e2e/node_modules/.bin/playwright test --config=e2e/playwright.config.ts e2e/branch-overlap.spec.ts
 *
 * MEASURED RESULT, at the shipped `BRANCH_TAIL_MAX_CHARS = 20`: this test is
 * RED, not green. Two of the three cases clear the age with a few pixels to
 * spare (no-slash: +4.7px, long-final-segment: +2.5px), but the third --
 * a capped tail beside `999d`, the age string the budget's own comment
 * reserves 24px for -- overlaps it by a measured 3.27px
 * (`branch.right = 157.17`, `age.left = 153.91`). The 20-character budget
 * was derived against a SHORT age ("12m" in the unit fixture,
 * `test/panels/SessionList.test.tsx`) and does not hold against the
 * longest age the source can actually emit. This is a real, reproducible
 * finding (deterministic across repeated runs, not a rounding artifact) and
 * is reported rather than silently fixed -- this task is scoped to add a
 * test, never to touch `SessionList.tsx`. See the PR description for the
 * numbers and the falsification transcript that surfaced it: the first
 * draft of this test measured `[data-session-branch]`'s own box, which
 * stayed green even with the cap effectively disabled
 * (`BRANCH_TAIL_MAX_CHARS = 80`) because CSS overflow that is not clipped
 * paints past a flex parent's box without ever enlarging it -- the parent's
 * `getBoundingClientRect()` does not grow. Measuring `[data-branch-tail]`
 * itself, the actual right-most painted content, is what turned the
 * falsification genuinely red, and what turned up this real edge case.
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
// shipped 20-character budget, so a correctly-working cap must engage on
// all three; falsifying the cap (see the PR description) turns every one
// of these red.
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
  test('at SIDEBAR_MIN, the branch\'s right edge never crosses the age\'s left edge, for every worst-case shape', async ({
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

      // NOT `[data-session-branch]`'s own box. Falsified first (see the PR
      // description): with the cap defeated, `data-branch-tail` overflows
      // its flex parent WITHOUT changing the parent's own
      // `getBoundingClientRect()` — CSS overflow that is not clipped paints
      // past a box without ever enlarging it. Measuring the parent's box
      // stayed green at `BRANCH_TAIL_MAX_CHARS = 80` even while the tail
      // visibly ran into the age, which is exactly the false pass this
      // falsification step exists to catch. `data-branch-tail` is the
      // right-most content span and always rendered once `branch !== null`
      // (both the capped and uncapped paths draw it — only the class/style
      // differ), so its own box is the real painted right edge.
      const branchBox = await requireBox(row.locator('[data-branch-tail]'));
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
    }

    // Printed for the record — the PR description quotes this run's numbers.
    console.log('measured margins (age.left - branch.right), px:', margins);
  });
});
