/**
 * The Codex source: what a row is, what it declines, and what happens when
 * the store is not there.
 *
 * EVERY FIXTURE HERE IS INVENTED, on this directory's own rule
 * (`claude-code-tail-window.test.ts`). No thread id, home path, directory name
 * or prompt from the machine running this reaches a fixture; the SHAPES were
 * measured against a real store and the values were not taken from one.
 *
 * Nothing here spawns `sqlite3` or `codex`, and nothing here reads
 * `~/.codex`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { RunCodex } from '../../src/main/sources/codex/queue.js';
import {
  codexProjectId,
  createCodexSource,
  projectsFrom,
} from '../../src/main/sources/codex/source.js';
import type { RunSqlite, ThreadRow } from '../../src/main/sources/codex/store.js';

const THREAD = '00000000-1111-2222-3333-444444444444';
const OTHER = '55555555-6666-7777-8888-999999999999';
const NOW = 1_700_000_000_000;

const row = (over: Partial<ThreadRow> = {}): ThreadRow => ({
  id: THREAD,
  rolloutPath: '/invented/rollouts/none.jsonl',
  cwd: '/invented/work/a-repo',
  preview: 'an invented first prompt',
  name: null,
  model: 'an-invented-model',
  branch: 'a-branch',
  recencyAtMs: NOW - 120_000,
  ...over,
});

const sqliteAnswering = (rows: readonly Record<string, unknown>[]): RunSqlite =>
  vi.fn(async () => ({ stdout: JSON.stringify(rows), stderr: '', failed: false }));
const codexNeverRun: RunCodex = vi.fn(async () => {
  throw new Error('no test may spawn codex');
});

const sourceWith = (over: Parameters<typeof createCodexSource>[0]) => createCodexSource(over);

describe('codexProjectId', () => {
  it('namespaces by source, so two sources reading one directory never collide', () => {
    expect(codexProjectId('/invented/work/a-repo')).toMatch(/^codex:a-repo-[0-9a-f]{8}$/);
  });

  it('separates two checkouts that share a basename', () => {
    expect(codexProjectId('/one/a-repo')).not.toBe(codexProjectId('/two/a-repo'));
  });
});

describe('a Codex row', () => {
  it('is keyed on the BARE thread uuid, with no #pid suffix', async () => {
    const [project] = await projectsFrom([row()], NOW);
    expect(project?.sessions[0]?.id).toBe(THREAD);
  });

  it('carries no live mark, because liveness is not in the store', async () => {
    const [project] = await projectsFrom([row()], NOW);
    const session = project?.sessions[0];
    // `idle` paints neutral; `running` would be the guess this source refuses,
    // and `waiting` would paint amber on every thread the operator owns.
    expect(session?.status).toBe('idle');
    expect(session?.runningAgents).toBe(0);
  });

  it('says vam did not start it while still being reachable', async () => {
    const [project] = await projectsFrom([row()], NOW);
    // The two claims `vamControlled` used to stand for, pulled apart: vam
    // started nothing here, and `deliverPrompt` on the descriptor is what says
    // vam can still reach it.
    expect(project?.sessions[0]?.vamControlled).toBe(false);
  });

  it('shows the model the store recorded, verbatim', async () => {
    const [project] = await projectsFrom([row({ model: 'an-invented-model' })], NOW);
    expect(project?.sessions[0]?.model).toBe('an-invented-model');
  });

  it('keeps a thread with no recorded model as null rather than inventing one', async () => {
    const [project] = await projectsFrom([row({ model: null })], NOW);
    expect(project?.sessions[0]?.model).toBeNull();
  });

  it('has no agent list at all, rather than an empty one', async () => {
    const [project] = await projectsFrom([row()], NOW);
    // ABSENT and EMPTY differ: empty is a source that looked.
    expect(project?.sessions[0]).not.toHaveProperty('agents');
  });

  it('titles a row from its own name, then from the first line of the preview', async () => {
    const named = await projectsFrom([row({ name: 'the operator’s own name' })], NOW);
    expect(named[0]?.sessions[0]?.title).toBe('the operator’s own name');
    const previewed = await projectsFrom([row({ preview: 'line one\nline two' })], NOW);
    expect(previewed[0]?.sessions[0]?.title).toBe('line one');
  });

  it('cuts a long preview rather than putting a whole brief in the sidebar', async () => {
    // Measured: `threads.title` is the WHOLE first prompt -- 4 KB on the most
    // recent real row -- which is why it is never used as a title.
    const long = await projectsFrom([row({ preview: 'x'.repeat(400) })], NOW);
    const title = long[0]?.sessions[0]?.title ?? '';
    expect(title.length).toBeLessThan(80);
    expect(title.endsWith('…')).toBe(true);
  });

  it('survives a rollout file it cannot open, with the row still drawn', async () => {
    const [project] = await projectsFrom([row({ rolloutPath: '/invented/not/here.jsonl' })], NOW);
    expect(project?.sessions[0]?.id).toBe(THREAD);
    expect(project?.sessions[0]?.decisions).toEqual([]);
  });

  it('groups threads by working directory and keeps a directory that is gone', async () => {
    const projects = await projectsFrom(
      [
        row({ cwd: '/invented/work/a-repo' }),
        row({ id: OTHER, cwd: '/invented/work/a-repo' }),
        row({ id: OTHER, cwd: '/invented/gone/b-repo' }),
      ],
      NOW,
    );
    expect(projects).toHaveLength(2);
    expect(projects[0]?.sessions).toHaveLength(2);
    // 17 of the 30 distinct directories measured on this machine no longer
    // exist: a thread outlives its worktree, and vam draws it either way.
    expect(projects[1]?.name).toBe('b-repo');
  });
});

describe('the Codex source’s descriptor', () => {
  const available = sourceWith({
    exists: () => true,
    runSqlite: sqliteAnswering([]),
    runCodex: codexNeverRun,
    now: () => NOW,
  });

  it('delivers without owning a pane -- the pair no source has claimed before', () => {
    expect(available.descriptor.capabilities.deliverPrompt).toBe(true);
    expect(available.descriptor.capabilities.terminal).toBe(false);
  });

  it('explains the missing pane in the operator’s own terms', () => {
    const words = available.descriptor.declines.terminal ?? '';
    expect(words).toContain('did not start');
    expect(words).toContain('queued');
  });

  it('writes a decline for every capability it withdraws, and none for one it keeps', () => {
    const { capabilities, declines } = available.descriptor;
    for (const [key, value] of Object.entries(capabilities)) {
      if (value) expect(declines[key as keyof typeof capabilities]).toBeUndefined();
      else expect(declines[key as keyof typeof capabilities]).toBeTruthy();
    }
  });

  it('says in its label that the list is capped', () => {
    expect(available.descriptor.label).toMatch(/most recent threads/);
  });
});

describe('when Codex keeps its sessions somewhere vam does not know', () => {
  const missing = sourceWith({
    exists: () => false,
    runSqlite: sqliteAnswering([]),
    runCodex: codexNeverRun,
    now: () => NOW,
    probe: { kind: 'unavailable', code: 'no-store', message: 'there is no such store' },
  });

  it('withdraws every capability with the reason attached', () => {
    const { capabilities, declines } = missing.descriptor;
    expect(Object.values(capabilities).every((v) => v === false)).toBe(true);
    expect(Object.values(declines).every((w) => w === 'there is no such store')).toBe(true);
  });

  it('says so in its label rather than looking like a working source', () => {
    expect(missing.descriptor.label).toContain('unavailable');
  });

  it('resolves rather than rejecting, so the other source keeps its rows', async () => {
    await expect(missing.load()).resolves.toEqual([]);
  });

  it('refuses a write in the same words instead of spawning codex', async () => {
    const failure = await missing.recordPrompt?.(THREAD, 'hello');
    expect(failure).toMatchObject({ kind: 'refused', code: 'unavailable' });
    expect(codexNeverRun).not.toHaveBeenCalled();
  });
});

describe('the Codex source’s load', () => {
  it('turns store rows into projects', async () => {
    const source = sourceWith({
      exists: () => true,
      runSqlite: sqliteAnswering([
        {
          id: THREAD,
          rollout_path: '/invented/not/here.jsonl',
          cwd: '/invented/work/a-repo',
          preview: 'an invented prompt',
          name: null,
          model: 'an-invented-model',
          git_branch: 'a-branch',
          recency_at_ms: NOW - 60_000,
        },
      ]),
      runCodex: codexNeverRun,
      now: () => NOW,
    });
    const projects = await source.load();
    expect(projects[0]?.source).toBe('codex');
    expect(projects[0]?.sessions[0]?.branch).toBe('a-branch');
    expect(projects[0]?.sessions[0]?.age).toBe('1m');
  });

  it('answers an empty list -- never a rejection -- when the read fails', async () => {
    const source = sourceWith({
      exists: () => true,
      runSqlite: async () => ({ stdout: '', stderr: 'no such table: threads', failed: true }),
      runCodex: codexNeverRun,
      now: () => NOW,
    });
    // A rejection here would take the OTHER source's rows off the canvas with
    // it: `combineSources` only keeps a source answering while it resolves.
    await expect(source.load()).resolves.toEqual([]);
  });
});
