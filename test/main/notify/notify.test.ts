/**
 * THE OS CALL, AND THE INSTRUMENT AROUND IT.
 *
 * `Notification.isSupported()` answers `true` on a machine where delivery is
 * impossible (measured: an ad-hoc linker-signed bundle gets `true`, then a
 * `failed` event, and nothing on screen). So it gates nothing here. The only
 * signal that tells the truth is the `failed` event, and the whole point of
 * this module is that it cannot be lost: a failure is written into main's own
 * failure buffer (`src/main/errors/log.ts`), which the renderer already pulls
 * into the log the `E` key opens. Silence is the one outcome this file
 * forbids.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMainFailures, mainFailures } from '../../../src/main/errors/log.js';
import { NOTIFICATION_BODY_BYTES, truncateBody } from '../../../src/main/notify/body.js';
import {
  createNotifier,
  NOTIFY_VERDICT_TIMEOUT_MS,
  type NotificationLike,
  type NotificationOptionsLike,
} from '../../../src/main/notify/notify.js';

// biome-ignore lint/suspicious/noExplicitAny: a fake that stands in for four listener shapes
type Listener = (...args: any[]) => void;

/** A notification that records what was done to it and lets a test fire its events. */
function fakeNotification(): NotificationLike & {
  readonly listeners: Map<string, Listener[]>;
  readonly shown: number;
  readonly closed: number;
  emit(event: string, ...args: unknown[]): void;
} {
  const listeners = new Map<string, Listener[]>();
  const fake = {
    listeners,
    shown: 0,
    closed: 0,
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return fake;
    },
    show() {
      fake.shown += 1;
    },
    close() {
      fake.closed += 1;
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
  return fake;
}

function harness() {
  const created: {
    options: NotificationOptionsLike;
    notification: ReturnType<typeof fakeNotification>;
  }[] = [];
  const activated: { sourceId: string; sessionId: string }[] = [];
  const notifier = createNotifier({
    create: (options) => {
      const notification = fakeNotification();
      created.push({ options, notification });
      return notification;
    },
    onActivate: (target) => {
      activated.push(target);
    },
  });
  return { notifier, created, activated };
}

const target = { sourceId: 'claude-code', sessionId: 's1' };

beforeEach(() => {
  clearMainFailures();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('showing', () => {
  it('creates one OS notification with the title and body, and shows it', () => {
    const { notifier, created } = harness();
    notifier.show({ ...target, title: 'refactor the parser', body: 'needs you — vam' });
    expect(created).toHaveLength(1);
    expect(created[0]?.options.title).toBe('refactor the parser');
    expect(created[0]?.options.body).toBe('needs you — vam');
    expect(created[0]?.notification.shown).toBe(1);
  });

  it('replaces an earlier banner for the same session rather than stacking a second', () => {
    const { notifier, created } = harness();
    notifier.show({ ...target, title: 'a', body: 'b' });
    notifier.show({ ...target, title: 'a', body: 'b' });
    expect(created[0]?.notification.closed).toBe(1);
    expect(created).toHaveLength(2);
  });

  it('truncates the body to what macOS will carry, on a character boundary', () => {
    const { notifier, created } = harness();
    const body = 'é'.repeat(200); // 400 bytes of two-byte characters
    notifier.show({ ...target, title: 'a', body });
    const sent = created[0]?.options.body ?? '';
    expect(Buffer.byteLength(sent, 'utf8')).toBeLessThanOrEqual(NOTIFICATION_BODY_BYTES);
    // Never a torn character: every unit is still the one that went in.
    expect([...sent].every((ch) => ch === 'é' || ch === '…')).toBe(true);
  });
});

describe('the instrument: a failure is written where the operator reads', () => {
  it('records the `failed` event into main’s failure buffer with its text verbatim', () => {
    const { notifier, created } = harness();
    notifier.show({ ...target, title: 'a', body: 'b' });
    created[0]?.notification.emit(
      'failed',
      {},
      'Notifications are not allowed for this application',
    );
    const [failure] = mainFailures();
    expect(failure?.action).toBe('show a notification');
    expect(failure?.code).toBe('notification-failed');
    expect(failure?.message).toContain('Notifications are not allowed for this application');
  });

  it('records a verdict when the OS answers neither `show` nor `failed` in time', () => {
    // Silence must be impossible. Electron's own docs only promise `failed`
    // for an unsigned app; if some other path swallows the banner without a
    // word, the log still says so -- and says vam could not tell, rather
    // than claiming a failure it did not observe.
    const { notifier } = harness();
    notifier.show({ ...target, title: 'a', body: 'b' });
    vi.advanceTimersByTime(NOTIFY_VERDICT_TIMEOUT_MS + 1);
    const [failure] = mainFailures();
    expect(failure?.code).toBe('notification-unconfirmed');
    expect(failure?.message).toContain('neither');
  });

  it('records nothing when `show` arrives: a delivered banner is not a failure', () => {
    const { notifier, created } = harness();
    notifier.show({ ...target, title: 'a', body: 'b' });
    created[0]?.notification.emit('show');
    vi.advanceTimersByTime(NOTIFY_VERDICT_TIMEOUT_MS + 1);
    expect(mainFailures()).toEqual([]);
  });

  it('records a synchronous throw from the constructor too', () => {
    const notifier = createNotifier({
      create: () => {
        throw new Error('no notification centre here');
      },
      onActivate: () => {},
    });
    expect(notifier.show({ ...target, title: 'a', body: 'b' })).toBe(false);
    expect(mainFailures()[0]?.message).toContain('no notification centre here');
  });
});

describe('closing and clicking', () => {
  it('closes the banner held for that session, and nothing for one it never showed', () => {
    const { notifier, created } = harness();
    notifier.show({ ...target, title: 'a', body: 'b' });
    notifier.close(target);
    notifier.close({ sourceId: 'claude-code', sessionId: 'never' });
    expect(created[0]?.notification.closed).toBe(1);
  });

  it('a click reports which session the banner was about', () => {
    const { notifier, created, activated } = harness();
    notifier.show({ ...target, title: 'a', body: 'b' });
    created[0]?.notification.emit('click');
    expect(activated).toEqual([target]);
  });

  it('a click does not record an unconfirmed verdict afterwards', () => {
    // A click IS proof of delivery -- nobody clicks a banner that was not
    // shown -- even when `show` never arrived first.
    const { notifier, created } = harness();
    notifier.show({ ...target, title: 'a', body: 'b' });
    created[0]?.notification.emit('click');
    vi.advanceTimersByTime(NOTIFY_VERDICT_TIMEOUT_MS + 1);
    expect(mainFailures()).toEqual([]);
  });
});

describe('an unconfirmed banner is still closable', () => {
  it('close still reaches the handle after the verdict timer fired', () => {
    const { notifier, created } = harness();
    notifier.show({ ...target, title: 'a', body: 'b' });
    vi.advanceTimersByTime(NOTIFY_VERDICT_TIMEOUT_MS + 1);
    notifier.close(target);
    expect(created[0]?.notification.closed).toBe(1);
  });
});

describe('the test banner: the same path, with the verdict handed back', () => {
  /**
   * The settings button (`src/renderer/settings/NotifyTest.tsx`) needs the
   * verdict INLINE, which `show` does not return -- a real banner's verdict is
   * for the error log. So `test()` goes through the same `raise` and resolves
   * with what the OS said, while the log still gets exactly what a real
   * banner's failure would have written.
   */
  it('creates one banner titled vam whose body says it is a test, through `create`', async () => {
    const { notifier, created } = harness();
    const verdict = notifier.test();
    expect(created).toHaveLength(1);
    expect(created[0]?.options.title).toBe('vam');
    expect(created[0]?.options.body.toLowerCase()).toContain('test');
    expect(created[0]?.notification.shown).toBe(1);
    created[0]?.notification.emit('show');
    expect(await verdict).toEqual({ kind: 'sent' });
    expect(mainFailures()).toEqual([]);
  });

  it('resolves `failed` with the OS text verbatim AND records it like a real banner', async () => {
    const { notifier, created } = harness();
    const verdict = notifier.test();
    created[0]?.notification.emit(
      'failed',
      {},
      'Notifications are not allowed for this application',
    );
    expect(await verdict).toEqual({
      kind: 'failed',
      reason: 'Notifications are not allowed for this application',
    });
    // The instrument is not bypassed: the log line is the one a real banner
    // would have produced, field for field.
    const [failure] = mainFailures();
    expect(failure?.action).toBe('show a notification');
    expect(failure?.code).toBe('notification-failed');
    expect(failure?.message).toBe('Notifications are not allowed for this application');
  });

  it('writes the SAME log line a real banner’s failure writes, field for field', async () => {
    // The instrument is what the button exists to exercise. A real `show`
    // and a `test` that both meet the same `failed` must leave records that
    // differ only in the id and the clock.
    const { notifier, created } = harness();
    notifier.show({ ...target, title: 'a', body: 'b' });
    created[0]?.notification.emit('failed', {}, 'UNErrorDomain error 1');
    const verdict = notifier.test();
    created[1]?.notification.emit('failed', {}, 'UNErrorDomain error 1');
    await verdict;
    const [real, test] = mainFailures();
    expect(test).toBeDefined();
    const { id: _a, at: _b, ...realFields } = real ?? { id: 0, at: '' };
    const { id: _c, at: _d, ...testFields } = test ?? { id: 0, at: '' };
    expect(testFields).toEqual(realFields);
  });

  it('resolves `unconfirmed` when the OS says neither in time, and records that too', async () => {
    const { notifier } = harness();
    const verdict = notifier.test();
    vi.advanceTimersByTime(NOTIFY_VERDICT_TIMEOUT_MS + 1);
    expect(await verdict).toEqual({ kind: 'unconfirmed' });
    expect(mainFailures()[0]?.code).toBe('notification-unconfirmed');
  });

  it('resolves `failed` when the constructor throws, with the throw’s text', async () => {
    const notifier = createNotifier({
      create: () => {
        throw new Error('no notification centre here');
      },
      onActivate: () => {},
    });
    expect(await notifier.test()).toEqual({
      kind: 'failed',
      reason: 'no notification centre here',
    });
    expect(mainFailures()[0]?.code).toBe('notification-failed');
  });

  it('resolves exactly once: a `failed` after a `show` changes nothing', async () => {
    const { notifier, created } = harness();
    const verdict = notifier.test();
    created[0]?.notification.emit('show');
    created[0]?.notification.emit('failed', {}, 'late');
    expect(await verdict).toEqual({ kind: 'sent' });
  });

  it('a second test while the first is pending settles the first as unconfirmed', async () => {
    const { notifier, created } = harness();
    const first = notifier.test();
    const second = notifier.test();
    expect(created[0]?.notification.closed).toBe(1);
    expect(await first).toEqual({ kind: 'unconfirmed' });
    created[1]?.notification.emit('show');
    expect(await second).toEqual({ kind: 'sent' });
  });
});

describe('truncateBody', () => {
  it('leaves a short body alone', () => {
    expect(truncateBody('needs you — vam')).toBe('needs you — vam');
  });

  it('cuts a long ASCII body to the byte bound with an ellipsis', () => {
    const cut = truncateBody('x'.repeat(1000));
    expect(Buffer.byteLength(cut, 'utf8')).toBe(NOTIFICATION_BODY_BYTES);
    expect(cut.endsWith('…')).toBe(true);
  });
});
