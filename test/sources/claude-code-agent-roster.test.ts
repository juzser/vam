/**
 * The subagent roster: the pure meta parser, and the reader that walks
 * `<transcript>/subagents/`.
 *
 * The directory already existed and was already walked -- for a COUNT, which
 * threw away everything else it had touched. These tests pin the two things
 * that made the count safe and must stay true of the roster: the badge still
 * equals the number of transcripts inside the running window, and nothing an
 * agent's meta file does -- being absent, being truncated, being an array --
 * can drop the agent or throw out of `load()`.
 *
 * Every fixture is invented and lives under `mkdtemp`. No real agent id, no
 * home path.
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseAgentMeta,
  ROSTER_LIMIT,
  readAgentRoster,
} from '../../src/main/sources/claude-code/agent-roster.js';

describe('parseAgentMeta', () => {
  it('reads the two fields the pane renders and ignores the rest', () => {
    expect(
      parseAgentMeta(
        JSON.stringify({
          agentType: 'uiux',
          description: 'design review',
          toolUseId: 'toolu_invented',
          spawnDepth: 1,
        }),
      ),
    ).toEqual({ agentType: 'uiux', description: 'design review' });
  });

  it.each([
    ['malformed JSON', '{"agentType": "uiux"'],
    ['an empty file', ''],
    ['an array', '[]'],
    ['a bare string', '"uiux"'],
    ['null', 'null'],
  ])('yields both nulls for %s rather than throwing', (_label, text) => {
    expect(parseAgentMeta(text)).toEqual({ agentType: null, description: null });
  });

  it('keeps the field it has when the other is missing or the wrong type', () => {
    expect(parseAgentMeta(JSON.stringify({ agentType: 'coder' }))).toEqual({
      agentType: 'coder',
      description: null,
    });
    expect(parseAgentMeta(JSON.stringify({ agentType: 7, description: 'ship it' }))).toEqual({
      agentType: null,
      description: 'ship it',
    });
  });
});

const NOW = Date.parse('2026-09-04T10:00:00.000Z');
const MINUTE = 60_000;

describe('readAgentRoster', () => {
  let root: string;
  /** The transcript path whose sibling directory holds the agents. */
  let transcript: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-roster-'));
    transcript = join(root, 'sess-invented.jsonl');
    writeFileSync(transcript, '');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** One agent on disk: its transcript at `ageMs`, and its meta when given. */
  function writeAgent(id: string, ageMs: number, meta?: string): void {
    const dir = join(root, 'sess-invented', 'subagents');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `agent-${id}.jsonl`);
    writeFileSync(file, '{}');
    const seconds = (NOW - ageMs) / 1000;
    utimesSync(file, seconds, seconds);
    if (meta !== undefined) writeFileSync(join(dir, `agent-${id}.meta.json`), meta);
  }

  it('returns nothing at all for a session that never spawned one', async () => {
    expect(await readAgentRoster(transcript, NOW)).toEqual({ agents: [], running: 0 });
  });

  it('names each agent and marks only those inside the running window', async () => {
    writeAgent('aaa', 0, JSON.stringify({ agentType: 'coder', description: 'write the parser' }));
    writeAgent('bbb', 60 * MINUTE, JSON.stringify({ agentType: 'uiux', description: 'review' }));

    const roster = await readAgentRoster(transcript, NOW);

    expect(roster.agents).toEqual([
      { id: 'agent-aaa', type: 'coder', description: 'write the parser', running: true },
      { id: 'agent-bbb', type: 'uiux', description: 'review', running: false },
    ]);
    expect(roster.running).toBe(1);
  });

  it('keeps an agent whose meta is unreadable, with its id and running state intact', async () => {
    writeAgent('ccc', 0, '{"agentType": ');
    writeAgent('ddd', 0);

    const roster = await readAgentRoster(transcript, NOW);

    expect(roster.agents.map((a) => a.id).sort()).toEqual(['agent-ccc', 'agent-ddd']);
    for (const agent of roster.agents) {
      expect(agent.type).toBeNull();
      expect(agent.description).toBeNull();
      expect(agent.running).toBe(true);
    }
    expect(roster.running).toBe(2);
  });

  it('ignores everything in the directory that is not an agent transcript', async () => {
    writeAgent('eee', 0);
    const dir = join(root, 'sess-invented', 'subagents');
    writeFileSync(join(dir, 'notes.txt'), 'x');
    mkdirSync(join(dir, 'nested'));

    expect((await readAgentRoster(transcript, NOW)).agents.map((a) => a.id)).toEqual(['agent-eee']);
  });

  it('orders newest first and caps the roster, never below the running count', async () => {
    // Two more than the cap, all of them running: the cap must stretch rather
    // than hide an agent the badge is counting.
    const total = ROSTER_LIMIT + 2;
    for (let i = 0; i < total; i += 1) writeAgent(`live-${i}`, i);
    // ...and older ones beyond it, which the cap is for.
    for (let i = 0; i < 5; i += 1) writeAgent(`old-${i}`, (i + 60) * MINUTE);

    const roster = await readAgentRoster(transcript, NOW);

    expect(roster.running).toBe(total);
    expect(roster.agents).toHaveLength(total);
    expect(roster.agents.every((a) => a.running)).toBe(true);
    expect(roster.agents[0]?.id).toBe('agent-live-0');
  });

  it('drops the oldest when there are more agents than the cap and few are running', async () => {
    writeAgent('recent', 0);
    for (let i = 0; i < ROSTER_LIMIT + 3; i += 1) writeAgent(`old-${i}`, (i + 60) * MINUTE);

    const roster = await readAgentRoster(transcript, NOW);

    expect(roster.running).toBe(1);
    expect(roster.agents).toHaveLength(ROSTER_LIMIT);
    expect(roster.agents[0]?.id).toBe('agent-recent');
  });
});
