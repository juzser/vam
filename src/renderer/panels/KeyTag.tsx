/**
 * A key, drawn as a key: the small bordered tag that names a key before the
 * thing it does ("Tab" before a suggestion). The class list is the one
 * `KeySheet`'s `[data-key-sheet-keys]` already wears, so the two read as the
 * same object; unifying `KeySheet` onto this is a later follow-up.
 */
export function KeyTag({ children }: { readonly children: string }) {
  return (
    <kbd
      data-key-tag
      className="shrink-0 rounded border border-line bg-raised px-1 text-center font-mono text-ink"
    >
      {children}
    </kbd>
  );
}
