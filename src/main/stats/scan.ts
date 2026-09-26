/**
 * THE FULL SCAN: every Claude Code transcript and every Codex rollout on
 * this machine, folded into one `StatsSnapshot` — the Stats screen's whole
 * answer.
 *
 * INCREMENTAL BY CONSTRUCTION. `incremental-cache.ts`'s `planRead` decides,
 * per file, whether this scan can skip it, append only the new bytes
 * (`line-stream.ts`'s `readLinesFrom`), or has to read it whole — never this
 * module's job to second-guess. What THIS module owns is folding whatever
 * lines a file plan produced into that file's own running aggregate
 * (`FileAggregate`), and folding every file's aggregate into the one
 * snapshot the screen draws.
 *
 * NOT MAIN-PROCESS-ONLY BY IMPORT, BUT BY CONSTRUCTION: every side effect
 * (`readdir`, `statOf`, `readLines`, `fetchPrsCreated`, the clock, the home
 * directory, the timezone) arrives through `ScanDeps`, so a test drives this
 * against a real temp HOME with real `fs` calls and `worker.ts` drives it
 * inside a worker thread — this file itself imports no `node:fs` and no
 * `electron`.
 *
 * BOUNDED CONCURRENCY: files are processed through `mapWithConcurrencyLimit`
 * (already written for exactly this reason in `sources/claude-code/
 * concurrency-limit.ts`), never one `Promise.all` over every file on the
 * machine at once — an operator with thousands of transcripts must not open
 * thousands of file descriptors in the same tick.
 */

import { join } from 'node:path';
import { extendActiveMs } from '../../shared/active-spans.js';
import { localDayOf, makeLocalDayFormatter } from '../../shared/heatmap.js';
import type { ProviderId } from '../../shared/providers.js';
import type {
  DailyBucket,
  ProviderStat,
  PrsCreated,
  StatsSnapshot,
  TokenMix,
} from '../../shared/stats.js';
import { costOfUsage, PRICE_TABLE_AS_OF, type TokenUsage } from '../../shared/stats-pricing.js';
import { mapWithConcurrencyLimit } from '../sources/claude-code/concurrency-limit.js';
import { parseClaudeUsageLine } from './claude-usage-line.js';
import { parseCodexLine } from './codex-usage-line.js';
import {
  type CacheEntry,
  type CacheStore,
  emptyCacheStore,
  type FileStat,
  planRead,
} from './incremental-cache.js';

/** How many files this scan reads concurrently — see the module header. */
const CONCURRENCY = 8;

/** One file's running aggregate — the shape `incremental-cache.ts` persists
 *  per path. Plain, JSON-serialisable records throughout (never a `Map`),
 *  because this IS what gets written to the cache file on disk. */
export type FileAggregate = {
  readonly providerId: ProviderId;
  readonly tokensByModel: Readonly<Record<string, TokenUsage>>;
  readonly reasoningTokens: number;
  readonly dayTokens: Readonly<Record<string, number>>;
  readonly turns: number;
  readonly earliestAtMs: number | null;
  readonly lastAtMs: number | null;
  readonly activeMs: number;
  /** Codex only: the most recently announced `turn_context` model, carried
   *  across an append so a `token_count` line that arrives before the next
   *  `turn_context` in a NEW read still has last read's model to stamp. */
  readonly currentModel: string | null;
  readonly malformedLines: number;
};

/**
 * `FileAggregate`'s own working shape — every field mutable, for the SAME
 * reason `transcript.ts`'s `OpenTurn` is: a 150 MB file folds hundreds of
 * thousands of events into this one record, and rebuilding it by spread on
 * every line would be quadratic in exactly the file this scan exists to
 * handle efficiently. `FileAggregate` (the persisted, `readonly` type) and
 * this type describe the SAME fields; only the persisted copy is frozen at
 * the type level, once folding is done and it is about to be written to the
 * cache.
 */
type MutableAggregate = {
  providerId: ProviderId;
  tokensByModel: Record<string, TokenUsage>;
  reasoningTokens: number;
  dayTokens: Record<string, number>;
  turns: number;
  earliestAtMs: number | null;
  lastAtMs: number | null;
  activeMs: number;
  currentModel: string | null;
  malformedLines: number;
};

function emptyAggregate(providerId: ProviderId): MutableAggregate {
  return {
    providerId,
    tokensByModel: {},
    reasoningTokens: 0,
    dayTokens: {},
    turns: 0,
    earliestAtMs: null,
    lastAtMs: null,
    activeMs: 0,
    currentModel: null,
    malformedLines: 0,
  };
}

/** A cached (`readonly`) aggregate, copied into a fresh, independently
 *  mutable working record — used when an APPEND resumes from a prior
 *  file's own state, so folding the new lines never mutates the cache
 *  entry a concurrent reader of `deps.cache` might still be holding. */
function toMutable(state: FileAggregate): MutableAggregate {
  return {
    ...state,
    tokensByModel: { ...state.tokensByModel },
    dayTokens: { ...state.dayTokens },
  };
}

export type ScanDeps = {
  readonly home: string;
  readonly now: () => number;
  readonly timeZone: string;
  /** Directory entry NAMES, never full paths — empty on anything unreadable
   *  (ENOENT included), the same contract `codex-reader.ts`'s own `readdir`
   *  states. */
  readonly readdir: (path: string) => Promise<readonly string[]>;
  readonly isDirectory: (path: string) => Promise<boolean>;
  readonly statOf: (path: string) => Promise<FileStat | null>;
  readonly readLines: (
    path: string,
    fromByte: number,
    onLine: (line: string) => void,
  ) => Promise<{ readonly bytesConsumed: number }>;
  readonly fetchPrsCreated: (sinceIso: string | null) => Promise<PrsCreated>;
  readonly cache: CacheStore<FileAggregate>;
};

export type ScanResult = {
  readonly snapshot: StatsSnapshot;
  readonly cache: CacheStore<FileAggregate>;
};

type Candidate = {
  readonly path: string;
  readonly providerId: ProviderId;
};

const NUMERIC = /^\d+$/;

/** Every session transcript AND every subagent transcript under
 *  `~/.claude/projects` — `<slug>/<sessionId>.jsonl` and
 *  `<slug>/<sessionId>/subagents/agent-*.jsonl`, the same path shapes
 *  `sources/claude-code/source.ts`'s own header measures against the real
 *  corpus. Both count as "agents spawned" — see `shared/stats.ts`. */
async function listClaudeFiles(deps: ScanDeps): Promise<readonly Candidate[]> {
  const projectsDir = join(deps.home, '.claude', 'projects');
  const out: Candidate[] = [];
  for (const slug of await deps.readdir(projectsDir)) {
    const slugDir = join(projectsDir, slug);
    if (!(await deps.isDirectory(slugDir))) continue;
    for (const entry of await deps.readdir(slugDir)) {
      const entryPath = join(slugDir, entry);
      if (entry.endsWith('.jsonl')) {
        if (await deps.isDirectory(entryPath)) continue;
        out.push({ path: entryPath, providerId: 'claude-code' });
        continue;
      }
      const subagentsDir = join(entryPath, 'subagents');
      if (!(await deps.isDirectory(subagentsDir))) continue;
      for (const sub of await deps.readdir(subagentsDir)) {
        if (sub.startsWith('agent-') && sub.endsWith('.jsonl')) {
          out.push({ path: join(subagentsDir, sub), providerId: 'claude-code' });
        }
      }
    }
  }
  return out;
}

/** Every rollout under `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` — the
 *  FULL tree, unlike `usage/codex-reader.ts`'s `newestRolloutPaths`, which
 *  deliberately stops early because it only wants the newest reading. A
 *  full scan has no such shortcut: every rollout counts toward the totals. */
async function listCodexFiles(deps: ScanDeps): Promise<readonly Candidate[]> {
  const sessionsDir = join(deps.home, '.codex', 'sessions');
  const out: Candidate[] = [];
  for (const year of await deps.readdir(sessionsDir)) {
    const yearDir = join(sessionsDir, year);
    if (!NUMERIC.test(year) || !(await deps.isDirectory(yearDir))) continue;
    for (const month of await deps.readdir(yearDir)) {
      const monthDir = join(yearDir, month);
      if (!NUMERIC.test(month) || !(await deps.isDirectory(monthDir))) continue;
      for (const day of await deps.readdir(monthDir)) {
        const dayDir = join(monthDir, day);
        if (!NUMERIC.test(day) || !(await deps.isDirectory(dayDir))) continue;
        for (const name of await deps.readdir(dayDir)) {
          if (name.startsWith('rollout-') && name.endsWith('.jsonl')) {
            out.push({ path: join(dayDir, name), providerId: 'codex' });
          }
        }
      }
    }
  }
  return out;
}

/** Folds one usage-bearing event into a file's running aggregate, mutating
 *  the plain records held in `dayFormat`'s closure — see the perf note on
 *  `makeLocalDayFormatter`: this is the hot loop a 150 MB transcript runs
 *  hundreds of thousands of times, so nothing here re-derives a formatter or
 *  rebuilds an array per line. */
function foldEvent(
  agg: MutableAggregate,
  event: {
    readonly atMs: number;
    readonly model: string | null;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheWriteTokens: number;
    readonly cacheReadTokens: number;
    readonly reasoningTokens: number;
  },
  dayFormat: Intl.DateTimeFormat,
): void {
  const key = event.model ?? '';
  const prev = agg.tokensByModel[key] ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  };
  agg.tokensByModel[key] = {
    inputTokens: prev.inputTokens + event.inputTokens,
    outputTokens: prev.outputTokens + event.outputTokens,
    cacheWriteTokens: prev.cacheWriteTokens + event.cacheWriteTokens,
    cacheReadTokens: prev.cacheReadTokens + event.cacheReadTokens,
  };
  agg.reasoningTokens += event.reasoningTokens;
  agg.turns += 1;
  agg.earliestAtMs =
    agg.earliestAtMs === null ? event.atMs : Math.min(agg.earliestAtMs, event.atMs);
  const span = extendActiveMs(agg.lastAtMs, [event.atMs]);
  agg.activeMs += span.addedMs;
  agg.lastAtMs = span.lastAtMs;
  const day = localDayOf(event.atMs, dayFormat);
  const totalTokens =
    event.inputTokens + event.outputTokens + event.cacheWriteTokens + event.cacheReadTokens;
  agg.dayTokens[day] = (agg.dayTokens[day] ?? 0) + totalTokens;
}

/** One candidate file, read per its cache plan, folded into (a possibly
 *  fresh) `FileAggregate`. Never throws: a file that vanished or refused to
 *  read between `readdir` and here is skipped, leaving whatever cache entry
 *  already existed for it untouched. */
async function processFile(
  deps: ScanDeps,
  candidate: Candidate,
  dayFormat: Intl.DateTimeFormat,
): Promise<CacheEntry<FileAggregate> | undefined> {
  const stat = await deps.statOf(candidate.path);
  if (stat === null) return deps.cache.files[candidate.path];
  const prevEntry = deps.cache.files[candidate.path];
  const plan = planRead(prevEntry, stat);
  if (plan.kind === 'skip') return prevEntry;

  const agg: MutableAggregate =
    plan.kind === 'append' && prevEntry !== undefined
      ? toMutable(prevEntry.state)
      : emptyAggregate(candidate.providerId);
  let malformed = agg.malformedLines;
  let currentModel = agg.currentModel;

  const onLine = (raw: string): void => {
    if (candidate.providerId === 'claude-code') {
      const result = parseClaudeUsageLine(raw);
      if (result.kind === 'malformed') malformed += 1;
      else if (result.kind === 'usage') foldEvent(agg, result.event, dayFormat);
      return;
    }
    const result = parseCodexLine(raw, currentModel);
    if (result.kind === 'malformed') malformed += 1;
    else if (result.kind === 'model') currentModel = result.model;
    else if (result.kind === 'usage') foldEvent(agg, result.event, dayFormat);
  };

  let bytesConsumed: number;
  try {
    const fromByte = plan.kind === 'full' ? 0 : plan.fromByte;
    const read = await deps.readLines(candidate.path, fromByte, onLine);
    bytesConsumed = fromByte + read.bytesConsumed;
  } catch {
    // The file vanished or refused between `statOf` and this read — keep
    // whatever was already cached rather than losing it to a race.
    return prevEntry;
  }

  agg.malformedLines = malformed;
  agg.currentModel = currentModel;

  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ino: stat.ino,
    offset: bytesConsumed,
    state: agg,
  };
}

function bucketsFromRecord(record: Readonly<Record<string, number>>): readonly DailyBucket[] {
  return Object.entries(record)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, tokens]) => ({ day, tokens }));
}

const PROVIDER_LABELS: Readonly<Record<ProviderId, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

export async function runFullScan(deps: ScanDeps): Promise<ScanResult> {
  const dayFormat = makeLocalDayFormatter(deps.timeZone);
  const claudeFiles = await listClaudeFiles(deps);
  const codexFiles = await listCodexFiles(deps);
  const candidates = [...claudeFiles, ...codexFiles];

  const entries = await mapWithConcurrencyLimit(candidates, CONCURRENCY, (candidate) =>
    processFile(deps, candidate, dayFormat),
  );

  const files: Record<string, CacheEntry<FileAggregate>> = {};
  for (const [index, candidate] of candidates.entries()) {
    const entry = entries[index];
    if (entry !== undefined) files[candidate.path] = entry;
  }
  const nextCache: CacheStore<FileAggregate> = { version: emptyCacheStore().version, files };

  // ── Fold every file's aggregate into the one snapshot ──────────────────
  let malformedLines = 0;
  let earliestAtMs: number | null = null;
  let totalActiveMs = 0;
  const dayTotals: Record<string, number> = {};
  const perProvider = new Map<
    ProviderId,
    {
      sessions: number;
      turns: number;
      tokens: number;
      reasoningTokens: number;
      tokensByModel: Record<string, TokenUsage>;
    }
  >();
  const mixTotals: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    reasoningTokens: number;
  } = {
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
  };

  for (const candidate of candidates) {
    const entry = files[candidate.path];
    if (entry === undefined) continue;
    const agg = entry.state;
    malformedLines += agg.malformedLines;
    if (agg.earliestAtMs !== null) {
      earliestAtMs =
        earliestAtMs === null ? agg.earliestAtMs : Math.min(earliestAtMs, agg.earliestAtMs);
    }
    totalActiveMs += agg.activeMs;
    for (const [day, tokens] of Object.entries(agg.dayTokens)) {
      dayTotals[day] = (dayTotals[day] ?? 0) + tokens;
    }
    mixTotals.reasoningTokens += agg.reasoningTokens;

    const bucket = perProvider.get(agg.providerId) ?? {
      sessions: 0,
      turns: 0,
      tokens: 0,
      reasoningTokens: 0,
      tokensByModel: {},
    };
    bucket.sessions += 1;
    bucket.turns += agg.turns;
    bucket.reasoningTokens += agg.reasoningTokens;
    for (const [model, usage] of Object.entries(agg.tokensByModel)) {
      const prev = bucket.tokensByModel[model] ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      };
      bucket.tokensByModel[model] = {
        inputTokens: prev.inputTokens + usage.inputTokens,
        outputTokens: prev.outputTokens + usage.outputTokens,
        cacheWriteTokens: prev.cacheWriteTokens + usage.cacheWriteTokens,
        cacheReadTokens: prev.cacheReadTokens + usage.cacheReadTokens,
      };
      bucket.tokens +=
        usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens + usage.cacheReadTokens;
      mixTotals.inputTokens += usage.inputTokens;
      mixTotals.outputTokens += usage.outputTokens;
      mixTotals.cacheWriteTokens += usage.cacheWriteTokens;
      mixTotals.cacheReadTokens += usage.cacheReadTokens;
    }
    perProvider.set(agg.providerId, bucket);
  }

  const totalTokens =
    mixTotals.inputTokens +
    mixTotals.outputTokens +
    mixTotals.cacheWriteTokens +
    mixTotals.cacheReadTokens;

  const providers: ProviderStat[] = [];
  let overallCost: number | null = null;
  const providerIds: readonly ProviderId[] = ['claude-code', 'codex'];
  for (const id of providerIds) {
    const home = deps.home;
    const dirExists =
      id === 'claude-code'
        ? await deps.isDirectory(join(home, '.claude', 'projects'))
        : await deps.isDirectory(join(home, '.codex', 'sessions'));
    const bucket = perProvider.get(id);
    let mostUsedModel: string | null = null;
    let mostUsedTokens = -1;
    let providerCost: number | null = null;
    if (bucket !== undefined) {
      for (const [model, usage] of Object.entries(bucket.tokensByModel)) {
        const tokens =
          usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens + usage.cacheReadTokens;
        if (model !== '' && tokens > mostUsedTokens) {
          mostUsedTokens = tokens;
          mostUsedModel = model;
        }
        const priced = costOfUsage(model, usage);
        if (priced !== null) {
          providerCost = (providerCost ?? 0) + priced;
          overallCost = (overallCost ?? 0) + priced;
        }
      }
    }
    providers.push({
      id,
      label: PROVIDER_LABELS[id],
      enabled: dirExists,
      hasData: bucket !== undefined && bucket.sessions > 0,
      model: mostUsedModel,
      tokens: bucket?.tokens ?? 0,
      sessions: bucket?.sessions ?? 0,
      turns: bucket?.turns ?? 0,
      costUsd: providerCost,
      sharePercent: totalTokens > 0 ? ((bucket?.tokens ?? 0) / totalTokens) * 100 : 0,
    });
  }

  const cacheTokens = mixTotals.cacheReadTokens + mixTotals.cacheWriteTokens;
  const heatmap = bucketsFromRecord(dayTotals);
  const trackingSinceIso = earliestAtMs === null ? null : new Date(earliestAtMs).toISOString();
  const prsCreated = await deps.fetchPrsCreated(trackingSinceIso);

  const tokenMix: TokenMix = {
    inputTokens: mixTotals.inputTokens,
    outputTokens: mixTotals.outputTokens,
    cacheWriteTokens: mixTotals.cacheWriteTokens,
    cacheReadTokens: mixTotals.cacheReadTokens,
    reasoningTokens: mixTotals.reasoningTokens,
  };

  const snapshot: StatsSnapshot = {
    generatedAt: new Date(deps.now()).toISOString(),
    trackingSinceIso,
    agentsSpawned: candidates.length,
    activeMs: totalActiveMs,
    prsCreated,
    usageOverview: {
      totalTokens,
      estCostUsd: overallCost,
      activeDays: heatmap.length,
      cacheSharePercent: totalTokens > 0 ? (cacheTokens / totalTokens) * 100 : 0,
    },
    heatmap,
    tokenMix,
    providers,
    malformedLines,
    priceTableAsOf: PRICE_TABLE_AS_OF,
  };

  return { snapshot, cache: nextCache };
}
