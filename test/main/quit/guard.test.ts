/**
 * The quit guard: the one thing standing between Cmd-Q and text the operator
 * typed and has not saved.
 *
 * EVERY TEST HERE IS ALSO A TEST THAT THE APP IS STILL QUITTABLE. That is the
 * failure this guard could introduce and it is strictly worse than the one it
 * fixes -- an app that cannot be quit has to be force-killed, which loses the
 * same text AND every other session's state with it. So the assertions come in
 * pairs: what is prevented, and what is emphatically not.
 *
 * `ask` is SYNCHRONOUS here because it is synchronous in the product
 * (`dialog.showMessageBoxSync`); see `src/main/quit/guard.ts`'s own header for
 * why an async dialog was rejected. That choice is what makes this whole file
 * plain assertions with no timers, no fake clock and no pending promise that a
 * test could accidentally leave hanging.
 */

import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import {
  type AskToQuit,
  createQuitGuard,
  registerUnsavedIpc,
} from '../../../src/main/quit/guard.js';
import type { UnsavedReport } from '../../../src/main/quit/unsaved.js';

/** An `app.on('before-quit')` event, reduced to the one thing this guard uses. */
function quitEvent() {
  let prevented = false;
  return {
    preventDefault: () => {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
  };
}

describe('"Quit anyway" has to actually quit', () => {
  /**
   * THE SECOND WAY THIS COULD HAVE MADE THE APP UNQUITTABLE, and it arrives
   * from the opposite direction to every case below.
   *
   * `app.quit()` closes the windows AFTER `before-quit` returns, and electron
   * documents that a window's own `beforeunload` may cancel that close -- and
   * in electron, unlike a browser, a cancelling `beforeunload` shows NO prompt
   * at all. The Files tab arms exactly that handler whenever anything is
   * dirty, which is precisely when this guard has just asked. So an operator
   * who pressed "Quit anyway" could be left with an application that silently
   * declines to close, having just been told its text would be discarded.
   *
   * `release` is the answer: once the operator has agreed, main tears the
   * windows down itself rather than asking them to close. It is a dependency
   * rather than an implementation detail so that this -- the whole point of it
   * -- is a test rather than a hope.
   */
  it('releases the windows before letting the quit through', () => {
    const order: string[] = [];
    const guard = createQuitGuard({
      ask: () => {
        order.push('ask');
        return 'quit';
      },
      release: () => order.push('release'),
    });
    guard.report({ count: 1, names: ['.env'] });
    const event = quitEvent();
    guard.beforeQuit(event);
    expect(event.prevented).toBe(false);
    expect(order).toEqual(['ask', 'release']);
  });

  it('releases NOTHING when the operator cancels — the window is still theirs', () => {
    const release = vi.fn();
    const guard = createQuitGuard({ ask: () => 'cancel', release });
    guard.report({ count: 1, names: ['.env'] });
    guard.beforeQuit(quitEvent());
    expect(release).not.toHaveBeenCalled();
  });

  it('releases nothing when it never had to ask — no dirty text, no armed handler', () => {
    const release = vi.fn();
    const guard = createQuitGuard({ ask: () => 'quit', release });
    guard.beforeQuit(quitEvent());
    expect(release).not.toHaveBeenCalled();
  });

  it('still quits when the release itself throws — it is a belt, not a gate', () => {
    const guard = createQuitGuard({
      ask: () => 'quit',
      release: () => {
        throw new Error('the window was already gone');
      },
    });
    guard.report({ count: 1, names: ['.env'] });
    const event = quitEvent();
    expect(() => guard.beforeQuit(event)).not.toThrow();
    expect(event.prevented).toBe(false);
  });
});

describe('createQuitGuard', () => {
  /**
   * The guard under test with a `release` no test in THIS block asserts on --
   * the block above is where that dependency is proven. Keeping it out of the
   * way here is what lets each test below read as one claim about one path.
   */
  const guardOn = (ask: AskToQuit) => createQuitGuard({ ask, release: () => {} });

  it('never asks, and never prevents, while nothing is unsaved', () => {
    const ask = vi.fn(() => 'cancel' as const);
    const guard = guardOn(ask);
    const event = quitEvent();
    guard.beforeQuit(event);
    expect(event.prevented).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it('quits without a word when the renderer never reported at all', () => {
    // The hung-renderer case, and the browser-build case, and the case where
    // the window has not finished loading. Main holds nothing, so main has
    // nothing true to say -- and an app that will not quit because a renderer
    // went quiet is the worse bug.
    const ask = vi.fn(() => 'cancel' as const);
    const guard = guardOn(ask);
    for (const _ of [0, 1, 2]) {
      const event = quitEvent();
      guard.beforeQuit(event);
      expect(event.prevented).toBe(false);
    }
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks with what the renderer reported, and stays open when the operator cancels', () => {
    const seen: UnsavedReport[] = [];
    const guard = guardOn((report) => {
      seen.push(report);
      return 'cancel';
    });
    guard.report({ count: 2, names: ['.env', 'src/app.ts'] });
    const event = quitEvent();
    guard.beforeQuit(event);
    expect(event.prevented).toBe(true);
    expect(seen).toEqual([{ count: 2, names: ['.env', 'src/app.ts'] }]);
  });

  it('lets the quit through once the operator says so', () => {
    const guard = guardOn(() => 'quit');
    guard.report({ count: 1, names: ['.env'] });
    const event = quitEvent();
    guard.beforeQuit(event);
    expect(event.prevented).toBe(false);
  });

  it('a SECOND Cmd-Q after cancelling still works — the guard keeps no latch', () => {
    const answers: Array<'cancel' | 'quit'> = ['cancel', 'cancel', 'quit'];
    const ask = vi.fn(() => answers.shift() ?? 'quit');
    const guard = guardOn(ask);
    guard.report({ count: 1, names: ['.env'] });

    const first = quitEvent();
    guard.beforeQuit(first);
    expect(first.prevented).toBe(true);

    const second = quitEvent();
    guard.beforeQuit(second);
    expect(second.prevented).toBe(true);

    const third = quitEvent();
    guard.beforeQuit(third);
    expect(third.prevented).toBe(false);
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('stops asking the moment the last dirty buffer is saved', () => {
    const ask = vi.fn(() => 'cancel' as const);
    const guard = guardOn(ask);
    guard.report({ count: 1, names: ['.env'] });
    guard.report({ count: 0, names: [] });
    const event = quitEvent();
    guard.beforeQuit(event);
    expect(event.prevented).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it('a report main cannot read blocks nothing — it forgets rather than invents', () => {
    const ask = vi.fn(() => 'cancel' as const);
    const guard = guardOn(ask);
    guard.report({ count: 1, names: ['.env'] });
    guard.report('the renderer sent nonsense');
    const event = quitEvent();
    guard.beforeQuit(event);
    expect(event.prevented).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it('forgets everything once the window is gone — the text went with it', () => {
    const ask = vi.fn(() => 'cancel' as const);
    const guard = guardOn(ask);
    guard.report({ count: 2, names: ['.env', 'notes.md'] });
    guard.clear();
    const event = quitEvent();
    guard.beforeQuit(event);
    expect(event.prevented).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it('QUITS when the dialog itself cannot be drawn — a broken prompt is not a veto', () => {
    const guard = guardOn(() => {
      throw new Error('no window to attach a sheet to');
    });
    guard.report({ count: 1, names: ['.env'] });
    const event = quitEvent();
    expect(() => guard.beforeQuit(event)).not.toThrow();
    expect(event.prevented).toBe(false);
  });

  it('draws one dialog, not a stack, when a quit arrives while one is already up', () => {
    // `showMessageBoxSync` spins a nested run loop, so a second Cmd-Q CAN
    // re-enter this handler while the sheet is on screen. Two stacked sheets
    // about the same files is the shape of a dialog loop nobody can escape.
    const guard = guardOn(() => {
      const reentrant = quitEvent();
      guard.beforeQuit(reentrant);
      expect(reentrant.prevented).toBe(true);
      return 'cancel';
    });
    guard.report({ count: 1, names: ['.env'] });
    const event = quitEvent();
    guard.beforeQuit(event);
    expect(event.prevented).toBe(true);
  });

  it('is askable again after a re-entrant quit — the busy flag is not a one-way door', () => {
    const ask = vi.fn(() => {
      const reentrant = quitEvent();
      guard.beforeQuit(reentrant);
      return 'quit' as const;
    });
    const guard = guardOn(ask);
    guard.report({ count: 1, names: ['.env'] });
    guard.beforeQuit(quitEvent());
    const after = quitEvent();
    guard.beforeQuit(after);
    expect(after.prevented).toBe(false);
    expect(ask).toHaveBeenCalledTimes(2);
  });
});

describe('registerUnsavedIpc', () => {
  function harness() {
    const guard = createQuitGuard({ ask: () => 'cancel', release: () => {} });
    let handler: ((event: unknown, ...args: unknown[]) => unknown) | undefined;
    registerUnsavedIpc(
      {
        handle: (channel, listener) => {
          if (channel === CHANNELS.filesUnsaved) handler = listener;
        },
      },
      guard,
    );
    if (handler === undefined) throw new Error('filesUnsaved channel not registered');
    return { guard, invoke: handler };
  }

  it('registers the channel and carries the report onto the guard', async () => {
    const { guard, invoke } = harness();
    await invoke(undefined, { count: 1, names: ['.env'] });
    const event = quitEvent();
    guard.beforeQuit(event);
    expect(event.prevented).toBe(true);
  });

  it('answers the envelope every other channel answers, and never throws at the renderer', async () => {
    const { invoke } = harness();
    await expect(invoke(undefined, { count: 1, names: ['.env'] })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(invoke(undefined, 'rubbish')).resolves.toEqual({ ok: true, value: undefined });
  });
});
