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

describe('the file list', () => {
  it('lists what the bridge answers, dotfiles included, and lets the operator pick one', async () => {
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

    const rows = qa<HTMLElement>('[data-files-row]');
    const labels = rows.map((row) => row.textContent);
    expect(labels.some((text) => text?.includes('.env'))).toBe(true);
    expect(labels.some((text) => text?.includes('src/index.ts'))).toBe(true);
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
      const rows = qa<HTMLElement>('[data-files-row-path]');
      const row = rows.find((r) => r.getAttribute('data-files-row-path') === path);
      await act(async () => {
        row?.click();
        await Promise.resolve();
      });
    };

    await openRow('/work/atlas/.env');
    const envEditor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(envEditor, { target: { value: 'A=UNSAVED' } });
    });

    // Back to the list, open the OTHER file.
    await act(async () => {
      q<HTMLButtonElement>('[aria-label="back to the file list"]')?.click();
      await Promise.resolve();
    });
    await openRow('/work/atlas/README.md');
    expect(q<HTMLTextAreaElement>('[data-files-editor]')?.value).toBe('# readme');

    // Back to .env — the unsaved text must still be there.
    await act(async () => {
      q<HTMLButtonElement>('[aria-label="back to the file list"]')?.click();
      await Promise.resolve();
    });
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
    const firstStop = q('[data-question-option], [data-insert-stop]');
    expect(firstStop).not.toBeNull();
    expect(firstStop?.hasAttribute('data-files-editor')).toBe(false);
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
      const rows = qa<HTMLElement>('[data-files-row-path]');
      rows.find((r) => r.getAttribute('data-files-row-path')?.endsWith('.env'))?.click();
      await Promise.resolve();
    });
    const editor = q<HTMLTextAreaElement>('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(editor, { target: { value: 'A=UNSAVED' } });
    });
    // Back to the list — the dirty .env buffer is no longer the one showing.
    await act(async () => {
      q<HTMLButtonElement>('[aria-label="back to the file list"]')?.click();
      await Promise.resolve();
    });
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
