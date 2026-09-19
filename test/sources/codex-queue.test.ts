/**
 * The one write vam performs against Codex, as argv and as a refusal.
 *
 * NOTHING HERE SPAWNS `codex`. Running it would queue a message into the
 * operator's own Codex and spend their tokens, which is exactly why argv is a
 * pure function -- the same separation `pull-requests.ts` and `pr-actions.ts`
 * already keep. Every id and message below is invented.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  classifyQueueFailure,
  isThreadId,
  queueArgv,
  queueMessage,
} from '../../src/main/sources/codex/queue.js';

const THREAD = '00000000-1111-2222-3333-444444444444';

describe('queueArgv', () => {
  it('addresses the thread by uuid and puts the message behind its own flag', () => {
    expect(queueArgv(THREAD, 'hello')).toEqual(['queue', '--thread', THREAD, '--message', 'hello']);
  });

  it('carries a message that looks like an option as one argument', () => {
    // An argv ARRAY, never a shell line: the value follows `--message`, so
    // even this reaches Codex as the message.
    const argv = queueArgv(THREAD, '--help; rm -rf /');
    expect(argv).toHaveLength(5);
    expect(argv[4]).toBe('--help; rm -rf /');
  });

  it('carries newlines and quotes unchanged', () => {
    const message = 'line one\n"line two"\n$(whoami)';
    expect(queueArgv(THREAD, message)[4]).toBe(message);
  });
});

describe('isThreadId', () => {
  it('accepts the shape threads.id really has', () => {
    expect(isThreadId(THREAD)).toBe(true);
  });

  it('refuses anything that could be a session NAME instead', () => {
    // `--thread` takes "Session UUID or exact session name", and the row id
    // arrives from the renderer, the least trusted process in the app.
    expect(isThreadId('my-favourite-session')).toBe(false);
    expect(isThreadId(`${THREAD} extra`)).toBe(false);
    expect(isThreadId(`${THREAD}#4399`)).toBe(false);
    expect(isThreadId('')).toBe(false);
  });
});

describe('queueMessage', () => {
  it('refuses a thread id it did not recognise WITHOUT spawning anything', async () => {
    const run = vi.fn();
    const failure = await queueMessage({ threadId: 'not-an-id', message: 'hi', run });
    expect(failure).toMatchObject({ kind: 'refused', code: 'not-a-thread-id' });
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses an empty message without spawning anything', async () => {
    const run = vi.fn();
    expect(await queueMessage({ threadId: THREAD, message: '   ', run })).toMatchObject({
      code: 'empty-message',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('answers null when codex queued it', async () => {
    const run = vi.fn(async () => ({
      stdout: 'Queued message <id> for thread <id>',
      stderr: '',
      failed: false,
    }));
    expect(await queueMessage({ threadId: THREAD, message: 'hi', run })).toBeNull();
    expect(run).toHaveBeenCalledWith(queueArgv(THREAD, 'hi'));
  });

  it('forwards Codex’s own refusal with its words intact', async () => {
    const run = vi.fn(async () => ({
      stdout: '',
      stderr: 'error: session not found',
      failed: true,
    }));
    const failure = await queueMessage({ threadId: THREAD, message: 'hi', run });
    expect(failure).toMatchObject({ kind: 'refused', code: 'unknown-thread' });
    expect(failure?.message).toContain('session not found');
  });
});

describe('classifyQueueFailure', () => {
  it('names a missing codex rather than blaming the thread', () => {
    const out = classifyQueueFailure({ stdout: '', stderr: '', code: 'ENOENT', failed: true });
    expect(out.code).toBe('codex-missing');
    expect(out.message).toContain('`codex`');
  });

  it('says a timeout cannot report whether the message was queued', () => {
    const out = classifyQueueFailure({ stdout: '', stderr: '', timedOut: true, failed: true });
    expect(out.code).toBe('timed-out');
    // The honest claim: vam does not know, and must not say it failed either.
    expect(out.message).toContain('whether');
  });

  it('keeps a failure with no message readable', () => {
    const out = classifyQueueFailure({ stdout: '', stderr: '', failed: true });
    expect(out.code).toBe('queue-failed');
    expect(out.message).toContain('no message');
  });
});
