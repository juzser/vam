// @vitest-environment happy-dom

/**
 * `o` -- New session -- as a real creation rather than a sentence about the CLI.
 *
 * Nothing here spawns anything: the path is asserted through the port's
 * `write.createSession`, which is the seam main's tmux provider sits behind.
 * The refusal case asserts the NEGATIVE directly -- a source that cannot
 * create must call nothing at all, not call and then apologise.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { buildKeySheet } from '../../src/renderer/keyboard/keysheet.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

const session = (id: string): Session => ({
  id,
  title: id,
  icon: null,
  epic: null,
  branch: null,
  status: 'done',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [],
});

const MODEL: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')] }],
};

const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';

async function clickAsync(label: string) {
  await act(async () => {
    screen.getByLabelText(label).click();
  });
}

/** The per-project add, which is the first item of that project's own menu
 *  now rather than a `+` on its heading -- one icon less per heading, at the
 *  operator's request. Two presses, same call. */
async function addInProject(projectId: string) {
  await act(async () => {
    (document.querySelector(`[data-project-menu="${projectId}"]`) as HTMLElement).click();
  });
  await act(async () => {
    (
      document.querySelector(
        `[data-project-menu-panel="${projectId}"] [data-project-menu-item="new-session"]`,
      ) as HTMLElement
    ).click();
  });
}

async function pressAsync(key: string, modifiers: KeyboardEventInit = {}) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
}

function sourceWith(createSession?: (projectId: string, title: string) => Promise<void>): {
  source: CanvasSource;
  wrote: { count: number };
} {
  const wrote = { count: 0 };
  const inner = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: {
      liveUpdates: false,
      recordPrompt: true,
      deliverPrompt: true,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      closeSession: false,
      createSession: createSession !== undefined,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
    },
    declines:
      createSession === undefined ? { createSession: 'this source has no way to start one' } : {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: {
      recordPrompt: async () => {},
      ...(createSession === undefined ? {} : { createSession }),
    },
  };
  return {
    source: {
      kind: 'session',
      source: inner as unknown as SessionSource,
      onWrote: () => {
        wrote.count += 1;
      },
    },
    wrote,
  };
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('creating a session with `o`', () => {
  it('really calls the source, in the focused session’s own project', async () => {
    const created: [string, string][] = [];
    const { source, wrote } = sourceWith(async (projectId, title) => {
      created.push([projectId, title]);
    });
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('o');
    expect(created).toEqual([['p1', 'alpha']]);
    expect(statusBar()).toContain('alpha');
    expect(wrote.count).toBe(1);
  });

  /**
   * The two mouse paths, against a source that CAN create -- which is the
   * whole point of asserting them. Clicked against a source that cannot, both
   * buttons return at the `createSession` guard before either argument is
   * read, so a swapped `(name, id)` would sail through: main answers
   * `unknown-project` for every add and no test moves.
   *
   * So the assertion is by VALUE and in ORDER: the project id first, the
   * display name second.
   */
  it('the per-project add item passes (id, name), in that order', async () => {
    const created: [string, string][] = [];
    const { source, wrote } = sourceWith(async (projectId, title) => {
      created.push([projectId, title]);
    });
    render(<Canvas model={MODEL} source={source} />);
    await addInProject('p1');
    expect(created).toEqual([['p1', 'alpha']]);
    expect(wrote.count).toBe(1);
  });

  it('the footer add button passes (id, name), in that order', async () => {
    const created: [string, string][] = [];
    const { source } = sourceWith(async (projectId, title) => {
      created.push([projectId, title]);
    });
    render(<Canvas model={MODEL} source={source} />);
    await clickAsync('new session');
    expect(created).toEqual([['p1', 'alpha']]);
  });

  it('does not claim the new session is visible yet', async () => {
    // `tmux new-session -d` returns as soon as the session exists, before the
    // agent inside it has registered anywhere vam can read, so the reload that
    // follows will not show the new row. Saying it started is true; implying
    // it is on screen is not, and the operator would read a missing row as a
    // failure.
    const { source } = sourceWith(async () => {});
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('o');
    expect(statusBar()).toContain('alpha');
    expect(statusBar()).toMatch(/moment to appear|not showing yet/i);
  });

  it('refuses in the source’s own words, and CALLS NOTHING, when it cannot', async () => {
    const { source, wrote } = sourceWith();
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('o');
    expect(statusBar()).toContain('this source has no way to start one');
    expect(statusBar()).not.toMatch(/started|created a/i);
    expect(wrote.count).toBe(0);
  });

  it('reports the failure rather than claiming a session it did not start', async () => {
    const { source } = sourceWith(async () => {
      throw { kind: 'refused', code: 'session-exists', message: 'a session by that name exists' };
    });
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('o');
    expect(statusBar()).toContain('session-exists');
    expect(statusBar()).not.toMatch(/^started/i);
  });
});

/**
 * `Mod-n` — the same action under the chord every application already spells
 * "new". ALONGSIDE `o`, not instead of it: `o` is the vim gesture the rest of
 * this grammar is built on, and the two are one binding with two keys, the way
 * `close` already holds `x` and `Mod-w`.
 *
 * Asserted through `buildKeySheet` rather than against a written-out list,
 * because the sheet is generated: a binding that reached the table without a
 * label cannot reach the sheet, and a list written here would pass either way.
 */
describe('creating a session with `Mod-n`', () => {
  it('starts a session, exactly as `o` does', async () => {
    const created: [string, string][] = [];
    const { source, wrote } = sourceWith(async (projectId, title) => {
      created.push([projectId, title]);
    });
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('n', { metaKey: true });
    expect(created).toEqual([['p1', 'alpha']]);
    expect(wrote.count).toBe(1);
  });

  it('leaves plain `n` to the search, which is a different action', async () => {
    const created: string[] = [];
    const { source } = sourceWith(async (projectId) => void created.push(projectId));
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('n');
    expect(created).toEqual([]);
  });

  /**
   * `#154` let modifier chords past the `INPUT|TEXTAREA` early return, so this
   * is a decision rather than an inheritance: mid-prompt, `Mod-n` DOES start a
   * session. A Cmd chord produces no character on any layout, so it cannot be
   * something the operator meant to type; and the moment you want another
   * session is usually while you are already writing to one. The draft is not
   * touched — starting a session neither sends nor clears it.
   */
  it('starts one from inside the prompt box, without disturbing the draft', async () => {
    const created: string[] = [];
    const { source } = sourceWith(async (projectId) => void created.push(projectId));
    render(<Canvas model={MODEL} source={source} />);
    const box = document.querySelector('textarea');
    expect(box).not.toBeNull();
    await act(async () => {
      fireEvent.change(box as HTMLTextAreaElement, { target: { value: 'half a thought' } });
    });
    await act(async () => {
      (box as HTMLTextAreaElement).focus();
      fireEvent.keyDown(box as HTMLTextAreaElement, { key: 'n', metaKey: true, bubbles: true });
    });
    expect(created).toEqual(['p1']);
    expect((box as HTMLTextAreaElement).value).toBe('half a thought');
  });

  it('does nothing while an overlay owns the keyboard', async () => {
    const created: string[] = [];
    const { source } = sourceWith(async (projectId) => void created.push(projectId));
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('?');
    expect(document.querySelector('[data-key-sheet]')).not.toBeNull();
    await pressAsync('n', { metaKey: true });
    expect(created).toEqual([]);
  });

  it('appears in the generated key sheet, next to `o`', () => {
    const rows = buildKeySheet().flatMap((group) => group.rows);
    const start = rows.filter((row) => row.label === 'start a new session');
    expect(start.map((row) => row.keys).sort()).toEqual(['Mod-n', 'o']);
  });
});

/**
 * WHILE THE SESSION IS BEING STARTED, AND IT IS NOT INSTANT.
 *
 * Operator: "when creating a new session there needs to be a loading indicator
 * in the sidebar too, and open the new tab immediately with loading in the
 * pane."
 *
 * The status bar was the only thing that said anything, and it is the one
 * surface the next act overwrites -- which on this path is usually the
 * operator pressing the control again, because nothing else moved. Worse, the
 * wait is real and has TWO parts, and vam only ever hinted at the second:
 * `tmux new-session -d` returns as soon as the session exists, and the agent
 * inside registers where vam can see it later, on its own schedule. So the
 * row can be seconds away from a write that already succeeded.
 *
 * NOTHING HERE PUTS A SESSION IN THE MODEL. A placeholder that entered
 * `allEntries` would become a tab of a pane, a row the keyboard can reach, and
 * a thing `Close` and `Stop` would offer to act on -- for a session that does
 * not exist. It is drawn beside the model, never inside it.
 */
describe('the wait while a session is starting', () => {
  /** A creation the test resolves by hand, so the in-flight state can be read. */
  function gatedSource() {
    let release: (() => void) | null = null;
    const built = sourceWith(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    return { ...built, release: () => release?.() };
  }

  const starting = () => document.querySelector('[data-session-starting]');
  const startingPane = () => document.querySelector('[data-pane-starting]');

  it('shows nothing before anything is being started', () => {
    const { source } = sourceWith(async () => {});
    render(<Canvas model={MODEL} source={source} />);
    expect(starting()).toBeNull();
    expect(startingPane()).toBeNull();
  });

  it('marks the sidebar the moment the creation is accepted', async () => {
    const { source } = gatedSource();
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('o');
    expect(starting()).not.toBeNull();
  });

  /** It says WHERE, because a sidebar holds every project at once. */
  it('names the project it is starting one in', async () => {
    const { source } = gatedSource();
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('o');
    expect(starting()?.textContent).toContain('alpha');
  });

  it('opens the pane on it immediately, without waiting for the write', async () => {
    const { source } = gatedSource();
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('o');
    expect(startingPane()).not.toBeNull();
  });

  /**
   * AND IT KEEPS SAYING SO AFTER THE WRITE RESOLVES. This is the half the
   * status bar only hinted at: the write is done, the row is not there yet,
   * and an indicator that stopped here would go quiet at exactly the moment
   * the operator is still waiting.
   */
  it('stays up after the write resolves, while the row is still missing', async () => {
    const { source, release } = gatedSource();
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('o');
    await act(async () => {
      release();
    });
    expect(starting()).not.toBeNull();
    expect(startingPane()).not.toBeNull();
  });

  it('clears once the session it was waiting for arrives', async () => {
    const { source, release } = gatedSource();
    const view = render(<Canvas model={MODEL} source={source} />);
    await pressAsync('o');
    await act(async () => {
      release();
    });
    const grown: CanvasModel = {
      projects: [
        {
          id: 'p1',
          name: 'alpha',
          source: 'claude-code',
          sessions: [session('a1'), session('a2')],
        },
      ],
    };
    await act(async () => {
      view.rerender(<Canvas model={grown} source={source} />);
    });
    expect(starting()).toBeNull();
    expect(startingPane()).toBeNull();
  });

  /**
   * A FAILED CREATION LEAVES NOTHING SPINNING. An indicator that outlived its
   * own failure would be the one state worse than no indicator: it says vam is
   * still trying when vam has stopped.
   */
  it('clears when the creation fails, and the failure is what is said', async () => {
    const { source } = sourceWith(async () => {
      throw new Error('tmux said no');
    });
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('o');
    expect(starting()).toBeNull();
    expect(startingPane()).toBeNull();
    // The SOURCE's own words, which is what a failure is for -- not vam's.
    expect(statusBar()).toContain('tmux said no');
  });

  /** A source that cannot create never starts one, so nothing is drawn. */
  it('draws nothing at all when the source refuses outright', async () => {
    const { source } = sourceWith(undefined);
    render(<Canvas model={MODEL} source={source} />);
    await pressAsync('o');
    expect(starting()).toBeNull();
    expect(startingPane()).toBeNull();
  });

  /**
   * UNDER THE PROJECT IT IS STARTING IN, AND NOT THE OTHERS.
   *
   * The sidebar holds every project at once, so "there is a wait" is only half
   * a sentence -- and a wait drawn under all of them says vam is starting
   * several sessions when it is starting one. Found by mutation: with a
   * one-project fixture the check `starting?.projectId === project.id` could
   * be weakened to `starting !== null` and every test stayed green.
   */
  it('draws the wait under that project alone', async () => {
    const twoProjects: CanvasModel = {
      projects: [
        { id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')] },
        { id: 'p2', name: 'beta', source: 'claude-code', sessions: [session('b1')] },
      ],
    };
    const { source } = gatedSource();
    render(<Canvas model={twoProjects} source={source} />);
    await pressAsync('o');
    const marks = [...document.querySelectorAll('[data-session-starting]')];
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toContain('alpha');
    expect(marks[0]?.textContent).not.toContain('beta');
  });

  /**
   * AND IT IS NOT A SESSION. The sidebar's rows are things the operator can
   * act on -- focus, close, stop, rename -- and this is not one of them yet.
   */
  it('is not one of the sidebar’s session rows', async () => {
    const { source } = gatedSource();
    render(<Canvas model={MODEL} source={source} />);
    const before = document.querySelectorAll('[data-session-row]').length;
    await pressAsync('o');
    expect(document.querySelectorAll('[data-session-row]').length).toBe(before);
  });
});
