/**
 * ONE CHOICE: whether vam holds the machine awake, via Electron's own
 * `powerSaveBlocker` (`'prevent-app-suspension'`), and when.
 *
 * Operator, modelled on Orca's own Agents settings: `On` blocks suspension
 * for as long as vam runs at all; `While an agent is running` blocks it only
 * while at least one session's own `status` is `'running'` (main's own
 * `KeepAwakeController`, `src/main/power/power-save.ts`, is the state
 * machine that turns this and the renderer's own "is anything running right
 * now" signal into exactly one `start`/`stop` pair, never a leaked blocker
 * id); `Off` never blocks at all.
 *
 * OFF BY DEFAULT. Unlike `cache-timer.ts`'s countdown, this changes a REAL
 * fact about the operator's machine -- whether it can sleep -- and doing that
 * silently for an operator who never opens Settings is the wrong direction
 * for a brand-new capability to fail in.
 */

import type { KeepAwakeMode } from '../../shared/power.js';

export type { KeepAwakeMode };

export const DEFAULT_KEEP_AWAKE: KeepAwakeMode = 'off';

const MODES: readonly KeepAwakeMode[] = ['on', 'while-running', 'off'];

export function readKeepAwake(raw: unknown): KeepAwakeMode {
  return MODES.includes(raw as KeepAwakeMode) ? (raw as KeepAwakeMode) : DEFAULT_KEEP_AWAKE;
}
