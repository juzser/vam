/**
 * The phone shell, measured at 390px in an engine that lays out.
 *
 * WHAT THIS FILE IS FOR. Two claims about PR #191's phone shell are asserted
 * today by reading `styles.css` as bytes:
 *
 *   - `test/phone/touch-targets.test.tsx` -- the 44px rule EXISTS and names
 *     seven controls. It cannot say whether any control is 44px.
 *   - `test/phone/overlay-sheets.test.ts` -- the sheet rules EXIST. It cannot
 *     say where a sheet's bottom edge is, nor whether its confirm can be
 *     reached.
 *
 * Both headers name a Playwright pass at 390px as the thing that would settle
 * them, and the CSS's own comment says the `85dvh` sheet "is ENOUGH is a claim
 * only a real device can settle". This file settles what a desktop engine at
 * phone width honestly can, and says plainly where that stops -- see
 * `IOS_KEYBOARD_CSS_PX` and the two keyboard tests at the foot.
 *
 * WHAT IT CANNOT DO, stated once and not softened anywhere below. A headless
 * Chromium at 390x844 has no soft keyboard. `visualViewport` here is not the
 * thing that breaks on iOS; nothing this runner does raises a keyboard, and a
 * test that pretended otherwise would retire the caveat without settling it.
 * What IS transferable is geometry: on iOS the keyboard shrinks the VISUAL
 * viewport and leaves the LAYOUT viewport alone, so every box measured here
 * sits at the same layout coordinate it would sit at on the device. Which of
 * those coordinates the operator can still see is then arithmetic, not
 * simulation -- and that arithmetic is the last two tests.
 *
 * FIXTURE: `?demo=1`, the built page's own demo mode. Deterministic, offline,
 * and no factory port to keep free. Its one cost is stated where it bites:
 * demo refuses every write, so two of the four `data-overlay-host` sheets
 * cannot be opened from a phone at all in this fixture (see the `test.skip`
 * and its comment).
 */

import { expect, type Locator, type Page, test } from '@playwright/test';

/**
 * The iPhone portrait soft keyboard, in CSS pixels, WITH its accessory bar.
 * An estimate and used as one: iOS portrait keyboards measure roughly
 * 291-380px depending on the accessory and prediction rows, and this is a
 * mid-figure. Every assertion that uses it reports the MARGIN it passed or
 * failed by, so a real device measurement can be substituted here and the
 * verdict re-derived rather than re-argued.
 */
const IOS_KEYBOARD_CSS_PX = 336;

/** WCAG 2.2 SC 2.5.5 (AAA) and Apple's HIG figure -- the shell's own comment. */
const TOUCH_MIN = 44;

/**
 * The painted ceiling, from the UI spec's table (`vam-phone-controls`, 3.2):
 * the widest skin it authorises is the 36px record disc, and the widest square
 * one is the 30px ambient chip. 32x36 is that table's outer envelope, so a
 * skin over it is a control painting bigger than the spec allows, not a
 * control this guard failed to anticipate.
 */
const SKIN_MAX_W = 32;
const SKIN_MAX_H = 36;

type Box = {
  readonly label: string;
  readonly tag: string;
  readonly hooks: string;
  readonly w: number;
  readonly h: number;
  readonly y: number;
};

/**
 * Every control inside the phone shell a finger can land on.
 *
 * Zero-sized elements are excluded and that is not a loophole: the composer's
 * file input is 0x0 by design (the visible `data-attach` button is its
 * proxy), and a box with no area is not a touch target that misses 44px, it
 * is not a touch target. Everything with area is measured, hosted panels
 * included -- the shell is answerable for what it puts on a phone screen,
 * not only for the markup it wrote itself.
 */
async function controls(page: Page): Promise<Box[]> {
  return page.$$eval(
    '[data-phone-shell] button, [data-phone-shell] summary, [data-phone-shell] a[href],' +
      ' [data-phone-shell] input, [data-phone-shell] textarea, [data-phone-shell] [role="button"]',
    (els) =>
      els
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            label: (
              el.getAttribute('aria-label') ||
              el.textContent ||
              el.getAttribute('placeholder') ||
              ''
            )
              .trim()
              .replace(/\s+/g, ' ')
              .slice(0, 44),
            tag: el.tagName,
            hooks: [...el.attributes]
              .map((a) => a.name)
              .filter((n) => n.startsWith('data-') && n !== 'data-state')
              .join(','),
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
            y: Math.round(r.y),
          };
        })
        .filter((b) => b.w > 0 && b.h > 0),
  );
}

const undersized = (boxes: readonly Box[]) =>
  boxes.filter((b) => b.w < 44 || b.h < 44).map((b) => `${b.w}x${b.h}  ${b.hooks || b.tag}  "${b.label}"`);

async function openDemo(page: Page): Promise<void> {
  await page.goto('/?demo=1');
  await expect(page.locator('[data-phone-shell]')).toHaveAttribute('data-phone-shell', 'list');
  // The rows are the fixture's, not a load state's.
  await expect(page.locator('[data-phone-shell] [data-session-row]').first()).toBeVisible();
}

/** Tap a row where a finger aims: its left side, clear of any right-hand chrome. */
async function openFirstSession(page: Page): Promise<void> {
  const row = page.locator('[data-phone-shell] [data-session-row]').first();
  const box = await row.boundingBox();
  if (box === null) throw new Error('no session row');
  await page.touchscreen.tap(box.x + 60, box.y + box.height / 2);
  await expect(page.locator('[data-phone-shell]')).toHaveAttribute('data-phone-shell', 'session');
}

/**
 * Every painted skin on the screen the page is currently showing, with the box
 * that takes the tap beside it.
 *
 * A function rather than one `$$eval`, because the skins are spread over two
 * screens and only one of them can be on the page at a time.
 */
async function readSkins(page: Page): Promise<
  readonly {
    label: string;
    w: number;
    h: number;
    ownerW: number;
    ownerH: number;
  }[]
> {
  return page.$$eval('[data-phone-shell] [data-tap-skin]', (els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      const owner = el.closest('button, summary, [role="button"]');
      const o = owner?.getBoundingClientRect() ?? new DOMRect();
      return {
        label: (owner?.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30),
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        ownerW: Math.round(o.width * 10) / 10,
        ownerH: Math.round(o.height * 10) / 10,
      };
    }),
  );
}

test.describe('the phone shell at 390px', () => {
  test('the two screens navigate: list -> session -> back', async ({ page }) => {
    await openDemo(page);
    await openFirstSession(page);

    // The session screen is the session screen: its own app bar, carrying the
    // back chevron, the name of the session about to be written to, and the
    // view icons.
    //
    // NOT `[data-step-rail] [data-step-chip]`, which is what this line read
    // when the suite was written. #205 removed the step rail and the body tab
    // strip outright, so that selector now matches nothing -- and a selector
    // matching nothing is the failure mode this repo has already shipped once
    // (`styles.css`'s row-close rule, green in a content-scan test for a whole
    // release while the S2 it named stayed live). Re-pointed at the chrome
    // that survives, which is what the screen is now.
    await expect(page.locator('[data-phone-back]')).toBeVisible();
    await expect(page.locator('[data-prompt-target]')).toBeVisible();
    await expect(page.locator('[data-phone-views] [data-phone-view]').first()).toBeVisible();

    await page.locator('[data-phone-back]').tap();
    await expect(page.locator('[data-phone-shell]')).toHaveAttribute('data-phone-shell', 'list');
    await expect(page.locator('[data-phone-shell] [data-session-row]').first()).toBeVisible();
  });

  test('the close control is on the session bar, clear of the back chevron', async ({ page }) => {
    await openDemo(page);
    await openFirstSession(page);

    const back = page.locator('[data-phone-back]');
    const close = page.locator('[data-phone-close]');
    const backBox = await back.boundingBox();
    const closeBox = await close.boundingBox();
    if (backBox === null || closeBox === null) throw new Error('app bar controls missing');

    // Visible, not hover-revealed: this is the deliberate route #191 added
    // BECAUSE a finger has no hover.
    await expect(close).toBeVisible();
    await expect(close).toHaveCSS('opacity', '1');
    // At the other end of the bar from `back`, with real space between them.
    expect(closeBox.x).toBeGreaterThan(backBox.x + backBox.width + 8);
    expect(closeBox.width).toBeGreaterThanOrEqual(TOUCH_MIN);
    expect(closeBox.height).toBeGreaterThanOrEqual(TOUCH_MIN);
  });

  /**
   * The S2 this suite exists to catch at real width.
   *
   * `styles.css` carries `[data-phone-shell] [data-session-row] button[aria-label^='close ']
   * { display: none }` and `test/phone/touch-targets.test.tsx` asserts that
   * rule's text is present. A content scan cannot check that the selector
   * MATCHES anything -- and whether it does is the entire question, because
   * the control it means to remove is `opacity: 0` with pointer events intact,
   * sitting over the row's own tap area.
   */
  test("a tap at the row's right-hand end opens the session and does not close it", async ({
    page,
  }) => {
    await openDemo(page);
    const row = page.locator('[data-phone-shell] [data-session-row]').first();
    const rowBox = await row.boundingBox();
    if (rowBox === null) throw new Error('no session row');

    /**
     * Sweep the WHOLE row on a 4px grid and report every point whose owner is
     * invisible. Neither the region nor the axis may be guessed: an earlier
     * version of this test probed one point 26px in from the right edge at
     * mid-height and passed twice over a live defect -- 3px clear of the
     * control horizontally the first time, and a whole row-half below it the
     * second, because the `x` sits at the row's TOP-right, not its middle.
     */
    const sweep = await page.evaluate(
      (box) => {
        const seen = new Map<string, { x: number; y: number; opacity: string; display: string }>();
        for (let x = box.left; x <= box.right; x += 4) {
          for (let y = box.top; y <= box.bottom; y += 4) {
            const el = document.elementFromPoint(x, y);
            if (el === null) continue;
            const cs = getComputedStyle(el);
            if (Number.parseFloat(cs.opacity) !== 0 && cs.visibility !== 'hidden') continue;
            const label = el.getAttribute('aria-label') ?? el.tagName;
            if (!seen.has(label)) seen.set(label, { x, y, opacity: cs.opacity, display: cs.display });
          }
        }
        return [...seen].map(([label, at]) => ({ label, ...at }));
      },
      {
        left: Math.round(rowBox.x),
        right: Math.round(rowBox.x + rowBox.width),
        top: Math.round(rowBox.y),
        bottom: Math.round(rowBox.y + rowBox.height),
      },
    );

    // And the behaviour, not only the hit test: a finger landing on the row's
    // TOP-RIGHT -- where the desktop's `x` sits, 22px in and 14px down, both
    // well inside the row -- must open the session. If the invisible control
    // took the tap instead, the shell stays on the list and the status line
    // carries the close route's own refusal, which names who handled it.
    await page.touchscreen.tap(rowBox.x + rowBox.width - 22, rowBox.y + 14);
    // Long enough for a refusal to reach the status line, so the failure
    // message below can name the handler rather than only the symptom.
    await page.waitForTimeout(200);
    await expect(
      page.locator('[data-phone-shell]'),
      `after tapping the row's top-right, the status line reads: ${await page
        .locator('[data-phone-status]')
        .first()
        .textContent()
        .catch(() => '(none)')}`,
    ).toHaveAttribute('data-phone-shell', 'session');

    expect(
      sweep.map(
        (f) => `"${f.label}" owns (${f.x},${f.y}) with opacity=${f.opacity} display=${f.display}`,
      ),
      'invisible controls owning a point inside the row a finger taps to open it',
    ).toEqual([]);
  });

  test('every interactive control on the LIST screen is at least 44x44', async ({ page }) => {
    await openDemo(page);
    const boxes = await controls(page);
    expect(boxes.length).toBeGreaterThan(5);
    expect(
      undersized(boxes),
      'measured bounding boxes under 44x44 on the list screen',
    ).toEqual([]);
  });

  /**
   * The paint, which is the half of the sizing the two sweeps above cannot
   * see.
   *
   * They measure the ELEMENT box and would stay green through the exact
   * complaint that started this work: a `border-line` rectangle drawn AT 44
   * around a 16px glyph, which is why the phone's bordered controls read as
   * the heaviest objects on the screen while every guard passed. The rule is
   * hit on the element, paint on a `[data-tap-skin]` child (UI spec
   * `vam-phone-controls`, 3.1) -- so the ceiling below catches a border
   * re-inflating back onto the 44 box, and the paired floor stops anyone
   * satisfying the ceiling by shrinking the hit box instead.
   *
   * THE COUNT IS PART OF THE ASSERTION, not a courtesy beside it. A filter
   * over an empty list is empty, so a guard written the obvious way passes
   * loudest at the moment the hook is renamed away and it is measuring
   * nothing at all. This session has already produced one guard that passed
   * having examined a corpus of zero. Hence both an explicit floor on the
   * count and, inside the expression the assertion actually reads, an empty
   * corpus reported as a violation in its own right.
   */
  test('every painted skin is smaller than the box that takes the tap', async ({ page }) => {
    await openDemo(page);
    // BOTH SCREENS, AND A FLOOR ON EACH, which is not the same guard as one
    // floor over the sum. The list screen carries three skins and the session
    // screen four -- the response tab strip and the composer's attach control,
    // which was the last class-A control still painting its border on the 44
    // box. A sweep of the list alone could not see it at all; a single floor
    // over both screens could be satisfied by the list's three plus any one of
    // the session's, so removing the attach skin again would leave the count
    // green. Two floors are what make the number mean the thing it counts.
    const listSkins = await readSkins(page);
    await openFirstSession(page);
    // THE COMPOSER STANDS DOWN WHILE A QUESTION IS OPEN, and the first row of
    // the fixture is now a session blocked on a permission prompt -- a shape
    // that has no transcript record and is read off the pane instead. So the
    // attach control, which is one of the four skins this floor counts, is
    // legitimately absent until the card is left. `Chat about this` is the way
    // back, and taking it here measures the same four skins as before AND
    // proves the route out of a pane-read card exists on the phone.
    const chat = page.locator('[data-question-chat]');
    if ((await chat.count()) > 0) await chat.first().click();
    const sessionSkins = await readSkins(page);
    const skins = [...listSkins, ...sessionSkins];

    expect(listSkins.length, 'painted skins on the LIST screen').toBeGreaterThanOrEqual(3);
    expect(sessionSkins.length, 'painted skins on the SESSION screen').toBeGreaterThanOrEqual(4);

    const fmt = (s: (typeof skins)[number]) =>
      `"${s.label}" paints ${s.w}x${s.h} inside a ${s.ownerW}x${s.ownerH} hit box`;
    expect(
      skins.length === 0
        ? ['no [data-tap-skin] on either phone screen -- this guard measured nothing']
        : skins.filter((s) => s.w > SKIN_MAX_W || s.h > SKIN_MAX_H).map(fmt),
      `skins painting larger than ${SKIN_MAX_W}x${SKIN_MAX_H}`,
    ).toEqual([]);
    expect(
      skins.length === 0
        ? ['no [data-tap-skin] on either phone screen -- this guard measured nothing']
        : skins.filter((s) => s.ownerW < TOUCH_MIN || s.ownerH < TOUCH_MIN).map(fmt),
      'skins whose owner stopped being a 44px touch target',
    ).toEqual([]);
  });

  /**
   * THE QUESTION CARD, at a phone viewport, for the first time.
   *
   * Until the demo fixture gained a question there was none to look at: the
   * word `questions` appeared nowhere in it and nowhere under `e2e/`, so every
   * "the card renders" verdict in this repo rested on happy-dom, where no
   * stylesheet is loaded and every box is zero. The first run that did look
   * found the step tabs 21px tall and the chat entry 26.8 -- half a touch
   * target each, on the surface whose whole job is to be tapped.
   */
  test('the question card is made of touch targets too', async ({ page }) => {
    await openDemo(page);
    const asking = page.locator('[data-phone-shell] [data-session-row]', {
      has: page.locator('text=vam-build-1'),
    });
    const box = await asking.first().boundingBox();
    if (box === null) throw new Error('no session row asking a question');
    await page.touchscreen.tap(box.x + 60, box.y + box.height / 2);
    await expect(page.locator('[data-question]')).toBeVisible();

    // The corpus, asserted before it is filtered: a card that failed to draw
    // would otherwise pass this test loudest.
    const steps = await page.locator('[data-question-step]').count();
    expect(steps, 'step tabs on a two-question call').toBeGreaterThanOrEqual(2);
    expect(await page.locator('[data-question-option]').count()).toBeGreaterThanOrEqual(3);

    const inCard = (await controls(page)).filter((b) => b.hooks.includes('data-question'));
    expect(inCard.length, 'controls measured inside the card').toBeGreaterThanOrEqual(6);
    expect(undersized(inCard), 'question-card controls under 44x44').toEqual([]);
  });

  test('every interactive control on the SESSION screen is at least 44x44', async ({ page }) => {
    await openDemo(page);
    await openFirstSession(page);
    const boxes = await controls(page);
    expect(boxes.length).toBeGreaterThan(5);
    expect(
      undersized(boxes),
      'measured bounding boxes under 44x44 on the session screen',
    ).toEqual([]);
  });
});

/**
 * The overlay sheets.
 *
 * Two of the four marked hosts are opened here; the other two are not
 * reachable at 390px in the demo fixture and are skipped ALOUD rather than
 * quietly asserted from CSS again -- see the skip's own comment.
 */
test.describe('the overlay sheets at 390px', () => {
  const openSettings = async (page: Page): Promise<Locator> => {
    await page.locator('[data-phone-shell] button[aria-label="settings"]').tap();
    return page.locator('[data-overlay-host]');
  };
  const openIconPicker = async (page: Page): Promise<Locator> => {
    await page.locator('[data-phone-shell] [data-project-icon]').first().tap();
    return page.locator('[data-overlay-host]');
  };

  /** The panel inside a host: everything that is not the full-bleed scrim. */
  const panelOf = (host: Locator) => host.locator(':scope > :not(button)').first();

  for (const [name, open] of [
    ['settings', openSettings],
    ['the project icon picker', openIconPicker],
  ] as const) {
    test(`${name} opens as a bottom sheet, capped and scrolling within itself`, async ({
      page,
    }) => {
      await openDemo(page);
      const host = await open(page);
      await expect(host).toBeVisible();
      const panel = panelOf(host);
      await expect(panel).toBeVisible();

      const geometry = await panel.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          viewport: window.innerHeight,
          overflowY: cs.overflowY,
          maxHeight: Number.parseFloat(cs.maxHeight),
        };
      });

      // Anchored to the bottom edge, not centred below a `pt-16`: the panel's
      // own bottom IS the viewport's bottom (within the sheet's safe-area
      // padding, which is 0 in a browser with no inset).
      expect(Math.round(geometry.bottom)).toBe(Math.round(geometry.viewport));
      // Capped at 85dvh and never taller than the screen -- the fixed
      // `h-[min(600px,80vh)]` on settings' own panel must not win.
      expect(geometry.height).toBeLessThanOrEqual(geometry.viewport * 0.85 + 1);
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      expect(geometry.maxHeight).toBeCloseTo(geometry.viewport * 0.85, 0);
      // Scrolls within itself rather than overflowing off-screen.
      expect(geometry.overflowY).toBe('auto');
    });
  }

  /**
   * `ErrorLogPanel` and `ProjectPicker` are NOT skipped any more -- they are
   * measured in "the sheets behind a source" at the foot of this file, which
   * reaches them by answering `/api/describe` and `/api/load` instead of using
   * the demo fixture. What remains true of the fixture, and is why that block
   * exists: demo refuses every write in the renderer and records the refusal
   * as a `refusal`, never a `failure`, so `failureCount` is structurally 0 and
   * the `N failures` button -- the log's only phone route -- is never drawn;
   * and `ProjectPicker` needs a group, which needs a write-accepting source.
   */
});

/**
 * The keyboard, and the exact line between what a browser can settle and what
 * it cannot.
 *
 * `styles.css` states the open question in its own words: on iOS the soft
 * keyboard shrinks the visual viewport without shrinking the layout viewport,
 * `dvh` does not track it, and whether a sheet's own scroller is ENOUGH to
 * bring an action above the keyboard "is a claim only a real device can
 * settle". These two tests split that claim in half.
 */
test.describe('a sheet with the keyboard up', () => {
  /**
   * The ANDROID / Chrome case, which a browser can reproduce exactly: those
   * engines shrink the layout viewport when the keyboard opens, `dvh` tracks
   * it, and resizing the viewport is that same event. Nothing is simulated
   * here beyond the resize itself.
   */
  test('shrinking the layout viewport re-caps and re-anchors the sheet (the Android case)', async ({
    page,
  }) => {
    await openDemo(page);
    await page.locator('[data-phone-shell] [data-project-icon]').first().tap();
    const panel = page.locator('[data-overlay-host] > :not(button)').first();
    await expect(panel).toBeVisible();

    const short = 844 - IOS_KEYBOARD_CSS_PX;
    await page.setViewportSize({ width: 390, height: short });
    await expect
      .poll(async () => Math.round((await panel.boundingBox())?.height ?? 0))
      .toBeLessThanOrEqual(Math.ceil(short * 0.85));

    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    // Still anchored to the bottom of the SHRUNK viewport, and wholly inside
    // it -- which is what `dvh` tracking the keyboard means.
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(short);
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  });

  /**
   * The iOS case, computed rather than simulated -- and this is the one the
   * CSS's caveat is about.
   *
   * On iOS the layout viewport does NOT shrink, so every box below is at the
   * coordinate it would occupy on the device; the keyboard simply covers the
   * bottom `IOS_KEYBOARD_CSS_PX` of them. The question the caveat asks is
   * whether the sheet's own scroller can bring its primary action into the
   * band that is left. That is answerable here: it is a scroll, and a scroll
   * is layout.
   *
   * The picker's search box is focused first, because on a device that focus
   * is WHAT RAISES the keyboard -- so this is the sheet in the state the
   * caveat describes, not an arbitrary one.
  *
   * IT FAILED WHEN IT WAS WRITTEN, against `4c7188f`: the sheet spanned
   * 411-844px, its only scroller started at 581px -- below the band -- and the
   * first emoji's bottom could get no higher than 621px, 113px under the fold.
   * PR #197 rebuilt the picker; the sheet is now 127-844px with its scroller
   * starting at 296px, and the same measurement passes. The test is unchanged
   * apart from its name, which used to state the finding and now states the
   * property.
   */
  test('the icon picker can bring an emoji above an iOS keyboard', async ({ page }) => {
    await openDemo(page);
    await page.locator('[data-phone-shell] [data-project-icon]').first().tap();
    const host = page.locator('[data-overlay-host]');
    await expect(host).toBeVisible();

    const search = host.locator('input').first();
    await search.focus();

    const reach = await host.evaluate((el, keyboard) => {
      const band = window.innerHeight - (keyboard as number);
      const panel = [...el.children].find((c) => c.tagName !== 'BUTTON') as HTMLElement;
      // The picker's primary action: choosing an emoji. Any of them.
      const target = panel.querySelector('button[aria-label="grinning face"]') as HTMLElement | null;
      if (target === null) return { band, found: false, best: null, panelTop: 0 };
      // Every scroll the sheet can offer, taken: `block: 'start'` pins the
      // target to the top of each ancestor scroller it can move.
      target.scrollIntoView({ block: 'start' });
      const r = target.getBoundingClientRect();
      return {
        band,
        found: true,
        best: { top: Math.round(r.top), bottom: Math.round(r.bottom) },
        panelTop: Math.round(panel.getBoundingClientRect().top),
      };
    }, IOS_KEYBOARD_CSS_PX);

    expect(reach.found, 'the emoji grid rendered').toBe(true);
    const best = reach.best;
    expect(best).not.toBeNull();
    // The margin, reported either way, so a different keyboard figure can be
    // substituted for IOS_KEYBOARD_CSS_PX and this verdict re-derived.
    const shortfall = (best?.bottom ?? 0) - reach.band;
    expect(
      best?.bottom ?? Number.POSITIVE_INFINITY,
      `after every scroll the sheet allows, the first emoji's bottom sits at ` +
        `${best?.bottom}px; an iOS keyboard of ${IOS_KEYBOARD_CSS_PX}px leaves the top ` +
        `${reach.band}px visible, so it is ${shortfall}px short. The sheet's top edge is ` +
        `at ${reach.panelTop}px and its only scroller starts below the band.`,
    ).toBeLessThanOrEqual(reach.band);
  });
});

/**
 * The search route, and the premise in `vam-phone-uiux/spec.md` §5.3.
 *
 * §5.3 flags that "the phone's only text-search route is the Search sessions
 * control, whose `onClick` opens `data-filter-menu`" -- the one overlay family
 * `styles.css` deliberately does NOT turn into a sheet -- and asks for a
 * measurement before §5.1 (do not build a palette sheet) can be relied on.
 *
 * The premise is false, and this describe block is where that is established
 * rather than argued: `onOpenFilter` is `setFiltering(true)` (`Canvas.tsx`),
 * which swaps the button for an in-place `<input>` in the same row
 * (`SessionList.tsx:870`). The anchored popover is a different surface behind
 * a different control -- the funnel, `data-filter-toggle` -- and it holds
 * status and mode toggles, not a search box.
 */
test.describe('the phone search route', () => {
  test('the search control opens an in-place input, not the anchored popover', async ({ page }) => {
    await openDemo(page);
    await page.locator('[data-phone-shell] button[aria-label="search sessions"]').tap();

    const input = page.locator('[data-phone-shell] input[aria-label="filter sessions"]');
    await expect(input).toBeVisible();
    // Focused by the shell itself: the tap that opened the box is the request
    // for it, so a device raises its keyboard here without a second tap.
    await expect(input).toBeFocused();
    // 16px, the iOS zoom threshold -- the phone rule reaching a control that
    // only exists while searching.
    await expect(input).toHaveCSS('font-size', '16px');
    // The surface §5.3 expected. It is not opened by this route at all.
    await expect(page.locator('[data-filter-menu]')).toHaveCount(0);
  });

  test('the search box and its results stay above an iOS keyboard', async ({ page }) => {
    await openDemo(page);
    await page.locator('[data-phone-shell] button[aria-label="search sessions"]').tap();
    const input = page.locator('[data-phone-shell] input[aria-label="filter sessions"]');
    await expect(input).toBeFocused();
    await page.keyboard.type('vam');

    const seen = await page.evaluate((keyboard) => {
      const band = window.innerHeight - (keyboard as number);
      const box = document
        .querySelector('[data-phone-shell] input[aria-label="filter sessions"]')
        ?.getBoundingClientRect();
      const rows = [...document.querySelectorAll('[data-phone-shell] [data-session-row]')].map(
        (el) => {
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
        },
      );
      // The region the list draws into: the thing that CAN scroll a result up
      // when there are more of them than the fixture has. Reported by its top
      // edge, which is what decides whether scrolling helps at all -- the icon
      // picker's scroller fails precisely because its top is below the band.
      const list = document.querySelector('[data-phone-shell] ul')?.getBoundingClientRect();
      return {
        band,
        input: box === undefined ? null : { top: Math.round(box.top), bottom: Math.round(box.bottom) },
        rows,
        listTop: list === undefined ? null : Math.round(list.top),
      };
    }, IOS_KEYBOARD_CSS_PX);

    expect(seen.input?.bottom ?? Number.POSITIVE_INFINITY, 'the search box itself').toBeLessThanOrEqual(
      seen.band,
    );
    expect(seen.rows.length, 'the query narrowed the list').toBeGreaterThan(0);
    expect(
      seen.rows[0]?.bottom ?? Number.POSITIVE_INFINITY,
      `the first result sits at ${JSON.stringify(seen.rows[0])}; the list region starts at ` +
        `${seen.listTop}px, above the ${seen.band}px band, so any result can be scrolled into view ` +
        `-- unlike the icon picker, whose only scroller starts below it`,
    ).toBeLessThanOrEqual(seen.band);
  });

  test('the filter popover fits above an iOS keyboard at 390x844', async ({ page }) => {
    await openDemo(page);
    await page.locator('[data-phone-shell] [data-filter-toggle]').tap();
    const menu = page.locator('[data-filter-menu]');
    await expect(menu).toBeVisible();

    const seen = await menu.evaluate((el, keyboard) => {
      const band = window.innerHeight - (keyboard as number);
      const r = el.getBoundingClientRect();
      const below = [...el.querySelectorAll('button, input')]
        .map((c) => ({
          label: (c.getAttribute('aria-label') ?? c.textContent ?? '').trim().slice(0, 30),
          bottom: Math.round(c.getBoundingClientRect().bottom),
        }))
        .filter((c) => c.bottom > band);
      return {
        band,
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom) },
        textInputs: el.querySelectorAll('input[type="text"], input:not([type])').length,
        below,
      };
    }, IOS_KEYBOARD_CSS_PX);

    // It carries no text box, so nothing in it raises a keyboard: the band
    // only matters here for a keyboard something else left up.
    expect(seen.textInputs, 'the popover holds no search box of its own').toBe(0);
    expect(
      seen.below.map((c) => `${c.label} @ ${c.bottom}`),
      `popover ${JSON.stringify(seen.rect)} against a ${seen.band}px band`,
    ).toEqual([]);
  });

  /**
   * The unconditional property, which is where the popover's real exposure
   * lived: it is excluded from the phone sheet rules by a documented decision
   * -- an anchored popover turned into a bottom sheet is a popover somewhere
   * else -- and that exclusion left it with `max-height: none`,
   * `overflow-y: visible` and no scroller. Its usable height was then whatever
   * the viewport happened to leave below its anchor, and a viewport shorter
   * than its own bottom edge put controls out of reach with nothing to bring
   * them back. Measured here at 375x667 (iPhone SE portrait, a size that still
   * ships) with the viewport shrunk by a keyboard: two controls sat at 383 and
   * 422 in a 331px viewport.
   *
   * The fix keeps it anchored and caps it from its own measured geometry
   * (`useFilterPopoverCap`), so what this test asserts is REACH, not position:
   * the popover fits the viewport, and every control in it is on screen at
   * some scroll offset of its own scroller. Both ends are checked, because a
   * cap without a scroller would clip the same controls the old layout pushed
   * off the bottom -- silently, and this test would not have seen the
   * difference if it only looked at the top.
   *
   * THE ANDROID CASE, reproduced exactly: there the layout viewport really
   * does shrink. On iOS the same controls are covered rather than off-screen,
   * at the same coordinates, and the same scroller is what lifts them.
   */
  test('the filter popover caps itself to the viewport and scrolls, so nothing is out of reach', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openDemo(page);
    await page.locator('[data-phone-shell] [data-filter-toggle]').tap();
    const menu = page.locator('[data-filter-menu]');
    await expect(menu).toBeVisible();

    await page.setViewportSize({ width: 375, height: 667 - IOS_KEYBOARD_CSS_PX });
    const seen = await menu.evaluate((el) => {
      const read = () =>
        [...el.querySelectorAll('button, input')].map((c) => {
          const b = c.getBoundingClientRect();
          return {
            label: (c.getAttribute('aria-label') ?? c.textContent ?? '').trim().slice(0, 30),
            top: Math.round(b.top),
            bottom: Math.round(b.bottom),
          };
        });
      const atTop = read();
      el.scrollTop = el.scrollHeight;
      const atBottom = read();
      el.scrollTop = 0;
      const r = el.getBoundingClientRect();
      return {
        viewport: window.innerHeight,
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom) },
        maxHeight: getComputedStyle(el).maxHeight,
        overflowY: getComputedStyle(el).overflowY,
        scrolls: el.scrollHeight > el.clientHeight + 2,
        controls: atTop.length,
        // A control is reachable when SOME scroll offset puts it fully on
        // screen. Only the two extremes are sampled, which is enough: the
        // popover is one column, so a control the bottom cannot reach is
        // taller than the scroller or outside it.
        unreachable: atTop
          .map((c, i) => ({ c, end: atBottom[i] }))
          .filter(
            ({ c, end }) =>
              !(c.top >= 0 && c.bottom <= window.innerHeight) &&
              !(
                end !== undefined &&
                end.top >= 0 &&
                end.bottom <= window.innerHeight
              ),
          )
          .map(({ c, end }) => `${c.label} @ ${c.bottom} (at full scroll: ${end?.bottom ?? '?'})`),
      };
    });

    const where =
      `the popover spans ${JSON.stringify(seen.rect)} in a ${seen.viewport}px viewport with ` +
      `max-height: ${seen.maxHeight}, overflow-y: ${seen.overflowY}, scrollable: ${seen.scrolls}`;

    // The corpus, asserted: a popover that rendered none of its controls would
    // satisfy every list-shaped check below by having nothing in the list.
    expect(seen.controls, `controls found inside the popover -- ${where}`).toBeGreaterThan(4);
    expect(
      seen.rect.bottom <= seen.viewport ? [] : [`bottom ${seen.rect.bottom} > viewport ${seen.viewport}`],
      `the popover must cap itself to the viewport it is in -- ${where}`,
    ).toEqual([]);
    expect(
      seen.unreachable,
      `controls no scroll offset can bring on screen -- ${where}`,
    ).toEqual([]);
  });
});

/**
 * The two sheets the demo fixture cannot open, opened.
 *
 * The previous run declared these as gaps and left them: `ErrorLogPanel` needs
 * `failureCount > 0` and demo records refusals rather than failures;
 * `ProjectPicker` needs a group, which needs a source that accepts writes. Both
 * are reachable without touching `src/` by giving the page a SOURCE instead of
 * the demo fixture -- `App.tsx`'s browser path asks its own origin for
 * `/api/describe` and `/api/load`, and Playwright can answer those two routes.
 *
 * WHAT THIS IS AND IS NOT. The stub is a transport, not a server: it answers
 * the two reads with a descriptor and three sessions, and refuses every write
 * in the port's own envelope shape. That is enough to draw both sheets, and
 * enough to record a real failure (a refused write is rejected by
 * `http-factory`'s `call`, and `Canvas` puts it through `noteFailure`, which is
 * what `failureCount` counts). It settles LAYOUT at 390px and nothing else --
 * no claim about vam's remote server is made or could be.
 */
test.describe('the sheets behind a source', () => {
  const DESCRIPTOR = {
    id: 'stub',
    label: 'stub source',
    capabilities: {
      liveUpdates: false,
      recordPrompt: true,
      deliverPrompt: false,
      promptAttachments: false,
      slashCommands: false,
      renameSession: true,
      closeSession: true,
      createSession: true,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
    },
    declines: {
      liveUpdates: 'the stub does not stream',
      deliverPrompt: 'the stub delivers nothing',
      promptAttachments: 'the stub takes no attachments',
      slashCommands: 'the stub has no slash commands',
      governance: 'the stub has no governance surface',
      pullRequests: 'the stub has no pull requests',
      terminal: 'the stub has no terminal',
      agentRoster: 'the stub has no agent roster',
    },
    viewerScope: { kind: 'connection', note: 'a stubbed transport, not a server' },
  };
  const session = (id: string, title: string, status: string) => ({
    id,
    title,
    icon: null,
    epic: null,
    status,
    runningAgents: 0,
    activity: null,
    age: '4m',
    branch: null,
    decisions: [{ id: `${id}-d1`, label: 'start', input: 'go', output: 'done', commands: [] }],
    source: 'stub',
  });
  const PROJECTS = [
    { id: 'p1', name: 'alpha', source: 'stub', sessions: [session('s1', 'alpha-1', 'running')] },
    { id: 'p2', name: 'beta', source: 'stub', sessions: [session('s2', 'beta-1', 'waiting')] },
  ];

  const envelope = (value: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, value }),
  });

  /**
   * Route order matters and is not cosmetic: Playwright matches the MOST
   * RECENTLY registered handler first, so the catch-all goes on first and the
   * two reads over the top of it. Registered the other way round, the
   * catch-all answers `/api/describe` with a refusal, `createSourceFromHttp`
   * rejects with a code that is neither `no-such-route` nor `http-*`, and the
   * page draws an empty canvas with a banner -- which is what it did the first
   * time this was written.
   */
  const stubSource = async (page: Page): Promise<void> => {
    await page.route('**/api/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: { kind: 'unreachable', code: 'stub', message: 'the stub refuses writes' },
        }),
      }),
    );
    await page.route('**/api/describe', (route) => route.fulfill(envelope(DESCRIPTOR)));
    await page.route('**/api/load', (route) => route.fulfill(envelope(PROJECTS)));
    await page.goto('/');
    await expect(page.locator('[data-phone-shell] [data-session-row]').first()).toBeVisible();
  };

  /** A refused write, which is what puts a `failure` in the log. */
  const recordAFailure = async (page: Page): Promise<void> => {
    const box = await page.locator('[data-phone-shell] [data-session-row]').first().boundingBox();
    if (box === null) throw new Error('no session row');
    await page.touchscreen.tap(box.x + 60, box.y + box.height / 2);
    await expect(page.locator('[data-phone-shell]')).toHaveAttribute('data-phone-shell', 'session');
    await page.locator('[data-phone-close]').tap();
    await expect(page.locator('[data-phone-status]').first()).toContainText('stub');
    await page.locator('[data-phone-back]').tap();
  };

  test('the error log opens as a bottom sheet from the failures button', async ({ page }) => {
    await stubSource(page);
    await recordAFailure(page);

    const button = page.locator('[data-error-log-button]');
    await expect(button).toBeVisible();
    // The phone's ONLY route into the log, and it is 44x44 -- one of the seven
    // the styles.css rule enumerates.
    const buttonBox = await button.boundingBox();
    expect(buttonBox?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_MIN);
    await button.tap();

    const panel = page.locator('[data-overlay-host] > :not(button)').first();
    await expect(panel).toBeVisible();
    const geometry = await panel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        top: r.top,
        bottom: r.bottom,
        height: r.height,
        viewport: window.innerHeight,
        overflowY: cs.overflowY,
        maxHeight: Number.parseFloat(cs.maxHeight),
      };
    });
    // Anchored to the bottom, within a pixel: the panel carries a border the
    // host does not, and a rounded rect measures 843 against an 844 viewport.
    expect(Math.abs(geometry.bottom - geometry.viewport)).toBeLessThanOrEqual(1);
    expect(geometry.height).toBeLessThanOrEqual(geometry.viewport * 0.85 + 1);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.maxHeight).toBeCloseTo(geometry.viewport * 0.85, 0);
    expect(geometry.overflowY).toBe('auto');
  });

  /**
   * The same family as the row's close `x`, found the same way.
   *
   * `ProjectPicker`'s only opener is `data-add-to-group`, which is `opacity-0`
   * until its heading is `revealed` -- a hover state. A coarse pointer cannot
   * satisfy it, and unlike the row's `x` there is no second route: no chord
   * reaches it on a device with no keyboard, and no other control opens the
   * picker. So on a phone the surface is not merely awkward, it is absent.
   */
  test('the project picker has a phone route at all', async ({ page }) => {
    await stubSource(page);
    await page.locator('[data-new-group]').first().tap();
    await page.locator('[data-group-draft]').fill('gamma');
    await page.keyboard.press('Enter');

    const opener = page.locator('[data-add-to-group]').first();
    await expect(opener).toHaveCount(1);
    const state = await opener.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { opacity: cs.opacity, display: cs.display, w: r.width, h: r.height };
    });
    expect(
      state.opacity,
      `the only control that opens ProjectPicker measures ${state.w}x${state.h} and is ` +
        `revealed by hover, which a finger cannot do`,
    ).not.toBe('0');
  });

  test('the project picker, once open, is a bottom sheet', async ({ page }) => {
    await stubSource(page);
    await page.locator('[data-new-group]').first().tap();
    await page.locator('[data-group-draft]').fill('gamma');
    await page.keyboard.press('Enter');
    // `force`, and said out loud: the opener is hover-revealed, which the test
    // above reports as the finding it is. This test is about the SHEET, and
    // forcing the tap is the only way to get to it -- it measures geometry,
    // and it must not be read as evidence that the route works.
    await page.locator('[data-add-to-group]').first().tap({ force: true });

    const panel = page.locator('[data-overlay-host] > :not(button)').first();
    await expect(panel).toBeVisible();
    const geometry = await panel.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        bottom: r.bottom,
        top: r.top,
        height: r.height,
        viewport: window.innerHeight,
        overflowY: cs.overflowY,
        maxHeight: Number.parseFloat(cs.maxHeight),
      };
    });
    expect(Math.abs(geometry.bottom - geometry.viewport)).toBeLessThanOrEqual(1);
    expect(geometry.height).toBeLessThanOrEqual(geometry.viewport * 0.85 + 1);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.maxHeight).toBeCloseTo(geometry.viewport * 0.85, 0);
    expect(geometry.overflowY).toBe('auto');
  });
});
