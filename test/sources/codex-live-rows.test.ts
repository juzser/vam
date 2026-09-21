/**
 * WHICH CODEX THREADS REACH THE SIDEBAR, now that liveness can be read.
 *
 * ── THE COMPLAINT THIS ANSWERS, AND WHAT IT MEASURED ──────────────────────
 *
 * The operator, of what PR #429 shipped: "Don't show recent threads -- it
 * makes managing active sessions harder."
 *
 * Measured on the machine the complaint came from, against the shipped rule
 * (`archived = 0 AND preview <> ''`, seven days, `LIMIT 12`):
 *
 *   - 12 rows drawn, of which **1** was live. The other 11 were finished
 *     conversations.
 *   - the one live row was drawn **third**, under two dead ones, because the
 *     only order the store offers is `recency_at_ms DESC`.
 *   - those 12 rows minted **8 project rows**, five of them one-off scratch
 *     directories (`to`, `create-an-image-of`, `scratchpad`, ...), and 3 of
 *     the 12 named a `cwd` that no longer exists.
 *   - **6 of the 12 shared a title**, 4 of them character-for-character,
 *     because a Codex `preview` is the first line of the prompt and an
 *     automated role brief starts every run the same way.
 *
 * So: 8 projects and 12 sessions on the canvas to hold one live session. The
 * recency window was never a proxy for "this may need you"; it was a proxy for
 * liveness, standing in because liveness was believed unreadable. It is
 * readable (`liveness.ts`), so the proxy goes.
 *
 * EVERY FIXTURE HERE IS INVENTED, on this directory's own rule
 * (`claude-code-tail-window.test.ts`). The counts above are measurements and
 * are quoted as prose; no thread id, directory or prompt from the operator's
 * store reaches a fixture. Nothing here reads `~/.codex` or spawns anything.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Liveness } from '../../src/main/sources/codex/liveness.js';
import type { RunCodex } from '../../src/main/sources/codex/queue.js';
import {
  createCodexSource,
  ENDED_ROW_LIMIT,
  projectsFrom,
  selectThreads,
} from '../../src/main/sources/codex/source.js';
import type { RunSqlite, ThreadRow } from '../../src/main/sources/codex/store.js';

const NOW = 1_700_000_000_000;
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const row = (n: number, over: Partial<ThreadRow> = {}): ThreadRow => ({
  id: id(n),
  rolloutPath: '/invented/rollouts/none.jsonl',
  cwd: '/invented/work/a-repo',
  preview: `an invented prompt ${n}`,
  name: null,
  model: 'an-invented-model',
  branch: null,
  // Descending recency, the order the store hands rows over in.
  recencyAtMs: NOW - n * 60_000,
  ...over,
});

const saying =
  (answers: Record<string, Liveness>) =>
  (threadId: string): Liveness =>
    answers[threadId] ?? 'ended';

describe('selectThreads -- the live list holds live sessions only', () => {
  it('draws a live thread and leaves every ended one out', () => {
    const threads = [row(1), row(2), row(3)];
    const chosen = selectThreads({
      threads,
      liveness: saying({ [id(2)]: 'live' }),
      endedLimit: 0,
    });
    expect(chosen.drawn.map((r) => r.id)).toEqual([id(2)]);
    expect(chosen.live).toBe(1);
    expect(chosen.ended).toBe(2);
  });

  /**
   * The ordering defect, named. A dead thread touched a minute ago sorted
   * above the live one and the operator read the list top-down.
   */
  it('puts every live thread above every ended one, whatever the store’s order', () => {
    const threads = [row(1), row(2), row(3), row(4)];
    const chosen = selectThreads({
      threads,
      liveness: saying({ [id(3)]: 'live', [id(4)]: 'live' }),
      endedLimit: 12,
    });
    expect(chosen.drawn.map((r) => r.id)).toEqual([id(3), id(4), id(1), id(2)]);
  });

  /**
   * THE CAP NOW BINDS ONLY THE ENDED ROWS. A live session is something that
   * may need you and there is no honest number of those to drop; there are
   * never many, because each one is a Codex process on this machine.
   */
  it('caps the ended rows and never the live ones', () => {
    const threads = Array.from({ length: 40 }, (_, index) => row(index + 1));
    const live = Object.fromEntries(threads.slice(0, 20).map((r) => [r.id, 'live' as const]));
    const chosen = selectThreads({ threads, liveness: saying(live), endedLimit: 3 });
    expect(chosen.live).toBe(20);
    expect(chosen.drawn).toHaveLength(23);
    expect(chosen.ended).toBe(20);
  });

  /**
   * `unknown` IS NOT `ended` AND IS NOT `live`. On a platform where the probe
   * cannot answer, every row is unknown -- and the honest list is the one vam
   * drew before it could read liveness at all, rather than an empty canvas
   * that reads as "you have no Codex sessions".
   */
  it('falls back to the recent list when it cannot tell, rather than to nothing', () => {
    const threads = [row(1), row(2), row(3)];
    const chosen = selectThreads({
      threads,
      liveness: () => 'unknown',
      endedLimit: 12,
    });
    expect(chosen.drawn).toHaveLength(3);
    expect(chosen.live).toBe(0);
    expect(chosen.unknown).toBe(3);
  });

  it('keeps an unknown row even when the ended cap is spent', () => {
    const threads = [row(1), row(2), row(3)];
    const chosen = selectThreads({
      threads,
      liveness: saying({ [id(2)]: 'unknown', [id(3)]: 'unknown' }),
      endedLimit: 0,
    });
    expect(chosen.drawn.map((r) => r.id)).toEqual([id(2), id(3)]);
  });

  it('has a default ended cap, and it is the one the label discloses', () => {
    const threads = Array.from({ length: 30 }, (_, index) => row(index + 1));
    const chosen = selectThreads({ threads, liveness: () => 'ended' });
    expect(chosen.drawn).toHaveLength(ENDED_ROW_LIMIT);
  });
});

describe('what a Codex row’s status says now', () => {
  /**
   * `SessionStatus`'s own header defines `idle` as "alive, attached,
   * stoppable, and simply between turns", and that is now a MEASURED claim for
   * a live Codex row rather than #429's least-wrong neutral: a Codex process
   * holds this thread's writer lock right now. vam still cannot tell a thread
   * mid-turn from one waiting on the operator -- the lock says nothing about
   * that -- so `running` and `waiting` remain guesses and are not made.
   *
   * "attached, stoppable" is the one word of that definition this source does
   * not earn, and it does not pretend to: `terminal` and `closeSession` are
   * both withdrawn with the source's own sentence on them.
   */
  it('paints a live thread idle -- alive, and between turns', async () => {
    const [project] = await projectsFrom([row(1)], NOW, saying({ [id(1)]: 'live' }));
    expect(project?.sessions[0]?.status).toBe('idle');
  });

  /**
   * `done` is "a job that ENDED", and for a thread with no writer that is
   * exactly what vam measured. It is also what makes the sidebar's existing
   * rank order put these rows under the live ones for free.
   */
  it('paints a thread with no writer done, because that is what it is', async () => {
    const [project] = await projectsFrom([row(1)], NOW, saying({ [id(1)]: 'ended' }));
    expect(project?.sessions[0]?.status).toBe('done');
  });

  it('keeps the neutral paint for a thread it could not ask about', async () => {
    const [project] = await projectsFrom([row(1)], NOW, () => 'unknown');
    expect(project?.sessions[0]?.status).toBe('idle');
  });

  /**
   * `Session.ended` is the same fact asked the other way, and it is what the
   * sidebar's filter reads. It must be set ONLY where the probe answered:
   * absent is "nobody looked", and a source that claimed an ending it did not
   * measure would hide a live session behind a default the operator never
   * chose.
   */
  it('marks an ended thread as ended, for the filter to read', async () => {
    const [project] = await projectsFrom([row(1)], NOW, saying({ [id(1)]: 'ended' }));
    expect(project?.sessions[0]?.ended).toBe(true);
  });

  it('leaves the mark off a live thread', async () => {
    const [project] = await projectsFrom([row(1)], NOW, saying({ [id(1)]: 'live' }));
    expect(project?.sessions[0]?.ended).toBeUndefined();
  });

  it('leaves the mark off entirely when it could not look', async () => {
    const [project] = await projectsFrom([row(1)], NOW, () => 'unknown');
    expect(project?.sessions[0]?.ended).toBeUndefined();
  });
});

/**
 * THE WIRING, not the parts. `selectThreads` and `projectsFrom` are each
 * correct above and could still be joined to a source that never probes
 * anything -- which is what shipped, and is the whole defect. These drive
 * `load()`.
 */
describe('the Codex source’s load, with a writer-lock probe', () => {
  const HOME = '/invented/home/.codex';
  const storeAnswering = (rows: readonly ThreadRow[]): RunSqlite =>
    vi.fn(async () => ({
      stdout: JSON.stringify(
        rows.map((r) => ({
          id: r.id,
          rollout_path: r.rolloutPath,
          cwd: r.cwd,
          preview: r.preview,
          name: r.name,
          model: r.model,
          git_branch: r.branch,
          recency_at_ms: r.recencyAtMs,
        })),
      ),
      stderr: '',
      failed: false,
    }));
  const codexNeverRun: RunCodex = vi.fn(async () => {
    throw new Error('no test may spawn codex');
  });

  const sourceOver = (rows: readonly ThreadRow[], live: ReadonlySet<string>) =>
    createCodexSource({
      home: HOME,
      exists: () => true,
      runSqlite: storeAnswering(rows),
      runCodex: codexNeverRun,
      now: () => NOW,
      livenessReadable: true,
      // The probe is addressed BY PATH, which is also how this asserts that
      // the source built the path from the thread's own uuid.
      probeLock: (path) =>
        [...live].some((threadId) => path === `${HOME}/thread-writer-locks/${threadId}.lock`)
          ? 'live'
          : 'ended',
    });

  /**
   * WHERE THE HIDING HAPPENS, AND WHY NOT HERE.
   *
   * `load()` answers live rows AND the recent ended ones, each carrying the
   * status the probe earned it; the sidebar's own filter is what hides the
   * ended ones by default (`domain/session-filter.ts`). The alternative --
   * a source that returns only what is currently wanted -- would mean the
   * toggle had to re-read Codex's store and its rollouts to show a row vam had
   * already read, and would put a view preference from the renderer into a
   * main-process reader. Every other narrowing in this app is a pure function
   * over one loaded list, and this is that.
   *
   * So what `load()` owes is that the live rows come FIRST and that the ended
   * ones are labelled truthfully enough for a filter to act on.
   */
  it('answers the live thread first, and the ended ones after it', async () => {
    const rows = [row(1), row(2), row(3)];
    const projects = await sourceOver(rows, new Set([id(2)])).load();
    const drawn = projects.flatMap((p) => p.sessions);
    expect(drawn.map((s) => s.id)).toEqual([id(2), id(1), id(3)]);
    expect(drawn.map((s) => s.status)).toEqual(['idle', 'done', 'done']);
  });

  /**
   * The measurement that started this: 12 rows across 8 projects to hold one
   * live session. A project exists only to hold rows, so the project ORDER has
   * to follow the live rows too -- a live session must never sit under a
   * heading that the sidebar drew third because a dead thread was touched more
   * recently.
   */
  it('puts the project holding the live thread first', async () => {
    const rows = [
      row(1, { cwd: '/invented/work/finished-one' }),
      row(2, { cwd: '/invented/work/finished-two' }),
      row(3, { cwd: '/invented/work/still-going' }),
    ];
    const projects = await sourceOver(rows, new Set([id(3)])).load();
    expect(projects.map((p) => p.name)).toEqual(['still-going', 'finished-one', 'finished-two']);
  });

  it('paints the row it drew with the same answer it selected it by', async () => {
    const projects = await sourceOver([row(1), row(2)], new Set([id(1)])).load();
    expect(projects[0]?.sessions[0]?.status).toBe('idle');
  });

  /**
   * The probe is the expensive-looking part, and it is asked once per thread:
   * `selectThreads` and `projectsFrom` both need the answer and must not be
   * able to get DIFFERENT ones, which is what a thread ending between the two
   * calls would otherwise produce -- sorted live, painted done.
   */
  it('asks about each thread exactly once', async () => {
    const asked: string[] = [];
    const source = createCodexSource({
      home: HOME,
      exists: () => true,
      runSqlite: storeAnswering([row(1), row(2), row(3)]),
      runCodex: codexNeverRun,
      now: () => NOW,
      livenessReadable: true,
      probeLock: (path) => {
        asked.push(path);
        return 'ended';
      },
    });
    await source.load();
    expect(asked).toHaveLength(3);
    expect(new Set(asked).size).toBe(3);
  });

  /** A probe that says nothing must not empty the operator's canvas. */
  it('keeps every row when the probe cannot answer', async () => {
    const rows = [row(1), row(2), row(3)];
    const source = createCodexSource({
      home: HOME,
      exists: () => true,
      runSqlite: storeAnswering(rows),
      runCodex: codexNeverRun,
      now: () => NOW,
      livenessReadable: false,
      probeLock: () => 'unknown',
    });
    const projects = await source.load();
    expect(projects.flatMap((p) => p.sessions)).toHaveLength(3);
  });
});
