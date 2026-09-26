/**
 * ONE Claude Code transcript line, read for its token usage alone.
 *
 * A transcript is append-only JSONL, so the same three outcomes every reader
 * in this tree already lives with apply here: a line vam has nothing to
 * learn from (`'other'` — a `user` line, a `last-prompt` marker, an
 * assistant line carrying no `usage` at all), a line that fails to parse at
 * all (`'malformed'` — most often the LAST line of a file still being
 * appended to, cut mid-token), and a real usage event (`'usage'`). The THREE
 * are kept distinguishable rather than collapsed into `null`, because a scan
 * counts malformed lines and must not count an ordinary `user` line as one.
 *
 * READS `message.usage`, Anthropic's own field names
 * (`input_tokens`/`output_tokens`/`cache_creation_input_tokens`/
 * `cache_read_input_tokens`), measured against a real transcript on this
 * machine before this was written. A missing token field is zero, not a
 * reason to call the line malformed — an assistant message with no cache
 * activity at all carries no `cache_creation_input_tokens` key.
 *
 * `id` IS THE DEDUP KEY `scan.ts` needs. Measured on a real transcript
 * (15,489 lines): a streamed assistant turn writes MULTIPLE lines carrying
 * the SAME `message.id` and an IDENTICAL, already-cumulative `usage` object
 * — 1,154 of 1,489 usage-bearing lines in that one file (77%) were such a
 * repeat. Folding every line (this module's own job before this field
 * existed) double- to quadruple-counts tokens, cost, turns and active time.
 * `message.id` is read first (Anthropic's own identity for the assistant
 * turn); the top-level `requestId` is the fallback for the rare line that
 * carries no `message.id` at all — a coarser but still-stable-per-turn key.
 * `null` only when a line has neither, in which case `scan.ts` cannot dedup
 * it and folds it as it always did. */
export type ClaudeUsageEvent = {
  readonly atMs: number;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheReadTokens: number;
  /** A SUBSET of `outputTokens`, never additional — see `shared/stats.ts`'s
   *  `TokenMix` header. */
  readonly reasoningTokens: number;
  readonly id: string | null;
};

export type ClaudeLineResult =
  | { readonly kind: 'usage'; readonly event: ClaudeUsageEvent }
  | { readonly kind: 'other' }
  | { readonly kind: 'malformed' };

const OTHER: ClaudeLineResult = { kind: 'other' };
const MALFORMED: ClaudeLineResult = { kind: 'malformed' };

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export function parseClaudeUsageLine(raw: string): ClaudeLineResult {
  if (raw.trim() === '') return OTHER;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return MALFORMED;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return MALFORMED;
  }
  const line = value as Record<string, unknown>;
  if (line['type'] !== 'assistant') return OTHER;
  const timestamp = str(line['timestamp']);
  if (timestamp === null) return OTHER;
  const atMs = Date.parse(timestamp);
  if (Number.isNaN(atMs)) return OTHER;
  const message = line['message'];
  if (typeof message !== 'object' || message === null) return OTHER;
  const model = str((message as Record<string, unknown>)['model']);
  const usage = (message as Record<string, unknown>)['usage'];
  if (model === null || typeof usage !== 'object' || usage === null) return OTHER;
  const u = usage as Record<string, unknown>;
  const details = u['output_tokens_details'];
  const thinking =
    typeof details === 'object' && details !== null
      ? num((details as Record<string, unknown>)['thinking_tokens'])
      : 0;
  const id = str((message as Record<string, unknown>)['id']) ?? str(line['requestId']);
  return {
    kind: 'usage',
    event: {
      atMs,
      model,
      inputTokens: num(u['input_tokens']),
      outputTokens: num(u['output_tokens']),
      cacheWriteTokens: num(u['cache_creation_input_tokens']),
      cacheReadTokens: num(u['cache_read_input_tokens']),
      reasoningTokens: thinking,
      id,
    },
  };
}
