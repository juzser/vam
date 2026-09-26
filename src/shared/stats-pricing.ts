/**
 * A BUNDLED, DATED price table for the Stats screen's "est. cost" figure —
 * never a live lookup. The operator's own rule: label every cost figure
 * "est.", show this table's own date beside it, and NEVER GUESS a price for a
 * model this table carries no row for — such a model still has its tokens
 * counted, but `costOfUsage` returns `null` for it, and the renderer draws
 * "n/a" rather than a number nobody can vouch for.
 *
 * SOURCE AND DATE. Every rate below is a model's own published per-million-
 * token price from its provider (Anthropic's pricing page for the `claude-*`
 * rows, OpenAI's for the `gpt-*`/`o*` rows), as this table's author could
 * last verify them — `PRICE_TABLE_AS_OF`. A model released after that date
 * (this machine's own transcripts carry several — `claude-opus-5`,
 * `gpt-5.6-terra`, neither published anywhere this table's author could
 * check) has no row here BY CONSTRUCTION, not by omission: adding a row for a
 * price nobody has confirmed is exactly the guess this module refuses to
 * make. Refreshing this table is therefore a deliberate, dated edit, not an
 * automatic one — there is no network call anywhere in this file.
 *
 * `cacheWritePerMillion`/`cacheReadPerMillion` are OPTIONAL per row: a model
 * that predates prompt caching (`claude-2.1`) or that this table's author
 * could not confirm a cache rate for carries no such field, and
 * `costOfUsage` prices those tokens at zero for it rather than inventing a
 * ratio off the input rate — the input/output portion of the estimate still
 * stands, and is not itself a guess.
 *
 * Renderer-safe: no `electron`, no `node:` import. Main computes the actual
 * dollar figure during a scan; the renderer only ever reads the result and
 * this same table's date to caption it.
 */

export const PRICE_TABLE_AS_OF = '2026-01-15';

export type TokenUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheReadTokens: number;
};

export type PriceRow = {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cacheWritePerMillion?: number;
  readonly cacheReadPerMillion?: number;
};

/**
 * Keyed by the PROVIDER'S OWN model id — `message.model` on a Claude Code
 * transcript line, `turn_context.payload.model` on a Codex rollout — never a
 * vam-invented alias. A transcript's id is matched EXACTLY against this
 * table; there is no prefix or fuzzy match, because a partial match is the
 * same guess this module exists to refuse (a shorter, cheaper model's rate
 * silently applied to a longer id it merely starts with).
 */
const PRICE_TABLE: Readonly<Record<string, PriceRow>> = {
  // ── Anthropic ──────────────────────────────────────────────────────────
  'claude-2.1': { inputPerMillion: 8, outputPerMillion: 24 },
  'claude-3-opus-20240229': {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheWritePerMillion: 18.75,
    cacheReadPerMillion: 1.5,
  },
  'claude-3-sonnet-20240229': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  'claude-3-haiku-20240307': {
    inputPerMillion: 0.25,
    outputPerMillion: 1.25,
    cacheWritePerMillion: 0.3,
    cacheReadPerMillion: 0.03,
  },
  'claude-3-5-sonnet-20240620': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  'claude-3-5-sonnet-20241022': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  'claude-3-5-haiku-20241022': {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheWritePerMillion: 1,
    cacheReadPerMillion: 0.08,
  },
  'claude-opus-4-20250514': {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheWritePerMillion: 18.75,
    cacheReadPerMillion: 1.5,
  },
  'claude-opus-4-1-20250805': {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheWritePerMillion: 18.75,
    cacheReadPerMillion: 1.5,
  },
  'claude-sonnet-4-20250514': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  'claude-sonnet-4-5-20250929': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheWritePerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  // ── OpenAI (Codex) ─────────────────────────────────────────────────────
  'gpt-4o': {
    inputPerMillion: 2.5,
    outputPerMillion: 10,
    cacheReadPerMillion: 1.25,
  },
  'gpt-4o-mini': {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cacheReadPerMillion: 0.075,
  },
  'gpt-4.1': {
    inputPerMillion: 2,
    outputPerMillion: 8,
    cacheReadPerMillion: 0.5,
  },
  'gpt-4.1-mini': {
    inputPerMillion: 0.4,
    outputPerMillion: 1.6,
    cacheReadPerMillion: 0.1,
  },
  'gpt-4.1-nano': {
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
    cacheReadPerMillion: 0.025,
  },
  o1: { inputPerMillion: 15, outputPerMillion: 60, cacheReadPerMillion: 7.5 },
  'o1-mini': { inputPerMillion: 3, outputPerMillion: 12, cacheReadPerMillion: 1.5 },
  'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4, cacheReadPerMillion: 0.55 },
};

/** The row for a model id, or `null` when this table cannot vouch for one. */
export function priceRowFor(model: string): PriceRow | null {
  return PRICE_TABLE[model] ?? null;
}

/**
 * The estimated dollar cost of one usage delta, or `null` for a model this
 * table has no row for — NEVER a guessed number. A row with no cache rate
 * prices those tokens at zero rather than at an invented ratio; see the
 * header.
 */
export function costOfUsage(model: string, usage: TokenUsage): number | null {
  const row = priceRowFor(model);
  if (row === null) return null;
  const per = (tokens: number, rate: number | undefined): number =>
    rate === undefined ? 0 : (tokens / 1_000_000) * rate;
  return (
    per(usage.inputTokens, row.inputPerMillion) +
    per(usage.outputTokens, row.outputPerMillion) +
    per(usage.cacheWriteTokens, row.cacheWritePerMillion) +
    per(usage.cacheReadTokens, row.cacheReadPerMillion)
  );
}
