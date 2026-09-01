/**
 * Pan/zoom invariance for the relocated status-filter pills
 * (roadmap item `vam-filter-on-canvas`).
 *
 * happy-dom, which every unit test in `test/` runs under, has no layout
 * engine — it cannot report a real `getBoundingClientRect()` before or after
 * a drag, so it cannot answer "did panning move this element". This spec
 * drives a real Chromium against vam's own dev server (`?demo=1`) and
 * measures it directly: drag the ReactFlow pane by a known offset, assert a
 * pill's bounding box is byte-identical, then zoom (wheel) and assert the
 * same. A canvas node's own bounding box is measured alongside as a control
 * — proving the drag and the zoom actually moved/scaled the graph, so an
 * unchanged pill position is not an artifact of a no-op gesture.
 *
 * Like the other specs in this directory, `vitest.config.ts`, `tsconfig*.json`
 * and `biome.json` exclude `e2e/` — nothing in vam's own gates re-runs this.
 * Re-run it by hand after any change to `Canvas.tsx`'s `Panel` usage.
 */

import { expect, test } from '@playwright/test';

test('the status pills stay fixed under pan and zoom; a canvas node does not', async ({
  page,
}) => {
  await page.goto('/?demo=1');
  await page.waitForLoadState('networkidle');

  const pill = page.locator('[data-status-pill="all"]');
  const node = page.locator('.react-flow__node').first();
  const pane = page.locator('.react-flow__pane');

  const pillBefore = await pill.boundingBox();
  const nodeBefore = await node.boundingBox();
  expect(pillBefore).not.toBeNull();
  expect(nodeBefore).not.toBeNull();

  const paneBox = await pane.boundingBox();
  expect(paneBox).not.toBeNull();
  if (paneBox === null) throw new Error('unreachable');
  const startX = paneBox.x + paneBox.width / 2;
  const startY = paneBox.y + paneBox.height / 2;
  const dx = 220;
  const dy = 140;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const pillAfterPan = await pill.boundingBox();
  const nodeAfterPan = await node.boundingBox();

  // Control: the drag must have actually panned the graph, or an unchanged
  // pill position would prove nothing.
  expect(nodeAfterPan?.x).toBeCloseTo((nodeBefore?.x ?? 0) + dx, 0);
  expect(nodeAfterPan?.y).toBeCloseTo((nodeBefore?.y ?? 0) + dy, 0);
  expect(pillAfterPan).toEqual(pillBefore);

  await page.mouse.move(startX, startY);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(200);

  const pillAfterZoom = await pill.boundingBox();
  const nodeAfterZoom = await node.boundingBox();

  // Control: zoom must have actually scaled the graph.
  expect(nodeAfterZoom?.width).not.toBeCloseTo(nodeAfterPan?.width ?? 0, 0);
  expect(pillAfterZoom).toEqual(pillBefore);
});
