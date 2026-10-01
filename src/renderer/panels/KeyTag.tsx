/** A key drawn as a key, in the class list `KeySheet`'s `[data-key-sheet-keys]` wears. */
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
