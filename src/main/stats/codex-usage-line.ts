/**
 * ONE Codex rollout line, read for its token usage and its active model.
 *
 * Codex splits across TWO line shapes what Claude Code carries on one:
 *
 *  - a top-level `turn_context` line names the MODEL the next turn runs
 *    (`payload.model`) — read once per line and handed back as `'model'`, so
 *    the caller (`scan.ts`) can remember it across the rest of the file the
 *    same way it remembers everything else about "where this file's read
 *    got to".
 *  - a nested `event_msg`/`token_count` line carries `payload.info.
 *    last_token_usage` -- THE DELTA since the previous reading, not a
 *    cumulative total. Measured on a real rollout: `total_token_usage`
 *    resets across a context compaction while `last_token_usage` keeps
 *    reporting one turn's own cost, which is what a full scan must SUM
 *    across every event rather than read once at the newest line. It
 *    carries no model of its own, so the caller's `currentModel` — the most
 *    recent `turn_context` this same read has seen — is threaded through as
 *    an argument and stamped onto the event.
 *
 * Same three-outcome shape as `claude-usage-line.ts`, for the same reason:
 * `'malformed'` (JSON.parse failed, or parsed to something that is not an
 * object) is counted separately from `'other'` (a real line this scanner has
 * nothing to learn from — `session_meta`, `task_started`, a `token_count`
 * missing the one field this reads).
 */

export type CodexUsageEvent = {
  readonly atMs: number;
  /** `null` when no `turn_context` has been seen yet in this read — the
   *  tokens are still counted; `stats-pricing.ts`'s `costOfUsage` simply has
   *  no model to price them against. */
  readonly model: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheReadTokens: number;
  /** A SUBSET of `outputTokens`, never additional — see `shared/stats.ts`'s
   *  `TokenMix` header, and the sample math in this file's own header. */
  readonly reasoningTokens: number;
};

export type CodexLineResult =
  | { readonly kind: 'usage'; readonly event: CodexUsageEvent }
  | { readonly kind: 'model'; readonly model: string }
  | { readonly kind: 'other' }
  | { readonly kind: 'malformed' };

const OTHER: CodexLineResult = { kind: 'other' };
const MALFORMED: CodexLineResult = { kind: 'malformed' };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export function parseCodexLine(raw: string, currentModel: string | null): CodexLineResult {
  if (raw.trim() === '') return OTHER;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return MALFORMED;
  }
  const line = obj(value);
  if (line === null) return MALFORMED;

  if (line['type'] === 'turn_context') {
    const model = str(obj(line['payload'])?.['model']);
    return model === null ? OTHER : { kind: 'model', model };
  }

  if (line['type'] !== 'event_msg') return OTHER;
  const payload = obj(line['payload']);
  if (payload === null || payload['type'] !== 'token_count') return OTHER;
  const info = obj(payload['info']);
  const last = obj(info?.['last_token_usage']);
  if (last === null) return OTHER;
  const timestamp = str(line['timestamp']);
  if (timestamp === null) return OTHER;
  const atMs = Date.parse(timestamp);
  if (Number.isNaN(atMs)) return OTHER;
  return {
    kind: 'usage',
    event: {
      atMs,
      model: currentModel,
      inputTokens: num(last['input_tokens']),
      outputTokens: num(last['output_tokens']),
      cacheWriteTokens: num(last['cache_write_input_tokens']),
      cacheReadTokens: num(last['cached_input_tokens']),
      reasoningTokens: num(last['reasoning_output_tokens']),
    },
  };
}
