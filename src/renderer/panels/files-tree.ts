/**
 * The Files tab's TREE, and the keys that walk it -- pure, DOM-free, so the
 * shape and the arithmetic can be proven without rendering anything. The
 * sibling of `files-editor-text.ts`, and `FilesTab.tsx` is the only caller.
 *
 * DERIVED IN THE RENDERER, FROM THE LIST THAT ALREADY SHIPS. `CHANNELS.
 * filesList` (`main/files/list.ts`) answers with a FLAT array of absolute
 * paths under one session's own working directory -- `node_modules` and
 * `.git` walked over, every other dotfile kept, symlinks neither listed nor
 * followed, capped at 5,000 with `truncated`. Every directory in this file is
 * SYNTHESISED from the segments of those paths: nothing here asks main for a
 * directory listing, and nothing here needs a second channel, a second walk
 * or a second authorisation surface. The walk that produced the array is
 * still the only thing that ever touched the disk.
 *
 * That is also the reason a directory with no FILES under it cannot appear:
 * an empty directory contributes no path to the array, so it contributes no
 * segment here. Said plainly rather than left to be discovered -- it is the
 * one visible difference between this tree and a `readdir` per directory, and
 * it is not worth a second IPC channel to fix for a tab whose stated
 * population is "`.env` and a few other files".
 *
 * THE FILTER KEEPS THE TREE, rather than falling back to a flat list of hits.
 * orca's own file explorer does exactly this (`file-explorer-name-filter-
 * projection.ts`: it builds a synthetic tree out of the matching relative
 * paths and lists it) and the reasoning is the same -- `src/index.ts` and
 * `docs/index.ts` are two different files and a flat row reading `index.ts`
 * twice cannot say which is which. A filtered branch is drawn OPEN whatever
 * the operator had collapsed, because a filter that matches a file and then
 * hides it behind a shut parent has answered nothing.
 */

/** One visible row of the tree. */
export type FileTreeRow = {
  /** Absolute, and unique: the row's identity everywhere else. */
  readonly path: string;
  /** The last segment — what the row actually draws. */
  readonly name: string;
  /** 0 for the root's own children, +1 per level. Drives the indent. */
  readonly depth: number;
  readonly isDirectory: boolean;
  /** The directory row that holds this one, or null at depth 0. */
  readonly parent: string | null;
};

type Node = {
  readonly name: string;
  readonly path: string;
  readonly children: Map<string, Node>;
  isDirectory: boolean;
};

/** `root` without a trailing slash — `listFiles` may or may not carry one. */
function baseOf(root: string): string {
  return root.endsWith('/') ? root.slice(0, -1) : root;
}

/**
 * The filter's words. Every one of them has to appear in a file's own
 * relative path, in any order -- the shape orca's explorer filter uses, and a
 * strictly kinder one than a single substring for the case this tab is for
 * ("panels tsx" finds `src/panels/FilesTab.tsx`). A filter of only whitespace
 * has no words and therefore excludes nothing, which is what makes an empty
 * box mean "no filter" without a second branch saying so.
 */
function filterWords(filter: string): string[] {
  return filter
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
}

/**
 * Builds the VISIBLE rows, in draw order: directories before files at every
 * level, each group by name, and a directory's children listed immediately
 * after it exactly when it is open.
 */
export function fileTreeRows({
  root,
  files,
  expanded,
  filter,
}: {
  readonly root: string;
  readonly files: readonly string[];
  readonly expanded: ReadonlySet<string>;
  readonly filter: string;
}): readonly FileTreeRow[] {
  const base = baseOf(root);
  const prefix = `${base}/`;
  const words = filterWords(filter);
  const filtering = words.length > 0;

  const rootNode: Node = { name: '', path: base, children: new Map(), isDirectory: true };
  for (const file of files) {
    const inside = file.startsWith(prefix);
    const relative = inside ? file.slice(prefix.length) : file;
    if (relative === '') continue;
    if (filtering && !words.every((word) => relative.toLowerCase().includes(word))) continue;
    // A PATH THAT IS NOT UNDER THE ROOT STAYS ONE ROW, spelled in full --
    // never split into directories that do not belong to this session. The
    // walk never produces one (`list.ts` never leaves its own root), so this
    // is defensive only, and it is the same defence `relativeLabel` already
    // makes for the same case: a silently wrong label, or here a phantom
    // `etc/` branch beside the session's own files, is the harder version of
    // that bug to notice.
    const segments = inside ? relative.split('/').filter((segment) => segment !== '') : [relative];
    let node = rootNode;
    let path = base;
    for (let i = 0; i < segments.length; i += 1) {
      const name = segments[i] as string;
      // The row's identity is the path the bridge actually answered with,
      // which for an outside path is the file itself -- never a path joined
      // onto a root it is not under, which would open nothing.
      path = inside ? `${path}/${name}` : file;
      const isDirectory = i < segments.length - 1;
      let child = node.children.get(name);
      if (child === undefined) {
        child = { name, path, children: new Map(), isDirectory };
        node.children.set(name, child);
      } else if (isDirectory) {
        // A path can reach a name as a directory after another reached it as
        // a file only if the listing is inconsistent; trusting the directory
        // is what keeps the deeper path reachable either way.
        child.isDirectory = true;
      }
      node = child;
    }
  }

  const rows: FileTreeRow[] = [];
  const walk = (node: Node, depth: number, parent: string | null): void => {
    const children = [...node.children.values()].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of children) {
      rows.push({
        path: child.path,
        name: child.name,
        depth,
        isDirectory: child.isDirectory,
        parent,
      });
      // FILTERING FORCES EVERY SURVIVING BRANCH OPEN — see this file's header.
      if (child.isDirectory && (filtering || expanded.has(child.path))) {
        walk(child, depth + 1, child.path);
      }
    }
  };
  walk(rootNode, 0, null);
  return rows;
}

/** The row index of the directory holding `index`, or null at the top level. */
export function parentRowIndex(rows: readonly FileTreeRow[], index: number): number | null {
  const parent = rows[index]?.parent ?? null;
  if (parent === null) return null;
  const at = rows.findIndex((row) => row.path === parent);
  return at === -1 ? null : at;
}

/** The row index of `index`'s first child, or null when it draws none. */
function firstChildRowIndex(rows: readonly FileTreeRow[], index: number): number | null {
  const next = rows[index + 1];
  const here = rows[index];
  if (here === undefined || next === undefined) return null;
  return next.depth > here.depth ? index + 1 : null;
}

/* ---------------------------------------------------------------------------
 * WHAT THIS TAB'S KEYBOARD IS — the one enumeration of it.
 *
 * Two lists, spelled the way `normalizeKey` spells a keystroke, and both are
 * LOAD-BEARING rather than documentation: `resolveTreeKey` below and
 * `FilesTab.tsx`'s own editor handler each answer a key only if it is in
 * theirs, so a key removed from a list stops working and a key added to one
 * without a branch does nothing. That is what makes
 * `test/keyboard/files-tab.keyboard-doc.test.ts` mean something when it holds
 * them against `docs/keyboard.md`'s own table, the same bargain `chords.ts`
 * and `test/keyboard/chords.keyboard-doc.test.ts` already have for the app-wide
 * grammar: an undocumented binding is a bug in this repo, and `Mod-s` was one
 * for a whole release because nothing checked.
 *
 * `Escape` and `Mod-[` are in BOTH because they mean the same thing on either
 * side — hand the keyboard back to Select.
 *
 * `Mod-p` IS IN BOTH FOR THE OPPOSITE REASON — not because it means the same
 * thing on either side, but because it is the only spelling that CAN work on
 * both. `/` reaches the filter and is a bare character: legal on the tree,
 * which is not an insert scope, and impossible in the editor, where it is a
 * character the operator is typing into a file. So the one act this tab is
 * for — find a file — was unreachable from half of it, and the operator asked
 * for it by name. `Mod-p` is `Cmd+P`, which is "go to file" in VS Code and
 * Sublime, and `chords.ts` records that new-project vacated `Mod-p` for
 * `Mod-Shift-p` and left it free on purpose. `Mod-Shift-f`, the other
 * candidate, is already FORMAT in here and its tooltip promises it by name.
 * ------------------------------------------------------------------------ */

/** Every key the TREE answers. Anything else is the app-wide grammar's. */
export const TREE_KEYS: readonly string[] = [
  'j',
  'k',
  'h',
  'l',
  'Enter',
  '/',
  'Mod-p',
  'Mod-Shift-e',
  'Escape',
  'Mod-[',
];

/**
 * Every key the EDITOR answers. `Tab` covers Shift+Tab too: `normalizeKey`
 * folds Shift into a token for LETTERS only, so both arrive spelled `Tab` and
 * the handler reads `event.shiftKey` for the direction.
 *
 * `Mod-z` IS ON THIS LIST AND IS STILL NOT ALWAYS OURS. Being here only means
 * the handler is given the keystroke; `FilesTab.tsx`'s own branch then calls
 * `preventDefault` ONLY when there is a format to undo, and otherwise leaves
 * the event entirely alone, so the browser's own undo of whatever was typed
 * runs exactly as it always has. Every other key on this list is answered
 * unconditionally, which is why this one carries a note.
 *
 * `Mod-Shift-m` IS `m` FOR MARKDOWN, and the letter was picked against the two
 * nearer candidates rather than at random. `Mod-Shift-v` reads as "view" and
 * is what Chromium binds to paste-as-plain-text INSIDE A TEXT BOX -- taking it
 * would have traded a real editing key for a view toggle. `Mod-Shift-p` is
 * `newProject` already. Like every chord on this list it is HARDCODED rather
 * than rebindable: the editor's keys are not in `chords.ts`'s table, which is
 * exactly what makes writing one into a tooltip honest rather than a lie
 * waiting for the operator to rebind something.
 */
export const EDITOR_KEYS: readonly string[] = [
  'Escape',
  'Mod-[',
  'Tab',
  'Mod-p',
  'Mod-s',
  'Mod-Shift-e',
  'Mod-Shift-f',
  'Mod-Shift-m',
  'Mod-z',
];

/**
 * What one key means to the tree. `null` is "not the tree's key" and is a
 * real answer: the caller leaves it alone, unprevented, and the app-wide
 * grammar gets it — which is how `Alt-<digit>`, `Mod-k` and every other chord
 * keep working with the keyboard in here.
 */
export type TreeKeyStep =
  | { readonly kind: 'move'; readonly index: number }
  | { readonly kind: 'expand'; readonly path: string }
  | { readonly kind: 'collapse'; readonly path: string }
  | { readonly kind: 'open'; readonly path: string; readonly focusEditor: boolean }
  | { readonly kind: 'filter' }
  | { readonly kind: 'editor' }
  | { readonly kind: 'leave' }
  | { readonly kind: 'refuse'; readonly message: string }
  | null;

/**
 * The tree's own keyboard, resolved.
 *
 * `j`/`k`/`h`/`l` because that is what vam's Select cursor already is: `j`/`k`
 * walk a list, `h`/`l` step in and out. `h`/`l` then land on exactly VS
 * Code's and orca's own Left/Right tree semantics (`file-explorer-keyboard-
 * navigation.ts`: collapse-or-parent, expand-or-first-child) without
 * borrowing their keys. Every one of them is a BARE key, which is only legal
 * because the tree is not an insert scope and the rows are not text boxes --
 * see `FilesTab.tsx`'s own header on what marking them would have cost.
 *
 * NOTHING HERE DOES NOTHING. `j` at the bottom re-states the row it is on
 * (the session list's own "stopping at the ends"), and every case that has no
 * act at all answers `refuse` with the words to say. A key that silently did
 * nothing is indistinguishable from a frozen application, which is the
 * argument `resolveChord`'s `abandoned` field already makes for the grammar
 * one level up.
 */
export function resolveTreeKey({
  key,
  rows,
  index,
  expanded,
}: {
  readonly key: string;
  readonly rows: readonly FileTreeRow[];
  readonly index: number;
  readonly expanded: ReadonlySet<string>;
}): TreeKeyStep {
  // NOT OURS, AND SAID FIRST. `TREE_KEYS` is the list, and it is the same
  // list `docs/keyboard.md`'s table is held against.
  if (!TREE_KEYS.includes(key)) return null;

  // THE THREE WAYS OUT COME NEXT, and are answered whether or not there is a
  // row under the cursor: a keyboard stranded in an empty list is the one
  // outcome worse than a refusal.
  if (key === 'Escape' || key === 'Mod-[') return { kind: 'leave' };
  // ONE STEP, TWO SPELLINGS, and the second is the one that also works from
  // the editor -- see this file's key-list header for why `/` alone could not.
  if (key === '/' || key === 'Mod-p') return { kind: 'filter' };
  if (key === 'Mod-Shift-e') return { kind: 'editor' };

  const row = rows[index];
  if (row === undefined) {
    return {
      kind: 'refuse',
      message:
        rows.length === 0
          ? 'nothing to walk — no file here matches the filter'
          : 'nothing under the cursor',
    };
  }

  if (key === 'j') return { kind: 'move', index: Math.min(rows.length - 1, index + 1) };
  if (key === 'k') return { kind: 'move', index: Math.max(0, index - 1) };

  const open = expanded.has(row.path);

  if (key === 'h') {
    if (row.isDirectory && open) return { kind: 'collapse', path: row.path };
    const parent = parentRowIndex(rows, index);
    if (parent === null) {
      return { kind: 'refuse', message: 'already at the top of the tree — nothing to step out to' };
    }
    return { kind: 'move', index: parent };
  }

  if (key === 'l') {
    if (!row.isDirectory) return { kind: 'open', path: row.path, focusEditor: false };
    if (!open) return { kind: 'expand', path: row.path };
    const child = firstChildRowIndex(rows, index);
    if (child === null) {
      return { kind: 'refuse', message: `${row.name} is open and holds nothing to step into` };
    }
    return { kind: 'move', index: child };
  }

  // Enter.
  if (!row.isDirectory) return { kind: 'open', path: row.path, focusEditor: true };
  return open ? { kind: 'collapse', path: row.path } : { kind: 'expand', path: row.path };
}
