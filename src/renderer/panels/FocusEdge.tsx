/**
 * The line at the top of a column the current mode holds the keyboard for.
 *
 * One element, mounted only where the keyboard is: no dimmed line and no
 * reserved 2px otherwise, because a permanently drawn indicator that changes
 * shade is a thing to compare, and this has to be answerable at a glance from
 * the corner of the eye. It is one line PER COLUMN and not one on screen --
 * Select owns the sidebar and the canvas both, and draws over each.
 *
 * It is `aria-hidden` on purpose, and never the only signal: the status bar
 * prints the mode as a word, and inside the mode the focused row or card draws
 * its own ring. So announcing it would repeat the word the status cell already
 * carries. (The response pane's left border was a third signal until it was
 * removed in both states -- it is not one now, and the argument does not rest
 * on it.)
 *
 * All three column roots are already `relative`, so this drops in as an
 * absolutely-positioned child with no layout change to any of them, and none of
 * them has a `border-t` for it to double.
 */
export function FocusEdge() {
  return (
    <span
      data-focus-edge
      aria-hidden="true"
      className="vam-focus-edge pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden"
    />
  );
}
