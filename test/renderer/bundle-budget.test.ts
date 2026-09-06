import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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

const ENTRY_BUDGET_BYTES = 1_000_000;

describe.skipIf(!buildAvailable)('electron renderer entry chunk budget', () => {
  it(`the eagerly-loaded entry chunk stays under ${ENTRY_BUDGET_BYTES} bytes`, () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'vam-bundle-budget-'));
    try {
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

      // If the renderer stopped emitting exactly one eager entry script,
      // that is a bigger fact than a byte count and deserves its own clear
      // failure rather than a confusing assertion on `scriptSrcs[0]`.
      expect(scriptSrcs).toHaveLength(1);

      const entrySrc = scriptSrcs[0];
      if (entrySrc === undefined) {
        throw new Error('unreachable: length asserted above');
      }
      const entryPath = path.join(outDir, 'renderer', entrySrc);
      const entryBytes = statSync(entryPath).size;
      expect(entryBytes).toBeLessThan(ENTRY_BUDGET_BYTES);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
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
