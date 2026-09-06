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
