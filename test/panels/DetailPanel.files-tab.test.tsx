// @vitest-environment happy-dom

/**
 * The Files tab: withdrawal, the file list, the editor and its seven
 * refusals, and the keyboard model that keeps unsaved text alive.
 *
 * `list`/`read`/`write` are read off `window.api.files` INSIDE `DetailPanel`
 * -- the same seam `TerminalTab`'s own `read`/`resize`/`send` are wired
 * through (`globalThis.window?.api?.terminal?.read`) -- so every test here
 * sets the bridge with `Object.defineProperty`, mirroring
 * `DetailPanel.test.tsx`'s own `mode control` tests.
 */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FileListResult,
  FileReadResult,
  FileSignature,
  FileWriteResult,
} from '../../src/main/files/types.js';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { chordSymbols } from '../../src/renderer/keyboard/chords.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import { FORMAT_OFFER } from '../../src/renderer/panels/files-format.js';
import { resetUnsavedRegistry } from '../../src/renderer/panels/unsaved-files.js';
import {
  DEFAULT_EDITOR_HIGHLIGHT,
  DEFAULT_EDITOR_INDENT,
  setActiveEditorSettings,
} from '../../src/renderer/prefs/editor.js';
import {
  DEFAULT_FILES_MARKDOWN_VIEW,
  setActiveFilesMarkdownView,
} from '../../src/renderer/prefs/files-markdown-view.js';
import { onBothPlatformsAsync } from '../support/platform.js';

/**
 * THE AMBIENT DEFAULT, PINNED TO RAW FOR EVERY TEST IN THIS FILE THAT DOES
 * NOT SAY OTHERWISE.
 *
 * `activeFilesMarkdownView()` is module-wide state (`files-markdown-view.ts`
 * carries why it has no per-test lifecycle of its own), and this whole file
 * predates the device default changing to `'preview'`. Every test below that
 * opens a `.md` file and asserts on the RAW editor — the gutter, the
 * formatter, the keyboard model, `Mod-Shift-m` FROM the editor INTO the
 * preview — was written against the OLD default and is about something
 * other than what that default is. Pinning it here, once, keeps every one
 * of those bodies unchanged; the one `describe` that is actually ABOUT the
 * new default (`the default view for a freshly opened .md file`) restores
 * the real default explicitly before it draws anything.
 */
beforeEach(() => {
  setActiveFilesMarkdownView('raw');
});

const DECISION: Decision = {
  id: 'd1',
  label: 'step 1',
  input: 'ask',
  output: 'answered',
  commands: [],
};

const SESSION: Session = {
  id: 's1',
  title: 'atlas work',
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '12m',
  decisions: [DECISION],
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ENTRY: SessionEntry = { project: PROJECT, session: SESSION };

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const qa = <T extends Element>(selector: string) => [...document.querySelectorAll<T>(selector)];

/** The tree's rows, in draw order, by the absolute path each carries. */
const rowPaths = (): string[] =>
  qa<HTMLElement>('[data-files-row]').map((el) => el.getAttribute('data-files-row-path') ?? '');

/** One tree row, by absolute path. */
const row = (path: string): HTMLElement | undefined =>
  qa<HTMLElement>('[data-files-row]').find((el) => el.getAttribute('data-files-row-path') === path);

/** The path the tree's keyboard cursor is on, or null. */
const cursor = (): string | null =>
  q<HTMLElement>('[data-files-cursor]')?.getAttribute('data-files-row-path') ?? null;

const SIGNATURE = (over: Partial<FileSignature> = {}): FileSignature => ({
  size: 12,
  mtimeMs: 1,
  sha256: 'abc',
  ...over,
});

function refusal(code: string, message: string) {
  return { kind: 'refused' as const, code, message };
}

type Bridge = {
  list: (sessionId: string) => Promise<FileListResult>;
  read: (path: string) => Promise<FileReadResult>;
  write: (
    path: string,
    content: string,
    baseSignature: FileSignature | null,
  ) => Promise<FileWriteResult>;
  /** The quit guard's own half of this bridge — see `src/main/quit/guard.ts`. */
  reportUnsaved: (report: { count: number; names: readonly string[] }) => void;
};

function withBridge(bridge: Partial<Bridge>) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      files: {
        list: bridge.list ?? (async () => ({ root: '/work/atlas', files: [], truncated: false })),
        read: bridge.read ?? (async () => Promise.reject(refusal('not-found', 'missing'))),
        write:
          bridge.write ?? (async () => Promise.reject(refusal('unreadable', 'no write wired'))),
        reportUnsaved: bridge.reportUnsaved,
      },
    },
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'api');
  // The unsaved registry is module-wide (`panels/unsaved-files.ts`). `cleanup`
  // already unmounts every tab, which releases its slot; this is the belt to
  // that braces, so one test's dirty buffer can never be counted in the next.
  resetUnsavedRegistry();
});

async function draw(over: Partial<DetailPanelProps> = {}) {
  const props: DetailPanelProps = {
    entry: ENTRY,
    decision: DECISION,
    draft: '',
    onDraftChange: () => {},
    onSubmit: () => {},
    composing: false,
    onCompose: () => {},
    onStopComposing: () => {},
    active: false,
    actionIndex: 0,
    width: 408,
    resizeHandle: null,
    files: true,
    ...over,
  };
  render(<DetailPanel {...props} />);
  // `FilesTab` mounts behind a `React.lazy` + `Suspense` boundary now
  // (`DetailPanel.tsx`'s own `LazyFilesTab` -- see its declaration's header
  // for the measured cost), so its DOM is not there the instant `render`
  // returns. `[data-files]` is FilesTab's own root marker in every one of
  // its three return branches (`data-files-empty`/`data-files-unavailable`/
  // `data-files-view`), so its arrival is exactly the signal "the lazy chunk
  // resolved and rendered" -- `DetailPanel.file-ref.test.tsx`'s own
  // `LazyMarkdown` wait is the precedent for this shape. Skipped when
  // `files` does not resolve `true`: FilesTab never mounts at all then, and
  // this would wait forever.
  if (props.files === true) {
    await waitFor(() => {
      if (!document.querySelector('[data-files]')) throw new Error('still pending');
    });
  }
}

const openFiles = async () => {
  await act(async () => {
    q<HTMLButtonElement>('[data-view="files"]')?.click();
    await Promise.resolve();
  });
};

/**
 * PRESSES THE SAVE CHORD, on whichever element actually holds `onKeyDown` —
 * the editor while raw, `[data-files-preview-view]` while previewing. There
 * is no Save button any more (`FilesTab.tsx`'s own dirty-indicator comment):
 * the operator asked for an indicator instead, so every test that used to
 * click one now presses `Mod-s` exactly as the operator's fingers would.
 */
const saveViaChord = async (target: Element) => {
  await act(async () => {
    fireEvent.keyDown(target, { key: 's', metaKey: true });
    await Promise.resolve();
  });
};

describe('the Files tab is withdrawn until a caller confirms the desktop bridge', () => {
  it('draws no Files icon when the files prop is absent', async () => {
    await draw({ files: undefined });
    expect(q('[data-view="files"]')).toBeNull();
  });

  it('draws no Files icon when files is explicitly false', async () => {
    await draw({ files: false });
    expect(q('[data-view="files"]')).toBeNull();
  });

  it('draws the Files icon once a caller has confirmed the bridge', async () => {
    withBridge({});
    await draw({ files: true });
    expect(q('[data-view="files"]')).not.toBeNull();
  });
});

describe('no session focused', () => {
  it('says so, plainly, rather than showing an empty list', async () => {
    withBridge({});
    await draw({ entry: null, files: true });
    await openFiles();
    expect(q('[data-files-empty]')?.textContent).toContain('No session selected');
  });
});

describe('the file tree', () => {
  it('draws what the bridge answers as a tree, dotfiles included, directories first', async () => {
    const list = vi.fn(async (sessionId: string) => {
      expect(sessionId).toBe('s1');
      return {
        root: '/work/atlas',
        files: ['/work/atlas/.env', '/work/atlas/src/index.ts'],
        truncated: false,
      };
    });
    withBridge({ list });
    await draw({ files: true });
    await openFiles();

    // Two rows, not two files: `src` is one collapsed directory, and `.env`
    // is a dotfile the tree must never hide — it is the file this whole tab
    // exists for.
    expect(rowPaths()).toEqual(['/work/atlas/src', '/work/atlas/.env']);
    expect(row('/work/atlas/src')?.getAttribute('data-files-row-kind')).toBe('directory');
    expect(row('/work/atlas/.env')?.getAttribute('data-files-row-kind')).toBe('file');
  });

  /**
   * THE TREE AND THE EDITOR ARE BOTH ON SCREEN — the whole of what the
   * operator asked for ("file tree nằm bên phải pane, content ở giữa"), and
   * the property the shipped two-sub-view version could not have: it drew one
   * OR the other. A regression here would be invisible to every refusal test
   * in this file, because each of those only ever looks at one half.
   */
  it('keeps the tree on screen while a file is open in the editor', async () => {
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }),
      read: async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true });
    await openFiles();
    expect(q('[data-files-tree]')).not.toBeNull();
    await act(async () => {
      row('/work/atlas/.env')?.click();
      await Promise.resolve();
    });
    expect(q('[data-files-editor]')).not.toBeNull();
    expect(q('[data-files-tree]')).not.toBeNull();
    expect(row('/work/atlas/.env')).not.toBeNull();
  });

  /**
   * MUTATION TARGET: make a directory row's `onClick` do nothing, or drop
   * the `expanded` check out of `fileTreeRows`, and this reddens.
   */
  it('opens and shuts a directory on click, drawing its children only while it is open', async () => {
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/src/index.ts', '/work/atlas/src/panels/FilesTab.tsx'],
        truncated: false,
      }),
    });
    await draw({ files: true });
    await openFiles();
    expect(rowPaths()).toEqual(['/work/atlas/src']);
    expect(row('/work/atlas/src')?.getAttribute('data-files-row-open')).toBe('false');

    await act(async () => {
      row('/work/atlas/src')?.click();
      await Promise.resolve();
    });
    expect(rowPaths()).toEqual([
      '/work/atlas/src',
      '/work/atlas/src/panels',
      '/work/atlas/src/index.ts',
    ]);
    expect(row('/work/atlas/src')?.getAttribute('data-files-row-open')).toBe('true');
    expect(row('/work/atlas/src')?.getAttribute('aria-expanded')).toBe('true');

    await act(async () => {
      row('/work/atlas/src')?.click();
      await Promise.resolve();
    });
    expect(rowPaths()).toEqual(['/work/atlas/src']);
  });

  /**
   * THE ICON BEFORE THE NAME — what the operator asked for in as many words,
   * and the only surface that proves `files-icons.tsx` is actually WIRED.
   *
   * `test/panels/files-icons.test.tsx` proves the classifier and the glyph in
   * isolation; a module can be perfect and unreferenced. These check the tree
   * really calls it, really passes the directory flag, and really passes the
   * OPEN state — which is the one argument a row has that the classifier
   * cannot derive for itself.
   */
  it('draws a folder before a directory’s name, and opens it when the row opens', async () => {
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/src/index.ts', '/work/atlas/README.md'],
        truncated: false,
      }),
    });
    await draw({ files: true });
    await openFiles();

    const icon = (path: string) =>
      row(path)?.querySelector('[data-file-icon]')?.getAttribute('data-file-icon') ?? null;
    expect(icon('/work/atlas/src')).toBe('directory');
    expect(icon('/work/atlas/README.md')).toBe('doc');

    await act(async () => {
      row('/work/atlas/src')?.click();
      await Promise.resolve();
    });
    expect(icon('/work/atlas/src')).toBe('directory-open');
    expect(icon('/work/atlas/src/index.ts')).toBe('code');
  });

  /**
   * AND THE HUE, which is the half of the operator's question this repo
   * answered with a line drawn through it (`files-icons.tsx`'s header). What
   * matters at the wiring level is only that the tree asks the right module:
   * a `.md` and a `.ts` sitting side by side must not wear the same ink.
   */
  it('gives the files vam understands an ink of their own, and the rest the quiet grey', async () => {
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/README.md', '/work/atlas/index.ts', '/work/atlas/.env'],
        truncated: false,
      }),
    });
    await draw({ files: true });
    await openFiles();

    const ink = (path: string) =>
      row(path)?.querySelector('[data-file-icon]')?.getAttribute('class') ?? '';
    expect(ink('/work/atlas/README.md')).toContain('text-quote');
    expect(ink('/work/atlas/.env')).toContain('text-syn-string');
    expect(ink('/work/atlas/index.ts')).toContain('text-ink-faint');
    expect(ink('/work/atlas/README.md')).not.toBe(ink('/work/atlas/index.ts'));
  });

  it('filters the tree, keeping the directories that lead to a match', async () => {
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/.env', '/work/atlas/src/panels/FilesTab.tsx'],
        truncated: false,
      }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      fireEvent.change(q<HTMLInputElement>('[data-files-filter]') as HTMLInputElement, {
        target: { value: 'filestab' },
      });
      await Promise.resolve();
    });
    // Opened by the filter, with nothing expanded by hand: a filter that hid
    // its own matches behind a shut parent would have answered nothing.
    expect(rowPaths()).toEqual([
      '/work/atlas/src',
      '/work/atlas/src/panels',
      '/work/atlas/src/panels/FilesTab.tsx',
    ]);
    expect(q('[data-files-no-match]')).toBeNull();

    await act(async () => {
      fireEvent.change(q<HTMLInputElement>('[data-files-filter]') as HTMLInputElement, {
        target: { value: 'nothing-matches-this' },
      });
      await Promise.resolve();
    });
    expect(rowPaths()).toEqual([]);
    expect(q('[data-files-no-match]')?.textContent).toContain('No match');
  });

  it('shows the listing refusal in the source’s own words', async () => {
    withBridge({
      list: async () => Promise.reject(refusal('unknown-session', 'vam has no live session s1')),
    });
    await draw({ files: true });
    await openFiles();
    const note = q('[data-files-refusal="unknown-session"]');
    expect(note?.textContent).toContain('vam has no live session s1');
  });
});

describe('opening a file — the read side of all seven refusals', () => {
  it('binary content says what it is, with the size, and draws no textarea', async () => {
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/logo.png'],
        truncated: false,
      }),
      read: async () => ({ content: '', isBinary: true, signature: SIGNATURE({ size: 48_231 }) }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });
    const note = q('[data-files-binary]');
    expect(note?.textContent).toContain('binary');
    expect(note?.textContent).toContain('48,231');
    expect(q('[data-files-editor]')).toBeNull();
  });

  it('too-large says so with the size, in main’s own words, and draws no textarea', async () => {
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/huge.log'],
        truncated: false,
      }),
      read: async () =>
        Promise.reject(
          refusal('too-large', '/work/atlas/huge.log is 78643200 bytes, over the ceiling'),
        ),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });
    const note = q('[data-files-refusal="too-large"]');
    expect(note?.textContent).toContain('78643200 bytes');
    expect(q('[data-files-editor]')).toBeNull();
  });

  it('not-authorized reads exactly main’s own uniform refusal, never a hint about existence', async () => {
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/etc/passwd'], truncated: false }),
      read: async () =>
        Promise.reject(
          refusal(
            'not-authorized',
            '/etc/passwd is not yours to open — it is outside every live session’s own working directory',
          ),
        ),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });
    const note = q('[data-files-refusal="not-authorized"]');
    expect(note?.textContent).toContain('outside every live session');
    // Nothing here says "does not exist" or "exists but is unreadable" —
    // the whole point of the uniform refusal.
    expect(note?.textContent).not.toMatch(/exist/i);
  });

  it('not-found opens an empty, editable, NEW buffer — the "create a file" path', async () => {
    withBridge({
      list: async () => ({ root: '/work/atlas', files: [], truncated: false }),
      read: async () => Promise.reject(refusal('not-found', '/work/atlas/.env does not exist')),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      fireEvent.change(
        q<HTMLInputElement>('[aria-label="create a new file"]') as HTMLInputElement,
        {
          target: { value: '.env' },
        },
      );
      fireEvent.submit(q('[data-files-new]') as HTMLElement);
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]');
    expect(editor?.value).toBe('');
    expect(q('[data-files-path]')?.textContent).toContain('(new)');
  });
});

describe('changed-on-disk — the refusal that must not look like a failure', () => {
  it('keeps the operator’s own edit on screen and offers Reload rather than discarding anything', async () => {
    const write = vi.fn(async () =>
      Promise.reject(refusal('changed-on-disk', '.env changed under you')),
    );
    const read = vi.fn(async () => ({
      content: 'A=1',
      isBinary: false,
      signature: SIGNATURE(),
    }));
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }),
      read,
      write,
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });

    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=2 — my own edit' } });
    });
    await saveViaChord(editor);

    expect(q('[data-files-conflict]')?.textContent).toContain('changed on disk');
    // THE OPERATOR'S TEXT IS STILL THERE. This is the assertion that matters
    // most in the whole feature: a conflict must never look like the edit
    // vanished. The trailing `\n` is the save-time normaliser
    // (`files-save-normalize.ts`) adding the one final newline every save
    // attempt gets, whether or not the write itself lands — nothing else
    // about the operator's own text moved.
    expect(editor.value).toBe('A=2 — my own edit\n');

    // Reload discards it, but only because the operator explicitly asked.
    read.mockResolvedValueOnce({
      content: 'A=1\nB=agent-added-this',
      isBinary: false,
      signature: SIGNATURE({ sha256: 'new' }),
    });
    await act(async () => {
      q<HTMLButtonElement>('[data-files-reload]')?.click();
      await Promise.resolve();
    });
    // Re-queried, not the earlier `editor` reference: a reload passes through
    // a `loading` state (see `FilesTab.tsx`'s `Buffer` union), which replaces
    // the textarea element the same way opening a different file does.
    expect(q<HTMLTextAreaElement>('[data-files-editor]')?.value).toBe('A=1\nB=agent-added-this');
    expect(q('[data-files-conflict]')).toBeNull();
  });
});

describe('dirty state', () => {
  it('shows a dirty mark once the content differs from what was loaded, and clears it after a successful save', async () => {
    const write = vi.fn(
      async (): Promise<FileWriteResult> => ({ signature: SIGNATURE({ sha256: 'new' }) }),
    );
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }),
      read: async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE() }),
      write,
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    expect(q('[data-files-dirty]')).toBeNull();

    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=2' } });
    });
    expect(q('[data-files-dirty]')).not.toBeNull();
    // A NAME A SCREEN READER CAN SAY, not just a hue: the dot replaced a
    // labelled Save button, so it owes the operator its own accessible name.
    expect(q('[data-files-dirty]')?.getAttribute('aria-label')).toBe('unsaved changes');

    await saveViaChord(editor);
    // The save-time normaliser adds the one final newline every save gets
    // (`files-save-normalize.ts`) — `A=2` had none.
    expect(write).toHaveBeenCalledWith('/work/atlas/.env', 'A=2\n', SIGNATURE());
    expect(q('[data-files-dirty]')).toBeNull();
  });

  /**
   * SURVIVES SWITCHING BETWEEN FILES. Opening a second file and coming back
   * to the first must not have discarded its unsaved text — the "worst
   * outcome" the task brief names by name.
   */
  it('survives switching to a different file and back', async () => {
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/.env', '/work/atlas/README.md'],
        truncated: false,
      }),
      read: async (path: string) => ({
        content: path.endsWith('.env') ? 'A=1' : '# readme',
        isBinary: false,
        signature: SIGNATURE(),
      }),
    });
    await draw({ files: true });
    await openFiles();

    const openRow = async (path: string) => {
      await act(async () => {
        row(path)?.click();
        await Promise.resolve();
      });
    };

    await openRow('/work/atlas/.env');
    const envEditor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(envEditor, { target: { value: 'A=UNSAVED' } });
    });

    // Straight to the OTHER file — no trip through a list that hides this
    // one, because the tree never went away.
    await openRow('/work/atlas/README.md');
    expect(q<HTMLTextAreaElement>('[data-files-editor]')?.value).toBe('# readme');

    // Back to .env — the unsaved text must still be there.
    await openRow('/work/atlas/.env');
    expect(q<HTMLTextAreaElement>('[data-files-editor]')?.value).toBe('A=UNSAVED');
  });
});

/**
 * THE OPERATOR'S SAVE-TIME ASK: "trim spaces and create an empty line at the
 * bottom." `saveFile` (`FilesTab.tsx`) runs `normalizeForSave`
 * (`files-save-normalize.ts`, its own unit tests hold the behaviour table) on
 * `content` before it reaches `write` — this is the integration half: proof
 * that what actually goes out over the bridge, and what the editor shows
 * afterwards, is the normalised text, not the operator's raw keystrokes.
 */
describe('save-time normalisation', () => {
  it('trims trailing whitespace and collapses blank lines before writing, and updates the buffer to match', async () => {
    const write = vi.fn(
      async (): Promise<FileWriteResult> => ({ signature: SIGNATURE({ sha256: 'new' }) }),
    );
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/notes.txt'],
        truncated: false,
      }),
      read: async () => ({ content: 'kept', isBinary: false, signature: SIGNATURE() }),
      write,
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'a  \nb\t\n\n\n' } });
    });
    await saveViaChord(editor);

    expect(write).toHaveBeenCalledWith('/work/atlas/notes.txt', 'a\nb\n', SIGNATURE());
    // The buffer shows the NORMALISED text, not the operator's raw
    // keystrokes — the dirty dot has to clear against something, and it must
    // be what actually reached disk, or a reopened file would look dirty
    // against its own just-saved content.
    expect(editor.value).toBe('a\nb\n');
    expect(q('[data-files-dirty]')).toBeNull();
  });

  it('leaves an already-normalised file’s save untouched — no needless rewrite of a clean buffer', async () => {
    const write = vi.fn(
      async (): Promise<FileWriteResult> => ({ signature: SIGNATURE({ sha256: 'new' }) }),
    );
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/notes.txt'],
        truncated: false,
      }),
      read: async () => ({ content: 'a\nb\n', isBinary: false, signature: SIGNATURE() }),
      write,
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'a\nb\nc\n' } });
    });
    await saveViaChord(editor);

    expect(write).toHaveBeenCalledWith('/work/atlas/notes.txt', 'a\nb\nc\n', SIGNATURE());
    expect(editor.value).toBe('a\nb\nc\n');
  });
});

describe('the line-number gutter', () => {
  const openWith = async (content: string) => {
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }),
      read: async () => ({ content, isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true });
    await act(async () => {
      q<HTMLButtonElement>('[data-view="files"]')?.click();
      await Promise.resolve();
    });
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });
  };

  it('numbers every line of the file, one per line and no more', async () => {
    await openWith('A=1\nB=2\nC=3');
    expect(q('[data-files-gutter]')?.textContent).toBe('1\n2\n3');
  });

  it('counts a trailing newline as the line the caret would sit on', async () => {
    // A file ending in a newline has an empty last line, and an editor that
    // did not number it would put the caret on a row with no number beside
    // it -- the drift this whole gutter exists to avoid, one line early.
    await openWith('A=1\n');
    expect(q('[data-files-gutter]')?.textContent).toBe('1\n2');
  });

  it('shows a single number for an empty file, not an empty gutter', async () => {
    await openWith('');
    expect(q('[data-files-gutter]')?.textContent).toBe('1');
  });

  it('follows the text as it is typed, rather than only as it was loaded', async () => {
    await openWith('A=1');
    const editor = q<HTMLTextAreaElement>('[data-files-editor]');
    if (editor === null) throw new Error('no editor');
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=1\nB=2\nC=3\nD=4' } });
      await Promise.resolve();
    });
    expect(q('[data-files-gutter]')?.textContent).toBe('1\n2\n3\n4');
  });

  it('never wraps the text, because a wrapped line would put two rows against one number', async () => {
    // The one property the numbers cannot survive losing. Asserted on the
    // inline style rather than a computed layout because happy-dom lays
    // nothing out -- the browser half is a real measurement in
    // `e2e/files-tab-keyboard-shots.mjs`.
    await openWith('A=1');
    expect(q<HTMLTextAreaElement>('[data-files-editor]')?.style.whiteSpace).toBe('pre');
  });

  it('scrolls the numbers with the text, so they stay level in a long file', async () => {
    await openWith(Array.from({ length: 400 }, (_, i) => `line ${i + 1}`).join('\n'));
    const editor = q<HTMLTextAreaElement>('[data-files-editor]');
    const gutter = q<HTMLElement>('[data-files-gutter]');
    if (editor === null || gutter === null) throw new Error('no editor');
    await act(async () => {
      editor.scrollTop = 250;
      fireEvent.scroll(editor);
      await Promise.resolve();
    });
    // The WIRING, not the layout: happy-dom lays nothing out, so this proves
    // the handler carries the textarea's own offset across, which is the half
    // that can silently go missing. That the two columns then LOOK level is a
    // font-metric fact only a real browser can answer.
    expect(gutter.scrollTop).toBe(250);
  });

  it('keeps the gutter out of the accessibility tree and out of the keyboard path', async () => {
    await openWith('A=1\nB=2');
    const gutter = q('[data-files-gutter]');
    expect(gutter?.getAttribute('aria-hidden')).toBe('true');
    // Decoration only: it must never be an insert scope of its own, or
    // `cursorModeAt` would report Insert for a thing nobody can type into.
    expect(gutter?.hasAttribute('data-insert-scope')).toBe(false);
    expect(gutter?.hasAttribute('data-insert-stop')).toBe(false);
  });
});

describe('the keyboard model', () => {
  it('marks the editor as an insert scope while it is the showing tab', async () => {
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }),
      read: async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });
    expect(q('[data-files-editor][data-insert-scope]')).not.toBeNull();
  });

  it('Escape blurs the editor without touching its content', async () => {
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }),
      read: async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=UNSAVED' } });
    });
    editor.focus();
    expect(document.activeElement).toBe(editor);
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(document.activeElement).not.toBe(editor);
    expect(editor.value).toBe('A=UNSAVED');
  });

  it('Mod-[ blurs the editor the same way Escape does, without touching its content', async () => {
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }),
      read: async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    editor.focus();
    fireEvent.keyDown(editor, { key: '[', metaKey: true });
    expect(document.activeElement).not.toBe(editor);
    expect(editor.value).toBe('A=1');
  });

  it('Tab inserts an indent rather than moving focus off the textarea', async () => {
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }),
      read: async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(0, 0);
    fireEvent.keyDown(editor, { key: 'Tab' });
    expect(editor.value).toBe('  A=1');
    expect(document.activeElement).toBe(editor);
  });

  it('Mod-S saves without reaching the browser’s own save dialog', async () => {
    const write = vi.fn(
      async (): Promise<FileWriteResult> => ({ signature: SIGNATURE({ sha256: 'new' }) }),
    );
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }),
      read: async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE() }),
      write,
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=2' } });
    });
    await act(async () => {
      const event = new KeyboardEvent('keydown', {
        key: 's',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      editor.dispatchEvent(event);
      await Promise.resolve();
    });
    // The save-time normaliser adds the one final newline every save gets
    // (`files-save-normalize.ts`) — `A=2` had none.
    expect(write).toHaveBeenCalledWith('/work/atlas/.env', 'A=2\n', SIGNATURE());
  });

  /**
   * THE MARK COMES OFF WHILE ANOTHER TAB IS SHOWING, and this is the sibling
   * of the test above rather than a restatement of it: `FilesTab` is the one
   * tab that stays MOUNTED when it is not current (`DetailPanel.tsx`'s own
   * mount site -- unsaved text is why), and it is mounted EARLIER in the
   * pane's document order than the composer. `focusInsertStop` takes the
   * FIRST `STOP_SELECTOR` match in that order and focuses it blindly, so a
   * mark left on a `display: none` textarea would be found first, fail to
   * take focus, and make `I` refuse out loud on every OTHER tab -- for any
   * operator who had opened a file once. Nothing else in this suite would
   * notice: the editor would still be marked, still mounted, still correct
   * on its own tab.
   */
  it('takes the insert marks off once another tab is showing, so `I` still reaches the composer', async () => {
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }),
      read: async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });
    expect(q('[data-files-editor][data-insert-stop]')).not.toBeNull();

    await act(async () => {
      q<HTMLButtonElement>('[data-view="response"]')?.click();
      await Promise.resolve();
    });
    // Still mounted -- that is the whole point of the mount site.
    expect(q('[data-files-editor]')).not.toBeNull();
    // But no longer claiming the keyboard for a pane that is not showing it.
    expect(q('[data-files-editor][data-insert-scope]')).toBeNull();
    expect(q('[data-files-editor][data-insert-stop]')).toBeNull();
    // Asserted as the QUERY rather than as a real `.focus()` landing on
    // purpose: happy-dom will happily focus a `display: none` element, so a
    // focus-based assertion here would pass in this environment whether the
    // bug was present or not. The browser half lives in
    // `e2e/files-tab-keyboard-shots.mjs`.
    //
    // AND ASSERTED OVER THE WHOLE TAB, not over the textarea alone. This
    // check used to read `firstStop.hasAttribute('data-files-editor')`, which
    // answered the question only for the ONE element that carried a mark at
    // the time. The tree added a filter box and a "new file" box to this
    // hidden subtree; marking either of them AS A STOP — conditionally or not
    // — would put a `display: none` stop first in document order and make `I`
    // fail silently on every other tab, and the old assertion would have
    // passed, because the first stop still would not have been the editor.
    const firstStop = q('[data-question-option], [data-insert-stop]');
    expect(firstStop).not.toBeNull();
    expect(firstStop?.closest('[data-files]')).toBeNull();
    // The two boxes in the tree ARE insert scopes now — that is how `Mod-0`
    // gets the keyboard back out of them (`FilesTab.tsx`'s header carries the
    // argument and the measurement) — but they are scopes ONLY, and the scope
    // comes off with `hidden` exactly as the editor's does. So on a tab that
    // is not showing, this subtree carries no insert mark of any kind: no
    // `display: none` region can claim a mode, and no `display: none` stop can
    // swallow `I`.
    const boxes = qa('[data-files] input');
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      expect(box.hasAttribute('data-insert-scope')).toBe(false);
      expect(box.hasAttribute('data-insert-stop')).toBe(false);
    }
  });
});

/**
 * THE TREE'S OWN KEYBOARD.
 *
 * Every chord here is wired in `FilesTab.tsx` and decided in
 * `files-tree.ts`; `test/panels/files-tree.test.ts` proves the DECISIONS and
 * this proves the WIRING — that a real keystroke on a real row reaches them
 * and that what comes back actually moves focus, opens a file or redraws the
 * tree. Both halves are needed: a resolver nothing calls is as dead as a
 * handler that resolves nothing.
 */
describe('walking the tree from the keyboard', () => {
  const TREE = {
    list: async () => ({
      root: '/work/atlas',
      files: ['/work/atlas/.env', '/work/atlas/src/index.ts'],
      truncated: false,
    }),
    read: async (path: string) => ({
      content: path.endsWith('.env') ? 'A=1' : 'export {}',
      isBinary: false,
      signature: SIGNATURE(),
    }),
  };

  const openTree = async () => {
    withBridge(TREE);
    await draw({ files: true });
    await openFiles();
  };

  /** A bare key on whatever row the cursor is on. Returns `defaultPrevented`. */
  const press = async (key: string, init: KeyboardEventInit = {}): Promise<boolean> => {
    const target = (q<HTMLElement>('[data-files-cursor]') ??
      q<HTMLElement>('[role="tree"]')) as HTMLElement;
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    await act(async () => {
      target.dispatchEvent(event);
      await Promise.resolve();
    });
    return event.defaultPrevented;
  };

  it('starts with the cursor on the first row', async () => {
    await openTree();
    expect(cursor()).toBe('/work/atlas/src');
  });

  it('j and k walk the rows, stopping at the ends', async () => {
    await openTree();
    await press('j');
    expect(cursor()).toBe('/work/atlas/.env');
    await press('j');
    expect(cursor()).toBe('/work/atlas/.env');
    await press('k');
    expect(cursor()).toBe('/work/atlas/src');
    await press('k');
    expect(cursor()).toBe('/work/atlas/src');
  });

  /**
   * MUTATION TARGET: drop the `expand`/`collapse` cases out of
   * `onTreeKeyDown`, or make `resolveTreeKey` answer `null` for `l`/`h` on a
   * directory, and this reddens.
   */
  it('l opens the directory under the cursor and h shuts it again', async () => {
    await openTree();
    await press('l');
    expect(rowPaths()).toEqual(['/work/atlas/src', '/work/atlas/src/index.ts', '/work/atlas/.env']);
    await press('h');
    expect(rowPaths()).toEqual(['/work/atlas/src', '/work/atlas/.env']);
  });

  it('l steps into a directory that is already open, and h steps back out', async () => {
    await openTree();
    await press('l'); // open src
    await press('l'); // step into it
    expect(cursor()).toBe('/work/atlas/src/index.ts');
    await press('h'); // back out to the parent
    expect(cursor()).toBe('/work/atlas/src');
  });

  it('l on a file opens it in the editor without taking the keyboard off the tree', async () => {
    await openTree();
    await press('j'); // onto .env
    await press('l');
    expect(q<HTMLTextAreaElement>('[data-files-editor]')?.value).toBe('A=1');
    expect(document.activeElement?.getAttribute('data-files-row-path')).toBe('/work/atlas/.env');
  });

  it('Enter opens the file AND puts the caret in the editor', async () => {
    await openTree();
    await press('j');
    await press('Enter');
    expect(q<HTMLTextAreaElement>('[data-files-editor]')?.value).toBe('A=1');
    expect(document.activeElement).toBe(q('[data-files-editor]'));
  });

  /**
   * MUTATION TARGET: make the `Mod-Shift-e` branch in either `onEditorKeyDown`
   * or `onTreeKeyDown` a no-op and this reddens — in one direction each.
   */
  it('Mod-Shift-e moves the keyboard from the editor to the tree, and back again', async () => {
    await openTree();
    await press('j');
    await press('Enter');
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(editor);

    fireEvent.keyDown(editor, { key: 'e', metaKey: true, shiftKey: true });
    expect(document.activeElement?.getAttribute('data-files-row-path')).toBe('/work/atlas/.env');

    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: 'e',
      metaKey: true,
      shiftKey: true,
    });
    expect(document.activeElement).toBe(q('[data-files-editor]'));
  });

  it('Mod-Shift-e refuses out loud from the tree when no file is open', async () => {
    await openTree();
    const cursorRow = q<HTMLElement>('[data-files-cursor]') as HTMLElement;
    cursorRow.focus();
    fireEvent.keyDown(cursorRow, { key: 'e', metaKey: true, shiftKey: true });
    expect(q('[data-files-note]')?.textContent).toContain('no file is open');
  });

  it('h at the top of the tree refuses out loud rather than doing nothing', async () => {
    await openTree();
    await press('j'); // .env, a top-level file
    expect(await press('h')).toBe(true);
    expect(q('[data-files-note]')?.textContent).toMatch(/top of the tree/i);
    // And the refusal goes away the moment something does act.
    await press('k');
    expect(q('[data-files-note]')).toBeNull();
  });

  it('/ puts the caret in the filter box', async () => {
    await openTree();
    await press('/');
    expect(document.activeElement).toBe(q('[data-files-filter]'));
  });

  /**
   * SEARCHING FOR A FILE FROM ANYWHERE IN THE TAB — the operator's ask, and
   * the half `/` could never answer: `/` is a character you type into a file,
   * so with the caret in the editor there was no way to reach the filter at
   * all. `Mod-p` is `Cmd+P`, which is "go to file" in VS Code and Sublime, and
   * `chords.ts` left it deliberately unbound when new-project moved to
   * `Mod-Shift-p`.
   *
   * MUTATION TARGET: take `Mod-p` out of `TREE_KEYS` and the first of these
   * reddens; take it out of `EDITOR_KEYS` and the second does.
   */
  it('Mod-p puts the caret in the filter box from the tree, and claims the key', async () => {
    await openTree();
    expect(await press('p', { metaKey: true })).toBe(true);
    expect(document.activeElement).toBe(q('[data-files-filter]'));
  });

  it('Mod-p reaches the filter box from the editor, where / never could', async () => {
    await openTree();
    await press('j');
    await press('Enter');
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(editor);

    const event = new KeyboardEvent('keydown', {
      key: 'p',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      editor.dispatchEvent(event);
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(q('[data-files-filter]'));
    // Claimed, or the browser prints the page: over Tailscale Serve `Cmd+P`
    // is the print dialog, and it is cancelable rather than reserved.
    expect(event.defaultPrevented).toBe(true);
  });

  /**
   * A SECOND PRESS RESTARTS THE SEARCH rather than appending to a stale one.
   * `focus()` alone does NOT select — measured, not assumed — so this is the
   * guard on the `select()` beside it.
   *
   * MUTATION TARGET: drop `select()` from `focusFilter` and this reddens.
   */
  it('selects what is already in the box, so a second Mod-p restarts the search', async () => {
    await openTree();
    const box = q<HTMLInputElement>('[data-files-filter]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(box, { target: { value: 'env' } });
      await Promise.resolve();
    });
    box.focus();
    box.setSelectionRange(3, 3);

    const event = new KeyboardEvent('keydown', {
      key: 'p',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      box.dispatchEvent(event);
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, 3]);
    expect(event.defaultPrevented).toBe(true);
  });

  /** The filter box says which key gets to it, where an operator looking at
   *  the tree can read it — the feature existed and could not be found. */
  it('names its key in the filter box itself', async () => {
    // AS THE OPERATOR'S OWN KEYBOARD SPELLS IT: ⌘P on a Mac, Ctrl+P off one.
    // The token never reaches a placeholder — it is the internal spelling, and
    // this box is read by a person looking for the key to press.
    await onBothPlatformsAsync(async (mac) => {
      await openTree();
      const placeholder = q<HTMLInputElement>('[data-files-filter]')?.placeholder ?? '';
      expect(placeholder).toContain(chordSymbols('Mod-p', mac));
      expect(placeholder).not.toContain('Mod-p');
      cleanup();
    });
  });

  it('Enter in the filter box hands the keyboard to the first matching row', async () => {
    await openTree();
    const box = q<HTMLInputElement>('[data-files-filter]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(box, { target: { value: 'env' } });
      await Promise.resolve();
    });
    box.focus();
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
      await Promise.resolve();
    });
    expect(document.activeElement?.getAttribute('data-files-row-path')).toBe('/work/atlas/.env');
  });

  it('Escape hands the keyboard back to Select without leaving the tree behind', async () => {
    await openTree();
    const cursorRow = q<HTMLElement>('[data-files-cursor]') as HTMLElement;
    cursorRow.focus();
    fireEvent.keyDown(cursorRow, { key: 'Escape' });
    expect(document.activeElement).not.toBe(cursorRow);
    expect(q('[data-files-tree]')).not.toBeNull();
  });

  /**
   * THE HALF THAT KEEPS THE APP'S OWN GRAMMAR WORKING. `Canvas.tsx`'s window
   * listener stands down for a key the pane has already answered
   * (`event.defaultPrevented`) and for nothing else — so the tree must claim
   * exactly what it handles and leave the rest alone, or `Alt-<digit>`,
   * `Mod-k` and `I` would all go dead with the keyboard in here.
   */
  it('claims the keys it answers and leaves every other key to the grammar', async () => {
    await openTree();
    for (const key of ['j', 'k', 'l', 'h', 'Enter', '/']) {
      expect(await press(key), `${key} should be claimed`).toBe(true);
    }
    for (const key of ['x', 'i', 'G', '?']) {
      expect(await press(key), `${key} should be left alone`).toBe(false);
    }
  });

  /**
   * A TREE THAT ANNOUNCES ITSELF AS ONE. A nested tree read out as a flat
   * list of buttons is the one thing this whole change stopped it being for
   * anyone looking at the screen, and `aria-level` is how it stops being that
   * for anyone who is not. The role's own structural rule is checked
   * alongside it: `role="tree"` may own only `treeitem`s and `group`s, so the
   * notices this panel also draws ("Reading the directory…", "No match", the
   * truncation line) live OUTSIDE it and stay real text a screen reader
   * reaches.
   */
  it('announces the tree as a tree — depth, expansion and selection, with the notices outside it', async () => {
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/.env', '/work/atlas/src/panels/FilesTab.tsx'],
        truncated: false,
      }),
      read: async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      row('/work/atlas/src')?.click(); // open it
      await Promise.resolve();
    });

    const tree = q<HTMLElement>('[role="tree"]');
    expect(tree).not.toBeNull();
    // Only treeitems inside the tree — nothing else is a child of it.
    expect([...(tree?.children ?? [])].every((el) => el.getAttribute('role') === 'treeitem')).toBe(
      true,
    );
    expect(row('/work/atlas/src')?.getAttribute('aria-level')).toBe('1');
    expect(row('/work/atlas/src/panels')?.getAttribute('aria-level')).toBe('2');
    expect(row('/work/atlas/src')?.getAttribute('aria-expanded')).toBe('true');
    expect(row('/work/atlas/.env')?.hasAttribute('aria-expanded')).toBe(false);

    await act(async () => {
      row('/work/atlas/.env')?.click();
      await Promise.resolve();
    });
    expect(row('/work/atlas/.env')?.getAttribute('aria-selected')).toBe('true');
    expect(row('/work/atlas/src')?.getAttribute('aria-selected')).toBe('false');
  });

  /**
   * THE ROWS ARE NOT AN INSERT SCOPE — narrowed from "nothing in this column
   * is", which stopped being the claim when the two text boxes in the tree's
   * HEADER became scopes so `Mod-0` could get out of them (`FilesTab.tsx`'s
   * header). The boxes never had a bearing on this property: what makes bare
   * `j`/`k` free to mean "walk" is that the thing being walked is a list of
   * `<button>`s, and the assertion has to be about those.
   */
  it('the tree rows are not an insert scope — bare j and k could not mean "walk" if they were', async () => {
    await openTree();
    const rows = qa('[data-files-row]');
    expect(rows.length).toBeGreaterThan(0);
    for (const el of rows) {
      expect(el.hasAttribute('data-insert-scope')).toBe(false);
      expect(el.hasAttribute('data-insert-stop')).toBe(false);
      // Nor inside one: a row that merely SAT in a scope would report Insert
      // just the same, because the mode is `closest`, not `matches`.
      expect(el.closest('[data-insert-scope]')).toBeNull();
    }
    // The scroller and the `role="tree"` wrapper are not scopes either — a
    // mark on either would cover every row at once.
    expect(q('[role="tree"]')?.hasAttribute('data-insert-scope')).toBe(false);
  });
});

/**
 * `Mod-p` FROM SELECT MODE — the fifth surface, and the one the four handlers
 * could not see.
 *
 * THE OPERATOR'S REPORT, translated: "in the files view, in select mode, I
 * cannot press Cmd+P to filter". Select is the mode in which DOM focus is in
 * no insert scope (`keyboard/focus-scope.ts`), which is where the keyboard
 * actually IS on arrival: switching a pane to this tab leaves focus on the
 * view-icon button that switched it — MEASURED in Chromium, `<button
 * data-view="files" aria-label="Files view">` — and `Escape` leaves it on the
 * body. Neither is inside this tab at all, so none of the four `onKeyDown`
 * props ran, and the chord fell through to `Canvas.tsx`'s window grammar,
 * which leaves `Mod-p` unbound on purpose.
 *
 * SO THE TAB LISTENS FOR IT ITSELF, while it is the view on screen in the
 * pane that holds the keyboard, and routes it to the SAME `focusFilter` the
 * other four use.
 *
 * MUTATION TARGETS, each named beside the check it reddens.
 */
describe('Mod-p in select mode — with the keyboard on none of this tab’s own surfaces', () => {
  const TREE = {
    list: async () => ({
      root: '/work/atlas',
      files: ['/work/atlas/.env', '/work/atlas/src/index.ts'],
      truncated: false,
    }),
    read: async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE() }),
  };

  /**
   * The chord, pressed where the operator presses it: with nothing in this tab
   * focused, on an element that is not one of the four. It is dispatched on
   * the BODY and bubbles, which is what a real keystroke does — a listener
   * that read `event.target` rather than the DOM's own focus would pass a
   * `window.dispatchEvent` and fail in Chromium.
   */
  const pressOutside = async (): Promise<boolean> => {
    const event = new KeyboardEvent('keydown', {
      key: 'p',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      document.body.dispatchEvent(event);
      await Promise.resolve();
    });
    return event.defaultPrevented;
  };

  /** MUTATION TARGET: drop the tab's own window listener and this reddens. */
  it('reaches the filter box, and claims the key', async () => {
    withBridge(TREE);
    await draw({ files: true });
    await openFiles();
    expect(q('[data-files-filter]')).not.toBe(document.activeElement);

    expect(await pressOutside()).toBe(true);
    expect(document.activeElement).toBe(q('[data-files-filter]'));
  });

  /**
   * INERT WHILE ANOTHER TAB SHOWS — `chords.ts` vacated `Mod-p` deliberately,
   * so a tab that answered it whether or not it was on screen would have
   * taken a key the rest of the app is entitled to leave to the browser.
   *
   * MUTATION TARGET: drop the `hidden` half of the effect's guard and this
   * reddens — the filter is still in the DOM behind a `display: none`, so the
   * unconditional listener happily focuses something nobody can see.
   */
  it('does nothing at all once another tab is showing', async () => {
    withBridge(TREE);
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLButtonElement>('[data-view="response"]')?.click();
      await Promise.resolve();
    });

    expect(await pressOutside()).toBe(false);
    expect(document.activeElement).not.toBe(q('[data-files-filter]'));
  });

  /**
   * ONE PANE ANSWERS, NOT EVERY PANE. Two split leaves can both show this tab;
   * only the one holding the keyboard may move it, or a chord pressed in the
   * pane the operator is looking at lands in the one they are not.
   *
   * MUTATION TARGET: drop the `paneFocused` half of the guard and this
   * reddens.
   */
  it('does nothing in a pane that does not hold the keyboard', async () => {
    withBridge(TREE);
    await draw({ files: true, paneFocused: false, tabRequest: { tab: 'Files' } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(q('[data-files-tree]')).not.toBeNull();

    expect(await pressOutside()).toBe(false);
    expect(document.activeElement).not.toBe(q('[data-files-filter]'));
  });

  /**
   * AND IT STANDS DOWN FOR A CARET SOMEWHERE ELSE — the command palette's
   * filter, a rename field, another pane's composer. `answeringKeys`
   * (`keyboard/focus-scope.ts`) is the same question `Canvas.tsx` already asks
   * before it moves the keyboard on vam's own initiative, and the two
   * populations it reads are exactly the two that can hold a caret here.
   *
   * MUTATION TARGET: drop the `answeringKeys` clause and this reddens.
   */
  it('stands down while a caret outside this tab is answering the keys', async () => {
    withBridge(TREE);
    await draw({ files: true });
    await openFiles();

    const elsewhere = document.createElement('input');
    document.body.append(elsewhere);
    elsewhere.focus();
    try {
      const event = new KeyboardEvent('keydown', {
        key: 'p',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        elsewhere.dispatchEvent(event);
        await Promise.resolve();
      });
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(elsewhere);
    } finally {
      elsewhere.remove();
    }
  });

  /**
   * AND EVERY OTHER KEY IS STILL THE GRAMMAR'S. The listener is on the window,
   * which is where `Canvas.tsx`'s own is: one that claimed more than the one
   * chord would take `Mod-k`, `Alt-<digit>` and `I` away from the whole app
   * for as long as this tab happened to be showing.
   */
  it('claims Mod-p and nothing else', async () => {
    withBridge(TREE);
    await draw({ files: true });
    await openFiles();

    // NOT `Control+p`: its SPELLING is platform-dependent (`CTRL_GESTURES`),
    // so an assertion about it would say two different things on the two
    // platforms this suite runs on. `Mod-Shift-p` is the one next door that
    // matters — it is new-project, and this tab must not eat it.
    for (const init of [
      { key: 'k', metaKey: true },
      { key: 'p' },
      { key: 'p', metaKey: true, shiftKey: true },
    ]) {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      await act(async () => {
        document.body.dispatchEvent(event);
        await Promise.resolve();
      });
      expect(event.defaultPrevented, `${JSON.stringify(init)} should be left alone`).toBe(false);
    }
  });
});

/** Did anything veto the page going away? Shared with the quit tests below. */
const dispatchBeforeUnload = (): boolean => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('closing warns — the one exit dirty text cannot survive', () => {
  it('arms no warning while nothing is dirty', async () => {
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }),
      read: async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });
    expect(dispatchBeforeUnload()).toBe(false);
  });

  it('arms a warning the moment any buffer is dirty — even one the operator is not currently looking at', async () => {
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/.env', '/work/atlas/README.md'],
        truncated: false,
      }),
      read: async (path: string) => ({
        content: path.endsWith('.env') ? 'A=1' : '# readme',
        isBinary: false,
        signature: SIGNATURE(),
      }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      row('/work/atlas/.env')?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=UNSAVED' } });
    });
    // On to the OTHER file — the dirty .env buffer is no longer the one
    // showing, and the warning is about every buffer, not the visible one.
    await act(async () => {
      row('/work/atlas/README.md')?.click();
      await Promise.resolve();
    });
    expect(q<HTMLTextAreaElement>('[data-files-editor]')?.value).toBe('# readme');
    expect(dispatchBeforeUnload()).toBe(true);
  });

  it('disarms once the dirty buffer is saved', async () => {
    const write = vi.fn(
      async (): Promise<FileWriteResult> => ({ signature: SIGNATURE({ sha256: 'new' }) }),
    );
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }),
      read: async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE() }),
      write,
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=2' } });
    });
    expect(dispatchBeforeUnload()).toBe(true);
    await saveViaChord(editor);
    expect(dispatchBeforeUnload()).toBe(false);
  });
});

/* ===========================================================================
 * QUITTING — the exit `beforeunload` cannot reach.
 *
 * `beforeunload` is a PAGE hook: it covers the window closing. Cmd-Q reaches
 * `app.on('before-quit')` in main, where it has no standing at all, so the
 * fact has to cross the bridge. What is asserted here is the RENDERER's end of
 * that: this tab reports what it is holding, with a count and the names, and
 * corrects itself the moment a save makes it clean. `test/main/quit/` holds
 * the other end.
 *
 * Both mechanisms read the SAME derivation inside `FilesTab` -- that is the
 * property that keeps them from ever disagreeing about what is dirty -- so
 * these tests sit directly beneath the `beforeunload` ones on purpose.
 * ======================================================================== */
describe('quitting asks — what the Files tab tells main it is holding', () => {
  /** The listing and one readable file, plus a spy on the quit report. */
  function withReporter(files: readonly string[] = ['/work/atlas/.env']) {
    const reportUnsaved = vi.fn();
    withBridge({
      list: async () => ({ root: '/work/atlas', files: [...files], truncated: false }),
      read: async (path: string) => ({
        content: path.endsWith('.env') ? 'A=1' : '# readme',
        isBinary: false,
        signature: SIGNATURE(),
      }),
      write: async (): Promise<FileWriteResult> => ({ signature: SIGNATURE({ sha256: 'new' }) }),
      reportUnsaved,
    });
    return reportUnsaved;
  }

  const lastReport = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls.at(-1)?.[0] as { count: number; names: readonly string[] } | undefined;

  it('says "nothing" on mount — which is what corrects main after a reload', async () => {
    const reportUnsaved = withReporter();
    await draw({ files: true });
    await openFiles();
    expect(lastReport(reportUnsaved)).toEqual({ count: 0, names: [] });
  });

  it('NAMES the file, and counts it, the moment the buffer is dirty', async () => {
    const reportUnsaved = withReporter();
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      row('/work/atlas/.env')?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=UNSAVED' } });
    });
    // The label the tab itself draws, relative to the session's root -- never
    // the absolute path, which is what main would otherwise have to print.
    expect(lastReport(reportUnsaved)).toEqual({ count: 1, names: ['.env'] });
  });

  it('counts TWO as two and names both — a count fixed at one would be a lie in a modal', async () => {
    const reportUnsaved = withReporter(['/work/atlas/.env', '/work/atlas/README.md']);
    await draw({ files: true });
    await openFiles();
    for (const path of ['/work/atlas/.env', '/work/atlas/README.md']) {
      await act(async () => {
        row(path)?.click();
        await Promise.resolve();
      });
      const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
      await act(async () => {
        fireEvent.change(editor, { target: { value: `${path} UNSAVED` } });
      });
    }
    expect(lastReport(reportUnsaved)).toEqual({ count: 2, names: ['.env', 'README.md'] });
  });

  it('says "nothing" again once the buffer is saved', async () => {
    const reportUnsaved = withReporter();
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      row('/work/atlas/.env')?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=2' } });
    });
    expect(lastReport(reportUnsaved)).toEqual({ count: 1, names: ['.env'] });
    await saveViaChord(editor);
    expect(lastReport(reportUnsaved)).toEqual({ count: 0, names: [] });
  });

  it('does not report again for a keystroke into a file that was already dirty', async () => {
    // A push per character would put an IPC message on main's event loop for
    // every key typed into the editor. The set is what main needs, so the set
    // is what the effect watches.
    const reportUnsaved = withReporter();
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      row('/work/atlas/.env')?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=U' } });
    });
    const afterFirst = reportUnsaved.mock.calls.length;
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=UN' } });
    });
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=UNS' } });
    });
    expect(reportUnsaved.mock.calls.length).toBe(afterFirst);
  });

  it('stops speaking for a tab that has been unmounted', async () => {
    const reportUnsaved = withReporter();
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      row('/work/atlas/.env')?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=UNSAVED' } });
    });
    expect(lastReport(reportUnsaved)).toEqual({ count: 1, names: ['.env'] });
    // Closing the pane throws the text away in the renderer there and then.
    // Main must stop asking about it rather than block a quit over a buffer
    // that no longer exists.
    cleanup();
    expect(lastReport(reportUnsaved)).toEqual({ count: 0, names: [] });
  });

  it('reports nothing at all without the bridge member — the browser build has no app to quit', async () => {
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }),
      read: async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      row('/work/atlas/.env')?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=UNSAVED' } });
    });
    // No throw, and `beforeunload` is still armed: the two mechanisms read one
    // derivation, so the one that survives without a bridge still works.
    expect(dispatchBeforeUnload()).toBe(true);
  });
});

/* ===========================================================================
 * THE FORMATTER, THE COLOURS, AND THE TWO SETTINGS THAT GOVERN THEM.
 *
 * `files-format.ts` and `files-highlight.ts` are proven on their own, in their
 * own files, against strings. What can only be proven HERE is that the tab
 * actually calls them, draws all three of the formatter's answers, and -- the
 * one that matters most -- that a format the operator did not want is one
 * keystroke away from being undone. Losing typed text is the worst thing this
 * feature can do, and it is the same class of harm as `changed-on-disk`.
 * ======================================================================== */

/** Opens `path` with `content` on screen, and hands back its textarea. */
async function openFile(path: string, content: string): Promise<HTMLTextAreaElement> {
  withBridge({
    list: async () => ({ root: '/work/atlas', files: [path], truncated: false }),
    read: async () => ({ content, isBinary: false, signature: SIGNATURE() }),
  });
  await draw({ files: true });
  await openFiles();
  await act(async () => {
    row(path)?.click();
    await Promise.resolve();
  });
  const editor = q<HTMLTextAreaElement>('[data-files-editor]');
  if (editor === null) throw new Error(`no editor for ${path}`);
  return editor;
}

const note = (): string => q('[data-files-note]')?.textContent ?? '';

const pressFormat = async () => {
  await act(async () => {
    q<HTMLButtonElement>('[data-files-format]')?.click();
    await Promise.resolve();
  });
};

afterEach(() => {
  setActiveEditorSettings({ highlight: DEFAULT_EDITOR_HIGHLIGHT, indent: DEFAULT_EDITOR_INDENT });
});

describe('the formatter, as the tab presents it', () => {
  it('formats a JSON file in place', async () => {
    const editor = await openFile('/work/atlas/tsconfig.json', '{"a":1}');
    await pressFormat();
    expect(editor.value).toBe('{\n  "a": 1\n}\n');
  });

  it('follows the indent width the operator set', async () => {
    setActiveEditorSettings({ highlight: true, indent: 4 });
    const editor = await openFile('/work/atlas/tsconfig.json', '{"a":1}');
    await pressFormat();
    expect(editor.value).toBe('{\n    "a": 1\n}\n');
  });

  it('inserts that same width on Tab, so one setting governs both', async () => {
    setActiveEditorSettings({ highlight: true, indent: 4 });
    const editor = await openFile('/work/atlas/.env', 'A=1');
    editor.setSelectionRange(0, 0);
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'Tab' });
      await Promise.resolve();
    });
    expect(editor.value).toBe('    A=1');
  });

  /**
   * THE REFUSAL, ALOUD AND BY NAME. A control that cannot act says so: the
   * house rule this tab's other seven refusals already keep, and the one
   * thing a disabled button could never do.
   *
   * MUTATION TARGET: make the refusal branch `return` without setting a note
   * and this reddens -- which is the whole difference between refusing and
   * doing nothing.
   */
  it('refuses a file type it cannot prove, by name, rather than doing nothing', async () => {
    const editor = await openFile('/work/atlas/index.ts', 'const a=1\n');
    await pressFormat();
    expect(note()).toContain('.ts');
    expect(note()).toContain('.json');
    expect(editor.value).toBe('const a=1\n');
  });

  it('says a tidy file was already tidy rather than falling silent', async () => {
    const editor = await openFile('/work/atlas/tsconfig.json', '{\n  "a": 1\n}\n');
    await pressFormat();
    expect(note()).toMatch(/already/i);
    expect(editor.value).toBe('{\n  "a": 1\n}\n');
  });

  it('refuses invalid JSON with the parser’s own position', async () => {
    await openFile('/work/atlas/tsconfig.json', '{"a":1,}');
    await pressFormat();
    expect(note()).toMatch(/position \d+/);
  });

  it('leaves a .env assignment alone while tidying the blank runs around it', async () => {
    const editor = await openFile('/work/atlas/.env', 'A=1   \n\n\n\nB=2\n');
    await pressFormat();
    expect(editor.value).toBe('A=1   \n\nB=2\n');
  });

  it('makes the buffer dirty, so a format is a change the operator must save', async () => {
    await openFile('/work/atlas/tsconfig.json', '{"a":1}');
    expect(q('[data-files-dirty]')).toBeNull();
    await pressFormat();
    expect(q('[data-files-dirty]')).not.toBeNull();
  });
});

/**
 * THE UNDO, WHICH IS THE PART THIS FEATURE CANNOT SHIP WITHOUT.
 *
 * React drives this textarea's `value` as a controlled prop, so a format
 * REPLACES the whole value programmatically -- and a programmatic replace is
 * exactly what the browser's own undo stack does not record. Without something
 * here, `Mod-z` after a format would not give the operator their text back,
 * and a format is a whole-file change.
 *
 * So the undo is vam's own, explicit, and offered two ways: the key the
 * operator's hands already reach for, and a button in the note for the times
 * they do not. It is armed by a format and DISARMS ITSELF the moment the
 * buffer stops being exactly what that format produced -- so `Mod-z` after
 * typing is the browser's own undo of the typing, never a surprise reversal
 * of a format five minutes old.
 */
describe('undoing a format', () => {
  const modZ = (editor: HTMLTextAreaElement): boolean =>
    fireEvent.keyDown(editor, { key: 'z', metaKey: true });

  it('puts the file back exactly as it was, byte for byte', async () => {
    const before = '{"a":1,   "b":2}';
    const editor = await openFile('/work/atlas/tsconfig.json', before);
    await pressFormat();
    expect(editor.value).not.toBe(before);
    await act(async () => {
      modZ(editor);
      await Promise.resolve();
    });
    expect(editor.value).toBe(before);
  });

  it('offers the same undo as a button, for hands that are not on the editor', async () => {
    const before = '{"a":1,   "b":2}';
    const editor = await openFile('/work/atlas/tsconfig.json', before);
    await pressFormat();
    expect(q('[data-files-format-undo]')).not.toBeNull();
    await act(async () => {
      q<HTMLButtonElement>('[data-files-format-undo]')?.click();
      await Promise.resolve();
    });
    expect(editor.value).toBe(before);
    // And the offer goes with it: an undo of an undo is not a thing.
    expect(q('[data-files-format-undo]')).toBeNull();
  });

  it('swallows Mod-z only while it has a format to undo, so native undo still works', async () => {
    const editor = await openFile('/work/atlas/tsconfig.json', '{"a":1}');
    // Nothing formatted yet: the key is NOT ours, and must reach the browser.
    expect(modZ(editor), 'before any format').toBe(true);
    await pressFormat();
    let reachedTheBrowser = true;
    await act(async () => {
      reachedTheBrowser = modZ(editor);
      await Promise.resolve();
    });
    expect(reachedTheBrowser, 'with a format to undo').toBe(false);
    // And once undone, it is not ours again.
    expect(modZ(editor), 'after the undo').toBe(true);
  });

  it('stands down the moment the operator types, rather than reversing an old format', async () => {
    const editor = await openFile('/work/atlas/tsconfig.json', '{"a":1}');
    await pressFormat();
    const formatted = editor.value;
    await act(async () => {
      fireEvent.change(editor, { target: { value: `${formatted}  ` } });
      await Promise.resolve();
    });
    expect(q('[data-files-format-undo]')).toBeNull();
    expect(modZ(editor), 'typing has happened since the format').toBe(true);
    expect(editor.value).toBe(`${formatted}  `);
  });
});

describe('the highlight overlay', () => {
  /**
   * THE INVARIANT THE WHOLE TECHNIQUE RESTS ON: two layers, one text. A byte
   * of drift and every line after it is painted in the wrong place.
   *
   * WITH ONE MEASURED EXCEPTION, stated here exactly rather than loosely. A
   * `<pre>` gives the final `\n` of its text no line box and a `<textarea>`
   * does, so the overlay carries ONE extra newline when — and only when — the
   * file ends in one. That is not drift: it is the compensation that makes the
   * two columns the same HEIGHT, which `e2e/files-tab-keyboard-shots.mjs`
   * measures in the only engine that can lay it out.
   */
  it('draws the same characters as the textarea, for a file vam can tokenise', async () => {
    const editor = await openFile('/work/atlas/.env', 'A=1\n# note\nB="two"\n');
    const overlay = q('[data-files-highlight]');
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toBe(`${editor.value}\n`);
  });

  it('adds nothing at all to a file that does not end in a newline', async () => {
    const editor = await openFile('/work/atlas/.env', 'A=1\nB=2');
    expect(q('[data-files-highlight]')?.textContent).toBe(editor.value);
  });

  it('keeps following the text as it is typed', async () => {
    const editor = await openFile('/work/atlas/.env', 'A=1\n');
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=1\nB=2\nC=3\n' } });
      await Promise.resolve();
    });
    expect(q('[data-files-highlight]')?.textContent).toBe('A=1\nB=2\nC=3\n\n');
  });

  it('draws no overlay for a file type vam will not tokenise', async () => {
    await openFile('/work/atlas/index.ts', 'const a = /["]/\n');
    expect(q('[data-files-highlight]')).toBeNull();
  });

  /**
   * MUTATION TARGET, and the one the brief names: make the setting a no-op
   * (draw the overlay whatever `highlight` says) and this reddens.
   */
  it('draws no overlay at all when the operator turned highlighting off', async () => {
    setActiveEditorSettings({ highlight: false, indent: 2 });
    await openFile('/work/atlas/.env', 'A=1\n');
    expect(q('[data-files-highlight]')).toBeNull();
  });

  it('honours the setting immediately, without a remount', async () => {
    await openFile('/work/atlas/.env', 'A=1\n');
    expect(q('[data-files-highlight]')).not.toBeNull();
    await act(async () => {
      setActiveEditorSettings({ highlight: false, indent: 2 });
      await Promise.resolve();
    });
    expect(q('[data-files-highlight]')).toBeNull();
  });

  /**
   * THE TRAP THIS FILE HAS FALLEN INTO TWICE. `focusInsertStop` takes the
   * FIRST `data-insert-stop` in the pane in document order and focuses it
   * blindly, and `FilesTab` stays MOUNTED behind every other tab. The overlay
   * is drawn BEFORE the textarea in document order, so a mark on it would be
   * the first stop found -- and a `display: none` element cannot take focus,
   * so `I` would silently stop reaching the composer everywhere in the app.
   */
  it('is decoration only — never an insert scope, never in the keyboard path', async () => {
    await openFile('/work/atlas/.env', 'A=1\n');
    const overlay = q('[data-files-highlight]');
    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    expect(overlay?.hasAttribute('data-insert-scope')).toBe(false);
    expect(overlay?.hasAttribute('data-insert-stop')).toBe(false);
    // The editor is still the tab's ONE insert stop, and the overlay did not
    // become a second one.
    expect(qa('[data-files] [data-insert-stop]').length).toBe(1);
    expect(q('[data-files] [data-insert-stop]')?.hasAttribute('data-files-editor')).toBe(true);
  });
});

/* =========================================================================
 * THE TOOLBAR'S OWN WORDS.
 *
 * The operator asked for "a tooltip for the Save button and the formatter
 * button" first, and later for the Save button itself to go, replaced by an
 * indicator: "no Save button is needed there, just an indicator showing the
 * file is unsaved". Format had a `title`, which is the shape `panels/Note.tsx`
 * was written to replace and says why in its own header: a `title` opens on
 * HOVER and on nothing else, so on a keyboard-first tool the explanation was
 * unreadable to the operator it was written for. The dirty dot inherits that
 * same obligation now that it is what a hand reaching for Save's old tooltip
 * finds instead.
 *
 * So both are `Note`s, and these hold the things a later edit could quietly
 * undo: that no Save button is drawn at all, that each note exists and names
 * its chord (neither key is in the rebindable table -- `Mod-s` is `EDITOR_
 * KEYS`, hardcoded, and `Mod-Shift-f`/`Mod-z` the same, which is what makes
 * writing them out honest here rather than a lie waiting to happen), that no
 * `title` came back, and that wrapping added no element to a flex row.
 * ====================================================================== */

describe('the toolbar — no Save button, and the tooltips on what remains', () => {
  const noteOn = (selector: string): string | null =>
    q(selector)?.getAttribute('data-note') ?? null;

  it('draws no Save button — saving is Mod-s (or Mod-s from the preview) and the dot alone', async () => {
    await openFile('/work/atlas/.env', 'A=1\n');
    expect(q('[data-files-save]')).toBeNull();
  });

  it('gives the dirty indicator a note a keyboard can read, naming the chord that saves', async () => {
    await onBothPlatformsAsync(async (mac) => {
      const editor = await openFile('/work/atlas/.env', 'A=1\n');
      await act(async () => {
        fireEvent.change(editor, { target: { value: 'A=2' } });
      });
      const text = noteOn('[data-files-dirty]');
      expect(text).not.toBeNull();
      expect(text).toContain(chordSymbols('Mod-s', mac));
      expect(text).not.toContain('Mod-s');
      cleanup();
    });
  });

  /**
   * AND THE FORMAT NOTE QUOTES THE FORMATTER'S OWN OFFER rather than a second
   * copy of it. This button is never disabled -- pressing it on a `.ts` puts a
   * refusal on screen by name -- so what the tooltip owes the operator is the
   * SCOPE, and a hand-typed scope goes stale the first time the formatter
   * learns a file type. `FORMAT_OFFER` is the string every refusal already
   * ends with; this asserts the tooltip is built from that one and then
   * asserts a real refusal still carries it, so the two surfaces are one fact
   * rather than two that happen to agree today.
   */
  it('gives Format a note that quotes the same offer its refusals do', async () => {
    await onBothPlatformsAsync(async (mac) => {
      await openFile('/work/atlas/.env', 'A=1\n');
      const said = noteOn('[data-files-format]');
      expect(said).not.toBeNull();
      // The tooltip names two chords, and both are painted the way the
      // operator's keyboard makes them.
      expect(said).toContain(chordSymbols('Mod-Shift-f', mac));
      expect(said).toContain(chordSymbols('Mod-z', mac));
      expect(said).not.toContain('Mod-Shift-f');
      cleanup();
    });
    await openFile('/work/atlas/.env', 'A=1\n');
    const text = noteOn('[data-files-format]');
    expect(text).toContain(FORMAT_OFFER);

    cleanup();
    await openFile('/work/atlas/index.ts', 'export const a = 1\n');
    await pressFormat();
    expect(note()).toContain(FORMAT_OFFER);
  });

  /**
   * THE REGRESSION ITSELF. A `title` is not a failure that shows up in a
   * snapshot -- it works perfectly with a mouse -- so the only thing keeping
   * it from coming back is a check that looks for it.
   */
  it('uses no bare title on Format or the dirty indicator — the shape that was unreadable from the keyboard', async () => {
    const editor = await openFile('/work/atlas/.env', 'A=1\n');
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=2' } });
    });
    expect(q('[data-files-dirty]')?.getAttribute('title')).toBeNull();
    expect(q('[data-files-format]')?.getAttribute('title')).toBeNull();
  });

  /**
   * `Tooltip.Trigger asChild` ADDS NO ELEMENT -- `ShortcutTip`'s own header
   * states that as an invariant it depends on and does not enforce, and the
   * header row these controls sit in is a flex row whose spacing a wrapper
   * would change. So each must still be a DIRECT child of that row.
   */
  it('wraps neither Format nor the dirty indicator in an extra element — the header row is a flex row', async () => {
    const editor = await openFile('/work/atlas/.env', 'A=1\n');
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=2' } });
    });
    const children = [...(q('[data-files-header]')?.children ?? [])];
    expect(children.some((el) => el.hasAttribute('data-files-dirty'))).toBe(true);
    expect(children.some((el) => el.hasAttribute('data-files-format'))).toBe(true);
  });
});

/* =========================================================================
 * THE MARKDOWN PREVIEW.
 *
 * Operator: "a markdown preview in GitHub's format would be good. Switch
 * between preview and raw mode with one toggle button next to the formatter
 * button at the top."
 *
 * THE RENDERER IS `OUT_MARKDOWN`, the same component map the transcript
 * dresses an agent's answer with, and that is the load-bearing decision
 * rather than a saving. Both surfaces render text vam cannot vouch for; a
 * second map would be a second set of decisions about raw HTML, `a` and
 * `img`, and the second set is the one nobody re-derives. The `<script>`
 * check below is what says so out loud.
 *
 * THE OTHER HALF IS THE TEXT NOT BEING LOST. Toggling a view must not touch a
 * buffer -- not on the way in, not on the way out, and not when the operator
 * leaves for another file and comes back.
 * ====================================================================== */

/**
 * TOGGLES THE SEGMENTED CONTROL — presses whichever of the two buttons is
 * NOT currently selected, which is what every existing caller below means by
 * "press preview": the single-button toggle this replaced had only one
 * thing to click. `pressPreviewOption` presses a named side directly, for a
 * test that wants to press the button already showing (a no-op) or state
 * which side it means regardless of where the control started.
 */
const pressPreviewOption = async (option: 'preview' | 'raw') => {
  await act(async () => {
    q<HTMLButtonElement>(`[data-files-preview-option="${option}"]`)?.click();
    await Promise.resolve();
  });
};

const pressPreview = async () => {
  const state = q('[data-files-preview]')?.getAttribute('data-files-preview-state');
  await pressPreviewOption(state === 'preview' ? 'raw' : 'preview');
};

const MD = ['# Title', '', 'Some **bold** prose.', '', '- one', '- two', ''].join('\n');

describe('the markdown preview', () => {
  it('offers the toggle on a markdown file and on nothing else', async () => {
    await openFile('/work/atlas/README.md', MD);
    expect(q('[data-files-preview]')).not.toBeNull();
    cleanup();
    await openFile('/work/atlas/.env', 'A=1\n');
    expect(q('[data-files-preview]')).toBeNull();
    cleanup();
    await openFile('/work/atlas/index.ts', 'export const a = 1\n');
    expect(q('[data-files-preview]')).toBeNull();
  });

  it('swaps the raw editor for a rendered document, and back', async () => {
    await openFile('/work/atlas/README.md', MD);
    expect(q('[data-files-editor]')).not.toBeNull();
    expect(q('[data-files-preview-view]')).toBeNull();

    await pressPreview();
    expect(q('[data-files-editor]')).toBeNull();
    const view = q('[data-files-preview-view]');
    expect(view).not.toBeNull();
    expect(view?.querySelector('h1')?.textContent).toBe('Title');
    expect(view?.querySelector('strong')?.textContent).toBe('bold');
    expect(view?.querySelectorAll('li')).toHaveLength(2);

    await pressPreview();
    expect(q('[data-files-editor]')).not.toBeNull();
    expect(q('[data-files-preview-view]')).toBeNull();
  });

  it('renders GitHub-flavoured markdown, not the plain spec', async () => {
    // A table and a strikethrough are GFM and nothing else — if `remarkGfm`
    // were dropped from the plugin list, both would render as prose and this
    // is the only thing that would notice.
    await openFile(
      '/work/atlas/README.md',
      ['| a | b |', '| - | - |', '| 1 | 2 |', '', '~~struck~~', ''].join('\n'),
    );
    await pressPreview();
    const view = q('[data-files-preview-view]');
    expect(view?.querySelector('table')).not.toBeNull();
    expect(view?.querySelectorAll('th')).toHaveLength(2);
    expect(view?.querySelector('del')?.textContent).toBe('struck');
  });

  /**
   * THE WALL. A file in a session's working directory is very often an
   * agent's own output one step removed, and a preview is the first thing in
   * this tab that RENDERS rather than displays it. react-markdown drops
   * embedded HTML by default and `OUT_MARKDOWN` does not enable `rehype-raw`
   * — this asserts the result rather than the configuration, because a
   * configuration can be read and still be wrong about what reached the DOM.
   */
  it('renders raw HTML in the file as characters, never as DOM', async () => {
    await openFile(
      '/work/atlas/README.md',
      '<script>globalThis.__pwned = 1</script>\n\n<img src=x onerror="globalThis.__pwned = 2">\n',
    );
    await pressPreview();
    const view = q('[data-files-preview-view]');
    expect(view).not.toBeNull();
    expect(view?.querySelector('script')).toBeNull();
    expect(view?.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(view?.textContent).toContain('<script>');
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });

  /**
   * THE OTHER HALF OF THE WALL, AND THE ONE WITH TEETH IN AN ELECTRON WINDOW.
   *
   * `rehype-raw` being off stops HTML somebody WROTE as HTML. It does nothing
   * about a perfectly ordinary markdown LINK, which react-markdown renders as
   * a real `<a href>` by default — and in an Electron renderer a click on a
   * real anchor navigates THE WHOLE APP WINDOW away. The window is the
   * application: there is no back button, no other tab, and nothing on screen
   * to say what happened. The same for `<img>`, one step quieter: a rendered
   * image is a remote fetch that tells whoever wrote the file that this pane
   * opened, without anybody asking for it.
   *
   * `OUT_MARKDOWN`'s `a:` and `img:` overrides are what defuse both, and this
   * preview reuses them — that is the whole argument for sharing the map with
   * the transcript rather than writing a second one. What was MISSING until
   * this test is anything that would notice if the map were taken away.
   *
   * MEASURED AS THE RENDERED OUTCOME, NEVER AS THE PROP. Asserting that
   * `components={OUT_MARKDOWN}` is passed would be a fact about this file's
   * source text; the question is what reached the DOM.
   *
   * AND IT ASSERTS BOTH DIRECTIONS, because half of it is the easy half. "No
   * anchor" alone is satisfied by rendering NOTHING, which would be a worse
   * page than the bug: the destination has to still be READABLE, so an
   * operator can see where a link goes and copy it deliberately. Same for the
   * image's alt text, which is the only thing left of a picture vam will not
   * fetch.
   *
   * THIS IS THE MUTATION THAT FOUND IT: dropping `components={OUT_MARKDOWN}`
   * from the preview's own `<Markdown>` left all 1,338 tests in `test/panels`
   * green. The neighbouring `remarkGfm` check covers a FEATURE; this covers
   * the safety property sitting beside it.
   */
  it('defuses a link and an image — no anchor, no fetch, and the destination still readable', async () => {
    await openFile(
      '/work/atlas/README.md',
      [
        'See the [runbook](https://example.test/runbook) before deploying.',
        '',
        '![architecture diagram](https://example.test/arch.png)',
        '',
      ].join('\n'),
    );
    await pressPreview();
    const view = q('[data-files-preview-view]');
    expect(view).not.toBeNull();

    // NOTHING NAVIGABLE, and nothing that fetches. `a[href]` rather than `a`
    // because an anchor with no destination is harmless and is not what this
    // is about; `img` outright, because there is no such thing as a harmless
    // one here.
    expect(view?.querySelectorAll('a[href]')).toHaveLength(0);
    expect(view?.querySelectorAll('img')).toHaveLength(0);

    // AND THE READER LOSES NOTHING. Both the words and the address survive, so
    // "render nothing" cannot pass this.
    const text = view?.textContent ?? '';
    expect(text).toContain('runbook');
    expect(text).toContain('https://example.test/runbook');
    expect(text).toContain('architecture diagram');

    // THE THIRD DIRECTION, borrowed from the transcript's own version of this
    // guard (`DetailPanel.test.tsx`, "prints a link's address..."): the SYNTAX
    // is consumed. Without this, a preview that had stopped rendering
    // altogether and was showing the raw source would satisfy every
    // expectation above — no anchor, no image, and all three strings present.
    expect(text).not.toContain('](');
    expect(text).not.toContain('![');
  });

  /**
   * THE ONE THAT MATTERS MOST. A view toggle that loses an edit is worse than
   * no view toggle, and the buffer is the only thing holding the operator's
   * text — `buffers` survives a tab switch and a pane switch already, and the
   * preview must be exactly as harmless as those.
   */
  it('keeps unsaved text across raw → preview → raw, and previews the UNSAVED text', async () => {
    const editor = await openFile('/work/atlas/README.md', '# on disk\n');
    await act(async () => {
      fireEvent.change(editor, { target: { value: '# edited, never saved\n' } });
      await Promise.resolve();
    });
    expect(q('[data-files-dirty]')).not.toBeNull();

    await pressPreview();
    // The preview is of the BUFFER, not of what the bridge last read.
    expect(q('[data-files-preview-view]')?.querySelector('h1')?.textContent).toBe(
      'edited, never saved',
    );
    expect(q('[data-files-dirty]')).not.toBeNull();

    await pressPreview();
    expect(q<HTMLTextAreaElement>('[data-files-editor]')?.value).toBe('# edited, never saved\n');
  });

  it('keeps Save (Mod-s) reachable from the preview, and a save from there really lands', async () => {
    const write = vi.fn(async () => ({ signature: SIGNATURE({ sha256: 'next' }) }));
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/README.md'],
        truncated: false,
      }),
      read: async () => ({ content: '# a\n', isBinary: false, signature: SIGNATURE() }),
      write,
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      row('/work/atlas/README.md')?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]');
    await act(async () => {
      fireEvent.change(editor as HTMLTextAreaElement, { target: { value: '# b\n' } });
      await Promise.resolve();
    });
    await pressPreview();
    // No button to reach for any more — the textarea `Mod-s` used to answer
    // is genuinely unmounted here (`onPreviewKeyDown`'s own comment on why
    // that made a button the ONLY way to save from this view before it
    // answered the chord itself). `[data-files-preview-view]` is the element
    // that now carries it.
    const previewView = q<HTMLElement>('[data-files-preview-view]');
    expect(previewView).not.toBeNull();
    await saveViaChord(previewView as HTMLElement);
    expect(write).toHaveBeenCalledWith('/work/atlas/README.md', '# b\n', SIGNATURE());
    expect(q('[data-files-dirty]')).toBeNull();
  });

  it('shows the raw editor for a file that cannot be previewed, and remembers the mode', async () => {
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/README.md', '/work/atlas/.env'],
        truncated: false,
      }),
      read: async (path: string) => ({
        content: path.endsWith('.md') ? '# a\n' : 'A=1\n',
        isBinary: false,
        signature: SIGNATURE(),
      }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      row('/work/atlas/README.md')?.click();
      await Promise.resolve();
    });
    await pressPreview();
    expect(q('[data-files-preview-view]')).not.toBeNull();

    // A `.env` has no preview. The mode is not FORGOTTEN, only inapplicable.
    await act(async () => {
      row('/work/atlas/.env')?.click();
      await Promise.resolve();
    });
    expect(q('[data-files-preview-view]')).toBeNull();
    expect(q('[data-files-editor]')).not.toBeNull();

    await act(async () => {
      row('/work/atlas/README.md')?.click();
      await Promise.resolve();
    });
    expect(q('[data-files-preview-view]')).not.toBeNull();
  });

  it('says which mode it is in, to a pointer and to a screen reader alike', async () => {
    await onBothPlatformsAsync(async (mac) => {
      await openFile('/work/atlas/README.md', MD);
      const said = q('[data-files-preview]')?.getAttribute('data-note') ?? '';
      expect(said).toContain(chordSymbols('Mod-Shift-m', mac));
      expect(said).not.toContain('Mod-Shift-m');
      cleanup();
    });
    await openFile('/work/atlas/README.md', MD);
    const group = () => q('[data-files-preview]');
    const previewButton = () => q('[data-files-preview-option="preview"]');
    const rawButton = () => q('[data-files-preview-option="raw"]');
    expect(group()?.getAttribute('data-files-preview-state')).toBe('raw');
    expect(previewButton()?.getAttribute('aria-pressed')).toBe('false');
    expect(rawButton()?.getAttribute('aria-pressed')).toBe('true');
    await pressPreview();
    expect(group()?.getAttribute('data-files-preview-state')).toBe('preview');
    expect(previewButton()?.getAttribute('aria-pressed')).toBe('true');
    expect(rawButton()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows both labels of the segmented control, in words, not only as icons', async () => {
    await openFile('/work/atlas/README.md', MD);
    expect(q('[data-files-preview-option="preview"]')?.textContent).toContain('Preview');
    expect(q('[data-files-preview-option="raw"]')?.textContent).toContain('Raw');
  });
});

/* =========================================================================
 * THE DEFAULT — the operator's actual complaint. Translated: ".md files
 * need to be previewed GitHub-style, and there must be a button to switch
 * between preview mode and raw mode." The button already existed; nobody
 * found it, because it opened onto raw text every time. This is the one
 * behaviour that changed, and it is pinned here rather than left to the
 * `beforeEach` above, which exists PRECISELY so every other test in this
 * file can stay ignorant of it.
 * ====================================================================== */
describe('the default view for a freshly opened .md file', () => {
  /** `openFile`'s own body, minus the assertion that an editor exists — the
   *  one thing that assertion cannot survive when preview really is the
   *  default. Returns nothing; every test below reads the DOM itself. */
  async function openReadme(content: string) {
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/README.md'],
        truncated: false,
      }),
      read: async () => ({ content, isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      row('/work/atlas/README.md')?.click();
      await Promise.resolve();
    });
  }

  it('is preview, with the device default left untouched', async () => {
    setActiveFilesMarkdownView(DEFAULT_FILES_MARKDOWN_VIEW);
    await openReadme(MD);
    expect(q('[data-files-preview-view]')).not.toBeNull();
    expect(q('[data-files-editor]')).toBeNull();
    expect(q('[data-files-preview]')?.getAttribute('data-files-preview-state')).toBe('preview');
    expect(q('[data-files-preview-option="preview"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('is raw when the operator’s own last choice on this device was raw', async () => {
    setActiveFilesMarkdownView('raw');
    await openReadme(MD);
    expect(q('[data-files-editor]')).not.toBeNull();
    expect(q('[data-files-preview-view]')).toBeNull();
    expect(q('[data-files-preview]')?.getAttribute('data-files-preview-state')).toBe('raw');
  });

  it('is one click away either way — raw remains reachable from the new default', async () => {
    setActiveFilesMarkdownView(DEFAULT_FILES_MARKDOWN_VIEW);
    await openReadme(MD);
    await pressPreviewOption('raw');
    expect(q('[data-files-editor]')).not.toBeNull();
    expect(q('[data-files-preview-view]')).toBeNull();
  });
});

/* =========================================================================
 * PERSISTENCE — the operator's last choice, per device, survives past this
 * one mount. `FilesTab` itself never touches `localStorage`; it calls
 * `onFilesMarkdownView`, the same way `onFilesTreeWidth` already does for
 * the tree's width, and `Canvas.tsx` is the one place that ever writes it
 * for real (`prefs.ts`'s `setFilesMarkdownView`, covered on its own in
 * `test/prefs/prefs.files-markdown-view.test.ts`). What belongs here is only
 * the CALLBACK CONTRACT: which value it is handed, and when.
 * ====================================================================== */
describe('persisting the choice — the callback out to `Canvas.tsx`', () => {
  it('calls back with the mode just entered, on the button and on the chord alike', async () => {
    const onFilesMarkdownView = vi.fn();
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/README.md'],
        truncated: false,
      }),
      read: async () => ({ content: MD, isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true, onFilesMarkdownView });
    await openFiles();
    await act(async () => {
      row('/work/atlas/README.md')?.click();
      await Promise.resolve();
    });
    // The ambient default in this file is raw (this file's own `beforeEach`),
    // so the mode actually CHANGES on the way to preview, and changes back on
    // the way to raw — each press below is a real flip, not the side already
    // selected.
    onFilesMarkdownView.mockClear();
    await pressPreviewOption('preview');
    expect(onFilesMarkdownView).toHaveBeenCalledWith('preview');
    await pressPreviewOption('raw');
    expect(onFilesMarkdownView).toHaveBeenCalledWith('raw');
  });

  it('is never called by pressing the side already selected', async () => {
    const onFilesMarkdownView = vi.fn();
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/README.md'],
        truncated: false,
      }),
      read: async () => ({ content: MD, isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true, onFilesMarkdownView });
    await openFiles();
    await act(async () => {
      row('/work/atlas/README.md')?.click();
      await Promise.resolve();
    });
    // The default is raw in this file (the module-wide `beforeEach` above);
    // pressing "raw" again presses the side already showing.
    onFilesMarkdownView.mockClear();
    await pressPreviewOption('raw');
    expect(onFilesMarkdownView).not.toHaveBeenCalled();
  });

  it('withdraws quietly with no callback wired — the tab still toggles on its own state', async () => {
    await openFile('/work/atlas/README.md', MD);
    await expect(pressPreview()).resolves.toBeUndefined();
    expect(q('[data-files-preview-view]')).not.toBeNull();
  });
});

/* =========================================================================
 * THE GITHUB SCOPE — one marker, on the Files preview's own wrapper, that
 * `OUT_MARKDOWN`'s tree never carries. `test/panels/files-markdown.test.tsx`
 * holds the component map itself; this is the one integration point that
 * proves `FilesTab.tsx` really reaches for `FILES_MARKDOWN` rather than
 * `OUT_MARKDOWN` at the one call site that matters.
 * ====================================================================== */
describe('the Files preview carries its own GitHub-scoped wrapper', () => {
  it('marks the rendered document, and nothing about the raw editor', async () => {
    setActiveFilesMarkdownView(DEFAULT_FILES_MARKDOWN_VIEW);
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/README.md'],
        truncated: false,
      }),
      read: async () => ({ content: MD, isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      row('/work/atlas/README.md')?.click();
      await Promise.resolve();
    });
    const view = q('[data-files-preview-view]');
    expect(view?.querySelector('[data-files-markdown-github]')).not.toBeNull();
    await pressPreviewOption('raw');
    expect(q('[data-files-markdown-github]')).toBeNull();
  });

  /**
   * Operator report, translated: "the font size in preview mode is small —
   * use the same font size as the Response view." The wrapper is the ROOT
   * every size in `files-markdown.tsx`'s ladder is `em`-relative to (see
   * that file's own `HEADING_SIZE` comment), and it has to be the SAME
   * property the transcript's own `[data-detail-scroll="out"]` sets
   * (`--vam-out-font-size`) rather than a second, unrelated number, or the
   * two surfaces would only agree by coincidence at one setting.
   */
  it('pins its root to the same font-size property the transcript’s own out pane sets', async () => {
    setActiveFilesMarkdownView(DEFAULT_FILES_MARKDOWN_VIEW);
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/README.md'],
        truncated: false,
      }),
      read: async () => ({ content: MD, isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      row('/work/atlas/README.md')?.click();
      await Promise.resolve();
    });
    expect(q('[data-files-markdown-github]')?.className).toContain('--vam-out-font-size');
  });
});

describe('the preview’s keyboard — a control reachable only by mouse is not finished here', () => {
  it('toggles on Mod-Shift-m from the editor, and back from the preview itself', async () => {
    const editor = await openFile('/work/atlas/README.md', MD);
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'm', metaKey: true, shiftKey: true });
      await Promise.resolve();
    });
    const view = q<HTMLElement>('[data-files-preview-view]');
    expect(view).not.toBeNull();

    await act(async () => {
      fireEvent.keyDown(view as HTMLElement, { key: 'm', metaKey: true, shiftKey: true });
      await Promise.resolve();
    });
    expect(q('[data-files-editor]')).not.toBeNull();
    expect(q('[data-files-preview-view]')).toBeNull();
  });

  /**
   * THE WAY OUT. Every other surface in this tab answers Escape and `Mod-[`
   * by handing the keyboard back to Select; a read-only pane that swallowed
   * the keyboard would be the one place in here an operator could get stuck.
   */
  it('hands the keyboard back on Escape and on Mod-[', async () => {
    const editor = await openFile('/work/atlas/README.md', MD);
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'm', metaKey: true, shiftKey: true });
      await Promise.resolve();
    });
    const view = q<HTMLElement>('[data-files-preview-view]') as HTMLElement;
    view.focus();
    expect(document.activeElement).toBe(view);
    fireEvent.keyDown(view, { key: 'Escape' });
    expect(document.activeElement).not.toBe(view);

    view.focus();
    fireEvent.keyDown(view, { key: '[', metaKey: true });
    expect(document.activeElement).not.toBe(view);
  });

  it('moves across to the tree on the same chord the editor uses', async () => {
    const editor = await openFile('/work/atlas/README.md', MD);
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'm', metaKey: true, shiftKey: true });
      await Promise.resolve();
    });
    const view = q<HTMLElement>('[data-files-preview-view]') as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(view, { key: 'e', metaKey: true, shiftKey: true });
      await Promise.resolve();
    });
    expect((document.activeElement as HTMLElement).hasAttribute('data-files-row')).toBe(true);
  });

  it('is reachable by Tab — it is the only thing in the editor column', async () => {
    const editor = await openFile('/work/atlas/README.md', MD);
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'm', metaKey: true, shiftKey: true });
      await Promise.resolve();
    });
    expect(q('[data-files-preview-view]')?.getAttribute('tabindex')).toBe('0');
  });

  /**
   * AND IT IS NOT AN INSERT SCOPE. The preview is a `<div>`, not a text box —
   * the status bar must not call it Insert, and `focusInsertStop` must not
   * land `I` on it. With the textarea gone, this tab has NO insert stop at
   * all while previewing, which is the honest answer: there is nothing here
   * to type into, so `I` belongs to the composer.
   */
  it('is not an insert scope, and leaves the tab with no insert stop at all', async () => {
    const editor = await openFile('/work/atlas/README.md', MD);
    expect(qa('[data-files] [data-insert-stop]')).toHaveLength(1);
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'm', metaKey: true, shiftKey: true });
      await Promise.resolve();
    });
    const view = q('[data-files-preview-view]');
    expect(view?.hasAttribute('data-insert-scope')).toBe(false);
    expect(view?.hasAttribute('data-insert-stop')).toBe(false);
    expect(qa('[data-files] [data-insert-stop]')).toHaveLength(0);
  });

  /**
   * ENTER ON A TREE ROW MEANS "open it and put me in it", and in preview mode
   * the thing to be put in is the preview. A flag left armed for a textarea
   * that is never going to exist would steal the keyboard the next time one
   * did — the same trap the loading-buffer branch beside it was written for.
   */
  it('takes the keyboard when a file is opened from the tree into it', async () => {
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/README.md', '/work/atlas/CHANGELOG.md'],
        truncated: false,
      }),
      read: async () => ({ content: '# a\n', isBinary: false, signature: SIGNATURE() }),
    });
    await draw({ files: true });
    await openFiles();
    await act(async () => {
      row('/work/atlas/README.md')?.click();
      await Promise.resolve();
    });
    await pressPreview();
    const cursorRow = q<HTMLElement>('[data-files-cursor]') as HTMLElement;
    cursorRow.focus();
    await act(async () => {
      fireEvent.keyDown(cursorRow, { key: 'Enter' });
      await Promise.resolve();
    });
    expect(document.activeElement?.hasAttribute('data-files-preview-view')).toBe(true);
  });
});
