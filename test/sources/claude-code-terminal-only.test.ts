/**
 * The TERMINAL-ONLY state: a vam pane whose agent has exited (by hand, or on
 * its own) but whose conversation vam still knows -- `docs/design/vam-
 * terminal-only.md`. Identity survives the exit: the row keeps the
 * conversation's title, branch and transcript, carries `status: 'terminal'`
 * rather than the anonymous `unstarted`, and a `resumeCommand` for the
 * secondary "Resume" action.
 *
 * TWO HALVES, TESTED SEPARATELY. `terminalRow` (`pane-row.ts`) is the pure
 * shape: given a tmux session and what was read off its conversation, what
 * `Session` does it become. `loadClaudeCodeProjects` (`source.ts`) is the
 * wiring: it is what looks the transcript up by the pane's own `@vam-session`
 * tag and falls back to the plain `unstarted` row when there is nothing to
 * find -- and it is also where `@vam-session` gets WRITTEN, opportunistically,
 * for a live row this poll can already prove a pane for (`docs/design/vam-
 * owns-the-session.md` §2: "guess once, then write it down" -- except this is
 * not a guess, `paneForRow`'s published-pane tier already proved it).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LiveAgent } from '../../src/main/sources/claude-code/agents.js';
import { paneRowId, terminalRow } from '../../src/main/sources/claude-code/pane-row.js';
import { projectIdOf } from '../../src/main/sources/claude-code/project-id.js';
import { loadClaudeCodeProjects } from '../../src/main/sources/claude-code/source.js';
import { tagVamSessionArgv } from '../../src/main/sources/tmux/argv.js';
import type { TmuxRun, TmuxSession } from '../../src/main/sources/tmux/spawn.js';

const NOW = Date.parse('2026-09-23T09:05:00.000Z');
const ALPHA = '/w/alpha';
const ALPHA_ID = projectIdOf(ALPHA);
const CONVO_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const jsonl = (...lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const userPrompt = (text: string) => ({ type: 'last-prompt', lastPrompt: text });
const reply = (text: string) => ({
  type: 'assistant',
  cwd: ALPHA,
  gitBranch: 'feature/x',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});

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

describe('terminalRow -- the pure shape', () => {
  const session: TmuxSession = {
    project: ALPHA_ID,
    pid: '777',
    name: 'vam-alpha-new001',
    command: 'zsh',
    vamSessionId: CONVO_ID,
  };

  it('carries the conversation’s own identity, not the pane’s', () => {
    const row = terminalRow(session, {
      sessionId: CONVO_ID,
      title: 'fix the flaky test',
      decisions: [],
      branch: 'feature/x',
      resumeCommand: `claude --resume ${CONVO_ID}`,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(row).toMatchObject({
      // THE ROW ID STAYS PANE-ROUTED, deliberately: `recordPrompt` and
      // `closeSession` both dispatch on `paneNameOf(id)` (`source.ts`), and
      // routing this row through the exact same pane-id scheme the anonymous
      // `unstarted` row already uses is what keeps Start/Resume/Close working
      // with no change to either write path.
      id: paneRowId('vam-alpha-new001'),
      title: 'fix the flaky test',
      status: 'terminal',
      branch: 'feature/x',
      runningAgents: 0,
      source: 'claude-code',
      vamControlled: true,
      pane: 'vam-alpha-new001',
      resumeCommand: `claude --resume ${CONVO_ID}`,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('omits resumeCommand rather than inventing one', () => {
    const row = terminalRow(session, {
      sessionId: CONVO_ID,
      title: 'x',
      decisions: [],
      branch: null,
      resumeCommand: null,
      createdAt: null,
    });
    expect(row.resumeCommand).toBeUndefined();
  });

  /**
   * `runningProvider` -- the same fact `paneRow`'s own sibling test carries,
   * for the `terminal` row: this pane's foreground command is the SAME
   * `TmuxSession.command` this row is already built from, so a provider
   * started by hand over a `terminal` row (Resume's own alternative) is
   * caught with no second read either.
   */
  it('is absent for a plain shell -- the fixture session’s own "zsh"', () => {
    const row = terminalRow(session, {
      sessionId: CONVO_ID,
      title: 'x',
      decisions: [],
      branch: null,
      resumeCommand: null,
    });
    expect(row.runningProvider).toBeUndefined();
  });

  it('names the provider when the pane’s foreground command is one', () => {
    const running: TmuxSession = { ...session, command: 'codex' };
    const row = terminalRow(running, {
      sessionId: CONVO_ID,
      title: 'x',
      decisions: [],
      branch: null,
      resumeCommand: null,
    });
    expect(row.runningProvider).toBe('codex');
  });
});

describe('loadClaudeCodeProjects -- identity survives the exit', () => {
  let root: string;
  let sessionsRoot: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-terminal-only-'));
    sessionsRoot = mkdtempSync(join(tmpdir(), 'vam-terminal-only-sessions-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(sessionsRoot, { recursive: true, force: true });
  });

  const writeTranscript = (sessionId: string, body: string) => {
    const dir = join(root, 'w-alpha');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${sessionId}.jsonl`), body);
  };

  const load = (agents: readonly LiveAgent[], tmux: readonly TmuxSession[] | null) =>
    loadClaudeCodeProjects(root, agents, NOW, undefined, sessionsRoot, null, tmux);

  it('is a `terminal` row carrying the conversation’s title, branch and transcript', async () => {
    writeTranscript(CONVO_ID, jsonl(userPrompt('fix it'), reply('the fix landed')));
    const [project] = await load(
      [agent()],
      [
        {
          project: ALPHA_ID,
          pid: '777',
          name: 'vam-alpha-new001',
          command: 'zsh',
          vamSessionId: CONVO_ID,
        },
      ],
    );
    const row = project?.sessions.find((s) => s.status === 'terminal');
    expect(row).toMatchObject({
      id: paneRowId('vam-alpha-new001'),
      status: 'terminal',
      branch: 'feature/x',
      pane: 'vam-alpha-new001',
      vamControlled: true,
      resumeCommand: `claude --resume ${CONVO_ID}`,
    });
    expect(row?.decisions.length).toBeGreaterThan(0);
  });

  it('falls back to the anonymous `unstarted` row when the tagged conversation has no transcript', async () => {
    // Tagged, but nothing on disk for it -- a transcript vam cannot find is
    // not evidence of an identity, so the honest fallback is the same
    // anonymous row an untagged pane already draws.
    const [project] = await load(
      [agent()],
      [
        {
          project: ALPHA_ID,
          pid: '777',
          name: 'vam-alpha-new001',
          command: 'zsh',
          vamSessionId: CONVO_ID,
        },
      ],
    );
    const row = project?.sessions.find((s) => s.id === paneRowId('vam-alpha-new001'));
    expect(row?.status).toBe('unstarted');
    expect(row?.resumeCommand).toBeUndefined();
  });

  it('does not disturb the anonymous row when the pane was never tagged at all', async () => {
    const [project] = await load(
      [agent()],
      [{ project: ALPHA_ID, pid: '777', name: 'vam-alpha-new001', command: 'zsh' }],
    );
    const row = project?.sessions.find((s) => s.id === paneRowId('vam-alpha-new001'));
    expect(row?.status).toBe('unstarted');
  });
});

describe('load() -- writing @vam-session while the id is still provable', () => {
  let root: string;
  let sessionsRoot: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-terminal-tag-'));
    sessionsRoot = mkdtempSync(join(tmpdir(), 'vam-terminal-tag-sessions-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(sessionsRoot, { recursive: true, force: true });
  });

  /** What Claude Code publishes about itself once it is running under tmux --
   *  `session-pane.ts`'s own fixture shape, copied from `claude-code-pane-
   *  rows.test.ts`. */
  const publish = (pid: number, sessionId: string, pane: string) =>
    writeFileSync(
      join(sessionsRoot, `${pid}.json`),
      JSON.stringify({ pid, sessionId, status: 'idle', tmux: `${pane}:@0.%0` }),
    );

  it('tags the pane a live row is PROVEN to be in, the moment the pairing is known', async () => {
    publish(4242, CONVO_ID, 'vam-alpha-aa11bb');
    const calls: (readonly string[])[] = [];
    const run: TmuxRun = async (argv) => {
      calls.push(argv);
      return { failure: null, stdout: '', stderr: '' };
    };
    await loadClaudeCodeProjects(
      root,
      [{ ...agent({ key: `${CONVO_ID}#4242`, sessionId: CONVO_ID, pid: 4242 }) }],
      NOW,
      undefined,
      sessionsRoot,
      null,
      [{ project: ALPHA_ID, pid: '1', name: 'vam-alpha-aa11bb', command: 'claude' }],
      [],
      undefined,
      null,
      null,
      run,
    );
    expect(calls).toContainEqual(tagVamSessionArgv('vam-alpha-aa11bb', CONVO_ID));
  });

  it('never re-tags a pane whose @vam-session already agrees -- one write, not one per poll', async () => {
    publish(4242, CONVO_ID, 'vam-alpha-aa11bb');
    const calls: (readonly string[])[] = [];
    const run: TmuxRun = async (argv) => {
      calls.push(argv);
      return { failure: null, stdout: '', stderr: '' };
    };
    await loadClaudeCodeProjects(
      root,
      [{ ...agent({ key: `${CONVO_ID}#4242`, sessionId: CONVO_ID, pid: 4242 }) }],
      NOW,
      undefined,
      sessionsRoot,
      null,
      [
        {
          project: ALPHA_ID,
          pid: '1',
          name: 'vam-alpha-aa11bb',
          command: 'claude',
          vamSessionId: CONVO_ID,
        },
      ],
      [],
      undefined,
      null,
      null,
      run,
    );
    expect(calls.some((argv) => argv[0] === 'set-option')).toBe(false);
  });

  it('never writes when no runner was handed to it -- a read path by default', async () => {
    publish(4242, CONVO_ID, 'vam-alpha-aa11bb');
    // No 11th argument at all: the ordinary `load()` shape every other test
    // in this suite calls with, which must keep behaving as a pure read.
    const projects = await loadClaudeCodeProjects(
      root,
      [{ ...agent({ key: `${CONVO_ID}#4242`, sessionId: CONVO_ID, pid: 4242 }) }],
      NOW,
      undefined,
      sessionsRoot,
      null,
      [{ project: ALPHA_ID, pid: '1', name: 'vam-alpha-aa11bb', command: 'claude' }],
    );
    expect(projects[0]?.sessions[0]?.pane).toBe('vam-alpha-aa11bb');
  });
});
