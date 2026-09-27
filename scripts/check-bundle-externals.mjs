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
 *
 * EVERY `.cjs` UNDER `out/main` AND `out/preload`, DISCOVERED RATHER THAN
 * NAMED. This used to be a fixed two-item list (`index.cjs`, `index.cjs`),
 * which held for as long as main had exactly one entry point. The Stats
 * scan's worker thread (`electron.vite.config.ts`'s `statsWorker` input)
 * added a second, and Rollup responded exactly as it does for any two
 * entries that import a shared module: it split that module into its OWN
 * chunk (`concurrency-limit.cjs`) and had both entries `require()` it by a
 * RELATIVE path. A fixed list would never have looked at that file at all --
 * the same "gone blind" failure mode the empty-`names` check below already
 * guards, one layer up. `readdirSync` is what makes a THIRD chunk (or a
 * fourth, the next time two entries share code) covered without anyone
 * remembering to add its name here.
 *
 * A RELATIVE require (`./concurrency-limit.cjs`) IS NOT AN OFFENDER. It is
 * vam's own other chunk, shipped in the same directory either way -- the
 * defect this script exists to catch is a require that reaches OUTSIDE the
 * emitted bundles, into `node_modules` the asar does not carry. So a
 * relative path is allowed, but only when the file it names actually exists
 * beside the one requiring it: a relative require to a chunk that is NOT on
 * disk is exactly as broken as one to a missing npm package, and silently
 * waving it through would be a second way for this check to go blind.
 *
 * THE "gone blind" FLOOR IS NOW PER RUN, NOT PER FILE. `concurrency-limit
 * .cjs` -- that same shared chunk -- imports nothing at all (it is one pure
 * function), so it legitimately has zero `require()` calls; failing on that
 * would make the safety net itself the reason a green build cannot ship. What
 * still has to be true is that SOME bundle in this run matched the pattern at
 * all, which is what would actually go silent if `electron-vite` ever changed
 * how it emits a `require`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DIRS = ['out/main', 'out/preload'];
const REQUIRE = /require\("([^"]+)"\)/g;

const bundles = DIRS.flatMap((dir) => {
  if (!existsSync(dir)) {
    console.error(`missing directory: ${dir} -- build before packaging`);
    process.exit(1);
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.cjs'))
    .map((name) => join(dir, name));
});

if (bundles.length === 0) {
  console.error('no .cjs bundle found under out/main or out/preload -- this check has gone blind');
  process.exit(1);
}

let checked = 0;
const offenders = [];

for (const bundle of bundles) {
  const source = readFileSync(bundle, 'utf8');
  const names = [...source.matchAll(REQUIRE)].map((m) => m[1]);
  for (const name of names) {
    checked += 1;
    if (name === 'electron' || name.startsWith('node:')) continue;
    if (name.startsWith('./') || name.startsWith('../')) {
      // vam's OWN other chunk -- fine, provided it is really there.
      if (existsSync(join(dirname(bundle), name))) continue;
      offenders.push(`${bundle}: require("${name}") -- no such file beside it`);
      continue;
    }
    offenders.push(`${bundle}: require("${name}")`);
  }
}

// The floor this whole script depends on: if NOTHING matched the pattern
// across every bundle, the pattern itself has stopped matching what the
// bundler emits, and every offender check above was silently vacuous.
if (checked === 0) {
  console.error(`no require() found in any of ${bundles.length} bundle(s) -- this check has gone blind`);
  process.exit(1);
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

console.log(
  `bundle externals ok -- ${checked} require(s) across ${bundles.length} bundle(s), all electron, node: builtins or vam's own chunks`,
);
