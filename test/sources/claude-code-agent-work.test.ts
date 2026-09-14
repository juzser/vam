/**
 * READING ONE SUBAGENT'S WORK OFF DISK, for the Agents pane's detail side.
 *
 * ── WHY THIS READS TWO WINDOWS AND NOT ONE ───────────────────────────────
 * Measured over all 872 subagent transcripts on this machine: the median is
 * 453 KB, p90 is 1.4 MB, the largest is 46 MB, and only 52 of them -- SIX PER
 * CENT -- fit inside the 128 KiB window a session tail is read with. So a tail
 * alone would show the agent's recent work with no sign of what it was ever
 * asked to do, for 94 of every 100 agents.
 *
 * The brief is the FIRST thing in the file and the work is the LAST, so this
 * reads both ends and says, honestly, that it did not read the middle. One
 * read when the whole file fits; two when it does not.
 *
 * ── AND WHY IT IS ON DEMAND ──────────────────────────────────────────────
 * `source.ts`'s poll budget is a 128 KiB tail per LIVE SESSION every ten
 * seconds. A session here has up to 460 agent transcripts beside it, and
 * reading them on that poll is precisely the cost that budget exists to
 * refuse. This is asked for by a person who opened a tab and picked a row --
 * the same rule `history.ts` states for scrolling back.
 *
 * Every fixture is built in a fresh temp directory. The operator's real
 * transcripts are never read here and no home path is written into a fixture.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_WORK_WINDOW_BYTES,
  readAgentWork,
} from '../../src/main/sources/claude-code/agent-work.js';
import { OPERATOR_HANDOFF } from '../../src/main/sources/claude-code/subagent.js';

const brief = (text: string) =>
  JSON.stringify({
    type: 'user',
    isSidechain: true,
    timestamp: '2026-01-01T10:00:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text }] },
  });

const fromOperator = (words: string, at: string) =>
  JSON.stringify({
    type: 'user',
    isMeta: true,
    isSidechain: true,
    timestamp: at,
    message: { role: 'user', content: [{ type: 'text', text: `${OPERATOR_HANDOFF}\n${words}` }] },
  });

const said = (text: string, at: string) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: true,
    timestamp: at,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });

const called = (name: string, at: string, id: string) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: true,
    timestamp: at,
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input: {} }] },
  });

describe('readAgentWork', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-agent-work-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A session transcript with a subagents directory beside it, as on disk. */
  const write = (sessionId: string, agentId: string, body: string) => {
    const dir = join(root, 'proj', sessionId, 'subagents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, 'proj', `${sessionId}.jsonl`), '');
    writeFileSync(join(dir, `${agentId}.jsonl`), body);
    return join(root, 'proj', `${sessionId}.jsonl`);
  };

  const read = (path: string, agentId: string, windowBytes?: number) =>
    readAgentWork(path, agentId, windowBytes);

  it('reads a whole small agent in one window', async () => {
    const path = write(
      'sess-1',
      'agent-a',
      [brief('Find every caller.'), said('found three', '2026-01-01T10:01:00.000Z')].join('\n'),
    );
    const work = await read(path, 'agent-a');
    expect(work.kind).toBe('work');
    if (work.kind !== 'work') return;
    expect(work.turns.map((t) => t.input)).toEqual(['Find every caller.']);
    expect(work.turns[0]?.output).toBe('found three');
  });

  /**
   * NOTHING IS MISSING, AND IT SAYS SO POSITIVELY. `whole` is read off the
   * window having begun at byte 0 -- the same rule `history.ts` keeps for
   * `reachedStart`, and for the same reason: an empty middle must never be
   * inferred from a short list.
   */
  it('says it read the whole thing when it did', async () => {
    const path = write('sess-1', 'agent-a', brief('small enough to fit'));
    const work = await read(path, 'agent-a');
    expect(work.kind === 'work' && work.whole).toBe(true);
  });

  it('does not repeat the brief as a separate turn when it read the whole file', async () => {
    const path = write('sess-1', 'agent-a', brief('the only turn'));
    const work = await read(path, 'agent-a');
    expect(work.kind === 'work' && work.brief).toBeNull();
  });

  describe('an agent too large for one window', () => {
    /** Filler that is real transcript lines, so the parser has to walk it. */
    const filler = (n: number, at: string) =>
      Array.from({ length: n }, (_, i) => called(`Read${i}`, at, `tu-${i}`)).join('\n');

    const big = () =>
      [
        brief('The brief, which is the first thing in the file.'),
        filler(1200, '2026-01-01T10:30:00.000Z'),
        fromOperator('what they asked once it was already running', '2026-01-01T11:00:00.000Z'),
        said('the newest answer', '2026-01-01T11:01:00.000Z'),
      ].join('\n');

    it('still finds the brief, which lives at the other end of the file', async () => {
      const path = write('sess-1', 'agent-a', big());
      const work = await read(path, 'agent-a', 4096);
      expect(work.kind === 'work' && work.brief?.input).toBe(
        'The brief, which is the first thing in the file.',
      );
    });

    it('shows the newest turn, which is the one the operator is looking for', async () => {
      const path = write('sess-1', 'agent-a', big());
      const work = await read(path, 'agent-a', 4096);
      expect(work.kind === 'work' && work.turns.at(-1)?.input).toBe(
        'what they asked once it was already running',
      );
    });

    /**
     * AND IT ADMITS THE MIDDLE. Drawing the two ends joined would claim the
     * agent went straight from its brief to its newest turn, which is the one
     * thing the operator cannot check.
     */
    it('does not claim to have read the middle', async () => {
      const path = write('sess-1', 'agent-a', big());
      const work = await read(path, 'agent-a', 4096);
      expect(work.kind === 'work' && work.whole).toBe(false);
    });

    it('mints ids the two ends cannot collide on', async () => {
      const path = write('sess-1', 'agent-a', big());
      const work = await read(path, 'agent-a', 4096);
      if (work.kind !== 'work') throw new Error('expected work');
      const ids = [work.brief?.id, ...work.turns.map((t) => t.id)].filter((x) => x !== undefined);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('what it cannot read', () => {
    it('is unavailable for an agent that does not exist', async () => {
      const path = write('sess-1', 'agent-a', brief('x'));
      const work = await read(path, 'agent-missing');
      expect(work.kind).toBe('unavailable');
    });

    /**
     * AN AGENT ID IS A FILE NAME AND NOTHING ELSE. It arrives over IPC from a
     * renderer, so a traversal in it must not reach a file beside the
     * directory it names -- the rule every path this repo builds from an
     * untrusted string keeps.
     */
    it('refuses an id that tries to leave the subagents directory', async () => {
      const path = write('sess-1', 'agent-a', brief('x'));
      writeFileSync(join(root, 'proj', 'sess-1', 'secret.jsonl'), brief('not yours'));
      for (const id of ['../secret', '../../proj/sess-1', 'a/../../secret', '/etc/hosts']) {
        expect((await read(path, id)).kind).toBe('unavailable');
      }
    });

    /**
     * AND THE IDS THAT SURVIVE `basename` ARE STILL REFUSED, one line later and
     * for a better reason. `basename('..')` is `'..'`, so the disagreement
     * check waves those through; they name `<subagents>/...jsonl`, a file
     * inside the directory that does not exist. This asserts the OUTCOME and
     * deliberately not the mechanism -- an earlier `.`-prefix check was removed
     * precisely because mutating it away changed nothing this could see.
     */
    it('refuses the relative-directory names that survive a basename check', async () => {
      const path = write('sess-1', 'agent-a', brief('x'));
      for (const id of ['', '.', '..', '.hidden']) {
        expect((await read(path, id)).kind).toBe('unavailable');
      }
    });

    it('is unavailable rather than empty for an agent with nothing in it', async () => {
      const path = write('sess-1', 'agent-a', '');
      expect((await read(path, 'agent-a')).kind).toBe('unavailable');
    });

    /**
     * A WINDOW THAT HOLDS NO WHOLE TURN IS NOT A FAILURE. One tool result can
     * exceed the window on its own (`history.ts` measured it), and the honest
     * answer is a read with no turns in it -- never "this agent is broken".
     */
    it('answers with no turns rather than a failure when the window holds none', async () => {
      const path = write('sess-1', 'agent-a', [brief('the brief'), 'x'.repeat(9000)].join('\n'));
      const work = await read(path, 'agent-a', 4096);
      expect(work.kind).toBe('work');
      expect(work.kind === 'work' && work.turns).toEqual([]);
    });
  });

  it('reads a window no larger than it says it does', () => {
    expect(AGENT_WORK_WINDOW_BYTES).toBe(128 * 1024);
  });
});
