/**
 * AN ORDINARY EXIT IS NOT A KILL, and nothing pinned it.
 *
 * `SpawnFailure.signal` was typed `string | undefined`, and the classifier
 * asked `signal !== undefined`. Node sends `null` for an ordinary non-zero
 * exit -- measured on v26.5.0 -- and `null !== undefined` is true, so EVERY
 * ordinary failure took the kill arm and reported "killed by null".
 *
 * The wrong sentence was the small half. The kill arm sits above every branch
 * that reads what the tool actually said, so those were unreachable in
 * production: `spawn.ts`'s `no-server`, `no-such-session` and `session-exists`.
 *
 * THE OTHER CLASSIFIER THIS ONCE GUARDED IS GONE. `deliver.ts` had its own
 * `classifyDeliverFailure` with the identical bug, and this file used to pin
 * both. That module's whole `claude --resume` channel was retired -- vam types
 * into the pane now (`reply.ts`), and a failed keystroke is classified by THIS
 * same `classifyTmuxFailure` -- so there is one classifier left and one place
 * the mutation can return. The tmux path is now the only path a prompt's
 * failure travels, which makes this guard the whole of the coverage.
 *
 * THE FIX SHIPPED WITHOUT A GUARD. Reintroducing `signal !== undefined` left
 * every test green, which is how the defect could return the day somebody
 * "simplifies" the helper. These cases fail on that mutation, and they assert
 * the RECOVERED branch rather than the absence of the word "killed": a test for
 * the sentence would pass on a classifier that had merely renamed it.
 */
import { describe, expect, it } from 'vitest';
import { classifyTmuxFailure } from '../../src/main/sources/tmux/spawn.js';

/**
 * What node really hands back for `exit 1`, measured on v26.5.0. `message`
 * is required by `SpawnFailure` and is the string execFile builds from the
 * exit code alone -- it names no signal, which is the whole point: the kill
 * claim never came from the child, it came from the reader.
 */
const ORDINARY_EXIT = {
  message: 'Command failed with exit code 1',
  code: 1,
  killed: false,
  signal: null,
} as const;

/** An external `kill -9`: node reports the signal that really ended it. */
const REAL_KILL = {
  message: 'Command failed: killed by SIGKILL',
  code: null,
  killed: false,
  signal: 'SIGKILL',
} as const;

describe('an ordinary non-zero exit', () => {
  it('lets tmux say what it actually said, instead of claiming a kill', () => {
    const error = classifyTmuxFailure({
      failure: ORDINARY_EXIT,
      stderr: 'no server running on /tmp/vam',
      action: 'listing sessions',
    });
    expect(error.code).not.toBe('killed');
    expect(error.code).toBe('no-server');
  });

  it('lets the pane refusal survive, instead of claiming a kill', () => {
    const error = classifyTmuxFailure({
      failure: ORDINARY_EXIT,
      stderr: "can't find pane: =vam-atlas-a1b2c3:",
      action: 'typing a reply into session vam-atlas-a1b2c3',
    });
    expect(error.code).not.toBe('killed');
    expect(error.code).toBe('no-such-session');
  });
});

describe('a real signal still reads as one', () => {
  it('keeps the kill arm reachable for tmux', () => {
    const error = classifyTmuxFailure({
      failure: REAL_KILL,
      stderr: '',
      action: 'listing sessions',
    });
    expect(error.code).toBe('killed');
  });
});
