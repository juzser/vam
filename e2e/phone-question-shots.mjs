/**
 * THE TWO SCREENS `docs/design/phone-core-loop.md` REWROTE, photographed and
 * measured against its own acceptance criteria.
 *
 * `phone-question-inline`: the pending question is no longer a fixed
 * 313px card below a separately-capped transcript (`data-question-bar`) --
 * it is the newest item inside the transcript's own scroller
 * (`data-question-bar-inline`, inside `data-detail-column`), so there is
 * exactly one scrolling region on screen. `vam-preview-1` (project "notes")
 * is the fixture session for this: `vamControlled: true`, one open
 * single-select question -- `vam-build-1` (project "vam") carries a
 * question too but is `vamControlled: false` (no answer path at all, the
 * DELIBERATE unanswerable case), and `factory-sse-1` is blocked on a
 * terminal permission prompt, not an `AskUserQuestion` (its options render
 * through the same footer, but from `DEMO_PROMPT`, not `session.questions`).
 *
 * `phone-composer`: the same screen with no question open, composer diet
 * shipped (AC-7's CONTROL COUNT half) -- `crosscheck-2` is the fixture
 * session already used for this by `composer-bar-shots.mjs` ("a session
 * with no open question, so the composer is the block on screen").
 *
 * WIRED into `e2e/run-web-guards.mjs` now that AC-7's HEIGHT half closed too
 * (docs/design/phone-core-loop.md §4.1's own postmortem, followed up):
 * `data-prompt-box` merges the textarea and the tools row onto one flex line
 * on phone (`display: contents` on both wrappers, the "+" pulled to the
 * front via `order-first`), which is what a control-count cut alone could
 * not do to a row that was never wrapping. First measured here, both themes,
 * at **95px** -- down from the pre-merge 145px, comfortably under AC-7's
 * 108px hard ceiling but not yet the ≤76px stretch target, and the reason
 * was a real, falsified floor rather than a padding oversight:
 * `field-sizing: content` (the native auto-grow phone used instead of a
 * hand-rolled resize handler) computed an EMPTY, single-row textarea's own
 * intrinsic content height at ~3 lines' worth (60px at the phone's forced
 * 16px/20px font/line-height), regardless of `rows` or removing the
 * attribute entirely, while `field-sizing: fixed` (the property's own
 * default) with the identical `rows={1}` measured 44px -- the `vam-tap`
 * floor -- for the same box.
 *
 * THE STRETCH TARGET IS NOW MET, at **75px**: `field-sizing: content` is
 * gone from the phone textarea's className, and growth runs through the
 * SAME `scrollHeight` effect the desktop composer already had
 * (`DetailPanel.tsx`, `inputRef`'s own `useEffect`) -- no second resize
 * handler, the one that already existed just was not reaching the phone box
 * before (the native property overrides an author-set `height` per spec,
 * which is what made the JS write moot there). Closing the remaining
 * 95 → 79px gap this alone bought took the composer bar's own top padding
 * from `py-2` (8px) to `pt-1` (4px) -- `data-composer-bar`'s own comment
 * carries the arithmetic; the bottom edge was never available to trim, it is
 * already floored to 12px by the safe-area rule (`styles.css`) regardless of
 * what padding class is written there.
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const QUESTION_SESSION = 'vam-preview-1';
const PLAIN_SESSION = 'crosscheck-2';

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok  ${label}`);
    return;
  }
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(label);
}

async function openPhoneSession(browser, theme, sessionId) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript((t) => {
    localStorage.setItem('vam.prefs.v1', JSON.stringify({ theme: t }));
  }, theme);
  await page.goto(`${origin}/?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-phone-shell="list"]');
  await page.locator(`[data-session-row="${sessionId}"]`).first().click();
  await page.waitForSelector('[data-phone-shell="session"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      a.currentTime = 0;
      a.pause();
    }
  });
  return page;
}

const browser = await chromium.launch();

// ------------------------------------------------- 1. THE INLINE QUESTION
for (const theme of ['light', 'dark']) {
  const page = await openPhoneSession(browser, theme, QUESTION_SESSION);

  const shape = await page.evaluate(() => {
    const column = document.querySelector('[data-phone-shell] [data-detail-column]');
    const fixedCard = document.querySelector('[data-phone-shell] [data-question-bar]');
    const inline = document.querySelector('[data-phone-shell] [data-question-bar-inline]');
    const options = [...document.querySelectorAll('[data-phone-shell] [data-question-option]')].map(
      (el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      },
    );
    return {
      oneScroller: column !== null && getComputedStyle(column).overflowY !== 'visible',
      fixedCardGone: fixedCard === null,
      inlineMounted: inline !== null,
      // Inline lives INSIDE the same scroller as the transcript, not beside
      // it -- AC-1/AC-3's "one continuous region" is exactly this
      // containment, not merely "both are on screen".
      inlineInsideColumn: column !== null && inline !== null && column.contains(inline),
      options,
    };
  });
  console.log(`  ${theme}: ${JSON.stringify(shape)}`);
  check(`${theme}: the shared scroller is on screen`, shape.oneScroller, JSON.stringify(shape));
  check(
    `${theme}: the retired fixed question card is gone from the Response view`,
    shape.fixedCardGone,
    JSON.stringify(shape),
  );
  check(`${theme}: the question is mounted inline`, shape.inlineMounted, JSON.stringify(shape));
  check(
    `${theme}: inline means INSIDE the transcript's own scroller, not a second region`,
    shape.inlineInsideColumn,
    JSON.stringify(shape),
  );
  check(
    `${theme}: every option row clears the 44px touch floor`,
    shape.options.length > 0 && shape.options.every((o) => o.w >= 44 && o.h >= 44),
    JSON.stringify(shape.options),
  );

  await page.screenshot({ path: `${outDir}/phone-question-inline-${theme}.png` });
  console.log(`${outDir}/phone-question-inline-${theme}.png`);
  await page.close();
}

// ------------------------------------------------------- 2. THE COMPOSER
for (const theme of ['light', 'dark']) {
  const page = await openPhoneSession(browser, theme, PLAIN_SESSION);

  const composer = await page.evaluate(() => {
    const bar = document.querySelector('[data-phone-shell] [data-composer-bar]');
    const tools = bar?.querySelector('[data-prompt-tools]') ?? null;
    const textarea = bar?.querySelector('textarea[aria-label="prompt to session"]') ?? null;
    if (bar === null || bar === undefined || tools === null) return null;
    const r = bar.getBoundingClientRect();
    // Same census `test/panels/DetailPanel.phone-composer.test.tsx` runs:
    // every OTHER button in the tools row besides the three AC-7 names.
    const buttons = [...tools.querySelectorAll('button')];
    const unexpected = buttons.filter(
      (b) =>
        !b.hasAttribute('data-composer-overflow') &&
        !b.hasAttribute('data-prompt-dictate') &&
        !b.hasAttribute('data-prompt-suggestion-use') &&
        !b.hasAttribute('data-prompt-record'),
    );
    return {
      height: Math.round(r.height),
      hasTextarea: textarea !== null,
      buttonCount: buttons.length,
      unexpectedCount: unexpected.length,
    };
  });
  console.log(`  ${theme}: ${JSON.stringify(composer)}`);
  check(`${theme}: the composer bar is on screen`, composer !== null, JSON.stringify(composer));
  if (composer !== null) {
    // AC-7's STRETCH target (≤76px), met -- recomputed from a real
    // measurement (75px, both themes, see this file's own header), never
    // loosened back toward the pre-merge 145px or the interim 95px. The
    // lower bound is a regression trip-wire of its own -- a row that
    // measured under 68px would mean a control silently stopped drawing (the
    // textarea's own 44px floor plus the composer's chrome cannot go lower
    // than this without losing one of them), not a further trim nobody
    // chose.
    check(
      `${theme}: composer height meets AC-7's ≤76px stretch target (75px, from 95px, from 145px)`,
      composer.height <= 76 && composer.height >= 68,
      `${composer.height}px`,
    );
    // Textarea + "+" + mic + Send: everything else (attach, provider, model,
    // mode) moved behind the overflow sheet -- see `data-composer-overflow`.
    check(
      `${theme}: exactly 4 controls -- textarea, "+", mic, Send`,
      composer.hasTextarea && composer.buttonCount === 3 && composer.unexpectedCount === 0,
      JSON.stringify(composer),
    );
  }

  await page.screenshot({ path: `${outDir}/phone-composer-${theme}.png` });
  console.log(`${outDir}/phone-composer-${theme}.png`);
  await page.close();
}

await browser.close();

if (failures.length > 0) {
  throw new Error(`${failures.length} phone question/composer guard(s) failed:\n  - ${failures.join('\n  - ')}`);
}
console.log('phone question/composer guards: all assertions passed');
