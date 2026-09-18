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
 *  2. WHAT THE PILL IS, IN PIXELS. A link is ONE `inline-flex` pill -- the
 *     text, the host, a glyph -- and "the destination stays readable" is the
 *     half of the old rendering that must survive it. A content scan of the
 *     source cannot tell a visible span from a zero-height one, nor a pill
 *     that fits its line from one that stretches it, nor a border that
 *     clears 3:1 from one that matched nothing. This measures the RECTANGLES
 *     and the computed inks: the pill's height against the line, its width
 *     against the 262.25px the old `text (address)` rendering measured at
 *     the same size (recorded below), the host's box inside the pill's, the
 *     full address absent from the paint and present on the attribute, and
 *     the three inks against the ground they are painted on.
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
    '',
    // A TEXT THAT CLAIMS AN ADDRESS IT DOES NOT HAVE. The printed caption
    // used to be what stopped this being believed; with the caption gone the
    // NAME is replaced by the real host, and this is where that is measured
    // on a real paint rather than in jsdom.
    'A colleague sent [https://github.com/juzser/vam](https://evil.test/phish).',
    '',
    // THE SHAPE THE OPERATOR ASKED ABOUT: a "Sources:" list. One named, one
    // self-named (the text IS the address, which is how agents write these
    // most of the time), one with a path long enough to fold.
    'Sources:',
    '',
    '- [the fix](https://example.test/fix)',
    '- <https://code.example.test/juzser/vam/pull/383>',
    '- <https://docs.example.test/guide/a/very/long/path/that/goes/on/and/on?tab=readme>',
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

/**
 * WCAG relative luminance and contrast, over the `rgb(...)` triples
 * `getComputedStyle` answers -- the same two functions `tooltip-shots.mjs`,
 * `mode-truth-shots.mjs` and `settings-chrome-shots.mjs` carry, copied rather
 * than imported because each guard is one self-contained file the runner
 * spawns by name.
 */
const rgb = (colour) => (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

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
check('the answer really rendered its controls', drawn.links === 7 && drawn.refs === 2, JSON.stringify(drawn));
check('and not one of them is an anchor', drawn.anchors === 0, JSON.stringify(drawn));
check('every link is a real button', drawn.tags.every((t) => t === 'BUTTON'), JSON.stringify(drawn));
check('the javascript: one is marked as refused before it is ever pressed', drawn.refused === 1, JSON.stringify(drawn));

// ---------------------------------------------------------------------------
// 2. A LINK IS ONE PILL, THE HOST IS PAINTED INSIDE IT, AND THE ADDRESS IS
//    READABLE WITHOUT BEING PRINTED.
//
// "No anchor" is also satisfied by drawing nothing, which would be a worse
// page than the bug. The old control printed the whole parsed address after
// the text; the pill prints the HOST and keeps the address on the control.
// Every number here is read off the real layout, because a class string
// cannot say whether `inline-flex` made one box or whether the host's span
// landed inside it.

/**
 * WHAT THE OLD RENDERING MEASURED, so "narrower" is a number and not a
 * feeling: `runbook (https://example.test/runbook)` at the shipped 13px in
 * this fixture, in this viewport, on 2026-09-17 -- the button 50.00px plus
 * the address hint 212.25px, 262.25px from the text's left edge to the
 * bracket's right. The pill that replaced it has to beat that by a margin
 * that survives a font-metric change, not by a pixel.
 */
const OLD_RUNBOOK_WIDTH = 262.25;

const readPills = () =>
  page.evaluate(() => {
  const opaque = (colour) => /^rgb\(\s*\d/.test(colour);
  // The first opaque fill behind an element, walking up: what the pill's
  // inks are actually painted on. `rgba(0, 0, 0, 0)` is every ancestor
  // between a paragraph and the pane, and a ratio against it is a number
  // about nothing.
  const groundOf = (el) => {
    for (let node = el; node !== null; node = node.parentElement) {
      const fill = getComputedStyle(node).backgroundColor;
      if (opaque(fill)) return fill;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  // The text a sighted reader gets: text nodes not inside the `sr-only` span.
  const printed = (el) => {
    let out = '';
    const walk = (node) => {
      if (node instanceof Element && node.classList.contains('sr-only')) return;
      if (node.nodeType === 3) out += node.textContent ?? '';
      for (const child of node.childNodes) walk(child);
    };
    walk(el);
    return out;
  };
  const box = (el) => {
    const b = el.getBoundingClientRect();
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
  };
  return [...document.querySelectorAll('[data-out-link]')].map((el) => {
    const cs = getComputedStyle(el);
    const host = el.querySelector('[data-out-host]');
    const glyph = el.querySelector('svg');
    const sr = el.querySelector('.sr-only');
    const line = Number.parseFloat(getComputedStyle(el.parentElement).lineHeight);
    return {
      printed: printed(el),
      display: cs.display,
      radius: cs.borderTopLeftRadius,
      borderStyle: cs.borderTopStyle,
      borderWidth: cs.borderTopWidth,
      border: cs.borderTopColor,
      ink: cs.color,
      // THE WASH, COMPOSITED. `backgroundColor` on the pill is an rgba with
      // an alpha, and a contrast ratio wants the colour that is actually
      // there -- so the alpha is resolved over the ground behind it here,
      // where both are in hand, rather than in the check.
      pillGround: (() => {
        const over = groundOf(el);
        const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
        const under = /rgba?\(([^)]+)\)/.exec(over);
        if (m === null || under === null) return over;
        const [r, g, b, a = '1'] = m[1].split(',').map((n) => Number.parseFloat(n));
        const [br, bg, bb] = under[1].split(',').map((n) => Number.parseFloat(n));
        const mix = (top, bottom) => Math.round(top * Number(a) + bottom * (1 - Number(a)));
        return `rgb(${mix(r, br)}, ${mix(g, bg)}, ${mix(b, bb)})`;
      })(),
      // The paragraph's own ink, so "the link wears the prose's colour" is a
      // comparison rather than a literal.
      proseInk: el.parentElement === null ? null : getComputedStyle(el.parentElement).color,
      // SIZE AND PADDING AS COMPARISONS, for the same reason the ink is one.
      // The out size is the operator's own stepper, so "smaller than the out
      // text" can only be asked of the two numbers together -- a literal here
      // would be right at one setting of that stepper and wrong at the rest.
      fontSize: Number.parseFloat(cs.fontSize),
      proseFont:
        el.parentElement === null
          ? null
          : Number.parseFloat(getComputedStyle(el.parentElement).fontSize),
      padX: Number.parseFloat(cs.paddingLeft),
      padY: Number.parseFloat(cs.paddingTop),
      ground: groundOf(el),
      box: box(el),
      line,
      refused: el.hasAttribute('data-out-link-refused'),
      address: el.getAttribute('data-out-address'),
      note: el.getAttribute('data-note'),
      host:
        host === null
          ? null
          : { text: host.textContent ?? '', ink: getComputedStyle(host).color, box: box(host) },
      glyph: glyph === null ? null : box(glyph),
      sr: sr === null ? null : { text: sr.textContent ?? '', box: box(sr) },
      inList: el.closest('li') !== null,
    };
  });
  });
const pills = await readPills();

// THE SAME QUESTION AT THE OTHER END OF THE OPERATOR'S STEPPER, asked here
// while the answer is still the thing on screen.
//
// `--vam-out-font-size` is a 10..20 setting, and "the source is smaller than
// the out text" is a claim about the RELATIONSHIP, not about a size. One
// reading cannot tell a proportional step from a literal that happens to sit
// under the default: a pill pinned at a flat 12px would pass every check in
// this file at the shipped size and be BIGGER than the prose at the bottom of
// the stepper. So the size is driven to both ends and the comparison re-asked.
//
// Driven the way `applyOutFontSize` drives it -- an inline custom property on
// the document element -- because that property IS the mechanism; going
// through the settings overlay would be testing the overlay instead. The
// property is removed again afterwards so every later check in this file reads
// the shipped size.
for (const size of [10, 20]) {
  await page.evaluate((px) => {
    document.documentElement.style.setProperty('--vam-out-font-size', `${px}px`);
  }, size);
  await page.waitForTimeout(120);
  const stepped = await readPills();
  check(
    `at --vam-out-font-size: ${size}px the pill is STILL smaller than the prose`,
    stepped.length > 0 &&
      stepped.every((p) => p.proseFont !== null && p.fontSize < p.proseFont && p.fontSize > 0),
    JSON.stringify(stepped.map((p) => [p.printed, p.fontSize, p.proseFont])),
  );
}
await page.evaluate(() => {
  document.documentElement.style.removeProperty('--vam-out-font-size');
});
await page.waitForTimeout(120);

const within = (inner, outer) =>
  inner.left >= outer.left - 0.5 &&
  inner.right <= outer.right + 0.5 &&
  inner.top >= outer.top - 0.5 &&
  inner.bottom <= outer.bottom + 0.5;
const runbook = pills.find((p) => p.address === 'https://example.test/runbook');
console.log(
  `pills: ${pills.map((p) => `${JSON.stringify(p.printed)} ${p.box.width.toFixed(2)}x${p.box.height.toFixed(2)} on a ${p.line}px line`).join('\n       ')}`,
);
check(
  'every link is ONE inline-flex pill, rounded, with a real box',
  pills.length === 7 &&
    pills.every(
      (p) =>
        p.display === 'inline-flex' &&
        // A CHIP'S CORNER, NOT A CAPSULE'S. The pill lost its border and its
        // caption at the operator's second reading and is a small ground
        // under a word now, so a full `height/2` radius would make a lozenge
        // out of a phrase. Between 3px and half the box is the shape.
        Number.parseFloat(p.radius) >= 3 &&
        Number.parseFloat(p.radius) < p.box.height / 2 &&
        p.box.width > 12 &&
        p.box.height > 0,
    ),
  JSON.stringify(pills.map((p) => [p.display, p.radius, p.box.width, p.box.height])),
);
check(
  'and it fits its line rather than stretching it: at least 80% of the line-height, never more',
  pills.every((p) => p.box.height <= p.line && p.box.height >= 0.8 * p.line),
  JSON.stringify(pills.map((p) => [p.box.height, p.line])),
);
check(
  'a pill is SMALLER than the prose it sits in, at whatever size that prose is',
  // The operator: "the source needs to be smaller than the out font size."
  // Asked as a comparison against the paragraph's own computed size, because
  // `--vam-out-font-size` is a 10..20 stepper the operator sets -- the check
  // below re-asks it at another setting, which is the half a single reading
  // cannot answer.
  pills.every((p) => p.proseFont !== null && p.fontSize < p.proseFont),
  JSON.stringify(pills.map((p) => [p.printed, p.fontSize, p.proseFont])),
);
check(
  'and it has padding on BOTH axes, so the wash is not flush against the word',
  // "the pill needs more padding" -- and a pill with horizontal padding alone
  // is a wash that touches the ascenders, which is the state this replaces.
  pills.every((p) => p.padX >= 4 && p.padY > 0),
  JSON.stringify(pills.map((p) => [p.printed, p.padX, p.padY])),
);

check(
  `the runbook pill is a THIRD of the ${OLD_RUNBOOK_WIDTH}px its text + address used to take`,
  // It was "a fifth or more" when the pill still carried a host caption; the
  // caption is gone, so the bar moves with it rather than staying where the
  // old rendering could have crept back under it.
  runbook !== undefined && runbook.box.width <= 0.35 * OLD_RUNBOOK_WIDTH,
  JSON.stringify(runbook?.box),
);
check(
  'NO pill paints a path, a scheme or a folded address -- a name and a glyph is the whole of it',
  pills.every((p) => !p.printed.includes('/') && !p.printed.includes('…') && !/https?:/.test(p.printed)),
  JSON.stringify(pills.map((p) => p.printed)),
);
check(
  'a link that has no name of its own is named by its HOST, and a named one by its name',
  // `docs.example.test` is written `<https://docs.example.test/retries>` in
  // the fixture and `runbook` is `[runbook](...)`: the two cases, one rule.
  pills.some((p) => p.printed === 'docs.example.test' && p.host?.text === 'docs.example.test') &&
    pills.some((p) => p.printed === 'runbook' && p.host === null),
  JSON.stringify(pills.map((p) => [p.printed, p.host?.text ?? null])),
);
check(
  'a link whose TEXT claims an address it does not have paints the REAL host instead',
  // The caption used to be what stopped a lying text from being believed.
  // With the caption gone the name itself is replaced -- the lie is never
  // painted at all. See `textLooksLikeAddress`.
  pills.some((p) => p.address === 'https://evil.test/phish' && p.printed === 'evil.test') &&
    !pills.some((p) => p.printed.includes('github.com/juzser')),
  JSON.stringify(pills.map((p) => [p.printed, p.address])),
);
// Read off the WHOLE answer, not the pills: the rendering this replaced
// printed the address in a sibling span OUTSIDE the button, and a scan of the
// pills alone would not see it come back.
const bodyPrinted = await page.evaluate(() => {
  let out = '';
  const walk = (node) => {
    if (node instanceof Element && node.classList.contains('sr-only')) return;
    if (node.nodeType === 3) out += node.textContent ?? '';
    for (const child of node.childNodes) walk(child);
  };
  walk(document.querySelector('[data-out-body]'));
  return out;
});
check(
  'the full address is NOT printed -- nothing in the answer paints a scheme or a bracketed address',
  !/https?:\/\//.test(bodyPrinted) && !bodyPrinted.includes('(') && !/alert\(/.test(bodyPrinted),
  JSON.stringify(bodyPrinted),
);
check(
  'but is on the control three ways: data-out-address, the Note, and a 1px screen-reader span',
  pills.every(
    (p) =>
      typeof p.address === 'string' &&
      p.address.length > 0 &&
      (p.refused || (p.note ?? '').includes(p.address)) &&
      p.sr !== null &&
      (p.refused || p.sr.text.includes(p.address)) &&
      p.sr.box.width <= 1 &&
      p.sr.box.height <= 1,
  ),
  JSON.stringify(pills.map((p) => [p.address, p.note, p.sr])),
);
check(
  'the refused address is on its control too, as written, rather than hidden',
  pills.some((p) => p.refused && p.address === 'javascript:alert(1)'),
  JSON.stringify(pills.filter((p) => p.refused).map((p) => p.address)),
);
check(
  'a glyph is painted at the end of every pill, inside it',
  // THE GLYPH IS THE WHOLE AFFORDANCE NOW: with no border and no second ink,
  // it is the only thing that says "this opens something" -- a shape rather
  // than a hue, which is what WCAG 1.4.1 asks for. It sits after the name.
  pills.every((p) => p.glyph !== null && p.glyph.width > 6 && within(p.glyph, p.box) && p.glyph.left > p.box.left),
  JSON.stringify(pills.map((p) => p.glyph)),
);
check(
  'NO pill paints a border at all, and the live ones take the prose ink',
  pills.every((p) => p.borderWidth === '0px') &&
    pills.filter((p) => !p.refused).every((p) => p.ink === p.proseInk),
  JSON.stringify(pills.map((p) => [p.printed, p.borderWidth, p.ink, p.proseInk])),
);
check(
  'a pill IS a wash: its ground differs from the prose it sits in, and the refused one is faint',
  pills.every((p) => p.pillGround !== p.ground) &&
    pills.filter((p) => p.refused).every((p) => p.ink !== p.proseInk),
  JSON.stringify(pills.map((p) => [p.printed, p.pillGround, p.ground, p.refused])),
);

// THE THREE INKS ON THE GROUND THEY ARE PAINTED ON, IN BOTH THEMES. The
// border is a control's boundary (WCAG 1.4.11, 3:1); the text and the host
// are text (1.4.3, 4.5:1). `border-ink-quiet` was chosen because no `line-*`
// token clears 3:1 in the light theme (2.80:1 at loudest, computed off the
// tokens); this is where that choice is measured as paint rather than
// asserted, and the light theme is the one that would have caught a `line-*`
// border, so it is not skipped. `html.light` is the whole theme switch
// (`styles.css`), the same lever `tooltip-shots.mjs` pulls.
for (const theme of ['dark', 'light']) {
  await page.evaluate((t) => document.documentElement.classList.toggle('light', t === 'light'), theme);
  const themed = theme === 'dark' ? pills : await readPills();
  const inks = themed.map((p) => ({
    printed: p.printed,
    text: Number(ratio(p.ink, p.pillGround).toFixed(2)),
    ground: p.pillGround,
  }));
  console.log(`${theme} inks: ${JSON.stringify(inks)}`);
  // NO BORDER CHECK ANY MORE, and its absence is a decision rather than an
  // omission: there is no border to measure, and the wash under the words is
  // deliberately under 3:1 (`--vam-out-pill`, ~1.3:1 dark). A ground that
  // carried meaning would have to clear 1.4.11; this one carries none -- the
  // GLYPH is the affordance, checked above -- so what is left to prove is
  // that the words are readable ON the wash, which is 1.4.3's 4.5:1 and is
  // measured against the pill's own ground rather than the paragraph's,
  // because the wash is what they are actually painted on.
  check(
    `${theme}: every pill's words clear 4.5:1 on the wash they sit on`,
    inks.length === 7 && inks.every((i) => i.text >= 4.5),
    JSON.stringify(inks),
  );
  if (theme === 'light') {
    await page.screenshot({ path: `${outDir}/out-links-controls-light.png` });
    console.log(`${outDir}/out-links-controls-light.png`);
  }
}
await page.evaluate(() => document.documentElement.classList.remove('light'));

// THE SOURCES LIST: three pills, one per item, each on its own line, with air
// between them. A list item that is only a link keeps its bullet -- the
// bullet is where the item begins and the pill is the item -- and the
// screenshot is where that pairing is judged.
const sources = pills.filter((p) => p.inList);
check(
  'a Sources list of three links is three pills, one per item',
  sources.length === 3 && sources.every((p) => p.display === 'inline-flex'),
  JSON.stringify(sources.map((p) => p.printed)),
);
check(
  'stacked on three lines with air between them, not touching',
  sources.length === 3 &&
    sources.slice(1).every((p, i) => p.box.top - sources[i].box.bottom >= 2),
  JSON.stringify(sources.map((p) => [p.box.top, p.box.bottom])),
);
check(
  'the two self-named links are named by their hosts, with no path and nothing folded',
  // They were `host + path`, the path folded at 24 characters, until the
  // operator asked for the name and the icon alone. The hosts stay; the
  // paths, the fold and the `…` go, and the addresses they came from are
  // still on the controls.
  ['code.example.test', 'docs.example.test'].every((host) =>
    pills.some((p) => p.printed === host && (p.address ?? '').includes(host)),
  ) && !pills.some((p) => p.printed.includes('…')),
  JSON.stringify(pills.map((p) => p.printed)),
);

// THE DESTINATION OPENS ON FOCUS, not only on hover: the pill carries a
// `Note`, not a `title`, for the reason `Note.tsx` states -- no browser shows
// a `title` to a keyboard. Focused the way a keyboard focuses, no pointer.
await page.locator('[data-out-link]').first().focus();
const tip = await page
  .waitForSelector('[role="tooltip"]', { timeout: 3_000 })
  .then((el) => el.evaluate((node) => ({ text: node.textContent ?? '', height: node.getBoundingClientRect().height })))
  .catch(() => null);
check(
  'focusing a pill opens a note that says the full address it opens',
  tip !== null && tip.text.includes('https://example.test/runbook') && tip.height > 0,
  JSON.stringify(tip),
);
await page.evaluate(() => document.activeElement?.blur());
await page
  .waitForFunction(() => document.querySelector('[role="tooltip"]') === null, null, { timeout: 3_000 })
  .catch(() => {});

await page.screenshot({ path: `${outDir}/out-links-controls.png` });
// AND THE ANSWER ALONE, clipped to the prose so the picture in `docs/ui` is
// the pills rather than the window around them. Playwright's `clip`, because
// `sips` ignores a crop offset on this machine.
{
  const body = await page.locator('[data-out-body]').first().boundingBox();
  if (body !== null) {
    await page.screenshot({
      path: `${outDir}/out-link-pills.png`,
      clip: { x: body.x, y: body.y, width: body.width, height: Math.min(body.height, 320) },
    });
    console.log(`${outDir}/out-link-pills.png`);
  }
}
console.log(`${outDir}/out-links-controls.png`);

// THE DOCS SHOT: the answer's body -- an inline pill, a refused one, and the
// Sources list -- cropped to its own box with `clip`.
const bodyBox = await page.evaluate(() => {
  const b = document.querySelector('[data-out-body]')?.getBoundingClientRect();
  return b === undefined ? null : { x: b.left - 8, y: b.top - 8, width: b.width + 16, height: b.height + 16 };
});
if (bodyBox !== null) {
  await page.screenshot({ path: `${outDir}/out-link-pills.png`, clip: bodyBox });
  console.log(`${outDir}/out-link-pills.png`);
}

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
