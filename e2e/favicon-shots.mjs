/**
 * The favicon, measured as pixels at the two sizes a browser paints it.
 *
 * THE FINDING. `src/renderer/public/favicon.png` was a straight reduction of
 * the 1024px app icon, and the mark did not survive the trip. Its quiet nodes
 * are drawn with a 14-unit stroke, which is 0.44 of a pixel at 32 and 0.22 at
 * 16, so the ring averages into the background instead of being drawn:
 * measured on the file that shipped, the brightest pixel of either quiet node
 * reached 2.31:1 against the background at 32px and 1.79:1 at 16px, against
 * the 4.4:1 the artwork's own `#6e6d6d` would give. The dotted edge and the
 * two gaussian blurs went the same way, leaving the amber node as the only
 * thing in the square above 2:1 -- the mark read as one orange spot.
 *
 * WHAT IS ASSERTED is the pixel, never the file. `build/favicon.svg` is the
 * small mark's source, but a guard that measured the SVG would be measuring
 * geometry no browser ever paints; this fetches the asset the built page
 * actually links and rasterises it at 16 and 32 the way a tab does. The
 * 1024px `build/icon.png` is untouched by all of this and is not measured
 * here: at that size every one of those details is legible.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/favicon-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

/**
 * The floor the quiet nodes must clear, and it is not invented here: WCAG
 * 1.4.11 asks 3:1 of the visual information that identifies a component, and
 * a node in a three-node mark is exactly that. The artwork's own grey gives
 * 4.4:1 when it is actually drawn, so this is the mark being rendered rather
 * than a new demand made of it.
 */
const QUIET_NODE_FLOOR = 3;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
// A real page, so `Image` has an origin to load the asset from.
await page.goto(`${origin}/?demo=1`, { waitUntil: 'domcontentloaded' });

/** Rasterise the served favicon at `size` and bucket every pixel. */
async function measure(size) {
  return page.evaluate(async (s) => {
    const lum = ([r, g, b]) => {
      const f = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const img = new Image();
    img.src = '/favicon.png';
    await img.decode();
    const natural = [img.naturalWidth, img.naturalHeight];
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, s, s);
    const d = ctx.getImageData(0, 0, s, s).data;
    const quiet = [];
    const amber = [];
    const back = [];
    for (let i = 0; i < d.length; i += 4) {
      const p = [d[i], d[i + 1], d[i + 2]];
      // Warm pixels are the lit node and its beams; everything else that is
      // brighter than the near-black ground is a quiet node.
      if (p[0] - p[2] > 40) amber.push(p);
      else if (Math.max(...p) >= 34) quiet.push(p);
      else back.push(p);
    }
    const brightest = (arr) => arr.reduce((a, b) => (lum(b) > lum(a) ? b : a), [0, 0, 0]);
    const mean = (arr) =>
      arr.length === 0
        ? [0, 0, 0]
        : [0, 1, 2].map((k) => Math.round(arr.reduce((t, p) => t + p[k], 0) / arr.length));
    return {
      natural,
      background: mean(back),
      backgroundCount: back.length,
      quiet: { count: quiet.length, brightest: brightest(quiet) },
      amber: { count: amber.length, brightest: brightest(amber) },
    };
  }, size);
}

function ratio(a, b) {
  const lum = ([r, g, bl]) => {
    const f = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

for (const size of [16, 32]) {
  const m = await measure(size);
  if (m.natural[0] !== 32 || m.natural[1] !== 32) {
    throw new Error(`the served favicon is ${m.natural.join('x')}, not the 32x32 index.html links`);
  }
  // A bucket that found nothing reports no violation and passes forever. Both
  // sides of every ratio below have to be a real population first.
  if (m.quiet.count === 0) {
    throw new Error(
      `${size}px: the mark has no quiet node pixels at all -- it is the lit node and nothing else`,
    );
  }
  if (m.backgroundCount === 0) {
    throw new Error(`${size}px: no background pixels to measure the nodes against`);
  }
  if (m.amber.count === 0) {
    throw new Error(`${size}px: the lit node is gone, which is not the mark either`);
  }

  const quietVsBack = ratio(m.quiet.brightest, m.background);
  const amberVsBack = ratio(m.amber.brightest, m.background);
  console.log(
    `favicon @${size}: ground ${JSON.stringify(m.background)} | quiet ${m.quiet.count}px brightest ${JSON.stringify(m.quiet.brightest)} = ${quietVsBack.toFixed(2)}:1 | lit ${m.amber.count}px = ${amberVsBack.toFixed(2)}:1`,
  );

  if (quietVsBack < QUIET_NODE_FLOOR) {
    throw new Error(
      `${size}px: the quiet nodes reach ${quietVsBack.toFixed(2)}:1 against the ground, under ${QUIET_NODE_FLOOR}:1 -- the mark is reducing to one orange spot again`,
    );
  }
  // The identity is a LIT node among quiet ones. If the greys ever out-shone
  // the amber the contrast above would still pass and the mark would be wrong.
  if (amberVsBack <= quietVsBack) {
    throw new Error(
      `${size}px: the quiet nodes (${quietVsBack.toFixed(2)}:1) are no dimmer than the lit one (${amberVsBack.toFixed(2)}:1)`,
    );
  }
}

// The mark as a tab paints it: native 16 and 32, side by side, unscaled.
await page.setContent(
  `<body style="margin:0;background:#1e1e1e;display:flex;gap:14px;align-items:center;padding:10px;width:max-content">
     <img src="${origin}/favicon.png" width="16" height="16">
     <img src="${origin}/favicon.png" width="32" height="32">
   </body>`,
  { waitUntil: 'networkidle' },
);
await page.locator('body').screenshot({ path: `${outDir}/favicon-native-after.png` });

await browser.close();
console.log('favicon: the quiet nodes survive at 16 and 32, and the lit node still leads.');
