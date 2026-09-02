/**
 * The standing constraints for the trees THIS epic invents: `src/main`,
 * `src/preload` and `src/shared`.
 *
 * `test/canvas/topology-constraints.test.ts` is another epic's graded
 * instrument and is not widened here — new code brings its own guard. This one
 * carries the same anti-vacuity clause: a rule whose selector matches no files
 * scans nothing, reports nothing and passes forever, which is how a guard dies
 * quietly the day someone renames the directory it watched.
 *
 * BLIND SPOT, stated so it cannot be silently dropped: both rules below are
 * CONTENT SCANS over source text. They cannot tell code from prose, and the hex
 * pattern will match a pull-request number as happily as a colour.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));
const TREES = ['main', 'preload', 'shared'];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else {
      out.push(relative(SRC_DIR, full).split(sep).join('/'));
    }
  }
  return out.sort();
}

const electronTreeFiles = TREES.flatMap((tree) => listFiles(join(SRC_DIR, tree))).filter((f) =>
  ['.ts', '.tsx', '.css'].includes(extname(f)),
);
const sharedFiles = electronTreeFiles.filter((f) => f.startsWith('shared/'));
const processFiles = electronTreeFiles.filter(
  (f) => f.startsWith('main/') || f.startsWith('preload/'),
);

const at = (f: string, i: number, l: string) => `src/${f}:${i + 1}: ${l.trim()}`;
const IMPORT_LINE = /^\s*import\s+(?:type\s+)?.*\bfrom\s+['"]([^'"]+)['"]/;

/**
 * AC-16(a): does this line import a RUNTIME value from under `src/renderer/`?
 *
 * Four forms, because a scan that knows one passes the other three:
 *
 *  1. `import { createClient } from '../renderer/adapter/client.js'`
 *  2. `import { type Wire, createClient } from '...'` -- the INLINE type
 *     modifier. The statement is not `import type`, the value import is real,
 *     and a scan looking for the `import type` prefix reads it as type-only.
 *  3. `await import('...')` -- vam already does this (`panels/IconPicker.tsx`),
 *     so it is the shape a contributor reaches for by habit.
 *  4. `require('...')` -- main and preload are CJS output, so it is native here.
 *
 * Only the `import type` PREFIX form is accepted. `import { type X } from`
 * would also be erased, and is still reported: the prefix form is the one a
 * reader can verify at a glance, and the fix is to write it.
 */
const TYPE_ONLY_IMPORT = /^\s*import\s+type\s/;
const STATIC_FROM = /^\s*import\s.*\bfrom\s*['"]([^'"]+)['"]/;
const BARE_IMPORT = /^\s*import\s*['"]([^'"]+)['"]/;
const DYNAMIC_IMPORT = /(?:^|[^.\w])import\s*\(\s*['"]([^'"]+)['"]/;
const REQUIRE_CALL = /\brequire\s*\(\s*['"]([^'"]+)['"]/;
const RENDERER_SPECIFIER = /(?:^|[/@])renderer\//;

function rendererRuntimeImport(line: string): string | null {
  const specs: string[] = [];
  if (!TYPE_ONLY_IMPORT.test(line)) {
    const stat = line.match(STATIC_FROM)?.[1] ?? line.match(BARE_IMPORT)?.[1];
    if (stat !== undefined) specs.push(stat);
  }
  const dynamic = line.match(DYNAMIC_IMPORT)?.[1];
  if (dynamic !== undefined) specs.push(dynamic);
  const required = line.match(REQUIRE_CALL)?.[1];
  if (required !== undefined) specs.push(required);
  return specs.find((spec) => RENDERER_SPECIFIER.test(spec)) ?? null;
}

const RULES: {
  name: string;
  files: string[];
  rule: string;
  check: (f: string, l: string, i: number) => string | null;
}[] = [
  {
    // The literal a reviewer will find if this rule is absent is
    // `backgroundColor: '#1f1f1f'` in the BrowserWindow options — the idiomatic
    // way to stop an Electron window flashing white. Main cannot read a CSS
    // custom property, so the answer is `show: false` plus `ready-to-show`,
    // which needs no colour at all.
    name: 'no literal hex colour under src/main, src/preload or src/shared',
    files: electronTreeFiles,
    rule: 'Every colour must come from a token in styles.css, never a literal hex:',
    check: (f, l, i) => (/#[0-9a-fA-F]{3,8}\b/.test(l) ? at(f, i, l) : null),
  },
  {
    // `src/shared` is imported by the renderer, which has no `electron` module
    // and no Node builtins. A shared file that reaches for either compiles in
    // the node config and breaks the browser build.
    name: 'src/shared imports neither electron nor a node builtin',
    files: sharedFiles,
    rule: 'src/shared is shared with the browser, so it stays free of electron and node:',
    check: (f, l, i) => {
      const spec = l.match(IMPORT_LINE)?.[1];
      return spec !== undefined && (spec === 'electron' || spec.startsWith('node:'))
        ? at(f, i, l)
        : null;
    },
  },
  {
    // Main and preload are the trusted processes. A TYPE from the renderer is
    // free -- erased at build time, no runtime coupling, no duplicated type --
    // but a VALUE drags renderer code (and its browser assumptions) into a
    // process that holds the file system and, later, credentials and a PTY.
    name: 'no runtime import from src/main or src/preload into src/renderer',
    files: processFiles,
    rule: 'main and preload may import renderer TYPES only, never a runtime value:',
    check: (f, l, i) => (rendererRuntimeImport(l) === null ? null : at(f, i, l)),
  },
];

describe('standing constraints for the electron trees', () => {
  it.each(RULES)('$name', ({ files, rule, check }) => {
    expect(
      files.length,
      `${rule}\nThis rule matched NO files, so it checked nothing and would have passed vacuously.`,
    ).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const f of files) {
      readFileSync(join(SRC_DIR, f), 'utf8')
        .split('\n')
        .forEach((l, i) => {
          const m = check(f, l, i);
          if (m) violations.push(m);
        });
    }
    expect(violations, [rule, ...violations].join('\n')).toEqual([]);
  });
});

/**
 * The guard's own falsifier, kept as a test rather than as a story about one.
 *
 * Each line below is a real violation in one of the four forms, and each must
 * be reported; the accepted lines beneath them are the type-only imports main
 * and preload legitimately carry today, and must not be.
 */
describe('the renderer-import guard catches every form', () => {
  it.each([
    ['plain', "import { createClient } from '../renderer/adapter/client.js';"],
    [
      'inline type modifier',
      "import { type Wire, createClient } from '../renderer/adapter/api.js';",
    ],
    ['dynamic import', "const mod = await import('../renderer/fixtures/demo.js');"],
    ['require', "const { DEMO_MODEL } = require('../../renderer/fixtures/demo.js');"],
    ['side effect', "import '../renderer/styles.css';"],
  ])('reports a %s import', (_form, line) => {
    expect(rendererRuntimeImport(line)).not.toBeNull();
  });

  it.each([
    ["import type { Project } from '../../renderer/domain/model.js';"],
    ["import type { SessionSource } from '../renderer/sources/port.js';"],
    ["import { contextBridge, ipcRenderer } from 'electron';"],
    ["import { CHANNELS } from '../main/ipc/channels.js';"],
  ])('accepts %s', (line) => {
    expect(rendererRuntimeImport(line)).toBeNull();
  });
});
