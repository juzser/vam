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
import { type LiveAgent, listLiveAgents, parseAgentRows } from '../../src/main/sources/claude-code/agents.js';
import { CLAUDE_CODE_SOURCE, loadClaudeCodeProjects } from '../../src/main/sources/claude-code/source.js';
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
  name: 'demo',
  cwd: '/w/alpha',
  status: 'running',
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
      JSON.stringify([row({ status: 'busy', sessionId: 'a' }), row({ status: 'idle', sessionId: 'b' })]),
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
    );
    expect(rows.map((r) => r.status)).toEqual(['done', 'failed', 'running']);
  });

  it('keeps two processes that resumed one session as two rows with distinct keys', () => {
    const rows = parseAgentRows(
      JSON.stringify([row({ pid: 1, name: 'first' }), row({ pid: 2, name: 'second' })]),
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    expect(rows.map((r) => r.name)).toEqual(['first', 'second']);
  });

  it('drops rows with no session id or no working directory rather than inventing one', () => {
    const rows = parseAgentRows(
      JSON.stringify([row(), row({ sessionId: undefined }), row({ cwd: undefined })]),
    );
    expect(rows).toHaveLength(1);
  });

  it('treats unparseable or non-array output as no sessions, never as an error', () => {
    expect(parseAgentRows('not json')).toEqual([]);
    expect(parseAgentRows('{"error":"nope"}')).toEqual([]);
    expect(parseAgentRows('')).toEqual([]);
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
    expect(summarizeTranscript(jsonl(reply('hi'), { type: 'ai-title', aiTitle: 'Gen' }), 'k').aiTitle).toBe('Gen');
    expect(summarizeTranscript(jsonl(reply('hi')), 'k').aiTitle).toBeNull();
  });

  it('survives a truncated first line and lines that are not json', () => {
    const facts = summarizeTranscript(`{"type":"assis\n${jsonl(reply('hi'))}\nnot json`, 'k');
    expect(facts.branch).toBe('main');
  });
});

describe('loadClaudeCodeProjects', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-cc-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

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

  it('never renders a filesystem path into a project id or name', async () => {
    const [project] = await loadClaudeCodeProjects(root, [agent({ cwd: '/home/someone/code/alpha' })], NOW);
    expect(project?.name).toBe('alpha');
    expect(`${project?.id} ${project?.name}`).not.toContain('/');
  });

  it('prefers the name the CLI reports over the transcript-generated title', async () => {
    writeTranscript('slug-a', 'sess-1', jsonl(reply('hi'), { type: 'ai-title', aiTitle: 'Generated' }));
    const [project] = await loadClaudeCodeProjects(root, [agent({ name: 'vam' })], NOW);
    expect(project?.sessions[0]?.title).toBe('vam');
  });

  it('falls back to the generated title when the CLI reports no name', async () => {
    writeTranscript('slug-a', 'sess-1', jsonl(reply('hi'), { type: 'ai-title', aiTitle: 'Generated' }));
    const [project] = await loadClaudeCodeProjects(root, [agent({ name: null })], NOW);
    expect(project?.sessions[0]?.title).toBe('Generated');
  });

  it('carries the status the CLI gave, never one derived from the file', async () => {
    writeTranscript('slug-a', 'sess-1', jsonl(userPrompt('go'), reply('answered')), 30 * 86_400_000);
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
    for (const [name, ageMs] of [['agent-live', 0], ['agent-old', 86_400_000]] as const) {
      const f = join(subs, `${name}.jsonl`);
      writeFileSync(f, jsonl(reply('sub')));
      utimesSync(f, (NOW - ageMs) / 1000, (NOW - ageMs) / 1000);
    }
    const [project] = await loadClaudeCodeProjects(root, [agent()], NOW);
    expect(project?.sessions).toHaveLength(1);
    expect(project?.sessions[0]?.runningAgents).toBe(1);
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

  it('reads only a bounded tail, so a huge transcript costs the same as a small one', async () => {
    const filler = `${JSON.stringify({ type: 'attachment', attachment: 'x'.repeat(4096) })}\n`.repeat(4000);
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

  it('declares no capability it cannot perform, and gives a reason for each', () => {
    const { capabilities, declines, viewerScope } = CLAUDE_CODE_SOURCE.descriptor;
    expect(capabilities.recordPrompt).toBe(false);
    expect(capabilities.deliverPrompt).toBe(false);
    expect(capabilities.liveUpdates).toBe(false);
    for (const [name, able] of Object.entries(capabilities)) {
      if (able) continue;
      expect(declines[name as keyof typeof capabilities], `no decline for ${name}`).toBeTruthy();
    }
    expect(viewerScope.kind).toBe('connection');
  });
});
