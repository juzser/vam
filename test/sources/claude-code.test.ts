/**
 * The Claude Code transcript source: parsing (pure) and the bounded walk (fs).
 *
 * Every fixture here is built in a fresh temp directory. The operator's real
 * transcripts are never read by a test, and no home path is ever written into
 * one -- `mkdtemp` under `os.tmpdir()` is the only root any of this touches.
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_SOURCE,
  loadClaudeCodeProjects,
} from '../../src/main/sources/claude-code/source.js';
import { compactAge, summarizeTranscript } from '../../src/main/sources/claude-code/transcript.js';

const NOW = Date.parse('2026-09-03T09:05:00.000Z');
const CTX = { fallbackId: 'fallback', mtimeMs: NOW, nowMs: NOW, runningAgents: 0 };

const jsonl = (...lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n');

const userPrompt = (text: string) => ({ type: 'last-prompt', lastPrompt: text });
const reply = (text: string, timestamp = '2026-09-03T09:00:00.000Z') => ({
  type: 'assistant',
  timestamp,
  cwd: '/w/demo',
  gitBranch: 'main',
  sessionId: 'sess-1',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});
const toolCall = (name: string, description: string) => ({
  type: 'assistant',
  timestamp: '2026-09-03T09:04:00.000Z',
  cwd: '/w/demo',
  sessionId: 'sess-1',
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', name, input: { description } }],
    stop_reason: 'tool_use',
  },
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

describe('summarizeTranscript', () => {
  it('reads the working directory, the session id and the branch off the tail', () => {
    const s = summarizeTranscript(jsonl(reply('hi')), CTX);
    expect(s?.cwd).toBe('/w/demo');
    expect(s?.session.id).toBe('sess-1');
    expect(s?.session.epic).toBe('main');
  });

  it('prefers an operator-set custom title over the generated one', () => {
    const withAi = summarizeTranscript(
      jsonl(reply('hi'), { type: 'ai-title', aiTitle: 'Generated' }),
      CTX,
    );
    expect(withAi?.session.title).toBe('Generated');
    const withCustom = summarizeTranscript(
      jsonl(
        reply('hi'),
        { type: 'ai-title', aiTitle: 'Generated' },
        { type: 'custom-title', customTitle: 'Mine' },
      ),
      CTX,
    );
    expect(withCustom?.session.title).toBe('Mine');
  });

  it('pairs each operator prompt with the last reply of its own turn, newest first', () => {
    const s = summarizeTranscript(
      jsonl(
        userPrompt('first ask'),
        reply('working on it'),
        reply('first answer'),
        userPrompt('second ask'),
        reply('second answer'),
      ),
      CTX,
    );
    expect(s?.session.decisions.map((d) => [d.input, d.output])).toEqual([
      ['second ask', 'second answer'],
      ['first ask', 'first answer'],
    ]);
  });

  it('leaves output null for a turn that has produced no text yet', () => {
    const s = summarizeTranscript(jsonl(userPrompt('go'), toolCall('Bash', 'run it')), CTX);
    expect(s?.session.decisions[0]?.output).toBeNull();
  });

  it('is running, with an activity line, only while mid-turn AND freshly touched', () => {
    const mid = jsonl(userPrompt('go'), toolCall('Bash', 'run the gates'));
    const fresh = summarizeTranscript(mid, CTX);
    expect(fresh?.session.status).toBe('running');
    expect(fresh?.session.activity).toBe('Bash: run the gates');

    const stale = summarizeTranscript(mid, { ...CTX, mtimeMs: NOW - 86_400_000 });
    expect(stale?.session.status).toBe('waiting');
    expect(stale?.session.activity).toBeNull();
  });

  it('is waiting once the turn has ended, however fresh the file is', () => {
    const s = summarizeTranscript(
      jsonl(userPrompt('go'), reply('done', '2026-09-03T09:04:59.000Z')),
      CTX,
    );
    expect(s?.session.status).toBe('waiting');
  });

  it('is failed when the last assistant line carries an api error', () => {
    const s = summarizeTranscript(
      jsonl(userPrompt('go'), { ...reply('overloaded'), isApiErrorMessage: true }),
      CTX,
    );
    expect(s?.session.status).toBe('failed');
  });

  it('never reports done, which a transcript cannot express', () => {
    for (const mtimeMs of [NOW, NOW - 40 * 86_400_000]) {
      const s = summarizeTranscript(jsonl(userPrompt('go'), reply('answer')), { ...CTX, mtimeMs });
      expect(s).not.toBeNull();
      expect(s?.session.status).not.toBe('done');
    }
  });

  it('marks every session it emits as human-started, so the agent filter keeps them visible', () => {
    const s = summarizeTranscript(jsonl(reply('hi')), CTX);
    expect(s?.session.origin?.startedBy).toBe('human');
  });

  it('survives a truncated first line and lines that are not json', () => {
    const s = summarizeTranscript(`{"type":"assis\n${jsonl(reply('hi'))}\nnot json`, CTX);
    expect(s?.cwd).toBe('/w/demo');
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

  const writeSession = (dir: string, id: string, body: string, ageMs = 0) => {
    mkdirSync(join(root, dir), { recursive: true });
    const file = join(root, dir, `${id}.jsonl`);
    writeFileSync(file, body);
    const when = (NOW - ageMs) / 1000;
    utimesSync(file, when, when);
    return file;
  };

  const sessionBody = (cwd: string, id: string) =>
    jsonl(userPrompt('do the thing'), { ...reply('done'), cwd, sessionId: id });

  it('groups sessions by their recorded working directory, named by its last segment', async () => {
    writeSession('slug-a', 'one', sessionBody('/home/someone/code/alpha', 'one'));
    writeSession('slug-b', 'two', sessionBody('/home/someone/code/alpha', 'two'));
    writeSession('slug-c', 'three', sessionBody('/home/someone/code/beta', 'three'));

    const projects = await loadClaudeCodeProjects(root, NOW);
    const named = Object.fromEntries(projects.map((p) => [p.name, p.sessions.length]));
    expect(named).toEqual({ alpha: 2, beta: 1 });
  });

  it('never renders a filesystem path into a project id or name', async () => {
    writeSession('slug-a', 'one', sessionBody('/home/someone/code/alpha', 'one'));
    const [project] = await loadClaudeCodeProjects(root, NOW);
    expect(project?.name).toBe('alpha');
    expect(`${project?.id} ${project?.name}`).not.toContain('/');
  });

  it('drops sessions older than the recency window instead of parsing them', async () => {
    writeSession('slug-a', 'fresh', sessionBody('/w/alpha', 'fresh'), 60_000);
    writeSession('slug-a', 'ancient', sessionBody('/w/alpha', 'ancient'), 90 * 86_400_000);
    const [project] = await loadClaudeCodeProjects(root, NOW);
    expect(project?.sessions.map((s) => s.id)).toEqual(['fresh']);
  });

  it('counts a freshly-touched subagent transcript as a running agent, never as a session', async () => {
    writeSession(
      'slug-a',
      'one',
      jsonl(userPrompt('go'), { ...reply('x'), cwd: '/w/alpha' }, toolCall('Task', 'spawn')),
    );
    const subs = join(root, 'slug-a', 'one', 'subagents');
    mkdirSync(subs, { recursive: true });
    for (const [name, ageMs] of [
      ['agent-live', 0],
      ['agent-old', 86_400_000],
    ] as const) {
      const f = join(subs, `${name}.jsonl`);
      writeFileSync(f, jsonl(reply('sub')));
      utimesSync(f, (NOW - ageMs) / 1000, (NOW - ageMs) / 1000);
    }
    const [project] = await loadClaudeCodeProjects(root, NOW);
    expect(project?.sessions).toHaveLength(1);
    expect(project?.sessions[0]?.runningAgents).toBe(1);
  });

  it('reads only a bounded tail, so a huge transcript costs the same as a small one', async () => {
    const filler =
      `${JSON.stringify({ type: 'attachment', attachment: 'x'.repeat(4096) })}\n`.repeat(4000);
    writeSession('slug-a', 'big', filler + sessionBody('/w/alpha', 'big'));
    const started = Date.now();
    const [project] = await loadClaudeCodeProjects(root, NOW);
    expect(project?.sessions[0]?.decisions[0]?.input).toBe('do the thing');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('returns nothing, rather than throwing, when there is no transcript root at all', async () => {
    writeSession('slug-a', 'one', sessionBody('/w/alpha', 'one'));
    expect(await loadClaudeCodeProjects(root, NOW)).toHaveLength(1);
    await expect(loadClaudeCodeProjects(join(root, 'absent'), NOW)).resolves.toEqual([]);
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
