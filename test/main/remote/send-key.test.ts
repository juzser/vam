/**
 * The phone's remote key route, at the resolution layer -- no HTTP, no real
 * tmux, no real `claude` CLI. `run`/`listAgents`/`readPanes` are all
 * injected (`send-key.ts`'s own doc on why), so every test below asserts the
 * exact argv this module would hand a real tmux, never a spawn.
 *
 * `test/main/remote/send-key-route.test.ts` is the other half: the HTTP
 * route itself (auth, the allowlist's 400, the read-only 404), with this
 * module's own `sendRemoteKey` mocked out so that suite never reaches here.
 */

import { describe, expect, it } from 'vitest';
import { isRemoteKeyId, REMOTE_KEY_IDS, sendRemoteKey } from '../../../src/main/remote/send-key.js';
import type { AgentsResult } from '../../../src/main/sources/claude-code/agents.js';
import { projectIdOf } from '../../../src/main/sources/claude-code/project-id.js';
import type { TmuxRun, TmuxRunResult } from '../../../src/main/sources/tmux/spawn.js';

const ok = (stdout: string): TmuxRunResult => ({ failure: null, stdout, stderr: '' });
const failed = (stderr: string): TmuxRunResult => ({
  failure: { message: 'tmux failed' },
  stdout: '',
  stderr,
});

/** `list-sessions -F`'s own seven tab-separated fields (`terminal/pane.ts`'s
 *  own test, `pane.test.ts`, holds the format string this mirrors). */
function sessionLine(fields: {
  project?: string;
  pid?: string;
  name: string;
  command?: string;
  vamSessionId?: string;
  cwd?: string;
  created?: string;
}): string {
  return [
    fields.project ?? '',
    fields.pid ?? '',
    fields.name,
    fields.command ?? '',
    fields.vamSessionId ?? '',
    fields.cwd ?? '',
    fields.created ?? '',
  ].join('\t');
}

/** Records every argv and answers each command from `answers`, by verb. */
function runner(answers: Record<string, TmuxRunResult>): {
  run: TmuxRun;
  argvs: (readonly string[])[];
} {
  const argvs: (readonly string[])[] = [];
  const run: TmuxRun = async (argv) => {
    argvs.push(argv);
    return answers[argv[0] ?? ''] ?? failed(`no stub for ${argv[0]}`);
  };
  return { run, argvs };
}

const noAgents = (): Promise<AgentsResult> => Promise.resolve({ kind: 'ok', agents: [] });
const noPanes = (): Promise<ReadonlyMap<string, string>> => Promise.resolve(new Map());

describe('the allowlist', () => {
  it('accepts exactly the six ids the phone strip presses', () => {
    for (const id of REMOTE_KEY_IDS) {
      expect(isRemoteKeyId(id)).toBe(true);
    }
    expect(REMOTE_KEY_IDS).toEqual(['escape', 'tab', 'enter', 'back-tab', 'space', 'backspace']);
  });

  /**
   * FALSIFICATION TARGET: comment out any one arm of `REMOTE_KEY_SET`'s
   * `REMOTE_KEY_IDS` literal (or widen `isRemoteKeyId` to `typeof value ===
   * 'string'` alone) and this red-lines immediately -- every one of these is
   * a real tmux key name, a real `PaneKey.kind`, or free text, and none of
   * them may be typed into a pane through this route.
   */
  it('refuses every tmux key name, PaneKey kind, and free text that is not one of the six', () => {
    const rejected = [
      'Escape', // tmux's own spelling, not vam's -- see `send-key.ts`'s header
      'Tab',
      'Enter',
      'BTab',
      'Space',
      'BSpace',
      'up',
      'down', // the desktop strip's own extra two -- not served remotely
      'control',
      'wheel',
      'paste',
      'C-c', // a control chord -- never reachable from this route at all
      '',
      'escape ', // whitespace is not the same string
      'ESCAPE',
      123,
      null,
      undefined,
      {},
      ['escape'],
    ];
    for (const value of rejected) {
      expect(isRemoteKeyId(value), `isRemoteKeyId(${JSON.stringify(value)})`).toBe(false);
    }
  });
});

describe('a pane row (no agent yet)', () => {
  const NAME = 'vam-atlas-a1b2c3';
  const ROW = `pane:${NAME}`;

  it('sends the exact tmux argv for each allowed key', async () => {
    const cases: readonly [string, readonly string[]][] = [
      ['escape', ['send-keys', '-t', `=${NAME}:`, 'Escape']],
      ['enter', ['send-keys', '-t', `=${NAME}:`, 'Enter']],
      ['back-tab', ['send-keys', '-t', `=${NAME}:`, 'BTab']],
      ['backspace', ['send-keys', '-t', `=${NAME}:`, 'BSpace']],
      ['space', ['send-keys', '-t', `=${NAME}:`, '-l', '--', ' ']],
      ['tab', ['send-keys', '-t', `=${NAME}:`, '-l', '--', '\t']],
    ];
    for (const [id, expected] of cases) {
      const { run, argvs } = runner({
        'list-sessions': ok(sessionLine({ name: NAME })),
        'send-keys': ok(''),
      });
      const result = await sendRemoteKey(ROW, id as never, {
        run,
        listAgents: noAgents,
        readPanes: noPanes,
      });
      expect(result, `sending ${id}`).toBeNull();
      const sendKeysCall = argvs.find((argv) => argv[0] === 'send-keys');
      expect(sendKeysCall, `the send-keys argv for ${id}`).toEqual(expected);
    }
  });

  it('refuses a pane vam never started, and sends nothing', async () => {
    const { run, argvs } = runner({
      'list-sessions': ok(sessionLine({ name: 'someone-elses-pane' })),
    });
    const result = await sendRemoteKey(ROW, 'escape', {
      run,
      listAgents: noAgents,
      readPanes: noPanes,
    });
    expect(result?.code).toBe('not-vam-started');
    expect(
      argvs.some((argv) => argv[0] === 'send-keys'),
      'no key was ever sent',
    ).toBe(false);
  });

  it('reports vam could not even ask tmux, rather than claiming a pairing problem', async () => {
    const { run } = runner({ 'list-sessions': failed('no such file or directory') });
    const result = await sendRemoteKey(ROW, 'escape', {
      run,
      listAgents: noAgents,
      readPanes: noPanes,
    });
    expect(result?.kind).toBe('unreachable');
  });
});

describe('an agent row (a live session)', () => {
  const NAME = 'vam-atlas-a1b2c3';
  const CWD = '/tmp/atlas';
  const PROJECT = projectIdOf(CWD);
  const AGENT_ROW = 's1#4242';

  it('resolves through the published pane, exactly as recordPrompt does, and sends', async () => {
    const { run, argvs } = runner({
      'list-sessions': ok(sessionLine({ project: PROJECT, name: NAME })),
      'send-keys': ok(''),
    });
    const listAgents = (): Promise<AgentsResult> =>
      Promise.resolve({
        kind: 'ok',
        agents: [
          {
            key: AGENT_ROW,
            sessionId: 's1',
            name: 's1',
            cwd: CWD,
            status: 'running',
            kind: 'interactive',
            startedAt: null,
            pid: null,
          },
        ],
      });
    const readPanes = (): Promise<ReadonlyMap<string, string>> =>
      Promise.resolve(new Map([[AGENT_ROW, NAME]]));
    const result = await sendRemoteKey(AGENT_ROW, 'enter', { run, listAgents, readPanes });
    expect(result).toBeNull();
    expect(argvs.find((argv) => argv[0] === 'send-keys')).toEqual([
      'send-keys',
      '-t',
      `=${NAME}:`,
      'Enter',
    ]);
  });

  it('refuses a session id no live agent claims', async () => {
    const { run } = runner({ 'list-sessions': ok('') });
    const result = await sendRemoteKey('does-not-exist#1', 'escape', {
      run,
      listAgents: noAgents,
      readPanes: noPanes,
    });
    expect(result?.code).toBe('unknown-session');
  });

  it('refuses a row vam cannot pair to any pane (paneForRow answers null)', async () => {
    const { run } = runner({ 'list-sessions': ok('') });
    const listAgents = (): Promise<AgentsResult> =>
      Promise.resolve({
        kind: 'ok',
        agents: [
          {
            key: AGENT_ROW,
            sessionId: 's1',
            name: 's1',
            cwd: '/tmp/atlas',
            status: 'running',
            kind: 'interactive',
            startedAt: null,
            pid: null,
          },
        ],
      });
    const result = await sendRemoteKey(AGENT_ROW, 'escape', {
      run,
      listAgents,
      readPanes: noPanes,
    });
    expect(result?.code).toBe('no-terminal');
  });
});
