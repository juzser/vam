/**
 * The Stats scan, end to end, against REAL files under a temp HOME —
 * `mkdtemp`, never the real `~/.claude` or `~/.codex`. This is the one test
 * file that falsifies the incremental cache against real `fs.stat` (size,
 * mtime, inode) rather than an invented one: append, shrink and replace are
 * each driven by a real second scan of a real mutated file, with a spy
 * confirming HOW MUCH each scan actually read.
 */
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  rm,
  stat,
  truncate,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyCacheStore } from '../../../src/main/stats/incremental-cache.js';
import { readLinesFrom } from '../../../src/main/stats/line-stream.js';
import { runFullScan, type ScanDeps } from '../../../src/main/stats/scan.js';

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'vam-stats-scan-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function writeJsonl(path: string, lines: readonly unknown[]): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}

const assistantLine = (over: Record<string, unknown> = {}) => ({
  type: 'assistant',
  timestamp: '2026-09-04T08:00:00.000Z',
  message: {
    model: 'claude-3-5-sonnet-20241022',
    usage: { input_tokens: 100, output_tokens: 200 },
  },
  ...over,
});

/** A read/readdir/stat set rooted at the real temp `home`, with `readLines`
 *  wrapped so a test can assert how many bytes each scan actually read. */
function realDeps(overrides: Partial<ScanDeps> = {}): ScanDeps & { readCalls: number[] } {
  const readCalls: number[] = [];
  const deps: ScanDeps & { readCalls: number[] } = {
    home,
    now: () => Date.parse('2026-09-27T00:00:00.000Z'),
    timeZone: 'UTC',
    readdir: async (path: string) => {
      try {
        return await readdir(path);
      } catch {
        return [];
      }
    },
    isDirectory: async (path: string) => {
      try {
        return (await stat(path)).isDirectory();
      } catch {
        return false;
      }
    },
    statOf: async (path: string) => {
      try {
        const s = await stat(path);
        return { size: s.size, mtimeMs: s.mtimeMs, ino: s.ino };
      } catch {
        return null;
      }
    },
    // The SAME real head-read `worker.ts`'s own `readHead` does -- this
    // file's whole point is falsifying the incremental cache against a REAL
    // filesystem, and a fake fingerprint here would let a replace-detection
    // bug hide behind a test that never actually reads a byte to catch it.
    readHead: async (path: string, byteCount: number) => {
      const handle = await open(path, 'r');
      try {
        const buffer = Buffer.alloc(byteCount);
        if (buffer.length === 0) return buffer;
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },
    readLines: async (path, fromByte, onLine) => {
      readCalls.push(fromByte);
      return readLinesFrom(path, fromByte, onLine);
    },
    cache: emptyCacheStore(),
    readCalls,
    ...overrides,
  };
  return deps;
}

describe('runFullScan', () => {
  it('reports zero data, honestly, for an empty home', async () => {
    const deps = realDeps();
    const { snapshot } = await runFullScan(deps);
    expect(snapshot.agentsSpawned).toBe(0);
    expect(snapshot.trackingSinceIso).toBeNull();
    expect(snapshot.usageOverview.totalTokens).toBe(0);
    expect(snapshot.usageOverview.estCostUsd).toBeNull();
    expect(snapshot.malformedLines).toBe(0);
  });

  it('counts a session transcript, its usage, and a malformed line', async () => {
    const path = join(home, '.claude', 'projects', 'atlas', 's1.jsonl');
    await mkdir(join(home, '.claude', 'projects', 'atlas'), { recursive: true });
    await writeFile(
      path,
      `${[
        JSON.stringify(assistantLine()),
        JSON.stringify(assistantLine({ timestamp: '2026-09-04T08:05:00.000Z' })),
        '{not-json-at-all',
      ].join('\n')}\n`,
    );
    const deps = realDeps();
    const { snapshot } = await runFullScan(deps);
    expect(snapshot.agentsSpawned).toBe(1);
    expect(snapshot.malformedLines).toBe(1);
    expect(snapshot.usageOverview.totalTokens).toBe(2 * (100 + 200));
    expect(snapshot.trackingSinceIso).toBe('2026-09-04T08:00:00.000Z');
    expect(snapshot.providers.find((p) => p.id === 'claude-code')?.sessions).toBe(1);
  });

  it('counts a subagent transcript as its own agent, distinct from the session it belongs to', async () => {
    await writeJsonl(join(home, '.claude', 'projects', 'atlas', 's1.jsonl'), [assistantLine()]);
    await writeJsonl(
      join(home, '.claude', 'projects', 'atlas', 's1', 'subagents', 'agent-1.jsonl'),
      [assistantLine({ timestamp: '2026-09-04T08:10:00.000Z' })],
    );
    const { snapshot } = await runFullScan(realDeps());
    expect(snapshot.agentsSpawned).toBe(2);
  });

  it('reads a Codex rollout: turn_context names the model, token_count carries the delta', async () => {
    const path = join(home, '.codex', 'sessions', '2026', '09', '20', 'rollout-x.jsonl');
    await writeJsonl(path, [
      {
        timestamp: '2026-09-20T00:00:00.000Z',
        type: 'turn_context',
        payload: { model: 'gpt-4.1' },
      },
      {
        timestamp: '2026-09-20T00:00:05.000Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { input_tokens: 10, output_tokens: 5 } },
        },
      },
    ]);
    const { snapshot } = await runFullScan(realDeps());
    const codex = snapshot.providers.find((p) => p.id === 'codex');
    expect(codex?.sessions).toBe(1);
    expect(codex?.model).toBe('gpt-4.1');
    expect(codex?.tokens).toBe(15);
  });

  it('never guesses a price for an unknown model, but still counts its tokens', async () => {
    await writeJsonl(join(home, '.claude', 'projects', 'atlas', 's1.jsonl'), [
      assistantLine({ message: { model: 'claude-opus-5', usage: { input_tokens: 1000 } } }),
    ]);
    const { snapshot } = await runFullScan(realDeps());
    expect(snapshot.usageOverview.totalTokens).toBe(1000);
    const provider = snapshot.providers.find((p) => p.id === 'claude-code');
    expect(provider?.costUsd).toBeNull();
  });

  it('prices a KNOWN model and reports a non-null estimate', async () => {
    await writeJsonl(join(home, '.claude', 'projects', 'atlas', 's1.jsonl'), [assistantLine()]);
    const { snapshot } = await runFullScan(realDeps());
    expect(snapshot.usageOverview.estCostUsd).not.toBeNull();
    expect(snapshot.usageOverview.estCostUsd).toBeGreaterThan(0);
  });

  it('INCREMENTAL: an unchanged file is skipped entirely on the next scan', async () => {
    const path = join(home, '.claude', 'projects', 'atlas', 's1.jsonl');
    await writeJsonl(path, [assistantLine()]);
    const first = realDeps();
    const { cache } = await runFullScan(first);

    const second = realDeps({ cache });
    const { snapshot } = await runFullScan(second);
    expect(second.readCalls).toEqual([]); // nothing re-read: size and mtime match
    expect(snapshot.usageOverview.totalTokens).toBe(300);
  });

  it('INCREMENTAL: a GROWN file is read only from its previous offset', async () => {
    const path = join(home, '.claude', 'projects', 'atlas', 's1.jsonl');
    await writeJsonl(path, [assistantLine()]);
    const first = realDeps();
    const { cache } = await runFullScan(first);
    const sizeAfterFirst = (await stat(path)).size;

    await writeFile(
      path,
      `${JSON.stringify(assistantLine({ timestamp: '2026-09-04T09:00:00.000Z' }))}\n`,
      {
        flag: 'a',
      },
    );

    const second = realDeps({ cache });
    const { snapshot } = await runFullScan(second);
    expect(second.readCalls).toEqual([sizeAfterFirst]); // resumed from where the first scan stopped
    expect(snapshot.usageOverview.totalTokens).toBe(600); // both lines counted
  });

  it('INCREMENTAL: a SHRUNK file is read from scratch', async () => {
    const path = join(home, '.claude', 'projects', 'atlas', 's1.jsonl');
    await writeJsonl(path, [
      assistantLine(),
      assistantLine({ timestamp: '2026-09-04T09:00:00.000Z' }),
    ]);
    const first = realDeps();
    const { cache } = await runFullScan(first);

    await truncate(path, 0);
    await writeJsonl(path, [assistantLine({ timestamp: '2026-09-04T10:00:00.000Z' })]);

    const second = realDeps({ cache });
    const { snapshot } = await runFullScan(second);
    expect(second.readCalls).toEqual([0]); // full re-read, not an append
    expect(snapshot.usageOverview.totalTokens).toBe(300); // only the one surviving line
  });

  it('INCREMENTAL: a REPLACED file (deleted and recreated) is read from scratch', async () => {
    const path = join(home, '.claude', 'projects', 'atlas', 's1.jsonl');
    await writeJsonl(path, [assistantLine()]);
    const first = realDeps();
    const { cache } = await runFullScan(first);

    // NEVER ASSERT THAT THE INODE CHANGES HERE. Measured on real CI (Linux,
    // ext4/overlayfs): a delete-and-recreate can be handed the SAME inode
    // number back by the filesystem -- legal, common, and exactly what a
    // prior version of this test wrongly assumed could never happen
    // (`expect(inoAfter).not.toBe(inoBefore)`, which failed there with
    // "expected 9205339 not to be 9205339"). This test's own job is the
    // OBSERVABLE BEHAVIOUR -- a full re-read, the right token count --
    // never a claim about what any OS hands back for inode reuse; the
    // in-place-replacement test right below this one is what specifically
    // exercises the SAME-inode case.
    await unlink(path);
    await writeJsonl(path, [assistantLine({ timestamp: '2026-09-04T11:00:00.000Z' })]);

    const second = realDeps({ cache });
    const { snapshot } = await runFullScan(second);
    expect(second.readCalls).toEqual([0]);
    expect(snapshot.usageOverview.totalTokens).toBe(300);
  });

  it('INCREMENTAL: a file REPLACED IN PLACE (same inode, truncate + write — the one shape every OS keeps the inode for) is still read from scratch, never treated as an append', async () => {
    const path = join(home, '.claude', 'projects', 'atlas', 's1.jsonl');
    await writeJsonl(path, [assistantLine()]);
    const first = realDeps();
    const { cache } = await runFullScan(first);
    const inoBefore = (await stat(path)).ino;

    // Truncate, then write the new content IN PLACE -- the one replacement
    // shape that keeps the inode on every OS, not just the ones that
    // happen to reuse a freed one. The replacement is LONGER than the
    // original: under the OLD "same inode -> safe to append" logic this
    // would have been folded as a CONTINUATION of the old content (a
    // stale cached aggregate plus a byte offset into a file whose bytes at
    // that offset no longer mean what they used to) rather than read
    // fresh -- the exact blind spot the head fingerprint closes.
    await truncate(path, 0);
    await writeFile(
      path,
      `${[
        assistantLine({ timestamp: '2026-09-04T12:00:00.000Z' }),
        assistantLine({ timestamp: '2026-09-04T13:00:00.000Z' }),
      ]
        .map((l) => JSON.stringify(l))
        .join('\n')}\n`,
      { flag: 'r+' },
    );
    const inoAfter = (await stat(path)).ino;
    expect(inoAfter).toBe(inoBefore); // the premise THIS test depends on

    const second = realDeps({ cache });
    const { snapshot } = await runFullScan(second);
    expect(second.readCalls).toEqual([0]); // a FULL re-read, not an append from the stale offset
    expect(snapshot.usageOverview.totalTokens).toBe(600); // only the two NEW lines
  });

  it('marks a provider with no directory at all as disabled and without data', async () => {
    const { snapshot } = await runFullScan(realDeps());
    for (const provider of snapshot.providers) {
      expect(provider.enabled).toBe(false);
      expect(provider.hasData).toBe(false);
      expect(provider.costUsd).toBeNull();
    }
  });

  it('carries the price table date through, and always reports prsCreated as loading', async () => {
    // `runFullScan` never calls `gh` itself any more -- see `worker.ts`'s
    // own header. It runs the PR fetch CONCURRENTLY with this fold, using
    // the CACHED tracking-since date so the network call can start before
    // this fold even knows its own answer; folding in the real result (or
    // an error) after the fact would make this module responsible for a
    // race it has no reason to own. `{kind:'loading'}` is the one value
    // this module ever writes here — `worker.ts` overlays the real one.
    const { snapshot } = await runFullScan(realDeps());
    expect(snapshot.priceTableAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snapshot.prsCreated).toEqual({ kind: 'loading' });
  });

  describe('dedup: a streamed assistant turn repeats the SAME message.id', () => {
    // Measured on a real transcript (15,489 lines): 77% of usage-bearing
    // lines were a repeat of an already-folded `message.id`, carrying an
    // IDENTICAL, already-cumulative `usage` object -- streaming chunks that
    // Claude Code appends as their own line each time the SAME message
    // gains more content. Folding every line inflates tokens, cost, turns
    // and active time by roughly the repeat count.
    const dup = (over: Record<string, unknown> = {}) =>
      assistantLine({
        message: {
          id: 'msg_dup_1',
          model: 'claude-3-5-sonnet-20241022',
          usage: { input_tokens: 100, output_tokens: 200 },
        },
        ...over,
      });

    it('a fixture with 3 lines sharing one id folds once', async () => {
      await writeJsonl(join(home, '.claude', 'projects', 'atlas', 's1.jsonl'), [
        dup(),
        dup(),
        dup(),
      ]);
      const { snapshot } = await runFullScan(realDeps());
      expect(snapshot.usageOverview.totalTokens).toBe(300); // ONE fold, not three
      const provider = snapshot.providers.find((p) => p.id === 'claude-code');
      expect(provider?.turns).toBe(1);
    });

    it('duplicates split across an incremental append boundary fold once', async () => {
      const path = join(home, '.claude', 'projects', 'atlas', 's1.jsonl');
      // The first read sees only the FIRST of the two duplicate lines --
      // the append boundary lands exactly between them, the same shape a
      // live tail scan hits constantly (a resumed read never re-reads
      // bytes the previous one already consumed).
      await writeJsonl(path, [dup()]);
      const first = realDeps();
      const { cache } = await runFullScan(first);

      await writeFile(path, `${JSON.stringify(dup())}\n`, { flag: 'a' });

      const second = realDeps({ cache });
      const { snapshot } = await runFullScan(second);
      expect(second.readCalls.length).toBe(1); // really did resume, not skip
      expect(snapshot.usageOverview.totalTokens).toBe(300); // still ONE fold
      const provider = snapshot.providers.find((p) => p.id === 'claude-code');
      expect(provider?.turns).toBe(1);
    });

    it('folds a DIFFERENT id normally -- dedup never merges two distinct turns', async () => {
      await writeJsonl(join(home, '.claude', 'projects', 'atlas', 's1.jsonl'), [
        dup(),
        dup({
          message: {
            id: 'msg_dup_2',
            model: 'claude-3-5-sonnet-20241022',
            usage: { input_tokens: 100, output_tokens: 200 },
          },
        }),
      ]);
      const { snapshot } = await runFullScan(realDeps());
      expect(snapshot.usageOverview.totalTokens).toBe(600);
      const provider = snapshot.providers.find((p) => p.id === 'claude-code');
      expect(provider?.turns).toBe(2);
    });

    it("uses the FIRST occurrence's timestamp for the active span, never a later duplicate's", async () => {
      await writeJsonl(join(home, '.claude', 'projects', 'atlas', 's1.jsonl'), [
        dup({ timestamp: '2026-09-04T08:00:00.000Z' }),
        dup({ timestamp: '2026-09-04T08:00:05.000Z' }), // same id, a later stamp -- must be ignored
      ]);
      const { snapshot } = await runFullScan(realDeps());
      expect(snapshot.trackingSinceIso).toBe('2026-09-04T08:00:00.000Z');
    });
  });
});
