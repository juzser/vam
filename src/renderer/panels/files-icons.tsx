/**
 * WHAT A TREE ROW LOOKS LIKE — the glyph before a name, and the ink both wear.
 *
 * The operator asked for this as a question: "can the file tree distinguish
 * file types and folders by colour? And an icon before the folder name." The
 * folder icon is a plain yes. The colour is a yes with a line drawn through
 * it, and the line is the whole design of this module.
 *
 * ── WHY A HUE PER EXTENSION IS NOT WHAT SHIPPED ──────────────────────────
 *
 * A file-explorer icon theme gives every extension its own colour, and in a
 * file explorer that works: the tree IS the application, it is 300px wide, and
 * a coloured glyph is the fastest way to a file you already know the name of.
 * This tree is 118–216px wide, sits beside the editor it feeds, and is read at
 * 11px in monospace. What an operator is doing in it is READING NAMES. Forty
 * rows of a `src/` directory in five saturated hues is a christmas tree: every
 * colour added competes with the names for the same attention, and the tree
 * gets harder to read as it gets more decorated, not easier.
 *
 * So the request is answered in TWO CHANNELS, and they carry different kinds
 * of claim:
 *
 *   SHAPE — seven families, and this is where "distinguish file types" is
 *   really delivered. A folder, a JSON file, a config file, source code, an
 *   image, a document and everything else each draw a different picture. Shape
 *   is a GUESS and is allowed to be one: `.yaml` gets the config glyph because
 *   it looks like config, and if that is wrong the cost is a 12px picture that
 *   was slightly off. Nothing reads it.
 *
 *   COLOUR — four inks, and only one fact. A hue says "VAM HAS AN OPINION
 *   ABOUT THIS FILE": it can colour it, format it, or preview it. That fact is
 *   not restated here — `fileRowInk` asks `highlightLangFor`, the module that
 *   actually decides it, so the tree cannot come to claim a `.md` is
 *   understood on the same day the editor stops colouring one. Everything else
 *   in the repository — which in any real project is most of it — stays grey.
 *
 * The two channels disagree on purpose in one visible place: a `.yaml` and a
 * `.ini` draw the SAME glyph and take DIFFERENT inks, because they are the
 * same kind of thing to a person and only one of them is something vam can do
 * anything with. `test/panels/files-icons.test.tsx` holds that.
 *
 * ── THE PALETTE ──────────────────────────────────────────────────────────
 *
 * Every ink is a rung of the ladder `styles.css` already defines; none is a
 * literal, and none is one of the four STATUS colours. Green, amber, blue and
 * red mean running, waiting, done and failed everywhere else in this
 * application, and spending one on "this is a JSON file" would make both
 * readings weaker — the same argument the note beside those tokens makes about
 * a diff's added line.
 *
 * These are ICONS, so they owe WCAG 1.4.11's 3:1 rather than 1.4.3's 4.5:1 —
 * but a tree row has THREE fills (the panel it sits on, `raised` under a
 * hover, `line-strong` under the keyboard cursor) and the cursor's is by far
 * the lightest, which is where a hue picked against the panel alone comes
 * apart. Measured on that worst fill, in dark: `syn-string` 5.08, `quote`
 * 4.34, `chip` 4.01, `ink` 6.67, `ink-faint` 3.60. `syn-comment` is NOT here
 * and was the first candidate: it reads 2.54 there, under the floor.
 * `test/renderer/token-contrast.test.ts` is what holds all of that to numbers.
 */

import {
  File,
  FileBraces,
  FileCode,
  FileCog,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
} from 'lucide-react';
import { baseName, extensionOf } from './files-editor-text.js';
import { highlightLangFor } from './files-highlight.js';

/** The families a row can belong to. Seven, and each draws its own picture. */
export type FileIconShape = 'directory' | 'json' | 'config' | 'code' | 'image' | 'doc' | 'plain';

/** Every shape, as a value, so a test can sweep them rather than list them. */
export const FILE_ICON_SHAPES: readonly FileIconShape[] = [
  'directory',
  'json',
  'config',
  'code',
  'image',
  'doc',
  'plain',
];

/**
 * The extension lists, by family.
 *
 * Deliberately generous and deliberately unauthoritative — a family is a
 * picture, not a promise, so a language missing from `code` draws the plain
 * file glyph and nothing else happens. The lists are `Set`s rather than
 * switch cases because a row is drawn per file per render and a tree can hold
 * thousands.
 */
const CODE = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.swift',
  '.dart',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.lua',
  '.pl',
  '.ex',
  '.exs',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.sql',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.vue',
  '.svelte',
]);

const CONFIG = new Set([
  '.ini',
  '.conf',
  '.cfg',
  '.toml',
  '.yaml',
  '.yml',
  '.properties',
  '.editorconfig',
]);

const IMAGE = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.avif',
  '.ico',
  '.bmp',
  '.heic',
]);

const DOC = new Set(['.md', '.markdown', '.txt', '.rst', '.adoc', '.log', '.csv']);

const JSON_LIKE = new Set(['.json', '.jsonc', '.json5']);

/**
 * Which family `path` belongs to.
 *
 * `isDirectory` is the tree's own answer (`files-tree.ts`) and outranks every
 * name rule: a directory called `notes.md` is a directory, and reading its
 * name would draw a document glyph on something the operator cannot open in
 * the editor at all.
 */
export function fileIconShape(path: string, isDirectory: boolean): FileIconShape {
  if (isDirectory) return 'directory';
  const name = baseName(path);
  // The `.env` FAMILY is a name rather than an extension, exactly as
  // `editorFileKind` reads it — `.env.local` has an extension of `.local`,
  // which is in none of the sets below and would have drawn a plain file.
  if (name === '.env' || name.startsWith('.env.')) return 'config';
  const ext = extensionOf(name);
  if (ext === null) return 'plain';
  if (JSON_LIKE.has(ext)) return 'json';
  if (ext === '.env' || CONFIG.has(ext)) return 'config';
  if (CODE.has(ext)) return 'code';
  if (IMAGE.has(ext)) return 'image';
  if (DOC.has(ext)) return 'doc';
  return 'plain';
}

/**
 * Every ink a row's glyph can take. The allowlist a test sweeps against, so
 * an arbitrary `text-[#...]` added later is a failure rather than a paint
 * nothing measures.
 */
export const FILE_ROW_INKS: readonly string[] = [
  'text-ink',
  'text-chip',
  'text-syn-string',
  'text-quote',
  'text-ink-faint',
];

/**
 * The ink for a row — and the ONE fact it states.
 *
 * Derived from `highlightLangFor` rather than from a list of its own. That is
 * the whole point: the tree's claim and the editor's behaviour are the same
 * decision read twice, so they cannot drift apart. A file vam has nothing to
 * offer for takes the quiet grey, which in any real repository is most of
 * them — which is what stops the tree becoming a decoration.
 */
export function fileRowInk(path: string, isDirectory: boolean): string {
  if (isDirectory) return 'text-ink';
  switch (highlightLangFor(path)) {
    case 'json':
      return 'text-chip';
    case 'env':
    case 'ini':
      return 'text-syn-string';
    case 'md':
      return 'text-quote';
    default:
      return 'text-ink-faint';
  }
}

/** Which lucide component draws each family. Total over `FileIconShape`, so a
 *  new family cannot be added without choosing a picture for it. */
const GLYPH = {
  directory: Folder,
  json: FileBraces,
  config: FileCog,
  code: FileCode,
  image: FileImage,
  doc: FileText,
  plain: File,
} as const satisfies Record<FileIconShape, typeof File>;

/**
 * The glyph before a row's name.
 *
 * `aria-hidden`, always: the row is a `treeitem` whose accessible name is the
 * file's own name, and `aria-expanded` already tells a screen reader whether a
 * directory is open. A second, spoken "folder" would be the same fact twice,
 * and a spoken "file, code" would be a guess read aloud as though it were one.
 *
 * `data-file-icon` carries the shape so a guard can measure what was really
 * drawn — a class name proves a rule was typed, not that it matched.
 */
export function FileRowIcon({
  path,
  isDirectory,
  open,
}: {
  readonly path: string;
  readonly isDirectory: boolean;
  /** Only meaningful for a directory: whether the tree has it expanded. */
  readonly open: boolean;
}) {
  const shape = fileIconShape(path, isDirectory);
  const Glyph = shape === 'directory' && open ? FolderOpen : GLYPH[shape];
  return (
    <Glyph
      data-file-icon={shape === 'directory' && open ? 'directory-open' : shape}
      aria-hidden="true"
      size={12}
      strokeWidth={1.6}
      className={`flex-none ${fileRowInk(path, isDirectory)}`}
    />
  );
}
