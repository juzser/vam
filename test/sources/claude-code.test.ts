/**
 * The Claude Code source: the live-session list (`claude agents --json`), the
 * transcript tail parser, and the join between them.
 *
 * Every fixture is built in a fresh temp directory and every agent list is
 * handed in by the test. The operator's real transcripts are never read here,
 * the real CLI is never spawned, and no home path is written into a fixture --
 * `mkdtemp` under `os.tmpdir()` is the only root any of this touches.
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type LiveAgent,
  listLiveAgents,
  parseAgentRows,
} from '../../src/main/sources/claude-code/agents.js';
import {
  CLAUDE_CODE_SOURCE,
  loadClaudeCodeProjects,
} from '../../src/main/sources/claude-code/source.js';
import { compactAge, summarizeTranscript } from '../../src/main/sources/claude-code/transcript.js';

const NOW = Date.parse('2026-09-03T09:05:00.000Z');

const jsonl = (...lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const userPrompt = (text: string) => ({ type: 'last-prompt', lastPrompt: text });
const reply = (text: string) => ({
  type: 'assistant',
  cwd: '/w/demo',
  gitBranch: 'main',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});
const toolCall = (name: string, description: string) => ({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', name, input: { description } }],
  },
});

const agent = (over: Partial<LiveAgent> = {}): LiveAgent => ({
  key: 'sess-1#100',
  sessionId: 'sess-1',
  // Null by default so that no test in this file reaches for a status file:
  // the rows that exercise `~/.claude/sessions` set a pid AND a fixture root.
  pid: null,
  name: 'demo',
  cwd: '/w/alpha',
  status: 'running',
  kind: 'interactive',
  startedAt: NOW - 60_000,
  ...over,
});

describe('compactAge', () => {
  it.each([
    [30_000, '0m'],
    [120_000, '2m'],
    [3 * 3_600_000, '3h'],
    [50 * 3_600_000, '2d'],
  ])('renders %ims as %s', (ms, expected) => {
    expect(compactAge(ms)).toBe(expected);
  });
});

describe('parseAgentRows', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    pid: 100,
    cwd: '/w/alpha',
    kind: 'interactive',
    startedAt: NOW,
    sessionId: 'sess-1',
    name: 'demo',
    status: 'idle',
    ...over,
  });

  it('maps an interactive session busy/idle onto running/waiting', () => {
    const [busy, idle] = parseAgentRows(
      JSON.stringify([
        row({ status: 'busy', sessionId: 'a' }),
        row({ status: 'idle', sessionId: 'b' }),
      ]),
    );
    expect(busy?.status).toBe('running');
    expect(idle?.status).toBe('waiting');
  });

  it('takes done and failed from a background session, which alone can express them', () => {
    const rows = parseAgentRows(
      JSON.stringify([
        row({ kind: 'background', state: 'done', sessionId: 'a', status: undefined }),
        row({ kind: 'background', state: 'failed', sessionId: 'b', status: undefined }),
        row({ kind: 'background', state: 'running', sessionId: 'c', status: undefined }),
      ]),
      NOW,
    );
    expect(rows.map((r) => r.status)).toEqual(['done', 'failed', 'running']);
  });

  it('keeps two processes that resumed one session as two rows with distinct keys', () => {
    const rows = parseAgentRows(
      JSON.stringify([row({ pid: 1, name: 'first' }), row({ pid: 2, name: 'second' })]),
      NOW,
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    expect(rows.map((r) => r.name)).toEqual(['first', 'second']);
  });

  it('drops rows with no session id or no working directory rather than inventing one', () => {
    const rows = parseAgentRows(
      JSON.stringify([row(), row({ sessionId: undefined }), row({ cwd: undefined })]),
      NOW,
    );
    expect(rows).toHaveLength(1);
  });

  it('keeps every interactive row, however long the process has been up', () => {
    const rows = parseAgentRows(JSON.stringify([row({ startedAt: NOW - 400 * 86_400_000 })]), NOW);
    expect(rows).toHaveLength(1);
  });

  it('drops a background session that finished long ago, which is noise and not news', () => {
    const rows = parseAgentRows(
      JSON.stringify([
        row({
          kind: 'background',
          state: 'failed',
          sessionId: 'old',
          startedAt: NOW - 60 * 86_400_000,
        }),
        row({
          kind: 'background',
          state: 'failed',
          sessionId: 'recent',
          startedAt: NOW - 86_400_000,
        }),
      ]),
      NOW,
    );
    expect(rows.map((r) => r.sessionId)).toEqual(['recent']);
  });

  it('treats unparseable or non-array output as no sessions, never as an error', () => {
    expect(parseAgentRows('not json', NOW)).toEqual([]);
    expect(parseAgentRows('{"error":"nope"}', NOW)).toEqual([]);
    expect(parseAgentRows('', NOW)).toEqual([]);
  });
});

describe('listLiveAgents', () => {
  it('degrades to no sessions when the CLI is not installed', async () => {
    await expect(listLiveAgents('definitely-not-a-real-binary-vam')).resolves.toEqual([]);
  });

  it('degrades to no sessions when the CLI exits non-zero', async () => {
    await expect(listLiveAgents('false')).resolves.toEqual([]);
  });
});

describe('summarizeTranscript', () => {
  it('reads the branch off the tail', () => {
    expect(summarizeTranscript(jsonl(reply('hi')), 'k').branch).toBe('main');
  });

  it('pairs each operator prompt with the last reply of its own turn, newest first', () => {
    const facts = summarizeTranscript(
      jsonl(
        userPrompt('first ask'),
        reply('working on it'),
        reply('first answer'),
        userPrompt('second ask'),
        reply('second answer'),
      ),
      'k',
    );
    expect(facts.decisions.map((d) => [d.input, d.output])).toEqual([
      ['second ask', 'second answer'],
      ['first ask', 'first answer'],
    ]);
  });

  it('leaves output null for a turn that has produced no text yet', () => {
    const facts = summarizeTranscript(jsonl(userPrompt('go'), toolCall('Bash', 'run it')), 'k');
    expect(facts.decisions[0]?.output).toBeNull();
  });

  it('reports the newest tool call as the activity line', () => {
    expect(summarizeTranscript(jsonl(toolCall('Bash', 'run the gates')), 'k').activity).toBe(
      'Bash: run the gates',
    );
  });

  it('offers the generated title only as a fallback name', () => {
    expect(
      summarizeTranscript(jsonl(reply('hi'), { type: 'ai-title', aiTitle: 'Gen' }), 'k').aiTitle,
    ).toBe('Gen');
    expect(summarizeTranscript(jsonl(reply('hi')), 'k').aiTitle).toBeNull();
  });

  it('survives a truncated first line and lines that are not json', () => {
    const facts = summarizeTranscript(`{"type":"assis\n${jsonl(reply('hi'))}\nnot json`, 'k');
    expect(facts.branch).toBe('main');
  });
});

describe('loadClaudeCodeProjects', () => {
  let root: string;
  let sessionsRoot: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-cc-'));
    sessionsRoot = mkdtempSync(join(tmpdir(), 'vam-cc-sessions-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(sessionsRoot, { recursive: true, force: true });
  });

  const writeStatusFile = (pid: number, statusUpdatedAt: unknown) => {
    writeFileSync(
      join(sessionsRoot, `${pid}.json`),
      JSON.stringify({ pid, sessionId: 'sess-1', status: 'idle', statusUpdatedAt }),
    );
  };

  const writeTranscript = (dir: string, sessionId: string, body: string, ageMs = 60_000) => {
    mkdirSync(join(root, dir), { recursive: true });
    const file = join(root, dir, `${sessionId}.jsonl`);
    writeFileSync(file, body);
    const when = (NOW - ageMs) / 1000;
    utimesSync(file, when, when);
    return file;
  };

  it('takes the session list from the live agents, not from the transcript directory', async () => {
    writeTranscript('slug-a', 'stale-and-dead', jsonl(reply('old')));
    const projects = await loadClaudeCodeProjects(root, [agent()], NOW);
    expect(projects.flatMap((p) => p.sessions).map((s) => s.title)).toEqual(['demo']);
  });

  it('groups by the working directory the CLI reports, named by its last segment', async () => {
    const projects = await loadClaudeCodeProjects(
      root,
      [
        agent({ key: 'a#1', sessionId: 'a', cwd: '/home/someone/code/alpha' }),
        agent({ key: 'b#2', sessionId: 'b', cwd: '/home/someone/code/alpha' }),
        agent({ key: 'c#3', sessionId: 'c', cwd: '/home/someone/code/beta' }),
      ],
      NOW,
    );
    expect(Object.fromEntries(projects.map((p) => [p.name, p.sessions.length]))).toEqual({
      alpha: 2,
      beta: 1,
    });
  });

  it("takes the branch from the transcript, not from the directory's git HEAD", async () => {
    // Precedence, pinned. `gitBranch` is what Claude Code itself recorded on
    // the turn -- the branch the session actually ran on -- while `.git/HEAD`
    // is whatever the directory happens to be on NOW, which drifts the moment
    // anyone checks something else out under a long-running session. The two
    // are made to disagree here so that whichever wins is the one that was
    // chosen, not the one that happened to be non-null.
    writeTranscript('slug-a', 'a', jsonl(reply('hi')));
    const [project] = await loadClaudeCodeProjects(
      root,
      [agent({ key: 'a#1', sessionId: 'a' })],
      NOW,
      async () => 'checked-out-since',
    );
    expect(project?.sessions[0]?.branch).toBe('main');
  });

  it("falls back to the directory's git HEAD when the transcript has no branch", async () => {
    // A session with no transcript yet, or one written before Claude Code
    // recorded `gitBranch`. The reader is the only thing that can answer, and
    // showing nothing there would be a gap vam could have filled.
    const [project] = await loadClaudeCodeProjects(
      root,
      [agent({ key: 'b#2', sessionId: 'no-transcript' })],
      NOW,
      async () => 'from-git-head',
    );
    expect(project?.sessions[0]?.branch).toBe('from-git-head');
  });

  it('calls an interactive session human-started and a background one unknown', async () => {
    // The source used to assert `startedBy: 'human'` for EVERY row, on the
    // reasoning that anything the CLI lists is a session a person opened.
    // That holds for an interactive row -- it is a terminal someone is sitting
    // in front of. It does not hold for a BACKGROUND row: measured against
    // the real CLI, `claude agents --json --all` lists background sessions
    // living under `.claude/worktrees/`, and nothing on the row says whether a
    // person launched it or an agent spawned it. `unknown` is what vam
    // actually knows, and `session-filter.ts` keeps unknown VISIBLE by
    // design -- "hiding what you did not check is how a filter loses work" --
    // so this costs no row on screen and stops one false claim.
    const [project] = await loadClaudeCodeProjects(
      root,
      [
        agent({ key: 'i#1', sessionId: 'i', kind: 'interactive' }),
        agent({ key: 'b#2', sessionId: 'b', kind: 'background' }),
      ],
      NOW,
    );
    const byId = new Map(project?.sessions.map((x) => [x.id, x.origin?.startedBy]) ?? []);
    expect(byId.get('i#1')).toBe('human');
    expect(byId.get('b#2')).toBe('unknown');
  });

  it('never renders a filesystem path into a project id or name', async () => {
    const [project] = await loadClaudeCodeProjects(
      root,
      [agent({ cwd: '/home/someone/code/alpha' })],
      NOW,
    );
    expect(project?.name).toBe('alpha');
    expect(`${project?.id} ${project?.name}`).not.toContain('/');
  });

  it('prefers the name the CLI reports over the transcript-generated title', async () => {
    writeTranscript(
      'slug-a',
      'sess-1',
      jsonl(reply('hi'), { type: 'ai-title', aiTitle: 'Generated' }),
    );
    const [project] = await loadClaudeCodeProjects(root, [agent({ name: 'vam' })], NOW);
    expect(project?.sessions[0]?.title).toBe('vam');
  });

  it('falls back to the generated title when the CLI reports no name', async () => {
    writeTranscript(
      'slug-a',
      'sess-1',
      jsonl(reply('hi'), { type: 'ai-title', aiTitle: 'Generated' }),
    );
    const [project] = await loadClaudeCodeProjects(root, [agent({ name: null })], NOW);
    expect(project?.sessions[0]?.title).toBe('Generated');
  });

  it('carries the status the CLI gave, never one derived from the file', async () => {
    writeTranscript(
      'slug-a',
      'sess-1',
      jsonl(userPrompt('go'), reply('answered')),
      30 * 86_400_000,
    );
    const [project] = await loadClaudeCodeProjects(root, [agent({ status: 'running' })], NOW);
    expect(project?.sessions[0]?.status).toBe('running');
  });

  it('finds the transcript by session id wherever the slug directory put it', async () => {
    writeTranscript('some-opaque-slug', 'sess-1', jsonl(userPrompt('do the thing'), reply('done')));
    const [project] = await loadClaudeCodeProjects(root, [agent()], NOW);
    expect(project?.sessions[0]?.decisions[0]?.input).toBe('do the thing');
    expect(project?.sessions[0]?.decisions[0]?.output).toBe('done');
  });

  it('shows a live session with no transcript at all, rather than dropping it', async () => {
    const [project] = await loadClaudeCodeProjects(root, [agent()], NOW);
    expect(project?.sessions[0]?.decisions).toEqual([]);
    expect(project?.sessions[0]?.title).toBe('demo');
  });

  it('shows both processes that resumed one session, sharing that transcript', async () => {
    writeTranscript('slug-a', 'sess-1', jsonl(userPrompt('go'), reply('done')));
    const [project] = await loadClaudeCodeProjects(
      root,
      [agent({ key: 'sess-1#1', name: 'first' }), agent({ key: 'sess-1#2', name: 'second' })],
      NOW,
    );
    expect(project?.sessions.map((s) => s.title)).toEqual(['first', 'second']);
    expect(new Set(project?.sessions.map((s) => s.id)).size).toBe(2);
    expect(project?.sessions[0]?.decisions[0]?.input).toBe('go');
  });

  it('counts a freshly-touched subagent transcript as a running agent, never as a session', async () => {
    writeTranscript('slug-a', 'sess-1', jsonl(reply('x')));
    const subs = join(root, 'slug-a', 'sess-1', 'subagents');
    mkdirSync(subs, { recursive: true });
    for (const [name, ageMs] of [
      ['agent-live', 0],
      ['agent-old', 86_400_000],
    ] as const) {
      const f = join(subs, `${name}.jsonl`);
      writeFileSync(f, jsonl(reply('sub')));
      utimesSync(f, (NOW - ageMs) / 1000, (NOW - ageMs) / 1000);
    }
    const [project] = await loadClaudeCodeProjects(root, [agent()], NOW);
    expect(project?.sessions).toHaveLength(1);
    expect(project?.sessions[0]?.runningAgents).toBe(1);
  });

  it('carries the roster the count was already walking, badge and rows agreeing', async () => {
    writeTranscript('slug-a', 'sess-1', jsonl(reply('x')));
    const subs = join(root, 'slug-a', 'sess-1', 'subagents');
    mkdirSync(subs, { recursive: true });
    for (const [name, ageMs] of [
      ['agent-live', 0],
      ['agent-old', 86_400_000],
    ] as const) {
      const f = join(subs, `${name}.jsonl`);
      writeFileSync(f, jsonl(reply('sub')));
      utimesSync(f, (NOW - ageMs) / 1000, (NOW - ageMs) / 1000);
      writeFileSync(
        join(subs, `${name}.meta.json`),
        JSON.stringify({ agentType: 'coder', description: `do ${name}` }),
      );
    }

    const [project] = await loadClaudeCodeProjects(root, [agent()], NOW);
    const session = project?.sessions[0];

    expect(session?.agents).toEqual([
      { id: 'agent-live', type: 'coder', description: 'do agent-live', running: true },
      { id: 'agent-old', type: 'coder', description: 'do agent-old', running: false },
    ]);
    // The badge is still the number of transcripts inside the window, and the
    // roster still agrees with it.
    expect(session?.runningAgents).toBe(1);
    expect(session?.agents?.filter((a) => a.running)).toHaveLength(session?.runningAgents ?? -1);
  });

  it('gives a session that never spawned an agent an empty roster, not an absent one', async () => {
    writeTranscript('slug-a', 'sess-1', jsonl(reply('x')));
    const [project] = await loadClaudeCodeProjects(root, [agent()], NOW);
    expect(project?.sessions[0]?.agents).toEqual([]);
    expect(project?.sessions[0]?.runningAgents).toBe(0);
  });

  it('ages from the transcript when there is one, and from the start time when there is not', async () => {
    writeTranscript('slug-a', 'sess-1', jsonl(reply('x')), 2 * 3_600_000);
    const [withFile] = await loadClaudeCodeProjects(root, [agent()], NOW);
    expect(withFile?.sessions[0]?.age).toBe('2h');
    const [without] = await loadClaudeCodeProjects(
      root,
      [agent({ sessionId: 'absent', startedAt: NOW - 3 * 86_400_000 })],
      NOW,
    );
    expect(without?.sessions[0]?.age).toBe('3d');
  });

  it('ages two processes that resumed one session apart, from their own status files', async () => {
    // The regression. Both rows share ONE transcript, so an age taken from
    // the transcript's mtime is identical for both -- measured on a real
    // machine as two rows whose true status times were 18 hours apart. The
    // per-pid status file is the only thing that tells them apart.
    writeTranscript('slug-a', 'sess-1', jsonl(reply('x')), 2 * 3_600_000);
    writeStatusFile(4242, NOW - 5 * 60_000);
    writeStatusFile(4343, NOW - 20 * 3_600_000);
    const [project] = await loadClaudeCodeProjects(
      root,
      [agent({ key: 'sess-1#4242', pid: 4242 }), agent({ key: 'sess-1#4343', pid: 4343 })],
      NOW,
      async () => null,
      sessionsRoot,
    );
    const byId = new Map(project?.sessions.map((x) => [x.id, x.age]) ?? []);
    expect(byId.get('sess-1#4242')).toBe('5m');
    expect(byId.get('sess-1#4343')).toBe('20h');
  });

  it('falls back to the transcript mtime when the pid has no status file', async () => {
    writeTranscript('slug-a', 'sess-1', jsonl(reply('x')), 2 * 3_600_000);
    const [project] = await loadClaudeCodeProjects(
      root,
      [agent({ key: 'sess-1#4242', pid: 4242 })],
      NOW,
      async () => null,
      sessionsRoot,
    );
    expect(project?.sessions[0]?.age).toBe('2h');
  });

  it.each([
    ['{ not json'],
    [JSON.stringify({ pid: 4242 })],
    [JSON.stringify({ statusUpdatedAt: 'soon' })],
  ])('falls back rather than throwing on an unusable status file (%s)', async (body) => {
    writeTranscript('slug-a', 'sess-1', jsonl(reply('x')), 2 * 3_600_000);
    writeFileSync(join(sessionsRoot, '4242.json'), body);
    const [project] = await loadClaudeCodeProjects(
      root,
      [agent({ key: 'sess-1#4242', pid: 4242 })],
      NOW,
      async () => null,
      sessionsRoot,
    );
    expect(project?.sessions[0]?.age).toBe('2h');
  });

  it('falls back to the start time when there is neither a status file nor a transcript', async () => {
    const [project] = await loadClaudeCodeProjects(
      root,
      [
        agent({
          key: 'absent#4242',
          pid: 4242,
          sessionId: 'absent',
          startedAt: NOW - 3 * 86_400_000,
        }),
      ],
      NOW,
      async () => null,
      sessionsRoot,
    );
    expect(project?.sessions[0]?.age).toBe('3d');
  });

  it('reads only a bounded tail, so a huge transcript costs the same as a small one', async () => {
    const filler =
      `${JSON.stringify({ type: 'attachment', attachment: 'x'.repeat(4096) })}\n`.repeat(4000);
    writeTranscript('slug-a', 'sess-1', filler + jsonl(userPrompt('do the thing'), reply('done')));
    const started = Date.now();
    const [project] = await loadClaudeCodeProjects(root, [agent()], NOW);
    expect(project?.sessions[0]?.decisions[0]?.input).toBe('do the thing');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('still lists live sessions when there is no transcript root at all', async () => {
    const projects = await loadClaudeCodeProjects(join(root, 'absent'), [agent()], NOW);
    expect(projects.flatMap((p) => p.sessions)).toHaveLength(1);
  });

  it('marks every session it emits as human-started, so the agent filter keeps them visible', async () => {
    const [project] = await loadClaudeCodeProjects(root, [agent()], NOW);
    expect(project?.sessions[0]?.origin?.startedBy).toBe('human');
  });

  it('claims delivery, which it can really do, and carries a write surface to prove it', () => {
    const { capabilities } = CLAUDE_CODE_SOURCE.descriptor;
    expect(capabilities.deliverPrompt).toBe(true);
    expect(capabilities.recordPrompt).toBe(true);
    // The port requires a write surface behind recordPrompt; a true flag with
    // no member is the one shape that typechecks and cannot work.
    expect(typeof CLAUDE_CODE_SOURCE.recordPrompt).toBe('function');
  });

  it('gives no decline for a capability it actually has', () => {
    const { capabilities, declines } = CLAUDE_CODE_SOURCE.descriptor;
    for (const [name, able] of Object.entries(capabilities)) {
      if (!able) continue;
      expect(
        declines[name as keyof typeof capabilities],
        `stale decline for ${name}`,
      ).toBeUndefined();
    }
  });

  it('declares no capability it cannot perform, and gives a reason for each', () => {
    const { capabilities, declines, viewerScope } = CLAUDE_CODE_SOURCE.descriptor;
    expect(capabilities.liveUpdates).toBe(false);
    for (const [name, able] of Object.entries(capabilities)) {
      if (able) continue;
      expect(declines[name as keyof typeof capabilities], `no decline for ${name}`).toBeTruthy();
    }
    expect(viewerScope.kind).toBe('connection');
  });
});
