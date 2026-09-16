/**
 * LINKS AND `path:line` REFERENCES IN AN AGENT'S ANSWER, driven in Chromium.
 *
 * WHAT ONLY A REAL BROWSER CAN ANSWER, and therefore what this file is for:
 *
 *  1. WHAT THE SHIPPED BUNDLE DRAWS. `test/panels/out-links.test.tsx` proves
 *     the component map turns a link into a button and never into an anchor.
 *     It cannot prove the built page does -- `DetailPanel.files-tab.test.tsx`
 *     records the mutation that made this worth saying: dropping
 *     `components={OUT_MARKDOWN}` from a `<Markdown>` left 1,338 unit tests
 *     green. So the anchor count here is read off the real DOM of the real
 *     bundle.
 *  2. WHETHER THE ADDRESS IS ACTUALLY PAINTED. "The destination stays
 *     readable" is the half of the old rendering that must survive, and a
 *     content scan of the source cannot tell a visible span from a
 *     zero-height one. This measures the RECTANGLE and the computed ink.
 *  3. WHETHER THE LINE JUMP REALLY SCROLLS. A `<textarea>` does not scroll for
 *     a programmatic `setSelectionRange`, so `FilesTab` computes the offset
 *     from the element's own `lineHeight` and `clientHeight` -- both of which
 *     are 0 or `''` in happy-dom, where the whole claim is unmeasurable. Here
 *     it is a number.
 *  4. WHETHER A REFUSAL IS ON SCREEN. A `role="status"` that is rendered but
 *     collapsed says nothing to anybody; this presses a `javascript:` link and
 *     measures the sentence that appears.
 *
 * WHY IT IS NOT `?demo=1`, and why that is the same exception the three Files
 * guards already take rather than a wider one. `App.tsx` chooses the DESKTOP
 * canvas whenever `window.api` exists -- before it looks at `?demo=1` at all --
 * and the Files tab exists only when `window.api.files` does. A page that can
 * open a file therefore cannot be the demo fixture's page. The rule the demo
 * protects is that no real path, session id or transcript reaches a public
 * repo, and a SYNTHETIC stub satisfies it completely: every string below is
 * invented, the root is `/work/demo`, the addresses are `example.test` (an
 * RFC 6761 reserved name that resolves nowhere), and nothing at all is read
 * off the machine that runs this.
 *
 *   node e2e/out-links-shots.mjs http://localhost:5520 e2e/test-results
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const SESSION = 'links-1';

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1100, height: 800 },
  deviceScaleFactor: 2,
});

page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
});

const failures = [];
function check(label, ok, detail) {
  if (ok) {
    console.log(`ok    ${label}`);
    return;
  }
  failures.push(label);
  console.error(`FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

await page.addInitScript(() => {
  /**
   * ONE ANSWER CARRYING EVERY CASE: an address vam opens, an address it
   * refuses, an address whose unicode host must be drawn in punycode, a
   * reference to a file in this project, and a reference that climbs out of
   * it. All invented; `example.test` resolves nowhere by RFC 6761.
   */
  const ANSWER = [
    'Fixed. The cause is in src/index.ts:60 — the guard ran before the parse.',
    '',
    'Background is in the [runbook](https://example.test/runbook), and the mirror',
    'is at [site](https://exämple.test/x), and one of them is [poison](javascript:alert(1))',
    '',
    'I also checked ../../etc/passwd:1, which is not ours.',
  ].join('\n');

  // Sixty-odd lines, so that jumping to line 60 must really scroll.
  const INDEX = [...Array(80).keys()].map((i) => `const line${i + 1} = ${i + 1};`).join('\n');

  const files = new Map([
    ['/work/demo/src/index.ts', { content: INDEX, rev: 0 }],
    ['/work/demo/README.md', { content: '# demo\n', rev: 0 }],
  ]);
  const sig = (path) => {
    const entry = files.get(path);
    return { size: entry.content.length, mtimeMs: entry.rev, sha256: `rev-${entry.rev}` };
  };
  const refuse = (code, message) => Promise.reject({ kind: 'refused', code, message });
  const unavailable = () =>
    Promise.resolve({
      kind: 'unavailable',
      error: { kind: 'unreachable', code: 'stub', message: 'stub source' },
    });

  // What the page asked main to open. The real bridge hands this to
  // `shell.openExternal`; here it is a list the checks can read back, which is
  // how "refused" is told apart from "opened and nothing happened".
  globalThis.__opened = [];

  globalThis.window.api = {
    describe: async () => ({
      id: 'stub',
      label: 'Stub',
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
      },
      declines: {},
      viewerScope: 'operator',
    }),
    load: async () => [
      {
        id: 'p1',
        name: 'stub project',
        sessions: [
          {
            id: 'links-1',
            title: 'stub session',
            icon: null,
            epic: null,
            branch: null,
            status: 'waiting',
            runningAgents: 0,
            activity: null,
            age: '2m',
            decisions: [
              {
                id: 'd1',
                label: 'step 1',
                input: 'Find the cause.',
                output: ANSWER,
                commands: [],
              },
            ],
          },
        ],
      },
    ],
    subscribe: () => () => {},
    recordPrompt: async () => {},
    renameSession: async () => {},
    closeSession: async () => {},
    createSession: async () => {},
    createSessionIn: async () => {},
    pickImageAttachment: async () => null,
    history: async () => unavailable(),
    agentWork: async () => unavailable(),
    applyWaivers: async () => {},
    transitionLesson: async () => {},
    usage: { get: async () => ({ kind: 'unavailable' }) },
    // The link bridge, answering the same `LinkOutcome` main answers.
    link: {
      open: async (url) => {
        globalThis.__opened.push(url);
        return { ok: true, url };
      },
    },
    files: {
      list: async () => ({ root: '/work/demo', files: [...files.keys()], truncated: false }),
      read: async (path) => {
        const entry = files.get(path);
        if (entry === undefined) return refuse('not-found', `${path} does not exist`);
        return { content: entry.content, isBinary: false, signature: sig(path) };
      },
      write: async (path, content) => {
        files.set(path, { content, rev: (files.get(path)?.rev ?? -1) + 1 });
        return { signature: sig(path) };
      },
      // MAIN'S OWN ANSWER, STUBBED AT THE SAME SEAM: a reference inside the
      // project resolves, one that climbs out is refused in words. What main
      // really decides, and how, is `test/main/files/resolve-ipc.test.ts`
      // against a real disk -- this stub only has to answer in the shape the
      // page draws.
      resolve: async (_sessionId, reference) => {
        const [path, line] = [reference.slice(0, reference.lastIndexOf(':')), reference.slice(reference.lastIndexOf(':') + 1)];
        const absolute = path.startsWith('/') ? path : `/work/demo/${path}`;
        if (!files.has(absolute)) {
          return refuse(
            'not-authorized',
            `${path} is not inside this session's own project directory`,
          );
        }
        return { path: absolute, line: Number(line) };
      },
    },
  };
});

await page.goto(origin, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator(`[data-session-row="${SESSION}"]`).first().click();
await page.waitForSelector('[data-out-link]', { timeout: 5_000 });

const boxOf = (sel) =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (el === null) return null;
    const b = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      width: Math.round(b.width),
      height: Math.round(b.height),
      colour: style.color,
      text: el.textContent ?? '',
    };
  }, sel);

// ---------------------------------------------------------------------------
// 1. A LINK IS A BUTTON, AND THE PANE HOLDS NO ANCHOR AT ALL.
//
// The second half is the one with teeth in an Electron window: a real `<a
// href>` navigates the whole application away, and there is no back button
// because the window IS the app.

const drawn = await page.evaluate(() => {
  const out = document.querySelector('[data-out-body]');
  return {
    anchors: out === null ? -1 : out.querySelectorAll('a').length,
    links: out === null ? -1 : out.querySelectorAll('[data-out-link]').length,
    refused: out === null ? -1 : out.querySelectorAll('[data-out-link-refused]').length,
    refs: out === null ? -1 : out.querySelectorAll('[data-out-file-ref]').length,
    tags: [...(out?.querySelectorAll('[data-out-link]') ?? [])].map((el) => el.tagName),
  };
});
check('the answer really rendered its controls', drawn.links === 3 && drawn.refs === 2, JSON.stringify(drawn));
check('and not one of them is an anchor', drawn.anchors === 0, JSON.stringify(drawn));
check('every link is a real button', drawn.tags.every((t) => t === 'BUTTON'), JSON.stringify(drawn));
check('the javascript: one is marked as refused before it is ever pressed', drawn.refused === 1, JSON.stringify(drawn));

// ---------------------------------------------------------------------------
// 2. THE DESTINATION IS PAINTED, AND IT IS THE PARSED ONE.
//
// "No anchor" is also satisfied by drawing nothing, which would be a worse
// page than the bug. And a unicode host has to arrive as punycode, or a
// homograph is invisible exactly where the operator is being asked to trust
// what they read.

const address = await boxOf('[data-out-address]');
check(
  'the address beside a link is really painted, with a box of its own',
  address !== null && address.width > 20 && address.height > 0,
  JSON.stringify(address),
);
const addresses = await page.evaluate(() =>
  [...document.querySelectorAll('[data-out-address]')].map((el) => el.textContent ?? ''),
);
check(
  'a unicode host is drawn in the punycode a browser would resolve',
  addresses.some((text) => text.includes('xn--')) && !addresses.some((t) => t.includes('ä')),
  JSON.stringify(addresses),
);
check(
  'and the refused address is shown too, rather than hidden',
  addresses.some((text) => text.includes('javascript:')),
  JSON.stringify(addresses),
);

await page.screenshot({ path: `${outDir}/out-links-controls.png` });
console.log(`${outDir}/out-links-controls.png`);

// ---------------------------------------------------------------------------
// 3. PRESSING THE REFUSED ONE SAYS WHAT IT REFUSED, AND OPENS NOTHING.

await page.locator('[data-out-link-refused]').click();
await page.waitForSelector('[role="status"]', { timeout: 3_000 }).catch(() => {});
const refusal = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="status"]')].find((node) =>
    /javascript/.test(node.textContent ?? ''),
  );
  if (el === undefined) return null;
  const b = el.getBoundingClientRect();
  return { text: el.textContent ?? '', width: Math.round(b.width), height: Math.round(b.height) };
});
check(
  'a refused scheme draws a sentence naming it, on screen and not merely in the DOM',
  refusal !== null && refusal.height > 0 && refusal.width > 20,
  JSON.stringify(refusal),
);
check(
  'and nothing was handed to the shell',
  (await page.evaluate(() => globalThis.__opened.length)) === 0,
);
await page.screenshot({ path: `${outDir}/out-links-refused.png` });
console.log(`${outDir}/out-links-refused.png`);

// ---------------------------------------------------------------------------
// 4. PRESSING AN ALLOWED ONE ASKS MAIN FOR THE PARSED ADDRESS.

await page.locator('[data-out-link]:not([data-out-link-refused])').first().click();
await page.waitForTimeout(150);
check(
  'an allowed link reaches the bridge, as the parsed address',
  (await page.evaluate(() => globalThis.__opened)).join(',') === 'https://example.test/runbook',
  JSON.stringify(await page.evaluate(() => globalThis.__opened)),
);

// ---------------------------------------------------------------------------
// 5. A REFERENCE THAT CLIMBS OUT OF THE PROJECT SAYS SO.

await page.locator('[data-out-file-ref]').last().click();
await page.waitForTimeout(250);
const escaped = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="status"]')].find((node) =>
    /not inside this session/.test(node.textContent ?? ''),
  );
  if (el === undefined) return null;
  const b = el.getBoundingClientRect();
  return { text: el.textContent ?? '', height: Math.round(b.height) };
});
check(
  'a reference outside the project is refused in words rather than silently',
  escaped !== null && escaped.height > 0,
  JSON.stringify(escaped),
);
check(
  'and the Files tab was not opened for it',
  (await page.locator('[data-files-editor]').count()) === 0,
);

// ---------------------------------------------------------------------------
// 6. THE ONE INSIDE THE PROJECT OPENS THE FILES TAB, AT ITS LINE -- AND
//    REALLY SCROLLS THERE.
//
// The caret offset is arithmetic and is proven in
// `test/panels/files-editor-text.test.ts`. The SCROLL is not arithmetic: a
// `<textarea>` ignores a programmatic selection, so the tab computes a
// `scrollTop` from the element's own line height and viewport height, and both
// of those are unmeasurable in every unit environment vam has.

await page.locator('[data-out-file-ref]').first().click();
await page.waitForSelector('[data-files-editor]', { timeout: 5_000 });
await page.waitForTimeout(250);
const jump = await page.evaluate(() => {
  const area = document.querySelector('[data-files-editor]');
  if (area === null) return null;
  const lineHeight = Number.parseFloat(getComputedStyle(area).lineHeight);
  return {
    caret: area.selectionStart,
    scrollTop: Math.round(area.scrollTop),
    lineHeight,
    clientHeight: Math.round(area.clientHeight),
    caretLine: (area.value.slice(0, area.selectionStart).match(/\n/g) ?? []).length + 1,
  };
});
check(
  'the editor opened on the referenced file with the caret on line 60',
  jump !== null && jump.caretLine === 60,
  JSON.stringify(jump),
);
check(
  'and the view really scrolled there rather than sitting at the top',
  jump !== null && jump.scrollTop > 0,
  JSON.stringify(jump),
);
/**
 * THE LINE IS ON SCREEN, not merely scrolled past. The tab aims for the middle
 * of the view, so line 60's own top must fall inside the visible band -- which
 * is the difference between "scrollTop moved" and "the operator can see the
 * line the agent pointed at".
 */
check(
  'the referenced line is inside the visible band, not above or below it',
  jump !== null &&
    (jump.caretLine - 1) * jump.lineHeight >= jump.scrollTop &&
    (jump.caretLine - 1) * jump.lineHeight <= jump.scrollTop + jump.clientHeight,
  JSON.stringify(jump),
);
await page.screenshot({ path: `${outDir}/out-links-file-jump.png` });
console.log(`${outDir}/out-links-file-jump.png`);

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nout-links: every check passed.');
