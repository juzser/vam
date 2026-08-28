import { describe, expect, it } from 'vitest';
import { relativeTime } from '../../src/adapter/relative-time.js';

const NOW = new Date('2026-08-27T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('relativeTime', () => {
  it('calls anything under a minute now', () => {
    expect(relativeTime(ago(0), NOW)).toBe('now');
    expect(relativeTime(ago(59_000), NOW)).toBe('now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(relativeTime(ago(60_000), NOW)).toBe('1m');
    expect(relativeTime(ago(59 * 60_000), NOW)).toBe('59m');
    expect(relativeTime(ago(60 * 60_000), NOW)).toBe('1h');
    expect(relativeTime(ago(23 * 3_600_000), NOW)).toBe('23h');
    expect(relativeTime(ago(24 * 3_600_000), NOW)).toBe('1d');
    expect(relativeTime(ago(9 * 24 * 3_600_000), NOW)).toBe('9d');
  });

  it('rounds down, so nothing ever reads older than it is', () => {
    expect(relativeTime(ago(119_000), NOW)).toBe('1m');
  });

  it('says now for a factory clock that runs slightly ahead', () => {
    // The factory stamps its own events. a negative age would be an alarming
    // way to say "this second" about an event that has just landed.
    expect(relativeTime(new Date(NOW.getTime() + 3_000).toISOString(), NOW)).toBe('now');
  });

  it('shows an unreadable timestamp as itself rather than guessing', () => {
    // A source bug. Rendering it as `now` would keep it hidden.
    expect(relativeTime('not-a-date', NOW)).toBe('not-a-date');
  });
});
