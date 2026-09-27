/**
 * The renderer's one channel into `KeepAwakeController`: `{mode,
 * anyAgentRunning}` in, nothing back -- the renderer decides WHAT the
 * desired state is (it owns both the preference and the model that says
 * whether anything is running, `notify/waiting.ts`'s own reasoning), and this
 * channel is the one place that state crosses into main, which is the only
 * process that may call `powerSaveBlocker`.
 *
 * VALIDATED LIKE EVERY CHANNEL IN `handlers.ts`: the renderer is the least
 * trusted process, so a malformed body is a silent no-op rather than a call
 * into the controller with a value it was never typed to receive.
 */

import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import type { KeepAwakeController, KeepAwakeMode } from './power-save.js';

const MODES: readonly KeepAwakeMode[] = ['on', 'while-running', 'off'];

function isRequest(
  raw: unknown,
): raw is { readonly mode: KeepAwakeMode; readonly anyAgentRunning: boolean } {
  if (typeof raw !== 'object' || raw === null) return false;
  const { mode, anyAgentRunning } = raw as Record<string, unknown>;
  return MODES.includes(mode as KeepAwakeMode) && typeof anyAgentRunning === 'boolean';
}

export function registerPowerIpc(ipcMain: IpcMainLike, controller: KeepAwakeController): void {
  ipcMain.handle(CHANNELS.powerSetKeepAwake, (_event, ...args: unknown[]): void => {
    const [request] = args;
    if (args.length !== 1 || !isRequest(request)) return;
    controller.apply(request.mode, request.anyAgentRunning);
  });
}
