/**
 * The line at the top of a column the current mode holds the keyboard for.
 *
 * One element, mounted only where the keyboard is: no dimmed line and no
 * reserved 2px otherwise, because a permanently drawn indicator that changes
 * shade is a thing to compare, and this has to be answerable at a glance from
 * the corner of the eye.
 *
 * There is exactly ONE on screen, and the canvas column never wears it. This
 * file used to argue the opposite -- that Select is one cursor drawn in two
 * columns, so the sidebar and the canvas should both carry the line -- and the
 * operator overturned it: the line marks where the KEYBOARD is, and the canvas
 * is a view of what the cursor landed on rather than a place the keyboard
 * goes. Select types into the sidebar's list, Insert into the response pane,
 * and a line on the canvas answers "where do my keys go" with a column that
 * never takes any. So the two mounts are `SessionList` and `DetailPanel`; if
 * you are here because the canvas looks like it is missing one, it is not.
 *
 * It is `aria-hidden` on purpose, and never the only signal: the status bar
 * prints the mode as a word, and inside the mode the focused row or card draws
 * its own ring. So announcing it would repeat the word the status cell already
 * carries. (The response pane's left border was a third signal until it was
 * removed in both states -- it is not one now, and the argument does not rest
 * on it.)
 *
 * Both mounting column roots are already `relative`, so this drops in as an
 * absolutely-positioned child with no layout change to either of them, and
 * neither has a `border-t` for it to double.
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
