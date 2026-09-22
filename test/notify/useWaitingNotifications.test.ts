// @vitest-environment happy-dom

/**
 * THE HOOK: the ledger in `waiting.ts`, driven by React, talking to the
 * bridge. What this file adds over `waiting.test.ts` is the two things the
 * pure function cannot see -- whether the DOCUMENT is focused and visible
 * (the difference between "cursor on it" and "looking at it"), and whether
 * any IPC crosses at all.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotifyApi, NotifyTarget } from '../../src/preload/api.js';
import { useWaitingNotifications } from '../../src/renderer/notify/useWaitingNotifications.js';
import type { NotifiableSession } from '../../src/renderer/notify/waiting.js';

const session = (over: Partial<NotifiableSession> = {}): NotifiableSession => ({
  sourceId: 'claude-code',
  sessionId: 's1',
  status: 'running',
  title: 'refactor the parser',
  project: 'vam',
  ...over,
});

function fakeApi() {
  const show = vi.fn().mockResolvedValue(true);
  const close = vi.fn().mockResolvedValue(undefined);
  let activated: ((target: NotifyTarget) => void) | null = null;
  const api: NotifyApi = {
    show,
    close,
    test: vi.fn().mockResolvedValue({ kind: 'sent' }),
    onActivated: (listener) => {
      activated = listener;
      return () => {
        activated = null;
      };
    },
  };
  return {
    api,
    show,
    close,
    click: (target: NotifyTarget) => activated?.(target),
    listening: () => activated !== null,
  };
}

function lookingAt(focused: boolean, visible = true) {
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visible ? 'visible' : 'hidden',
  });
}

type Props = {
  sessions: readonly NotifiableSession[];
  enabled: boolean;
  focused: NotifyTarget | null;
  api: NotifyApi | undefined;
  onActivate: (target: NotifyTarget) => void;
};

function mount(initial: Partial<Props> = {}) {
  const fake = fakeApi();
  const onActivate = vi.fn();
  const props: Props = {
    sessions: [session()],
    enabled: true,
    focused: null,
    api: fake.api,
    onActivate,
    ...initial,
  };
  const hook = renderHook((p: Props) => useWaitingNotifications(p), { initialProps: props });
  const poll = (sessions: readonly NotifiableSession[], over: Partial<Props> = {}) => {
    Object.assign(props, over, { sessions });
    act(() => hook.rerender({ ...props }));
  };
  return { ...fake, onActivate, poll, unmount: hook.unmount };
}

beforeEach(() => lookingAt(false));
afterEach(() => vi.restoreAllMocks());

describe('the transition reaches main once', () => {
  it('shows on running -> waiting, and not again on the next poll of the same state', () => {
    const { show, poll } = mount();
    poll([session({ status: 'waiting' })]);
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith({
      sourceId: 'claude-code',
      sessionId: 's1',
      title: 'refactor the parser',
      body: 'needs you — vam',
    });
    poll([session({ status: 'waiting' })]);
    poll([session({ status: 'waiting' })]);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('a flap does not re-fire', () => {
    const { show, poll } = mount();
    poll([session({ status: 'waiting' })]);
    poll([session({ status: 'running' })]);
    poll([session({ status: 'waiting' })]);
    expect(show).toHaveBeenCalledTimes(1);
  });
});

describe('silent when the operator is already looking', () => {
  const focused = { sourceId: 'claude-code', sessionId: 's1' };

  it('makes no call for the focused session while the document is focused and visible', () => {
    lookingAt(true, true);
    const { show, poll } = mount({ focused });
    poll([session({ status: 'waiting' })]);
    expect(show).not.toHaveBeenCalled();
  });

  it('does call when the cursor is on it but the window is not in front', () => {
    lookingAt(false, true);
    const { show, poll } = mount({ focused });
    poll([session({ status: 'waiting' })]);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('does call when the window is focused but the document is hidden', () => {
    lookingAt(true, false);
    const { show, poll } = mount({ focused });
    poll([session({ status: 'waiting' })]);
    expect(show).toHaveBeenCalledTimes(1);
  });
});

describe('cleared', () => {
  it('asks main to close the banner when the session leaves waiting', () => {
    const { close, poll } = mount();
    poll([session({ status: 'waiting' })]);
    expect(close).not.toHaveBeenCalled();
    poll([session({ status: 'running' })]);
    expect(close).toHaveBeenCalledWith({ sourceId: 'claude-code', sessionId: 's1' });
  });
});

describe('the switch off means no IPC at all', () => {
  it('neither shows nor closes, through a crossing and back', () => {
    const { show, close, poll } = mount({ enabled: false });
    poll([session({ status: 'waiting' })]);
    poll([session({ status: 'running' })]);
    expect(show).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('turning it on afterwards seeds rather than fires for what was already waiting', () => {
    const { show, poll } = mount({ enabled: false });
    poll([session({ status: 'waiting' })]);
    poll([session({ status: 'waiting' })], { enabled: true });
    expect(show).not.toHaveBeenCalled();
    // A fresh crossing after that is heard.
    poll([session({ status: 'running' })]);
    poll([session({ status: 'waiting' })]);
    expect(show).toHaveBeenCalledTimes(1);
  });
});

describe('without a bridge', () => {
  it('does nothing and throws nothing -- the browser build has no `notify`', () => {
    const { show, poll } = mount({ api: undefined });
    expect(() => poll([session({ status: 'waiting' })])).not.toThrow();
    expect(show).not.toHaveBeenCalled();
  });
});

describe('a click on the banner', () => {
  it('is routed to onActivate with the session it was about', () => {
    const { click, onActivate } = mount();
    click({ sourceId: 'claude-code', sessionId: 's1' });
    expect(onActivate).toHaveBeenCalledWith({ sourceId: 'claude-code', sessionId: 's1' });
  });

  it('stops listening on unmount', () => {
    const { listening, unmount } = mount();
    expect(listening()).toBe(true);
    unmount();
    expect(listening()).toBe(false);
  });
});
