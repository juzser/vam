/**
 * The line at the top of the column that holds the keyboard.
 *
 * One element, mounted only when the column is focused: no dimmed line and no
 * reserved 2px in the unfocused case, because a permanently drawn indicator
 * that changes shade is a thing to compare, and this has to be answerable at a
 * glance from the corner of the eye.
 *
 * It is `aria-hidden` on purpose. The line is the THIRD signal, never the only
 * one: the status bar prints the mode as a word, the response pane's left
 * border grows from 1px to 2px (a shape change that survives a monochrome
 * render), and inside the mode the focused row or card draws its own ring. So
 * announcing it would repeat the word the status cell already carries.
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
