// @vitest-environment happy-dom

/** EC-26b: muted rows in the Files tree; EC-27: Preview/Raw and Tidy live in the content strip. */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FileDirResult } from '../../src/main/files/types.js';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';
import { resetUnsavedRegistry } from '../../src/renderer/panels/unsaved-files.js';
import { setActiveFilesMarkdownView } from '../../src/renderer/prefs/files-markdown-view.js';

const DECISION: Decision = { id: 'd1', label: 's', input: 'a', output: 'b', commands: [] };
const SESSION: Session = {
  id: 's1',
  title: 't',
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '1m',
  decisions: [DECISION],
};
const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ROOT = '/work/atlas';
const TREE: Record<string, FileDirResult['entries']> = {
  '': [
    { name: '.env', kind: 'file' },
    { name: '.github', kind: 'dir' },
    { name: 'node_modules', kind: 'dir' },
    { name: 'build', kind: 'dir', ignored: true },
    { name: 'debug.log', kind: 'file', ignored: true },
    { name: 'src', kind: 'dir' },
    { name: 'README.md', kind: 'file' },
  ],
  build: [{ name: 'out.js', kind: 'file' }],
  node_modules: [{ name: 'pkg', kind: 'dir' }],
  'node_modules/pkg': [{ name: 'index.js', kind: 'file' }],
  src: [{ name: 'index.ts', kind: 'file' }],
};

beforeEach(() => setActiveFilesMarkdownView('raw'));
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'api');
  resetUnsavedRegistry();
});

const row = (path: string) =>
  document.querySelector(`[data-files-row-path="${ROOT}/${path}"]`) as HTMLElement;
const cls = (path: string) => row(path).className.split(' ');
const muted = (path: string) => row(path).hasAttribute('data-files-row-muted');
const click = (path: string) =>
  act(async () => {
    row(path).click();
    await Promise.resolve();
  });

const q = (sel: string) => document.querySelector<HTMLElement>(sel);

async function mount(tree = TREE, content = '# hi\n') {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      files: {
        list: async (_id: string, dir?: string) => ({
          root: ROOT,
          dir: dir === '' || dir === undefined ? ROOT : `${ROOT}/${dir}`,
          entries: tree[dir ?? ''] ?? [],
        }),
        read: async () => ({
          content,
          isBinary: false,
          signature: { size: 1, mtimeMs: 1, sha256: 'a' },
        }),
        write: async () => Promise.reject(new Error('no write')),
      },
    },
  });
  render(
    <DetailPanel
      entry={{ project: PROJECT, session: SESSION }}
      decision={DECISION}
      draft=""
      onDraftChange={() => {}}
      onSubmit={() => {}}
      composing={false}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={false}
      actionIndex={0}
      width={408}
      resizeHandle={null}
      files
    />,
  );
  await waitFor(() => expect(document.querySelector('[data-files]')).not.toBeNull(), {
    timeout: 10_000,
  });
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-view="files"]')?.click();
    await Promise.resolve();
  });
}

describe('muted rows in the Files tree', () => {
  it('mutes dot names, node_modules and git-ignored entries only, in one grey', async () => {
    await mount();
    for (const [name, on] of Object.entries({
      '.env': true,
      '.github': true,
      node_modules: true,
      build: true,
      'debug.log': true,
      src: false,
      'README.md': false,
    })) {
      expect(muted(name), name).toBe(on);
      // The row under the keyboard cursor reads full ink instead (asserted below).
      const cursor = row(name).hasAttribute('data-files-cursor');
      expect(cls(name).includes('text-ink-faint'), name).toBe(on && !cursor);
      // The glyph inherits the row's ink instead of keeping its family hue.
      expect(row(name).querySelector('[class*="text-inherit"]') !== null, name).toBe(on);
    }
  });

  it('mutes children of a muted directory, inside node_modules and an ignored dir', async () => {
    await mount();
    for (const p of ['build', 'node_modules', 'node_modules/pkg', 'src']) await click(p);
    for (const p of ['build/out.js', 'node_modules/pkg', 'node_modules/pkg/index.js'])
      expect(muted(p), p).toBe(true);
    expect(muted('src/index.ts')).toBe(false);
  });

  it('a muted file still opens on click and takes the keyboard cursor', async () => {
    await mount();
    await click('.env');
    expect(document.querySelector('[data-files-editor]')).not.toBeNull();
    expect(row('.env').hasAttribute('data-files-row-active')).toBe(true);
    expect(cls('.env')).toContain('text-ink');
    expect(cls('.env')).not.toContain('text-ink-faint');
    await act(async () => {
      fireEvent.keyDown(document.querySelector('[role="tree"]') as HTMLElement, { key: 'j' });
      await Promise.resolve();
    });
    expect(document.querySelector('[data-files-cursor]')).toBe(row('debug.log'));
    expect(muted('debug.log')).toBe(true);
  });
});

async function mountOne(name: string, open = true, content?: string) {
  await mount({ '': [{ name, kind: 'file' }] }, content);
  if (open) await click(name);
}

describe('the content controls strip', () => {
  it('holds both controls, right-aligned with a gap, outside the header and tree', async () => {
    await mountOne('notes.md');
    const strip = q('[data-files-content-controls]') as HTMLElement;
    const toggle = q('[data-files-preview]') as HTMLElement;
    const tidy = q('[data-files-format]') as HTMLElement;
    expect(q('[data-files-editor-column]')?.contains(strip)).toBe(true);
    expect(strip.contains(toggle) && strip.contains(tidy)).toBe(true);
    for (const outside of ['[data-files-header]', '[data-files-tree]'])
      expect(q(outside)?.contains(toggle) || q(outside)?.contains(tidy)).toBe(false);
    const stripCls = strip.className.split(' ');
    expect(stripCls).toContain('justify-end');
    expect(stripCls).toContain('gap-1.5');
    const kids = [...strip.children];
    const at = (el: HTMLElement) => kids.findIndex((k) => k === el || k.contains(el));
    expect(at(toggle)).toBeGreaterThanOrEqual(0);
    expect(at(toggle)).toBeLessThan(at(tidy));
    // Direct children (or wrappers) carry no negative margin.
    const negMargin = /^-m[xylrtb]?-/;
    for (const el of [toggle, tidy, kids[at(toggle)] as HTMLElement, kids[at(tidy)] as HTMLElement])
      expect(el.className.split(' ').some((c) => negMargin.test(c))).toBe(false);
  });

  it('a non-markdown file shows only Tidy; with no file open neither renders', async () => {
    await mountOne('.env');
    expect(q('[data-files-preview]')).toBeNull();
    expect(q('[data-files-content-controls]')?.contains(q('[data-files-format]'))).toBe(true);
    cleanup();
    await mountOne('notes.md', false);
    for (const sel of ['content-controls', 'preview', 'format'])
      expect(q(`[data-files-${sel}]`), sel).toBeNull();
  });

  it('the Mod-Shift-m chord still toggles the preview', async () => {
    await mountOne('notes.md');
    const editor = q('[data-files-editor]') as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'm', metaKey: true, shiftKey: true });
      fireEvent.keyDown(editor, { key: 'm', ctrlKey: true, shiftKey: true });
      await Promise.resolve();
    });
    expect(q('[data-files-preview]')?.getAttribute('data-files-preview-state')).toBe('preview');
  });
});

describe('muted row under the keyboard cursor', () => {
  it('reads as the cursor row: text-ink, never text-ink-faint; off-cursor it stays faint', async () => {
    await mount();
    const tree = document.querySelector('[role="tree"]') as HTMLElement;
    const key = (k: string) =>
      act(async () => {
        fireEvent.keyDown(tree, { key: k });
        await Promise.resolve();
      });
    await key('j');
    expect(document.querySelector('[data-files-cursor]')).toBe(row('build'));
    expect(cls('build')).toContain('text-ink');
    expect(cls('build')).not.toContain('text-ink-faint');
    expect(cls('node_modules')).toContain('text-ink-faint');
    expect(cls('node_modules')).not.toContain('text-ink');
  });
});

describe('the Mod-Shift-f chord with the controls in the strip', () => {
  it('runs Tidy on the open file', async () => {
    await mountOne('a.json', true, '{"a":1}');
    const editor = q('[data-files-editor]') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'f', metaKey: true, shiftKey: true });
      fireEvent.keyDown(editor, { key: 'f', ctrlKey: true, shiftKey: true });
      await Promise.resolve();
    });
    expect(editor.value).toBe('{\n  "a": 1\n}\n');
  });
});
