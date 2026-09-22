/**
 * The bridge half: what the renderer may ask main to show, and how a click
 * gets back to the renderer.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { clearMainFailures } from '../../../src/main/errors/log.js';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import { notifyActivationRoute, registerNotifyIpc } from '../../../src/main/notify/ipc.js';
import type { NotifyRequest, NotifyTarget } from '../../../src/main/notify/notify.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function harness() {
  const handlers = new Map<string, Handler>();
  const shown: NotifyRequest[] = [];
  const closed: NotifyTarget[] = [];
  const sent: { channel: string; args: unknown[] }[] = [];
  const focus: string[] = [];
  const deps = {
    notifier: {
      show: (request: NotifyRequest) => {
        shown.push(request);
        return true;
      },
      close: (target: NotifyTarget) => {
        closed.push(target);
      },
    },
  };
  const ipcMain = {
    handle: (channel: string, listener: Handler) => {
      handlers.set(channel, listener);
    },
  };
  const webContents = {
    send: (channel: string, ...args: unknown[]) => {
      sent.push({ channel, args });
    },
  };
  const focusWindow = () => {
    focus.push('focused');
  };
  registerNotifyIpc(ipcMain, deps.notifier);
  const activate = notifyActivationRoute(webContents, focusWindow);
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args);
  return { invoke, shown, closed, sent, focus, activate };
}

beforeEach(() => clearMainFailures());

describe('show', () => {
  it('forwards a well-formed request', () => {
    const { invoke, shown } = harness();
    const request = { sourceId: 'claude-code', sessionId: 's1', title: 't', body: 'b' };
    expect(invoke(CHANNELS.notifyShow, request)).toBe(true);
    expect(shown).toEqual([request]);
  });

  it('refuses anything that is not four strings, without reaching the OS', () => {
    const { invoke, shown } = harness();
    for (const bad of [
      undefined,
      null,
      'title',
      {},
      { sourceId: 'a', sessionId: 'b', title: 'c' },
      { sourceId: 'a', sessionId: 'b', title: 'c', body: 7 },
      { sourceId: '', sessionId: 'b', title: 'c', body: 'd' },
    ]) {
      expect(invoke(CHANNELS.notifyShow, bad), JSON.stringify(bad)).toBe(false);
    }
    expect(shown).toEqual([]);
  });

  it('bounds the title and body it will forward from the least trusted process', () => {
    const { invoke, shown } = harness();
    const huge = 'x'.repeat(100_000);
    expect(
      invoke(CHANNELS.notifyShow, { sourceId: 'a', sessionId: 'b', title: huge, body: 'c' }),
    ).toBe(false);
    expect(shown).toEqual([]);
  });
});

describe('close', () => {
  it('forwards a target', () => {
    const { invoke, closed } = harness();
    invoke(CHANNELS.notifyClose, { sourceId: 'claude-code', sessionId: 's1' });
    expect(closed).toEqual([{ sourceId: 'claude-code', sessionId: 's1' }]);
  });

  it('ignores a malformed target', () => {
    const { invoke, closed } = harness();
    invoke(CHANNELS.notifyClose, { sourceId: 'claude-code' });
    invoke(CHANNELS.notifyClose, 'nope');
    expect(closed).toEqual([]);
  });
});

describe('a click', () => {
  it('brings the window forward and tells the renderer which session', () => {
    const { activate, focus, sent } = harness();
    activate({ sourceId: 'claude-code', sessionId: 's1' });
    expect(focus).toEqual(['focused']);
    expect(sent).toEqual([
      { channel: CHANNELS.notifyActivated, args: [{ sourceId: 'claude-code', sessionId: 's1' }] },
    ]);
  });
});
