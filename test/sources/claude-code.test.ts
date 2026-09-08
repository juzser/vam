/**
 * The Claude Code source: the live-session list (`claude agents --json`), the
 * transcript tail parser, and the join between them.
 *
 * Every fixture is built in a fresh temp directory and every agent list is
 * handed in by the test. The operator's real transcripts are never read here,
 * the real CLI is never spawned, and no home path is written into a fixture --
 * `mkdtemp` under `os.tmpdir()` is the only root any of this touches.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type LiveAgent,
  listLiveAgents,
  parseAgentRows,
} from '../../src/main/sources/claude-code/agents.js';
import { projectIdOf } from '../../src/main/sources/claude-code/project-id.js';
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

  it("keeps the CLI's three interactive words apart: busy is running, idle is idle, and only the CLI's own `waiting` is vam's waiting", () => {
    const [busy, idle, waiting] = parseAgentRows(
      JSON.stringify([
        row({ status: 'busy', sessionId: 'a' }),
        row({ status: 'idle', sessionId: 'b' }),
        row({ status: 'waiting', sessionId: 'c' }),
      ]),
    );
    expect(busy?.status).toBe('running');
    // Measured against the real CLI: `idle` is the COMMONEST interactive
    // value there is (3 of 5 rows on a working machine). Reading it as
    // `waiting` put an amber "needs you" on every session the operator had
    // simply finished with, which is the badge going off for nothing --
    // and a signal that cries wolf is worse than no signal at all.
    expect(idle?.status).toBe('idle');
    expect(waiting?.status).toBe('waiting');
  });

  it('reads an interactive status this mapping was never taught as waiting -- something to go look at, never a quiet idle it cannot vouch for', () => {
    const rows = parseAgentRows(
      JSON.stringify([
        row({ kind: 'interactive', status: 'some-future-word', sessionId: 'a' }),
        row({ kind: 'interactive', status: undefined, sessionId: 'b' }),
      ]),
      NOW,
    );
    expect(rows.map((r) => r.status)).toEqual(['waiting', 'waiting']);
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

  it("reads a background `stopped` state as done -- the CLI's own word for a background session that ended without failing", () => {
    const rows = parseAgentRows(
      JSON.stringify([row({ kind: 'background', state: 'stopped', status: undefined })]),
      NOW,
    );
    expect(rows.map((r) => r.status)).toEqual(['done']);
  });

  it('NEVER reads an unrecognised background state as waiting -- background rows carry no `status` field at all, so the fallback that reads busy/idle would silently see nothing and default to the one status that means "the ball is with you", for a row that never handed anyone a ball', () => {
    const rows = parseAgentRows(
      JSON.stringify([
        row({
          kind: 'background',
          state: 'some-future-word-this-mapping-does-not-know',
          status: undefined,
        }),
      ]),
      NOW,
    );
    expect(rows[0]?.status).not.toBe('waiting');
    // The concrete choice: flagged for attention, not folded into a quiet
    // "done" this mapping cannot actually vouch for. See `statusOf`'s doc.
    expect(rows[0]?.status).toBe('failed');
  });

  it('still maps an interactive row through its own `status` field, unaffected by the background fallback change', () => {
    const rows = parseAgentRows(
      JSON.stringify([
        row({ kind: 'interactive', status: 'busy' }),
        row({ kind: 'interactive', status: 'idle' }),
      ]),
      NOW,
    );
    expect(rows.map((r) => r.status)).toEqual(['running', 'idle']);
  });

  it('never lets a background row reach the interactive branch: `state` decides it, and an absent `status` is not read as idle', () => {
    const rows = parseAgentRows(
      JSON.stringify([
        row({ kind: 'background', state: 'stopped', status: undefined, sessionId: 'a' }),
        row({ kind: 'background', state: 'failed', status: undefined, sessionId: 'b' }),
      ]),
      NOW,
    );
    expect(rows.map((r) => r.status)).toEqual(['done', 'failed']);
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
  let binRoot: string;

  beforeEach(() => {
    binRoot = mkdtempSync(join(tmpdir(), 'vam-fake-cli-'));
  });

  afterEach(() => {
    rmSync(binRoot, { recursive: true, force: true });
  });

  /**
   * A fake `claude` that ignores its argv and behaves exactly as `body`
   * says, regardless of `agents --json --all` being appended to it -- real
   * shell binaries like `sleep` or `echo` cannot do that, since they read
   * their own argv.
   */
  const fakeCli = (body: string): string => {
    const path = join(binRoot, 'claude');
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  };

  // These two used to assert `resolves.toEqual([])`: a missing binary and a
  // non-zero exit both degraded to "no sessions", which is the exact defect
  // this file exists to fix -- "vam could not ask" must never read as "the
  // CLI answered zero". They now assert the honest `unavailable` shape, each
  // with its own code.
  it('reports the binary as unavailable, not as no sessions, when it is not installed', async () => {
    await expect(listLiveAgents('definitely-not-a-real-binary-vam')).resolves.toMatchObject({
      kind: 'unavailable',
      code: 'cli-missing',
    });
  });

  it('reports a non-zero exit as unavailable with its own code', async () => {
    await expect(listLiveAgents(fakeCli('exit 1'))).resolves.toMatchObject({
      kind: 'unavailable',
      code: 'cli-failed',
    });
  });

  it('reports a timeout as unavailable, distinct from a plain failure', async () => {
    // Outlives `CLI_TIMEOUT_MS` (5s), so `execFile` kills it itself.
    await expect(listLiveAgents(fakeCli('sleep 10'))).resolves.toMatchObject({
      kind: 'unavailable',
      code: 'timed-out',
    });
  }, 10_000);

  it('reports unparseable stdout as unavailable rather than as no sessions', async () => {
    await expect(listLiveAgents(fakeCli('echo not-json'))).resolves.toMatchObject({
      kind: 'unavailable',
      code: 'unreadable-output',
    });
  });

  it('reports a genuine empty answer as ok with no agents, and this must never regress', async () => {
    // The CLI answered and said "none" -- the one situation that IS an empty
    // list, and must keep reading as one rather than as `unavailable`.
    await expect(listLiveAgents(fakeCli('echo []'))).resolves.toEqual({
      kind: 'ok',
      agents: [],
    });
  });
});

/**
 * `CLAUDE_CODE_SOURCE`'s write surface calls `listLiveAgents()` with its
 * default binary name (`claude`), so these tests reach it by putting a fake
 * one first on `PATH` -- the only injection point that exists for the real
 * source object, as opposed to `stopSession`/`replyToSession`, which take an
 * agent list directly and are exercised above via `loadClaudeCodeProjects`.
 */
describe('CLAUDE_CODE_SOURCE write path when the CLI cannot be asked', () => {
  let binRoot: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    binRoot = mkdtempSync(join(tmpdir(), 'vam-fake-cli-path-'));
    const claudePath = join(binRoot, 'claude');
    writeFileSync(claudePath, '#!/bin/sh\nexit 1\n');
    chmodSync(claudePath, 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${binRoot}:${originalPath ?? ''}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    rmSync(binRoot, { recursive: true, force: true });
  });

  it('reports closeSession as unreachable, never as "may have exited", when the CLI fails', async () => {
    const result = await CLAUDE_CODE_SOURCE.closeSession?.('sess-1#1');
    expect(result).toMatchObject({ kind: 'unreachable', code: 'cli-failed' });
    // The wrong contract this guards: a failed listing must never surface as
    // the row-not-found refusal, which asserts the session "may have exited"
    // -- a claim vam has no basis for when it could not ask at all.
    expect(result?.code).not.toBe('unknown-session');
    expect(result?.message).not.toMatch(/may have exited/);
  });

  it('reports recordPrompt as unreachable, never as "may have exited", when the CLI fails', async () => {
    const result = await CLAUDE_CODE_SOURCE.recordPrompt?.('sess-1#1', 'hi');
    expect(result).toMatchObject({ kind: 'unreachable', code: 'cli-failed' });
    expect(result?.code).not.toBe('unknown-session');
    expect(result?.message).not.toMatch(/may have exited/);
  });

  it('reports createSession as unreachable, never as a project-not-found refusal, when the CLI fails', async () => {
    const result = await CLAUDE_CODE_SOURCE.createSession?.('proj-1', 'title');
    expect(result).toMatchObject({ kind: 'unreachable', code: 'cli-failed' });
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

  /**
   * The defect this whole change fixes: a fourth request used to push the
   * first answer out of `decisions` entirely, before it ever reached the
   * canvas or the detail panel. Six turns, so "the newest three" (the OLD
   * cap, borrowed from the canvas's slot count) and "all of them" are
   * different lists -- this fails against the code this replaces.
   */
  it('keeps every turn the window holds, not just the newest three', () => {
    const lines: unknown[] = [];
    for (let i = 0; i < 6; i++) {
      lines.push(userPrompt(`ask ${i}`), reply(`answer ${i}`));
    }
    const facts = summarizeTranscript(jsonl(...lines), 'k');
    expect(facts.decisions).toHaveLength(6);
    // Newest first, unchanged.
    expect(facts.decisions[0]?.input).toBe('ask 5');
    expect(facts.decisions[5]?.input).toBe('ask 0');
  });

  /**
   * Not uncapped, either -- a byte-derived backstop, not the removal of one.
   * `source.ts`'s `TAIL_BYTES` (128 KiB) already bounds the whole window this
   * function is ever handed, so the number of turns it could possibly carry
   * is already bounded by that budget divided by the smallest line able to
   * open one: `{"type":"last-prompt","lastPrompt":"x"}` is 39 bytes on the
   * wire, 40 with its newline, and 131072 / 40 = 3276.8, floored to 3276.
   *
   * 3300 alternating one-character prompts -- alternating so no two adjacent
   * ones dedupe into a single turn, per `summarizeTranscript`'s own rule --
   * is comfortably past that, so this is the backstop actually binding, not
   * the input running out first.
   */
  it('still bounds the window -- a pathological tail cannot grow it without limit', () => {
    const lines: string[] = [];
    for (let i = 0; i < 3300; i++) {
      lines.push(JSON.stringify({ type: 'last-prompt', lastPrompt: i % 2 === 0 ? 'a' : 'b' }));
    }
    const facts = summarizeTranscript(lines.join('\n'), 'k');
    expect(facts.decisions).toHaveLength(3276);
  });

  /**
   * THE FOLLOW-UP DEFECT. `id` used to be `${prefix}:${index}`, counted from
   * the newest end -- so appending a turn shifted every EARLIER turn's index
   * by one, and the same id string named a different turn on the next poll.
   * That was invisible while nothing remembered an id across two parses; it
   * stopped being invisible once the detail panel and the canvas started
   * doing exactly that (`vam-canvas-topology`, this file's own earlier fix).
   *
   * A poll, exactly as the operator's own bug report describes it: several
   * requests land while an older answer is still on screen. The SAME turn,
   * parsed before and after a new one arrives, must keep the SAME id.
   */
  it('keeps a turn’s id stable across a poll that delivers one more turn', () => {
    const before = summarizeTranscript(
      jsonl(
        userPrompt('first ask'),
        reply('first answer'),
        userPrompt('second ask'),
        reply('second answer'),
      ),
      'k',
    );
    const firstBefore = before.decisions.find((d) => d.input === 'first ask');
    expect(firstBefore).toBeDefined();

    const after = summarizeTranscript(
      jsonl(
        userPrompt('first ask'),
        reply('first answer'),
        userPrompt('second ask'),
        reply('second answer'),
        userPrompt('third ask'),
        reply('third answer'),
      ),
      'k',
    );
    const firstAfter = after.decisions.find((d) => d.input === 'first ask');
    expect(firstAfter?.id).toBe(firstBefore?.id);
  });

  /**
   * Content alone is not enough: two turns can carry the exact same words --
   * "continue", sent twice, with something else in between (adjacent repeats
   * already collapse into one turn, above). Each still needs its OWN id, or
   * selecting one by id would resolve to whichever comes first.
   */
  it('gives two turns with identical input text different ids', () => {
    const facts = summarizeTranscript(
      jsonl(
        userPrompt('continue'),
        reply('did a'),
        userPrompt('something else'),
        reply('did b'),
        userPrompt('continue'),
        reply('did c'),
      ),
      'k',
    );
    const continues = facts.decisions.filter((d) => d.input === 'continue');
    expect(continues).toHaveLength(2);
    expect(continues[0]?.id).not.toBe(continues[1]?.id);
    expect(new Set(facts.decisions.map((d) => d.id)).size).toBe(facts.decisions.length);
  });

  /**
   * And each occurrence's id has to survive the same poll the first test
   * above checks for a unique turn -- a duplicate's id is not allowed to
   * shift just because a later, unrelated turn arrived either.
   */
  it('keeps a duplicated turn’s id stable across a poll too', () => {
    const build = (extra: readonly unknown[]) =>
      jsonl(
        userPrompt('continue'),
        reply('did a'),
        userPrompt('something else'),
        reply('did b'),
        userPrompt('continue'),
        reply('did c'),
        ...extra,
      );
    const before = summarizeTranscript(build([]), 'k');
    const after = summarizeTranscript(
      build([userPrompt('fourth ask'), reply('fourth answer')]),
      'k',
    );
    const beforeIds = before.decisions.filter((d) => d.input === 'continue').map((d) => d.id);
    const afterIds = after.decisions.filter((d) => d.input === 'continue').map((d) => d.id);
    expect(afterIds).toEqual(beforeIds);
  });

  /**
   * Streaming: a turn's id is fixed the moment its prompt line opens it, so
   * more assistant text arriving for the SAME still-open turn must not mint
   * a new one -- an id that changed under a running answer would make the
   * live turn look like a different turn mid-stream.
   */
  it('keeps a turn’s id unchanged while its own output is still streaming in', () => {
    const opening = summarizeTranscript(jsonl(userPrompt('go'), reply('working')), 'k');
    const id = opening.decisions[0]?.id;
    const streamed = summarizeTranscript(
      jsonl(userPrompt('go'), reply('working'), reply('working, and more')),
      'k',
    );
    expect(streamed.decisions[0]?.id).toBe(id);
    expect(streamed.decisions[0]?.output).toBe('working, and more');
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

  /**
   * WHAT THE SESSION SAYS IT IS BLOCKED ON. A tool-approval prompt leaves no
   * transcript record at all, so `questions` is empty for it and this is the
   * only surface that can tell the operator the session is stuck.
   */
  describe('waitingFor', () => {
    const writeWaiting = (pid: number, over: Record<string, unknown>) => {
      writeFileSync(
        join(sessionsRoot, `${pid}.json`),
        JSON.stringify({ pid, sessionId: 'sess-1', statusUpdatedAt: NOW - 1000, ...over }),
      );
    };

    it('carries the cause a waiting process named, verbatim', async () => {
      writeWaiting(4242, { status: 'waiting', waitingFor: 'permission prompt' });
      const [project] = await loadClaudeCodeProjects(
        root,
        [agent({ pid: 4242 })],
        NOW,
        undefined,
        sessionsRoot,
      );
      expect(project?.sessions[0]?.waitingFor).toBe('permission prompt');
    });

    it('is present-but-null for a process waiting on something it did not name', async () => {
      writeWaiting(4242, { status: 'waiting' });
      const [project] = await loadClaudeCodeProjects(
        root,
        [agent({ pid: 4242 })],
        NOW,
        undefined,
        sessionsRoot,
      );
      expect(project?.sessions[0]).toHaveProperty('waitingFor');
      expect(project?.sessions[0]?.waitingFor).toBeNull();
    });

    it('is ABSENT for an idle process, and for a row with no pid to ask about', async () => {
      writeWaiting(4242, { status: 'idle', waitingFor: '-' });
      const [project] = await loadClaudeCodeProjects(
        root,
        [agent({ pid: 4242 }), agent({ key: 'sess-1#101' })],
        NOW,
        undefined,
        sessionsRoot,
      );
      expect(project?.sessions[0]).not.toHaveProperty('waitingFor');
      expect(project?.sessions[1]).not.toHaveProperty('waitingFor');
    });
  });

  /**
   * `vamControlled` is a THREE-state fact and the third state is the point:
   * absent means vam could not ask tmux, which is not the same as "vam did not
   * start this one". See `model.ts`.
   */
  describe('vamControlled', () => {
    const only = agent({ cwd: '/w/alpha' });

    it('is absent when no tmux listing was offered -- vam has nothing to say', async () => {
      const [project] = await loadClaudeCodeProjects(root, [only], NOW);
      expect(project?.sessions[0]).not.toHaveProperty('vamControlled');
    });

    it('is true for a session paired with a tmux session vam tagged', async () => {
      const [project] = await loadClaudeCodeProjects(
        root,
        [only],
        NOW,
        undefined,
        sessionsRoot,
        null,
        [{ project: projectIdOf('/w/alpha'), name: 'vam-alpha-a1b2c3' }],
      );
      expect(project?.sessions[0]?.vamControlled).toBe(true);
    });

    it('is false, not absent, for a session vam looked for and did not start', async () => {
      const [project] = await loadClaudeCodeProjects(
        root,
        [only],
        NOW,
        undefined,
        sessionsRoot,
        null,
        [],
      );
      expect(project?.sessions[0]?.vamControlled).toBe(false);
    });

    it('is true for EACH of two sessions vam started in one project', async () => {
      // The defect the operator hit: the project tag pairs a project, not a
      // session, so a second session made both rows unprovable and close
      // refused on both. Each session publishes its own pane in its own status
      // file, and that is what is read here.
      const project = projectIdOf('/w/alpha');
      for (const [pid, sessionId, pane] of [
        [4242, 'sess-alpha', 'vam-alpha-aa11bb'],
        [4243, 'sess-beta', 'vam-alpha-cc22dd'],
      ] as const) {
        writeFileSync(
          join(sessionsRoot, `${pid}.json`),
          JSON.stringify({ pid, sessionId, status: 'idle', tmux: `${pane}:@0.%0` }),
        );
      }
      const [loaded] = await loadClaudeCodeProjects(
        root,
        [
          agent({ key: 'sess-alpha#4242', sessionId: 'sess-alpha', pid: 4242, cwd: '/w/alpha' }),
          agent({ key: 'sess-beta#4243', sessionId: 'sess-beta', pid: 4243, cwd: '/w/alpha' }),
        ],
        NOW,
        undefined,
        sessionsRoot,
        null,
        [
          { project, name: 'vam-alpha-aa11bb' },
          { project, name: 'vam-alpha-cc22dd' },
        ],
      );
      expect(loaded?.sessions.map((s) => s.vamControlled)).toEqual([true, true]);
    });
  });

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

  /**
   * The `gh` reader, joined to the model. THE SPAWN NEVER HAPPENS IN A TEST:
   * the reader is a parameter, its default asks nothing, and every case below
   * injects an invented answer. A test that reached GitHub would do so with
   * whatever credentials the machine running it holds.
   */
  describe('pull requests on the session branch', () => {
    it("asks about each session branch, in that session's own directory", async () => {
      const asked: { cwd: string; branch: string | null }[] = [];
      await loadClaudeCodeProjects(
        root,
        [agent({ key: 'a#1', sessionId: 'a', cwd: '/w/atlas' })],
        NOW,
        async () => 'topic/rework',
        sessionsRoot,
        async (input) => {
          asked.push(input);
          return { kind: 'ok', prs: [] };
        },
      );
      expect(asked).toEqual([{ cwd: '/w/atlas', branch: 'topic/rework' }]);
    });

    it('carries the answer onto the session, empty list and all', async () => {
      const [project] = await loadClaudeCodeProjects(
        root,
        [agent()],
        NOW,
        async () => 'topic/rework',
        sessionsRoot,
        async () => ({ kind: 'ok', prs: [] }),
      );
      expect(project?.sessions[0]?.pullRequests).toEqual({ kind: 'ok', prs: [] });
    });

    it('carries a failure through as a failure, never as an empty list', async () => {
      const [project] = await loadClaudeCodeProjects(
        root,
        [agent()],
        NOW,
        async () => 'topic/rework',
        sessionsRoot,
        async () => ({ kind: 'unavailable', code: 'cli-missing', message: 'no gh here' }),
      );
      expect(project?.sessions[0]?.pullRequests).toEqual({
        kind: 'unavailable',
        code: 'cli-missing',
        message: 'no gh here',
      });
    });

    it('leaves the field absent, and spawns nothing, when no reader is given', async () => {
      const [project] = await loadClaudeCodeProjects(root, [agent()], NOW);
      expect(project?.sessions[0]?.pullRequests).toBeUndefined();
      expect('pullRequests' in (project?.sessions[0] ?? {})).toBe(false);
    });

    it('claims the capability it now really has', () => {
      expect(CLAUDE_CODE_SOURCE.descriptor.capabilities.pullRequests).toBe(true);
    });
  });
});
