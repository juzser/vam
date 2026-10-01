/**
 * THE PRs VIEW'S FILTER BAR: author, state and sort, each one a field of the
 * `gh pr list` query main runs (`shared/pr-filters.ts`). This draws the choice
 * and reports it; it never filters or re-sorts a row itself.
 */
import {
  PR_AUTHORS,
  PR_SORTS,
  PR_STATES,
  type PrAuthor,
  type PrFilters,
  type PrSort,
  type PrStateFilter,
} from '../../shared/pr-filters.js';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';
const SELECT = `vam-tap h-[28px] rounded border border-line bg-raised px-2 text-control text-ink outline-none hover:border-line-loud ${FOCUS_RING}`;

const AUTHOR_LABEL: Record<PrAuthor, string> = { mine: 'Mine', all: 'Everyone' };
const STATE_LABEL: Record<PrStateFilter, string> = {
  open: 'Open',
  ready: 'Ready',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
  all: 'All',
};
const SORT_LABEL: Record<PrSort, string> = { updated: 'Updated', created: 'Created' };

export function PrFilterBar({
  filters,
  onChange,
}: {
  readonly filters: PrFilters;
  readonly onChange: (next: PrFilters) => void;
}) {
  return (
    <div data-pr-filters className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1.5">
      <fieldset
        data-pr-filter-author
        aria-label="Author"
        className="m-0 flex items-center gap-1 rounded-[10px] border border-line-strong bg-card p-1"
      >
        {PR_AUTHORS.map((author) => {
          const pressed = filters.author === author;
          return (
            <button
              key={author}
              type="button"
              data-pr-filter-choice={author}
              aria-pressed={pressed}
              onClick={() => {
                if (!pressed) onChange({ ...filters, author });
              }}
              className={`vam-tap cursor-pointer rounded-[6px] px-2.5 py-1 text-control ${FOCUS_RING} ${
                pressed
                  ? 'bg-line-strong text-ink'
                  : 'text-ink-dim hover:bg-line-strong hover:text-ink'
              }`}
            >
              {AUTHOR_LABEL[author]}
            </button>
          );
        })}
      </fieldset>
      <label className="flex items-center gap-1.5 text-ink-faint text-meta">
        State
        <select
          data-pr-filter-state
          value={filters.state}
          onChange={(e) => onChange({ ...filters, state: e.target.value as PrStateFilter })}
          className={SELECT}
        >
          {PR_STATES.map((state) => (
            <option key={state} value={state}>
              {STATE_LABEL[state]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-ink-faint text-meta">
        Sort
        <select
          data-pr-filter-sort
          value={filters.sort}
          onChange={(e) => onChange({ ...filters, sort: e.target.value as PrSort })}
          className={SELECT}
        >
          {PR_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {SORT_LABEL[sort]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
