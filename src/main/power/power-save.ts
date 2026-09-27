/**
 * "Keep computer awake" (`prefs/keep-awake.ts`'s `KeepAwakeMode`), the whole
 * of it: whether Electron's own `powerSaveBlocker` is currently running, kept
 * as a single optional id -- never a boolean plus an id that can disagree
 * with each other.
 *
 * `On` blocks for as long as vam runs; `while-running` blocks exactly while
 * the RENDERER reports at least one session `status === 'running'` (the
 * renderer owns that fact -- `Canvas.tsx`'s own model, main never polls, the
 * same reasoning `notify/waiting.ts`'s header gives for its own signal); `Off`
 * never blocks. `shouldBlock` is the pure decision; `KeepAwakeController`
 * is what makes calling it repeatedly safe: `apply` is idempotent, so a
 * caller may invoke it on every prefs write AND every model poll with no
 * risk of starting a second blocker while one is already running, or of
 * stopping an id that was never started.
 */

import type { KeepAwakeMode } from '../../shared/power.js';

export type { KeepAwakeMode };

/** What `electron.powerSaveBlocker` gives this module: a narrow, injectable
 *  slice so a test needs no real Electron and no real OS call. */
export type PowerSaveBlockerLike = {
  start: (type: 'prevent-app-suspension') => number;
  stop: (id: number) => void;
};

/** The pure rule behind every transition below -- read alone before the
 *  controller that applies it. */
export function shouldBlock(mode: KeepAwakeMode, anyAgentRunning: boolean): boolean {
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  return anyAgentRunning;
}

export class KeepAwakeController {
  #blocker: PowerSaveBlockerLike;
  #id: number | null = null;

  constructor(blocker: PowerSaveBlockerLike) {
    this.#blocker = blocker;
  }

  /** Whether a blocker is running right now. */
  get active(): boolean {
    return this.#id !== null;
  }

  /**
   * Move to whatever `shouldBlock(mode, anyAgentRunning)` says, from
   * whatever state this controller is already in. A call that asks for the
   * state already in force does nothing -- no `stop`+`start` pair, no second
   * id minted for a blocker that never stopped being wanted.
   */
  apply(mode: KeepAwakeMode, anyAgentRunning: boolean): void {
    const wants = shouldBlock(mode, anyAgentRunning);
    if (wants && this.#id === null) {
      this.#id = this.#blocker.start('prevent-app-suspension');
    } else if (!wants && this.#id !== null) {
      this.#blocker.stop(this.#id);
      this.#id = null;
    }
  }

  /** Release a running blocker unconditionally -- app quit, or a caller that
   *  is tearing this controller down. Idempotent: nothing to release calls
   *  `stop` zero times, never a second time on the same id. */
  dispose(): void {
    if (this.#id !== null) {
      this.#blocker.stop(this.#id);
      this.#id = null;
    }
  }
}
