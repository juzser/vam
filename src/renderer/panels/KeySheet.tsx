/**
 * `?` — every keyboard binding there is (docs/design/canvas-layout.md §4).
 *
 * Its rows come from `buildKeySheet()`, which walks the chord tables, so this
 * component holds no key strings of its own and cannot advertise a control
 * that does not exist. Everything here is layout.
 *
 * The overlay idiom is `CommandPalette`'s, deliberately not a second one: a
 * scrim that is a real button (a div with a click handler is invisible to
 * exactly the users who most need the way out announced), and Escape as the
 * real exit, handled by the canvas's own key listener so the sheet closes
 * through the same `cancel` path as every other layer. What it adds is
 * returning the keyboard to wherever it came from on close — a full-screen
 * overlay that drops focus on the body leaves a keyboard-first app with no
 * cursor at all.
 */

import { useEffect, useRef } from 'react';
import { buildKeySheet } from '../keyboard/keysheet.js';

export type KeySheetProps = {
  readonly onClose: () => void;
};

export function KeySheet({ onClose }: KeySheetProps) {
  const closeButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const returnTo = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (returnTo instanceof HTMLElement && document.contains(returnTo)) {
        returnTo.focus();
      }
    };
  }, []);

  const groups = buildKeySheet();

  return (
    <div
      data-key-sheet
      role="dialog"
      aria-label="keyboard shortcuts"
      aria-modal="true"
      className="absolute inset-0 z-50 flex items-start justify-center pt-16"
    >
      <button
        type="button"
        aria-label="close keyboard shortcuts"
        className="absolute inset-0 cursor-default bg-canvas/70"
        onMouseDown={onClose}
      />
      <div className="relative max-h-[80vh] w-[min(720px,92vw)] overflow-y-auto rounded-md border border-line bg-panel p-4">
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="font-semibold text-ink text-sm">keyboard</h2>
          <span className="text-ink-faint text-xs">
            every binding there is — generated from the chord tables
          </span>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            className="ml-auto rounded border border-line px-2 py-0.5 text-ink-dim text-xs"
          >
            Esc
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {groups.map((group) => (
            <section key={group.group}>
              <h3 className="mb-1 text-ink-faint text-xs uppercase tracking-wide">{group.title}</h3>
              <ul>
                {group.rows.map((row) => (
                  <li key={row.keys} className="flex items-baseline gap-2 py-0.5 text-xs">
                    <kbd
                      data-key-sheet-keys
                      className="min-w-12 rounded border border-line bg-raised px-1 text-center font-mono text-ink"
                    >
                      {row.keys}
                    </kbd>
                    <span data-key-sheet-label className="text-ink-dim">
                      {row.label}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
