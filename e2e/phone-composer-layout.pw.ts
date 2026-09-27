/**
 * THE COMPOSER, MEASURED: the textarea's own content box against every
 * button's own box, at the three widths the operator named (360, 390, 430).
 *
 * WHY THIS FILE AND NOT A NUMBER TACKED ONTO `phone-core-loop.pw.ts`. That
 * suite already owns the composer's HEIGHT against a shrinking keyboard;
 * this owns its WIDTH -- specifically, whether the three round buttons
 * beside the input ("+", dictate, Send) ever paint over the box a caret can
 * sit in. The operator's own report, translated: "the buttons in the prompt
 * input on mobile are big and cover most of the input box" -- a claim about
 * two rectangles, so the fix is verified the same way, in a real layout
 * engine (`?demo=1` before this suite gave both boxes `count 0` for the same
 * reason `phone-core-loop.pw.ts`'s own header records: jsdom applies no
 * stylesheet at all).
 *
 * ONE FIXTURE, REUSED FROM `phone-core-loop.pw.ts`: the descriptor the
 * remote server actually projects (`STUB`), not `?demo=1`'s. The phone this
 * composer is drawn for is the web build over Tailscale Serve, and the
 * remote server turns `terminal` off for every client -- which is what
 * withdraws the keystroke strip and changes the composer's own height, the
 * two things a layout guard must hold constant while it drives a draft into
 * the box.
 */
import { expect, type Page, test } from '@playwright/test';

const SHELL_H = 844;

/** WCAG 2.2 SC 2.5.5 (AAA) and Apple's HIG figure. */
const TOUCH_MIN = 44;

/** Orca's own figure shrunk back to the app's generic icon size (composer
 *  follow-up: "shrink the spacing between the buttons... ~28-32px painted
 *  icons") -- it shipped at 36px first ("a hair bigger than the 30px square"
 *  above it), then the operator asked for the row tightened, and a smaller
 *  painted circle is the other half of that same ask. */
const ACTION_PAINT = 30;

const STUB = {
  id: 'remote',
  label: 'remote factory',
  capabilities: {
    liveUpdates: true,
    recordPrompt: true,
    deliverPrompt: true,
    promptAttachments: false,
    slashCommands: true,
    renameSession: false,
    closeSession: true,
    createSession: true,
    governance: false,
    pullRequests: true,
    terminal: false,
    agentRoster: true,
    resumeSession: true,
  },
  declines: {
    promptAttachments: 'the remote endpoint takes no attachments',
    renameSession: 'the remote endpoint carries no rename route',
    governance: 'the remote endpoint carries no waiver or lesson routes',
    terminal:
      'the remote endpoint does not expose the terminal surface: read, send, answer ' +
      'and resize type into a running agent and need their own rate limit and decision',
    files:
      'the remote endpoint carries no file-read, file-write, file-listing or ' +
      'reference-resolving route',
  },
  viewerScope: { kind: 'connection', note: 'a token-scoped tunnel' },
};

const turn = (id: string, output: string) => ({
  id: `${id}-d1`,
  label: 'the turn',
  input: 'go',
  output,
  commands: [],
});

const PROJECTS = [
  {
    id: 'p1',
    name: 'alpha',
    source: 'remote',
    sessions: [
      {
        id: 's2',
        title: 'alpha-running',
        icon: null,
        epic: null,
        status: 'running',
        runningAgents: 1,
        activity: 'reading the transcript',
        age: '2m',
        branch: null,
        vamControlled: true,
        decisions: [turn('s2', 'still going')],
      },
    ],
  },
];

const envelope = (value: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ ok: true, value }),
});

async function stubRemote(page: Page): Promise<void> {
  await page.route('**/api/**', (route) => route.fulfill(envelope(true)));
  await page.route('**/api/describe', (route) => route.fulfill(envelope(STUB)));
  await page.route('**/api/load', (route) => route.fulfill(envelope(PROJECTS)));
  await page.route('**/api/stream', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('[data-phone-shell] [data-session-row]').first()).toBeVisible();
}

async function openSession(page: Page): Promise<void> {
  await page.locator('[data-phone-shell] [data-session-row]').first().click();
  await expect(page.locator('[data-phone-shell]')).toHaveAttribute('data-phone-shell', 'session');
}

type Rect = { left: number; right: number; top: number; bottom: number; w: number; h: number };

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

async function composerRects(page: Page): Promise<{
  textarea: Rect;
  buttons: readonly Rect[];
  actionSkins: readonly { w: number; h: number }[];
  composer: Rect;
}> {
  return page.evaluate(() => {
    const rect = (el: Element): { left: number; right: number; top: number; bottom: number; w: number; h: number } => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        w: r.width,
        h: r.height,
      };
    };
    const textarea = document.querySelector('[data-phone-shell] [data-composer-bar] textarea');
    const composer = document.querySelector('[data-phone-shell] [data-composer-bar]');
    const buttons = [
      ...document.querySelectorAll(
        '[data-phone-shell] [data-composer-overflow], [data-phone-shell] [data-prompt-dictate], [data-phone-shell] [data-prompt-record]',
      ),
    ];
    const skins = [...document.querySelectorAll('[data-phone-shell] [data-composer-action] > [data-tap-skin]')];
    if (textarea === null || composer === null) throw new Error('composer not found');
    return {
      textarea: rect(textarea),
      buttons: buttons.map(rect),
      actionSkins: skins.map((s) => {
        const r = s.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }),
      composer: rect(composer),
    };
  });
}

for (const width of [360, 390, 430]) {
  test(`at ${width}px: the textarea and its buttons never share a pixel`, async ({ page }) => {
    await page.setViewportSize({ width, height: SHELL_H });
    await stubRemote(page);
    await openSession(page);
    await page.locator('[data-phone-shell] [data-composer-bar] textarea').click();
    // A draft far longer than the box is wide -- the operator's OWN reversal
    // ("the mobile prompt input is single line only") means this no longer
    // grows the box past one line at all; the case worth proving now is the
    // opposite one, that a long draft stays on ONE line (scrolling
    // horizontally, `heightStaysFixed` below) rather than wrapping down onto
    // the buttons beside it the way a plain multi-row textarea would.
    const LONG_DRAFT =
      'a reasonably long draft, long enough that a wrapping box would grow past one line and the buttons beside it would have to hold their ground';
    const heightBefore = await page
      .locator('[data-phone-shell] [data-composer-bar] textarea')
      .evaluate((el) => el.getBoundingClientRect().height);
    await page.fill('[data-phone-shell] [data-composer-bar] textarea', LONG_DRAFT);
    const heightAfter = await page
      .locator('[data-phone-shell] [data-composer-bar] textarea')
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(heightAfter, `textarea height at ${width}px must not grow`).toBe(heightBefore);

    const { textarea, buttons, actionSkins, composer } = await composerRects(page);
    expect(buttons.length, 'the three composer buttons ("+", dictate, Send)').toBe(3);

    for (const button of buttons) {
      expect(
        intersects(textarea, button),
        `textarea ${JSON.stringify(textarea)} vs button ${JSON.stringify(button)} at ${width}px`,
      ).toBe(false);
      expect(button.w, `button hit box at ${width}px`).toBeGreaterThanOrEqual(TOUCH_MIN);
      expect(button.h, `button hit box at ${width}px`).toBeGreaterThanOrEqual(TOUCH_MIN);
    }

    // THE PAINT, NOT THE HIT: Orca's own figure, ~36px, round.
    expect(actionSkins.length, 'the three buttons’ own skins').toBe(3);
    for (const skin of actionSkins) {
      expect(skin.w, `skin paint at ${width}px`).toBe(ACTION_PAINT);
      expect(skin.h, `skin paint at ${width}px`).toBe(ACTION_PAINT);
    }

    // NO HORIZONTAL OVERFLOW: the composer bar itself never runs past the
    // viewport it was given.
    expect(Math.round(composer.right), `composer right edge at ${width}px`).toBeLessThanOrEqual(width);
    expect(Math.round(composer.left), `composer left edge at ${width}px`).toBeGreaterThanOrEqual(0);
    const scroller = await page
      .locator('[data-phone-shell] [data-composer-bar]')
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(scroller, `no horizontal overflow inside the composer at ${width}px`).toBeLessThanOrEqual(0);
  });
}

test('the input pill still fills the width the buttons leave it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: SHELL_H });
  await stubRemote(page);
  await openSession(page);
  const pill = await page.locator('[data-phone-shell] [data-prompt-input]').boundingBox();
  const tools = await page.locator('[data-phone-shell] [data-prompt-tools]').boundingBox();
  expect(pill, 'the input pill').not.toBeNull();
  expect(tools, 'the button group').not.toBeNull();
  // They sit side by side on one line, sharing no pixels.
  expect(
    (pill?.x ?? 0) + (pill?.width ?? 0) <= (tools?.x ?? 0) ||
      (tools?.x ?? 0) + (tools?.width ?? 0) <= (pill?.x ?? 0),
    `pill ${JSON.stringify(pill)} and button group ${JSON.stringify(tools)} overlap`,
  ).toBe(true);
  // The pill is the row's flexible item: most of the composer's width.
  expect((pill?.width ?? 0) > (tools?.width ?? 0)).toBe(true);
});
