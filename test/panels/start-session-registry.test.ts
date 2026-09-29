import { describe, expect, it } from 'vitest';
import {
  registerStartSession,
  triggerStartSession,
} from '../../src/renderer/panels/start-session-registry.js';

describe('start-session registry', () => {
  it('runs only the triggered session, and unregistering one leaves the other', () => {
    const ran: string[] = [];
    const offA = registerStartSession('A', () => ran.push('A'));
    const offB = registerStartSession('B', () => ran.push('B'));
    expect(triggerStartSession('A')).toBe(true);
    expect(ran).toEqual(['A']);
    offA();
    expect(triggerStartSession('A')).toBe(false);
    expect(triggerStartSession('B')).toBe(true);
    expect(ran).toEqual(['A', 'B']);
    offB();
  });

  it('returns false and runs nothing for an unregistered id', () => {
    const ran: string[] = [];
    const off = registerStartSession('A', () => ran.push('A'));
    expect(triggerStartSession('Z')).toBe(false);
    expect(ran).toEqual([]);
    off();
  });

  it('a stale unregister does not remove a newer callback of the same id', () => {
    const ran: string[] = [];
    const off1 = registerStartSession('A', () => ran.push('old'));
    registerStartSession('A', () => ran.push('new'))();
    off1();
    expect(triggerStartSession('A')).toBe(false);
  });
});
