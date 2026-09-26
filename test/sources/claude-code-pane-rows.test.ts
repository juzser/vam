/**
 * A vam pane with no agent in it is a ROW -- `docs/design/vam-owns-the-
 * session.md` §3, and the one slice of its Stage 1 that Stage 2 cannot work
 * without.
 *
 * The row cannot come from a source: Claude Code's rows are its live process
 * list and an empty shell is not in it. So `loadClaudeCodeProjects` lists
 * source rows PLUS every vam tmux session no source row is paired to, and the
 * subtraction is the load-bearing clause. Two panes opened in one directory
 * seconds apart must not steal each other's session, and a pane an agent is
 * running in must not ALSO be drawn as empty. Both failures are silent, so
 * both are asserted by value here, against the same fixtures `vamControlled`
 * is measured with.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LiveAgent } from '../../src/main/sources/claude-code/agents.js';
import { paneNameOf, paneRowId } from '../../src/main/sources/claude-code/pane-row.js';
import { projectIdOf } from '../../src/main/sources/claude-code/project-id.js';
import { loadClaudeCodeProjects } from '../../src/main/sources/claude-code/source.js';
import type { TmuxSession } from '../../src/main/sources/tmux/spawn.js';
import { PAINT_LIFETIME_MS } from '../../src/renderer/domain/optimistic.js';

const NOW = Date.parse('2026-09-21T09:05:00.000Z');
const ALPHA = '/w/alpha';
const ALPHA_ID = projectIdOf(ALPHA);

const agent = (over: Partial<LiveAgent> = {}): LiveAgent => ({
  key: 'sess-1#100',
  sessionId: 'sess-1',
  pid: null,
  name: 'demo',
  cwd: ALPHA,
  status: 'running',
  kind: 'interactive',
  startedAt: NOW - 60_000,
  ...over,
});

describe('a vam pane no source row is paired to', () => {
  let root: string;
  let sessionsRoot: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-pane-rows-'));
    sessionsRoot = mkdtempSync(join(tmpdir(), 'vam-pane-rows-sessions-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(sessionsRoot, { recursive: true, force: true });
  });

  /** What Claude Code writes about itself once it is running under tmux. */
  const publish = (pid: number, sessionId: string, pane: string) =>
    writeFileSync(
      join(sessionsRoot, `${pid}.json`),
      JSON.stringify({ pid, sessionId, status: 'idle', tmux: `${pane}:@0.%0` }),
    );

  const load = (agents: readonly LiveAgent[], tmux: readonly TmuxSession[] | null) =>
    loadClaudeCodeProjects(root, agents, NOW, undefined, sessionsRoot, null, tmux);

  it('is a row of its project, in the state the five statuses could not spell', async () => {
    const [project] = await load(
      [agent()],
      [{ project: ALPHA_ID, pid: '777', name: 'vam-alpha-new001', command: 'zsh' }],
    );
    const empty = project?.sessions.find((s) => s.status === 'unstarted');
    expect(empty).toMatchObject({
      id: paneRowId('vam-alpha-new001'),
      status: 'unstarted',
      source: 'claude-code',
      vamControlled: true,
      pane: 'vam-alpha-new001',
      decisions: [],
      runningAgents: 0,
    });
    expect(paneNameOf(empty?.id ?? '')).toBe('vam-alpha-new001');
    // The agent's own row is still there, untouched by the addition.
    expect(project?.sessions.map((s) => s.id)).toEqual([
      'sess-1#100',
      paneRowId('vam-alpha-new001'),
    ]);
  });

  it('is NOT drawn for a pane an agent row is already paired to', async () => {
    publish(4242, 'sess-a', 'vam-alpha-aa11bb');
    const [project] = await load(
      [agent({ key: 'sess-a#4242', sessionId: 'sess-a', pid: 4242 })],
      [{ project: ALPHA_ID, pid: '1', name: 'vam-alpha-aa11bb', command: 'claude' }],
    );
    expect(project?.sessions.map((s) => s.status)).toEqual(['running']);
    // And the agent row says which pane it is in, so a reader can follow a
    // pane across the moment its row changes identity.
    expect(project?.sessions[0]?.pane).toBe('vam-alpha-aa11bb');
  });

  /**
   * THE ONE THAT MATTERS. Two panes in one directory, five seconds apart: the
   * first agent has published its pane, the second pane is still a shell.
   * The published pane is CLAIMED and subtracted; the other is the empty one.
   * Get the subtraction wrong in either direction and the operator is typing
   * into somebody else's agent, silently, for good.
   */
  it('subtracts the pane another row has claimed, and draws only the other as empty', async () => {
    publish(4242, 'sess-a', 'vam-alpha-aa11bb');
    const [project] = await load(
      [agent({ key: 'sess-a#4242', sessionId: 'sess-a', pid: 4242 })],
      [
        { project: ALPHA_ID, pid: '1', name: 'vam-alpha-aa11bb', command: 'claude' },
        { project: ALPHA_ID, pid: '2', name: 'vam-alpha-cc22dd', command: 'zsh' },
      ],
    );
    expect(project?.sessions.map((s) => [s.id, s.status, s.pane])).toEqual([
      ['sess-a#4242', 'running', 'vam-alpha-aa11bb'],
      [paneRowId('vam-alpha-cc22dd'), 'unstarted', 'vam-alpha-cc22dd'],
    ]);
  });

  it('then binds the second agent to ITS pane, and no empty row remains', async () => {
    publish(4242, 'sess-a', 'vam-alpha-aa11bb');
    publish(4243, 'sess-b', 'vam-alpha-cc22dd');
    const [project] = await load(
      [
        agent({ key: 'sess-a#4242', sessionId: 'sess-a', pid: 4242 }),
        agent({ key: 'sess-b#4243', sessionId: 'sess-b', pid: 4243 }),
      ],
      [
        { project: ALPHA_ID, pid: '1', name: 'vam-alpha-aa11bb', command: 'claude' },
        { project: ALPHA_ID, pid: '2', name: 'vam-alpha-cc22dd', command: 'claude' },
      ],
    );
    expect(project?.sessions.map((s) => [s.id, s.pane])).toEqual([
      ['sess-a#4242', 'vam-alpha-aa11bb'],
      ['sess-b#4243', 'vam-alpha-cc22dd'],
    ]);
  });

  it('keeps the empty row while the second agent has not yet published, unpaired', async () => {
    // The window between `claude` starting and Claude Code writing its pane
    // file: the agent is listed, publishes nothing, and the project tag
    // cannot choose between two panes. The agent row is honestly unproven
    // and the shell pane stays an empty row -- NEITHER is handed the pane
    // the first agent claimed.
    publish(4242, 'sess-a', 'vam-alpha-aa11bb');
    const [project] = await load(
      [
        agent({ key: 'sess-a#4242', sessionId: 'sess-a', pid: 4242 }),
        agent({ key: 'sess-b#4243', sessionId: 'sess-b', pid: 4243 }),
      ],
      [
        { project: ALPHA_ID, pid: '1', name: 'vam-alpha-aa11bb', command: 'claude' },
        { project: ALPHA_ID, pid: '2', name: 'vam-alpha-cc22dd', command: 'zsh' },
      ],
    );
    expect(project?.sessions.map((s) => [s.id, s.vamControlled, s.pane ?? null])).toEqual([
      ['sess-a#4242', true, 'vam-alpha-aa11bb'],
      ['sess-b#4243', false, null],
      [paneRowId('vam-alpha-cc22dd'), true, 'vam-alpha-cc22dd'],
    ]);
  });

  it('draws nothing for a pane whose project no live row names -- there is no cwd to file it under', async () => {
    // The "new project" path: `createSessionInDirectory` starts a pane in a
    // directory no agent runs in yet. A project id is a digest and cannot be
    // turned back into a name, so the row has no section to live in until
    // something runs there. The load still succeeds and still lists the
    // rest.
    const projects = await load(
      [agent()],
      [
        {
          project: projectIdOf('/w/elsewhere'),
          pid: '9',
          name: 'vam-elsewhere-000001',
          command: 'zsh',
        },
      ],
    );
    expect(projects.flatMap((p) => p.sessions).map((s) => s.id)).toEqual(['sess-1#100']);
  });

  it('lets the legacy fallback claim a pane whose listing carried no command -- absence is not a shell', async () => {
    // A three-field listing (an older tmux, or every stub that predates the
    // fourth field): one unpublished agent, one tagged pane, nothing said
    // about what is in it. The project-tag tier pairs them as it always did,
    // and the pane is therefore CLAIMED and not drawn as empty. This is the
    // pre-Stage-2 behaviour, kept exactly.
    const [project] = await load(
      [agent()],
      [{ project: ALPHA_ID, pid: '1', name: 'vam-alpha-old001' }],
    );
    expect(project?.sessions.map((s) => [s.id, s.pane])).toEqual([
      ['sess-1#100', 'vam-alpha-old001'],
    ]);
  });

  it('draws nothing for an untagged session, and nothing when tmux could not be asked', async () => {
    // An unset option reads back as `''`, which would match every project
    // that failed to record one. Refused, as every other reader refuses it.
    // No `cwd` here either -- the shape every fixture in this suite predates
    // -- so there is nowhere honest to file the row; see the next test for
    // the case where tmux DOES say where the pane is.
    const [untagged] = await load([agent()], [{ project: '', pid: '9', name: 'vam-x-000001' }]);
    expect(untagged?.sessions).toHaveLength(1);
    const [unasked] = await load([agent()], null);
    expect(unasked?.sessions).toHaveLength(1);
  });

  /**
   * THE BARE `tmux new-session -s vam-x` CASE -- `docs/design/vam-owns-the-
   * session.md`'s own Stage 1 acceptance line. Nobody ran `createVamSession`
   * for this pane, so `@vam-project` is unset, but tmux itself always knows
   * the pane's real cwd (`pane_current_path`) and that is enough to file the
   * row under a brand-new project, exactly as a tagged pane would be -- a
   * digest cannot be reversed into a directory, but the REAL path needs no
   * reversing.
   */
  it('makes a project out of a bare, untagged vam- session that only tmux’s own cwd can place', async () => {
    const BETA = '/w/beta';
    const projects = await load(
      [agent()],
      [{ project: '', pid: '', name: 'vam-x-000001', cwd: BETA }],
    );
    const beta = projects.find((p) => p.id === projectIdOf(BETA));
    expect(beta).toMatchObject({ id: projectIdOf(BETA), name: 'beta' });
    expect(beta?.sessions).toMatchObject([
      { id: paneRowId('vam-x-000001'), status: 'unstarted', vamControlled: true },
    ]);
    // Alpha's own row is untouched by the new project's arrival.
    const alpha = projects.find((p) => p.id === ALPHA_ID);
    expect(alpha?.sessions.map((s) => s.id)).toEqual(['sess-1#100']);
  });

  it('marks an unstarted pane row an agent worktree when its own cwd checks true', async () => {
    const projects = await loadClaudeCodeProjects(
      root,
      [],
      NOW,
      undefined,
      sessionsRoot,
      null,
      [{ project: '', pid: '', name: 'vam-x-000002', cwd: '/w/gamma' }],
      [],
      undefined,
      null,
      null,
      null,
      undefined,
      async (cwd) => cwd === '/w/gamma',
    );
    const gamma = projects.find((p) => p.id === projectIdOf('/w/gamma'));
    expect(gamma?.sessions[0]?.isAgentWorktree).toBe(true);
  });

  it('reuses the same brand-new project for two untagged panes in the one directory', async () => {
    const BETA = '/w/beta';
    const projects = await load(
      [agent()],
      [
        { project: '', pid: '', name: 'vam-x-000001', cwd: BETA },
        { project: '', pid: '', name: 'vam-x-000002', cwd: BETA },
      ],
    );
    const matches = projects.filter((p) => p.id === projectIdOf(BETA));
    expect(matches).toHaveLength(1);
    expect(matches[0]?.sessions.map((s) => s.id)).toEqual([
      paneRowId('vam-x-000001'),
      paneRowId('vam-x-000002'),
    ]);
  });

  it('is the tmux session’s row for as long as the tmux session exists, whatever the clock says', async () => {
    const tmux = [{ project: ALPHA_ID, pid: '777', name: 'vam-alpha-new001', command: 'zsh' }];
    // Well past the renderer's paint lifetime: this row is not a paint on a
    // timer (`optimistic.ts`), it is re-derived from the listing on every load.
    const later = NOW + 10 * PAINT_LIFETIME_MS;
    const [then] = await loadClaudeCodeProjects(
      root,
      [agent()],
      later,
      undefined,
      sessionsRoot,
      null,
      tmux,
    );
    expect(then?.sessions.some((s) => s.id === paneRowId('vam-alpha-new001'))).toBe(true);
    const [gone] = await load([agent()], []);
    expect(gone?.sessions.some((s) => s.id === paneRowId('vam-alpha-new001'))).toBe(false);
  });
});

/**
 * `runningProvider` -- the coordinator's own performance fix: an idle row's
 * "who is already running here" fact comes from the SAME tmux listing this
 * whole file already builds rows from (`TmuxSession.command`), not a second,
 * per-row poll. `identifyRunningProvider` (`sources/tmux/shell.ts`) is the
 * one classifier both this row and the fast, active-wait poll
 * (`main/terminal/start-screen.ts`) run the SAME command through.
 */
describe('runningProvider -- who is already in the pane, from its own foreground command', () => {
  let root: string;
  let sessionsRoot: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-pane-rows-running-'));
    sessionsRoot = mkdtempSync(join(tmpdir(), 'vam-pane-rows-running-sessions-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(sessionsRoot, { recursive: true, force: true });
  });
  // TWO AGENTS IN THIS PROJECT, deliberately not one: `paneForRow`'s own
  // single-candidate tier (`reply.ts`) claims a pane whose command is
  // provably neither a shell nor another configured provider for THAT one
  // agent's own row -- correct there (a version-string pane really is that
  // agent's), but it would leave nothing `unstarted` for these tests to find
  // the field on. A second agent makes the candidate count two, which
  // vetoes that tier outright regardless of command, so the pane row this
  // suite is actually testing survives unclaimed either way.
  const agentTwo = agent({ key: 'sess-2#200', sessionId: 'sess-2', name: 'demo-2' });
  const load = (command: string | undefined) =>
    loadClaudeCodeProjects(root, [agent(), agentTwo], NOW, undefined, sessionsRoot, null, [
      {
        project: ALPHA_ID,
        pid: '777',
        name: 'vam-alpha-new001',
        ...(command === undefined ? {} : { command }),
      },
    ]);
  const row = (project: Awaited<ReturnType<typeof load>>[number] | undefined) =>
    project?.sessions.find((s) => s.id === paneRowId('vam-alpha-new001'));

  it('is absent for a plain shell -- the ordinary empty pane, unchanged', async () => {
    const [project] = await load('zsh');
    const found = row(project);
    expect(found?.status).toBe('unstarted');
    expect(found?.runningProvider).toBeUndefined();
    expect(Object.hasOwn(found ?? {}, 'runningProvider')).toBe(false);
  });

  it('is absent when the listing carries no foreground command at all', async () => {
    const [project] = await load(undefined);
    const found = row(project);
    expect(found?.status).toBe('unstarted');
    expect(found?.runningProvider).toBeUndefined();
  });

  it('names codex, from its own bare foreground command', async () => {
    const [project] = await load('codex');
    const found = row(project);
    expect(found?.status).toBe('unstarted');
    expect(found?.runningProvider).toBe('codex');
  });

  it('names claude-code from claude’s own measured version-string quirk', async () => {
    const [project] = await load('2.1.282');
    const found = row(project);
    expect(found?.status).toBe('unstarted');
    expect(found?.runningProvider).toBe('claude-code');
  });

  it('is null, not absent, for something running that names neither provider', async () => {
    const [project] = await load('htop');
    const found = row(project);
    expect(found?.status).toBe('unstarted');
    expect(found?.runningProvider).toBeNull();
  });
});
