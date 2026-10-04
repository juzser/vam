/**
 * THE PRs VIEW'S FILTER AND SORT SET. A value, nothing more: it filters and
 * sorts nothing. Main turns it into one `gh pr list` query
 * (`main/sources/claude-code/pull-requests.ts`) and the renderer only draws
 * what that query returned.
 *
 * Every field is a closed vocabulary, so a value that reaches an argv element
 * in main is always one of these literals, never renderer text.
 */

export type PrAuthor = 'mine' | 'all';
export type PrStateFilter = 'open' | 'ready' | 'draft' | 'merged' | 'closed' | 'all';
export type PrSort = 'updated' | 'created';

/** One value per field; the sort is always descending. */
export type PrFilters = {
  readonly author: PrAuthor;
  readonly state: PrStateFilter;
  readonly sort: PrSort;
};

export const DEFAULT_PR_FILTERS: PrFilters = { author: 'mine', state: 'open', sort: 'updated' };

/** How many rows one `gh pr list` asks for; the view says so when a list is full. */
export const PR_LIMIT = 50;

export const PR_AUTHORS: readonly PrAuthor[] = ['mine', 'all'];
export const PR_STATES: readonly PrStateFilter[] = [
  'open',
  'ready',
  'draft',
  'merged',
  'closed',
  'all',
];
export const PR_SORTS: readonly PrSort[] = ['updated', 'created'];

const pick = <T extends string>(allowed: readonly T[], raw: unknown, fallback: T): T =>
  allowed.find((value) => value === raw) ?? fallback;

/** Total: each malformed or unknown field falls back to that field's default. */
export function parsePrFilters(raw: unknown): PrFilters {
  const record =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    author: pick(PR_AUTHORS, record['author'], DEFAULT_PR_FILTERS.author),
    state: pick(PR_STATES, record['state'], DEFAULT_PR_FILTERS.state),
    sort: pick(PR_SORTS, record['sort'], DEFAULT_PR_FILTERS.sort),
  };
}

/** Canonical: equal for equal sets, independent of key order. */
export function prFilterKey(filters: PrFilters): string {
  return `${filters.author}|${filters.state}|${filters.sort}`;
}
