// @vitest-environment happy-dom

/** EC-26b: muted rows in the Files tree (name rule, git mark, inheritance). */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileDirResult, FileListResult } from '../../src/main/files/types.js';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';
import { resetUnsavedRegistry } from '../../src/renderer/panels/unsaved-files.js';

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

const levels: Record<string, FileDirResult['entries']> = {
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

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'api');
  resetUnsavedRegistry();
});

const row = (path: string) =>
  [...document.querySelectorAll<HTMLElement>('[data-files-row]')].find(
    (el) => el.getAttribute('data-files-row-path') === `${ROOT}/${path}`,
  ) as HTMLElement;
const click = (path: string) =>
  act(async () => {
    row(path).click();
    await Promise.resolve();
  });

async function mount() {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      files: {
        list: async (_id: string, dir?: string): Promise<FileListResult | FileDirResult> => ({
          root: ROOT,
          dir: dir === '' || dir === undefined ? ROOT : `${ROOT}/${dir}`,
          entries: levels[dir ?? ''] ?? [],
        }),
        read: async () => ({
          content: 'x',
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
      if (!document.querySelector('[data-files]')) throw new Error('pending');
    },
    { timeout: 10_000 },
  );
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-view="files"]')?.click();
    await Promise.resolve();
  });
}

describe('muted rows in the Files tree', () => {
  it('mutes dot names, node_modules and git-ignored entries only', async () => {
    await mount();
    for (const name of ['.env', '.github', 'node_modules', 'build', 'debug.log']) {
      expect(row(name).hasAttribute('data-files-row-muted'), name).toBe(true);
      expect(row(name).className, name).toContain('text-ink-faint');
    }
    for (const name of ['src', 'README.md']) {
      expect(row(name).hasAttribute('data-files-row-muted'), name).toBe(false);
      expect(row(name).className, name).not.toContain('text-ink-faint');
    }
  });

  it('mutes children of a muted directory, inside node_modules and an ignored dir', async () => {
    await mount();
    await click('build');
    await click('node_modules');
    await click('node_modules/pkg');
    await click('src');
    for (const p of ['build/out.js', 'node_modules/pkg', 'node_modules/pkg/index.js']) {
      expect(row(p).hasAttribute('data-files-row-muted'), p).toBe(true);
    }
    expect(row('src/index.ts').hasAttribute('data-files-row-muted')).toBe(false);
  });

  it('a muted file still opens on click and takes the keyboard cursor', async () => {
    await mount();
    await click('.env');
    expect(document.querySelector('[data-files-editor]')).not.toBeNull();
    expect(row('.env').hasAttribute('data-files-row-active')).toBe(true);
    expect(row('.env').className).toContain('text-ink');
    const tree = document.querySelector('[role="tree"]') as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(tree, { key: 'j' });
      await Promise.resolve();
    });
    expect(document.querySelector('[data-files-cursor]')?.getAttribute('data-files-row-path')).toBe(
      `${ROOT}/debug.log`,
    );
    expect(row('debug.log').hasAttribute('data-files-row-muted')).toBe(true);
  });
});
