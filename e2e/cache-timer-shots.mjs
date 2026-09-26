/**
 * THE SIDEBAR'S CACHE-TIMER COUNTDOWN, AS A REAL BROWSER PAINTS IT.
 *
 * Everything here is a question happy-dom cannot answer:
 *
 *  - WHETHER THE WARNING TINT ACTUALLY CLEARS WCAG, against the real surface
 *    it sits on in both themes -- `text-waiting` is a class name until
 *    something composites it, and this repo has shipped a class that read
 *    fine in prose and failed on the paint before (`token-contrast.test.ts`
 *    cannot see an opacity modifier; an e2e guard is what caught it there).
 *  - WHETHER THE BADGE ACTUALLY HOLDS A FIXED WIDTH as the digits change --
 *    `w-[2.4ch]` is a claim about a token until a real font resolves `ch`,
 *    and the operator's own ask was "keep the row from reflowing".
 *  - THE THREE PHASES, ON SCREEN, in both themes -- the picture a reviewer
 *    actually judges "small and quiet" against, which no unit test takes.
 *
 * `domain/cache-timer.test.ts` pins the maths, `CacheCountdown.test.tsx` pins
 * the leaf, `SessionList.cache-timer.test.tsx` pins the single-ticker and
 * visibility-pause guarantees against a real interval, all in happy-dom. This
 * file is only the paint those three cannot see.
 *
 * FIXTURE: a full `window.api` stub, the same route `sidebar-ownership-
 * shots.mjs` and `attention-shots.mjs` already take and for the same reason
 * their own headers give -- `App.tsx`'s top-level switch takes the page off
 * `?demo=1` the moment `window.api` is merely DEFINED, so a partial stub
 * reddens the whole page before a single check here runs.
 *
 * NOT `?demo=1`'s shared `DEMO_MODEL`. Seeding the three cache-timer phases
 * there was tried first (inside the existing `notes` project, then as a new
 * top-level project) and reverted both times: the first broke `tab-strip-
 * shots.mjs`'s exactly-one-idle-tab locator, and the second broke `target-
 * size-shots.mjs`'s per-project hit-target prober, which never found the new
 * project's heading at all -- both guards generically iterate "every
 * project" in the shared fixture, so extending it carries collision risk no
 * amount of careful placement rules out in advance. A dedicated stub, read by
 * nobody but this file, carries none of that risk.
 *
 * `s1`/`s2`/`s3` are the three phases: normal (idle, most of a five-minute
 * TTL left), warning (waiting, inside the last minute) and expired (idle,
 * well past the TTL) -- each timestamp computed relative to `Date.now()` at
 * the moment this file builds the fixture, so the phase is honest whenever
 * this runs, not only on the day it was written.
 *
 * Committed evidence: `docs/ui/cache-timer-{dark,light}.png`.
 *
 * FALSIFIED BY HAND: setting `cacheTimerFor`'s `WARNING_WINDOW_MS` to `0`
 * turns `s2`'s badge from amber back to the same quiet ink `s1`'s carries,
 * and the contrast check below still passes (a neutral tone trivially clears
 * 4.5:1) -- so the SCREENSHOT is what a reviewer would catch a silently-
 * disabled warning tint on; the automated check here is only the floor.
 *
 * Run by hand, or by `e2e/run-web-guards.mjs`:
 *   node e2e/cache-timer-shots.mjs http://localhost:5520 docs/ui
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

const CAPABILITIES = {
  liveUpdates: false,
  recordPrompt: false,
  deliverPrompt: false,
  promptAttachments: false,
  slashCommands: false,
  renameSession: false,
  closeSession: false,
  createSession: false,
  governance: false,
  pullRequests: false,
  terminal: false,
  agentRoster: false,
  resumeSession: false,
};

const FIVE_MIN_MS = 5 * 60 * 1000;

/** The three phases, seeded relative to `Date.now()` at fixture-build time. */
function cacheTimerProjects() {
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();

  const session = (id, title, status, lastCacheActivityAgoMs) => ({
    id,
    title,
    epic: null,
    status,
    runningAgents: 0,
    activity: null,
    age: '2m',
    branch: 'main',
    decisions: [],
    source: 'claude-code',
    vamControlled: true,
    lastCacheActivityAt: iso(lastCacheActivityAgoMs),
    cacheTtlMs: FIVE_MIN_MS,
  });

  return [
    {
      id: 'claude-code:cache-timer',
      name: 'cache-timer',
      source: 'claude-code',
      sessions: [
        // normal: one minute gone of five, four minutes left.
        session('s1', 'alpha-normal', 'idle', 60_000),
        // warning: four and a half minutes gone, thirty seconds left.
        session('s2', 'alpha-warning', 'waiting', FIVE_MIN_MS - 30_000),
        // expired: well past the TTL.
        session('s3', 'alpha-expired', 'idle', FIVE_MIN_MS + 60_000),
      ],
    },
  ];
}

/** A full, minimal `PreloadSourceApi` -- see this file's own header for why
 *  it must be complete. `projects` is handed in as page-init data, not a
 *  closure, because `addInitScript` serialises its argument rather than
 *  capturing anything from this module's scope. */
function install(projects) {
  globalThis.window.api = {
    describe: async () => ({
      id: 'cache-timer-stub',
      label: 'Cache-timer stub',
      capabilities: window.__cacheTimerCapabilities,
      declines: {},
      viewerScope: 'operator',
    }),
    load: async () => projects,
    subscribe: () => () => {},
    recordPrompt: async () => {},
    renameSession: async () => {},
    closeSession: async () => {},
    createSession: async () => {},
    createSessionIn: async () => {},
    resumeSession: async () => {},
    pickImageAttachment: async () => null,
    history: async () => ({
      kind: 'unavailable',
      error: { kind: 'unreachable', code: 'stub', message: 'not in this picture' },
    }),
    agentWork: async () => ({
      kind: 'unavailable',
      error: { kind: 'unreachable', code: 'stub', message: 'not in this picture' },
    }),
    applyWaivers: async () => {},
    transitionLesson: async () => {},
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
await page.addInitScript((caps) => {
  window.__cacheTimerCapabilities = caps;
}, CAPABILITIES);
await page.addInitScript(install, cacheTimerProjects());
await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-session-row]', { timeout: 10_000 });

// ---------------------------------------------------------------------------
// THE THREE PHASES ARE ON SCREEN AT ALL, before anything else is asked of them.
// ---------------------------------------------------------------------------
const rows = {
  normal: '[data-session-row="s1"] [data-cache-timer]',
  warning: '[data-session-row="s2"] [data-cache-timer]',
  expired: '[data-session-row="s3"] [data-cache-timer]',
};

for (const [phase, selector] of Object.entries(rows)) {
  const count = await page.locator(selector).count();
  check(`the ${phase} badge is on screen`, count === 1, `found ${count}`);
}

const phaseAttr = async (selector) => page.locator(selector).getAttribute('data-cache-timer-phase');

check('s1 reads as normal', (await phaseAttr(rows.normal)) === 'normal');
check('s2 reads as warning', (await phaseAttr(rows.warning)) === 'warning');
check('s3 reads as expired', (await phaseAttr(rows.expired)) === 'expired');

// ---------------------------------------------------------------------------
// THE EXPIRED MARK CARRIES NO DIGIT -- `formatCountdown` never draws once the
// TTL has elapsed (`CacheCountdown.tsx`'s own rule); a stray "0:00" reading
// as though the clock were still live is exactly the confusion the operator
// asked this state to avoid.
// ---------------------------------------------------------------------------
const expiredText = (await page.locator(rows.expired).textContent()) ?? '';
check(
  'the expired badge shows no mm:ss text, only the quiet mark',
  !/\d/.test(expiredText),
  JSON.stringify(expiredText),
);

// ---------------------------------------------------------------------------
// NO RELFOW: the row's own bounding box holds steady across a real tick of
// the countdown -- `w-[2.4ch]` is a claim about the digits changing without
// moving anything beside them, measured rather than assumed.
// ---------------------------------------------------------------------------
async function badgeWidth(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el === null ? null : el.getBoundingClientRect().width;
  }, selector);
}

const widthBefore = await badgeWidth(rows.normal);
await page.waitForTimeout(1_100);
const widthAfter = await badgeWidth(rows.normal);
check(
  'a real tick of the countdown does not resize the badge',
  widthBefore !== null && widthAfter !== null && Math.abs(widthBefore - widthAfter) < 0.5,
  `${widthBefore} -> ${widthAfter}`,
);

// ---------------------------------------------------------------------------
// CONTRAST, MEASURED IN THE BROWSER -- `worktrees-shots.mjs`'s own method:
// resolve any CSS colour (including a Tailwind v4 `oklab(... / alpha)`
// string `getComputedStyle` can hand back verbatim) to real sRGB bytes,
// alpha composited over the row's own real background, via the browser's
// OWN colour parser, then compute WCAG contrast by hand.
// ---------------------------------------------------------------------------
async function measureContrast(selector) {
  return page.evaluate((sel) => {
    function relLum([r, g, b]) {
      const chan = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const [rl, gl, bl] = [chan(r), chan(g), chan(b)];
      return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
    }
    function contrastOf(a, b) {
      const la = relLum(a);
      const lb = relLum(b);
      const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
      return (lighter + 0.05) / (darker + 0.05);
    }
    function bgOf(el) {
      let cur = el;
      while (cur !== null) {
        const cs = getComputedStyle(cur);
        if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
          return cs.backgroundColor;
        }
        cur = cur.parentElement;
      }
      return 'rgb(0, 0, 0)';
    }
    function toRgbBytes(colorStr, backdropStr) {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = backdropStr;
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = colorStr;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    }
    const el = document.querySelector(sel);
    if (el === null) return null;
    const bg = bgOf(el);
    const fg = toRgbBytes(getComputedStyle(el).color, bg);
    const bgRgb = toRgbBytes(bg, 'rgb(0,0,0)');
    return contrastOf(fg, bgRgb);
  }, selector);
}

// 4.5:1 -- WCAG 1.4.3, the same floor every other text token in this repo is
// held to (`token-contrast.test.ts`), applied here because this is the one
// state that opacity modifier cannot see at all.
const TEXT_CONTRAST_FLOOR = 4.5;

await page.locator('[data-session-row="s2"]').scrollIntoViewIfNeeded();

for (const theme of ['dark', 'light']) {
  if (theme === 'light') {
    await page.locator('button[aria-label="switch to light theme"]').click();
    await page.waitForSelector('button[aria-label="switch to dark theme"]', { timeout: 3_000 });
  }

  const warningContrast = await measureContrast(rows.warning);
  check(
    `the warning badge’s text clears ${TEXT_CONTRAST_FLOOR}:1 in ${theme} theme`,
    warningContrast !== null && warningContrast >= TEXT_CONTRAST_FLOOR,
    `${warningContrast}`,
  );

  // The sidebar column alone, cropped -- the three phases together, at the
  // width the operator actually reads them at, rather than a full-page shot
  // where they are a sliver beside the detail pane.
  await page.locator('[data-sidebar-pane]').screenshot({ path: `${outDir}/cache-timer-${theme}.png` });
  console.log(`${outDir}/cache-timer-${theme}.png`);
}

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nall cache-timer checks passed.');
