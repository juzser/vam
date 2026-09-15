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

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  FileListResult,
  FileReadResult,
  FileSignature,
  FileWriteResult,
} from '../../src/main/files/types.js';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import {
  DEFAULT_EDITOR_HIGHLIGHT,
  DEFAULT_EDITOR_INDENT,
  setActiveEditorSettings,
} from '../../src/renderer/prefs/editor.js';

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
  icon: null,
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
      },
    },
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'api');
});

function draw(over: Partial<DetailPanelProps> = {}) {
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
}

const openFiles = async () => {
  await act(async () => {
    q<HTMLButtonElement>('[data-view="files"]')?.click();
    await Promise.resolve();
  });
};

describe('the Files tab is withdrawn until a caller confirms the desktop bridge', () => {
  it('draws no Files icon when the files prop is absent', () => {
    draw({ files: undefined });
    expect(q('[data-view="files"]')).toBeNull();
  });

  it('draws no Files icon when files is explicitly false', () => {
    draw({ files: false });
    expect(q('[data-view="files"]')).toBeNull();
  });

  it('draws the Files icon once a caller has confirmed the bridge', () => {
    withBridge({});
    draw({ files: true });
    expect(q('[data-view="files"]')).not.toBeNull();
  });
});

describe('no session focused', () => {
  it('says so, plainly, rather than showing an empty list', async () => {
    withBridge({});
    draw({ entry: null, files: true });
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
    draw({ files: true });
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
    draw({ files: true });
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
    draw({ files: true });
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

  it('filters the tree, keeping the directories that lead to a match', async () => {
    withBridge({
      list: async () => ({
        root: '/work/atlas',
        files: ['/work/atlas/.env', '/work/atlas/src/panels/FilesTab.tsx'],
        truncated: false,
      }),
    });
    draw({ files: true });
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
    draw({ files: true });
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
    draw({ files: true });
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
    draw({ files: true });
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
    draw({ files: true });
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
    draw({ files: true });
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
    draw({ files: true });
    await openFiles();
    await act(async () => {
      q<HTMLElement>('[data-files-row]')?.click();
      await Promise.resolve();
    });

    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=2 — my own edit' } });
    });
    await act(async () => {
      q<HTMLButtonElement>('[data-files-save]')?.click();
      await Promise.resolve();
    });

    expect(q('[data-files-conflict]')?.textContent).toContain('changed on disk');
    // THE OPERATOR'S TEXT IS STILL THERE. This is the assertion that matters
    // most in the whole feature: a conflict must never look like the edit
    // vanished.
    expect(editor.value).toBe('A=2 — my own edit');

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
    draw({ files: true });
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

    await act(async () => {
      q<HTMLButtonElement>('[data-files-save]')?.click();
      await Promise.resolve();
    });
    expect(write).toHaveBeenCalledWith('/work/atlas/.env', 'A=2', SIGNATURE());
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
    draw({ files: true });
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

describe('the line-number gutter', () => {
  const openWith = async (content: string) => {
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }),
      read: async () => ({ content, isBinary: false, signature: SIGNATURE() }),
    });
    draw({ files: true });
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
    draw({ files: true });
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
    draw({ files: true });
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
    draw({ files: true });
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
    draw({ files: true });
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
    draw({ files: true });
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
    expect(write).toHaveBeenCalledWith('/work/atlas/.env', 'A=2', SIGNATURE());
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
    draw({ files: true });
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
    // hidden subtree; marking either of them — conditionally or not — would
    // put a `display: none` stop first in document order and make `I` fail
    // silently on every other tab, and the old assertion would have passed,
    // because the first stop still would not have been the editor.
    const firstStop = q('[data-question-option], [data-insert-stop]');
    expect(firstStop).not.toBeNull();
    expect(firstStop?.closest('[data-files]')).toBeNull();
    // The two boxes in the tree are not insert surfaces at all, showing or
    // hidden: a native `input` is already exempt from the chord grammar by
    // tag name, and the marks are for what the STATUS BAR must call Insert.
    for (const box of qa('[data-files] input')) {
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
    draw({ files: true });
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
    draw({ files: true });
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

  it('the tree is not an insert scope — bare j and k could not mean "walk" if it were', async () => {
    await openTree();
    expect(q('[data-files-tree] [data-insert-scope]')).toBeNull();
    expect(q('[data-files-row][data-insert-scope]')).toBeNull();
    expect(q('[data-files-row][data-insert-stop]')).toBeNull();
  });
});

describe('closing warns — the one exit dirty text cannot survive', () => {
  const dispatchBeforeUnload = (): boolean => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('arms no warning while nothing is dirty', async () => {
    withBridge({
      list: async () => ({ root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }),
      read: async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE() }),
    });
    draw({ files: true });
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
    draw({ files: true });
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
    draw({ files: true });
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
    await act(async () => {
      q<HTMLButtonElement>('[data-files-save]')?.click();
      await Promise.resolve();
    });
    expect(dispatchBeforeUnload()).toBe(false);
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
  draw({ files: true });
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
