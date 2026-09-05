/**
 * Is the focus edge actually PAINTED in the canvas column?
 *
 * `test/canvas/Canvas.focus-edge.test.tsx` can say the element is mounted and
 * can read the rule out of `styles.css`, and that is all it can say: happy-dom
 * parses no stylesheet and lays nothing out. "The line is visible in the
 * canvas column" is a claim about pixels, so this measures pixels -- it loads
 * the BUILT page in Chromium, samples the top row of each column against the
 * backdrop three rows below it, and reports the difference.
 *
 * Like everything else in e2e/, this is not part of vam's gates and nothing
 * runs it automatically. Run it by hand when the focus edge or a column's
 * chrome changes:
 *
 *   node_modules/.bin/vite build --config vite.web.config.ts
 *   node_modules/.bin/vite preview --config vite.web.config.ts --port 5399 &
 *   node e2e/focus-edge-visibility.mjs http://localhost:5399/?demo=1
 *
 * `?demo=1` is the committed fixture, which is the only thing safe to point a
 * screenshot at: live mode would put a real workspace on the page.
 */
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5399/?demo=1';
const shot = process.argv[3] ?? null;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-canvas-pane]');
// Well past the 1.4s the sweep used to stop after: whatever moves here moves
// at rest, which is the whole point of the change this was written for.
await page.waitForTimeout(2500);

const mode = await page.evaluate(() => document.querySelector('[data-mode]')?.textContent ?? '');
const running = await page.evaluate(() =>
  Object.fromEntries(
    ['sidebar', 'canvas', 'action'].map((p) => {
      const edge = document.querySelector(`[data-${p}-pane] [data-focus-edge]`);
      if (!edge) return [p, 'no edge mounted'];
      const a = edge.getAnimations({ subtree: true });
      return [p, a.length === 0 ? 'edge present, ZERO animations' : a.map((x) => x.animationName)];
    }),
  ),
);

const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 4 } });
if (shot) await page.screenshot({ path: shot });

// Decode the shot with the browser's own image pipeline -- no extra dependency.
const painted = await page.evaluate(async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const at = (x, y) => {
    const i = (img.width * y + x) << 2;
    return [d[i], d[i + 1], d[i + 2]];
  };
  const report = {};
  for (const p of ['sidebar', 'canvas', 'action']) {
    const col = document.querySelector(`[data-${p}-pane]`);
    if (!col) continue;
    const r = col.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const line = at(x, 0);
    const back = at(x, 3);
    const delta = Math.abs(line[0] - back[0]) + Math.abs(line[1] - back[1]) + Math.abs(line[2] - back[2]);
    report[p] = { x, line: line.join(','), backdrop: back.join(','), delta, painted: delta > 20 };
  }
  return report;
}, `data:image/png;base64,${buf.toString('base64')}`);

console.log(`mode: ${mode}`);
console.log(`animations on each edge: ${JSON.stringify(running)}`);
console.log(`top-row pixels vs backdrop: ${JSON.stringify(painted, null, 1)}`);
await browser.close();
