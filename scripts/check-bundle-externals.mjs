/**
 * Refuses to package a build whose main or preload bundle needs `node_modules`.
 *
 * `electron-builder.config.cjs` excludes `node_modules` from the asar, which
 * takes it from 69 MB to 2.4 MB. That is only sound while electron-vite really
 * does bundle everything: the moment a main-process import is externalised
 * instead of inlined, the packaged app throws MODULE_NOT_FOUND on a code path
 * that `pnpm run dev:app` never exercises, because in dev the whole repo is on
 * disk. The failure would land in a released binary, not in CI.
 *
 * So this runs between the build and the packaging step, over the emitted
 * bundles rather than over the source, and fails loudly. `electron` is
 * supplied by the runtime; `node:` builtins need nothing shipped. Anything
 * else must either be bundled or the exclusion has to go.
 */

import { readFileSync, existsSync } from 'node:fs';

const BUNDLES = ['out/main/index.cjs', 'out/preload/index.cjs'];
const REQUIRE = /require\("([^"]+)"\)/g;

let checked = 0;
const offenders = [];

for (const bundle of BUNDLES) {
  if (!existsSync(bundle)) {
    console.error(`missing bundle: ${bundle} -- build before packaging`);
    process.exit(1);
  }
  const source = readFileSync(bundle, 'utf8');
  const names = [...source.matchAll(REQUIRE)].map((m) => m[1]);
  // A bundle with no requires at all means the pattern stopped matching what
  // the bundler emits -- a silent pass, not a clean result.
  if (names.length === 0) {
    console.error(`no require() found in ${bundle} -- this check has gone blind`);
    process.exit(1);
  }
  for (const name of names) {
    checked += 1;
    if (name !== 'electron' && !name.startsWith('node:')) {
      offenders.push(`${bundle}: require("${name}")`);
    }
  }
}

if (offenders.length > 0) {
  console.error('These bundles need packages that the asar does not ship:\n');
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    '\nEither let electron-vite bundle it, or drop the node_modules exclusion' +
      ' in electron-builder.config.cjs. Shipping as-is throws at runtime.',
  );
  process.exit(1);
}

console.log(`bundle externals ok -- ${checked} require(s), all electron or node: builtins`);
