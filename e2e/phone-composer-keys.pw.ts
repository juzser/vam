/**
 * THE PHONE'S OWN CHANNEL INTO A PANE, DRIVEN FROM A REAL BROWSER: the
 * keystroke strip, over the remote descriptor (`terminal: false`, the exact
 * one `remote/server.ts` projects for every phone client), tapping each of
 * the six `/api/send-key` allows and checking the request it actually sends.
 *
 * WHY THIS FILE AND NOT ANOTHER UNIT TEST. `test/shared/remote-key.test.ts`,
 * `test/main/remote/send-key.test.ts`, `test/main/remote/send-key-route
 * .test.ts` and `test/panels/send-key-remote.test.ts` already prove the
 * allowlist, the pane resolution and the client's fetch wrapper in
 * isolation, each with the real module underneath. What none of them can
 * see is the STRIP ITSELF, rendered by the real bundle in a real layout
 * engine, deciding which six buttons to draw and wiring each one to the
 * right POST -- `phone-composer-layout.pw.ts`'s own header gives the reason
 * every phone suite in this repo routes `/api/*` itself rather than reading
 * `?demo=1`: the remote descriptor is what actually turns the local
 * `window.api.terminal.send` channel off, which is the one fact this whole
 * feature exists to work around.
 *
 * FALSIFICATION, the operator's own ask: change `KEY_STRIP`'s filter
 * (`(hasLocalTerminalChannel ? KEY_STRIP : KEY_STRIP.filter(...))`,
 * `DetailPanel.tsx`) to stop filtering, and "never draws Up or Down" below
 * red-lines -- the two keys `paneKeyToRemoteKeyId` refuses would appear on
 * the one surface that has no channel for them.
 */
import { expect, type Page, test } from '@playwright/test';

const SHELL_H = 844;

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

type SendKeyCall = { sessionId: unknown; key: unknown };

/**
 * Routes `/api/*` the way `remote/server.ts` actually answers for a phone
 * client, plus `/api/send-key` -- fulfilled from `answer` (default: every
 * key lands), every body it received pushed to `calls` in the order they
 * arrived.
 */
async function stubRemote(
  page: Page,
  answer: (call: SendKeyCall) => { ok: true; value: null } | { ok: false; error: { code: string; message: string } } = () => ({
    ok: true,
    value: null,
  }),
): Promise<SendKeyCall[]> {
  const calls: SendKeyCall[] = [];
  await page.route('**/api/**', (route) => route.fulfill(envelope(true)));
  await page.route('**/api/describe', (route) => route.fulfill(envelope(STUB)));
  await page.route('**/api/load', (route) => route.fulfill(envelope(PROJECTS)));
  await page.route('**/api/stream', (route) => route.abort());
  await page.route('**/api/send-key', (route) => {
    const call = route.request().postDataJSON() as SendKeyCall;
    calls.push(call);
    const body = answer(call);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/');
  await expect(page.locator('[data-phone-shell] [data-session-row]').first()).toBeVisible();
  return calls;
}

async function openSession(page: Page): Promise<void> {
  await page.locator('[data-phone-shell] [data-session-row]').first().click();
  await expect(page.locator('[data-phone-shell]')).toHaveAttribute('data-phone-shell', 'session');
}

const strip = (page: Page) => page.locator('[data-phone-shell] [data-key-strip]');
const keyButton = (page: Page, id: string) => page.locator(`[data-phone-shell] [data-key-strip-key="${id}"]`);

/** Strip id -> the id `shared/remote-key.ts`'s `REMOTE_KEY_IDS` answers for. */
const ALLOWED = [
  ['escape', 'escape'],
  ['tab', 'tab'],
  ['enter', 'enter'],
  ['back-tab', 'back-tab'],
  ['space', 'space'],
  ['backspace', 'backspace'],
  ['delete', 'delete'],
  ['up', 'arrow-up'],
  ['down', 'arrow-down'],
  ['left', 'arrow-left'],
  ['right', 'arrow-right'],
  ...['c', 'd', 'l', 'z', 'r', 'a', 'e', 'w', 'u'].map((l) => [`ctrl-${l}`, `ctrl-${l}`] as const),
] as const;

test('the key strip draws every remote-allowlisted key, none filtered out', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: SHELL_H });
  await stubRemote(page);
  await openSession(page);
  await expect(strip(page)).toBeVisible();
  const ids = await page
    .locator('[data-phone-shell] [data-key-strip-key]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-key-strip-key')).sort());
  expect(ids).toEqual(ALLOWED.map(([id]) => id).sort());
});

for (const [id, remote] of ALLOWED) {
  test(`tapping "${id}" POSTs exactly {sessionId, key: "${remote}"} to /api/send-key`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: SHELL_H });
    const calls = await stubRemote(page);
    await openSession(page);
    await keyButton(page, id).scrollIntoViewIfNeeded();
    await keyButton(page, id).click();
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual({ sessionId: 's2', key: remote });
  });
}

test('a refusal from the route is drawn, not swallowed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: SHELL_H });
  await stubRemote(page, () => ({
    ok: false,
    error: { kind: 'refused', code: 'no-terminal', message: 'no pane for this session' },
  }));
  await openSession(page);
  await keyButton(page, 'escape').click();
  await expect(page.locator('[data-phone-shell] [data-mode-cycle]')).toContainText('not sent');
});

test('Paste never posts through /api/send-key, even when it is enabled', async ({ page }) => {
  // Paste reads the phone's own clipboard and types the result through the
  // EXISTING prompt path (`onPasteFromClipboard`, `DetailPanel.tsx`) -- it
  // must never reach the allowlist-only route, which is this test's whole
  // claim. Chromium's clipboard read needs the permission AND a real user
  // gesture in most builds; whichever way `clipboardReadAvailable`/
  // `pasteDenied` land the button in, tapping it must not be one of the
  // calls `/api/send-key` recorded.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 390, height: SHELL_H });
  const calls = await stubRemote(page);
  await openSession(page);
  await page.evaluate(() => navigator.clipboard.writeText('pasted from the phone'));
  const paste = page.locator('[data-phone-shell] [data-key-strip-paste]');
  await expect(paste).toBeVisible();
  const disabled = await paste.isDisabled();
  if (!disabled) {
    await paste.click();
    await expect
      .poll(() => page.locator('[data-phone-shell] textarea').inputValue())
      .toContain('pasted from the phone');
  }
  expect(calls).toEqual([]);
});
