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
          <Tooltip.Content
            side="top"
            sideOffset={6}
            className="z-50 max-w-[260px] rounded-[7px] border border-line-strong bg-raised px-2 py-1.5 text-[11px] text-ink-dim leading-[1.45]"
          >
            {text}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
