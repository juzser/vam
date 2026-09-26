/**
 * THE CACHE-TIMER COUNTDOWN ON THE PHONE LIST, AT 390PX -- NO HORIZONTAL
 * OVERFLOW.
 *
 * `phone-overflow.pw.ts`'s own header records the trap this file is written
 * against: a badge that merely fits its OWN bounding box can still paint
 * past it (ink overflow, distinct from scrollable overflow), and unconstrained
 * content in one row has been measured dragging the WHOLE layout viewport
 * wider on this phone shell before -- so both are checked here, on the row
 * that is actually new (`data-cache-timer`, `SessionList.tsx`), never assumed
 * safe because the row around it was already measured.
 *
 * FIXTURE: a fresh `**\/api/**` stub, the same route-interception shape
 * `phone-overflow.pw.ts`'s own `stubOverflowSource` uses, rather than
 * `?demo=1`'s shared `DEMO_MODEL`. Extending that shared fixture with
 * cache-timer rows was tried first and reverted: a project appended to it
 * broke two unrelated guards that generically iterate "every project" on the
 * desktop sidebar (`tab-strip-shots.mjs`'s exactly-one-idle-tab assumption,
 * and `target-size-shots.mjs`'s per-project hit-target prober, which never
 * found the new project's heading at all). A phone-only stub carries none of
 * that risk: it is read by nobody but this file.
 *
 * Three sessions, one project, the three phases `cacheTimerFor`
 * (`domain/cache-timer.ts`) draws: `normal` (idle, most of a five-minute TTL
 * left), `warning` (waiting, inside the last minute) and `expired` (idle,
 * well past the TTL) -- each timestamp computed relative to `Date.now()` at
 * the moment this file builds the fixture, so the phase is honest whenever
 * this runs, not only on the day it was written.
 */

import { expect, type Page, test } from '@playwright/test';

const CONFIGURED_WIDTH = 390;
const FIVE_MIN_MS = 5 * 60 * 1000;

const DESCRIPTOR = {
  id: 'stub-cache-timer',
  label: 'stub cache-timer source',
  capabilities: {
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
  },
  declines: {
    liveUpdates: 'the stub does not stream',
    recordPrompt: 'the stub takes no prompts',
    deliverPrompt: 'the stub delivers nothing',
    promptAttachments: 'the stub takes no attachments',
    slashCommands: 'the stub has no slash commands',
    renameSession: 'the stub cannot rename',
    closeSession: 'the stub cannot close',
    createSession: 'the stub cannot create',
    governance: 'the stub has no governance surface',
    pullRequests: 'the stub has no pull requests',
    terminal: 'the stub has no terminal',
    agentRoster: 'the stub has no agent roster',
    resumeSession: 'the stub cannot resume',
  },
  viewerScope: { kind: 'connection', note: 'a stubbed transport, not a server' },
};

const turn = (id: string, output: string) => ({
  id: `${id}-d1`,
  label: 'the turn',
  input: 'go on then',
  output,
  commands: [],
});

function cacheTimerProjects() {
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  const session = (
    id: string,
    title: string,
    status: 'idle' | 'waiting',
    lastCacheActivityAgoMs: number,
  ) => ({
    id,
    title,
    epic: null,
    status,
    runningAgents: 0,
    activity: null,
    age: '2m',
    branch: 'main',
    // The countdown is drawn only for `claude-code` rows (`cacheTimerFor`,
    // `domain/cache-timer.ts`) -- the descriptor id above (`stub-cache-
    // timer`) is a transport label and does not stand in for it.
    source: 'claude-code',
    vamControlled: true,
    decisions: [turn(id, 'an ordinary reply')],
    lastCacheActivityAt: iso(lastCacheActivityAgoMs),
    cacheTtlMs: FIVE_MIN_MS,
  });

  return [
    {
      id: 'p1',
      name: 'alpha',
      source: 'stub-cache-timer',
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

const envelope = (value: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ ok: true, value }),
});

async function stubCacheTimerSource(page: Page): Promise<void> {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: { kind: 'unreachable', code: 'stub-cache-timer', message: 'the stub refuses writes' },
      }),
    }),
  );
  await page.route('**/api/describe', (route) => route.fulfill(envelope(DESCRIPTOR)));
  await page.route('**/api/load', (route) => route.fulfill(envelope(cacheTimerProjects())));
  await page.goto('/');
  await expect(page.locator('[data-phone-shell]')).toHaveAttribute('data-phone-shell', 'list');
  await expect(page.locator('[data-phone-shell] [data-session-row]').first()).toBeVisible();
}

const ROW_IDS = ['s1', 's2', 's3'] as const;
const PHASES = { s1: 'normal', s2: 'warning', s3: 'expired' } as const;

test.describe('the cache-timer countdown on the phone list', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: CONFIGURED_WIDTH, height: 844 });
  });

  test('the three phases are on screen, correctly labelled', async ({ page }) => {
    await stubCacheTimerSource(page);
    for (const id of ROW_IDS) {
      const badge = page.locator(`[data-phone-shell] [data-session-row="${id}"] [data-cache-timer]`);
      await badge.scrollIntoViewIfNeeded();
      await expect(badge).toHaveCount(1);
      await expect(badge).toHaveAttribute('data-cache-timer-phase', PHASES[id]);
    }
  });

  test('the layout viewport does not grow to admit any of the three badges', async ({ page }) => {
    await stubCacheTimerSource(page);
    for (const id of ROW_IDS) {
      await page.locator(`[data-phone-shell] [data-session-row="${id}"]`).scrollIntoViewIfNeeded();
    }
    // The CONFIGURED width, never a live `window.innerWidth` read --
    // `phone-overflow.pw.ts`'s own header measured that number growing to
    // swallow exactly this kind of overflow, which would read as green over
    // the defect it exists to catch.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(CONFIGURED_WIDTH);
  });

  for (const id of ROW_IDS) {
    test(`${id}'s badge paints entirely inside the row, inside the 390px screen`, async ({ page }) => {
      await stubCacheTimerSource(page);
      const row = page.locator(`[data-phone-shell] [data-session-row="${id}"]`);
      await row.scrollIntoViewIfNeeded();
      const badge = row.locator('[data-cache-timer]');
      await expect(badge).toHaveCount(1);

      const rowBox = await row.boundingBox();
      const badgeBox = await badge.boundingBox();
      if (rowBox === null || badgeBox === null) throw new Error(`no box for ${id}`);

      // THE ROW ITSELF stays inside the screen -- the coarser fact
      // `phone-shell.pw.ts` already established for every other row's meta
      // line, re-measured here because this row carries a child none of
      // those did.
      expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(CONFIGURED_WIDTH + 0.5);
      // THE BADGE stays inside the ROW -- the ink-overflow trap this file's
      // header names: a box can claim to fit while painting past its own
      // parent's right edge, on the OWNER'S rect, not a live viewport read.
      expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
    });
  }
});
