/**
 * MARKDOWN IN THE FILES TAB — the raw colours, the rendered document, and the
 * tree's own glyphs, measured in Chromium.
 *
 * WHY A SECOND FILES GUARD RATHER THAN MORE OF `files-tab-keyboard-shots.mjs`.
 * That file is one page driven through seven numbered sections that share
 * state: it counts tree rows, walks a cursor through them by index, and has a
 * comment of its own about a section leaking an expanded directory into the
 * next one. Adding a `.md` to its stub changes the row count under every one
 * of those. The claims here are separable, so they get their own page.
 *
 * WHY IT IS NOT `?demo=1`, and why that is the same exception the two
 * existing Files guards take rather than a wider one. `Canvas.tsx` draws this
 * tab only when `window.api?.files` exists, and demo mode has no `window.api`
 * at all — there is no button to click. The rule `readme-shots.mjs` states is
 * that no real path, session id or transcript reaches a public repo, and a
 * SYNTHETIC stub satisfies that completely: every string below is invented,
 * the root is `/work/demo`, and nothing is read off the machine that runs it.
 *
 * `terminal: true` IS DELIBERATE, exactly as it is in the sibling guard: with
 * it the view pill carries all five icons, which is the widest the corner ever
 * gets and the only width at which a new control in this tab's header row can
 * be proven not to sit under it. Nothing here opens the Terminal tab.
 *
 * WHAT ONLY A REAL BROWSER CAN ANSWER, and therefore what this file is for:
 *
 *  1. WHAT THE OVERLAY PAINTS. `files-highlight.ts`'s markdown scanner is
 *     proven token by token in `test/panels/files-highlight.test.ts`, and a
 *     token kind is a CLASS NAME. A stylesheet that defined none of these
 *     tokens would leave every run the same inherited ink, every unit test
 *     would still pass, and the whole feature would be invisible. So the
 *     colours are read off `getComputedStyle`, per kind.
 *  2. WHERE THE NEW BUTTON'S BOX IS. A control can be measurably buried under
 *     the view pill and still perfectly clickable, because Playwright clicks
 *     an element's CENTRE — this is the finding the sibling guard was written
 *     for and it applies to every control added to that row since.
 *  3. WHAT THE TREE'S GLYPHS ARE PAINTED WITH, for the same reason as (1), and
 *     HOW MUCH OF A ROW IS LEFT FOR ITS NAME once a 12px glyph is in front of
 *     it — at vam's narrowest legal pane, which is where that costs the most.
 *     A glyph that fits the column while squeezing every name to an ellipsis
 *     would pass every check in the unit suite.
 *  4. WHETHER THE PREVIEW IS REALLY OUTSIDE THE INSERT SCOPE, read off the
 *     status bar's own mode chip — the app's live answer to "who owns the
 *     keyboard", derived from `document.activeElement`'s ancestry in a real
 *     DOM, which neither unit environment has.
 *  5. GITHUB'S OWN SIZE LADDER AND RULES, AS PAINT, NOT AS A CLASS NAME. A
 *     `text-[32px] border-b` on an h1 that named no real Tailwind rule (a
 *     typo in the token, a stray character in the bracket) would still read
 *     back from `element.className` in a unit test; `getComputedStyle` is
 *     the only thing that reads what actually reached the box.
 *  6. THE SEGMENTED CONTROL, PAINTED — both words really on screen (not a
 *     `display: none` label satisfying a `textContent` check), and the
 *     control still fitting inside the pane at vam's 320px floor, where the
 *     icon-only button it replaced never had to.
 *  7. WHETHER A LINK IS READABLE AS A LINK AT REST. `text-chip` on the
 *     button is a class-name fact a unit test can read; whether that class
 *     names a rule that paints a colour a reader could tell apart from the
 *     paragraph around it is a `getComputedStyle` fact only a real cascade
 *     answers, which is what the comparison against a real `<p>`'s own
 *     colour is for.
 *
 *   node e2e/files-markdown-shots.mjs http://localhost:5520 e2e/test-results
 */
import { chromium } from 'playwright-core';

const origin = process.argv[2] ?? 'http://localhost:5520';
const outDir = process.argv[3] ?? 'docs/ui';

const SESSION = 'md-1';

const browser = await chromium.launch();
// `deviceScaleFactor: 2` for the PICTURES and for nothing else. Every check
// below is a `getBoundingClientRect` or a `getComputedStyle`, both of which
// are CSS pixels and are unaffected by it -- what it changes is that a 12px
// tree glyph reaches a reviewer as 24 real pixels instead of 12, which is the
// difference between a colour they can judge and one they have to take on
// trust. `files-tab-shots.mjs` captures the shipped README picture the same
// way, for the same reason.
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
   * ONE MARKDOWN FILE THAT EXERCISES EVERY BRANCH OF BOTH SURFACES: a heading
   * for the scanner's loudest rule, a list and a quote rail, a thematic break,
   * a fence whose CONTENT must stay uncoloured in the raw view and IS coloured
   * in the rendered one (two different code paths, two different claims), a
   * GFM table and a strikethrough (which plain CommonMark does not produce),
   * a LINK and an IMAGE (the two constructs `OUT_MARKDOWN` defuses, and the
   * ones that bite hardest in an Electron window -- see the check below), and
   * two lines of raw HTML, a `<script>` and an `<img>`, that must reach the
   * DOM as characters. Both HTML lines carry a payload that would set a global
   * if it ever ran, so the check can ask the page rather than the markup.
   */
  const README = [
    '# Atlas',
    '',
    'A **service** with a [runbook](https://example.test/runbook) and `one` inline span.',
    '',
    '![architecture diagram](https://example.test/arch.png)',
    '',
    '## Getting started',
    '',
    '- copy `.env.example` to `.env`',
    '- run the migrations',
    '- start the server',
    '',
    '> The pool limit is the thing that bites first.',
    '',
    '---',
    '',
    '```ts',
    'const port = Number(process.env.PORT ?? 8787);',
    '// a comment, and a # that is NOT a heading',
    'export const server = { port };',
    '```',
    '',
    '| setting | default |',
    '| --- | --- |',
    '| PORT | 8787 |',
    '| POOL | 10 |',
    '',
    '~~Deprecated~~ since 0.2.',
    '',
    '- [ ] write the migration',
    '- [x] ship the service',
    '',
    '<script>globalThis.__pwned = 1</script>',
    '',
    '<img src="https://example.test/x.png" onerror="globalThis.__pwned = 2">',
    '',
  ].join('\n');

  /**
   * A SECOND FILE, FOR THE SAME REASON README.md's OWN NEIGHBOURS ARE SEPARATE
   * FILES RATHER THAN MORE OF ITS BODY: adding these cases into README.md
   * would move `items`, `tableHeaders` and every other count section 4 already
   * pins. Operator report, translated: "the md preview has a bug with the code
   * block style" — reported against the SHIPPED build, with no fence
   * reproduced, so this is every shape real markdown puts in front of a fence
   * that the fixture above never exercised: no infostring, an infostring
   * nothing recognises, one it does, CommonMark's OTHER code-block syntax (4
   * spaces, no fence at all), a fence nested inside a list item rather than at
   * the top level, a line long enough that wrapping it would be worse than
   * scrolling it, content that LOOKS like other constructs (`#`, `>`, a tab)
   * but is quoted text inside a fence, and the `~~~` delimiter CommonMark
   * accepts beside `` ``` ``.
   */
  const CODE = [
    '# Code blocks',
    '',
    'No language:',
    '',
    '```',
    'plain fenced text',
    'no info string at all',
    '```',
    '',
    'Unknown language:',
    '',
    '```mermaid',
    'graph TD; A-->B;',
    '```',
    '',
    'A recognised language, for contrast with the one above:',
    '',
    '```shell',
    'echo hello',
    '```',
    '',
    'Indented (4-space) code block, not a fence at all:',
    '',
    '    indented block line one',
    '    indented block line two',
    '',
    'A fence inside a list item:',
    '',
    '- item one',
    '  ```ts',
    '  const nested = true;',
    '  ```',
    '- item two',
    '',
    'A line long enough that it must scroll, not wrap or overflow the pane:',
    '',
    '```',
    'x'.repeat(220),
    '```',
    '',
    'Content that looks like other constructs, and a real tab:',
    '',
    '```',
    '# not a heading',
    '> not a quote',
    '\tindented with a real tab',
    '```',
    '',
    'A `~~~` fence:',
    '',
    '~~~',
    'tilde fenced content',
    '~~~',
    '',
  ].join('\n');

  const files = new Map([
    ['/work/demo/README.md', { content: README, rev: 0 }],
    ['/work/demo/CODE.md', { content: CODE, rev: 0 }],
    ['/work/demo/.env', { content: '# service\nPORT=8787\n', rev: 0 }],
    ['/work/demo/package.json', { content: '{\n  "name": "atlas"\n}\n', rev: 0 }],
    ['/work/demo/Makefile', { content: 'build:\n\techo build\n', rev: 0 }],
    ['/work/demo/assets/logo.svg', { content: '<svg />\n', rev: 0 }],
    ['/work/demo/src/index.ts', { content: 'export const a = 1\n', rev: 0 }],
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
        // FIVE VIEW ICONS, the widest the corner pill ever gets. See this
        // file's header: a control in the Files header row can only be proven
        // clear of the pill at the width the pill really reaches.
        terminal: true,
        agentRoster: false,
        resumeSession: false,
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
            id: 'md-1',
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
                input: 'Write the runbook.',
                output: 'Wrote it.',
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
    },
  };
});

await page.goto(origin, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-tab-strip]');
await page.locator(`[data-session-row="${SESSION}"]`).first().click();
await page.waitForSelector('[data-view="files"]', { timeout: 5_000 });
await page.locator('[data-view="files"]').click();
await page.waitForSelector('[data-files-row]', { timeout: 5_000 });

const treeRow = (path) => page.locator(`[data-files-row-path="${path}"]`);
const box = (sel) =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (el === null) return null;
    const b = el.getBoundingClientRect();
    return {
      left: Math.round(b.left),
      right: Math.round(b.right),
      top: Math.round(b.top),
      bottom: Math.round(b.bottom),
      width: Math.round(b.width),
      height: Math.round(b.height),
    };
  }, sel);

// ---------------------------------------------------------------------------
// 1. THE TREE'S GLYPHS, AS PAINT.
//
// `test/panels/files-icons.test.tsx` proves the classifier and that each
// family draws its own component; both are facts about a class name and a
// `d` attribute. What neither can answer is whether `styles.css` defines the
// token that class points at. A palette missing `--vam-quote` would leave the
// markdown glyph the same inherited ink as everything else, the whole colour
// channel would be invisible, and every unit test would stay green.

const glyphs = await page.evaluate(() =>
  [...document.querySelectorAll('[data-files-row]')].map((row) => ({
    path: row.getAttribute('data-files-row-path'),
    shape: row.querySelector('[data-file-icon]')?.getAttribute('data-file-icon') ?? null,
    colour: (() => {
      const icon = row.querySelector('[data-file-icon]');
      return icon === null ? null : getComputedStyle(icon).color;
    })(),
  })),
);

check(
  'every visible row really draws a glyph',
  glyphs.length >= 5 && glyphs.every((g) => g.shape !== null),
  JSON.stringify(glyphs),
);
check(
  'and the families are the ones the classifier named',
  glyphs.find((g) => g.path === '/work/demo/README.md')?.shape === 'doc' &&
    glyphs.find((g) => g.path === '/work/demo/.env')?.shape === 'config' &&
    glyphs.find((g) => g.path === '/work/demo/package.json')?.shape === 'json' &&
    glyphs.find((g) => g.path === '/work/demo/Makefile')?.shape === 'plain' &&
    glyphs.find((g) => g.path === '/work/demo/src')?.shape === 'directory',
  JSON.stringify(glyphs),
);

const grey = glyphs.find((g) => g.path === '/work/demo/Makefile')?.colour;
check(
  'the four hued families are really painted, and none of them is the grey',
  grey !== null &&
    ['/work/demo/README.md', '/work/demo/.env', '/work/demo/package.json', '/work/demo/src'].every(
      (path) => {
        const found = glyphs.find((g) => g.path === path);
        return found !== undefined && found.colour !== null && found.colour !== grey;
      },
    ),
  JSON.stringify(glyphs),
);
check(
  'and they are four DISTINCT colours — one token pointed at another is a swatch that lies',
  new Set(
    ['/work/demo/README.md', '/work/demo/.env', '/work/demo/package.json', '/work/demo/src'].map(
      (path) => glyphs.find((g) => g.path === path)?.colour,
    ),
  ).size === 4,
  JSON.stringify(glyphs),
);

// A directory really changes its glyph when it opens — the fact the `▸`/`▾`
// twisty used to carry, and the reason it could be replaced rather than joined.
await treeRow('/work/demo/src').click();
await page.waitForFunction(
  () =>
    document
      .querySelector('[data-files-row-path="/work/demo/src"] [data-file-icon]')
      ?.getAttribute('data-file-icon') === 'directory-open',
  null,
  { timeout: 3_000 },
).catch(() => {});
check(
  'an opened directory draws the open folder — the state the twisty used to carry',
  (await page.evaluate(
    () =>
      document
        .querySelector('[data-files-row-path="/work/demo/src"] [data-file-icon]')
        ?.getAttribute('data-file-icon') ?? null,
  )) === 'directory-open',
);
await treeRow('/work/demo/src').click();
await page.waitForFunction(
  () => document.querySelectorAll('[data-files-row]').length === 5,
  null,
  { timeout: 3_000 },
).catch(() => {});

await page.screenshot({ path: `${outDir}/files-md-tree.png` });
console.log(`${outDir}/files-md-tree.png`);

// ---------------------------------------------------------------------------
// 1.5 THE DEFAULT — the operator's actual complaint, translated: ".md files
// need to be previewed GitHub-style, and there must be a button to switch
// between preview mode and raw mode." The button already existed and opened
// onto raw text every time, which is why nobody found it. A fresh page has
// no stored preference, so `/work/demo/README.md` has to open straight into
// the RENDERED document — not the raw editor the rest of this file has
// always assumed — with no click at all.

await treeRow('/work/demo/README.md').click();
await page.waitForSelector('[data-files-preview-view]', { timeout: 5_000 });
check(
  'a freshly opened .md, on a device with no stored choice, opens straight into the preview',
  (await page.locator('[data-files-editor]').count()) === 0 &&
    (await page.evaluate(
      () => document.querySelector('[data-files-preview]')?.getAttribute('data-files-preview-state'),
    )) === 'preview',
);

// ---------------------------------------------------------------------------
// 2. THE RAW VIEW: markdown's line structure, painted. Reached by pressing
// "Raw" explicitly, now that opening the file alone no longer gets here.

await page.locator('[data-files-preview-option="raw"]').click();
await page.waitForSelector('[data-files-editor]', { timeout: 5_000 });
await page.waitForSelector('[data-files-highlight]', { timeout: 5_000 });

const painted = await page.evaluate(() => {
  const runs = [...document.querySelectorAll('[data-files-highlight] span')];
  const byClass = new Map();
  for (const run of runs) {
    const key = run.className || 'plain';
    if (!byClass.has(key)) byClass.set(key, getComputedStyle(run).color);
  }
  return Object.fromEntries(byClass);
});
check(
  'a .md really gets an overlay, and it paints at least three distinct colours',
  new Set(Object.values(painted)).size >= 3,
  JSON.stringify(painted),
);
check(
  'a heading is painted with a real token, not the inherited ink',
  painted['text-syn-keyword'] !== undefined && painted['text-syn-keyword'] !== painted.plain,
  JSON.stringify(painted),
);
check(
  'a list marker is its own colour, distinct from a heading and from plain text',
  painted['text-syn-number'] !== undefined &&
    painted['text-syn-number'] !== painted.plain &&
    painted['text-syn-number'] !== painted['text-syn-keyword'],
  JSON.stringify(painted),
);
check(
  'a rail — fence, quote, thematic break — is the quiet token',
  painted['text-syn-comment'] !== undefined && painted['text-syn-comment'] !== painted.plain,
  JSON.stringify(painted),
);

/**
 * AND THE LOSSLESSNESS PROPERTY, IN THE ONE PLACE IT ACTUALLY MATTERS.
 *
 * The unit sweep proves `highlightEditor` reproduces its input byte for byte.
 * That is the arithmetic; THIS is the consequence — two layers laid out over
 * the same characters, with the operator's caret in the copy they cannot see.
 * A dropped byte would show up here as a length difference and nowhere else on
 * screen until a line painted in the wrong place.
 */
const layers = await page.evaluate(() => {
  const area = document.querySelector('[data-files-editor]');
  const over = document.querySelector('[data-files-highlight]');
  if (area === null || over === null) return null;
  const as = getComputedStyle(area);
  const os = getComputedStyle(over);
  return {
    overlayText: over.textContent,
    areaValue: area.value,
    sameHeight: Math.abs(over.scrollHeight - area.scrollHeight) <= 1,
    sameFont: as.fontFamily === os.fontFamily && as.fontSize === os.fontSize,
    sameMetrics: as.lineHeight === os.lineHeight && as.whiteSpace === os.whiteSpace,
  };
});
check(
  'the overlay holds the markdown file byte for byte, plus only the newline a <pre> drops',
  layers !== null &&
    layers.overlayText ===
      (layers.areaValue.endsWith('\n') ? `${layers.areaValue}\n` : layers.areaValue),
  `overlay ${layers?.overlayText?.length} chars vs value ${layers?.areaValue?.length}`,
);
check(
  'and the two layers are the same face, metrics and height over a real markdown file',
  layers?.sameFont === true && layers?.sameMetrics === true && layers?.sameHeight === true,
  JSON.stringify({ ...layers, overlayText: undefined, areaValue: undefined }),
);

await page.screenshot({ path: `${outDir}/files-md-raw.png` });
console.log(`${outDir}/files-md-raw.png`);

// ---------------------------------------------------------------------------
// 3. THE TOGGLE'S OWN BOX, at the widest the view pill ever is.
//
// ASSERTED AS A RECTANGLE, NEVER AS A CLICK. The sibling guard's header
// records why: the Save button really did sit 18px under the pill while every
// click-based check passed, because Playwright clicks an element's CENTRE.
// This row has one more control in it now.

const corner = await page.evaluate(() => {
  const r = (sel) => {
    const e = document.querySelector(sel);
    if (e === null) return null;
    const b = e.getBoundingClientRect();
    return {
      left: Math.round(b.left),
      right: Math.round(b.right),
      top: Math.round(b.top),
      bottom: Math.round(b.bottom),
      width: Math.round(b.width),
    };
  };
  return {
    overlay: r('[data-view-overlay]'),
    preview: r('[data-files-preview]'),
    format: r('[data-files-format]'),
    save: r('[data-files-save]'),
    header: r('[data-files-header]'),
    icons: document.querySelectorAll('[data-view-overlay] [data-view]').length,
  };
});
check(
  'the pill really is carrying all five view icons — otherwise this section proves nothing',
  corner.icons === 5,
  `it carries ${corner.icons}`,
);
check(
  'the preview toggle is drawn, next to the formatter, as the operator asked',
  corner.preview !== null && corner.format !== null && corner.preview.right <= corner.format.left,
  JSON.stringify(corner),
);
check(
  'and every control in the row clears the view pill entirely, not just at its centre',
  corner.overlay !== null &&
    [corner.preview, corner.format, corner.save].every(
      (b) => b !== null && b.right <= corner.overlay.left,
    ),
  JSON.stringify(corner),
);
check(
  'and none of them is taller than the row that reserves the corner’s height',
  corner.header !== null &&
    [corner.preview, corner.format, corner.save].every(
      (b) => b !== null && b.top >= corner.header.top && b.bottom <= corner.header.bottom,
    ),
  JSON.stringify(corner),
);

// A TWO-SEGMENT CONTROL WITH TEXT LABELS, not the old icon-only button —
// the operator found that one unreadably small and never noticed it was
// there. Both words have to be PAINTED, not merely present in the DOM: a
// label with `display: none` would pass a `textContent` check and still be
// exactly as invisible as the icon-only button it replaced.
const labels = await page.evaluate(() => {
  const box = (el) => {
    if (el === null) return null;
    const b = el.getBoundingClientRect();
    return { width: Math.round(b.width), height: Math.round(b.height) };
  };
  const preview = document.querySelector('[data-files-preview-option="preview"]');
  const raw = document.querySelector('[data-files-preview-option="raw"]');
  return {
    previewText: preview?.textContent ?? null,
    rawText: raw?.textContent ?? null,
    previewBox: box(preview),
    rawBox: box(raw),
  };
});
check(
  'the segmented control shows both words, Preview and Raw, not only icons',
  (labels.previewText ?? '').includes('Preview') && (labels.rawText ?? '').includes('Raw'),
  JSON.stringify(labels),
);
check(
  'and both segments are really painted with a non-zero box, not display:none text',
  (labels.previewBox?.width ?? 0) > 0 &&
    (labels.previewBox?.height ?? 0) > 0 &&
    (labels.rawBox?.width ?? 0) > 0 &&
    (labels.rawBox?.height ?? 0) > 0,
  JSON.stringify(labels),
);

// ---------------------------------------------------------------------------
// 4. THE RENDERED DOCUMENT.

await page.locator('[data-files-preview-option="preview"]').click();
await page.waitForSelector('[data-files-preview-view]', { timeout: 5_000 });

const rendered = await page.evaluate(() => {
  const view = document.querySelector('[data-files-preview-view]');
  if (view === null) return null;
  const fence = view.querySelector('pre');
  const colours = new Set(
    [...(fence?.querySelectorAll('span') ?? [])].map((s) => getComputedStyle(s).color),
  );
  const h1 = view.querySelector('h1');
  const h2 = view.querySelector('h2');
  const h3 = view.querySelector('h3');
  const checkbox = view.querySelector('input[type="checkbox"]');
  const checkedBox = [...view.querySelectorAll('input[type="checkbox"]')].find((b) => b.checked);
  const cell = view.querySelector('td');
  const img = view.querySelector('[data-files-markdown-image]');
  const link = view.querySelector('[data-files-markdown-link]');
  const paragraph = view.querySelector('p');
  return {
    h1: h1?.textContent ?? null,
    h2: h2?.textContent ?? null,
    items: view.querySelectorAll('li').length,
    quote: view.querySelector('blockquote')?.textContent ?? null,
    rule: view.querySelectorAll('hr').length,
    tableHeaders: view.querySelectorAll('th').length,
    struck: view.querySelector('del')?.textContent ?? null,
    fenceColours: [...colours],
    // GITHUB'S OWN SIZE LADDER, MEASURED, NOT READ OFF THE STYLESHEET — a
    // `text-[2em]` class that named no real rule would still pass a grep of
    // this file's own source, which is exactly what a unit test cannot see
    // past (happy-dom applies no stylesheet at all) and what this real
    // Chromium page is for. Measured as a RATIO against the paragraph's own
    // size rather than a hardcoded pixel floor, because the root the ladder
    // scales off is now `--vam-out-font-size` (the operator's own Response
    // view setting, see `FilesTab.tsx`'s `[data-files-markdown-github]`
    // header) — a fixed floor tuned for GitHub's old 16px root would go stale
    // the moment that setting differs from its default, which is the exact
    // failure a ratio cannot have.
    h1FontSize: h1 === null ? null : Number.parseFloat(getComputedStyle(h1).fontSize),
    paragraphFontSize: paragraph === null ? null : Number.parseFloat(getComputedStyle(paragraph).fontSize),
    h1BorderBottom: h1 === null ? null : Number.parseFloat(getComputedStyle(h1).borderBottomWidth),
    h2BorderBottom: h2 === null ? null : Number.parseFloat(getComputedStyle(h2).borderBottomWidth),
    h3BorderBottom: h3 === null ? null : Number.parseFloat(getComputedStyle(h3).borderBottomWidth),
    // A TASK LIST — `- [ ]`/`- [x]`, GFM alone, plain CommonMark draws neither
    // as anything but a literal `[ ]`. The box has to be a REAL, DISABLED
    // `<input>`, not a glyph standing in for one: an operator who tabbed to
    // it and pressed Space must not silently "check" a fact about a file
    // vam did not write.
    checkboxCount: view.querySelectorAll('input[type="checkbox"]').length,
    checkboxDisabled: checkbox === null ? null : checkbox.disabled,
    checkedIsChecked: checkedBox !== undefined,
    // TABLE BORDERS, MEASURED ON A REAL CELL rather than assumed from the
    // `border` class every cell carries — the same "a class is not a rule"
    // gap the h1 size measurement closes.
    cellBorderWidth: cell === null ? null : Number.parseFloat(getComputedStyle(cell).borderTopWidth),
    // THE IMAGE PLACEHOLDER — GitHub's own broken-image shape standing in
    // for a fetch this preview still will not make (see this file's own
    // header on `img`/`a`, below).
    imageBorderWidth:
      img === null ? null : Number.parseFloat(getComputedStyle(img).borderTopWidth),
    imageShowsAddress: (img?.textContent ?? '').includes('https://example.test/arch.png'),
    // THE LINK'S RESTING COLOUR — GitHub paints a link in its accent colour
    // ALWAYS, underline only on hover; a link that reads as the same ink as
    // the sentence around it is not readable as a link until the pointer
    // happens to be over it. Measured against a REAL paragraph's computed
    // colour rather than assumed equal to `text-ink-dim`'s own value, so a
    // token that resolved to the identical colour by coincidence could not
    // pass this the way a class-name grep could.
    linkColor: link === null ? null : getComputedStyle(link).color,
    paragraphColor: paragraph === null ? null : getComputedStyle(paragraph).color,
    linkHasGlyph: link === null ? null : link.querySelector('svg') !== null,
    // The wall, half one: raw HTML in the file must reach the DOM as
    // CHARACTERS. Both halves are read back off the rendered tree AND off the
    // page's own globals, because a payload that ran is the only proof that
    // matters and the markup would not show it.
    scripts: view.querySelectorAll('script').length,
    showsScriptAsText: (view.textContent ?? '').includes('<script>'),
    pwned: globalThis.__pwned ?? null,
    // The wall, half two: an ordinary markdown LINK and IMAGE. `rehype-raw`
    // being off does nothing about these -- react-markdown renders a real
    // `<a href>` and a real `<img src>` for them by default, and it is
    // `OUT_MARKDOWN`'s own `a:`/`img:` overrides that defuse them.
    anchors: view.querySelectorAll('a[href]').length,
    images: view.querySelectorAll('img').length,
    // ...and the reader still gets both destinations, which is what stops
    // "render nothing at all" from satisfying the two counts above.
    showsHref: (view.textContent ?? '').includes('https://example.test/runbook'),
    showsLinkWords: (view.textContent ?? '').includes('runbook'),
    showsAlt: (view.textContent ?? '').includes('architecture diagram'),
    // ...and the SYNTAX is consumed, which is the third direction the
    // transcript's own version of this guard carries: without it a preview
    // that had stopped rendering and was showing raw source would satisfy
    // every count and every string above.
    showsRawSyntax: (view.textContent ?? '').includes('](') ||
      (view.textContent ?? '').includes('!['),
    // And the raw editor is GONE, not hidden — a hidden textarea would still
    // be this tab's first `data-insert-stop` in document order.
    editors: document.querySelectorAll('[data-files-editor]').length,
    insertStops: document.querySelectorAll('[data-files] [data-insert-stop]').length,
    tabIndex: view.getAttribute('tabindex'),
  };
});

check('the preview renders the document', rendered?.h1 === 'Atlas', JSON.stringify(rendered?.h1));
check('with its sub-headings', rendered?.h2 === 'Getting started', JSON.stringify(rendered?.h2));
// 3 plain bullets + 2 task-list items.
check('its list', rendered?.items === 5, `it has ${rendered?.items} items`);
check('its blockquote and its rule', rendered?.quote !== null && rendered?.rule === 1);
check(
  'GitHub-flavoured, not plain CommonMark — a table and a strikethrough are GFM alone',
  rendered?.tableHeaders === 2 && rendered?.struck === 'Deprecated',
  JSON.stringify({ th: rendered?.tableHeaders, del: rendered?.struck }),
);
check(
  'and a fenced ts block is really syntax-coloured in the preview too',
  (rendered?.fenceColours.length ?? 0) >= 2,
  JSON.stringify(rendered?.fenceColours),
);
/**
 * Operator report, translated: "the font size in preview mode is small — use
 * the same font size as the Response view." Measured against the SAME
 * paragraph the font-size check below reads, in the same real Chromium page:
 * `getComputedStyle` is the only thing that reads what actually reached the
 * box, and a `text-[2em]` class that named no real rule (a typo in the
 * bracket, a stray character) would still read back from `h1.className` in a
 * unit test.
 */
check(
  'the body paragraph really is the Response view’s own size (13px by default), not GitHub’s fixed 16px',
  rendered?.paragraphFontSize === 13,
  `paragraph is ${rendered?.paragraphFontSize}px`,
);
check(
  'GitHub’s own size ladder: h1 is real paint at exactly 2em of that same root, not a class name',
  rendered?.h1FontSize !== null &&
    rendered?.paragraphFontSize !== null &&
    rendered?.h1FontSize === rendered?.paragraphFontSize * 2,
  `h1 is ${rendered?.h1FontSize}px, paragraph is ${rendered?.paragraphFontSize}px`,
);
check(
  'and h1/h2 carry a real bottom rule, which h3 does not',
  (rendered?.h1BorderBottom ?? 0) > 0 &&
    (rendered?.h2BorderBottom ?? 0) > 0 &&
    (rendered?.h3BorderBottom ?? 0) === 0,
  JSON.stringify({
    h1: rendered?.h1BorderBottom,
    h2: rendered?.h2BorderBottom,
    h3: rendered?.h3BorderBottom,
  }),
);
check(
  'a task list is a real, disabled checkbox — one unticked, one ticked',
  rendered?.checkboxCount === 2 &&
    rendered?.checkboxDisabled === true &&
    rendered?.checkedIsChecked === true,
  JSON.stringify({
    count: rendered?.checkboxCount,
    disabled: rendered?.checkboxDisabled,
    checked: rendered?.checkedIsChecked,
  }),
);
check(
  'a table cell really is bordered, not merely classed `border`',
  (rendered?.cellBorderWidth ?? 0) > 0,
  `the cell's own border-top-width is ${rendered?.cellBorderWidth}px`,
);
check(
  'raw HTML in the file reaches the DOM as characters and nothing else',
  rendered?.scripts === 0 && rendered?.showsScriptAsText === true && rendered?.pwned === null,
  JSON.stringify({
    scripts: rendered?.scripts,
    text: rendered?.showsScriptAsText,
    pwned: rendered?.pwned,
  }),
);
/**
 * AND THE CONSTRUCT THAT BITES HARDEST IN AN ELECTRON WINDOW.
 *
 * A markdown link is not raw HTML and `rehype-raw` has nothing to say about
 * it: react-markdown renders a real `<a href>` for one by default. In this
 * shell a click on a real anchor navigates THE WHOLE APP WINDOW away -- the
 * window IS the application, so there is no back button, no other tab, and
 * nothing on screen to say what happened. An `<img>` is the same shape one
 * step quieter: a remote fetch that tells whoever wrote the file that this
 * pane opened.
 *
 * `FILES_MARKDOWN`'s `a:` and `img:` overrides are what defuse both — its
 * OWN component map, not `OUT_MARKDOWN` restyled (`files-markdown.tsx`'s own
 * header carries the full argument for why the transcript and the Files
 * preview are two maps rather than one shared with a second set of type-scale
 * decisions). Dropping `components={FILES_MARKDOWN}` from the preview's own
 * `<Markdown>` would leave the unit suite green the same way it once did for
 * `OUT_MARKDOWN` — a feature check for `remarkGfm` sitting right beside the
 * safety property and covering none of it — which is why this check exists
 * here too, against the same map.
 *
 * BOTH DIRECTIONS, because half of this is the easy half: rendering NOTHING
 * would satisfy "no anchor, no image" and be a worse page than the bug.
 */
check(
  'a markdown link and image are defused — no anchor to navigate, no image to fetch',
  rendered?.anchors === 0 && rendered?.images === 0,
  JSON.stringify({ anchors: rendered?.anchors, images: rendered?.images }),
);
check(
  'and the reader still gets the words, the address and the alt text',
  rendered?.showsLinkWords === true &&
    rendered?.showsHref === true &&
    rendered?.showsAlt === true &&
    rendered?.showsRawSyntax === false,
  JSON.stringify({
    words: rendered?.showsLinkWords,
    href: rendered?.showsHref,
    alt: rendered?.showsAlt,
    rawSyntax: rendered?.showsRawSyntax,
  }),
);
/**
 * THE LINK IS READABLE AS A LINK AT REST, not only once a pointer happens to
 * be over it — GitHub's own convention, and the one thing an underline-only
 * hover state cannot do on its own. Measured as a real computed `color`
 * against a real paragraph's, in real Chromium: happy-dom applies no
 * stylesheet at all, so a unit test can tell `text-chip` was WRITTEN but not
 * that it PAINTED something a reader could tell apart from body text.
 */
check(
  'the link is painted in a colour distinct from the paragraph around it, at rest',
  rendered?.linkColor !== null &&
    rendered?.paragraphColor !== null &&
    rendered?.linkColor !== rendered?.paragraphColor,
  JSON.stringify({ link: rendered?.linkColor, paragraph: rendered?.paragraphColor }),
);
check(
  'and it still carries the external-link glyph — colour alone is a WCAG 1.4.1 failure',
  rendered?.linkHasGlyph === true,
);
check(
  'the raw editor is UNMOUNTED, so the tab has no insert stop while a document is being read',
  rendered?.editors === 0 && rendered?.insertStops === 0,
  JSON.stringify({ editors: rendered?.editors, stops: rendered?.insertStops }),
);
check('and the preview is reachable by Tab', rendered?.tabIndex === '0');
/**
 * THE IMAGE, DRAWN AS GITHUB DRAWS A DECLINED ONE — a bordered placeholder
 * carrying the alt text and the address, not bare alt text with nothing
 * around it. The refusal itself is unchanged (`images === 0` above); this is
 * the part of "GitHub-style" that does not cost the refusal anything.
 */
check(
  'the declined image is a real, bordered placeholder — not just alt text with nothing around it',
  (rendered?.imageBorderWidth ?? 0) > 0,
  `the placeholder's own border-top-width is ${rendered?.imageBorderWidth}px`,
);
check(
  'and it names the address it declined to fetch, GitHub-like',
  rendered?.imageShowsAddress === true,
);

await page.screenshot({ path: `${outDir}/files-md-preview.png` });
console.log(`${outDir}/files-md-preview.png`);

// ---------------------------------------------------------------------------
// 4.5 CODE BLOCKS, AUDITED AGAINST REAL MARKDOWN — operator report, translated:
// "the md preview has a bug with the code block style." No fence was
// reproduced, so this opens every shape a fence takes in real prose (see
// `CODE`'s own comment above) and measures the properties that would go quiet
// in a class-name grep: whether an unfamiliar infostring still gets the same
// card `Fence` draws for one it recognises rather than leaking `readFence`'s
// fallback unstyled, whether CommonMark's OTHER code-block syntax (4-space
// indent, no fence) reaches a `<pre>` at all rather than falling through to a
// paragraph, whether a fence nested inside a list item is still found, and
// whether a long line really scrolls sideways rather than wrapping or
// overflowing the pane — none of which a unit test can answer, because
// happy-dom applies no stylesheet and computes no scrollbar.

await treeRow('/work/demo/CODE.md').click();
await page.waitForSelector('[data-files-preview-view]', { timeout: 5_000 });

const code = await page.evaluate(() => {
  const view = document.querySelector('[data-files-preview-view]');
  const pageBg = getComputedStyle(document.body).backgroundColor;
  const pres = [...view.querySelectorAll('pre')].map((pre) => {
    const cs = getComputedStyle(pre);
    return {
      text: pre.textContent ?? '',
      overflowX: cs.overflowX,
      whiteSpace: cs.whiteSpace,
      background: cs.backgroundColor,
      scrollWidth: pre.scrollWidth,
      clientWidth: pre.clientWidth,
      colouredSpans: pre.querySelectorAll('code span').length,
      parentTag: pre.parentElement?.tagName ?? null,
    };
  });
  return { pageBg, pres, indented: view.textContent?.includes('indented block line one') };
});

check(
  'every shape of fenced or indented code in the fixture really became its own <pre>',
  code.pres.length === 8,
  `found ${code.pres.length} <pre> elements: ${JSON.stringify(code.pres.map((p) => p.text.slice(0, 24)))}`,
);

const noLang = code.pres.find((p) => p.text.includes('plain fenced text'));
const unknownLang = code.pres.find((p) => p.text.includes('graph TD'));
const knownLang = code.pres.find((p) => p.text.includes('echo hello'));
const indented = code.pres.find((p) => p.text.includes('indented block line one'));
const inList = code.pres.find((p) => p.text.includes('const nested'));
const longLine = code.pres.find((p) => p.text.includes('xxxxxxxxxx'));
const lookalikes = code.pres.find((p) => p.text.includes('not a heading'));
const tilde = code.pres.find((p) => p.text.includes('tilde fenced content'));

check(
  'CommonMark’s 4-space indented block reaches a real <pre>, not a paragraph',
  indented !== undefined,
  JSON.stringify(code.indented),
);
check(
  'a fence nested inside a list item is still found, inside its own <li>',
  inList !== undefined && inList.parentTag === 'LI' && inList.colouredSpans > 0,
  JSON.stringify(inList),
);
check(
  'an unfamiliar infostring still draws the SAME card — no info string and an unknown one both do',
  noLang !== undefined &&
    unknownLang !== undefined &&
    noLang.background === unknownLang.background &&
    noLang.background === (knownLang?.background ?? noLang.background),
  JSON.stringify({ noLang: noLang?.background, unknownLang: unknownLang?.background, knownLang: knownLang?.background }),
);
check(
  'a recognised language is still coloured inside this preview’s own <pre>, and an unrecognised one is not lying about it',
  (knownLang?.colouredSpans ?? 0) > 0 && (unknownLang?.colouredSpans ?? 0) === 0,
  JSON.stringify({ known: knownLang?.colouredSpans, unknown: unknownLang?.colouredSpans }),
);
check(
  'a `~~~` fence is drawn exactly as a ``` fence is',
  tilde !== undefined && tilde.background === noLang?.background,
  JSON.stringify(tilde),
);
check(
  'content that looks like a heading, a quote or a tab stays literal text inside the fence',
  lookalikes !== undefined && lookalikes.text.includes('# not a heading') && lookalikes.text.includes('> not a quote'),
  JSON.stringify(lookalikes?.text),
);
check(
  'a long line really overflows its own box, so it CAN scroll',
  (longLine?.scrollWidth ?? 0) > (longLine?.clientWidth ?? 0),
  JSON.stringify({ scrollWidth: longLine?.scrollWidth, clientWidth: longLine?.clientWidth }),
);
check(
  'and it is not wrapped to get there — overflow-x allows a scrollbar, white-space is `pre`',
  longLine?.overflowX !== 'visible' && longLine?.whiteSpace === 'pre',
  JSON.stringify({ overflowX: longLine?.overflowX, whiteSpace: longLine?.whiteSpace }),
);
check(
  'and the pane itself never grew to fit it — the OUTER preview region stayed put',
  (await page.evaluate(() => {
    const v = document.querySelector('[data-files-preview-view]');
    return v ? v.scrollWidth - v.clientWidth : null;
  })) <= 4,
);
check(
  'every fenced block reads as a distinct surface from the page behind it',
  code.pres.every((p) => p.background !== code.pageBg),
  JSON.stringify({ pageBg: code.pageBg, blocks: [...new Set(code.pres.map((p) => p.background))] }),
);

// Back to README.md, in preview, so sections 5 onward see the file they were
// written against.
await treeRow('/work/demo/README.md').click();
await page.waitForSelector('[data-files-preview-view]', { timeout: 5_000 });
await page.waitForFunction(
  () => document.querySelector('[data-files-preview-view] h1')?.textContent === 'Atlas',
  null,
  { timeout: 5_000 },
);

// ---------------------------------------------------------------------------
// 5. THE PREVIEW IS NOT AN INSERT SCOPE — the mode chip, not a class name.
//
// `keyboard/focus-scope.ts` derives the cursor mode from
// `document.activeElement`'s own ancestry, live, in a real DOM, and the status
// chip is the app's own report of it. A preview that accidentally sat inside
// an insert scope would put the whole app into Insert with nothing to type in.

await page.locator('[data-files-preview-view]').focus();
await page.waitForFunction(
  () => document.activeElement?.hasAttribute('data-files-preview-view') ?? false,
  null,
  { timeout: 3_000 },
);
const modeInPreview = await page.evaluate(
  () => document.querySelector('[data-mode]')?.textContent ?? '',
);
check(
  'the mode chip reads Select with the keyboard in the preview — it is not an insert scope',
  modeInPreview === 'Select',
  `it reads ${modeInPreview}`,
);

// ---------------------------------------------------------------------------
// 6. `Mod-Shift-m`, BOTH WAYS, THROUGH A REAL KEYBOARD.
//
// SPELLED `Meta+`, NOT `Control+`, AND THAT IS NOT A MACOS DETAIL. Since Ctrl
// stopped spelling `Mod-` on macOS, Control here resolves to nothing on this
// machine while still resolving on the ubuntu runner -- a guard that goes on
// passing in CI for a toggle no operator can reach. `Meta` is the one spelling
// that means `Mod-` on EVERY branch of `normalizeKey`: on macOS it is the only
// one, and off macOS Super is accepted beside Ctrl.
//
// Both legs, because a half-wired toggle ships green when only one is checked:
// the button and the editor's own branch would cover the way IN, and nothing
// would notice that the preview could not be left without a mouse.

await page.keyboard.press('Meta+Shift+KeyM');
await page.waitForSelector('[data-files-editor]', { timeout: 3_000 });
check(
  'Mod-Shift-m in the preview goes back to the raw text',
  (await page.locator('[data-files-preview-view]').count()) === 0,
);
check(
  'and it puts the keyboard in the editor it just drew',
  await page.evaluate(() => document.activeElement?.matches('[data-files-editor]') ?? false),
);

// THE EDIT THAT MUST SURVIVE THE ROUND TRIP. Typed into a real textarea,
// carried through a real toggle, and read back out of the DOM.
const editor = page.locator('[data-files-editor]');
await editor.click();
await editor.fill('# edited, never saved\n\n- still here\n');
await page.keyboard.press('Meta+Shift+KeyM');
await page.waitForSelector('[data-files-preview-view]', { timeout: 3_000 });
check(
  'Mod-Shift-m in the editor renders the UNSAVED buffer, not what the bridge last read',
  (await page.evaluate(
    () => document.querySelector('[data-files-preview-view] h1')?.textContent ?? null,
  )) === 'edited, never saved',
);
check(
  'and the dirty mark is still on screen in the rendered view',
  (await page.locator('[data-files-dirty]').count()) > 0,
);
await page.keyboard.press('Meta+Shift+KeyM');
await page.waitForSelector('[data-files-editor]', { timeout: 3_000 });
check(
  'and coming back the text is exactly as it was left',
  (await editor.inputValue()) === '# edited, never saved\n\n- still here\n',
  JSON.stringify(await editor.inputValue()),
);

// A FILE WITH NO PREVIEW WITHDRAWS THE CONTROL AND SAYS SO TO THE KEY.
await treeRow('/work/demo/.env').click();
await page.waitForFunction(
  () => (document.querySelector('[data-files-editor]')?.value ?? '').includes('PORT'),
  null,
  { timeout: 3_000 },
);
check(
  'a .env draws no preview toggle at all',
  (await page.locator('[data-files-preview]').count()) === 0,
);
await page.locator('[data-files-editor]').click();
await page.keyboard.press('Meta+Shift+KeyM');
const refusal = (await page.locator('[data-files-note]').textContent()) ?? '';
check(
  'and pressing the key there says so rather than doing nothing',
  refusal.includes('markdown'),
  JSON.stringify(refusal),
);

// ---------------------------------------------------------------------------
// 7. WHAT IS LEFT FOR A NAME, AT THE NARROWEST LEGAL PANE.
//
// This is the cost of the change rather than its benefit, and it is measured
// where it is largest. `prefs/panes.ts` floors the detail pane at 320px, so a
// 520px window is exactly vam's narrowest legal two-column layout, and
// `TREE_WIDTH`'s own floor is what the tree gets there. Every pixel the glyph
// takes comes off the name beside it — and a glyph that fitted the column
// while squeezing every name down to an ellipsis would pass every other check
// in this file and in the unit suite, because none of them measures the NAME.

await page.setViewportSize({ width: 520, height: 760 });
await page.waitForTimeout(250);
const narrow = await page.evaluate(() => {
  const row = document.querySelector('[data-files-row-path="/work/demo/README.md"]');
  const name = row?.querySelector('[data-files-row-name]') ?? null;
  const icon = row?.querySelector('[data-file-icon]') ?? null;
  const tree = document.querySelector('[data-files-tree]');
  const pane = document.querySelector('[data-action-pane]');
  const r = (el) => {
    if (el === null || el === undefined) return null;
    const b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width) };
  };
  return { name: r(name), icon: r(icon), tree: r(tree), pane: r(pane) };
});
check(
  'the pane really is at its 320px floor — otherwise this section proves nothing',
  narrow.pane !== null && Math.abs(narrow.pane.width - 320) <= 2,
  `the pane is ${narrow.pane?.width}px wide`,
);
check(
  'the glyph really is drawn at that width, and before the name',
  narrow.icon !== null && narrow.name !== null && narrow.icon.right <= narrow.name.left,
  JSON.stringify(narrow),
);
/**
 * 72px IS NOT AN ARBITRARY FLOOR. The tree's own `min-w-[7.5rem]` is 120px,
 * and the row spends a border, `p-1`, 6px of depth indent, the 12px glyph, two
 * 4px gaps and `pr-1` before the name gets anything — about 40px. So the name
 * has ~80px here, which at the 11px monospace face this row uses is around
 * twelve characters: `.env.example` whole, `README.md` with room to spare. A
 * floor of 72 leaves a little slack for font fallback and still fails loudly
 * if a second glyph, a badge or a wider gap is ever added in front of it.
 */
check(
  'and the name still has a readable share of the row at vam’s narrowest pane',
  narrow.name !== null && narrow.name.width >= 72,
  `the name box is ${narrow.name?.width}px wide in a ${narrow.tree?.width}px tree`,
);

/**
 * THE HEADER ROW'S OWN CONTROLS, AT THE SAME 320px FLOOR — the cost of the
 * WIDER, two-segment control with text labels, which the icon-only button it
 * replaced never had to pay. Measured as rectangles inside the action pane's
 * own box, exactly as section 3 measures them at 1100px: a control that
 * wrapped onto a second line or spilled past the pane's right edge would
 * still pass a click-based check (Playwright clicks the centre) and would
 * still show every label's `textContent`, which is why this asserts geometry
 * rather than presence.
 */
await treeRow('/work/demo/README.md').click();
await page.waitForFunction(
  () => document.querySelector('[data-files-preview]') !== null,
  null,
  { timeout: 3_000 },
).catch(() => {});
const narrowHeader = await page.evaluate(() => {
  const r = (sel) => {
    const e = document.querySelector(sel);
    if (e === null) return null;
    const b = e.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top) };
  };
  return {
    pane: r('[data-action-pane]'),
    overlay: r('[data-view-overlay]'),
    preview: r('[data-files-preview]'),
    format: r('[data-files-format]'),
    save: r('[data-files-save]'),
    path: r('[data-files-path]'),
  };
});
check(
  'the segmented control still fits inside the pane at the 320px floor, not clipped or wrapped',
  narrowHeader.pane !== null &&
    narrowHeader.preview !== null &&
    narrowHeader.format !== null &&
    narrowHeader.save !== null &&
    narrowHeader.preview.right <= narrowHeader.pane.right &&
    narrowHeader.format.right <= narrowHeader.pane.right &&
    narrowHeader.save.right <= narrowHeader.pane.right &&
    // Not wrapped onto a second line — a loose tolerance, not exact equality:
    // the segmented control's own button is a few px shorter than Format's
    // (tighter padding at this width), so `items-center` lands their tops a
    // couple of pixels apart even sitting on the very same row.
    Math.abs(narrowHeader.preview.top - narrowHeader.format.top) <= 6,
  JSON.stringify(narrowHeader),
);
check(
  'and none of the three controls sits under the floating view-icon pill',
  narrowHeader.overlay !== null &&
    [narrowHeader.preview, narrowHeader.format, narrowHeader.save].every(
      (b) => b !== null && b.right <= narrowHeader.overlay.left,
    ),
  JSON.stringify(narrowHeader),
);
check(
  'and the path label still has SOME room to its left — the wider control has not eaten it whole',
  narrowHeader.path !== null && narrowHeader.preview !== null && narrowHeader.path.right > 0,
  JSON.stringify(narrowHeader),
);

await page.screenshot({ path: `${outDir}/files-md-narrow.png` });
console.log(`${outDir}/files-md-narrow.png`);

await page.setViewportSize({ width: 1100, height: 800 });
await page.waitForTimeout(200);

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nfiles-markdown: every check passed.');
