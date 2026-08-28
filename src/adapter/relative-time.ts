/**
 * `2026-08-27T14:26:44.991Z` → `4m`.
 *
 * The activity line is read at a glance, in a column, next to a dozen others.
 * An ISO timestamp there is eleven characters of date nobody needed and a clock
 * you have to subtract in your head — and the question it is answering is never
 * "when exactly", it is "is this fresh".
 *
 * The form is the ADE mockup's: a number and one letter, right-aligned at the
 * end of a row (`2m`, `6m`, `26m`). It has to survive being the narrowest
 * column in the sidebar, and "26 minutes ago" does not — it wraps, and a
 * wrapping timestamp pushes the row it belongs to out of rhythm with every
 * other row.
 *
 * `now` is a parameter, not `Date.now()`. Not for the tests' convenience: a
 * function that reads the clock cannot be checked against a fixed instant, and
 * the one thing this must not do is be off by an hour twice a year.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(iso: string, now: Date): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    // A timestamp we cannot read is shown as itself rather than as a guess. It
    // is a source bug, and hiding it behind `now` would keep it hidden.
    return iso;
  }

  const ago = now.getTime() - then;

  // A clock a little ahead of ours is normal — the factory writes its own
  // timestamps — and a negative age would be an alarming way to say "this
  // second" about an event that has just landed.
  if (ago < MINUTE) {
    return 'now';
  }
  if (ago < HOUR) {
    return `${Math.floor(ago / MINUTE)}m`;
  }
  if (ago < DAY) {
    return `${Math.floor(ago / HOUR)}h`;
  }
  return `${Math.floor(ago / DAY)}d`;
}
