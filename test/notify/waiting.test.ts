/**
 * THE TRIGGER: WHEN A SESSION GOING `waiting` IS WORTH INTERRUPTING SOMEBODY
 * FOR -- and the four cases where it is not.
 *
 * Main never polls (`src/main/remote/server.ts`'s stream tick carries no
 * payload -- "ask again"), so the only place a PREVIOUS status is held is the
 * renderer. This module is that memory, kept pure: a ledger in, a ledger plus
 * two lists of work out. Every rule below is a rule about noise, which is the
 * only thing that can make a notification feature worse than no feature.
 */

import { describe, expect, it } from 'vitest';
import {
  decideNotifications,
  EMPTY_NOTIFY_LEDGER,
  NOTIFY_COOLDOWN_MS,
  type NotifiableSession,
  notifyKey,
} from '../../src/renderer/notify/waiting.js';

const session = (over: Partial<NotifiableSession> = {}): NotifiableSession => ({
  sourceId: 'claude-code',
  sessionId: 's1',
  status: 'running',
  title: 'refactor the parser',
  project: 'vam',
  ...over,
});

const seen = (sessions: readonly NotifiableSession[], now = 1_000) =>
  decideNotifications(EMPTY_NOTIFY_LEDGER, sessions, { enabled: true, attending: null, now })
    .ledger;

describe('the transition, not the state', () => {
  it('fires once when a session crosses into waiting, and not again on the next poll', () => {
    const running = [session({ status: 'running' })];
    const waiting = [session({ status: 'waiting' })];
    const ledger = seen(running);

    const crossed = decideNotifications(ledger, waiting, {
      enabled: true,
      attending: null,
      now: 2_000,
    });
    expect(crossed.show).toHaveLength(1);
    expect(crossed.show[0]?.sessionId).toBe('s1');

    // The SAME state, one poll later. `useSourceModel` re-reads the whole
    // model every ten seconds; a rule written against the state rather than
    // the crossing would re-fire here, forever, for as long as the session
    // waits.
    const again = decideNotifications(crossed.ledger, waiting, {
      enabled: true,
      attending: null,
      now: 12_000,
    });
    expect(again.show).toEqual([]);

    // AND PAST THE COOLDOWN. Inside it, a rule written against the STATE is
    // indistinguishable from one written against the crossing -- the cooldown
    // hides it (a mutation that fired on `status === 'waiting'` survived the
    // two assertions above). A session still waiting a minute later is not a
    // new wait, and a state rule would re-fire here on every poll forever.
    const later = decideNotifications(again.ledger, waiting, {
      enabled: true,
      attending: null,
      now: 2_000 + NOTIFY_COOLDOWN_MS + 1,
    });
    expect(later.show).toEqual([]);
  });

  it('says nothing about a session it is meeting for the first time', () => {
    // A launch with three sessions already waiting is not three transitions.
    // First sight SEEDS the ledger; only a crossing this module observed is a
    // crossing.
    const first = decideNotifications(EMPTY_NOTIFY_LEDGER, [session({ status: 'waiting' })], {
      enabled: true,
      attending: null,
      now: 1_000,
    });
    expect(first.show).toEqual([]);
    expect(first.ledger.get(notifyKey('claude-code', 's1'))?.status).toBe('waiting');
  });

  it('carries the session and the project, so the banner names which one', () => {
    const ledger = seen([session({ status: 'running' })]);
    const crossed = decideNotifications(
      ledger,
      [session({ status: 'waiting', title: 'refactor the parser', project: 'vam' })],
      { enabled: true, attending: null, now: 2_000 },
    );
    expect(crossed.show[0]?.title).toBe('refactor the parser');
    expect(crossed.show[0]?.body).toContain('vam');
    expect(crossed.show[0]?.body).toContain('needs you');
  });

  it('keys on the source as well as the session, because ids are unique only within a source', () => {
    const before = seen([
      session({ sourceId: 'claude-code', sessionId: 's1' }),
      session({ sourceId: 'codex', sessionId: 's1' }),
    ]);
    const crossed = decideNotifications(
      before,
      [
        session({ sourceId: 'claude-code', sessionId: 's1', status: 'waiting' }),
        session({ sourceId: 'codex', sessionId: 's1', status: 'running' }),
      ],
      { enabled: true, attending: null, now: 2_000 },
    );
    expect(crossed.show.map((r) => r.sourceId)).toEqual(['claude-code']);
  });
});

describe('a flap is one notification, not a stream', () => {
  it('does not re-fire when a session bounces out of waiting and straight back', () => {
    // `to-canvas.ts` derives `waiting` from `newest.output === null`, which is
    // loose enough to flicker across a single poll. Without the cooldown the
    // operator gets a banner per flicker.
    const ledger = seen([session({ status: 'running' })]);
    const first = decideNotifications(ledger, [session({ status: 'waiting' })], {
      enabled: true,
      attending: null,
      now: 2_000,
    });
    expect(first.show).toHaveLength(1);

    const away = decideNotifications(first.ledger, [session({ status: 'running' })], {
      enabled: true,
      attending: null,
      now: 12_000,
    });
    const back = decideNotifications(away.ledger, [session({ status: 'waiting' })], {
      enabled: true,
      attending: null,
      now: 22_000,
    });
    expect(back.show).toEqual([]);
  });

  it('fires again once the cooldown has passed, because that is a new wait', () => {
    const ledger = seen([session({ status: 'running' })]);
    const first = decideNotifications(ledger, [session({ status: 'waiting' })], {
      enabled: true,
      attending: null,
      now: 2_000,
    });
    const away = decideNotifications(first.ledger, [session({ status: 'running' })], {
      enabled: true,
      attending: null,
      now: 3_000,
    });
    const back = decideNotifications(away.ledger, [session({ status: 'waiting' })], {
      enabled: true,
      attending: null,
      now: 2_000 + NOTIFY_COOLDOWN_MS + 1,
    });
    expect(back.show).toHaveLength(1);
  });
});

describe('silent when the operator is already looking at it', () => {
  it('says nothing about the session under the cursor while the window has focus', () => {
    // The difference between useful and hated. `attending` is non-null only
    // when the document is focused AND visible -- the hook decides that; this
    // module only has to honour it.
    const ledger = seen([session({ status: 'running' })]);
    const crossed = decideNotifications(ledger, [session({ status: 'waiting' })], {
      enabled: true,
      attending: { sourceId: 'claude-code', sessionId: 's1' },
      now: 2_000,
    });
    expect(crossed.show).toEqual([]);
    // And the crossing is still RECORDED, or the next poll would read as a
    // fresh one the moment the operator looks away.
    expect(crossed.ledger.get(notifyKey('claude-code', 's1'))?.status).toBe('waiting');
  });

  it('still notifies about a DIFFERENT session while one is attended', () => {
    const ledger = seen([
      session({ sessionId: 's1' }),
      session({ sessionId: 's2', title: 'the other one' }),
    ]);
    const crossed = decideNotifications(
      ledger,
      [
        session({ sessionId: 's1', status: 'waiting' }),
        session({ sessionId: 's2', status: 'waiting', title: 'the other one' }),
      ],
      { enabled: true, attending: { sourceId: 'claude-code', sessionId: 's1' }, now: 2_000 },
    );
    expect(crossed.show.map((r) => r.sessionId)).toEqual(['s2']);
  });

  it('notifies about the focused session when the window is not the one in front', () => {
    // `attending: null` is what the hook passes when `document.hasFocus()` is
    // false: the cursor is still on that session, but nobody is looking at it.
    const ledger = seen([session({ status: 'running' })]);
    const crossed = decideNotifications(ledger, [session({ status: 'waiting' })], {
      enabled: true,
      attending: null,
      now: 2_000,
    });
    expect(crossed.show).toHaveLength(1);
  });
});

describe('clearing', () => {
  it('closes the banner when the session leaves waiting', () => {
    const ledger = seen([session({ status: 'running' })]);
    const shown = decideNotifications(ledger, [session({ status: 'waiting' })], {
      enabled: true,
      attending: null,
      now: 2_000,
    });
    const left = decideNotifications(shown.ledger, [session({ status: 'running' })], {
      enabled: true,
      attending: null,
      now: 12_000,
    });
    expect(left.close).toEqual([{ sourceId: 'claude-code', sessionId: 's1' }]);
  });

  /**
   * FALSIFIED, NOT ASSUMED: the exit that produces a `terminal` row is
   * exactly the shape most likely to fire a notification by accident -- a
   * session the operator was waiting on, that they then `/exit`ed out of to
   * run a command. `crossed` is `before.status !== 'waiting' && session.status
   * === 'waiting'`, which `'terminal'` can never satisfy as either side, so
   * this is provable from the rule's own text; this test is what makes that
   * provable claim a red line if it ever stops being true. It also closes
   * whatever banner was already open, on the SAME `left` rule ordinary
   * `waiting -> running` uses -- exiting the agent is exactly as much a
   * departure from `waiting` as finishing the turn is.
   */
  it('never shows for `waiting -> terminal`, and closes whatever banner was open', () => {
    const ledger = seen([session({ status: 'running' })]);
    const shown = decideNotifications(ledger, [session({ status: 'waiting' })], {
      enabled: true,
      attending: null,
      now: 2_000,
    });
    expect(shown.show).toHaveLength(1);
    const exited = decideNotifications(shown.ledger, [session({ status: 'terminal' })], {
      enabled: true,
      attending: null,
      now: 12_000,
    });
    expect(exited.show).toEqual([]);
    expect(exited.close).toEqual([{ sourceId: 'claude-code', sessionId: 's1' }]);
  });

  it('closes nothing for a session that never had a banner', () => {
    // Suppressed because attended, then back to running: there is no banner on
    // screen, and asking main to close one is a call that means nothing.
    const ledger = seen([session({ status: 'running' })]);
    const suppressed = decideNotifications(ledger, [session({ status: 'waiting' })], {
      enabled: true,
      attending: { sourceId: 'claude-code', sessionId: 's1' },
      now: 2_000,
    });
    const left = decideNotifications(suppressed.ledger, [session({ status: 'running' })], {
      enabled: true,
      attending: null,
      now: 12_000,
    });
    expect(left.close).toEqual([]);
  });

  it('closes the banner of a session that has gone from the model, and forgets it', () => {
    const ledger = seen([session({ status: 'running' })]);
    const shown = decideNotifications(ledger, [session({ status: 'waiting' })], {
      enabled: true,
      attending: null,
      now: 2_000,
    });
    const gone = decideNotifications(shown.ledger, [], {
      enabled: true,
      attending: null,
      now: 12_000,
    });
    expect(gone.close).toEqual([{ sourceId: 'claude-code', sessionId: 's1' }]);
    expect(gone.ledger.size).toBe(0);
  });

  it('does not close twice', () => {
    const ledger = seen([session({ status: 'running' })]);
    const shown = decideNotifications(ledger, [session({ status: 'waiting' })], {
      enabled: true,
      attending: null,
      now: 2_000,
    });
    const left = decideNotifications(shown.ledger, [session({ status: 'done' })], {
      enabled: true,
      attending: null,
      now: 12_000,
    });
    const again = decideNotifications(left.ledger, [session({ status: 'done' })], {
      enabled: true,
      attending: null,
      now: 22_000,
    });
    expect(again.close).toEqual([]);
  });
});

describe('the switch off means nothing happens at all', () => {
  it('asks for no show and no close, whatever the model did', () => {
    const ledger = seen([session({ status: 'running' })]);
    const off = decideNotifications(ledger, [session({ status: 'waiting' })], {
      enabled: false,
      attending: null,
      now: 2_000,
    });
    expect(off.show).toEqual([]);
    expect(off.close).toEqual([]);
  });

  it('forgets everything, so switching it back on seeds rather than floods', () => {
    // Three sessions waiting while the switch was off must not produce three
    // banners the instant it is thrown -- none of those is a crossing this
    // module saw.
    const ledger = seen([session({ status: 'running' })]);
    const off = decideNotifications(ledger, [session({ status: 'waiting' })], {
      enabled: false,
      attending: null,
      now: 2_000,
    });
    expect(off.ledger.size).toBe(0);
    const on = decideNotifications(off.ledger, [session({ status: 'waiting' })], {
      enabled: true,
      attending: null,
      now: 3_000,
    });
    expect(on.show).toEqual([]);
  });
});
