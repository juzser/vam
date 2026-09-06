/**
 * Ties what the main process READS at runtime to what electron-builder PACKS.
 *
 * `src/main/index.ts` resolves the page a paired phone loads as
 * `join(app.getAppPath(), 'dist-web')`. In a packaged build `getAppPath()` is
 * the asar, so that directory only exists if a glob in the builder's `files`
 * put it there. It did not: `files` listed `out` and `package.json` only, and
 * `dist-web` is produced by a SEPARATE script that the packaging step never
 * ran. Nothing failed loudly -- `serveAsset` opens files and does not invent
 * them, so every remote request in a packaged build answered 404 while the
 * desktop half worked perfectly. Pairing looked shipped and was not.
 *
 * The regression is silent by construction, and no test that mounts a
 * component or boots the dev server can see it, because both read from the
 * source tree where `dist-web` is simply present. The only place the two
 * facts meet is here: the resolved directory names on one side, the packing
 * globs on the other.
 *
 * This asserts the SOURCE TEXT of both files, which is the claim itself
 * rather than a proxy for it -- renaming the directory on either side breaks
 * this test, which is the whole point.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const MAIN_SRC = fileURLToPath(new URL('../../src/main/index.ts', import.meta.url));
const CONFIG = fileURLToPath(new URL('../../electron-builder.config.cjs', import.meta.url));
const PKG = fileURLToPath(new URL('../../package.json', import.meta.url));

/** Every `join(app.getAppPath(), '<dir>')` the main process resolves. */
function appPathDirs(): string[] {
  const source = readFileSync(MAIN_SRC, 'utf8');
  const found = new Set<string>();
  const pattern = /getAppPath\(\)\s*,\s*'([^']+)'/g;
  for (const match of source.matchAll(pattern)) {
    const dir = match[1];
    if (dir !== undefined) found.add(dir.split('/')[0] as string);
  }
  return [...found];
}

type BuilderConfig = { readonly files: readonly string[] };

function packedRoots(): string[] {
  const config = require(CONFIG) as BuilderConfig;
  return config.files.map((glob) => (glob.split('/')[0] as string).replace(/\*+$/, ''));
}

describe('packaged files cover what the main process resolves', () => {
  it('finds the directories main resolves against the app path', () => {
    // A sweep that examined nothing passes vacuously. This asserts the corpus
    // exists before anything is concluded from it.
    expect(appPathDirs().length).toBeGreaterThan(0);
  });

  it('packs every directory the main process resolves against the app path', () => {
    const packed = packedRoots();
    for (const dir of appPathDirs()) {
      expect(packed, `main resolves ${dir}/ at runtime, so it must be packed`).toContain(dir);
    }
  });

  it('packs the entry point declared in package.json', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as { readonly main: string };
    const entryRoot = pkg.main.split('/')[0] as string;
    expect(packedRoots()).toContain(entryRoot);
  });
});

/**
 * The config file above is only worth anything if the build actually reads it.
 *
 * electron-builder does NOT auto-discover `electron-builder.config.cjs`.
 * Invoked bare it silently falls back to its own defaults, and the difference
 * is not subtle: a build without the config packed `src/`, `test/`, `e2e/`,
 * `docs/` and every tsconfig into the shipped asar -- the whole repository,
 * handed to every user -- put its output in `dist/` instead of `dist-app/`,
 * and searched the build machine's keychain for a signing identity instead of
 * honouring `identity: null`. Measured, not theorised.
 *
 * The tests above read the config FILE, so they pass whether or not the build
 * ever loads it. That is the gap this closes: it asserts the packaging command
 * names the config explicitly, which is the only thing that makes the rest of
 * this file mean anything about a real artifact.
 */
describe('the packaging command actually loads the config', () => {
  it('passes the config file to electron-builder explicitly', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    const dist = pkg.scripts.dist;
    expect(dist, 'a `dist` script is what produces a downloadable build').toBeDefined();
    expect(dist).toContain('electron-builder');
    // The filename, not merely `--config`: pointing the flag at the wrong file
    // is the same failure with a longer command line.
    expect(dist, 'electron-builder does not auto-discover this file').toContain(
      '--config electron-builder.config.cjs',
    );
  });
});
