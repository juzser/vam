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
import type { TmuxRun } from '../../src/main/sources/tmux/spawn.js';

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

/** Answers "no vam sessions here" -- the honest state of a machine `load()`
 * asks tmux about while nothing this file's fixtures care about is running.
 * `load()` now asks tmux for every load, so every `.load()` call in this file
 * needs one -- the alternative is a real spawn, which this directory forbids
 * (see the header). */
const noVamSessions: TmuxRun = async () => ({ failure: null, stdout: '', stderr: '' });

const sourceWith = (over: Parameters<typeof createCodexSource>[0]) =>
  createCodexSource({ runTmux: noVamSessions, ...over });

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

  /**
   * A caller that did not probe gets the neutral paint, never a verdict.
   * `codex-live-rows.test.ts` covers what each MEASURED answer paints; this
   * pins the default, which must not be `done` -- that would claim every
   * thread had finished on the strength of nobody having looked.
   */
  it('carries the neutral paint when nothing asked about its writer', async () => {
    const [project] = await projectsFrom([row()], NOW);
    const session = project?.sessions[0];
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

  /**
   * `docs/design/vam-owns-the-session.md` Stage 1: "Codex rows get a real
   * vamControlled." A resume writes `@vam-session` with the thread's own uuid
   * (`resume.ts`), so a THREAD ID vam finds among the ids currently recorded
   * on vam's own tmux sessions is one vam started and can still reach a pane
   * for -- `true`, not the old unconditional `false`.
   */
  it('is controlled when the thread’s own id is among vam’s tmux sessions', async () => {
    const [project] = await projectsFrom([row()], NOW, () => 'unknown', new Set([THREAD]));
    expect(project?.sessions[0]?.vamControlled).toBe(true);
  });

  it('stays false when tmux is readable and simply has no match', async () => {
    const [project] = await projectsFrom([row()], NOW, () => 'unknown', new Set([OTHER]));
    expect(project?.sessions[0]?.vamControlled).toBe(false);
  });

  /**
   * ABSENT, NOT FALSE, when vam could not ask tmux at all -- the same rule
   * `vamControlled`'s own header states and `claude-code/source.ts` already
   * follows. `null` is what a caller passes when `listVamSessions` itself
   * answered `unavailable`.
   */
  it('is absent, not false, when vam could not ask tmux at all', async () => {
    const [project] = await projectsFrom([row()], NOW, () => 'unknown', null);
    expect(project?.sessions[0]).not.toHaveProperty('vamControlled');
  });

  it('shows the model the store recorded, verbatim', async () => {
    const [project] = await projectsFrom([row({ model: 'an-invented-model' })], NOW);
    expect(project?.sessions[0]?.model).toBe('an-invented-model');
  });

  it('keeps a thread with no recorded model as null rather than inventing one', async () => {
    const [project] = await projectsFrom([row({ model: null })], NOW);
    expect(project?.sessions[0]?.model).toBeNull();
  });

  it('reads createdAt from the instant Codex embedded in the rollout’s own file name, never from recency', async () => {
    const [project] = await projectsFrom(
      [
        row({
          rolloutPath:
            '/invented/sessions/2026/08/11/rollout-2026-08-11T18-49-11-019ff0a7-b87e-72e1-a90b-c35b1c66c45d.jsonl',
          // Deliberately a completely different day -- if `createdAt` ever
          // reads `recencyAtMs` by mistake, this assertion catches it.
          recencyAtMs: NOW,
        }),
      ],
      NOW,
    );
    expect(project?.sessions[0]?.createdAt).toBe('2026-08-11T18:49:11.000Z');
  });

  it('is null for a rollout path that does not carry Codex’s own timestamp shape', async () => {
    const [project] = await projectsFrom([row({ rolloutPath: '/invented/not-a-rollout.jsonl' })], NOW);
    expect(project?.sessions[0]?.createdAt).toBeNull();
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

  /**
   * #429's label said "the 12 most recent threads", and that WAS the whole
   * list then. It is not the list now -- live threads are drawn because they
   * are live, and they are not capped -- so a label still claiming that cap
   * would disclose a limit that does not apply to the rows on screen.
   */
  it('stops claiming a cap on the list once liveness decides it', () => {
    const readable = sourceWith({
      exists: () => true,
      runSqlite: sqliteAnswering([]),
      runCodex: codexNeverRun,
      now: () => NOW,
      livenessReadable: true,
    });
    expect(readable.descriptor.label).toContain('live threads');
    expect(readable.descriptor.label).not.toMatch(/the 12 most recent threads/);
  });

  it('says plainly, where it cannot read liveness, that the list is the recent one', () => {
    const blind = sourceWith({
      exists: () => true,
      runSqlite: sqliteAnswering([]),
      runCodex: codexNeverRun,
      now: () => NOW,
      livenessReadable: false,
    });
    expect(blind.descriptor.label).toContain('most recent threads');
    expect(blind.descriptor.label).toContain('cannot tell');
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

  /** The wiring version of the `vamControlled` tests above: the source really
   * does ask tmux, and really does read `@vam-session` back off it. */
  it('reads vamControlled off the tmux listing it asks for on every load', async () => {
    const answering = (rows: readonly Record<string, unknown>[]) =>
      sourceWith({
        exists: () => true,
        runSqlite: sqliteAnswering(rows),
        runCodex: codexNeverRun,
        now: () => NOW,
        runTmux: async () => ({
          failure: null,
          stdout: `\t\tvam-a1b2c3\t\t${THREAD}\t/invented/work/a-repo\n`,
          stderr: '',
        }),
      });
    const projects = await answering([
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
    ]).load();
    expect(projects[0]?.sessions[0]?.vamControlled).toBe(true);
  });

  /**
   * `docs/design/vam-owns-the-session.md`'s own trap: "an unreadable tmux
   * listing must not empty the sidebar." The rows still come back -- Codex's
   * OWN store read did not fail -- and the reason rides along on every one of
   * them so the filter layer can stand down rather than trust a `false` it
   * cannot back up.
   */
  it('stamps vamListingGap on every row when tmux itself could not be read', async () => {
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
      runTmux: async () => ({
        failure: { message: 'ENOENT', code: 'ENOENT' },
        stdout: '',
        stderr: '',
      }),
    });
    const projects = await source.load();
    expect(projects[0]?.sessions[0]).not.toHaveProperty('vamControlled');
    expect(projects[0]?.sessions[0]?.vamListingGap).toMatchObject({ code: 'tmux-missing' });
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
