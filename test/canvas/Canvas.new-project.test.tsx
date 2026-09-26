// @vitest-environment happy-dom

/**
 * The Projects header's `+` -- "new project", which here can only mean:
 * choose a directory, and start a session in it.
 *
 * A project in vam is derived from the cwd of a live session; there is no
 * stored thing to create. So this path has exactly two halves, and both are
 * asserted through their seams rather than performed: the directory picker is
 * `window.api.dialog.chooseDirectory` (Electron's `showOpenDialog`, absent in
 * the browser build) and the creation is the port's `write.createSessionIn`,
 * behind which main's tmux provider sits. NOTHING here spawns anything.
 *
 * Every refusal test asserts the NEGATIVE directly -- that `createSessionIn`
 * was never called -- and not merely that a sentence appeared. A test that
 * only reads the status bar passes just as happily against an implementation
 * that starts a session and then apologises.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { whyNotARepository } from '../../src/main/sources/repo.js';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import { clearEvents, loggedEvents } from '../../src/renderer/errors/log.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

const session = (id: string): Session => ({
  id,
  title: id,
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

/** A directory that is nobody's home: this repo is public. */
const CHOSEN = '/srv/work/orchard';

/** Start a session in a named project: the first item of that project's own
 *  menu, which is where the heading's `+` went (one icon less per heading, at
 *  the operator's request). */
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

const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';

async function clickNewProject() {
  await act(async () => {
    screen.getByLabelText('new project').click();
  });
}

type Spawned = [string, string][];

function sourceWith(canCreate: boolean): {
  source: CanvasSource;
  spawned: Spawned;
  wrote: { count: number };
} {
  const spawned: Spawned = [];
  const wrote = { count: 0 };
  const writes = canCreate
    ? {
        createSession: async () => {},
        createSessionIn: async (cwd: string, title: string) => {
          spawned.push([cwd, title]);
        },
      }
    : {};
  const inner = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: {
      liveUpdates: false,
      recordPrompt: true,
      deliverPrompt: false,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      closeSession: false,
      createSession: canCreate,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
      resumeSession: false,
    },
    declines: canCreate ? {} : { createSession: 'this source has no way to start one' },
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: { recordPrompt: async () => {}, ...writes },
  };
  return {
    source: {
      kind: 'session',
      source: inner as unknown as SessionSource,
      onWrote: () => {
        wrote.count += 1;
      },
    },
    spawned,
    wrote,
  };
}

/** Installs a picker, or -- with `undefined` -- the browser build's absence of one. */
function withDialog(chooseDirectory?: () => Promise<string | null>) {
  const calls = { count: 0 };
  const api =
    chooseDirectory === undefined
      ? undefined
      : {
          dialog: {
            chooseDirectory: async () => {
              calls.count += 1;
              return chooseDirectory();
            },
          },
        };
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true });
  return calls;
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

beforeEach(() => {
  localStorage.clear();
  // The refusal channel is a module-level buffer, so one test's "no" is the
  // next one's history -- and `push` drops a CONSECUTIVE repeat, which would
  // make a second identical refusal invisible rather than merely stale.
  clearEvents();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  Object.defineProperty(window, 'api', { value: undefined, configurable: true, writable: true });
});

describe('new project', () => {
  it('starts a session in the chosen directory, by (cwd, name) in that order', async () => {
    const { source, spawned, wrote } = sourceWith(true);
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    // By VALUE and in ORDER. Clicked against a source that cannot create, this
    // control returns before either argument is read, so a swapped pair would
    // sail through every refusal test in this file (#127's finding).
    expect(spawned).toEqual([[CHOSEN, 'orchard']]);
    expect(statusBar()).toContain('orchard');
    expect(wrote.count).toBe(1);
  });

  it('cancelling the picker starts nothing', async () => {
    const { source, spawned, wrote } = sourceWith(true);
    withDialog(async () => null);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(spawned).toEqual([]);
    expect(wrote.count).toBe(0);
    expect(statusBar()).toMatch(/no directory/i);
  });

  it('with no Electron bridge it says so, opens nothing and starts nothing', async () => {
    const { source, spawned } = sourceWith(true);
    withDialog();
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(spawned).toEqual([]);
    expect(statusBar()).toMatch(/desktop app|browser/i);
    expect(statusBar()).not.toMatch(/started/i);
  });

  it('a source that cannot create refuses in its own words and never opens the picker', async () => {
    const { source, spawned } = sourceWith(false);
    const picker = withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(spawned).toEqual([]);
    expect(picker.count).toBe(0);
    expect(statusBar()).toContain('this source has no way to start one');
  });

  it('reports a failed start rather than claiming a session it did not start', async () => {
    const { source, wrote } = sourceWith(true);
    const inner = (source as { source: SessionSource }).source as unknown as {
      write: { createSessionIn: unknown };
    };
    inner.write.createSessionIn = async () => {
      throw { kind: 'refused', code: 'no-such-directory', message: 'that directory is gone' };
    };
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(statusBar()).toContain('no-such-directory');
    expect(wrote.count).toBe(0);
  });

  /**
   * The narrowing the operator asked for, seen from where they see it. The
   * refusal is main's (`src/main/sources/repo.ts`) and it is asserted here BY
   * ITS OWN WORDS rather than by a stand-in shape: the failure mode this
   * closes is picking a directory that is not a repository and being told
   * nothing, so what has to hold is that main's sentence -- the path included
   * -- reaches the status bar.
   */
  it('a chosen directory that is not a repository is refused, in main’s own words', async () => {
    const { source, wrote } = sourceWith(true);
    const refusal = whyNotARepository(CHOSEN);
    const inner = (source as { source: SessionSource }).source as unknown as {
      write: { createSessionIn: unknown };
    };
    inner.write.createSessionIn = async () => {
      throw refusal;
    };
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(refusal?.code).toBe('not-a-repository');
    expect(statusBar()).toContain('not-a-repository');
    // The path, because "invalid directory" would leave the operator retracing
    // which one they clicked.
    expect(statusBar()).toContain(CHOSEN);
    expect(wrote.count).toBe(0);
  });
});

/**
 * FEEDBACK, and the guard that comes with it (F-1).
 *
 * `newProject` was the one create path that set neither `pendingAction` nor a
 * status, so between the directory dialog closing and `createSessionIn`
 * resolving -- two tmux spawns at a 10 s timeout each -- nothing on screen
 * changed and the `+` stayed live. The second-order half is the one that costs
 * something: with no pending state there was no guard either, so a second
 * click opened a second dialog and started a SECOND session in the directory.
 *
 * Both halves are asserted against the seams, never performed: `picker.count`
 * is how many dialogs were opened and `spawned` is how many sessions were
 * started. A test that read only the status bar would pass against an
 * implementation that starts two sessions and describes one.
 */
describe('new project — feedback and the in-flight guard', () => {
  /** A promise the test resolves by hand, so "while it runs" is a real moment. */
  function deferred<T>() {
    let settle!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
      settle = resolve;
    });
    return { promise, settle };
  }

  const control = () => screen.getByLabelText('new project') as HTMLButtonElement;

  it('goes busy and says so before the picker has answered', async () => {
    const { source, spawned } = sourceWith(true);
    const gate = deferred<string | null>();
    withDialog(() => gate.promise);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();

    // BEFORE the await resolves: the control is already wearing the action.
    expect(control().getAttribute('data-pending')).toBe('true');
    expect(control().getAttribute('aria-busy')).toBe('true');
    expect(control().disabled).toBe(true);
    expect(statusBar()).toMatch(/choosing a directory/i);
    expect(spawned).toEqual([]);

    await act(async () => {
      gate.settle(CHOSEN);
    });
    expect(control().getAttribute('data-pending')).toBeNull();
    expect(statusBar()).toContain('orchard');
  });

  /**
   * THESE TWO TESTS ARE A PAIR, and the nesting is what says so.
   *
   * One of them is a tautology and is kept deliberately, as the record of a
   * guard that was falsified and found untested. That only works while a
   * reader meets them together: the explanation used to sit between them, so
   * moving, extracting or reordering either test would have silently left the
   * tautology looking like the proof. A `describe` cannot be split by an edit
   * that does not notice it.
   */
  describe('a second click, and which test actually proves it is refused', () => {
    it('a second click while the picker is open opens no second dialog and starts no second session', async () => {
      const { source, spawned } = sourceWith(true);
      const gate = deferred<string | null>();
      const picker = withDialog(() => gate.promise);
      render(<Canvas model={MODEL} source={source} />);
      await clickNewProject();
      await act(async () => {
        control().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(picker.count).toBe(1);

      await act(async () => {
        gate.settle(CHOSEN);
      });
      expect(spawned).toEqual([[CHOSEN, 'orchard']]);
    });

    /**
     * THE SECOND TEST IS THE ONE THAT PROVES THE GUARD. The first was written
     * believing it did, and does not: deleting the `pendingAction` check from
     * `newProject` leaves it green, because a disabled button does not dispatch
     * a click at all and the handler is never reached. The disabled attribute
     * is a real defence and is asserted for itself -- but it only covers the
     * control that is ITSELF pending.
     *
     * The second is the reachable second click. `pending()` matches on the id, so
     * while a session is being created in a project the Projects `+` is a live,
     * enabled button, and only the guard inside the handler stops it opening a
     * picker and spawning into a second directory. Deleting the guard reddens
     * this one.
     */
    it('is refused, out loud, while another action is in flight', async () => {
      const { source, spawned } = sourceWith(true);
      const gate = deferred<void>();
      const inner = (source as { source: SessionSource }).source as unknown as {
        write: { createSession: () => Promise<void> };
      };
      inner.write.createSession = () => gate.promise;
      const picker = withDialog(async () => CHOSEN);
      render(<Canvas model={MODEL} source={source} />);
      await addInProject('p1');
      // The Projects `+` is not the pending control, so it is still live.
      expect(control().disabled).toBe(false);

      await clickNewProject();
      expect(picker.count).toBe(0);
      expect(spawned).toEqual([]);
      expect(statusBar()).toMatch(/still running/i);

      await act(async () => {
        gate.settle();
      });
    });
  });

  it('says "starting…" before the spawn, and clears the busy state when it lands', async () => {
    const { source } = sourceWith(true);
    const gate = deferred<void>();
    const inner = (source as { source: SessionSource }).source as unknown as {
      write: { createSessionIn: () => Promise<void> };
    };
    inner.write.createSessionIn = () => gate.promise;
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();

    expect(statusBar()).toContain('starting a new session in orchard');
    expect(control().disabled).toBe(true);

    await act(async () => {
      gate.settle();
    });
    expect(control().getAttribute('data-pending')).toBeNull();
    expect(control().disabled).toBe(false);
  });

  it.each([
    ['cancelling', async () => null],
    ['a failed spawn', async () => CHOSEN],
  ])('clears the busy state after %s', async (_label, choose) => {
    const { source } = sourceWith(true);
    const inner = (source as { source: SessionSource }).source as unknown as {
      write: { createSessionIn: () => Promise<void> };
    };
    inner.write.createSessionIn = async () => {
      throw { kind: 'refused', code: 'tmux-missing', message: 'the `tmux` command was not found' };
    };
    withDialog(choose);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(control().getAttribute('data-pending')).toBeNull();
    expect(control().disabled).toBe(false);
  });
});

/**
 * AND THE SAME ACT FROM THE KEYBOARD — `Cmd+Shift+P`, which the operator
 * asked for.
 *
 * It is the SAME `newProject`, reached through the chord table instead of
 * through the button, and these cases assert it at the same seams the
 * button's do: `spawned` is how many sessions were really started and
 * `picker.count` is how many dialogs were really opened. A keyboard test that
 * only read the status bar would pass against a dispatch that says the right
 * sentence and calls nothing.
 *
 * `cancelable: true` is not decoration here. `Canvas.tsx` stands down on
 * `event.defaultPrevented`, and `preventDefault()` on an event built without
 * `cancelable` is a specified no-op — the header of
 * `test/canvas/Canvas.cursor-mode.test.tsx` records how that once made a whole
 * suite green BECAUSE OF the defect it was later sent to fix. A real keydown
 * is cancelable; these are too.
 *
 * WHICH ARM EACH GATE COVERS. The success path and the desktop-only refusal
 * ("the browser build has no picker") are UNIT-ONLY, and by construction:
 * `window.api` does not exist in the web bundle the e2e guards drive, and the
 * demo source they run against declines at `newSessionRoute` before any
 * picker is reached. `e2e/key-truth-shots.mjs` covers the ROUTE refusal in a
 * real browser — that the chord reaches this flow at all, and that the "no"
 * is recorded under `new project` rather than counted as a failure.
 */
describe('new project — the chord', () => {
  /**
   * `Cmd+Shift+P` as a real macOS keydown carries it: Shift has already
   * upper-cased the letter, and `normalizeKey` folds both away to `Mod-p`
   * (`test/keyboard/chords.new-project.test.ts` argues that spelling).
   */
  async function pressNewProject(target: EventTarget = window) {
    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'P',
          code: 'KeyP',
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  }

  const composer = () =>
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');

  it('starts a session in the chosen directory, by (cwd, name) in that order', async () => {
    const { source, spawned, wrote } = sourceWith(true);
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await pressNewProject();
    // The same seam the click test asserts, in the same order — a swapped
    // pair would sail through every refusal case in this file.
    expect(spawned).toEqual([[CHOSEN, 'orchard']]);
    expect(statusBar()).toContain('orchard');
    expect(wrote.count).toBe(1);
  });

  /**
   * FROM INSIDE THE PROMPT BOX, which is the state a `Mod-` chord exists for.
   *
   * The window listener's typing guard lets a Cmd/Ctrl chord past a focused
   * INPUT|TEXTAREA — no layout produces a character from one, so a box
   * capturing letters has no claim on it — and that concession is the only
   * reason this key works where the operator's hands actually are. Asserted
   * with the caret really in the box and the keydown dispatched AT it, so the
   * guard reads the same `event.target` a real press would give it.
   */
  it('fires from inside the composer, where an unmodified key would not', async () => {
    const { source, spawned } = sourceWith(true);
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    const box = composer();
    expect(box, 'the model draws no prompt box to type into').not.toBeNull();
    await act(async () => {
      box?.focus();
    });
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    await pressNewProject(box as EventTarget);
    expect(spawned).toEqual([[CHOSEN, 'orchard']]);
  });

  /**
   * THE REFUSAL, IN THE SOURCE'S OWN WORDS — and recorded as the "no" vam
   * meant to say rather than as a failure. This is the arm the browser guard
   * covers from the other side.
   */
  it('a source that cannot create refuses in its own words, and never opens the picker', async () => {
    const { source, spawned } = sourceWith(false);
    const picker = withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await pressNewProject();
    expect(spawned).toEqual([]);
    expect(picker.count).toBe(0);
    expect(statusBar()).toContain('this source has no way to start one');
  });

  it('and records that refusal under `new project`, as a refusal and not a failure', async () => {
    const { source } = sourceWith(false);
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await pressNewProject();
    const refusals = loggedEvents().filter((event) => event.action === 'new project');
    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.kind).toBe('refusal');
    expect(refusals[0]?.message).toContain('this source has no way to start one');
  });

  it('with no Electron bridge it says so, opens nothing and starts nothing', async () => {
    const { source, spawned } = sourceWith(true);
    withDialog();
    render(<Canvas model={MODEL} source={source} />);
    await pressNewProject();
    expect(spawned).toEqual([]);
    expect(statusBar()).toMatch(/desktop app|browser/i);
    expect(statusBar()).not.toMatch(/started/i);
  });

  /**
   * The key does not become a SECOND way to start one while the first is
   * running. `newProject`'s in-flight guard is shared by both entry points,
   * and this is the reachable second press: the Projects `+` is not the
   * pending control while a session is being created in a project, so nothing
   * on screen stops the keystroke — only the guard inside the handler does.
   */
  it('is refused, out loud, while another action is in flight', async () => {
    const { source, spawned } = sourceWith(true);
    let settle!: () => void;
    const gate = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const inner = (source as { source: SessionSource }).source as unknown as {
      write: { createSession: () => Promise<void> };
    };
    inner.write.createSession = () => gate;
    const picker = withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await addInProject('p1');
    await pressNewProject();
    expect(picker.count).toBe(0);
    expect(spawned).toEqual([]);
    expect(statusBar()).toMatch(/still running/i);
    await act(async () => {
      settle();
    });
  });
});

/**
 * WHILE A NEW PROJECT IS STARTING, AND IT IS NOT INSTANT -- the gap the
 * operator reported: "nhưng tạo project thì không có" (but creating a
 * project has none). `createSession`'s own wait, asserted in the sibling
 * suite `describe('the wait while a session is starting', ...)` in
 * `Canvas.new-session.test.tsx`, never applied here: `newProject` never
 * called `setStarting`, and the sidebar only ever matched an EXISTING
 * project's section -- which a new project does not have, by definition,
 * until the session it starts is actually running there.
 *
 * Same mechanism as that sibling suite, not a second one: `newProject` arms
 * the identical `starting` state `createSession` does, with `projectId: null`
 * standing for "no section exists yet, draw a provisional one instead." This
 * suite deliberately mirrors that one's cases, case for case, to prove the
 * same guarantees hold on the path that was missing them.
 */
describe('the wait while a new project is starting', () => {
  /** A promise the test resolves by hand -- the same idea as the sibling
   *  suite's `deferred` above, redeclared locally because that one is
   *  function-scoped to `describe('new project — feedback…')`, not exported. */
  function deferred<T>() {
    let settle!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
      settle = resolve;
    });
    return { promise, settle };
  }

  /** A source whose `createSessionIn` hangs until the test releases it, so
   *  "the write is accepted, the row has not arrived" is a real moment. */
  function gatedSpawn() {
    const { source } = sourceWith(true);
    const gate = deferred<void>();
    const inner = (source as { source: SessionSource }).source as unknown as {
      write: { createSessionIn: () => Promise<void> };
    };
    inner.write.createSessionIn = () => gate.promise;
    return { source, release: () => gate.settle(undefined) };
  }

  const starting = () => document.querySelector('[data-session-starting]');
  const startingPane = () => document.querySelector('[data-pane-starting]');
  const provisionalSection = () => document.querySelector('[data-project-section-provisional]');

  it('shows nothing before anything is being started', () => {
    const { source } = sourceWith(true);
    render(<Canvas model={MODEL} source={source} />);
    expect(starting()).toBeNull();
    expect(startingPane()).toBeNull();
    expect(provisionalSection()).toBeNull();
  });

  it('marks the sidebar with a provisional section the moment the directory is chosen', async () => {
    const { source } = gatedSpawn();
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(provisionalSection()).not.toBeNull();
    expect(starting()).not.toBeNull();
  });

  it('names it from the chosen directory', async () => {
    const { source } = gatedSpawn();
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(provisionalSection()?.textContent).toContain('orchard');
    expect(starting()?.textContent).toContain('orchard');
  });

  it('opens the pane on it immediately, without waiting for the write', async () => {
    const { source } = gatedSpawn();
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(startingPane()).not.toBeNull();
    expect(startingPane()?.textContent).toContain('orchard');
  });

  /**
   * AND IT KEEPS SAYING SO AFTER THE WRITE RESOLVES -- the half the status bar
   * only ever hinted at: `tmux new-session -d` returns before the agent
   * inside has registered anywhere vam can read, so the write finishing is not
   * the row arriving.
   */
  it('stays up after the write resolves, while the row is still missing', async () => {
    const { source, release } = gatedSpawn();
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    await act(async () => {
      release();
    });
    expect(provisionalSection()).not.toBeNull();
    expect(startingPane()).not.toBeNull();
  });

  it('clears once the session it was waiting for arrives, and does not linger', async () => {
    const { source, release } = gatedSpawn();
    withDialog(async () => CHOSEN);
    const view = render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    await act(async () => {
      release();
    });
    const grown: CanvasModel = {
      projects: [
        ...MODEL.projects,
        { id: 'p2', name: 'orchard', source: 'claude-code', sessions: [session('o1')] },
      ],
    };
    await act(async () => {
      view.rerender(<Canvas model={grown} source={source} />);
    });
    expect(provisionalSection()).toBeNull();
    expect(startingPane()).toBeNull();
    expect(document.querySelectorAll('[data-session-starting]')).toHaveLength(0);
  });

  it('clears when the picker is cancelled', async () => {
    const { source } = sourceWith(true);
    withDialog(async () => null);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(provisionalSection()).toBeNull();
    expect(startingPane()).toBeNull();
  });

  it('clears when the picker itself fails', async () => {
    const { source } = sourceWith(true);
    withDialog(() => Promise.reject(new Error('dialog crashed')));
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(provisionalSection()).toBeNull();
    expect(startingPane()).toBeNull();
  });

  /**
   * A FAILED SPAWN LEAVES NOTHING SPINNING. An indicator that outlived its own
   * failure is worse than none: it says vam is still trying when vam has
   * stopped.
   */
  it('clears when the spawn fails, and nothing is left spinning', async () => {
    const { source } = sourceWith(true);
    const inner = (source as { source: SessionSource }).source as unknown as {
      write: { createSessionIn: unknown };
    };
    inner.write.createSessionIn = async () => {
      throw new Error('tmux said no');
    };
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    expect(provisionalSection()).toBeNull();
    expect(startingPane()).toBeNull();
    expect(statusBar()).toContain('tmux said no');
  });

  /**
   * NOT MERGED INTO AN EXISTING PROJECT'S SECTION. `Canvas.new-session.test.
   * tsx` records finding its own equivalent check weakenable to `starting !==
   * null` against a one-project fixture; this model carries an existing
   * project (`alpha`) for the same reason -- so a provisional section landing
   * inside IT, rather than beside it, has somewhere to land wrong.
   */
  it('draws its own section, separate from an existing project', async () => {
    const { source } = gatedSpawn();
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    await clickNewProject();
    const marks = [...document.querySelectorAll('[data-session-starting]')];
    expect(marks).toHaveLength(1);
    expect(marks[0]?.closest('[data-project-rows]')).toBeNull();
    expect(marks[0]?.closest('[data-project-section-provisional]')).not.toBeNull();
  });

  /**
   * AND IT IS NOT A SESSION, exactly as the sibling wait is not: no row the
   * keyboard can reach, nothing `Close` or `Stop` could act on. The
   * provisional heading offers no control at all -- no icon picker, no
   * collapse, no menu, no per-project `+` -- because every one of those would
   * act on a `Project` this directory does not have yet.
   */
  it('is not one of the sidebar’s session rows, and offers no control to act on it', async () => {
    const { source } = gatedSpawn();
    withDialog(async () => CHOSEN);
    render(<Canvas model={MODEL} source={source} />);
    const before = document.querySelectorAll('[data-session-row]').length;
    await clickNewProject();
    expect(document.querySelectorAll('[data-session-row]').length).toBe(before);
    expect(provisionalSection()?.querySelector('button')).toBeNull();
  });
});
