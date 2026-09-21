/**
 * REOPENING A CODEX THREAD, and the four things that must refuse.
 *
 * `docs/design/reopening-a-session.md` (PR 409) wrote these rules for Claude
 * Code; they hold word for word here, and Codex is the easier half because
 * `codex resume <uuid>` already exists and `threads` already carries the `cwd`
 * to run it in.
 *
 * MEASURED, codex-cli 0.153.2, on a private `-L` tmux socket in a throwaway
 * directory: `codex resume <uuid>` replayed the thread's own turns and took
 * the SAME uuid's writer lock, so a reopened thread is the same thread and the
 * ordinary discovery path finds it live on the next poll. The thread was
 * deleted afterwards and the store went back to the 789 rows it started with.
 *
 * EVERY FIXTURE HERE IS INVENTED, on this directory's own rule
 * (`claude-code-tail-window.test.ts`). Nothing here spawns tmux or codex.
 */

import { describe, expect, it } from 'vitest';
import type { Liveness } from '../../src/main/sources/codex/liveness.js';
import { codexResumeCommand, resumeThread } from '../../src/main/sources/codex/resume.js';
import type { ThreadRow } from '../../src/main/sources/codex/store.js';
import type { TmuxRun } from '../../src/main/sources/tmux/spawn.js';

const THREAD = '00000000-1111-2222-3333-444444444444';
const CWD = '/invented/work/a-repo';

const row = (over: Partial<ThreadRow> = {}): ThreadRow => ({
  id: THREAD,
  rolloutPath: '/invented/rollouts/none.jsonl',
  cwd: CWD,
  preview: 'an invented first prompt',
  name: null,
  model: 'an-invented-model',
  branch: null,
  recencyAtMs: 1_700_000_000_000,
  ...over,
});

/** Records argv and reports success, so a refusal is provably a NON-spawn. */
const recordingTmux = (calls: string[][]): TmuxRun => {
  return async (argv) => {
    calls.push([...argv]);
    return { failure: null, stdout: '4242', stderr: '' };
  };
};

const attempt = async (over: Partial<Parameters<typeof resumeThread>[0]> = {}) => {
  const calls: string[][] = [];
  const failure = await resumeThread({
    threadId: THREAD,
    threads: async () => [row()],
    liveness: (): Liveness => 'ended',
    exists: () => true,
    run: recordingTmux(calls),
    name: 'vam-fixed-name',
    ...over,
  });
  return { failure, calls };
};

describe('codexResumeCommand', () => {
  it('is `codex resume <uuid>`, which is what was measured', () => {
    expect(codexResumeCommand(THREAD)).toEqual(['codex', 'resume', THREAD]);
  });

  /**
   * `newSessionArgv` already refuses a command whose first word looks like an
   * option, and the first word here is always `codex`. What it does NOT check
   * is the THIRD word, which is the one that comes out of a database vam does
   * not own — so it is checked here, before it can become argv at all.
   */
  it('refuses to build a command out of anything that is not a bare uuid', () => {
    for (const hostile of ['--help', '-x', '; rm -rf /', '', 'a b', '../../etc']) {
      expect(codexResumeCommand(hostile)).toBeNull();
    }
  });
});

describe('resumeThread', () => {
  it('starts the thread’s own `codex resume` in the thread’s own directory', async () => {
    const { failure, calls } = await attempt();
    expect(failure).toBeNull();
    const newSession = calls[0] ?? [];
    expect(newSession).toContain('new-session');
    expect(newSession.slice(-3)).toEqual(['codex', 'resume', THREAD]);
    // The cwd is the STORE's, never one the caller passed in.
    expect(newSession[newSession.indexOf('-c') + 1]).toBe(CWD);
  });

  /**
   * "Tagged so the ordinary discovery path picks it up." For Codex the row
   * comes back from the store either way, but the pairing is what a later
   * stage needs to know vam owns this pane, and recording it is free now and
   * unrecoverable later.
   */
  it('tags the session with the project the thread belongs to', async () => {
    const { calls } = await attempt();
    const tag = calls.find((argv) => argv[0] === 'set-option') ?? [];
    expect(tag).toContain('@vam-project');
    expect(tag[tag.length - 1]).toMatch(/^codex:a-repo-[0-9a-f]{8}$/);
  });

  /**
   * THE RULE THE 409 SPEC PUTS FIRST. Resuming a running session starts a
   * SECOND process on one conversation. For Claude Code that collapses a row
   * keyed `<sessionId>#<pid>`; for Codex both processes would fight over one
   * writer lock and one rollout file. Never offered, and refused even if the
   * offer is bypassed — the control is drawn from the same fact, but a
   * refusal that only exists in the UI is not a refusal.
   */
  it('refuses a thread a Codex is still writing, and spawns nothing', async () => {
    const { failure, calls } = await attempt({ liveness: () => 'live' });
    expect(failure?.code).toBe('already-running');
    expect(failure?.message).toContain('already');
    expect(calls).toEqual([]);
  });

  /** `unknown` is not `ended`: vam may not claim an ending it did not see. */
  it('refuses a thread it could not check, rather than guessing it is over', async () => {
    const { failure, calls } = await attempt({ liveness: () => 'unknown' });
    expect(failure?.code).toBe('liveness-unknown');
    expect(calls).toEqual([]);
  });

  /**
   * "The cwd comes from the transcript, and the reopen is refused if that
   * directory no longer exists, NAMING THE PATH" — 409 §3, and the same shape
   * as `whyNotARepository`'s refusal. Measured: 3 of the 12 rows this source
   * drew on the operator's machine named a directory that is gone.
   */
  it('refuses a directory that is gone, and says which one', async () => {
    const { failure, calls } = await attempt({ exists: () => false });
    expect(failure?.code).toBe('directory-missing');
    expect(failure?.message).toContain(CWD);
    expect(calls).toEqual([]);
  });

  it('refuses a thread the store has never heard of, by name', async () => {
    const { failure, calls } = await attempt({ threads: async () => [] });
    expect(failure?.code).toBe('unknown-thread');
    expect(failure?.message).toContain(THREAD);
    expect(calls).toEqual([]);
  });

  it('refuses an id that is not a thread id before it reaches tmux', async () => {
    const { failure, calls } = await attempt({ threadId: '--dangerous' });
    expect(failure?.code).toBe('unknown-thread');
    expect(calls).toEqual([]);
  });

  /**
   * NO `--fork-session` EQUIVALENT. 409 §3: reopening means continuing the
   * same conversation, and a fork would silently mint a second id for one
   * history. `codex resume <uuid>` addresses the thread itself — this asserts
   * no extra word crept in beside it.
   */
  it('passes codex nothing but the thread it was asked to resume', async () => {
    const { calls } = await attempt();
    const argv = calls[0] ?? [];
    const command = argv.slice(argv.indexOf('-c') + 2);
    expect(command).toEqual(['codex', 'resume', THREAD]);
  });
});
