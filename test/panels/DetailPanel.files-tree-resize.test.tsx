// @vitest-environment happy-dom

/**
 * THE FILE TREE'S RESIZE HANDLE — the wiring half. The arithmetic is proved
 * in `test/prefs/files-tree-width.test.ts` and the GEOMETRY in
 * `e2e/files-tree-resize-shots.mjs`, which is the only one of the three that
 * lays a page out; happy-dom reports `clientWidth` 0 for everything, which is
 * exactly the "no measurement" case this component must survive and is why
 * nothing here asserts a painted rectangle.
 *
 * What IS provable here, and is the reason the file exists:
 *
 *   - the handle is ABSENT, not disabled, when the caller has nowhere to put
 *     a width (`onSetDefaultProvider`'s own rule, one screen up this file);
 *   - it carries NEITHER insert mark, so the status bar never calls the
 *     keyboard Insert while it is held, and `I` never lands on it;
 *   - the keyboard route exists at all and goes through the same arithmetic a
 *     drag does;
 *   - it declines every key that is not its own, which is the mechanism by
 *     which `Canvas.tsx`'s window grammar still hears a bare letter
 *     (`event.defaultPrevented`);
 *   - the drag is held by POINTER CAPTURE and not by a boolean;
 *   - and a persisted width survives the tab being hidden and shown again,
 *     which is the one failure mode `files-tree-width.ts`'s header is about.
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
import { resetUnsavedRegistry } from '../../src/renderer/panels/unsaved-files.js';
import { TREE_WIDTH_MAX, TREE_WIDTH_MIN } from '../../src/renderer/prefs/files-tree-width.js';
import { PANE_RESIZE_STEP } from '../../src/renderer/prefs/panes.js';

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

const SIGNATURE: FileSignature = { size: 12, mtimeMs: 1, sha256: 'abc' };

type Bridge = {
  list: (sessionId: string) => Promise<FileListResult>;
  read: (path: string) => Promise<FileReadResult>;
  write: (
    path: string,
    content: string,
    baseSignature: FileSignature | null,
  ) => Promise<FileWriteResult>;
};

function withBridge(bridge: Partial<Bridge> = {}) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      files: {
        list:
          bridge.list ??
          (async () => ({
            root: '/work/atlas',
            files: ['/work/atlas/.env', '/work/atlas/src/index.ts'],
            truncated: false,
          })),
        read:
          bridge.read ?? (async () => ({ content: 'A=1', isBinary: false, signature: SIGNATURE })),
        write: bridge.write ?? (async () => ({ signature: SIGNATURE })),
      },
    },
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'api');
  resetUnsavedRegistry();
});

function props(over: Partial<DetailPanelProps> = {}): DetailPanelProps {
  return {
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
}

const openFiles = async () => {
  await act(async () => {
    q<HTMLButtonElement>('[data-view="files"]')?.click();
    await Promise.resolve();
  });
};

/** Mount the panel on the Files tab, with the bridge already set. */
async function openTree(over: Partial<DetailPanelProps> = {}) {
  withBridge();
  render(<DetailPanel {...props(over)} />);
  await openFiles();
  await act(async () => {
    await Promise.resolve();
  });
}

const handle = () => q<HTMLElement>('[data-files-tree-resize]');

/** happy-dom hands out no pointer-capture implementation, so the handle gets
 *  one that RECORDS — which is the whole point: a drag held by a boolean
 *  instead would never call either of these. */
function captureSpies(el: HTMLElement) {
  const set = vi.fn();
  const release = vi.fn();
  Object.defineProperty(el, 'setPointerCapture', { configurable: true, value: set });
  Object.defineProperty(el, 'releasePointerCapture', { configurable: true, value: release });
  return { set, release };
}

describe('the handle is drawn only for a caller that can store a width', () => {
  /** ABSENT, NOT DISABLED — `onSetDefaultProvider`'s own rule: a caller with
   *  nowhere to put the choice must not draw a control that looks draggable
   *  and silently springs back. */
  it('draws no handle when nothing is wired to persist the width', async () => {
    await openTree({ onFilesTreeWidth: undefined });
    expect(q('[data-files-tree]')).not.toBeNull();
    expect(handle()).toBeNull();
  });

  it('draws one once a caller wires it up', async () => {
    await openTree({ onFilesTreeWidth: () => {} });
    expect(handle()).not.toBeNull();
  });

  it('is a slider by ARIA, with the bounds a width is really clamped to', async () => {
    await openTree({ onFilesTreeWidth: () => {} });
    const el = handle();
    expect(el?.getAttribute('aria-orientation')).toBe('vertical');
    expect(el?.getAttribute('aria-valuemin')).toBe(String(TREE_WIDTH_MIN));
    expect(el?.getAttribute('aria-valuemax')).toBe(String(TREE_WIDTH_MAX));
    expect(el?.getAttribute('aria-label')).toMatch(/tree/i);
    expect(el?.getAttribute('tabindex')).toBe('0');
    // `aria-valuenow` has to be a number even before anything is stored, or
    // a screen reader reads a slider with no position.
    expect(Number(el?.getAttribute('aria-valuenow'))).not.toBeNaN();
  });
});

describe('the handle joins the focus model without taking it over', () => {
  /**
   * NEITHER MARK. `keyboard/focus-scope.ts` derives the cursor mode from
   * whether focus is inside a `data-insert-scope`; a handle that carried one
   * would make the status bar say Insert while the operator was dragging a
   * column, and `focusInsertStop`'s blind `.focus()` would land `I` on a
   * separator.
   */
  it('is neither an insert scope nor an insert stop', async () => {
    await openTree({ onFilesTreeWidth: () => {} });
    expect(handle()?.hasAttribute('data-insert-scope')).toBe(false);
    expect(handle()?.hasAttribute('data-insert-stop')).toBe(false);
  });

  /** And the count is what proves it did not become the FIRST one in document
   *  order, which is the trap this file's neighbour keeps walking into. */
  it('leaves the tab with exactly the one insert stop it had — the editor', async () => {
    await openTree({ onFilesTreeWidth: () => {} });
    await act(async () => {
      q<HTMLElement>('[data-files-row-path="/work/atlas/.env"]')?.click();
      await Promise.resolve();
    });
    expect(qa('[data-files] [data-insert-stop]')).toHaveLength(1);
    expect(q('[data-files] [data-insert-stop]')?.hasAttribute('data-files-editor')).toBe(true);
  });

  /** `role="tree"` may own only `treeitem`s and `group`s. A separator inside
   *  it would be invalid, and a screen reader walking the tree would meet it
   *  between two files. */
  it('sits outside the tree role, not among the rows', async () => {
    await openTree({ onFilesTreeWidth: () => {} });
    expect(q('[role="tree"] [data-files-tree-resize]')).toBeNull();
    expect(q('[data-files-tree] [data-files-tree-resize]')).not.toBeNull();
  });
});

describe('the keyboard route', () => {
  const press = async (el: HTMLElement, init: Record<string, unknown>) => {
    await act(async () => {
      fireEvent.keyDown(el, init);
      await Promise.resolve();
    });
  };

  it('grows the tree with ArrowLeft — the handle is on the tree’s left edge', async () => {
    const onFilesTreeWidth = vi.fn();
    await openTree({ filesTreeWidth: 200, onFilesTreeWidth });
    await press(handle() as HTMLElement, { key: 'ArrowLeft' });
    expect(onFilesTreeWidth).toHaveBeenCalledWith(200 + PANE_RESIZE_STEP);
  });

  it('shrinks it with ArrowRight', async () => {
    const onFilesTreeWidth = vi.fn();
    await openTree({ filesTreeWidth: 200, onFilesTreeWidth });
    await press(handle() as HTMLElement, { key: 'ArrowRight' });
    expect(onFilesTreeWidth).toHaveBeenCalledWith(200 - PANE_RESIZE_STEP);
  });

  /** One step size for every resize route in vam — `PANE_RESIZE_STEP`'s own
   *  comment is about exactly this, and a third handle inventing a fourth
   *  number is the drift it was written to stop. */
  it('multiplies the step when Shift is held, and by the standard slider jump', async () => {
    const onFilesTreeWidth = vi.fn();
    await openTree({ filesTreeWidth: 200, onFilesTreeWidth });
    await press(handle() as HTMLElement, { key: 'ArrowLeft', shiftKey: true });
    expect(onFilesTreeWidth).toHaveBeenCalledWith(200 + PANE_RESIZE_STEP * 4);
  });

  it('sends Home to the floor and End to the ceiling', async () => {
    const onFilesTreeWidth = vi.fn();
    await openTree({ filesTreeWidth: 200, onFilesTreeWidth });
    await press(handle() as HTMLElement, { key: 'Home' });
    expect(onFilesTreeWidth).toHaveBeenLastCalledWith(TREE_WIDTH_MIN);
    // happy-dom measures every container at 0, which `treeWidthCeiling` reads
    // as "unknown" — so End reaches the STORED cap here. A real container
    // binds it lower, and that is the e2e guard's question.
    await press(handle() as HTMLElement, { key: 'End' });
    expect(onFilesTreeWidth).toHaveBeenLastCalledWith(TREE_WIDTH_MAX);
  });

  it('clamps an arrow that would push past the floor', async () => {
    const onFilesTreeWidth = vi.fn();
    await openTree({ filesTreeWidth: TREE_WIDTH_MIN, onFilesTreeWidth });
    await press(handle() as HTMLElement, { key: 'ArrowRight' });
    expect(onFilesTreeWidth).toHaveBeenCalledWith(TREE_WIDTH_MIN);
  });

  /**
   * THE MECHANISM BY WHICH A WIDGET DECLINES WHAT IT DOES NOT OWN.
   * `Canvas.tsx`'s window listener stands down on `event.defaultPrevented`.
   * A handle that called `preventDefault()` on everything would swallow the
   * whole bare-letter grammar for as long as it held focus.
   */
  it('leaves every key that is not its own for the grammar', async () => {
    const onFilesTreeWidth = vi.fn();
    await openTree({ filesTreeWidth: 200, onFilesTreeWidth });
    for (const key of ['j', 'k', 'g', 'Enter', 'ArrowUp', 'ArrowDown']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      handle()?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(onFilesTreeWidth).not.toHaveBeenCalled();
  });

  it('claims the arrows it DOES own, so the grammar stands down for them', async () => {
    await openTree({ filesTreeWidth: 200, onFilesTreeWidth: () => {} });
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      cancelable: true,
    });
    handle()?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores a modified arrow — none of those is this handle’s key', async () => {
    const onFilesTreeWidth = vi.fn();
    await openTree({ filesTreeWidth: 200, onFilesTreeWidth });
    for (const modifier of ['metaKey', 'ctrlKey', 'altKey'] as const) {
      await press(handle() as HTMLElement, { key: 'ArrowLeft', [modifier]: true });
    }
    expect(onFilesTreeWidth).not.toHaveBeenCalled();
  });
});

describe('the drag is held by pointer capture, not by a flag', () => {
  /**
   * THE BUG THIS EXCLUDES: a boolean cleared only by a `pointerup` ON the
   * element. A drag released anywhere else never delivers one, and the flag
   * stays set for the life of the page. `usePointerDrag` is the house answer
   * and calling it is what these two spies detect.
   */
  it('takes the pointer on down and gives it back on up', async () => {
    const onFilesTreeWidth = vi.fn();
    await openTree({ filesTreeWidth: 200, onFilesTreeWidth });
    const el = handle() as HTMLElement;
    const { set, release } = captureSpies(el);

    await act(async () => {
      fireEvent.pointerDown(el, { pointerId: 7, clientX: 500, clientY: 0 });
    });
    expect(set).toHaveBeenCalledWith(7);
    expect(el.getAttribute('data-files-tree-resize')).toBe('dragging');

    await act(async () => {
      fireEvent.pointerMove(el, { pointerId: 7, clientX: 460, clientY: 0 });
      fireEvent.pointerUp(el, { pointerId: 7, clientX: 460, clientY: 0 });
    });
    expect(release).toHaveBeenCalledWith(7);
    expect(el.getAttribute('data-files-tree-resize')).toBe('idle');
  });

  it('commits ONCE, at the end, with the travel measured from the origin', async () => {
    const onFilesTreeWidth = vi.fn();
    await openTree({ filesTreeWidth: 200, onFilesTreeWidth });
    const el = handle() as HTMLElement;
    captureSpies(el);
    await act(async () => {
      fireEvent.pointerDown(el, { pointerId: 1, clientX: 500, clientY: 0 });
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 470, clientY: 0 });
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 440, clientY: 0 });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 440, clientY: 0 });
    });
    // Dragging LEFT by 60 grows a right-hand column by 60.
    expect(onFilesTreeWidth.mock.calls).toEqual([[260]]);
  });

  it('reports nothing for a move that followed no down on this handle', async () => {
    const onFilesTreeWidth = vi.fn();
    await openTree({ filesTreeWidth: 200, onFilesTreeWidth });
    const el = handle() as HTMLElement;
    const { release } = captureSpies(el);
    await act(async () => {
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 9, clientY: 0 });
      fireEvent.pointerUp(el, { pointerId: 1, clientX: 9, clientY: 0 });
    });
    expect(onFilesTreeWidth).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  /** No document-wide overlay, ever — counted DURING the drag, because one
   *  torn down correctly would be invisible to a count taken afterwards. */
  it('puts nothing in the document while the gesture is held', async () => {
    await openTree({ filesTreeWidth: 200, onFilesTreeWidth: () => {} });
    const el = handle() as HTMLElement;
    captureSpies(el);
    const before = document.querySelectorAll('*').length;
    await act(async () => {
      fireEvent.pointerDown(el, { pointerId: 1, clientX: 500, clientY: 0 });
      fireEvent.pointerMove(el, { pointerId: 1, clientX: 400, clientY: 0 });
    });
    expect(document.querySelectorAll('*').length).toBe(before);
  });
});

describe('what the tree actually renders at', () => {
  /** A tree nobody has dragged keeps the CLAMPED SHARE it has always had —
   *  shipping the handle must not move a single operator's layout. */
  it('draws the share, with no inline width, until something is stored', async () => {
    await openTree({ filesTreeWidth: null, onFilesTreeWidth: () => {} });
    const tree = q<HTMLElement>('[data-files-tree]');
    expect(tree?.style.width).toBe('');
    expect(tree?.className).toContain('w-[38%]');
  });

  it('draws a stored width as pixels, and drops the share once it has one', async () => {
    await openTree({ filesTreeWidth: 300, onFilesTreeWidth: () => {} });
    const tree = q<HTMLElement>('[data-files-tree]');
    expect(tree?.style.width).toBe('300px');
    expect(tree?.className).not.toContain('w-[38%]');
  });

  /** A width persisted by a previous run is honoured even where there is no
   *  handle to change it — the browser build stores nothing, but it must not
   *  ignore what the desktop already stored. */
  it('honours a stored width even with no handle wired', async () => {
    await openTree({ filesTreeWidth: 300, onFilesTreeWidth: undefined });
    expect(q<HTMLElement>('[data-files-tree]')?.style.width).toBe('300px');
    expect(handle()).toBeNull();
  });

  /**
   * THE FAILURE `files-tree-width.ts`'s HEADER IS ABOUT.
   *
   * The Files tab is not unmounted when another tab shows — it is
   * `display: none`, and a `display: none` element measures 0px. One look at
   * the Terminal tab and back must not narrow, and above all must not WRITE,
   * the width the operator chose.
   */
  it('writes nothing when the tab is hidden and shown again, and keeps the width', async () => {
    const onFilesTreeWidth = vi.fn();
    withBridge();
    const { rerender } = render(
      <DetailPanel {...props({ filesTreeWidth: 300, onFilesTreeWidth, tab: 'Files' })} />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(q<HTMLElement>('[data-files-tree]')?.style.width).toBe('300px');

    await act(async () => {
      rerender(
        <DetailPanel {...props({ filesTreeWidth: 300, onFilesTreeWidth, tab: 'Terminal' })} />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      rerender(<DetailPanel {...props({ filesTreeWidth: 300, onFilesTreeWidth, tab: 'Files' })} />);
      await Promise.resolve();
    });

    expect(q<HTMLElement>('[data-files-tree]')?.style.width).toBe('300px');
    expect(onFilesTreeWidth).not.toHaveBeenCalled();
  });
});
