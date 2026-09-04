/**
 * The layout picker as an image choice: a minimal shape diagram above, the
 * label below.
 *
 * A row of text buttons could say `focus the response` but could not show that
 * the response MOVES — the difference between `focusResponse` and the shipped
 * layout is an order, not a set, and an order is a thing you draw. Everything
 * drawn here is derived from `LAYOUTS` (via `sections.ts`), so the picture
 * cannot describe a layout the chord layer never built.
 */

import { Check } from 'lucide-react';
import {
  canvasDots,
  DIAGRAM,
  type DiagramColumn,
  diagramColumns,
  LAYOUT_CHOICES,
  LAYOUT_DESCRIPTION,
  type LayoutChoice,
} from './sections.js';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

export function LayoutPicker({
  current,
  label,
  onPick,
}: {
  /** The choice the stored panes ARE, or `null` for a hand-set combination that
   *  matches none — which renders unmarked rather than wrongly marked. */
  readonly current: LayoutChoice | null;
  readonly label: (choice: LayoutChoice) => string;
  readonly onPick: (choice: LayoutChoice) => void;
}) {
  /** Arrows move AND select, wrapping, from whichever tile they were pressed
   *  on — the roving cursor is the tile, not the selection, so the group is
   *  still steerable when nothing is selected. */
  const move = (from: number, delta: number, group: HTMLElement | null) => {
    const next = LAYOUT_CHOICES[(from + delta + LAYOUT_CHOICES.length) % LAYOUT_CHOICES.length];
    if (next === undefined) return;
    onPick(next);
    group?.querySelector<HTMLElement>(`[data-layout-option="${next}"]`)?.focus();
  };

  return (
    <div role="radiogroup" aria-label="layout" className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {LAYOUT_CHOICES.map((choice, index) => {
        const selected = current === choice;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a native radio input cannot contain the diagram, and the picture IS the choice here -- a label-wrapped input would put it outside the control's own box. Hand-rolled instead, roving tabindex and arrow keys and all, which is what the native element would have given.
          <button
            key={choice}
            type="button"
            role="radio"
            data-layout-option={choice}
            aria-checked={selected}
            // The visible label first, because WCAG 2.5.3 asks the accessible
            // name to contain it; then the only thing the picture says that the
            // label does not — the columns, in the order they are drawn.
            aria-label={`${label(choice)} — ${LAYOUT_DESCRIPTION[choice]}`}
            // One tab stop for the group: the selected tile, or the first one
            // when the panes match no named layout.
            tabIndex={selected || (current === null && index === 0) ? 0 : -1}
            onClick={() => onPick(choice)}
            onKeyDown={(event) => {
              const group = event.currentTarget.parentElement;
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                move(index, 1, group);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(index, -1, group);
              } else if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                onPick(choice);
              }
            }}
            className={`group relative flex w-full cursor-pointer flex-col items-center gap-[6px] rounded-[9px] border p-[7px] text-[11.5px] ${FOCUS_RING} ${
              selected
                ? 'border-line-loudest bg-raised font-medium text-ink'
                : 'border-line bg-panel text-ink-dim hover:border-line-strong hover:text-ink'
            }`}
          >
            {selected ? (
              // Required, not decoration: `line-loudest` on `panel` is 2.08:1 in
              // dark, so the border alone cannot carry selected-vs-unselected,
              // and a mark is the only carrier that survives a monochrome render.
              <Check
                size={12}
                strokeWidth={2.5}
                className="absolute top-[5px] right-[5px] text-ink"
              />
            ) : null}
            <Diagram choice={choice} />
            <span className="w-full truncate text-center">{label(choice)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The picture. `aria-hidden` on purpose: the tile's accessible name carries
 *  every word of what this says, and no text fits inside 120x72 units. */
function Diagram({ choice }: { readonly choice: LayoutChoice }) {
  return (
    <svg
      data-layout-diagram={choice}
      aria-hidden="true"
      viewBox="0 0 120 72"
      className="w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* The diagram's ground is the app's ground — that is what makes it read
          as a picture of vam rather than as an abstract icon. */}
      <rect
        x={0}
        y={0}
        width={120}
        height={72}
        rx={6}
        fill="var(--color-canvas)"
        stroke="var(--color-line-strong)"
        strokeWidth={1}
      />
      {diagramColumns(choice).map((column) => (
        <g key={column.id}>
          <rect
            data-diagram-column={column.id}
            x={column.x}
            y={DIAGRAM.y}
            width={column.width}
            height={DIAGRAM.height}
            rx={3}
            fill={column.main ? 'var(--color-ink-dim)' : 'var(--color-ink-faint)'}
          />
          <Glyph column={column} />
        </g>
      ))}
    </svg>
  );
}

/** Each column's mark, knocked out in the ground colour, so a glyph always has
 *  exactly its own block's contrast and needs no extra token. */
function Glyph({ column }: { readonly column: DiagramColumn }) {
  const knockout = 'var(--color-canvas)';
  const inset = column.x + 3;
  const wide = Math.max(0, column.width - 6);
  if (column.id === 'sidebar') {
    return (
      <>
        {[11, 19, 27, 35].map((y) => (
          <rect key={y} x={inset} y={y} width={wide} height={3} rx={1.5} fill={knockout} />
        ))}
      </>
    );
  }
  if (column.id === 'canvas') {
    return (
      <>
        {canvasDots(column).map((dot) => (
          <circle key={`${dot.cx},${dot.cy}`} cx={dot.cx} cy={dot.cy} r={1.5} fill={knockout} />
        ))}
      </>
    );
  }
  return (
    <>
      <rect x={inset} y={11} width={wide} height={5} rx={2} fill={knockout} />
      {[22, 29, 36].map((y, index) => (
        <rect
          key={y}
          x={inset}
          y={y}
          width={index === 2 ? wide * 0.6 : wide}
          height={2.5}
          rx={1.25}
          fill={knockout}
        />
      ))}
    </>
  );
}
