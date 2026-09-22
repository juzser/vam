import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Guards the actual regression this repo shipped: `electron-vite build`
 * defaults `minify` to `false` for every target, and nothing in
 * `electron.vite.config.ts` used to override it -- so `build:app`, the
 * pipeline that produces what ships, emitted 2,276,000 bytes of unminified,
 * fully-commented renderer JavaScript that had to be parsed before the
 * canvas could draw a single node.
 *
 * This MUST build through `electron-vite`, not plain `vite`. `vite build`
 * (the `build:web` pipeline, `vite.web.config.ts`) already defaults `minify`
 * to `true` and was never affected by this defect -- a guard that spawns
 * `vite build` instead would stay green straight through a revert of
 * `minify: true` in `electron.vite.config.ts`, because it would be
 * measuring a pipeline the regression never touched.
 *
 * Measured, `electron-vite build`, same code and chunks both times:
 *
 *     minify: false (the shipped defect)  entry  2,276,000 B
 *     minify: true  (this fix)            entry    831,637 B
 *
 * `ENTRY_BUDGET_BYTES` sits at 1,000,000 -- about 20% above the current
 * entry, enough headroom to absorb an ordinary dependency patch bump without
 * this test flapping, but still well under half of what an unminified build
 * produces, so a reverted `minify: true` fails this test outright rather
 * than slipping through on a threshold picked too tight to be useful.
 *
 * A SECOND REGRESSION THIS FILE NOW ALSO GUARDS: `DetailPanel.tsx`'s
 * transcript and `FilesTab.tsx`'s `.md` preview both statically imported
 * `react-markdown` + `remark-gfm` at their one call site each, and both
 * modules are reachable from the entry the moment the canvas has a single
 * pane -- so the whole markdown stack (react-markdown, remark-gfm and the
 * mdast/micromark/unist/hast/vfile graph underneath) sat in the eager
 * entry whether or not a transcript, or a `.md` file, was ever opened.
 * `LazyMarkdown.tsx` moves the one shared `<Markdown>` call behind a
 * `React.lazy` + `Suspense` boundary; the fallback is the answer's own raw
 * text, so the one render that can see it is still readable.
 *
 * Measured, `electron-vite build`, same code and chunks both times:
 *
 *     entry, markdown stack static (before this split)  716,706 + 153,981 B  =  870,687 B total, all eager
 *     entry, markdown stack lazy   (this fix)            716,706 B eager  +  153,981 B in `LazyMarkdown-*.js`, fetched on first render
 *     entry gzip, before  262,428 B
 *     entry gzip, after   217,432 B
 *
 * A THIRD REGRESSION THIS FILE NOW ALSO GUARDS: `SettingsOverlay` and
 * `FilesTab` both sat in the eager entry too, for the same reason the
 * markdown stack did -- a static import at the one call site each,
 * reachable from the entry the moment the canvas has a single pane.
 * `Canvas.tsx` now imports `SettingsOverlay` behind a `React.lazy` +
 * `Suspense` boundary (fallback `null`: it is a window overlay, drawn only
 * once `settingsOpen` is true, over everything and reflowing nothing beside
 * it); `DetailPanel.tsx` does the same for `FilesTab` (`LazyFilesTab`,
 * fallback `null`: its own `hidden` prop already paints nothing whenever
 * the Files tab is not the open one, which is the common case, so the
 * fallback is indistinguishable from the resolved-but-hidden component
 * there). `FilesTab.tsx` is 2,700+ lines and drags `files-highlight.ts` and
 * the hand-rolled tokenizer `highlight.ts` in behind it; `SettingsOverlay`
 * carries every settings section, including the icons and controls only it
 * uses.
 *
 * Measured, `electron-vite build`, same code and chunks both times:
 *
 *     entry, before this split   719,146 B  (218,206 B gzip)
 *     entry, after this split    624,969 B  (191,941 B gzip)
 *
 * a ~94 KB / ~13% drop in the eagerly-parsed script, ~26 KB / ~12% gzipped
 * -- `SettingsOverlay-*.js` and `FilesTab-*.js` now carry that weight as
 * their own chunks, fetched on first open rather than parsed before the
 * canvas draws anything.
 *
 * `ENTRY_BUDGET_BYTES` (690,000) and `ENTRY_GZIP_BUDGET_BYTES` (212,000)
 * both sit ~10% above THESE "after" figures, the same headroom policy the
 * markdown split above already established -- enough to absorb an ordinary
 * dependency bump without flapping, but a reverted lazy split on either
 * component puts its chunk straight back into the entry and fails both
 * budgets outright.
 *
 * The entry chunk is found by parsing the renderer's own emitted
 * `index.html` for its `<script type="module">` tag -- the same thing a
 * browser reads to decide what loads eagerly -- rather than a hardcoded
 * filename or a list of module names, a rule this repo has already shipped
 * once that was proven to be TYPED without ever being proven to MATCH.
 * `electron-vite`'s CLI has no `--manifest` flag (unlike plain `vite build`),
 * so the manifest approach the web-pipeline guard used is not available
 * here; the HTML is the real, unassailable substitute.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const electronViteBinary = path.join(repoRoot, 'node_modules', '.bin', 'electron-vite');
const configPath = path.join(repoRoot, 'electron.vite.config.ts');
// The same existence-only gate `test/e2e/config-collection.test.ts` uses for
// its harness: a cheap, synchronous check for whether the tool this test
// depends on is even present, decided BEFORE anything tries to build.
const buildAvailable = existsSync(electronViteBinary) && existsSync(configPath);

const ENTRY_BUDGET_BYTES = 690_000;
const ENTRY_GZIP_BUDGET_BYTES = 212_000;

// The one string this repo's markdown stack ships that nothing else in the
// dependency graph or vam's own source does: `gfmTable`, the extension name
// `micromark-extension-gfm-table` registers itself under (verified: `grep -rn
// gfmTable src` and `grep -rl gfmTable node_modules` both point only at that
// package). remark-gfm pulls it in transitively, and remark-gfm only ever
// ships together with react-markdown at vam's two call sites
// (`DetailPanel.tsx`'s transcript and `FilesTab.tsx`'s `.md` preview) --
// so this string is a stand-in for "the markdown stack", immune to
// minification renaming a function or a variable the way a symbol-name
// grep would not be.
const MARKDOWN_STACK_MARKER = 'gfmTable';

// `SettingsOverlay`'s own root DOM attribute -- a bare JSX attribute name
// survives minification verbatim (it has to keep matching the real DOM
// attribute), and this one is written nowhere else (verified: `grep -rn
// data-settings-overlay src` outside `SettingsOverlay.tsx` finds nothing,
// and `grep -rl data-settings-overlay node_modules` finds nothing).
const SETTINGS_OVERLAY_MARKER = 'data-settings-overlay';

// The editor's own attribute, ONE LEVEL IN from `FilesTab`'s bare
// `data-files` root: that shorter string is also a PREFIX several sibling
// attributes share (`data-files-row`, `data-files-tree-resize`, …), so a
// substring match on it inside ~700 KB of minified JS risks matching one of
// those instead of proving the component itself shipped. `data-files-editor`
// is exact. Verified unique the same way as the two markers above: `grep -rn
// data-files-editor src` outside `FilesTab.tsx` finds nothing, and
// `grep -rl data-files-editor node_modules` finds nothing.
const FILES_TAB_MARKER = 'data-files-editor';

describe.skipIf(!buildAvailable)('electron renderer entry chunk budget', () => {
  let outDir: string;
  let entryBytes: number;
  let entryText: string;
  let otherAssetTexts: string[];

  beforeAll(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'vam-bundle-budget-'));
    const result = spawnSync(
      electronViteBinary,
      [
        'build',
        '--config',
        configPath,
        '--outDir',
        outDir,
        '--mode',
        'production',
        '--logLevel',
        'silent',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 60_000,
        // Vitest runs this file with `NODE_ENV=test`, which a spawned
        // child inherits by default. Vite/React key their production
        // codepath off exactly that variable, not off `--mode`, so an
        // inherited `test` here builds React's development bundle --
        // bigger, unminified-shaped, and not what `build:app` (or the
        // epic's own baseline) ever ships.
        env: { ...process.env, NODE_ENV: 'production' },
      },
    );
    // `result.error` (spawn itself failed) is checked before `status`: on a
    // killed or unspawnable child `status` is `null`, ambiguous with a
    // clean-but-signalled exit.
    if (result.error) {
      throw new Error(`electron-vite build failed to spawn: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(
        `electron-vite build exited ${String(result.status)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }

    const htmlPath = path.join(outDir, 'renderer', 'index.html');
    const html = readFileSync(htmlPath, 'utf-8');
    // Exactly what a browser (or Electron's renderer) parses to decide
    // what loads before anything else: the module script(s) in the HTML.
    // A dynamically-imported chunk is never referenced here -- that is
    // the whole point of a lazy boundary -- so this is genuinely "the
    // eager set", not an assumption about which file is named what.
    const scriptSrcs = [...html.matchAll(/<script[^>]*\stype="module"[^>]*\ssrc="([^"]+)"/g)].map(
      (m) => m[1],
    );

    // If the renderer stopped emitting exactly one eager entry script, that
    // is a bigger fact than a byte count and deserves its own clear failure
    // rather than a confusing assertion on `scriptSrcs[0]`.
    expect(scriptSrcs).toHaveLength(1);

    const entrySrc = scriptSrcs[0];
    if (entrySrc === undefined) {
      throw new Error('unreachable: length asserted above');
    }
    const entryPath = path.join(outDir, 'renderer', entrySrc);
    entryBytes = statSync(entryPath).size;
    entryText = readFileSync(entryPath, 'utf-8');

    const assetsDir = path.join(outDir, 'renderer', 'assets');
    otherAssetTexts = readdirSync(assetsDir)
      .filter((name) => name.endsWith('.js') && name !== path.basename(entrySrc))
      .map((name) => readFileSync(path.join(assetsDir, name), 'utf-8'));
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it(`the eagerly-loaded entry chunk stays under ${ENTRY_BUDGET_BYTES} bytes`, () => {
    expect(entryBytes).toBeLessThan(ENTRY_BUDGET_BYTES);
  });

  it(`the eagerly-loaded entry chunk stays under ${ENTRY_GZIP_BUDGET_BYTES} gzip bytes`, () => {
    const entryGzipBytes = gzipSync(entryText).length;
    expect(entryGzipBytes).toBeLessThan(ENTRY_GZIP_BUDGET_BYTES);
  });

  it('the markdown stack (react-markdown + remark-gfm) is not in the eager entry chunk', () => {
    // A boolean assertion, not `expect(entryText).not.toContain(...)`: the
    // entry is ~800 KB of minified JS on one line, and a failed `toContain`
    // has Vitest diff the whole string against the needle -- megabytes of
    // output for one missing substring. Falsify by statically importing
    // `out-markdown.tsx` or `files-markdown.tsx` from `DetailPanel.tsx` /
    // `FilesTab.tsx` again instead of through the lazy `LazyMarkdown`
    // boundary -- this line goes red:
    //   expect(entryText.includes('gfmTable')).toBe(false)
    //   AssertionError: expected true to be false
    expect(entryText.includes(MARKDOWN_STACK_MARKER)).toBe(false);
  });

  it('the markdown stack still ships, in a lazy chunk', () => {
    // Guards against the test above passing for the wrong reason -- the
    // marker disappearing because the code was deleted or tree-shaken away
    // entirely, not because it moved to a lazy boundary.
    expect(otherAssetTexts.some((text) => text.includes(MARKDOWN_STACK_MARKER))).toBe(true);
  });

  it('SettingsOverlay is not in the eager entry chunk', () => {
    // Falsify by making `Canvas.tsx` import `SettingsOverlay` from
    // `../settings/SettingsOverlay.js` directly again instead of through
    // its own `lazy(() => import(...))` -- this line goes red:
    //   expect(entryText.includes('data-settings-overlay')).toBe(false)
    //   AssertionError: expected true to be false
    expect(entryText.includes(SETTINGS_OVERLAY_MARKER)).toBe(false);
  });

  it('SettingsOverlay still ships, in a lazy chunk', () => {
    expect(otherAssetTexts.some((text) => text.includes(SETTINGS_OVERLAY_MARKER))).toBe(true);
  });

  it('FilesTab is not in the eager entry chunk', () => {
    // Falsify by making `DetailPanel.tsx` import `FilesTab` from
    // `./FilesTab.js` directly again instead of through `LazyFilesTab`'s
    // `lazy(() => import(...).then(...))` -- this line goes red:
    //   expect(entryText.includes('data-files-editor')).toBe(false)
    //   AssertionError: expected true to be false
    expect(entryText.includes(FILES_TAB_MARKER)).toBe(false);
  });

  it('FilesTab still ships, in a lazy chunk', () => {
    expect(otherAssetTexts.some((text) => text.includes(FILES_TAB_MARKER))).toBe(true);
  });
});

if (!buildAvailable) {
  // `describe.skipIf` reports the block as skipped without a reason string
  // in the default reporter output; this makes the "why" visible in the
  // same run rather than only in this file's own header comment.
  describe('electron renderer entry chunk budget', () => {
    it.skip('node_modules/.bin/electron-vite or electron.vite.config.ts is missing -- see file header', () => {});
  });
}
