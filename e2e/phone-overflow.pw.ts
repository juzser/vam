/**
 * TWO REPORTS FROM THE OPERATOR'S OWN PHONE, TRANSLATED, AND MEASURED HERE
 * RATHER THAN REASONED ABOUT:
 *
 *   1. "The quick buttons row above the prompt input can't be scrolled
 *      horizontally" -- the keystroke strip (`data-key-strip`, `DetailPanel.
 *      tsx`), the first child of the composer bar. `e2e/phone-shell.pw.ts`
 *      already measures this row's own box (`geometry.right <= 390`) and
 *      that measurement was never the defect: the NAV's own box always fit,
 *      because a flex child is sized by its context regardless of what
 *      overflows inside it. What that test never asked is whether the row's
 *      CONTENT fits the row -- `scrollWidth` against `clientWidth` -- and it
 *      did not: two of the seven chips are `data-tap-pill`s holding text
 *      ("Esc → agent", "⏎ → agent"), and the row carried `overflow-x:
 *      visible`, no wrap and no scroll. The excess simply painted past the
 *      row's own right edge with no way to reach it.
 *
 *   2. "Overall, the Response view on mobile has a section sticking out on
 *      the right, which makes the screen scroll horizontally." Two distinct
 *      causes, both fixed in `DetailPanel.tsx`:
 *        - the SAME keystroke strip overflow above, which (measured, see
 *          "A CHROMIUM QUIRK" below) does not stay a contained overflow --
 *          it drags the whole mobile LAYOUT VIEWPORT wider to admit it, which
 *          is the "screen scrolls horizontally" half of the report, word for
 *          word.
 *        - the question card's free-text spans (`data-question-header`,
 *          `-text`, `-answer`, `-marked`, `-label`, `-description`) carried
 *          `min-w-0` and no `break-words`. `min-w-0` lets a flex/block box
 *          SHRINK to fit content that wraps; it does not create a wrap point
 *          in a run that has none, and a model's own question text carries
 *          hashes, ids and unbroken paths constantly (this file's own `out-
 *          markdown.tsx` states the same rule for the transcript proper).
 *          `data-detail-column`, the phone's shared transcript scroller,
 *          absorbs the overflow as an invisible horizontal scroll ON THAT
 *          COLUMN rather than growing the viewport -- `overflow-y: auto`
 *          computes `overflow-x` to `auto` too by spec the moment one axis is
 *          not `visible` -- so this half of the report never grew
 *          `document.documentElement.scrollWidth`. It is still the "section
 *          sticking out on the right" the operator saw: the text is real,
 *          on screen, past the card's own edge, `vam-no-scrollbar` hiding the
 *          one hint that the column had quietly become sideways-scrollable.
 *
 * A CHROMIUM QUIRK THAT MADE THE FIRST HALF HARDER TO MEASURE, RECORDED SO
 * THE NEXT READER DOES NOT RE-DISCOVER IT BY GUESSING. Measured against
 * unpatched code: with the keystroke strip's overflow uncontained,
 * `window.innerWidth` and `document.documentElement.scrollWidth` did not stay
 * pinned at the configured viewport width (390) -- they moved TOGETHER to
 * 423, exactly `viewport width + (the strip's own scrollWidth − clientWidth)`
 * once the strip's right edge is added in. The page meta carries `width=
 * device-width, initial-scale=1.0` and Chromium's mobile emulation still let
 * unconstrained content grow the layout viewport past it. The practical
 * consequence: a guard that compares an element's `right` against the LIVE
 * `window.innerWidth` reads as green over this exact bug, because the
 * viewport grew to swallow the overflow it was supposed to catch. Every
 * assertion below compares against the CONFIGURED width (the `width` this
 * file asked Playwright for) rather than a live read of `innerWidth`, for
 * that reason -- and the CHECK for it is its own test, "the layout viewport
 * does not grow to swallow the strip's overflow", below.
 *
 * A SECOND MEASUREMENT TRAP, FOUND THE SAME WAY -- by falsifying the guard
 * below against the UNPATCHED question card and watching it stay green. An
 * unbreakable run inside a `min-w-0` span with no `break-words` does not
 * widen the span's own `getBoundingClientRect()` OR `document.
 * documentElement.scrollWidth`: both keep reporting the line's nominal
 * width while the GLYPHS paint past it -- "ink overflow", distinct from the
 * "scrollable overflow" those two numbers actually describe. Measured on the
 * unpatched span: the element's own rect called it 346px wide on a 390px
 * screen (fits), while the screenshot showed the run running clean off the
 * right edge. A `document.createRange()` selecting the element's own text
 * and reading ITS `getBoundingClientRect()` reports the true painted extent
 * regardless of what the element's box claims (691px, on that same span) --
 * see "the question card holds its own long text" below for the one place
 * this file needs it. The keystroke strip's overflow does not have this
 * problem (`scrollWidth`/`clientWidth` on a scroll container are exactly
 * right already), which is why only the question-card test uses `Range`.
 *
 * FIXTURE. A fresh `**\/api/**` stub, not `phone-shell.pw.ts`'s import: this
 * needs `terminal: true` AND `vamControlled: true` AND several sessions in
 * one project AND an open question carrying long unbroken text, all at once,
 * which is exactly what that file's own "session tab strip and keystroke
 * strip" `describe` says of its narrower version of the same stub (its own
 * comment: "these two controls need both facts at once, which neither
 * existing fixture states"). `s1` (waiting, an open question, long unbroken
 * tokens in the header/text/options) draws the question card; `s2` (running,
 * no question) draws the keystroke strip -- `canSendKeys` withdraws the strip
 * whenever a question is open (`DetailPanel.tsx`), by design, so one session
 * cannot draw both at once.
 */

import { expect, type Page, test } from '@playwright/test';

const WIDTHS = [360, 390, 430] as const;

const DESCRIPTOR = {
  id: 'stub-overflow',
  label: 'stub overflow source',
  capabilities: {
    liveUpdates: false,
    recordPrompt: true,
    deliverPrompt: false,
    promptAttachments: false,
    slashCommands: false,
    renameSession: false,
    closeSession: false,
    createSession: true,
    governance: false,
    pullRequests: false,
    terminal: true,
    agentRoster: false,
    resumeSession: false,
  },
  declines: {
    liveUpdates: 'the stub does not stream',
    deliverPrompt: 'the stub delivers nothing',
    promptAttachments: 'the stub takes no attachments',
    slashCommands: 'the stub has no slash commands',
    governance: 'the stub has no governance surface',
    pullRequests: 'the stub has no pull requests',
    agentRoster: 'the stub has no agent roster',
  },
  viewerScope: { kind: 'connection', note: 'a stubbed transport, not a server' },
};

const LONG_PATH =
  '/Users/operator/scatola/jobs/projects/vam-worktrees/a-very-long-nested-directory-name-for-overflow-testing/src/renderer/panels/DetailPanel-an-extremely-long-file-name.tsx';
const LONG_URL =
  'https://github.com/juzser/vam/pull/12345/files#diff-abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789R100';
const LONG_BRANCH =
  'smith/vam/a-very-long-feature-branch-name-that-keeps-going-and-going-for-overflow-testing';
const UNBROKEN_TOKEN =
  'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop';

const LONG_OUTPUT = `I looked at this. A long path: ${LONG_PATH}

And a long URL: ${LONG_URL}

\`\`\`bash
$ some-very-long-command --with-a-flag=value --another-flag a-really-long-argument-that-does-not-wrap-because-fences-never-wrap-per-spec
\`\`\`

| Column A | Column B is a much longer header than the others | Column C |
| --- | --- | --- |
| short | a somewhat long cell value that could wrap or overflow depending on the column | x |

Branch: ${LONG_BRANCH}
`;

const QUESTIONS = [
  {
    id: 'toolu_overflow:0',
    header: `TRANSPORT-${UNBROKEN_TOKEN}`,
    question: `How should the canvas receive updates while a run is live, given this unbroken run: ${UNBROKEN_TOKEN} -- right here?`,
    multiSelect: false,
    options: [
      {
        label: `Server-sent events, with an unbroken suffix ${UNBROKEN_TOKEN}`,
        description: `one long-lived GET, the server pushes -- and an unbroken run: ${UNBROKEN_TOKEN}`,
        preview: 'GET /events',
      },
      {
        label: 'Long poll',
        description: 'a request per change, simplest to serve',
        preview: 'GET /changes?since=41',
      },
    ],
    answer: null,
  },
];

const turn = (id: string, output: string) => ({
  id: `${id}-d1`,
  label: 'the turn',
  input: 'go on then',
  output,
  commands: [],
});

const PROJECTS = [
  {
    id: 'p1',
    name: 'alpha',
    source: 'stub-overflow',
    sessions: [
      {
        id: 's1',
        title: 'alpha-waiting-with-a-very-long-session-title-for-overflow',
        icon: null,
        epic: null,
        status: 'waiting',
        runningAgents: 2,
        activity: null,
        age: '4m',
        branch: LONG_BRANCH,
        vamControlled: true,
        source: 'stub-overflow',
        questions: QUESTIONS,
        agents: [],
        pullRequests: { kind: 'ok', prs: [] },
        decisions: [turn('s1', LONG_OUTPUT)],
      },
      {
        id: 's2',
        title: 'alpha-running-with-another-quite-long-session-title-here',
        icon: null,
        epic: null,
        status: 'running',
        runningAgents: 1,
        activity: 'reading',
        age: '2m',
        branch: null,
        vamControlled: true,
        source: 'stub-overflow',
        decisions: [turn('s2', 'still going')],
      },
      {
        id: 's3',
        title: 'alpha-done',
        icon: null,
        epic: null,
        status: 'done',
        runningAgents: 0,
        activity: null,
        age: '9m',
        branch: null,
        vamControlled: true,
        source: 'stub-overflow',
        decisions: [turn('s3', 'finished')],
      },
    ],
  },
];

const envelope = (value: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ ok: true, value }),
});

async function stubOverflowSource(page: Page): Promise<void> {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: { kind: 'unreachable', code: 'stub-overflow', message: 'the stub refuses writes' },
      }),
    }),
  );
  await page.route('**/api/describe', (route) => route.fulfill(envelope(DESCRIPTOR)));
  await page.route('**/api/load', (route) => route.fulfill(envelope(PROJECTS)));
  await page.goto('/');
  await expect(page.locator('[data-phone-shell] [data-session-row]').first()).toBeVisible();
}

async function openSession(page: Page, index: number): Promise<void> {
  const row = page.locator('[data-phone-shell] [data-session-row]').nth(index);
  const box = await row.boundingBox();
  if (box === null) throw new Error(`no session row at index ${index}`);
  await page.touchscreen.tap(box.x + 60, box.y + box.height / 2);
  await expect(page.locator('[data-phone-shell]')).toHaveAttribute('data-phone-shell', 'session');
}

/**
 * Every element whose right edge clears `width` -- the CONFIGURED viewport,
 * never a live read of `innerWidth` (see this file's header, "A CHROMIUM
 * QUIRK") -- excluding anything inside a designated scroll container
 * (`overflow-x: auto|scroll`) or a designated clip (`overflow: hidden`, the
 * shape `data-prose-ruler`'s own measuring ruler uses to stay off screen
 * without lying about its natural width). Those are the two honest ways an
 * element may legitimately draw past `width` in its own untransformed
 * geometry; anything else is the "section sticking out on the right" the
 * operator reported.
 */
async function offscreenElements(
  page: Page,
  width: number,
): Promise<readonly { tag: string; hooks: string; right: number; text: string }[]> {
  return page.evaluate((w) => {
    const out: { tag: string; hooks: string; right: number; text: string }[] = [];
    for (const el of document.querySelectorAll('[data-phone-shell] *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= w + 0.5) continue;
      let contained = false;
      for (let p = el.parentElement; p !== null; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (
          cs.overflowX === 'auto' ||
          cs.overflowX === 'scroll' ||
          cs.overflow === 'hidden' ||
          (cs.overflowX === 'hidden' && cs.overflowY === 'hidden')
        ) {
          contained = true;
          break;
        }
      }
      if (contained) continue;
      out.push({
        tag: el.tagName,
        hooks: [...el.attributes]
          .map((a) => a.name)
          .filter((n) => n.startsWith('data-'))
          .join(','),
        right: Math.round(r.right),
        text: (el.textContent ?? '').slice(0, 60),
      });
    }
    return out;
  }, width);
}

for (const width of WIDTHS) {
  test.describe(`the response view at ${width}px, with long unbroken content`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
    });

    test('the document does not scroll sideways, and the layout viewport does not grow to hide it', async ({
      page,
    }) => {
      await stubOverflowSource(page);
      await openSession(page, 0); // s1: the open question, the long transcript.
      await page.waitForTimeout(200);

      const measured = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(measured.innerWidth, 'the layout viewport must stay pinned at the configured width').toBe(
        width,
      );
      expect(
        measured.scrollWidth,
        `document.documentElement.scrollWidth against the configured ${width}px`,
      ).toBeLessThanOrEqual(width);
    });

    test('no element sticks out past the viewport, outside a designated scroll container', async ({
      page,
    }) => {
      await stubOverflowSource(page);
      await openSession(page, 0);
      await page.waitForTimeout(200);

      const offscreen = await offscreenElements(page, width);
      expect(offscreen, JSON.stringify(offscreen, null, 2)).toEqual([]);
    });

    test('the question card holds its own long text: header, question, and every option', async ({
      page,
    }) => {
      /**
       * `getBoundingClientRect()` ON THE ELEMENT IS THE WRONG TOOL HERE, AND
       * FALSIFYING THIS TEST IS WHAT FOUND THAT OUT. An unbreakable run
       * inside a normal (non-`break-word`) inline span does not widen the
       * span's own LAYOUT box or `document.documentElement.scrollWidth` --
       * it only widens the PAINT, past the box the layout still claims. Every
       * number an element-level `getBoundingClientRect()` or `scrollWidth`
       * read from this span said "319px, well inside 390" while the actual
       * screenshot showed the run running clean off the right edge of the
       * phone. A `Range` over the element's own text content reports the
       * true painted (ink) extent regardless of what the element's own box
       * claims -- measured on the unpatched span, `range.getBoundingClientRect
       * ().right` read 691px against a 390px screen, the same run
       * `getBoundingClientRect()` on the element called 346. `break-words`
       * (`overflow-wrap: break-word`) is what makes the two numbers agree
       * again, which is exactly what this test asks of them.
       */
      await stubOverflowSource(page);
      await openSession(page, 0);
      await page.waitForTimeout(200);

      const rows = await page.evaluate((w) => {
        const sel = [
          '[data-question-header]',
          '[data-question-text]',
          '[data-question-label]',
          '[data-question-description]',
        ];
        return sel.flatMap((s) =>
          [...document.querySelectorAll(s)].map((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            const right = range.getBoundingClientRect().right;
            return { sel: s, right: Math.round(right), width: w, text: (el.textContent ?? '').slice(0, 40) };
          }),
        );
      }, width);
      expect(rows.length, 'at least the header, text, and one option label/description').toBeGreaterThan(
        0,
      );
      const overflowing = rows.filter((r) => r.right > r.width + 0.5);
      expect(overflowing, JSON.stringify(rows, null, 2)).toEqual([]);
    });
  });
}

/**
 * THE LIST SCREEN ITSELF, at the same three widths -- added for the phone/
 * Orca pass: the floating "+" (`data-phone-fab`, `PhoneShell.tsx`) is a new,
 * `fixed`-positioned element over the whole screen, and the project
 * heading's fold/menu/`+` are newly PAINTED on a phone rather than merely
 * present-but-invisible (`opacity-0` before this pass) -- both are exactly
 * the kind of change this file's own header warns can grow the layout
 * viewport or paint past its edge without either failing a `getBoundingClientRect()`
 * check on the element itself. `PROJECTS` above already has one project
 * (`alpha`) and a long branch name; that is enough surface for a fold, a
 * menu and a `+` to have somewhere to draw.
 */
for (const width of WIDTHS) {
  test.describe(`the list screen at ${width}px, with a floating + and a revealed project heading`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
    });

    test('no element sticks out past the viewport', async ({ page }) => {
      await stubOverflowSource(page);
      await page.waitForTimeout(200);

      const offscreen = await offscreenElements(page, width);
      expect(offscreen, JSON.stringify(offscreen, null, 2)).toEqual([]);
    });

    test('the floating + and the project heading’s fold/menu/+ all clear the 44px touch floor, painted', async ({
      page,
    }) => {
      await stubOverflowSource(page);

      const fab = page.locator('[data-phone-fab]');
      await expect(fab).toBeVisible();
      const fabBox = await fab.boundingBox();
      if (fabBox === null) throw new Error('no FAB box');
      expect(fabBox.width, 'FAB width').toBeGreaterThanOrEqual(44);
      expect(fabBox.height, 'FAB height').toBeGreaterThanOrEqual(44);
      // Entirely inside the configured viewport too -- a `fixed` element is
      // exactly the shape that can float past an edge unnoticed by a check
      // that only ever asks about `scrollWidth`.
      expect(fabBox.x + fabBox.width, 'FAB right edge').toBeLessThanOrEqual(width + 0.5);

      for (const hook of [
        '[data-project-collapse="p1"]',
        '[data-project-menu="p1"]',
        '[data-new-session-in-project="p1"]',
      ]) {
        const el = page.locator(hook);
        await expect(el, hook).toBeVisible();
        const box = await el.boundingBox();
        if (box === null) throw new Error(`no box for ${hook}`);
        expect(box.width, `${hook} width`).toBeGreaterThanOrEqual(44);
        expect(box.height, `${hook} height`).toBeGreaterThanOrEqual(44);
      }
    });
  });
}

test.describe('the keystroke strip scrolls horizontally', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('scrollWidth exceeds clientWidth, and the row is a real (auto) scroller', async ({ page }) => {
    await stubOverflowSource(page);
    await openSession(page, 1); // s2: no open question, so the strip draws.

    const strip = page.locator('[data-key-strip]');
    await expect(strip).toBeVisible();
    const info = await strip.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowX: getComputedStyle(el).overflowX,
    }));
    expect(info.overflowX, 'the row must be a real scroll container').toBe('auto');
    expect(
      info.scrollWidth,
      `scrollWidth (${info.scrollWidth}) must exceed clientWidth (${info.clientWidth}) -- ` +
        'seven chips, two of them text pills, do not fit 361px of clear width',
    ).toBeGreaterThan(info.clientWidth);
  });

  test('a touch drag scrolls the row', async ({ page }) => {
    await stubOverflowSource(page);
    await openSession(page, 1);

    const strip = page.locator('[data-key-strip]');
    await expect(strip).toBeVisible();
    const before = await strip.evaluate((el) => el.scrollLeft);
    expect(before).toBe(0);

    const box = await strip.boundingBox();
    if (box === null) throw new Error('no key strip box');
    const y = box.y + box.height / 2;
    const startX = box.x + box.width - 15;
    const endX = box.x + 15;

    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
    for (let i = 1; i <= 10; i++) {
      const x = startX + ((endX - startX) * i) / 10;
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      await page.waitForTimeout(16);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);

    const after = await strip.evaluate((el) => el.scrollLeft);
    expect(after, 'a rightward drag must move scrollLeft off zero').toBeGreaterThan(before);
  });

  /**
   * THE OTHER HALF OF THE SAME CLAIM: a drag must not ALSO read as a tap on
   * whatever chip the finger lifts off over, and a plain tap must still
   * reach its handler. `pressPaneKey` (`DetailPanel.tsx`) has no bridge in
   * this browser harness (`window.api` is Electron-only) and reports that
   * refusal onto the shared `[data-mode-cycle]` caption rather than
   * throwing or silently doing nothing -- the same channel the mode row's
   * own Shift-Tab uses -- which is what this test reads: its PRESENCE is
   * "the click handler ran", independent of whether the browser build can
   * actually reach a pane.
   */
  test('a drag does not fire a key; a plain tap still does', async ({ page }) => {
    await stubOverflowSource(page);
    await openSession(page, 1);

    const strip = page.locator('[data-key-strip]');
    await expect(strip).toBeVisible();
    const box = await strip.boundingBox();
    if (box === null) throw new Error('no key strip box');
    const y = box.y + box.height / 2;
    const startX = box.x + box.width - 15;
    const endX = box.x + 15;

    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
    for (let i = 1; i <= 10; i++) {
      const x = startX + ((endX - startX) * i) / 10;
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      await page.waitForTimeout(16);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);

    await expect(
      page.locator('[data-mode-cycle]'),
      'a drag across the strip must not also register as a tap on a chip',
    ).toHaveCount(0);

    // A REAL touch tap, not a synthesised mouse click (S3 finding, cross-
    // provider review): this file's own drag above already dispatches real
    // touch events via CDP, and this project's `hasTouch: true`
    // (`playwright.phone.config.ts`) is what makes `.tap()` dispatch actual
    // `touchstart`/`touchend` rather than `mousedown`/`mouseup` -- the
    // fine-vs-coarse-pointer distinction this same suite's own header names
    // for the hover-only close control elsewhere in this file.
    const backspace = page.locator('[data-key-strip-key="backspace"]');
    await backspace.scrollIntoViewIfNeeded();
    await backspace.tap();
    await expect(
      page.locator('[data-mode-cycle]'),
      'a plain tap must still reach the handler',
    ).toBeVisible();
  });
});
