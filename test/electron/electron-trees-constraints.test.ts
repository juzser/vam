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
 *
 * STATEMENT, not LINE: biome's own formatter wraps a named-import list once
 * it crosses `lineWidth` (100 here), splitting `import { … } from '…'` onto
 * three lines with neither `import` nor `from` sharing a line with the
 * specifier. A scan that tests one line at a time never sees the full
 * statement, so every regex below is run against the WHOLE FILE TEXT, not a
 * per-line slice. The clause between the `import`/`require` keyword and the
 * opening quote is matched with `[^'"]*?` -- excluding quote characters --
 * so a lazy match can never skip past the string literal that closes one
 * statement and accidentally splice it to the next; a JS/TS import clause
 * never legitimately contains a quote before its specifier, so this bound
 * is exact, not a heuristic.
 *
 * The clause is ALSO bounded against crossing into a second `import` (or
 * `require`, or a `;`): without that, a doc comment mentioning "import"
 * ahead of a real, later `import type { X } from '...'` statement lets the
 * lazy match skip the comment's stray "import" word and the real
 * statement's own `type` keyword, splicing them into one false violation.
 */
const TYPE_ONLY_IMPORT = /^import\s+type\s/;
const STATEMENT_FROM =
  /\bimport\s+(?:type\s+)?(?:(?!\bimport\b|\brequire\b|;)[^'"])*?\bfrom\s*['"]([^'"]+)['"]/g;
const STATEMENT_BARE = /\bimport\s*['"]([^'"]+)['"]/g;
const STATEMENT_DYNAMIC = /(?:^|[^.\w])import\s*\(\s*['"]([^'"]+)['"]/g;
const STATEMENT_REQUIRE = /\brequire\s*\(\s*['"]([^'"]+)['"]/g;
const RENDERER_SPECIFIER = /(?:^|[/@])renderer\//;

/**
 * Every import/require specifier found anywhere in `text`, with the index
 * (into `text`) where the match starts -- used by the whole-file scan to
 * recover a line number for reporting. `text` may be a single line (the
 * falsifier tests below) or a whole file; the regexes above tolerate both.
 */
function importSpecifiersIn(text: string): { index: number; spec: string }[] {
  const specs: { index: number; spec: string }[] = [];
  for (const m of text.matchAll(STATEMENT_FROM)) {
    if (TYPE_ONLY_IMPORT.test(m[0])) continue;
    specs.push({ index: m.index ?? 0, spec: m[1] as string });
  }
  for (const m of text.matchAll(STATEMENT_BARE)) {
    specs.push({ index: m.index ?? 0, spec: m[1] as string });
  }
  for (const m of text.matchAll(STATEMENT_DYNAMIC)) {
    specs.push({ index: m.index ?? 0, spec: m[1] as string });
  }
  for (const m of text.matchAll(STATEMENT_REQUIRE)) {
    specs.push({ index: m.index ?? 0, spec: m[1] as string });
  }
  return specs;
}

function rendererRuntimeImport(text: string): string | null {
  return importSpecifiersIn(text).find(({ spec }) => RENDERER_SPECIFIER.test(spec))?.spec ?? null;
}

/** Zero-based line index and line text at a character offset into `content`. */
function lineAt(content: string, index: number): { i: number; l: string } {
  const i = content.slice(0, index).split('\n').length - 1;
  const l = content.split('\n')[i] as string;
  return { i, l };
}

const RULES: {
  name: string;
  files: string[];
  rule: string;
  // Per-line rules set `check`; the renderer-import rule scans the whole
  // file at once (a statement can span lines) and sets `checkFile` instead.
  check?: (f: string, l: string, i: number) => string | null;
  checkFile?: (f: string, content: string) => string[];
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
    checkFile: (f, content) =>
      importSpecifiersIn(content)
        .filter(({ spec }) => RENDERER_SPECIFIER.test(spec))
        .map(({ index }) => {
          const { i, l } = lineAt(content, index);
          return at(f, i, l);
        }),
  },
];

describe('standing constraints for the electron trees', () => {
  it.each(RULES)('$name', ({ files, rule, check, checkFile }) => {
    expect(
      files.length,
      `${rule}\nThis rule matched NO files, so it checked nothing and would have passed vacuously.`,
    ).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const f of files) {
      const content = readFileSync(join(SRC_DIR, f), 'utf8');
      if (checkFile) {
        violations.push(...checkFile(f, content));
        continue;
      }
      content.split('\n').forEach((l, i) => {
        const m = check?.(f, l, i);
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
 *
 * The WRAPPED cases repeat all four forms split across lines -- the shape a
 * scan that reads one line at a time cannot see. Named-import wrapping in
 * particular is not a contrivance: biome's configured `lineWidth: 100`
 * produces exactly this shape for any import list that runs long.
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
    [
      'wrapped named-import list',
      "import {\n  createSourceFromPreload,\n} from '../renderer/sources/preload-factory.js';",
    ],
    ['wrapped from clause', "import { createClient } from\n  '../renderer/adapter/client.js';"],
    ['wrapped dynamic import', "const mod = await import(\n  '../renderer/fixtures/demo.js'\n);"],
    ['wrapped require', "const { DEMO_MODEL } = require(\n  '../../renderer/fixtures/demo.js'\n);"],
  ])('reports a %s import', (_form, line) => {
    expect(rendererRuntimeImport(line)).not.toBeNull();
  });

  it.each([
    ["import type { Project } from '../../renderer/domain/model.js';"],
    ["import type { SessionSource } from '../renderer/sources/port.js';"],
    ["import { contextBridge, ipcRenderer } from 'electron';"],
    ["import { CHANNELS } from '../main/ipc/channels.js';"],
    ["import type {\n  Project,\n} from '../../renderer/domain/model.js';"],
  ])('accepts %s', (line) => {
    expect(rendererRuntimeImport(line)).toBeNull();
  });
});
