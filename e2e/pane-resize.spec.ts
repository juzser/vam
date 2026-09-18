/**
 * AC-3 and AC-6 (and AC-2's viewport half) — the parts vitest cannot decide,
 * because happy-dom has no layout engine and does not compile Tailwind
 * (§4.6 of this epic). Real hit-testing, a real pointer drag, the computed
 * hover tint and cursor, and the epic's three screenshots.
 *
 * Runs against the fixture (`?demo=1` → `src/fixtures/demo.ts`), never a
 * live factory — the committed PNGs ship in a public repo (AC-7).
 *
 * Run with the path filter so the factory-dependent `sse-drop.spec.ts`
 * does not also execute (it `test.skip()`s itself when unset, which is a
 * skip, not a pass, but folding it into this run would still muddy the
 * summary):
 *
 *   e2e/node_modules/.bin/playwright test --config=e2e/playwright.config.ts e2e/pane-resize.spec.ts
 */

import { mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.resolve(__dirname, '..', 'docs', 'images');

// The four numbers task-1 exported (`src/prefs/panes.ts`), used here only to
// assert against — this spec does not import app source across the
// e2e/vite boundary.
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const DETAIL_MIN = 320;
const DEFAULT_SIDEBAR = 264;

async function gotoDemo(page: Page): Promise<void> {
  await page.goto('/?demo=1');
  await expect(page.locator('[data-session-row]').first()).toBeVisible();
}

type Box = { x: number; y: number; width: number; height: number };

async function requireBox(locator: ReturnType<Page['locator']>): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('expected a bounding box, got null — the element is not rendered/visible');
  }
  return box;
}

function sidebarAside(page: Page) {
  return page.locator('[data-pane-resize-handle="sidebar"]').locator('xpath=ancestor::aside[1]');
}

/**
 * Which session currently holds the keyboard, read off `[data-row-cursor]`
 * (`SessionList.tsx`) — the marker `onSidebarPick` (`Canvas.tsx`) drives on
 * every row click via `focusSession`.
 *
 * NOT `[data-prompt-target]`. That chip lived in `DetailPanel`'s header and
 * named the session on screen there; the header (status dot, title,
 * project/epic/agent row) was removed whole in #259 ("remove the header,
 * turn views into icons"), which deleted `[data-prompt-target]` with it
 * (`git log -S'data-prompt-target'` on `DetailPanel.tsx`) — its own comment
 * at the time said the guarantee "moves" to `[data-detail-identity]`, and
 * #279 ("the pane loses its... identity row") removed that too, at the
 * operator's further ask. Desktop carries no on-screen text naming the
 * focused session's id anymore; `[data-row-cursor]`, the sidebar's own
 * cursor bar, is what is left.
 */
async function focusedSessionId(page: Page): Promise<string | null> {
  const row = page.locator('[data-session-row]:has([data-row-cursor])');
  if ((await row.count()) === 0) return null;
  return row.first().getAttribute('data-session-row');
}

function detailAside(page: Page) {
  // Not `[data-pane-resize-handle="detail"]` — the 0.2 two-pane migration
  // (#260, `src/renderer/prefs/panes.ts`) left exactly one PaneResizer
  // (`pane="sidebar"`, `Canvas.tsx`); the detail pane fills whatever width
  // the sidebar leaves and was never given a resize handle of its own — its
  // `resizeHandle` prop is passed `null`. `[data-action-pane]` is the detail
  // `<aside>`'s own root marker (`DetailPanel.tsx`), present whether or not
  // any handle names it, so it is the stable way to find this pane.
  return page.locator('[data-action-pane]');
}

test.describe('pane resize — real-browser probes (vam-pane-resize/task-4)', () => {
  test('the 4px zone steals no clicks, at either border, at rest and after a drag (AC-3 a-e)', async ({
    page,
  }) => {
    await gotoDemo(page);

    // --- sidebar border ---
    const sidebarBox = await requireBox(sidebarAside(page));
    const rowBox = await requireBox(page.locator('[data-session-row="crosscheck-2"]'));
    const rowY = rowBox.y + rowBox.height / 2;
    const sidebarRight = sidebarBox.x + sidebarBox.width;

    // (a) "6px inside the border, on a session row" — measured against the
    // shipped layout, the list's own `<ul>` carries `px-2.5` (10px), so a row
    // does not extend within 6px of the aside's right edge; a click at
    // `sidebarRight - 6` lands in that inner padding, on no row at all. The
    // probe is therefore anchored to the row's OWN right edge (a few px
    // inside it, still clearly outside the 4px zone at
    // `[sidebarRight-2, sidebarRight+2]`) rather than to the epic's literal
    // pixel offset from the border — the substantive claim (a click close to
    // the border, on real content, still reaches it) is unchanged.
    await page.mouse.click(rowBox.x + rowBox.width - 4, rowY);
    // Which session the click focused — see `focusedSessionId`'s own
    // comment for why this reads `[data-row-cursor]` and not a text chip.
    await expect.poll(() => focusedSessionId(page)).toBe('crosscheck-2');

    // Return to a known baseline before probing the zone itself.
    await page.locator('[data-session-row="factory-sse-1"]').click();
    await expect.poll(() => focusedSessionId(page)).toBe('factory-sse-1');

    // (b) at `sidebarRight - 1`, inside the 4px zone — no focus change, no
    // text selection, and the zone (not the row underneath) is what the
    // browser says was actually hit.
    const focusBefore = await focusedSessionId(page);
    await page.mouse.click(sidebarRight - 1, rowY);
    expect(await focusedSessionId(page)).toBe(focusBefore);
    const selectionAfterB = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    expect(selectionAfterB).toBe('');
    const hitAtB = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.getAttribute('data-pane-resize-handle') ?? null,
      [sidebarRight - 1, rowY] as const,
    );
    expect(hitAtB).toBe('sidebar');

    // (c) 6px to the detail side of the same border — reaches the DETAIL
    // pane's own content, never the handle. NOT "reaches the canvas,
    // never... the sidebar's own <aside>" (this check's wording before the
    // two-pane migration, #260): that phrasing is from the three-pane world,
    // where a canvas column sat between the sidebar and the detail pane and
    // a point just past the zone landed in neither `<aside>`. `panes.ts`'s
    // own header records that the canvas, and the reservation math that
    // protected it, are gone — "the detail pane... fills everything to the
    // sidebar's right" — so this point now lands INSIDE the detail pane's
    // `<aside>` (`[data-action-pane]`, `DetailPanel.tsx`) directly, by
    // construction, not beside it. Measured: `insideAside` (any `<aside>`,
    // the old assertion's own check) is `true` here today, which is why this
    // now asks the more specific question — the DETAIL aside, not merely
    // some aside — rather than loosen the old boolean to match.
    const reachC = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return {
          hitHandle: el?.closest('[data-pane-resize-handle]') !== null,
          insideDetailAside: el?.closest('[data-action-pane]') !== null,
        };
      },
      [sidebarRight + 6, rowY] as const,
    );
    expect(reachC.hitHandle).toBe(false);
    expect(reachC.insideDetailAside).toBe(true);

    // (d) no overlay at rest, and none survives a completed drag's mouseup.
    expect(await page.locator('[data-pane-resize-overlay]').count()).toBe(0);
    const sHandle = await requireBox(page.locator('[data-pane-resize-handle="sidebar"]'));
    const shx = sHandle.x + sHandle.width / 2;
    const shy = sHandle.y + sHandle.height / 2;
    await page.mouse.move(shx, shy);
    await page.mouse.down();
    await page.mouse.move(shx + 20, shy, { steps: 5 });
    await page.mouse.up();
    expect(await page.locator('[data-pane-resize-overlay]').count()).toBe(0);

    // There used to be a mirrored "(e) detail pane's own left border" block
    // here, probing `[data-pane-resize-handle="detail"]` as an independent
    // zone from the far side. It is gone, not merely renamed: the two-pane
    // migration (#260) left exactly one PaneResizer (`detailAside`'s own
    // comment, above), so "the sidebar's right border" and "the detail
    // pane's left border" are now the SAME physical boundary and the SAME
    // element, not two handles with a canvas between them — a second,
    // independent probe of it would either duplicate (a)-(d) above or assert
    // something the current DOM cannot produce (a `data-pane-resize-handle`
    // value of `'detail'`, which no longer exists; an "outside every
    // `<aside>`" gap on its far side, which (c) above just measured is now
    // false). The one thing that block established beyond (a)-(d) — that
    // content just past the zone, approached from the detail side, is real
    // detail-pane content — (c) now asserts directly, from the sidebar side,
    // since there is no longer a second side to approach it from.
  });

  test('hover tints the handle and the computed cursor is col-resize, both directions (AC-3f)', async ({
    page,
  }) => {
    await gotoDemo(page);
    const handle = page.locator('[data-pane-resize-handle="sidebar"]');
    const box = await requireBox(handle);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Pointer away — transparent at rest.
    await page.mouse.move(10, 10);
    const rest = await handle.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(rest);

    // Pointer over the zone — tinted, and the cursor the browser actually
    // computes is col-resize (not merely the class name — happy-dom cannot
    // tell these apart, which is why this half lives here, not in vitest).
    await page.mouse.move(cx, cy);
    const hover = await handle.evaluate((el) => ({
      bg: getComputedStyle(el).backgroundColor,
      cursor: getComputedStyle(el).cursor,
    }));
    expect(hover.cursor).toBe('col-resize');
    expect(['rgba(0, 0, 0, 0)', 'transparent']).not.toContain(hover.bg);
  });

  test('a real drag changes a real width, it survives a reload, and it stops at the bound (AC-3g)', async ({
    page,
  }) => {
    await gotoDemo(page);
    const handleLocator = page.locator('[data-pane-resize-handle="sidebar"]');
    const before = await requireBox(sidebarAside(page));
    const hb = await requireBox(handleLocator);
    const hx = hb.x + hb.width / 2;
    const hy = hb.y + hb.height / 2;

    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + 80, hy, { steps: 10 });
    await page.mouse.up();

    const afterDrag = await requireBox(sidebarAside(page));
    expect(afterDrag.width - before.width).toBeGreaterThan(70);
    expect(afterDrag.width - before.width).toBeLessThan(90);

    await page.reload();
    await expect(page.locator('[data-session-row]').first()).toBeVisible();
    const afterReload = await requireBox(sidebarAside(page));
    expect(Math.abs(afterReload.width - afterDrag.width)).toBeLessThan(1);

    // Past the bound — stops at MAX, does not run past it.
    const hb2 = await requireBox(page.locator('[data-pane-resize-handle="sidebar"]'));
    await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb2.x + 2000, hb2.y + hb2.height / 2, { steps: 10 });
    await page.mouse.up();
    const afterOver = await requireBox(sidebarAside(page));
    expect(Math.round(afterOver.width)).toBe(SIDEBAR_MAX);
  });

  test('a narrow viewport renders both panes at their MIN and destroys nothing, and writes nothing (AC-2)', async ({
    page,
  }) => {
    await gotoDemo(page);

    // Drag the sidebar off its default first, so "the previously dragged
    // width comes back" is a real assertion rather than a coincidence with
    // the default.
    const hb = await requireBox(page.locator('[data-pane-resize-handle="sidebar"]'));
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 60, hb.y + hb.height / 2, { steps: 5 });
    await page.mouse.up();
    const draggedWidth = (await requireBox(sidebarAside(page))).width;
    expect(Math.abs(draggedWidth - (DEFAULT_SIDEBAR + 60))).toBeLessThan(3);

    const storedBefore = await page.evaluate(() => localStorage.getItem('vam.prefs.v1'));

    // 520px, not 700 — two facts pin this to an EXACT width, not merely a
    // narrow one. (1) `layoutWidths` (`panes.ts`) only floors both panes at
    // their MIN at or below `SIDEBAR_MIN + DETAIL_MIN = 520`
    // (`dragCeiling`'s own comment) — 880 before the two-pane migration
    // (#260) folded the canvas's own reservation out of the formula; this
    // test's 700 predates that migration (last touched at #229) and, at
    // today's threshold, sits ABOVE it, so the sidebar rendered at its
    // dragged 324px, not SIDEBAR_MIN. (2) `usePhoneViewport`
    // (`phone/viewport.ts`) switches the WHOLE SHELL to the phone layout —
    // no `[data-pane-resize-handle]` at all — at `PHONE_MAX_WIDTH = 519`,
    // one pixel BELOW this same 520: "one pixel under
    // [SIDEBAR_MIN + DETAIL_MIN], the columns... cannot exist" (that file's
    // own comment). So 520 is not "narrow enough", it is the single width at
    // which the desktop shell still renders AND both panes are already
    // floored — verified empirically: 500 renders the phone shell instead
    // (this test then times out below, at `sidebarAside`, waiting for a
    // resize handle a phone-width viewport never draws) and 700 renders
    // desktop at the dragged, un-floored width.
    await page.setViewportSize({ width: 520, height: 800 });
    // Let the resize listener's re-render settle.
    await page.waitForTimeout(150);

    const sidebarNarrow = await requireBox(sidebarAside(page));
    const detailNarrow = await requireBox(detailAside(page));
    expect(Math.round(sidebarNarrow.width)).toBe(SIDEBAR_MIN);
    expect(Math.round(detailNarrow.width)).toBe(DETAIL_MIN);
    // The app does not crash or blank at the narrow width.
    await expect(page.locator('[data-session-row]').first()).toBeVisible();

    const storedNarrow = await page.evaluate(() => localStorage.getItem('vam.prefs.v1'));
    expect(storedNarrow).toBe(storedBefore);

    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(150);

    const sidebarWide = await requireBox(sidebarAside(page));
    expect(Math.abs(sidebarWide.width - draggedWidth)).toBeLessThan(2);

    const storedAfter = await page.evaluate(() => localStorage.getItem('vam.prefs.v1'));
    expect(storedAfter).toBe(storedBefore);
  });

  test('the three screenshots — rest, hover, wide (AC-6)', async ({ page }) => {
    mkdirSync(IMAGES_DIR, { recursive: true });
    await gotoDemo(page);

    // rest — handle untouched, nothing drawn.
    await page.mouse.move(10, 10);
    const restPath = path.join(IMAGES_DIR, 'pane-resize-rest.png');
    await page.screenshot({ path: restPath });

    // hover — pointer parked over the sidebar handle, tinted.
    const hb = await requireBox(page.locator('[data-pane-resize-handle="sidebar"]'));
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    const hoverPath = path.join(IMAGES_DIR, 'pane-resize-hover.png');
    await page.screenshot({ path: hoverPath });

    // wide — sidebar dragged wider than 264, which leaves the detail pane
    // correspondingly narrower: the two-pane layout has no canvas absorbing
    // the difference anymore (`panes.ts` — "the detail pane... fills
    // everything to the sidebar's right"), so widening the ONE shared
    // handle is the whole story now. This used to drag a SECOND, independent
    // `[data-pane-resize-handle="detail"]` afterward, to narrow the detail
    // pane further against a literal `408` (`DEFAULT_PANES.detail`, a
    // number that only ever meant anything when a canvas gave the detail
    // pane its own fixed default width to shrink from). Neither survives
    // the two-pane migration (#260): there is no second handle to drag
    // (`detailAside`'s own comment above has the full history), and at this
    // viewport the detail pane's UNDRAGGED width is already nowhere near
    // 408 — it is whatever the window leaves once the sidebar is priced,
    // routinely four figures at a desktop size. So "narrower" is now asked
    // of the one real lever this UI has: narrower than its own width before
    // the drag, not narrower than a constant that stopped describing
    // anything this pane renders.
    await page.mouse.move(10, 10);
    const sHandle = await requireBox(page.locator('[data-pane-resize-handle="sidebar"]'));
    const detailBeforeDrag = await requireBox(detailAside(page));
    await page.mouse.move(sHandle.x + sHandle.width / 2, sHandle.y + sHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(sHandle.x + sHandle.width / 2 + 120, sHandle.y + sHandle.height / 2, {
      steps: 10,
    });
    await page.mouse.up();

    const sidebarWide = await requireBox(sidebarAside(page));
    const detailNarrow = await requireBox(detailAside(page));
    expect(sidebarWide.width).toBeGreaterThan(264);
    expect(detailNarrow.width).toBeLessThan(detailBeforeDrag.width);

    await page.mouse.move(10, 10); // park the pointer away from any handle
    const widePath = path.join(IMAGES_DIR, 'pane-resize-wide.png');
    await page.screenshot({ path: widePath });

    // Explicit file existence, PNG type, size and difference — never a
    // `toHaveScreenshot` baseline, which would auto-create itself on first
    // run and pass forever after.
    for (const p of [restPath, hoverPath, widePath]) {
      const stat = statSync(p);
      expect(stat.size).toBeGreaterThan(10 * 1024);
      const header = readFileSync(p).subarray(0, 8);
      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      expect(Array.from(header)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
    const restBuf = readFileSync(restPath);
    const hoverBuf = readFileSync(hoverPath);
    expect(restBuf.equals(hoverBuf)).toBe(false);
  });
});
