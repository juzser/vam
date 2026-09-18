// @vitest-environment happy-dom

/**
 * RIGHT-CLICK THE IN BUBBLE.
 *
 * Operator, asked whether the bubble should offer copy or cancel: "In bubble,
 * copy, cancel are different functions." Both, then, as two items.
 *
 * NEITHER IS A NEW CAPABILITY, which is why this is a menu and not a feature.
 *   - COPY goes through `copyText` (`panels/clipboard.ts`), the one route that
 *     knows the Electron build denies `navigator.clipboard` and has to cross
 *     the bridge instead -- and that RETURNS whether the write landed, so the
 *     caption is a reading rather than an assumption.
 *   - CANCEL is `interruptRun`: vam presses Escape into the session's tmux
 *     pane over the same channel the keystroke strip already uses. It has
 *     three refusals, and the menu shows them BEFORE the click rather than
 *     after it, which is the one thing a menu can do that a keystroke cannot.
 *
 * WHY CANCEL IS ON THE PROMPT AND NOT ON THE ANSWER. Interrupting is an act on
 * a turn that is still running, and the running turn is the one whose prompt
 * is pinned at the top of the column. An older turn's bubble offers the item
 * disabled, saying so -- never absent, or the menu would change shape as you
 * scroll.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import type { PaneKey, PaneSendResult } from '../../src/shared/terminal.js';

const NEWEST: Decision = {
  id: 'd2',
  label: 'sign-off',
  input: 'ship it',
  output: null,
  commands: [],
};
const OLDER: Decision = {
  id: 'd1',
  label: 'plan',
  input: 'draw up a plan',
  output: 'here is the plan',
  commands: [],
};

function sessionWith(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: 'Provider survey',
    icon: null,
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 1,
    activity: null,
    age: '3m',
    // Newest first, as `decisions` is ordered.
    decisions: [NEWEST, OLDER],
    vamControlled: true,
    ...over,
  };
}

/** A bridge into a pane, so the interrupt has somewhere to go. */
function bridge(result: PaneSendResult = 'sent') {
  // Typed with its real parameters, so the assertion below can read WHICH key
  // was pressed rather than only that something was.
  const send = vi.fn(
    async (_projectId: string, _key: PaneKey, _rowId?: string): Promise<PaneSendResult> => result,
  );
  const writeText = vi.fn(async () => true);
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { terminal: { send }, clipboard: { writeText } },
  });
  return { send, writeText };
}

function draw(over: Partial<Session> = {}, props: Partial<DetailPanelProps> = {}) {
  const session = sessionWith(over);
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  const entry: SessionEntry = { project, session };
  render(
    <DetailPanel
      entry={entry}
      decision={NEWEST}
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
      {...props}
    />,
  );
}

const menu = () => document.querySelector<HTMLElement>('[data-context-menu]');
const entryOf = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-context-menu-item="${id}"]`);
/** The In block of the turn whose prompt is `text`. */
const bubbleOf = (text: string): HTMLElement => {
  const found = [...document.querySelectorAll<HTMLElement>('[data-detail-block="in"]')].find(
    (el) => el.textContent?.includes(text) === true,
  );
  if (found === undefined) throw new Error(`no In bubble carrying ${text}`);
  return found;
};
const openOn = (text: string, at = { clientX: 90, clientY: 140 }) =>
  fireEvent.contextMenu(bubbleOf(text), at);

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'api');
});

describe('the bubble menu opens', () => {
  it('draws nothing until a right-click', () => {
    bridge();
    draw();
    expect(menu()).toBeNull();
  });

  it('opens on the bubble, named for the turn', () => {
    bridge();
    draw();
    openOn('ship it');
    expect(menu()?.getAttribute('aria-label')).toBe('prompt actions');
  });

  it('takes the event from the browser, so the shell menu stays shut', () => {
    bridge();
    draw();
    expect(fireEvent.contextMenu(bubbleOf('ship it'), { clientX: 5, clientY: 5 })).toBe(false);
  });

  it('offers copy and cancel, in that order', () => {
    bridge();
    draw();
    openOn('ship it');
    expect([...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)).toEqual(
      ['Copy prompt', 'Cancel this turn'],
    );
  });
});

describe('copy', () => {
  it('copies THIS turn’s prompt, not the pane’s selected one', async () => {
    const { writeText } = bridge();
    draw();
    openOn('draw up a plan');
    await act(async () => {
      fireEvent.click(entryOf('copy') as HTMLElement);
    });
    expect(writeText).toHaveBeenCalledWith('draw up a plan');
  });

  it('says it copied, because the bridge said the write landed', async () => {
    bridge();
    draw();
    openOn('ship it');
    await act(async () => {
      fireEvent.click(entryOf('copy') as HTMLElement);
    });
    expect(document.querySelector('[data-mode-cycle]')?.textContent).toContain('copied');
  });

  /**
   * THE HALF THAT USED TO BE ASSUMED. In the packaged app the renderer's
   * `navigator.clipboard` is refused outright -- every Chromium permission is
   * denied -- so a caller that fires the write and prints "copied" one line
   * later tells the operator a lie. `copyText` returns the answer; this is
   * the caption reading it.
   */
  it('says it could NOT copy when the write was refused', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { terminal: { send: vi.fn() }, clipboard: { writeText: vi.fn(async () => false) } },
    });
    draw();
    openOn('ship it');
    await act(async () => {
      fireEvent.click(entryOf('copy') as HTMLElement);
    });
    const said = document.querySelector('[data-mode-cycle]')?.textContent ?? '';
    expect(said).toContain('not copied');
  });
});

describe('cancel', () => {
  it('presses Escape into the session’s pane', async () => {
    const { send } = bridge();
    draw();
    openOn('ship it');
    await act(async () => {
      fireEvent.click(entryOf('cancel') as HTMLElement);
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]).toEqual({ kind: 'escape' });
  });

  it('is refused, with the reason, on a session vam did not start', () => {
    bridge();
    draw({ vamControlled: false });
    openOn('ship it');
    expect(entryOf('cancel')?.disabled).toBe(true);
    expect(entryOf('cancel')?.textContent).toContain('vam did not start this session');
    // And copy is untouched: the two are different functions, and one being
    // unavailable must not take the other with it.
    expect(entryOf('copy')?.disabled).toBe(false);
  });

  it('is refused, with the reason, when the session is not working', () => {
    bridge();
    draw({ status: 'idle' });
    openOn('ship it');
    expect(entryOf('cancel')?.disabled).toBe(true);
    expect(entryOf('cancel')?.textContent).toContain('nothing running');
  });

  it('is refused on a turn that has already finished', () => {
    bridge();
    draw();
    openOn('draw up a plan');
    expect(entryOf('cancel')?.disabled).toBe(true);
    expect(entryOf('cancel')?.textContent).toContain('this turn has already finished');
  });

  it('does nothing at all when it is refused', async () => {
    const { send } = bridge();
    draw({ vamControlled: false });
    openOn('ship it');
    await act(async () => {
      fireEvent.click(entryOf('cancel') as HTMLElement);
    });
    expect(send).not.toHaveBeenCalled();
    expect(menu()).not.toBeNull();
  });
});

/**
 * AND THE ANSWER BLOCK, which is the "detail pane" half of the same request.
 *
 * ONE ITEM, not two. Copy is the only thing vam can honestly do to an answer:
 * cancelling belongs to the prompt (it stops the turn that is producing the
 * answer, so offering it on the output would be the same act named twice), and
 * there is no third capability to expose. A menu that padded itself out to
 * match the bubble's length would be inventing items.
 */
describe('the answer block', () => {
  const outOf = (text: string): HTMLElement => {
    const found = [...document.querySelectorAll<HTMLElement>('[data-detail-block="out"]')].find(
      (el) => el.textContent?.includes(text) === true,
    );
    if (found === undefined) throw new Error(`no Out block carrying ${text}`);
    return found;
  };

  it('offers exactly one thing: copy the answer', () => {
    bridge();
    draw();
    fireEvent.contextMenu(outOf('here is the plan'), { clientX: 60, clientY: 200 });
    expect(menu()?.getAttribute('aria-label')).toBe('answer actions');
    expect([...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent)).toEqual(
      ['Copy answer'],
    );
  });

  it('copies the answer, not the prompt', async () => {
    const { writeText } = bridge();
    draw();
    fireEvent.contextMenu(outOf('here is the plan'), { clientX: 60, clientY: 200 });
    await act(async () => {
      fireEvent.click(entryOf('copy') as HTMLElement);
    });
    expect(writeText).toHaveBeenCalledWith('here is the plan');
  });

  /**
   * A TURN WITH NOTHING TO COPY SAYS SO. The block draws a sentence in place
   * of an answer ("this turn ended without an answer"), and copying that
   * sentence would put vam's own prose on the operator's clipboard as if the
   * agent had written it.
   */
  it('refuses, with the reason, when the turn has no answer yet', () => {
    bridge();
    draw();
    fireEvent.contextMenu(outOf('still running'), { clientX: 60, clientY: 200 });
    expect(entryOf('copy')?.disabled).toBe(true);
    expect(entryOf('copy')?.textContent).toContain('this turn has no answer to copy');
  });
});
