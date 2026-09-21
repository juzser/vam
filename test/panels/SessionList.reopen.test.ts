/**
 * REOPEN, IN THE ROW MENU, and the four ways it says no.
 *
 * `docs/design/reopening-a-session.md` §3's first rule is that reopening is
 * "never offered for a session that is live". This menu's own rule is that
 * every item is ALWAYS DRAWN and an unavailable one carries its reason, so
 * "not offered" here means disabled-and-explained rather than absent --
 * which is the stronger of the two, because a control that vanishes teaches
 * the operator nothing about why.
 *
 * The refusals are enforced again at the spawn (`sources/codex/resume.ts`,
 * `sources/claude-code/resume.ts`). That is not duplication: this menu is
 * drawn from a poll that is up to ten seconds old, and the phone's HTTP routes
 * do not go through this file at all.
 */

import { describe, expect, it } from 'vitest';
import { rowMenuItems } from '../../src/renderer/panels/SessionList.js';

const SESSION = '00000000-1111-2222-3333-444444444444';

const menu = (over: Partial<Parameters<typeof rowMenuItems>[1]> = {}) =>
  rowMenuItems(SESSION, {
    closing: false,
    onClose: () => {},
    onReopen: () => {},
    ended: true,
    canReopen: true,
    ...over,
  });

const reopen = (over: Partial<Parameters<typeof rowMenuItems>[1]> = {}) =>
  menu(over).find((item) => item.id === 'reopen');

describe('the reopen item', () => {
  it('is always in the menu, wherever the row came from', () => {
    expect(menu().map((item) => item.id)).toContain('reopen');
    expect(reopen({ ended: false, canReopen: false })).toBeDefined();
  });

  it('is offered for a session that has ended, on a source that can reopen', () => {
    expect(reopen()?.unavailable ?? null).toBeNull();
  });

  it('calls back with the row it was opened on', () => {
    const asked: string[] = [];
    const item = menu({ onReopen: (id) => asked.push(id) }).find((i) => i.id === 'reopen');
    item?.onPick();
    expect(asked).toEqual([SESSION]);
  });

  /**
   * THE 409 RULE. `--resume` on a running session starts a COPY, and two
   * processes on one conversation is the hazard that once made Close kill the
   * wrong tmux session.
   */
  it('refuses a session that has not ended, and says it is still running', () => {
    const words = reopen({ ended: false })?.unavailable ?? '';
    expect(words).not.toBe('');
    expect(words).toContain('still running');
  });

  it('refuses when the source cannot reopen at all', () => {
    const words = reopen({ canReopen: false })?.unavailable ?? '';
    expect(words).not.toBe('');
  });

  /** A row on its way out takes no orders -- the rule the other items keep. */
  it('refuses while the row is closing, like every other item', () => {
    expect(reopen({ closing: true })?.unavailable).toContain('closing');
  });

  /** The phone shell draws this list with no reopen flow wired. */
  it('says so where there is no route for it', () => {
    expect(reopen({ onReopen: undefined })?.unavailable).not.toBe(null);
  });

  it('leaves the three items that were here alone', () => {
    expect(menu().map((item) => item.id)).toEqual(['rename', 'icon', 'reopen', 'close']);
  });
});
