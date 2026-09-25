import { describe, expect, it } from 'vitest';
import { paneRow, terminalRow } from '../../src/main/sources/claude-code/pane-row.js';
import type { TmuxSession } from '../../src/main/sources/tmux/spawn.js';

function session(over: Partial<TmuxSession> = {}): TmuxSession {
  return { project: 'p', pid: '1', name: 'vam-demo-a1b2c3', ...over };
}

describe('paneRow — createdAt from tmux’s own session_created', () => {
  it('reads a real session_created as an ISO instant', () => {
    const row = paneRow(session({ sessionCreated: '1700000000' }));
    expect(row.createdAt).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('is null when tmux did not carry the field -- an older tmux, or a stub', () => {
    const row = paneRow(session());
    expect(row.createdAt).toBeNull();
  });

  it('is null rather than NaN for a garbage value, never throws', () => {
    const row = paneRow(session({ sessionCreated: 'not-a-number' }));
    expect(row.createdAt).toBeNull();
  });
});

describe('terminalRow — createdAt carries the conversation’s own, when handed one', () => {
  it('passes the transcript-derived createdAt through', () => {
    const row = terminalRow(session(), {
      sessionId: 's1',
      title: 't',
      decisions: [],
      branch: null,
      resumeCommand: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(row.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('is null when the caller has no answer either', () => {
    const row = terminalRow(session(), {
      sessionId: 's1',
      title: 't',
      decisions: [],
      branch: null,
      resumeCommand: null,
      createdAt: null,
    });
    expect(row.createdAt).toBeNull();
  });
});
