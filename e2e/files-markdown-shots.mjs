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
   * and a line of raw HTML that must reach the DOM as characters.
   */
  const README = [
    '# Atlas',
    '',
    'A **service** with a [runbook](https://example.test) and `one` inline span.',
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
    '<script>globalThis.__pwned = 1</script>',
    '',
  ].join('\n');

  const files = new Map([
    ['/work/demo/README.md', { content: README, rev: 0 }],
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
// 2. THE RAW VIEW: markdown's line structure, painted.

await treeRow('/work/demo/README.md').click();
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

// ---------------------------------------------------------------------------
// 4. THE RENDERED DOCUMENT.

await page.locator('[data-files-preview]').click();
await page.waitForSelector('[data-files-preview-view]', { timeout: 5_000 });

const rendered = await page.evaluate(() => {
  const view = document.querySelector('[data-files-preview-view]');
  if (view === null) return null;
  const fence = view.querySelector('pre');
  const colours = new Set(
    [...(fence?.querySelectorAll('span') ?? [])].map((s) => getComputedStyle(s).color),
  );
  return {
    h1: view.querySelector('h1')?.textContent ?? null,
    h2: view.querySelector('h2')?.textContent ?? null,
    items: view.querySelectorAll('li').length,
    quote: view.querySelector('blockquote')?.textContent ?? null,
    rule: view.querySelectorAll('hr').length,
    tableHeaders: view.querySelectorAll('th').length,
    struck: view.querySelector('del')?.textContent ?? null,
    fenceColours: [...colours],
    // The wall: raw HTML in the file must reach the DOM as CHARACTERS.
    scripts: view.querySelectorAll('script').length,
    images: view.querySelectorAll('img').length,
    showsScriptAsText: (view.textContent ?? '').includes('<script>'),
    pwned: globalThis.__pwned ?? null,
    // And the raw editor is GONE, not hidden — a hidden textarea would still
    // be this tab's first `data-insert-stop` in document order.
    editors: document.querySelectorAll('[data-files-editor]').length,
    insertStops: document.querySelectorAll('[data-files] [data-insert-stop]').length,
    tabIndex: view.getAttribute('tabindex'),
  };
});

check('the preview renders the document', rendered?.h1 === 'Atlas', JSON.stringify(rendered?.h1));
check('with its sub-headings', rendered?.h2 === 'Getting started', JSON.stringify(rendered?.h2));
check('its list', rendered?.items === 3, `it has ${rendered?.items} items`);
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
check(
  'raw HTML in the file reaches the DOM as characters and nothing else',
  rendered?.scripts === 0 &&
    rendered?.images === 0 &&
    rendered?.showsScriptAsText === true &&
    rendered?.pwned === null,
  JSON.stringify({
    scripts: rendered?.scripts,
    images: rendered?.images,
    text: rendered?.showsScriptAsText,
    pwned: rendered?.pwned,
  }),
);
check(
  'the raw editor is UNMOUNTED, so the tab has no insert stop while a document is being read',
  rendered?.editors === 0 && rendered?.insertStops === 0,
  JSON.stringify({ editors: rendered?.editors, stops: rendered?.insertStops }),
);
check('and the preview is reachable by Tab', rendered?.tabIndex === '0');

await page.screenshot({ path: `${outDir}/files-md-preview.png` });
console.log(`${outDir}/files-md-preview.png`);

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
// Both legs, because a half-wired toggle ships green when only one is checked:
// the button and the editor's own branch would cover the way IN, and nothing
// would notice that the preview could not be left without a mouse.

await page.keyboard.press('Control+Shift+KeyM');
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
await page.keyboard.press('Control+Shift+KeyM');
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
await page.keyboard.press('Control+Shift+KeyM');
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
await page.keyboard.press('Control+Shift+KeyM');
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
