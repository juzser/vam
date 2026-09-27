/**
 * THE STATE MACHINE BEHIND "keep computer awake", tested against a FAKE
 * `powerSaveBlocker` -- no real Electron, no real OS call. What this proves:
 * `on` starts a blocker and keeps it started; `while-running` starts one
 * exactly when an agent is running and stops it the instant none is;
 * `off` never starts one, and stops one already running the moment the mode
 * changes to it; and across every transition, `start` is called at most once
 * per "should be blocking" span and `stop` is called at most once per span --
 * no leaked blocker ids, no double-start, no stop on an id never started.
 */

import { describe, expect, it } from 'vitest';
import { KeepAwakeController, shouldBlock } from '../../../src/main/power/power-save.js';

function fakeBlocker() {
  const started: number[] = [];
  const stopped: number[] = [];
  let nextId = 1;
  const live = new Set<number>();
  return {
    started,
    stopped,
    live,
    blocker: {
      start: (_type: 'prevent-app-suspension') => {
        const id = nextId++;
        live.add(id);
        started.push(id);
        return id;
      },
      stop: (id: number) => {
        live.delete(id);
        stopped.push(id);
      },
      isStarted: (id: number) => live.has(id),
    },
  };
}

describe('shouldBlock', () => {
  it('on always blocks', () => {
    expect(shouldBlock('on', false)).toBe(true);
    expect(shouldBlock('on', true)).toBe(true);
  });

  it('off never blocks', () => {
    expect(shouldBlock('off', false)).toBe(false);
    expect(shouldBlock('off', true)).toBe(false);
  });

  it('while-running blocks exactly when an agent is running', () => {
    expect(shouldBlock('while-running', false)).toBe(false);
    expect(shouldBlock('while-running', true)).toBe(true);
  });
});

describe('KeepAwakeController', () => {
  it('on starts exactly one blocker and stays started across repeated applies', () => {
    const { blocker, started, stopped } = fakeBlocker();
    const controller = new KeepAwakeController(blocker);
    controller.apply('on', false);
    controller.apply('on', false);
    controller.apply('on', true);
    expect(started).toHaveLength(1);
    expect(stopped).toHaveLength(0);
    expect(controller.active).toBe(true);
  });

  it('off never starts one, and stops one already running the moment it switches', () => {
    const { blocker, started, stopped } = fakeBlocker();
    const controller = new KeepAwakeController(blocker);
    controller.apply('on', false);
    expect(started).toHaveLength(1);
    controller.apply('off', false);
    expect(stopped).toEqual(started);
    expect(controller.active).toBe(false);
    controller.apply('off', true);
    expect(started).toHaveLength(1);
  });

  it('while-running starts and stops with the running flag, never leaking an id', () => {
    const { blocker, started, stopped } = fakeBlocker();
    const controller = new KeepAwakeController(blocker);
    controller.apply('while-running', false);
    expect(started).toHaveLength(0);
    controller.apply('while-running', true);
    expect(started).toHaveLength(1);
    expect(controller.active).toBe(true);
    // A repeat with the SAME running flag must not start a second blocker.
    controller.apply('while-running', true);
    expect(started).toHaveLength(1);
    controller.apply('while-running', false);
    expect(stopped).toEqual(started);
    expect(controller.active).toBe(false);
    // Flapping back on starts a FRESH id, never re-using the stopped one.
    controller.apply('while-running', true);
    expect(started).toHaveLength(2);
    expect(started[1]).not.toBe(started[0]);
  });

  it('dispose stops an active blocker and is idempotent', () => {
    const { blocker, started, stopped } = fakeBlocker();
    const controller = new KeepAwakeController(blocker);
    controller.apply('on', false);
    controller.dispose();
    expect(stopped).toEqual(started);
    expect(controller.active).toBe(false);
    // A second dispose with nothing active must not call stop again.
    controller.dispose();
    expect(stopped).toHaveLength(1);
  });

  it('mode flips between on/while-running/off never call stop without a matching start', () => {
    const { blocker, started, stopped } = fakeBlocker();
    const controller = new KeepAwakeController(blocker);
    for (const [mode, running] of [
      ['off', false],
      ['while-running', false],
      ['while-running', true],
      ['on', true],
      ['while-running', false],
      ['off', false],
    ] as const) {
      controller.apply(mode, running);
    }
    // Every stopped id must have been started, and never twice.
    expect(new Set(stopped).size).toBe(stopped.length);
    for (const id of stopped) expect(started).toContain(id);
  });
});
