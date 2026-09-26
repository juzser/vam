/**
 * The Stats & Usage screen's own snapshot type — what crosses `vam:stats:get`
 * / `vam:stats:refresh`, and the one pure helper (`percentShare`) small
 * enough not to need its own file.
 *
 * Renderer-safe: no `electron`, no `node:` import. `src/main/stats/scan.ts`
 * builds the real value from the filesystem; the renderer only ever reads
 * it.
 */

import type { ProviderId } from './providers.js';

export type DailyBucket = {
  readonly day: string;
  readonly tokens: number;
};

export type TokenMix = {
  /** New (non-cached) prompt tokens. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheReadTokens: number;
  /** A SUBSET of `outputTokens`, never additional — both providers report it
   *  that way (`output_tokens_details.thinking_tokens`, `reasoning_output_
   *  tokens`) and this module never double-counts it into a total. */
  readonly reasoningTokens: number;
};

export type UsageOverview = {
  readonly totalTokens: number;
  /** `null` only when NOT ONE token on this machine could be priced —
   *  every model that carried usage is absent from `stats-pricing.ts`'s
   *  table. A mix of known and unknown models still prices the known share
   *  and reports that partial total; see `ProviderStat.costUsd` for the
   *  same rule at the per-provider level. */
  readonly estCostUsd: number | null;
  /** Distinct LOCAL days (`heatmap.ts`) that carry at least one token. */
  readonly activeDays: number;
  readonly cacheSharePercent: number;
};

export type ProviderStat = {
  readonly id: ProviderId;
  readonly label: string;
  /** Whether this provider's own directory exists on disk at all — the
   *  simplified reading of Orca's "Enabled/Off" pill this screen has no
   *  settings toggle to back (see the PR body for why). */
  readonly enabled: boolean;
  readonly hasData: boolean;
  /** The model that appears on the most usage events for this provider —
   *  `null` when there is no data at all. */
  readonly model: string | null;
  readonly tokens: number;
  /** Distinct transcripts (sessions + subagent transcripts for Claude Code,
   *  rollouts for Codex) — the same count `agentsSpawned` sums across both
   *  providers. */
  readonly sessions: number;
  /** Usage EVENTS read for this provider — an assistant message with usage
   *  for Claude Code, a `token_count` reading for Codex. A proxy for "turns"
   *  documented as such rather than a literal turn count. */
  readonly turns: number;
  readonly costUsd: number | null;
  readonly sharePercent: number;
};

export type PrsCreated =
  | { readonly kind: 'ok'; readonly count: number }
  | { readonly kind: 'unavailable'; readonly hint: string };

export type StatsSnapshot = {
  readonly generatedAt: string;
  /** The earliest timestamp found across every transcript scanned, or `null`
   *  for a machine with no data at all. */
  readonly trackingSinceIso: string | null;
  readonly agentsSpawned: number;
  readonly activeMs: number;
  readonly prsCreated: PrsCreated;
  readonly usageOverview: UsageOverview;
  /** Combined across every provider, oldest first. */
  readonly heatmap: readonly DailyBucket[];
  readonly tokenMix: TokenMix;
  readonly providers: readonly ProviderStat[];
  /** Lines that failed to parse at all, across every file scanned — a
   *  diagnostic the tooltip on "agents spawned" cites, never drawn as its
   *  own card. */
  readonly malformedLines: number;
  readonly priceTableAsOf: string;
};

/** The percentage `part` is of `whole`, or zero for a zero (or negative)
 *  whole — never `NaN`/`Infinity`, which a fresh install with no data at
 *  all would otherwise hand every share bar on this screen. */
export function percentShare(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}
