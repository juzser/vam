/**
 * The renderer's one channel into `KeepAwakeController`: `{mode,
 * anyAgentRunning}` in, nothing back. Validated like every channel in
 * `handlers.ts` -- the renderer is the least trusted process, so a malformed
 * or missing argument is a no-op rather than a call into the controller with
 * `undefined`.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import { registerPowerIpc } from '../../../src/main/power/ipc.js';
import type { KeepAwakeController } from '../../../src/main/power/power-save.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function harness() {
  const handlers = new Map<string, Handler>();
  const ipcMain = {
    handle: (channel: string, listener: Handler) => {
      handlers.set(channel, listener);
    },
  };
  const applied: { mode: string; anyAgentRunning: boolean }[] = [];
  const controller = {
    apply: (mode: string, anyAgentRunning: boolean) => {
      applied.push({ mode, anyAgentRunning });
    },
  } as unknown as KeepAwakeController;
  registerPowerIpc(ipcMain, controller);
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args);
  return { call, applied };
}

describe('registerPowerIpc', () => {
  it('applies a well-formed request', () => {
    const { call, applied } = harness();
    call(CHANNELS.powerSetKeepAwake, { mode: 'while-running', anyAgentRunning: true });
    expect(applied).toEqual([{ mode: 'while-running', anyAgentRunning: true }]);
  });

  it('refuses silently -- never calls apply -- for every malformed shape', () => {
    const { call, applied } = harness();
    call(CHANNELS.powerSetKeepAwake);
    call(CHANNELS.powerSetKeepAwake, null);
    call(CHANNELS.powerSetKeepAwake, { mode: 'sleeping', anyAgentRunning: true });
    call(CHANNELS.powerSetKeepAwake, { mode: 'on', anyAgentRunning: 'yes' });
    call(CHANNELS.powerSetKeepAwake, { mode: 'on' });
    call(CHANNELS.powerSetKeepAwake, { mode: 'on', anyAgentRunning: true }, 'extra');
    expect(applied).toEqual([]);
  });

  it('accepts every real mode', () => {
    const { call, applied } = harness();
    call(CHANNELS.powerSetKeepAwake, { mode: 'on', anyAgentRunning: false });
    call(CHANNELS.powerSetKeepAwake, { mode: 'off', anyAgentRunning: false });
    expect(applied).toEqual([
      { mode: 'on', anyAgentRunning: false },
      { mode: 'off', anyAgentRunning: false },
    ]);
  });
});
