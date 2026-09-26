/**
 * The Stats scan, end to end, against REAL files under a temp HOME —
 * `mkdtemp`, never the real `~/.claude` or `~/.codex`. This is the one test
 * file that falsifies the incremental cache against real `fs.stat` (size,
 * mtime, inode) rather than an invented one: append, shrink and replace are
 * each driven by a real second scan of a real mutated file, with a spy
 * confirming HOW MUCH each scan actually read.
 */
import { mkdir, mkdtemp, readdir, rm, stat, truncate, unlink, writeFile } from 'node:fs/promises';
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
    readLines: async (path, fromByte, onLine) => {
      readCalls.push(fromByte);
      return readLinesFrom(path, fromByte, onLine);
    },
    fetchPrsCreated: async () => ({ kind: 'unavailable', hint: 'not queried in this test' }),
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
    const inoBefore = (await stat(path)).ino;

    await unlink(path);
    await writeJsonl(path, [assistantLine({ timestamp: '2026-09-04T11:00:00.000Z' })]);
    const inoAfter = (await stat(path)).ino;
    expect(inoAfter).not.toBe(inoBefore); // the premise this test depends on

    const second = realDeps({ cache });
    const { snapshot } = await runFullScan(second);
    expect(second.readCalls).toEqual([0]);
    expect(snapshot.usageOverview.totalTokens).toBe(300);
  });

  it('marks a provider with no directory at all as disabled and without data', async () => {
    const { snapshot } = await runFullScan(realDeps());
    for (const provider of snapshot.providers) {
      expect(provider.enabled).toBe(false);
      expect(provider.hasData).toBe(false);
      expect(provider.costUsd).toBeNull();
    }
  });

  it('carries the price table date and the caller-supplied prsCreated through', async () => {
    const { snapshot } = await runFullScan(
      realDeps({ fetchPrsCreated: async () => ({ kind: 'ok', count: 7 }) }),
    );
    expect(snapshot.priceTableAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snapshot.prsCreated).toEqual({ kind: 'ok', count: 7 });
  });
});
