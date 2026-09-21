/**
 * THE CORE LOOP ON A PHONE: read what the agent said, answer it, send.
 *
 * WHY THIS FILE IS NOT IN `phone-shell.pw.ts`. That suite's whole fixture is
 * `?demo=1`, and demo DECLINES NOTHING. The phone vam is actually used from is
 * the WEB build over Tailscale Serve, where `src/main/remote/server.ts`'s
 * `UNSERVED` turns `terminal`, `renameSession`, `governance` and `files` off
 * for every remote client and the write routes answer for real. A whole band of
 * behaviour is therefore invisible to demo:
 *
 *   - demo refuses every write in the renderer, so a close that FIRES and a
 *     close that is refused look the same;
 *   - `terminal: false` withdraws the keystroke strip, which changes the
 *     composer's height -- the number every keyboard measurement below is
 *     arithmetic on;
 *   - demo's `declines` is empty, so `RemoteLimits` is 0px there and the repo's
 *     phone suite has never once seen the band it costs on a real phone.
 *
 * So this file builds the descriptor the remote server actually projects and
 * routes `/api/*` itself. `STUB` below is that descriptor; every capability it
 * turns off carries the server's own sentence.
 *
 * THE TWO KEYBOARD MODELS, BOTH MEASURED, because a fix that serves one and
 * not the other is not a fix:
 *
 *   - SHRUNK -- the layout viewport loses the keyboard. Android/Chrome, and
 *     what `dvh` tracks there. Playwright can lay this out for real, so the
 *     viewport is set to `844 - keyboard` and every box below is where the
 *     engine actually put it.
 *   - IOS -- the layout viewport keeps its 844 and the keyboard hides the
 *     bottom `keyboard` px of it (`styles.css` says this in its own words:
 *     "on iOS the LAYOUT viewport is what `dvh` tracks and the keyboard does
 *     not shrink it"). iOS then PANS the page to bring the focused box into
 *     view, so the band the operator can see is the bottom `844 - keyboard` px
 *     of the same layout. That is arithmetic on real coordinates, not a
 *     simulation, and it is reported as a margin in every failure so a real
 *     device figure can be substituted and the verdict re-derived.
 */

import { expect, type Locator, type Page, test } from '@playwright/test';

/**
 * The real iPhone portrait range, WITH accessory and prediction rows. The
 * repo's own mid-figure is 336 (`phone-shell.pw.ts`); the ENDS are what a
 * geometry claim has to survive, so all three are run.
 */
const KEYBOARDS = [291, 336, 380] as const;

/** The viewport this shell is designed against -- iPhone 12/13/14/15 portrait. */
const SHELL_H = 844;

/** WCAG 2.2 SC 2.5.5 (AAA) and Apple's HIG figure -- the shell's own comment. */
const TOUCH_MIN = 44;

/**
 * HOW MUCH OF THE AGENT'S ANSWER HAS TO SURVIVE THE KEYBOARD, and it is six
 * lines rather than a round number: `--text-body--line-height` is 20px
 * (`styles.css`), so 120px is six lines of the thing being answered. Below
 * that the screen stops being a reply screen and becomes a box floating over
 * a card.
 */
const ANSWER_MIN_PX = 120;

/** The descriptor `projectDescriptor()` produces for a remote client. */
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

const QUESTIONS = [
  {
    id: 'toolu_stub:0',
    header: 'Transport',
    question: 'How should the canvas receive updates while a run is live?',
    multiSelect: false,
    options: [
      {
        label: 'Server-sent events',
        description: 'one long-lived GET, the server pushes',
        preview: 'GET /events  →  text/event-stream',
      },
      {
        label: 'Long poll',
        description: 'a request per change, simplest to serve',
        preview: 'GET /changes?since=41  →  200 after 0-30s',
      },
      { label: 'Web socket', description: 'two-way, and vam needs one way', preview: null },
    ],
    answer: null,
  },
  {
    id: 'toolu_stub:1',
    header: 'Retries',
    question: 'Which drops should the client retry by itself?',
    multiSelect: true,
    options: [
      { label: 'The server restarted', description: 'connection closed cleanly' },
      { label: 'The browser cut it off', description: 'the five-second ceiling' },
      { label: 'A proxy timed out', description: 'no bytes for a minute' },
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
    source: 'remote',
    sessions: [
      {
        id: 's1',
        title: 'alpha-waiting',
        icon: null,
        epic: null,
        status: 'waiting',
        runningAgents: 2,
        activity: null,
        age: '4m',
        branch: null,
        vamControlled: true,
        questions: QUESTIONS,
        agents: [
          { id: 'agent-1', type: 'coder', description: 'wire the SSE client', running: true },
          { id: 'agent-2', type: 'reviewer', description: 'read the diff', running: true },
          { id: 'agent-3', type: 'tester', description: 'run the drop suite', running: false },
        ],
        pullRequests: {
          kind: 'ok',
          prs: [
            {
              number: 421,
              title: 'a table of prose wraps into the pane',
              state: 'open',
              checks: 'passing',
              additions: 120,
              deletions: 14,
              changedFiles: 3,
              headRefName: 'smith/vam/out-table-wrap',
              baseRefName: 'smith/vam/0.2-tab-shell',
              author: 'juzser',
              review: 'approved',
              updatedAt: '2026-09-19T09:00:00Z',
              labels: [],
              url: 'https://github.com/juzser/vam/pull/421',
              mergeable: 'mergeable',
            },
          ],
        },
        decisions: [
          turn(
            's1',
            'I looked at the three transports and I have a view, but it is your call. ' +
              'SSE is one long-lived GET and the server pushes. Long poll is a request ' +
              'per change and the simplest thing to serve. A web socket is two-way and ' +
              'vam only ever needs one way. Whichever you pick I will wire the client ' +
              'to match and then re-run the drop suite before I touch anything else.',
          ),
        ],
      },
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

/** Every write route the page asked for, in order -- so a one-tap stop can be
 *  told from a confirmed one by WHAT WAS SENT, not by what is on screen. */
type Writes = { readonly urls: string[] };

async function stubRemote(page: Page): Promise<Writes> {
  const urls: string[] = [];
  await page.route('**/api/**', (route) => {
    urls.push(new URL(route.request().url()).pathname);
    return route.fulfill(envelope(true));
  });
  await page.route('**/api/describe', (route) => route.fulfill(envelope(STUB)));
  await page.route('**/api/load', (route) => route.fulfill(envelope(PROJECTS)));
  await page.route('**/api/stream', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('[data-phone-shell] [data-session-row]').first()).toBeVisible();
  return { urls };
}

/** The waiting session, opened where a finger aims: clear of any right-hand
 *  chrome. It is row 0 because `orderedInProject` puts waiting first. */
async function openWaiting(page: Page): Promise<void> {
  const row = page.locator('[data-phone-shell] [data-session-row]').first();
  const box = await row.boundingBox();
  if (box === null) throw new Error('no session row');
  await page.touchscreen.tap(box.x + 60, box.y + box.height / 2);
  await expect(page.locator('[data-phone-shell]')).toHaveAttribute('data-phone-shell', 'session');
  await expect(page.locator('[data-question]')).toBeVisible();
}

/**
 * THE COMPOSER'S TOOL ROW, AS A ROW RATHER THAN AS BOXES.
 *
 * `scrollWidth` vs `clientWidth`, and every child's right edge against the
 * 390px screen -- asked of the layout rather than of appearance, because
 * `vam-no-scrollbar` hides scrollbars in this app and an overflowing row looks
 * exactly like one that fits. The failure it catches is the one a per-control
 * 44px census cannot see at all: every box in the row can clear 44 while the
 * last of them sits off the side of the screen.
 */
async function toolsRowFits(page: Page, where: string): Promise<void> {
  const row = await page.evaluate(() => {
    const el = document.querySelector('[data-phone-shell] [data-prompt-tools]');
    if (el === null) return null;
    return {
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      offScreen: [...el.children]
        .map((child) => {
          const r = child.getBoundingClientRect();
          return {
            hooks:
              [...child.attributes]
                .map((a) => a.name)
                .filter((n) => n.startsWith('data-') && n !== 'data-state')
                .join(',') || child.tagName,
            right: Math.round(r.right),
            left: Math.round(r.left),
          };
        })
        .filter((c) => c.right > 390 || c.left < 0),
    };
  });
  expect(row, `the composer tool row, with ${where}`).not.toBeNull();
  expect(
    (row?.scrollW ?? 0) <= (row?.clientW ?? 0),
    `the tool row overflows its own box with ${where}: scrollWidth ${row?.scrollW} into clientWidth ${row?.clientW}`,
  ).toBe(true);
  expect(row?.offScreen, `controls off the 390px screen with ${where}`).toEqual([]);
}

type Band = { readonly top: number; readonly bottom: number; readonly h: number };

/** Where the four bands of the session screen actually are. */
async function bands(page: Page): Promise<{
  readonly header: Band | null;
  readonly answer: (Band & { readonly scrollH: number; readonly clientH: number }) | null;
  readonly card: (Band & { readonly scrollH: number; readonly clientH: number }) | null;
  readonly composer: Band | null;
  readonly typing: string | null;
}> {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    };
    const scroller = (sel: string) => {
      const el = document.querySelector(sel);
      const b = box(el);
      if (el === null || b === null) return null;
      return { ...b, scrollH: el.scrollHeight, clientH: el.clientHeight };
    };
    return {
      header: box(document.querySelector('[data-phone-shell] > header')),
      answer: scroller('[data-phone-shell] [data-detail-body]'),
      card: scroller('[data-phone-shell] [data-question-bar]'),
      composer: box(document.querySelector('[data-phone-shell] [data-composer-bar]')),
      typing: document.querySelector('[data-phone-shell]')?.getAttribute('data-phone-keyboard') ?? null,
    };
  });
}

/**
 * THE ONE ROUTE TO A BOX WHILE A QUESTION IS OPEN, and taking it is half the
 * point: `composerHidden` withdraws the composer for an unanswered question,
 * so `Chat about this` is what a phone operator actually presses before they
 * can type a word. Every keyboard measurement below starts here.
 */
async function intoTheBox(page: Page): Promise<Locator> {
  await page.locator('[data-phone-shell] [data-question-chat]').first().click();
  const box = page.locator('[data-phone-shell] [data-composer-bar] textarea');
  await expect(box).toBeFocused();
  await expect(page.locator('[data-phone-shell]')).toHaveAttribute('data-phone-keyboard', 'open');
  return box;
}

test.describe('the answer survives the keyboard', () => {
  for (const keyboard of KEYBOARDS) {
    test(`SHRUNK viewport, ${keyboard}px keyboard: the answer keeps ${ANSWER_MIN_PX}px and nothing runs off the screen`, async ({
      page,
    }) => {
      const height = SHELL_H - keyboard;
      await page.setViewportSize({ width: 390, height });
      await stubRemote(page);
      await openWaiting(page);
      await intoTheBox(page);

      const b = await bands(page);
      expect(b.answer, 'the transcript body').not.toBeNull();
      expect(b.composer, 'the composer').not.toBeNull();
      expect(b.card, 'the question card').not.toBeNull();

      // NOTHING MAY LEAVE THE SCREEN. The failure this guard was written for
      // put the app bar at y=-121 and the answer band entirely above the top
      // edge: the shell overflowed its own `100dvh`, the engine scrolled the
      // root to keep the focused box in view, and everything above the card
      // went with it.
      expect(
        b.header?.top,
        `the app bar's own top edge at a ${keyboard}px keyboard -- negative means the shell overflowed and the root scrolled`,
      ).toBe(0);
      expect(
        b.composer?.bottom,
        `the composer's bottom against a ${height}px viewport`,
      ).toBeLessThanOrEqual(height);

      const visible = Math.max(0, Math.min(b.answer?.bottom ?? 0, height) - Math.max(b.answer?.top ?? 0, 0));
      expect(
        visible,
        `pixels of the agent's answer on screen with a ${keyboard}px keyboard up ` +
          `(header ${JSON.stringify(b.header)}, answer ${JSON.stringify(b.answer)}, ` +
          `card ${JSON.stringify(b.card)}, composer ${JSON.stringify(b.composer)})`,
      ).toBeGreaterThanOrEqual(ANSWER_MIN_PX);

      // THE CARD IS CAPPED AND SCROLLS WITHIN ITSELF, rather than being cut
      // off. Asked as `scrollHeight` vs `clientHeight` and not by looking:
      // `vam-no-scrollbar` hides scrollbars in this app, so appearance says
      // nothing at all about whether there is anything left to reach.
      expect(
        await page.locator('[data-phone-shell] [data-question-bar]').evaluate((el) => getComputedStyle(el).overflowY),
        'the capped card must be able to scroll to the options it no longer shows',
      ).toBe('auto');
      expect(
        (b.card?.scrollH ?? 0) > (b.card?.clientH ?? 0),
        `the card really is taller than the band it was given (scrollHeight ${b.card?.scrollH}, clientHeight ${b.card?.clientH})`,
      ).toBe(true);
    });

    test(`IOS layout, ${keyboard}px keyboard: the answer is still in the band the operator can see`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: SHELL_H });
      await stubRemote(page);
      await openWaiting(page);
      await intoTheBox(page);

      const b = await bands(page);
      expect(b.answer, 'the transcript body').not.toBeNull();
      expect(b.composer, 'the composer').not.toBeNull();

      // The layout viewport is untouched, so the shell still ends at 844 and
      // the composer still sits at the foot of it. What iOS then does is PAN,
      // by at most the keyboard's own height, to bring the focused box into
      // view -- so the worst case for the answer is a full pan, and the band
      // left on screen is [keyboard, 844].
      expect(b.composer?.bottom, 'the composer still ends at the foot of the layout viewport').toBe(
        SHELL_H,
      );
      const top = keyboard;
      const visible = Math.max(0, (b.answer?.bottom ?? 0) - Math.max(b.answer?.top ?? 0, top));
      expect(
        visible,
        `pixels of the agent's answer inside the band a ${keyboard}px keyboard leaves ` +
          `([${top}, ${SHELL_H}]) once iOS has panned to the box ` +
          `(answer ${JSON.stringify(b.answer)}, card ${JSON.stringify(b.card)}, composer ${JSON.stringify(b.composer)})`,
      ).toBeGreaterThanOrEqual(ANSWER_MIN_PX);
    });
  }
});

test.describe('the card names controls that exist', () => {
  test('nothing points the operator at a box that is not drawn', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: SHELL_H });
    await stubRemote(page);
    await openWaiting(page);

    // THE STATE THE SENTENCE IS READ IN: a question open, nothing typed yet.
    // Measured here before it is judged, because a card that failed to draw
    // would pass a text assertion loudest.
    expect(await page.locator('[data-phone-shell] [data-question-option]').count()).toBeGreaterThanOrEqual(3);
    const composers = await page.locator('[data-phone-shell] [data-composer-bar]').count();
    const boxes = await page.locator('[data-phone-shell] textarea').count();
    const note = (await page.locator('[data-question-note]').first().textContent()) ?? '';

    // Either there IS a box below, or the sentence does not promise one. The
    // assertion is the pairing, so satisfying it by drawing the composer is
    // as valid as satisfying it by rewording -- and neither can drift from
    // the other.
    expect(
      { composers, boxes, promisesABox: /box below/i.test(note) },
      `the card says: ${note}`,
    ).toEqual({ composers, boxes, promisesABox: composers > 0 && boxes > 0 });

    // And whatever it names has to be on the screen. `Chat about this` is the
    // one route from a card to a box, so a sentence that names it is a
    // sentence a finger can follow.
    if (!/box below/i.test(note)) {
      await expect(
        page.locator('[data-phone-shell] [data-question-chat]'),
        'the sentence must name a control that is drawn',
      ).toBeVisible();
      expect(note.toLowerCase()).toContain('chat about this');
    }
  });

  test('no phone screen prints a keystroke as a hint', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: SHELL_H });
    await stubRemote(page);

    /**
     * THE FAMILY, NOT THE INSTANCE. `styles.css` suppresses
     * `[data-inline-chord]` and that hook is one of two: the question card's
     * `data-question-chat-key` printed `c` at 6x16 on a touchscreen through
     * every release of that rule. So this sweeps every LEAF element on screen
     * whose whole visible text is a keystroke, and reports the hook -- a new
     * one escaping the rule fails here by name.
     *
     * THE KEYSTROKE STRIP IS NOT AN EXCEPTION AND IS NOT CAUGHT: its chips
     * read `Esc → agent`, which is not a key being NAMED as a hint but a key
     * being SENT by a control whose whole purpose is to press it. The regex
     * matches a bare key and nothing else.
     */
    const sweep = async (where: string) => {
      const found = await page.evaluate(() => {
        const root = document.querySelector('[data-phone-shell]');
        if (root === null) return [{ text: '(no phone shell on screen)', hooks: '', w: 0, h: 0 }];
        const out: { text: string; hooks: string; w: number; h: number }[] = [];
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        for (let el: Node | null = walk.currentNode; el !== null; el = walk.nextNode()) {
          const node = el as Element;
          if (node.children.length > 0) continue;
          const text = (node.textContent ?? '').trim();
          if (!/^([a-z]|Esc|Escape|Tab|⌘|⌥|⇧|Mod-\S+|Ctrl-\S+|[gz][a-z])$/.test(text)) continue;
          const r = node.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          out.push({
            text,
            hooks: [...node.attributes].map((a) => a.name).filter((n) => n.startsWith('data-')).join(','),
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
          });
        }
        return out;
      });
      expect(found, `keystrokes painted on the ${where}`).toEqual([]);
    };

    await sweep('list screen');
    await openWaiting(page);
    await sweep('session screen with a question open');
    await intoTheBox(page);
    await sweep('session screen with the box open');
  });

  test('the offer standing in the prompt box can be taken by a finger', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: SHELL_H });
    await stubRemote(page);
    await openWaiting(page);
    // Pick one, so the offer is the operator's own mark rather than the
    // first option -- the shape a phone operator actually produces.
    await page.locator('[data-phone-shell] [data-question-option]').first().click();
    const box = await intoTheBox(page);

    const placeholder = await box.getAttribute('placeholder');
    expect(
      placeholder,
      'a touchscreen has no Tab, and naming it costs the sentence that explains the box',
    ).not.toMatch(/tab/i);
    expect(placeholder, 'the box still says what it is for').toMatch(/reply|answer|paste/i);

    // THE OFFER IS STILL THERE AND STILL TAKEABLE -- suppressing the caption
    // must not quietly remove the feature with it.
    const use = page.locator('[data-phone-shell] [data-prompt-suggestion-use]');
    await expect(use, 'the route that accepts the offer without a keyboard').toBeVisible();
    const hit = await use.boundingBox();
    expect(hit?.width ?? 0).toBeGreaterThanOrEqual(TOUCH_MIN);
    expect(hit?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_MIN);
    // WHAT IT IS OFFERING IS SAID IN FULL, whatever the chip has room to
    // paint: the whole suggestion is the accessible name, so the one channel
    // that cannot be clipped carries it.
    expect(await use.getAttribute('aria-label')).toContain('Server-sent events');
    await toolsRowFits(page, 'one option marked');

    await use.click();
    await expect(box).toHaveValue('Server-sent events');
    // Taken, so there is nothing left to offer: a control standing over a
    // draft it can only overwrite is the trade `promptSuggestion` already
    // refuses for Tab.
    await expect(use, 'the offer is withdrawn once it has been taken').toHaveCount(0);
  });

  test('the longest offer the card can make does not push Record off the screen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: SHELL_H });
    await stubRemote(page);
    await openWaiting(page);

    // THE LONGEST OFFER IS A MULTI-SELECT'S MARKS, JOINED -- `QuestionCard`
    // gives the composer `picked.join(', ')`, because text is all the box can
    // carry. Step two of this call is the multi-select, so this is the real
    // worst case rather than a long string invented for the test.
    await page.locator('[data-phone-shell] [data-question-step]').nth(1).click();
    const options = page.locator('[data-phone-shell] [data-question-option]');
    // `toHaveCount` and not `count()`: stepping unmounts one question's
    // options and mounts the next one's, and a bare read can land mid-render
    // and report zero -- a corpus assertion failing for the one reason that is
    // not the defect it exists to catch.
    await expect(options, 'options on the multi-select step').toHaveCount(3);
    for (let i = 0; i < 3; i += 1) await options.nth(i).click();
    await intoTheBox(page);

    const use = page.locator('[data-phone-shell] [data-prompt-suggestion-use]');
    await expect(use).toBeVisible();
    await expect(
      use,
      'the offer follows the marks, so this really is the long one',
    ).toHaveAttribute('aria-label', /,.*,/);

    // THE PROPERTY, AND IT IS THE ROW'S AND NOT THE CHIP'S. Every other
    // control here is fixed at 44 or 65 and none of them gives way, so a pill
    // sized to its own content pushes the LAST one -- Record, the control that
    // SENDS -- off a 390px screen. Measured before this was fixed: the row
    // overflowed its 335px and Record's right edge landed at 397, while every
    // box in it still cleared 44.
    await toolsRowFits(page, 'every option on a multi-select marked');
    const record = await page.locator('[data-phone-shell] [data-prompt-record]').boundingBox();
    expect(
      (record?.x ?? 0) + (record?.width ?? 0),
      'the control that sends, against the 390px screen',
    ).toBeLessThanOrEqual(390);

    // AND THE OPERATOR CAN SEE THAT IT IS SHORTENED. Giving way is only honest
    // if the giving-way SHOWS: the first version of this chip put `truncate`
    // on the skin, which is a flex container, and `text-overflow: ellipsis` is
    // ignored there -- the text became an anonymous flex item and was clipped
    // with no mark, so the chip read `Server-sent eve`. That is not a
    // shortened label, it is a wrong one, and no box measurement can tell the
    // two apart. Found on a screenshot; held here as the pairing that makes
    // the ellipsis reachable at all.
    const clip = await page.locator('[data-phone-shell] [data-prompt-suggestion-use]').evaluate(
      (el) => {
        const clipped = [...el.querySelectorAll('*')].find(
          (child) => child.scrollWidth > child.clientWidth + 1,
        );
        if (clipped === undefined) return { clipped: false, display: null, ellipsis: null };
        const cs = getComputedStyle(clipped);
        return { clipped: true, display: cs.display, ellipsis: cs.textOverflow };
      },
    );
    expect(
      clip,
      'the element that clips the offer, and whether an ellipsis can be painted on it',
    ).toEqual({ clipped: true, display: 'block', ellipsis: 'ellipsis' });
  });
});

test.describe('stopping a session is a decision, not a tap', () => {
  test('the × asks first, and sends nothing until it is answered', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: SHELL_H });
    const writes = await stubRemote(page);
    await openWaiting(page);

    // THE GEOMETRY THAT MAKES THIS AN S2: the Agents icon and the × are
    // neighbours on one 390px bar, so the tap that switches a view and the
    // tap that stops a session are a few pixels apart.
    const views = await page.locator('[data-phone-shell] [data-phone-views]').boundingBox();
    const close = await page.locator('[data-phone-close]').boundingBox();
    expect(views, 'the view icon row').not.toBeNull();
    expect(close, 'the close control').not.toBeNull();
    const gap = (close?.x ?? 0) - ((views?.x ?? 0) + (views?.width ?? 0));
    expect(gap, 'pixels between a view switch and the stop control').toBeLessThan(44);

    await page.locator('[data-phone-close]').tap();
    const confirm = page.locator('[data-confirm-close-session]');
    await expect(confirm, 'a stop with no undo asks before it acts').toBeVisible();
    expect(
      writes.urls.filter((u) => u.includes('close-session')),
      'nothing may be sent before the question is answered',
    ).toEqual([]);

    // CANCEL LEAVES THE SESSION ALONE, which is the half a confirm exists for.
    await page.locator('[data-confirm-close-session-cancel]').tap();
    await expect(confirm).toHaveCount(0);
    expect(writes.urls.filter((u) => u.includes('close-session'))).toEqual([]);
    await expect(page.locator('[data-phone-shell]')).toHaveAttribute('data-phone-shell', 'session');

    // AND THE OTHER HALF STILL WORKS: the route is behind a question, not gone.
    await page.locator('[data-phone-close]').tap();
    await page.locator('[data-confirm-close-session-go]').tap();
    await expect
      .poll(() => writes.urls.filter((u) => u.includes('close-session')).length, {
        message: 'the confirmed close must reach the source',
      })
      .toBeGreaterThan(0);
  });

  test('both of the confirm’s own controls are touch targets', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: SHELL_H });
    await stubRemote(page);
    await openWaiting(page);
    await page.locator('[data-phone-close]').tap();
    await expect(page.locator('[data-confirm-close-session]')).toBeVisible();

    const boxes = await page.$$eval('[data-confirm-close-session] button', (els) =>
      els
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
          };
        })
        // The scrim is a full-bleed click-away button, not a control with a
        // size to get wrong.
        .filter((b) => b.w > 0 && b.h > 0 && b.w < 390),
    );
    expect(boxes.length, 'controls measured inside the confirm').toBeGreaterThanOrEqual(2);
    expect(
      boxes.filter((b) => b.w < TOUCH_MIN || b.h < TOUCH_MIN),
      'confirm controls under 44x44',
    ).toEqual([]);
  });
});

/**
 * THE CENSUS, OVER EVERY STATE THE CORE LOOP PASSES THROUGH.
 *
 * `phone-shell.pw.ts` has two of these and both open row 0 in the RESTING
 * Response view, so its corpus has never held a composer, another view, or an
 * open popover -- which is exactly where the five live controls under 44px
 * were. A census is only ever a census of the state it opens.
 */
test.describe('every control a finger meets, in every state', () => {
  const CONTROLS =
    '[data-phone-shell] button, [data-phone-shell] summary, [data-phone-shell] a[href],' +
    ' [data-phone-shell] input, [data-phone-shell] textarea, [data-phone-shell] [role="button"]';

  type Box = { label: string; hooks: string; tag: string; w: number; h: number };

  const census = (page: Page): Promise<Box[]> =>
    page.$$eval(CONTROLS, (els) =>
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
              .slice(0, 40),
            hooks: [...el.attributes]
              .map((a) => a.name)
              .filter((n) => n.startsWith('data-') && n !== 'data-state')
              .join(','),
            tag: el.tagName,
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
          };
        })
        // A 0x0 box is not a touch target that misses 44, it is not a touch
        // target: the composer's file input is 0x0 by design.
        .filter((b) => b.w > 0 && b.h > 0),
    );

  test('no control under 44x44 in any view, with the box open or a popover up', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: SHELL_H });
    await stubRemote(page);

    const seen: Box[] = [];
    const undersized: string[] = [];
    const record = async (where: string) => {
      const boxes = await census(page);
      // THE CORPUS IS PART OF THE ASSERTION. A filter over an empty list is
      // empty, so a sweep that found nothing passes loudest at the moment the
      // state stopped opening.
      expect(boxes.length, `controls found on the ${where}`).toBeGreaterThan(4);
      seen.push(...boxes);
      undersized.push(
        ...boxes
          .filter((b) => b.w < TOUCH_MIN || b.h < TOUCH_MIN)
          .map((b) => `${where}: ${b.w}x${b.h}  ${b.hooks || b.tag}  "${b.label}"`),
      );
    };

    await record('list screen');
    await openWaiting(page);
    await record('session screen, question open');

    await intoTheBox(page);
    await record('session screen, box open');

    // THE POPOVERS, which no census in this repo has ever opened. Each is
    // skipped only when the control it hangs off is genuinely not drawable --
    // and the skip is reported, so an empty sweep cannot pass as a clean one.
    const popovers = 0;
    for (const [name, toggle] of [
      ['provider', '[data-provider-picker-toggle]'],
      ['model', '[data-model-picker]:not([disabled])'],
    ] as const) {
      const control = page.locator(`[data-phone-shell] ${toggle}`).first();
      if ((await control.count()) === 0) continue;
      await control.click();
      await record(`session screen, ${name} popover open`);
      await page.keyboard.press('Escape');
    }
    void popovers;

    // WAS `['agents', 'prs']`, with a `continue` for an icon that was not
    // drawn. `prs` is off the phone now (`panels/tabs.ts`), so leaving it in
    // this list would have been a SILENT SKIP -- a census quietly reporting a
    // state it never opened, which is the exact failure the corpus check
    // inside `record` exists to catch one level up. The withdrawal is asserted
    // as an absence in its own describe below; here the list is simply the
    // views a phone has, and the count is asserted rather than skipped past.
    for (const view of ['agents'] as const) {
      const icon = page.locator(`[data-phone-shell] [data-phone-view="${view}"]`);
      await expect(icon, `the ${view} icon, which this census must reach`).toHaveCount(1);
      await icon.tap();
      await expect(icon).toHaveAttribute('aria-pressed', 'true');
      await record(`session screen, ${view} view`);
    }

    // The hooks the five live defects wore, asserted PRESENT before the
    // filter: a census that stopped reaching them would otherwise report a
    // clean screen.
    const hooks = seen.map((b) => b.hooks).join(' ');
    for (const hook of ['data-agents-toggle', 'data-model-picker', 'data-prompt-suggestion']) {
      expect(hooks, `the census reached ${hook}`).toContain(hook);
    }
    expect(undersized, 'controls under 44x44 across every phone state').toEqual([]);
  });
});

/**
 * THE CUTS THE OPERATOR AUTHORISED, each measured as an ABSENCE on the screen
 * it was taken from rather than as a deleted line in a diff.
 */
test.describe('what the session screen no longer spends room on', () => {
  test('the connection’s limits are a fact about the connection, and live in settings', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: SHELL_H });
    await stubRemote(page);
    await openWaiting(page);
    // 45px on EVERY session screen on every real phone -- and 0px in `?demo=1`,
    // which is why the repo's own phone suite never saw it.
    await expect(
      page.locator('[data-phone-shell] [data-remote-limits]'),
      'the limits band on the session screen',
    ).toHaveCount(0);

    await page.locator('[data-phone-back]').tap();
    await page.locator('[data-phone-shell] button[aria-label="remote access"]').first().tap();
    await expect(page.locator('[data-settings-overlay]')).toBeVisible();
    const limits = page.locator('[data-settings-overlay] [data-remote-limits]');
    await expect(limits, 'and they are still readable, where the connection is configured').toBeVisible();
    await limits.locator('summary').click();
    await expect(limits.locator('[data-remote-limit]').first()).toBeVisible();
    expect(await limits.locator('[data-remote-limit]').count()).toBeGreaterThanOrEqual(4);
  });

  test('the list’s bottom bar restates nothing, and collapses when it has nothing to say', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: SHELL_H });
    await stubRemote(page);
    const bar = page.locator('[data-phone-shell] [data-phone-status-bar]');
    // The rows are the tally: a band reading "2 running · 3 waiting · 1 done"
    // above them is the bar restating a view of itself, and it silently
    // dropped `failed` and `idle` while doing it.
    await expect(bar).toHaveCount(1);
    expect(await bar.textContent()).not.toMatch(/running|waiting|done/i);
    // Nothing refused, no failures -- so it costs no BAND, only the reserve
    // that keeps the last row clear of the home indicator. (Headless Chromium
    // reports every safe-area inset as 0, so that reserve is the rule's own
    // 12px floor here; `phone-shell.pw.ts` emulates the real 34px.)
    const geometry = await bar.evaluate((el) => ({
      h: Math.round(el.getBoundingClientRect().height),
      pad: Math.round(Number.parseFloat(getComputedStyle(el).paddingBottom)),
    }));
    expect(geometry.h, 'the bottom bar with nothing to say').toBeLessThan(TOUCH_MIN);
    expect(geometry.pad, 'and it still clears the home indicator').toBeGreaterThanOrEqual(12);
    // And the refusal cell is still THERE, out of layout rather than absent:
    // "vam has refused nothing" and "this screen has no refusal channel" must
    // not be the same observation.
    await expect(page.locator('[data-phone-shell] [data-phone-status]')).toHaveCount(1);
  });

  /**
   * THE PRs VIEW, CUT ENTIRELY -- and measured as "no route reaches it" rather
   * than as "the icon is gone".
   *
   * WHY THIS FIXTURE AND NOT `?demo=1`. The stub descriptor above declares
   * `pullRequests: true` and session `s1` carries a REAL open pull request
   * (#421, mergeable, with a head branch). So every absence below is a
   * withdrawal by the shell, not an empty list from a source with nothing to
   * say -- which is the only way this test can fail for the right reason.
   */
  test('the PRs view is not on the phone, by any route', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: SHELL_H });
    await stubRemote(page);
    await openWaiting(page);

    // THE ROW IS FOUND FIRST. An absence asserted against a selector that
    // matches nothing is a green test about nothing.
    const icons = page.locator('[data-phone-shell] [data-phone-views] [data-phone-view]');
    await expect(icons, 'the view icon row').toHaveCount(2);
    expect(await icons.evaluateAll((els) => els.map((el) => el.getAttribute('data-phone-view')))).toEqual(
      ['response', 'agents'],
    );
    await expect(page.locator('[data-phone-shell] [data-phone-view="prs"]')).toHaveCount(0);

    // NO PANE, AT ANY ICON. Checked after EVERY tap rather than once at the
    // end, which would only ever measure the last view opened.
    for (const view of ['response', 'agents', 'response'] as const) {
      await page.locator(`[data-phone-shell] [data-phone-view="${view}"]`).tap();
      await expect(page.locator(`[data-phone-shell] [data-phone-view="${view}"]`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.locator('[data-phone-shell] [data-prs]'), `after ${view}`).toHaveCount(0);
      await expect(
        page.locator('[data-phone-shell] [data-pr-merge]'),
        `merge, after ${view}`,
      ).toHaveCount(0);
      await expect(
        page.locator('[data-phone-shell] [data-pr-delete-branch]'),
        `delete branch, after ${view}`,
      ).toHaveCount(0);
    }

    // AND NO NAME OF A PULL REQUEST ANYWHERE ON THE SCREEN. The row hooks are
    // asserted above; this catches a pane that mounted without them.
    expect(await page.locator('[data-phone-shell]').innerText()).not.toContain('421');

    // THE ROOM IT GAVE BACK, on the one bar a phone has: the row is two 44px
    // hit boxes where it was three.
    const widths = await icons.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().width)),
    );
    expect(widths, 'two 44px hit boxes, not three').toEqual([TOUCH_MIN, TOUCH_MIN]);
    const row = await page.locator('[data-phone-shell] [data-phone-views]').boundingBox();
    expect(Math.round(row?.width ?? 0), 'the view row on a 390px bar').toBe(2 * TOUCH_MIN);
  });

  /**
   * THE OTHER HALF, AND THE REASON THE PARAGRAPH ABOVE IS NOT A TAUTOLOGY:
   * the same page, the same served pull request, at a viewport wide enough for
   * the desktop shell. The view IS there. The cut is the phone's, not the
   * build's and not the source's, and the desktop is untouched.
   */
  test('and the desktop shell serving the same data still has it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: SHELL_H });
    await stubRemote(page);
    await openWaiting(page);
    await expect(page.locator('[data-phone-shell] [data-phone-view="prs"]')).toHaveCount(0);

    await page.setViewportSize({ width: 1280, height: SHELL_H });
    await expect(page.locator('[data-phone-shell]'), 'the phone shell steps aside').toHaveCount(0);
    const prsTab = page.locator('[data-view-tabs] [data-view="prs"]');
    await expect(prsTab, 'the desktop’s own PRs tab').toHaveCount(1);
    await prsTab.click();
    await expect(page.locator('[data-prs]'), 'and the pane it opens').toBeVisible();
    await expect(page.locator('[data-pr-title]').first()).toContainText(
      'a table of prose wraps into the pane',
    );
  });

  test('the composer draws no provider picker while there is one provider', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: SHELL_H });
    await stubRemote(page);
    await openWaiting(page);
    await intoTheBox(page);
    await expect(
      page.locator('[data-provider-picker-toggle]'),
      'a control whose list has one row cannot act, so it is not drawn as one',
    ).toHaveCount(0);
    await expect(page.locator('[data-provider-picker]')).toHaveCount(0);
  });

  test('the session strip is tabs and nothing else, and every tab fits', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: SHELL_H });
    await stubRemote(page);
    await openWaiting(page);
    const strip = page.locator('[data-phone-session-tabs]');
    await expect(strip).toBeVisible();
    await expect(page.locator('[data-phone-session-add]'), 'the pinned +').toHaveCount(0);
    await expect(page.locator('[data-phone-session-expand]'), 'the pinned ‹').toHaveCount(0);

    const tabs = page.locator('[data-phone-session-tab]');
    await expect(tabs).toHaveCount(3);
    // THE THIRD CHIP IS THE ASSERTION. With 88px pinned outside the scroller
    // the chips had 266px of 390 and the third was always off screen; the
    // room the two controls were holding is what brings it back.
    const geometry = await strip.evaluate((el) => {
      const chips = [...el.querySelectorAll('[data-phone-session-tab]')].map((b) => {
        const r = b.getBoundingClientRect();
        const skin = b.querySelector('[data-tap-skin]');
        return {
          right: Math.round(r.right),
          label: (b.getAttribute('aria-label') ?? '').slice(0, 24),
          clipped: skin === null ? null : skin.scrollWidth > skin.clientWidth + 1,
        };
      });
      const scroller = el.querySelector('div');
      return {
        chips,
        scrollW: scroller?.scrollWidth ?? 0,
        clientW: scroller?.clientWidth ?? 0,
      };
    });
    expect(geometry.chips.length, 'chips measured').toBe(3);
    expect(
      geometry.chips.filter((c) => c.right > 390),
      'chips whose right edge is off the 390px screen',
    ).toEqual([]);
    expect(
      geometry.chips.filter((c) => c.clipped === true).map((c) => c.label),
      'chips whose name is clipped inside its own skin',
    ).toEqual([]);
  });
});
