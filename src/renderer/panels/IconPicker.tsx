/**
 * The session icon chooser — orca's, not a shortlist of my own.
 *
 * Orca ships `emoji-picker-react` (its bundle carries `.repo-icon-emoji-picker`
 * and `EmojiPickerReact`), so this is the same picker rather than an imitation:
 * a full set with search and categories. The first draft here was ten hardcoded
 * glyphs, which is a different thing wearing the same shape — the whole reason a
 * person picks an icon is that theirs means something to them, and a shortlist
 * decides in advance which meanings are available.
 *
 * The grid lives in its own lazy chunk (`EmojiGrid`) because the dataset is
 * 300kB and most sessions never open this. The shell you see here stays
 * synchronous, so `s` always puts a panel on screen at once.
 *
 * Rendered as an overlay from `Canvas`, the way the command palette is, because
 * the picker is wider than the 248px sidebar it belongs to.
 */

import { lazy, Suspense, useEffect, useRef } from 'react';

// The grid is a 300kB dataset; the shell around it is not. Only the grid waits.
const EmojiGrid = lazy(() => import('./EmojiGrid.js'));

export type IconPickerProps = {
  /** The session being given an icon — named so you cannot pick for the wrong one. */
  readonly title: string;
  readonly onPick: (icon: string) => void;
  readonly onClose: () => void;
};

export function IconPicker({ title, onPick, onClose }: IconPickerProps) {
  const shellRef = useRef<HTMLDivElement>(null);

  // Escape has to work from inside the picker's own search box, which the window
  // listener deliberately ignores along with every other input.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }
    const shell = shellRef.current;
    shell?.addEventListener('keydown', onKeyDown);
    return () => shell?.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      data-overlay-host
      className="absolute inset-0 z-30 flex items-start justify-center pt-[12vh]"
    >
      <button
        type="button"
        aria-label="close the icon panel"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-canvas/70"
      />
      <div
        ref={shellRef}
        data-icon-picker
        // The width lives here rather than on the grid because the phone
        // sheet needs the grid to be `100%` of whatever the sheet is; on the
        // desktop the panel is what fixes the picker at the grid's own 340px.
        className="relative z-10 w-[340px] overflow-hidden rounded-[var(--radius-lg)] border border-line bg-panel shadow-[var(--shadow-node)]"
      >
        <div className="flex items-center gap-2 border-line border-b px-3 py-2">
          <span className="text-[11px] text-ink-faint">icon cho</span>
          <span className="font-mono font-semibold text-[12px] text-ink">{title}</span>
          <button
            type="button"
            onClick={() => onPick('')}
            className="ml-auto cursor-pointer rounded-[var(--radius-sm)] border border-line px-1.5 py-0.5 text-[10.5px] text-ink-dim hover:border-line-strong hover:text-ink"
          >
            clear icon
          </button>
        </div>
        <Suspense
          fallback={
            <div className="flex h-[380px] w-full items-center justify-center text-[11px] text-ink-faint">
              loading icon grid…
            </div>
          }
        >
          <EmojiGrid onPick={onPick} />
        </Suspense>
      </div>
    </div>
  );
}
