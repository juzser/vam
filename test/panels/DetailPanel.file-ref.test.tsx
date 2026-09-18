// @vitest-environment happy-dom
/**
 * PRESSING `src/foo/bar.ts:42` IN AN ANSWER, all the way through: the control
 * in the transcript, the resolve in main, the Files tab it lands on and the
 * line the caret ends up at.
 *
 * `test/panels/out-links.test.tsx` proves the control exists and what it sends;
 * `test/main/files/resolve-ipc.test.ts` proves what main will and will not
 * resolve. NEITHER OF THEM NOTICES IF THE TWO ARE NOT CONNECTED -- a pane
 * that resolved the path and then drew nothing would pass both. This is the
 * seam: the bridge is stubbed the way `DetailPanel.files-tab.test.tsx` stubs
 * it, and every assertion is about what reached the DOM.
 *
 * WHAT IT ALSO PINS IS THE REUSE. The tab does not grow a second way to open a
 * file: the request goes through the same `openFile` a tree row goes through,
 * so an already-open buffer with unsaved text in it is shown as it stands
 * rather than re-read -- which is the one property `FilesTab.tsx`'s header
 * calls the worst thing this tab could get wrong.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileReadResult, FileRefTarget } from '../../src/main/files/types.js';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import { resetUnsavedRegistry } from '../../src/renderer/panels/unsaved-files.js';

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const qa = <T extends Element>(selector: string) => [...document.querySelectorAll<T>(selector)];

const ANSWER = 'The fix is in src/index.ts:3 — read it before the next run.';

const DECISION: Decision = {
  id: 'd1',
  label: 'step 1',
  input: 'ask',
  output: ANSWER,
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

const FILE = '/work/atlas/src/index.ts';
const CONTENT = 'const a = 1\nconst b = 2\nconst c = 3\nconst d = 4\n';

function refusal(code: string, message: string) {
  return { kind: 'refused' as const, code, message };
}

function withBridge(
  resolve: (sessionId: string, reference: string) => Promise<FileRefTarget>,
  read: (path: string) => Promise<FileReadResult> = async () => ({
    content: CONTENT,
    isBinary: false,
    signature: { size: CONTENT.length, mtimeMs: 1, sha256: 'abc' },
  }),
) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      files: {
        list: async () => ({ root: '/work/atlas', files: [FILE], truncated: false }),
        read,
        write: async () => Promise.reject(refusal('unreadable', 'no write wired')),
        resolve,
      },
    },
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'api');
  resetUnsavedRegistry();
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

const press = async (el: Element | null) => {
  await act(async () => {
    (el as HTMLButtonElement | null)?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const refControl = (): HTMLElement | null => q<HTMLElement>('[data-out-file-ref]');

describe('pressing a path:line reference an agent wrote', () => {
  it('opens the Files tab on that file, with the caret on that line', async () => {
    const resolve = vi.fn(async () => ({ path: FILE, line: 3 }));
    withBridge(resolve);
    draw();
    await press(refControl());
    expect(resolve).toHaveBeenCalledWith('s1', 'src/index.ts:3');
    // The tab really changed -- not merely a request recorded somewhere.
    expect(q<HTMLElement>('[data-view="files"]')?.getAttribute('aria-pressed')).toBe('true');
    const editor = q<HTMLTextAreaElement>('[data-files-editor]');
    expect(editor?.value).toBe(CONTENT);
    // Line 3 starts after "const a = 1\nconst b = 2\n" -- 24 characters.
    expect(editor?.selectionStart).toBe(24);
  });

  it('draws the refusal in the answer, and stays on Response, when main says no', async () => {
    withBridge(async () => Promise.reject(refusal('not-authorized', 'outside this project')));
    draw();
    await press(refControl());
    expect(q('[data-files-editor]')).toBeNull();
    expect(
      qa<HTMLElement>('[role="status"]').some((el) =>
        /outside this project/.test(el.textContent ?? ''),
      ),
    ).toBe(true);
  });

  it('says so rather than doing nothing when the build has no files bridge', async () => {
    draw({ files: false });
    await press(refControl());
    expect(
      qa<HTMLElement>('[role="status"]').some((el) => /desktop app/.test(el.textContent ?? '')),
    ).toBe(true);
  });

  /**
   * THE BUFFER IS THE ONE THING THIS TAB MUST NEVER LOSE. A second press on a
   * reference to a file already open must show what is in the editor, not
   * whatever is on disk -- so `read` is called once, not twice.
   */
  it('does not re-read a file it already has open', async () => {
    const read = vi.fn(async () => ({
      content: CONTENT,
      isBinary: false,
      signature: { size: CONTENT.length, mtimeMs: 1, sha256: 'abc' },
    }));
    withBridge(async () => ({ path: FILE, line: 2 }), read);
    draw();
    await press(refControl());
    await press(refControl());
    expect(read).toHaveBeenCalledTimes(1);
  });
});
