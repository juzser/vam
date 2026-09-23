/**
 * REOPENING A CLAUDE CODE SESSION, and the collision the 409 spec named.
 *
 * `docs/design/reopening-a-session.md` §3: `--resume` on a session that is
 * already running starts a COPY, "and two processes on one session id is a
 * hazard this repo has already been bitten by: a row is keyed
 * `<sessionId>#<pid>`, and `agents.ts`'s own comment warns that keying by
 * session id alone collapses a row -- which once made Close kill the wrong
 * tmux session."
 *
 * The precise rule that falls out of that is sharper than "this row is not
 * running", and this file is mostly about the difference: two rows can share
 * one session id, one of them finished and one of them alive, and reopening
 * the FINISHED row would still put a second process on a conversation a live
 * process is holding.
 *
 * EVERY FIXTURE HERE IS INVENTED, on this directory's own rule
 * (`claude-code-tail-window.test.ts`). Nothing here spawns tmux or claude.
 */

import { describe, expect, it } from 'vitest';
import type { LiveAgent } from '../../src/main/sources/claude-code/agents.js';
import {
  claudeResumeCommand,
  resumeClaudeSession,
} from '../../src/main/sources/claude-code/resume.js';
import { loginShellCommand } from '../../src/main/sources/tmux/shell.js';
import type { TmuxRun } from '../../src/main/sources/tmux/spawn.js';

const SESSION = '00000000-1111-2222-3333-444444444444';
const CWD = '/invented/work/a-repo';

const agent = (over: Partial<LiveAgent> = {}): LiveAgent =>
  ({
    key: `${SESSION}#4242`,
    sessionId: SESSION,
    name: null,
    cwd: CWD,
    status: 'done',
    kind: 'background',
    startedAt: null,
    pid: 4242,
    ...over,
  }) as LiveAgent;

const recordingTmux = (calls: string[][]): TmuxRun => {
  return async (argv) => {
    calls.push([...argv]);
    return { failure: null, stdout: '4242', stderr: '' };
  };
};

const attempt = async (over: Partial<Parameters<typeof resumeClaudeSession>[0]> = {}) => {
  const calls: string[][] = [];
  const failure = await resumeClaudeSession({
    rowId: `${SESSION}#4242`,
    agents: async () => ({ kind: 'ok', agents: [agent()] }),
    exists: () => true,
    run: recordingTmux(calls),
    name: 'vam-fixed-name',
    ...over,
  });
  return { failure, calls };
};

describe('claudeResumeCommand', () => {
  it('is the provider’s own command plus `--resume <id>`', () => {
    expect(claudeResumeCommand(SESSION)).toEqual(['claude', '--resume', SESSION]);
  });

  /**
   * NO `--fork-session`, which 409 §3 refuses by name: forking silently mints
   * a second id for one history, which is the collision above by another road.
   */
  it('never forks', () => {
    expect(claudeResumeCommand(SESSION)).not.toContain('--fork-session');
  });

  it('refuses an id that is not a session id, before it can become a flag', () => {
    for (const hostile of ['--dangerously-skip-permissions', '-c', '', 'a b', '../x']) {
      expect(claudeResumeCommand(hostile)).toBeNull();
    }
  });
});

describe('resumeClaudeSession', () => {
  it('starts a SHELL in the session’s own directory, then types `claude --resume` into it', async () => {
    // Not a direct spawn any more -- see the module header for the measured
    // reason (Ctrl+C used to end the whole tmux session, not just Claude).
    const { failure, calls } = await attempt();
    expect(failure).toBeNull();
    const spawnArgv = calls[0] ?? [];
    expect(spawnArgv).toContain('new-session');
    expect(spawnArgv.slice(-2)).toEqual(loginShellCommand());
    expect(spawnArgv[spawnArgv.indexOf('-c') + 1]).toBe(CWD);
    expect(calls).toContainEqual([
      'send-keys',
      '-t',
      '=vam-fixed-name:',
      '-l',
      '--',
      `claude --resume ${SESSION}`,
    ]);
    expect(calls).toContainEqual(['send-keys', '-t', '=vam-fixed-name:', 'Enter']);
    // TYPED AFTER THE PANE EXISTS: the send-keys calls come after new-session,
    // never before it.
    expect(calls.findIndex((argv) => argv[0] === 'send-keys')).toBeGreaterThan(
      calls.findIndex((argv) => argv[0] === 'new-session'),
    );
  });

  it('tags it exactly as a session vam created, so discovery finds it', async () => {
    const { calls } = await attempt();
    const tag = calls.find((argv) => argv[0] === 'set-option') ?? [];
    expect(tag).toContain('@vam-project');
    expect(tag[tag.length - 1]).toMatch(/^claude-code:a-repo-[0-9a-f]{8}$/);
  });

  /**
   * `docs/design/vam-owns-the-session.md` §2, step 1: a resume already holds
   * the native id in its hand -- `claudeResumeCommand(row.sessionId)` is
   * given exactly it -- so vam writes `@vam-session` for free, in the same
   * run of calls, rather than guessing it later.
   */
  it('writes @vam-session with the id it is resuming, in the same run of calls', async () => {
    const { calls } = await attempt();
    const tag = calls.find((argv) => argv.includes('@vam-session'));
    expect(tag).toEqual(['set-option', '-t', 'vam-fixed-name', '@vam-session', SESSION]);
  });

  it('refuses a row that is still running', async () => {
    const { failure, calls } = await attempt({
      agents: async () => ({ kind: 'ok', agents: [agent({ status: 'running' })] }),
    });
    expect(failure?.code).toBe('already-running');
    expect(calls).toEqual([]);
  });

  /**
   * THE ONE THE SPEC IS ACTUALLY ABOUT. This row has ended. Another row, with
   * a different pid, is alive on the SAME session id -- which `agents.ts`
   * documents as a real, measured state. Resuming the finished row would put a
   * second process on the conversation the live one is holding.
   */
  it('refuses when another process is live on the same session id', async () => {
    const { failure, calls } = await attempt({
      agents: async () => ({
        kind: 'ok',
        agents: [
          agent({ key: `${SESSION}#4242`, status: 'done' }),
          agent({ key: `${SESSION}#4343`, pid: 4343, status: 'running' } as Partial<LiveAgent>),
        ],
      }),
    });
    expect(failure?.code).toBe('already-running');
    expect(failure?.message).toContain('another');
    expect(calls).toEqual([]);
  });

  /** And a second finished row on the same id is not a reason to refuse. */
  it('allows it when every process on that session id has finished', async () => {
    const { failure } = await attempt({
      agents: async () => ({
        kind: 'ok',
        agents: [
          agent({ key: `${SESSION}#4242`, status: 'done' }),
          agent({ key: `${SESSION}#4343`, pid: 4343, status: 'failed' } as Partial<LiveAgent>),
        ],
      }),
    });
    expect(failure).toBeNull();
  });

  it('refuses a directory that is gone, and names it', async () => {
    const { failure, calls } = await attempt({ exists: () => false });
    expect(failure?.code).toBe('directory-missing');
    expect(failure?.message).toContain(CWD);
    expect(calls).toEqual([]);
  });

  it('refuses a row it cannot find', async () => {
    const { failure, calls } = await attempt({
      agents: async () => ({ kind: 'ok', agents: [] }),
    });
    expect(failure?.code).toBe('unknown-session');
    expect(calls).toEqual([]);
  });

  /**
   * An agent list vam could not read is not an empty one. Falling through to
   * "nothing is running" here would spawn a second process precisely when vam
   * has lost sight of the first.
   */
  it('refuses when it could not read the agent list at all', async () => {
    const { failure, calls } = await attempt({
      agents: async () => ({ kind: 'unavailable', code: 'cli-missing', message: 'no claude' }),
    });
    expect(failure?.code).toBe('cli-missing');
    expect(calls).toEqual([]);
  });
});
