/**
 * Reading Codex's session store, and the two traps that produce a confident
 * wrong answer.
 *
 * EVERY FIXTURE HERE IS INVENTED, on this directory's own rule
 * (`claude-code-tail-window.test.ts`): no thread id, transcript content, home
 * path or user name from the machine running this reaches a fixture. The
 * SHAPES were measured against a real store; the values were not taken from
 * one.
 *
 * Nothing here spawns `sqlite3` and nothing here opens a database.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyStoreFailure,
  connectionPlan,
  parseThreadRows,
  readThreads,
  type SqliteResult,
  threadsSql,
} from '../../src/main/sources/codex/store.js';

const DB = '/invented/home/.codex/state_5.sqlite';
const THREAD = '00000000-1111-2222-3333-444444444444';

const ok = (stdout: string): SqliteResult => ({ stdout, stderr: '', failed: false });
const fails = (stderr: string, over: Partial<SqliteResult> = {}): SqliteResult => ({
  stdout: '',
  stderr,
  failed: true,
  ...over,
});

const CANNOT_OPEN = 'Error: in prepare, unable to open database file (14)';

describe('connectionPlan -- the ?mode=ro trap', () => {
  it('asks for a read-only connection first', () => {
    const plan = connectionPlan(DB, { shm: true, walBytes: 4096 });
    expect(plan[0]?.uri).toBe(`file://${DB}?mode=ro`);
  });

  it('offers no second attempt while the write-ahead log holds anything', () => {
    // An immutable read CANNOT SEE an uncheckpointed WAL -- measured, it could
    // not even see the table -- so guessing here would report the version
    // decline about a Codex that is running perfectly.
    expect(connectionPlan(DB, { shm: true, walBytes: 12392 })).toHaveLength(1);
  });

  it('falls back to an immutable read once the log has been checkpointed away', () => {
    const plan = connectionPlan(DB, { shm: false, walBytes: 0 });
    expect(plan.map((a) => a.uri)).toEqual([`file://${DB}?mode=ro`, `file://${DB}?immutable=1`]);
  });

  it('falls back when there is no write-ahead log file at all', () => {
    expect(connectionPlan(DB, { shm: false, walBytes: null })).toHaveLength(2);
  });
});

describe('readThreads', () => {
  const base = {
    path: DB,
    exists: () => true,
    sidecars: () => ({ shm: false, walBytes: 0 }),
  };

  it('declines by version when the store is not there, never with an empty list', async () => {
    const read = await readThreads({ ...base, exists: () => false, run: async () => ok('') });
    expect(read).toMatchObject({ kind: 'unavailable', code: 'no-store' });
    expect(read.kind === 'unavailable' && read.message).toContain('vam does not know');
  });

  it('retries immutable after the read-only open fails, and answers the rows', async () => {
    const tried: string[] = [];
    const read = await readThreads({
      ...base,
      run: async (argv) => {
        tried.push(String(argv[0]));
        return String(argv[0]).includes('mode=ro')
          ? fails(CANNOT_OPEN)
          : ok(
              JSON.stringify([
                {
                  id: THREAD,
                  rollout_path: '/invented/rollout.jsonl',
                  cwd: '/invented/work',
                  preview: 'an invented prompt',
                  name: null,
                  model: 'a-model',
                  git_branch: 'a-branch',
                  recency_at_ms: 1_699_999_000_000,
                },
              ]),
            );
      },
    });
    expect(tried.map((u) => u.split('?')[1])).toEqual(['mode=ro', 'immutable=1']);
    expect(read).toMatchObject({ kind: 'threads' });
    expect(read.kind === 'threads' && read.threads[0]?.id).toBe(THREAD);
  });

  it('declines rather than retrying when the log is not empty', async () => {
    const tried: string[] = [];
    const read = await readThreads({
      ...base,
      sidecars: () => ({ shm: false, walBytes: 12392 }),
      run: async (argv) => {
        tried.push(String(argv[0]));
        return fails(CANNOT_OPEN);
      },
    });
    expect(tried).toHaveLength(1);
    expect(read).toMatchObject({ kind: 'unavailable', code: 'needs-recovery' });
    // The promise this decline is keeping: vam never opens the operator's
    // store for writing, not even to recover it.
    expect(read.kind === 'unavailable' && read.message).toContain('for writing');
  });

  it('does not retry a schema failure under a second connection', async () => {
    let calls = 0;
    const read = await readThreads({
      ...base,
      run: async () => {
        calls += 1;
        return fails('Error: in prepare, no such table: threads');
      },
    });
    expect(calls).toBe(1);
    expect(read).toMatchObject({ kind: 'unavailable', code: 'unknown-schema' });
  });

  it('answers no threads -- not a failure -- for an empty result set', async () => {
    // `sqlite3 -json` prints NOTHING for zero rows, which is not valid JSON.
    const read = await readThreads({ ...base, run: async () => ok('') });
    expect(read).toEqual({ kind: 'threads', threads: [] });
  });
});

describe('classifyStoreFailure', () => {
  it('names a missing sqlite3 rather than blaming Codex', () => {
    expect(classifyStoreFailure({ code: 'ENOENT', path: DB })).toMatchObject({
      code: 'sqlite3-missing',
    });
  });

  it('turns an unknown schema into the version decline in vam’s own words', () => {
    const out = classifyStoreFailure({ stderr: 'no such table: threads', path: DB });
    expect(out.code).toBe('unknown-schema');
    expect(out.message).toContain('somewhere vam does not know');
  });

  it('keeps a timeout apart from a refusal', () => {
    expect(classifyStoreFailure({ timedOut: true, path: DB }).code).toBe('timed-out');
  });
});

describe('threadsSql', () => {
  it('interpolates nothing but the one number vam computed', () => {
    const sql = threadsSql(12);
    expect(sql).toContain('LIMIT 12');
    // Codex's own visibility rule, which its `idx_threads_visible_*` indexes
    // are built on -- not vam's invention.
    expect(sql).toContain("archived = 0 AND preview <> ''");
  });

  /**
   * THE RECENCY WINDOW IS GONE, and its absence is asserted rather than left
   * to be noticed. It was a stand-in for liveness from before liveness could
   * be read (`liveness.ts`); a thread is drawn now because a Codex holds its
   * writer lock, and no clause about the clock can answer that. A window
   * silently reappearing here would quietly hide live threads all over again.
   */
  it('no longer filters by the clock at all', () => {
    expect(threadsSql(12)).not.toContain('recency_at_ms >=');
  });

  it('still orders by recency, which is what breaks the cap’s tie', () => {
    expect(threadsSql(12)).toContain('ORDER BY recency_at_ms DESC');
  });

  it('cannot be made to carry a fractional or negative bound', () => {
    expect(threadsSql(0.5)).toContain('LIMIT 1');
    expect(threadsSql(-5)).toContain('LIMIT 1');
  });
});

describe('parseThreadRows', () => {
  it('drops a row vam could not key, rather than minting an empty id', () => {
    const rows = parseThreadRows(
      JSON.stringify([
        { id: '', rollout_path: '/a', cwd: '/b' },
        { rollout_path: '/a', cwd: '/b' },
        { id: THREAD, rollout_path: '/a', cwd: '/b', preview: 'p' },
      ]),
    );
    expect(rows.map((r) => r.id)).toEqual([THREAD]);
  });

  it('keeps a null branch and a null name as null rather than as empty strings', () => {
    const rows = parseThreadRows(
      JSON.stringify([
        { id: THREAD, rollout_path: '/a', cwd: '/b', git_branch: null, name: '', model: null },
      ]),
    );
    expect(rows[0]).toMatchObject({ branch: null, name: null, model: null });
  });

  it('answers an empty list for output that is not JSON at all', () => {
    expect(parseThreadRows('Error: something went wrong')).toEqual([]);
  });
});
