// @vitest-environment happy-dom

/**
 * The reading pane must be able to shrink below its content's min size.
 *
 * The Files view's line-number gutter is in flow and tens of thousands of px
 * tall for a long file, so a pane with the flex default `min-height: auto`
 * could not shrink below it and the document grew a shell scrollbar. The pane
 * therefore carries `min-h-0` in BOTH width modes: a width given (desktop,
 * `shrink-0`) and none (the phone shell, `w-full`).
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import { resetUnsavedRegistry } from '../../src/renderer/panels/unsaved-files.js';
import { setActiveFilesMarkdownView } from '../../src/renderer/prefs/files-markdown-view.js';

beforeEach(() => {
  setActiveFilesMarkdownView('raw');
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'api');
  resetUnsavedRegistry();
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

const SIXTY_LINES = Array.from({ length: 60 }, (_, i) => `K${i}=${i}`).join('\n');

async function drawWithLongFileOpen(width: number | undefined) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      files: {
        list: async (_sid: string, dir?: string) =>
          dir === undefined
            ? { root: '/work/atlas', files: ['/work/atlas/.env'], truncated: false }
            : {
                root: '/work/atlas',
                dir: dir === '' ? '/work/atlas' : `/work/atlas/${dir}`,
                entries: [{ name: '.env', kind: 'file' }],
              },
        read: async () => ({
          content: SIXTY_LINES,
          isBinary: false,
          signature: { size: 12, mtimeMs: 1, sha256: 'abc' },
        }),
        write: async () => Promise.reject(new Error('no write wired')),
      },
    },
  });
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
    width,
    resizeHandle: null,
    files: true,
  };
  render(<DetailPanel {...props} />);
  await waitFor(() => {
    if (!document.querySelector('[data-files]')) throw new Error('still pending');
  });
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-view="files"]')?.click();
    await Promise.resolve();
  });
  await act(async () => {
    document.querySelector<HTMLElement>('[data-files-row]')?.click();
    await Promise.resolve();
  });
  await waitFor(() => {
    if (!document.querySelector('[data-files-gutter]')) throw new Error('file not open');
  });
}

const pane = () => document.querySelector<HTMLElement>('aside[data-reading-pane]');

describe('the reading pane can shrink below its content with a long file open', () => {
  it('carries min-h-0 when a width is given (shrink-0)', async () => {
    await drawWithLongFileOpen(408);
    expect(document.querySelector('[data-files-gutter]')?.textContent?.split('\n')).toHaveLength(
      60,
    );
    expect(pane()?.classList.contains('shrink-0')).toBe(true);
    expect(pane()?.classList.contains('min-h-0')).toBe(true);
  });

  it('carries min-h-0 when no width is given (w-full, the phone mode)', async () => {
    await drawWithLongFileOpen(undefined);
    expect(pane()?.classList.contains('w-full')).toBe(true);
    expect(pane()?.classList.contains('min-h-0')).toBe(true);
  });
});
