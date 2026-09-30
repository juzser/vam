// @vitest-environment happy-dom

/** EC-27: Preview/Raw and Tidy live in the content strip, not the header. */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
const q = (s: string) => document.querySelector<HTMLElement>(s);

beforeEach(() => setActiveFilesMarkdownView('raw'));
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'api');
  resetUnsavedRegistry();
});

/** Mounts the Files tab over one file; opens it unless `open` is false. */
async function mount(file: string, open = true) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      files: {
        list: async (_id: string, dir?: string) => ({
          root: '/work/atlas',
          dir: '/work/atlas',
          entries: dir === undefined ? [] : [{ name: file, kind: 'file' }],
        }),
        read: async () => ({
          content: '# hi\n',
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
  await waitFor(
    () => {
      if (!q('[data-files]')) throw new Error('pending');
    },
    { timeout: 10_000 },
  );
  await act(async () => {
    q('[data-view="files"]')?.click();
    await Promise.resolve();
  });
  if (open) {
    await act(async () => {
      q(`[data-files-row-path="/work/atlas/${file}"]`)?.click();
      await Promise.resolve();
    });
  }
}

describe('the content controls strip', () => {
  it('holds both controls, right-aligned with a gap, outside the header and tree', async () => {
    await mount('notes.md');
    const strip = q('[data-files-content-controls]') as HTMLElement;
    const toggle = q('[data-files-preview]') as HTMLElement;
    const tidy = q('[data-files-format]') as HTMLElement;
    expect(q('[data-files-editor-column]')?.contains(strip)).toBe(true);
    expect(strip.contains(toggle) && strip.contains(tidy)).toBe(true);
    for (const outside of ['[data-files-header]', '[data-files-tree]']) {
      expect(q(outside)?.contains(toggle) ?? false).toBe(false);
      expect(q(outside)?.contains(tidy) ?? false).toBe(false);
    }
    expect(strip.className).toContain('justify-end');
    expect(strip.className).toContain('gap-1.5');
    expect(strip.className).not.toMatch(/-m[lrxtb]?-/);
    const kids = [...strip.children];
    const at = (el: HTMLElement) => kids.findIndex((k) => k === el || k.contains(el));
    expect(at(toggle)).toBeGreaterThanOrEqual(0);
    expect(at(toggle)).toBeLessThan(at(tidy));
  });

  it('a non-markdown file shows only Tidy, inside the strip', async () => {
    await mount('.env');
    expect(q('[data-files-preview]')).toBeNull();
    expect(q('[data-files-content-controls]')?.contains(q('[data-files-format]'))).toBe(true);
  });

  it('with no file open neither control renders anywhere', async () => {
    await mount('notes.md', false);
    expect(q('[data-files-content-controls]')).toBeNull();
    expect(q('[data-files-preview]')).toBeNull();
    expect(q('[data-files-format]')).toBeNull();
  });

  it('the Mod-Shift-m chord still toggles the preview', async () => {
    await mount('notes.md');
    const editor = q('[data-files-editor]') as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(editor, { key: 'm', metaKey: true, shiftKey: true });
      fireEvent.keyDown(editor, { key: 'm', ctrlKey: true, shiftKey: true });
      await Promise.resolve();
    });
    expect(q('[data-files-preview]')?.getAttribute('data-files-preview-state')).toBe('preview');
  });
});
