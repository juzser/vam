/**
 * The tmux spawn layer: every outcome distinct, and "no sessions" never
 * wearing the same face as "vam could not ask".
 *
 * No test here runs tmux. The runner is injected, exactly as `pull-requests`
 * separates classification from the spawn -- a test that really ran these
 * would create, and kill, sessions on the operator's own tmux server.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyTmuxFailure,
  createVamSession,
  listVamSessions,
  readPane,
  type TmuxRun,
} from '../../src/main/sources/tmux/spawn.js';

/** A runner that records what it was asked and answers with a canned result. */
function fakeTmux(
  answer: (argv: readonly string[]) => {
    failure?: {
      message: string;
      code?: string | number;
      killed?: boolean;
      // `string | null`, because `null` is what node sends for an ordinary
      // non-zero exit and this helper's whole job is to answer what node
      // answers. Narrowed to `string` it could not express the shape the
      // classifier was getting wrong, which is how the family stayed green.
      signal?: string | null;
    };
    stdout?: string;
    stderr?: string;
  },
): TmuxRun & { calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const run = (async (argv: readonly string[]) => {
    calls.push(argv);
    const a = answer(argv);
    return {
      failure: a.failure ?? null,
      stdout: a.stdout ?? '',
      stderr: a.stderr ?? '',
    };
  }) as TmuxRun & { calls: (readonly string[])[] };
  run.calls = calls;
  return run;
}

const ok = () => ({});

describe('classifyTmuxFailure', () => {
  const at = (failure: Parameters<typeof classifyTmuxFailure>[0]['failure'], stderr = '') =>
    classifyTmuxFailure({ failure, stderr, action: 'creating a session' });

  it('gives each failure its own kind+code, pairwise distinct', () => {
    const outcomes = [
      at({ message: 'spawn tmux ENOENT', code: 'ENOENT' }),
      at({ message: 'killed', killed: true, signal: 'SIGTERM' }),
      at({ message: 'exit 1' }, 'no server running on /tmp/tmux-501/default'),
      at({ message: 'exit 1' }, "can't find session: vam-nope"),
      at({ message: 'exit 1' }, 'duplicate session: vam-taken'),
      at({ message: 'exit 1' }, 'something tmux has never said before'),
    ];
    const seen = outcomes.map((o) => `${o.kind}/${o.code}`);
    expect(new Set(seen).size).toBe(outcomes.length);
    expect(seen).toEqual([
      'unreachable/tmux-missing',
      'unreachable/timed-out',
      'unreachable/no-server',
      'refused/no-such-session',
      'refused/session-exists',
      'refused/tmux-failed',
    ]);
  });

  /**
   * THE SHAPE NODE ACTUALLY SENDS FOR AN ORDINARY NON-ZERO EXIT.
   *
   * Measured on node v26.5.0, which is what this app runs:
   *
   *   exit 1          -> { code: 1,    killed: false, signal: null      }
   *   external SIGTERM-> { code: null, killed: false, signal: 'SIGTERM' }
   *   node's timeout  -> { code: null, killed: true,  signal: 'SIGTERM' }
   *
   * `signal` is NULL, not absent -- and `null !== undefined`, so the kill arm
   * above swallowed every ordinary tmux failure and reported it as "tmux was
   * killed before it answered by null, which vam did not ask for". The
   * operator saw that sentence when they typed into a session.
   *
   * The cost is not the wrong sentence, it is the three branches below it:
   * no-server, no-such-session and duplicate were ALL unreachable in
   * production, and `listVamSessions` turns exactly one of them into "there
   * are no sessions" rather than "vam could not ask".
   *
   * Every fixture in this block omitted `signal`, which is a shape node never
   * produces -- so the whole family was green.
   */
  describe('an ordinary non-zero exit, as node really reports it', () => {
    const exited = (stderr: string) =>
      at({ message: 'Command failed', code: 1, killed: false, signal: null }, stderr);

    it('is not a kill', () => {
      expect(exited('something tmux has never said before').code).toBe('tmux-failed');
    });

    it('never tells the operator it was killed by null', () => {
      expect(exited('anything at all').message).not.toContain('null');
    });

    it('still reaches the reason tmux gave, on every branch below the kill arm', () => {
      expect(exited('no server running on /tmp/tmux-501/default').code).toBe('no-server');
      expect(exited("can't find session: vam-nope").code).toBe('no-such-session');
      expect(exited('duplicate session: vam-taken').code).toBe('session-exists');
    });
  });

  it('does not call a SIGKILL from outside a timeout', () => {
    // node's own timeout kills with SIGTERM. A SIGKILL means something else
    // killed tmux -- the OOM killer, most plainly -- and reporting that as
    // "tmux did not answer within 10s" sends the operator after a hang that
    // never happened. A wrong cause is worse than an unknown one.
    const timedOut = at({ message: 'killed', killed: true, signal: 'SIGTERM' });
    const oomKilled = at({ message: 'killed', killed: true, signal: 'SIGKILL' });
    expect(timedOut.code).toBe('timed-out');
    expect(oomKilled.code).toBe('killed');
    expect(oomKilled.message).toContain('SIGKILL');
    expect(oomKilled.message).not.toMatch(/did not answer|timed out/i);
  });

  it('reports a kill with no signal as a kill, not as a timeout', () => {
    const killed = at({ message: 'killed', killed: true });
    expect(killed.code).toBe('killed');
  });

  it("carries tmux's own words for a failure it does not recognise", () => {
    const error = at({ message: 'exit 1' }, 'something tmux has never said before');
    expect(error.message).toContain('something tmux has never said before');
    expect(error.message).toContain('creating a session');
  });
});

describe('listVamSessions', () => {
  it('reads "no server running" as NO SESSIONS, not as an error', async () => {
    const run = fakeTmux(() => ({
      failure: { message: 'exit 1' },
      stderr: 'no server running on /tmp/tmux-501/default',
    }));
    await expect(listVamSessions(run)).resolves.toEqual({ kind: 'ok', sessions: [] });
  });

  /**
   * AND THE SAME THING AGAIN IN THE SHAPE NODE REALLY SENDS.
   *
   * The case above passes a failure with no `signal` key, which node never
   * produces: an ordinary non-zero exit carries `signal: null` (measured on
   * node v26.5.0). That one difference routed this through the classifier's
   * kill arm, so `no-server` never matched and vam reported "could not ask"
   * for the ordinary state of a machine with no tmux server running -- while
   * the test above stayed green.
   *
   * This is the difference between "there are no sessions" and "vam could not
   * ask", which `source.ts` turns into a `vamControlled` that is false versus
   * one that is absent from the session entirely.
   */
  it('reads it as NO SESSIONS when the exit arrives as node really reports it', async () => {
    const run = fakeTmux(() => ({
      failure: { message: 'Command failed', code: 1, killed: false, signal: null },
      stderr: 'no server running on /tmp/tmux-501/default',
    }));
    await expect(listVamSessions(run)).resolves.toEqual({ kind: 'ok', sessions: [] });
  });

  it('is unavailable -- NOT empty -- when tmux is not installed', async () => {
    const run = fakeTmux(() => ({ failure: { message: 'ENOENT', code: 'ENOENT' } }));
    const result = await listVamSessions(run);
    expect(result.kind).toBe('unavailable');
    expect(result.kind === 'unavailable' && result.error.code).toBe('tmux-missing');
  });

  it("filters to vam's own sessions and leaves the operator's alone", async () => {
    const run = fakeTmux(() => ({
      stdout: [
        '\t\tnotes',
        'claude-code:demo-11111111\t4242\tvam-demo-a1b2c3',
        '\t\t0',
        'claude-code:api-22222222\t5353\tvam-api-d4e5f6',
        '\t\tirc',
        '',
      ].join('\n'),
    }));
    await expect(listVamSessions(run)).resolves.toEqual({
      kind: 'ok',
      sessions: [
        { project: 'claude-code:demo-11111111', pid: '4242', name: 'vam-demo-a1b2c3' },
        { project: 'claude-code:api-22222222', pid: '5353', name: 'vam-api-d4e5f6' },
      ],
    });
  });

  /**
   * THE FOURTH FIELD: what is in the FOREGROUND of the pane, as tmux names
   * it. A vam pane is a shell first (`tmux/shell.ts`) and an agent only once
   * something has been typed into it, so `zsh` here is "nothing has been
   * started" and `claude` is "something has". Measured on tmux 3.7b over a
   * private socket: `zsh` on a fresh pane, `sleep` two seconds after
   * `sleep 30` was typed into it. It comes LAST so the three fields every
   * older stub in this suite answers with keep their positions, and a line
   * without it still parses -- `command` is then simply absent.
   */
  it('reads the foreground command as a fourth field, and does without it', async () => {
    const run = fakeTmux(() => ({
      stdout: [
        'claude-code:demo-11111111\t4242\tvam-demo-a1b2c3\tzsh',
        'claude-code:demo-11111111\t4243\tvam-demo-d4e5f6\tclaude',
        'claude-code:demo-11111111\t4244\tvam-demo-g7h8i9',
        '',
      ].join('\n'),
    }));
    await expect(listVamSessions(run)).resolves.toEqual({
      kind: 'ok',
      sessions: [
        {
          project: 'claude-code:demo-11111111',
          pid: '4242',
          name: 'vam-demo-a1b2c3',
          command: 'zsh',
        },
        {
          project: 'claude-code:demo-11111111',
          pid: '4243',
          name: 'vam-demo-d4e5f6',
          command: 'claude',
        },
        { project: 'claude-code:demo-11111111', pid: '4244', name: 'vam-demo-g7h8i9' },
      ],
    });
  });

  /**
   * THE FIFTH AND SIXTH FIELDS: the native id vam wrote once it learned it,
   * and the pane's REAL cwd, straight from tmux rather than from vam's own
   * `@vam-project` tag. Both are optional in the same shape `command` is,
   * and for the same reason -- every shorter stub in this suite, including
   * the ones just above, must keep parsing.
   */
  it('reads the vam-session id and the real cwd as a fifth and sixth field', async () => {
    const run = fakeTmux(() => ({
      stdout: [
        [
          'claude-code:demo-11111111',
          '4242',
          'vam-demo-a1b2c3',
          'claude',
          'a1b2c3d4-e5f6-4789-a012-3456789abcde',
          '/w/demo',
        ].join('\t'),
        '',
      ].join('\n'),
    }));
    await expect(listVamSessions(run)).resolves.toEqual({
      kind: 'ok',
      sessions: [
        {
          project: 'claude-code:demo-11111111',
          pid: '4242',
          name: 'vam-demo-a1b2c3',
          command: 'claude',
          vamSessionId: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
          cwd: '/w/demo',
        },
      ],
    });
  });

  it('reports a session with no vam-session id yet as carrying neither trailing field', async () => {
    // Unset options read back as the empty string, and a fresh pane has not
    // been paired with a native id yet -- both must stay absent, the same
    // rule `command` already follows.
    const run = fakeTmux(() => ({
      stdout: ['claude-code:demo-11111111\t4242\tvam-demo-a1b2c3\tzsh\t\t/w/demo', ''].join('\n'),
    }));
    await expect(listVamSessions(run)).resolves.toEqual({
      kind: 'ok',
      sessions: [
        {
          project: 'claude-code:demo-11111111',
          pid: '4242',
          name: 'vam-demo-a1b2c3',
          command: 'zsh',
          cwd: '/w/demo',
        },
      ],
    });
  });

  it('reports an untagged vam session as tagged with nothing, not as tagged with its name', async () => {
    // A session started by an older vam, or one whose `set-option` failed. The
    // empty fields are what an unset user option formats as (measured), and
    // they must stay empty: the matcher refuses to pair on either.
    const run = fakeTmux(() => ({ stdout: '\t\tvam-old-a1b2c3\n' }));
    await expect(listVamSessions(run)).resolves.toEqual({
      kind: 'ok',
      sessions: [{ project: '', pid: '', name: 'vam-old-a1b2c3' }],
    });
  });

  /**
   * THE SEVENTH FIELD: tmux's own `session_created`, unix seconds -- what a
   * pane with no transcript yet (`pane-row.ts`'s `paneRow`) reads for
   * `Session.createdAt`, on the same rule the fifth and sixth fields follow:
   * it comes LAST, so every shorter stub in this suite, including every case
   * above, keeps parsing.
   */
  it('reads session_created as a seventh field, and does without it', async () => {
    const run = fakeTmux(() => ({
      stdout: [
        [
          'claude-code:demo-11111111',
          '4242',
          'vam-demo-a1b2c3',
          'claude',
          'a1b2c3d4-e5f6-4789-a012-3456789abcde',
          '/w/demo',
          '1700000000',
        ].join('\t'),
        '',
      ].join('\n'),
    }));
    await expect(listVamSessions(run)).resolves.toEqual({
      kind: 'ok',
      sessions: [
        {
          project: 'claude-code:demo-11111111',
          pid: '4242',
          name: 'vam-demo-a1b2c3',
          command: 'claude',
          vamSessionId: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
          cwd: '/w/demo',
          sessionCreated: '1700000000',
        },
      ],
    });
  });

  it('reports a session with no seventh field as carrying none', async () => {
    const run = fakeTmux(() => ({
      stdout: ['claude-code:demo-11111111\t4242\tvam-demo-a1b2c3\tzsh\t\t/w/demo', ''].join('\n'),
    }));
    const result = await listVamSessions(run);
    expect(result.kind === 'ok' && result.sessions[0]?.sessionCreated).toBeUndefined();
  });

  /**
   * THE PID FIELD ON ITS OWN, so a project-tag failure and a pid-tag failure
   * are distinguishable by a caller that only wants one of them: a session
   * `createVamSession` tagged with a project but whose pid tag failed (or
   * whose vam predates the feature) still resolves through the older,
   * per-project fallback (`paneForRow`, `reply.ts`).
   */
  it('reports a session tagged with a project but no pid', async () => {
    const run = fakeTmux(() => ({ stdout: 'claude-code:demo-11111111\t\tvam-demo-a1b2c3\n' }));
    await expect(listVamSessions(run)).resolves.toEqual({
      kind: 'ok',
      sessions: [{ project: 'claude-code:demo-11111111', pid: '', name: 'vam-demo-a1b2c3' }],
    });
  });

  /**
   * THE SEPARATORS CAN COME BACK AS `_`, AND THAT IS NOT "NO SESSIONS".
   *
   * Measured against tmux 3.7b: when the CLIENT's LC_CTYPE is not UTF-8 --
   * unset, `C`, or a locale the system does not have -- every control
   * character in a `-F` expansion is printed as `_`, so the two tabs
   * `listSessionsArgv` separates its fields with arrive as underscores and
   * the line has no tab at all. A GUI launch (Finder, Dock, Spotlight) has
   * no LANG or LC_* in its environment, so this is what a packaged vam saw
   * on every listing: the parser found no tab, skipped every line, and
   * answered `ok, []` -- "vam started none of these" -- for a machine whose
   * every vam session was right there. Downstream, `paneForRow` refused the
   * reply as `no-terminal`, and `vamControlled` went false for every row.
   *
   * The listing is UNREADABLE and says so, so the refusal carries the tmux
   * reason and `load()` records "could not ask" rather than "none". The
   * environment repair (`env/utf8-ctype.ts`) is what makes the tab survive;
   * this is what keeps the failure honest when it does not.
   */
  it('is UNAVAILABLE -- not an empty list -- when the separators did not survive', async () => {
    const run = fakeTmux(() => ({
      stdout: ['claude-code:demo-11111111_4242_vam-demo-a1b2c3', '__notes', ''].join('\n'),
    }));
    const result = await listVamSessions(run);
    expect(result.kind).toBe('unavailable');
    expect(result.kind === 'unavailable' && result.error).toMatchObject({
      kind: 'unreachable',
      code: 'listing-unreadable',
    });
    expect(result.kind === 'unavailable' && result.error.message).toMatch(/LC_CTYPE/);
  });

  it('still reads an empty listing as no sessions', async () => {
    const run = fakeTmux(() => ({ stdout: '' }));
    await expect(listVamSessions(run)).resolves.toEqual({ kind: 'ok', sessions: [] });
  });
});

describe('createVamSession', () => {
  it('runs new-session detached with the chosen cwd and command, and tags the project', async () => {
    const run = fakeTmux(ok);
    const created = await createVamSession(run, {
      name: 'vam-demo-a1b2c3',
      cwd: '/w/demo',
      command: ['claude'],
      projectId: 'claude-code:demo-11111111',
    });
    expect(created).toBeNull();
    expect(run.calls).toEqual([
      [
        'new-session',
        '-d',
        '-P',
        '-F',
        '#{pane_pid}',
        '-s',
        'vam-demo-a1b2c3',
        '-c',
        '/w/demo',
        'claude',
      ],
      ['set-option', '-t', 'vam-demo-a1b2c3', '@vam-project', 'claude-code:demo-11111111'],
    ]);
  });

  it('records the pairing on the session, because nothing else can reconstruct it', async () => {
    // The whole of the fix to the Terminal tab is this second call. Deleting it
    // leaves a session that runs perfectly and that vam can never find again.
    const run = fakeTmux(() => ({}));
    await createVamSession(run, {
      name: 'vam-demo-a1b2c3',
      cwd: '/w/demo',
      command: ['claude'],
      projectId: 'claude-code:demo-11111111',
    });
    expect(run.calls.map((argv) => argv[0])).toEqual(['new-session', 'set-option']);
  });

  it('says the session started but is unpaired when only the project recording failed', async () => {
    // Not "creating a session failed": the session IS running, and sending the
    // operator to look for one that never started would be the wrong repair.
    const run = fakeTmux((argv) =>
      argv[0] === 'set-option'
        ? { failure: { message: 'exit 1' }, stderr: 'unknown option: @vam-project' }
        : {},
    );
    const created = await createVamSession(run, {
      name: 'vam-demo-a1b2c3',
      cwd: '/w/demo',
      command: ['claude'],
      projectId: 'claude-code:demo-11111111',
    });
    expect(created?.code).toBe('session-untagged');
    expect(created?.message).toContain('the session started');
    expect(created?.message).toContain('Terminal tab');
  });

  it('resolves to the error rather than throwing', async () => {
    const run = fakeTmux(() => ({
      failure: { message: 'exit 1' },
      stderr: 'duplicate session: vam-demo-a1b2c3',
    }));
    const created = await createVamSession(run, {
      name: 'vam-demo-a1b2c3',
      cwd: '/w/demo',
      command: ['claude'],
      projectId: 'claude-code:demo-11111111',
    });
    expect(created?.code).toBe('session-exists');
  });

  /**
   * THE PID TAG: a THIRD call, made only once the project tag has already
   * succeeded, using the pid `new-session -P -F` printed on its own stdout.
   */
  describe('the pid tag', () => {
    it('records the pid new-session printed, as a THIRD call after the project tag', async () => {
      const run = fakeTmux((argv) => (argv[0] === 'new-session' ? { stdout: '14709\n' } : {}));
      const created = await createVamSession(run, {
        name: 'vam-demo-a1b2c3',
        cwd: '/w/demo',
        command: ['claude'],
        projectId: 'claude-code:demo-11111111',
      });
      expect(created).toBeNull();
      expect(run.calls).toEqual([
        [
          'new-session',
          '-d',
          '-P',
          '-F',
          '#{pane_pid}',
          '-s',
          'vam-demo-a1b2c3',
          '-c',
          '/w/demo',
          'claude',
        ],
        ['set-option', '-t', 'vam-demo-a1b2c3', '@vam-project', 'claude-code:demo-11111111'],
        ['set-option', '-t', 'vam-demo-a1b2c3', '@vam-pid', '14709'],
      ]);
    });

    /**
     * DEGRADES SILENTLY, AND DELIBERATELY -- unlike the project tag above.
     * The session the project tag already recorded is still findable,
     * repliable and closeable by the older per-project fallback with or
     * without this; turning a session that DID start into a reported failure
     * over a bonus proof that is allowed to be missing would be the wrong
     * severity, exactly as an older Claude Code that never publishes a `tmux`
     * field is not reported as a failure either.
     */
    it('starts the session successfully when tmux prints nothing readable as a pid', async () => {
      // A very old tmux with no `pane_pid` key expands the format to the empty
      // string rather than failing (measured, `CURSOR_FORMAT`'s same note) --
      // this is what that looks like on `new-session`'s own stdout.
      const run = fakeTmux((argv) => (argv[0] === 'new-session' ? { stdout: '\n' } : {}));
      const created = await createVamSession(run, {
        name: 'vam-demo-a1b2c3',
        cwd: '/w/demo',
        command: ['claude'],
        projectId: 'claude-code:demo-11111111',
      });
      expect(created).toBeNull();
      expect(run.calls.map((argv) => argv[0])).toEqual(['new-session', 'set-option']);
    });

    it('starts the session successfully when the pid tag call itself fails', async () => {
      const run = fakeTmux((argv) => {
        if (argv[0] === 'new-session') return { stdout: '14709\n' };
        if (argv.includes('@vam-pid')) {
          return { failure: { message: 'exit 1' }, stderr: 'unknown option: @vam-pid' };
        }
        return {};
      });
      const created = await createVamSession(run, {
        name: 'vam-demo-a1b2c3',
        cwd: '/w/demo',
        command: ['claude'],
        projectId: 'claude-code:demo-11111111',
      });
      // Not `session-untagged`: the project pairing that actually gates the
      // Terminal tab DID record, so this is a working, findable session.
      expect(created).toBeNull();
    });

    it('never tags a pid that is not purely digits', async () => {
      const run = fakeTmux((argv) => (argv[0] === 'new-session' ? { stdout: 'not-a-pid\n' } : {}));
      await createVamSession(run, {
        name: 'vam-demo-a1b2c3',
        cwd: '/w/demo',
        command: ['claude'],
        projectId: 'claude-code:demo-11111111',
      });
      expect(run.calls.some((argv) => argv.includes('@vam-pid'))).toBe(false);
    });
  });

  /**
   * THE VAM-SESSION TAG: a resume already holds the native id in its hand
   * (`docs/design/vam-owns-the-session.md` §2, step 1), so `createVamSession`
   * writes it in the same run of calls as the other two, when it is given
   * one at all.
   */
  describe('the vam-session tag', () => {
    it('records the native id as a fourth call, after the project and pid tags', async () => {
      const run = fakeTmux((argv) => (argv[0] === 'new-session' ? { stdout: '14709\n' } : {}));
      const created = await createVamSession(run, {
        name: 'vam-demo-a1b2c3',
        cwd: '/w/demo',
        command: ['claude', '--resume', 'a1b2c3d4-e5f6-4789-a012-3456789abcde'],
        projectId: 'claude-code:demo-11111111',
        sessionId: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
      });
      expect(created).toBeNull();
      expect(run.calls.map((argv) => argv[0])).toEqual([
        'new-session',
        'set-option',
        'set-option',
        'set-option',
      ]);
      expect(run.calls[3]).toEqual([
        'set-option',
        '-t',
        'vam-demo-a1b2c3',
        '@vam-session',
        'a1b2c3d4-e5f6-4789-a012-3456789abcde',
      ]);
    });

    it('writes nothing when the caller has no id yet -- a fresh start', async () => {
      const run = fakeTmux(ok);
      await createVamSession(run, {
        name: 'vam-demo-a1b2c3',
        cwd: '/w/demo',
        command: ['claude'],
        projectId: 'claude-code:demo-11111111',
      });
      expect(run.calls.some((argv) => argv.includes('@vam-session'))).toBe(false);
    });

    it('refuses to write an empty id rather than match every unwritten session on it', async () => {
      const run = fakeTmux(ok);
      await createVamSession(run, {
        name: 'vam-demo-a1b2c3',
        cwd: '/w/demo',
        command: ['claude'],
        projectId: 'claude-code:demo-11111111',
        sessionId: '',
      });
      expect(run.calls.some((argv) => argv.includes('@vam-session'))).toBe(false);
    });

    /**
     * DEGRADES SILENTLY, THE SAME SEVERITY AS THE PID TAG. The session the
     * project tag already recorded is still findable by the older fallback
     * with or without this; a bonus proof that failed to write is not a
     * reason to report a session that DID start as a failure.
     */
    it('starts the session successfully when the vam-session tag call itself fails', async () => {
      const run = fakeTmux((argv) =>
        argv.includes('@vam-session')
          ? { failure: { message: 'exit 1' }, stderr: 'unknown option: @vam-session' }
          : {},
      );
      const created = await createVamSession(run, {
        name: 'vam-demo-a1b2c3',
        cwd: '/w/demo',
        command: ['claude'],
        projectId: 'claude-code:demo-11111111',
        sessionId: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
      });
      expect(created).toBeNull();
    });
  });
});

describe('readPane', () => {
  it('returns the rendered screen as plain text', async () => {
    const run = fakeTmux(() => ({ stdout: '> hello\nworking...\n' }));
    await expect(readPane(run, 'vam-demo-a1b2c3')).resolves.toEqual({
      kind: 'ok',
      // NOT SHORTENED BY A LINE. This stub answers with a screen and no
      // cursor line, which is what an older tmux and every runner stubbed
      // before the cursor query look like -- and the screen has to survive
      // whole (`tmux/argv.ts`, `VAM_CURSOR_MARK`).
      text: '> hello\nworking...\n',
      cursor: { kind: 'unreadable' },
    });
    expect(run.calls).toEqual([
      [
        'display-message',
        '-p',
        '-t',
        '=vam-demo-a1b2c3:',
        '-F',
        '@vam-cursor #{cursor_flag} #{cursor_x} #{cursor_y} #{history_size} #{mouse_any_flag}',
        ';',
        'capture-pane',
        '-p',
        '-e',
        '-t',
        '=vam-demo-a1b2c3:',
      ],
    ]);
  });

  it('distinguishes a session that is gone from a tmux that is gone', async () => {
    const gone = await readPane(
      fakeTmux(() => ({ failure: { message: 'exit 1' }, stderr: "can't find session: x" })),
      'vam-demo-a1b2c3',
    );
    const missing = await readPane(
      fakeTmux(() => ({ failure: { message: 'ENOENT', code: 'ENOENT' } })),
      'vam-demo-a1b2c3',
    );
    expect(gone.kind === 'unavailable' && gone.error.code).toBe('no-such-session');
    expect(missing.kind === 'unavailable' && missing.error.code).toBe('tmux-missing');
  });
});
