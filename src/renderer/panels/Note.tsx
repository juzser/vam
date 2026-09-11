/**
 * A note that a keyboard can read.
 *
 * Every explanatory note in this app used to be a `title`. A `title` opens on
 * hover and on nothing else — no browser shows one on keyboard focus — so on a
 * tool driven from the keyboard the explanation was unreadable to its primary
 * user. Radix opens on focus as well, and `data-note` keeps the string
 * queryable without waiting for an open portal.
 *
 * Shared between `DetailPanel.tsx` (where it originated) and `Canvas.tsx`'s
 * status-bar usage cell, which is why it lives in its own file rather than
 * inside either.
 */

import * as Tooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export function Note({ text, children }: { readonly text: string; readonly children: ReactNode }) {
  return (
    // A provider per note rather than one at the tree's root: it renders no
    // DOM and the only thing a shared one buys is the "second tooltip opens
    // with no delay" grouping, which is not worth threading a provider up to
    // every caller for.
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild data-note={text}>
          {children}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          {/* NO BORDER, because the fill is the boundary now. `bg-tip` is the
              theme turned inside out -- light in dark, dark in light -- and it
              clears WCAG 1.4.11's 3:1 against every surface in the palette by
              10.02:1 at worst, where the old `bg-raised` fill managed 1.07:1
              and had to buy its edge with `--vam-line-tip`. The argument is
              written out at `--vam-tip` in `styles.css`; the paint is measured
              by `e2e/tooltip-shots.mjs`. */}
          <Tooltip.Content
            side="top"
            sideOffset={6}
            className="z-50 max-w-[260px] rounded-[7px] bg-tip px-2 py-1.5 text-control text-on-tip-dim shadow-tip"
          >
            {text}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
