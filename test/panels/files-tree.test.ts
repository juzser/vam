/**
 * The Files tab's TREE, derived in the renderer from the flat array of
 * absolute paths `CHANNELS.filesList` already answers with.
 *
 * Pure and DOM-free on purpose, the same bargain `files-editor-text.ts` made:
 * the shape of a directory tree, the order its rows come out in, what a
 * filter does to it and where a key moves the cursor are all arithmetic, and
 * arithmetic proven here does not have to be re-proven through a rendered
 * component for every case. `DetailPanel.files-tab.test.tsx` then proves the
 * WIRING -- that a real keystroke on a real row reaches these functions -- and
 * `e2e/files-tab-keyboard-shots.mjs` proves the layout Chromium actually
 * paints.
 */

import { describe, expect, it } from 'vitest';
import {
  type FileTreeRow,
  fileTreeRows,
  parentRowIndex,
  resolveTreeKey,
} from '../../src/renderer/panels/files-tree.js';

const ROOT = '/work/atlas';

const rows = (
  files: readonly string[],
  expanded: readonly string[] = [],
  filter = '',
): readonly FileTreeRow[] =>
  fileTreeRows({ root: ROOT, files, expanded: new Set(expanded), filter });

/** `name@depth` per row — the shape, without the absolute-path noise. */
const shape = (list: readonly FileTreeRow[]): string[] =>
  list.map((row) => `${row.name}@${row.depth}${row.isDirectory ? '/' : ''}`);

describe('building a tree from a flat list of absolute paths', () => {
  it('puts every file directly under the root at depth 0', () => {
    expect(shape(rows([`${ROOT}/.env`, `${ROOT}/README.md`]))).toEqual(['.env@0', 'README.md@0']);
  });

  it('collapses a directory to ONE row, and hides its files until it is expanded', () => {
    const tree = rows([`${ROOT}/src/index.ts`, `${ROOT}/src/panels/FilesTab.tsx`]);
    expect(shape(tree)).toEqual(['src@0/']);
  });

  it('lists a directory’s own children once it is expanded, one level at a time', () => {
    const tree = rows([`${ROOT}/src/index.ts`, `${ROOT}/src/panels/FilesTab.tsx`], [`${ROOT}/src`]);
    expect(shape(tree)).toEqual(['src@0/', 'panels@1/', 'index.ts@1']);
  });

  it('nests as deep as it is expanded', () => {
    const tree = rows([`${ROOT}/src/panels/FilesTab.tsx`], [`${ROOT}/src`, `${ROOT}/src/panels`]);
    expect(shape(tree)).toEqual(['src@0/', 'panels@1/', 'FilesTab.tsx@2']);
  });

  it('draws directories before files, each group by name', () => {
    const tree = rows([`${ROOT}/z.txt`, `${ROOT}/a.txt`, `${ROOT}/b/one.txt`]);
    expect(shape(tree)).toEqual(['b@0/', 'a.txt@0', 'z.txt@0']);
  });

  /**
   * THE FILE THIS WHOLE FEATURE EXISTS FOR. `list.ts` skips `node_modules`
   * and `.git` and keeps every other dotfile; a tree that re-hid them in the
   * renderer would defeat the feature one layer above the one that was
   * careful about it.
   */
  it('keeps dotfiles and dotdirectories visible', () => {
    const tree = rows([`${ROOT}/.env`, `${ROOT}/.github/workflows/ci.yml`], [`${ROOT}/.github`]);
    expect(shape(tree)).toEqual(['.github@0/', 'workflows@1/', '.env@0']);
  });

  it('carries each row’s absolute path, and its parent’s', () => {
    const tree = rows([`${ROOT}/src/index.ts`], [`${ROOT}/src`]);
    expect(tree.map((row) => [row.path, row.parent])).toEqual([
      [`${ROOT}/src`, null],
      [`${ROOT}/src/index.ts`, `${ROOT}/src`],
    ]);
  });

  it('tolerates a root written with a trailing slash', () => {
    const tree = fileTreeRows({
      root: `${ROOT}/`,
      files: [`${ROOT}/.env`],
      expanded: new Set(),
      filter: '',
    });
    expect(shape(tree)).toEqual(['.env@0']);
  });

  it('is empty for an empty listing rather than throwing', () => {
    expect(rows([])).toEqual([]);
  });

  /**
   * DEFENSIVE ONLY — `listFiles` never walks outside its own root. What it
   * defends against is a phantom branch: split into segments, `/etc/passwd`
   * would draw an `etc/` directory beside the session's own files, and the
   * row under it would carry a path joined onto a root it is not under, which
   * would open nothing. `relativeLabel` already makes the same defence for
   * the same case, for the same reason.
   */
  it('keeps a path that is not under the root as one row, spelled in full', () => {
    const tree = rows([`${ROOT}/.env`, '/etc/passwd']);
    expect(shape(tree)).toEqual(['.env@0', '/etc/passwd@0']);
    expect(tree[1]?.path).toBe('/etc/passwd');
  });
});

describe('the filter — a tree that cannot be filtered is worse than the flat list', () => {
  const FILES = [
    `${ROOT}/.env`,
    `${ROOT}/src/index.ts`,
    `${ROOT}/src/panels/FilesTab.tsx`,
    `${ROOT}/docs/ui/notes.md`,
  ];

  it('keeps only the files that match, and the directories that lead to them', () => {
    expect(shape(rows(FILES, [], 'filestab'))).toEqual(['src@0/', 'panels@1/', 'FilesTab.tsx@2']);
  });

  it('opens the matching branches without the operator expanding anything', () => {
    // The point of the previous test stated as the property it rests on: NO
    // path was in `expanded`, and three levels came out anyway. A filter that
    // matched deep files and then hid them behind a collapsed parent would be
    // a filter that answers nothing.
    expect(rows(FILES, [], 'notes').length).toBe(3);
  });

  it('matches on the whole relative path, not only the file’s own name', () => {
    expect(shape(rows(FILES, [], 'docs/'))).toEqual(['docs@0/', 'ui@1/', 'notes.md@2']);
  });

  it('ignores case', () => {
    expect(shape(rows(FILES, [], 'FILESTAB'))).toEqual(['src@0/', 'panels@1/', 'FilesTab.tsx@2']);
  });

  it('takes every whitespace-separated word, in any order', () => {
    expect(shape(rows(FILES, [], 'tsx panels'))).toEqual(['src@0/', 'panels@1/', 'FilesTab.tsx@2']);
  });

  it('answers nothing for a filter nothing matches — never the unfiltered tree', () => {
    expect(rows(FILES, [], 'no-such-thing')).toEqual([]);
  });

  it('a filter of only whitespace is no filter at all', () => {
    expect(shape(rows(FILES, [], '   '))).toEqual(shape(rows(FILES)));
  });
});

describe('where a key moves the cursor', () => {
  const FILES = [`${ROOT}/.env`, `${ROOT}/src/index.ts`, `${ROOT}/src/panels/FilesTab.tsx`];
  const OPEN = rows(FILES, [`${ROOT}/src`]); // src/, panels/, index.ts, .env
  const SHUT = rows(FILES); // src/, .env

  it('finds the shape those cases rest on', () => {
    // A resolver walking an empty list answers "refuse" to everything and
    // every expectation below would pass for the wrong reason.
    expect(shape(OPEN)).toEqual(['src@0/', 'panels@1/', 'index.ts@1', '.env@0']);
    expect(shape(SHUT)).toEqual(['src@0/', '.env@0']);
  });

  const key = (k: string, index: number, list = OPEN, expanded = [`${ROOT}/src`]) =>
    resolveTreeKey({ key: k, rows: list, index, expanded: new Set(expanded) });

  it('j walks down one row and k walks back up', () => {
    expect(key('j', 0)).toEqual({ kind: 'move', index: 1 });
    expect(key('k', 1)).toEqual({ kind: 'move', index: 0 });
  });

  it('j stops at the last row and k at the first, the way the session list does', () => {
    expect(key('j', OPEN.length - 1)).toEqual({ kind: 'move', index: OPEN.length - 1 });
    expect(key('k', 0)).toEqual({ kind: 'move', index: 0 });
  });

  it('l expands a shut directory', () => {
    expect(key('l', 0, SHUT, [])).toEqual({ kind: 'expand', path: `${ROOT}/src` });
  });

  it('l steps into a directory that is already open', () => {
    expect(key('l', 0)).toEqual({ kind: 'move', index: 1 });
  });

  it('l on a file opens it — stepping in, on a leaf, is opening it', () => {
    expect(key('l', 3)).toEqual({ kind: 'open', path: `${ROOT}/.env`, focusEditor: false });
  });

  it('h shuts an open directory', () => {
    expect(key('h', 0)).toEqual({ kind: 'collapse', path: `${ROOT}/src` });
  });

  it('h steps out to the parent from anything inside it', () => {
    expect(key('h', 2)).toEqual({ kind: 'move', index: 0 });
  });

  /** The house rule: a key that cannot act says so rather than doing nothing. */
  it('h at the top of the tree refuses out loud rather than silently doing nothing', () => {
    const step = key('h', 3);
    expect(step?.kind).toBe('refuse');
    expect(step?.kind === 'refuse' ? step.message : '').toMatch(/top of the tree/i);
  });

  it('Enter opens the file under the cursor AND takes the keyboard to the editor', () => {
    expect(key('Enter', 3)).toEqual({ kind: 'open', path: `${ROOT}/.env`, focusEditor: true });
  });

  it('Enter on a directory shuts it when it is open, and opens it when it is shut', () => {
    expect(key('Enter', 0)).toEqual({ kind: 'collapse', path: `${ROOT}/src` });
    expect(key('Enter', 0, SHUT, [])).toEqual({ kind: 'expand', path: `${ROOT}/src` });
  });

  it('/ puts the caret in the filter box', () => {
    expect(key('/', 0)).toEqual({ kind: 'filter' });
  });

  it('Mod-Shift-e hands the keyboard back to the editor', () => {
    expect(key('Mod-Shift-e', 0)).toEqual({ kind: 'editor' });
  });

  it('Escape and Mod-[ hand the keyboard back to Select', () => {
    expect(key('Escape', 0)).toEqual({ kind: 'leave' });
    expect(key('Mod-[', 0)).toEqual({ kind: 'leave' });
  });

  it('claims no key it has no meaning for — those stay the grammar’s', () => {
    expect(key('x', 0)).toBeNull();
    expect(key('Mod-k', 0)).toBeNull();
    expect(key('Alt-1', 0)).toBeNull();
  });

  it('refuses every motion out loud when the tree has no rows at all', () => {
    for (const k of ['j', 'k', 'h', 'l', 'Enter']) {
      const step = resolveTreeKey({ key: k, rows: [], index: 0, expanded: new Set() });
      expect(step?.kind, `${k} on an empty tree`).toBe('refuse');
    }
    // ...but the two ways OUT still work on an empty tree, or the keyboard
    // would be stranded in a list with nothing in it.
    expect(resolveTreeKey({ key: '/', rows: [], index: 0, expanded: new Set() })).toEqual({
      kind: 'filter',
    });
    expect(resolveTreeKey({ key: 'Escape', rows: [], index: 0, expanded: new Set() })).toEqual({
      kind: 'leave',
    });
  });
});

describe('parentRowIndex', () => {
  const tree = rows(
    [`${ROOT}/.env`, `${ROOT}/src/panels/FilesTab.tsx`],
    [`${ROOT}/src`, `${ROOT}/src/panels`],
  );

  it('finds the shape it is about', () => {
    expect(shape(tree)).toEqual(['src@0/', 'panels@1/', 'FilesTab.tsx@2', '.env@0']);
  });

  it('answers the row that holds this one', () => {
    expect(parentRowIndex(tree, 2)).toBe(1);
    expect(parentRowIndex(tree, 1)).toBe(0);
  });

  it('answers null at the top level, where there is no parent row', () => {
    expect(parentRowIndex(tree, 0)).toBeNull();
    expect(parentRowIndex(tree, 3)).toBeNull();
  });
});
