/**
 * The sidebar's stats popover: a few headline numbers from the same
 * `window.api.stats.get()` snapshot Settings -> Stats reads, the contribution
 * graph, and a top-right "Details" button that hands over to that screen
 * (`onStats`) and closes this one. The trigger, open state and dismissal are
 * eager; the body (`StatsPopoverPanel`, with the Heatmap) is a lazy chunk. Self-contained like `UsagePopover`: its own
 * open state and its own dismissal (outside pointerdown, Escape).
 *
 * The panel's aria-label deliberately omits the word "usage": e2e finds the
 * usage popover with a substring `getByLabel`, and a second match collides.
 */

import { ChartColumn } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ShortcutTip } from '../keyboard/ShortcutTip.js';

const StatsPopoverPanel = lazy(() => import('./StatsPopoverPanel.js'));

export function StatsPopover({ onStats }: { readonly onStats: () => void }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null;
      if (target === null) return;
      if (panelRef.current?.contains(target) === true) return;
      if (buttonRef.current?.contains(target) === true) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const onEscape = (event: { readonly key: string }) => {
    if (event.key === 'Escape') setOpen(false);
  };

  return (
    <div className="relative flex-none">
      <ShortcutTip label="Stats & usage">
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          // NOT "stats and usage": the account icon's `aria-label="usage"` is
          // matched by substring in `e2e/usage-popover-shots.mjs`.
          aria-label="stats"
          onKeyDown={onEscape}
          onClick={() => setOpen((v) => !v)}
          className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-[7px] text-ink-faint hover:text-ink"
        >
          <ChartColumn size={14} strokeWidth={1.5} />
        </button>
      </ShortcutTip>
      {open && (
        <div
          ref={panelRef}
          data-stats-popover
          role="dialog"
          aria-label="activity summary"
          tabIndex={-1}
          onKeyDown={onEscape}
          className="absolute top-[32px] left-0 z-20 flex w-[min(320px,calc(100vw-24px))] flex-col gap-3 rounded-[9px] border border-line-strong bg-card p-3 shadow-lg"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-meta text-ink-dim uppercase tracking-[0.12em]">Usage</h2>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onStats();
              }}
              className="cursor-pointer rounded-[6px] px-2 py-0.5 text-control text-ink-dim hover:bg-line-strong hover:text-ink"
            >
              Details
            </button>
          </div>
          <Suspense fallback={<p className="text-control text-ink-dim">loading…</p>}>
            <StatsPopoverPanel />
          </Suspense>
        </div>
      )}
    </div>
  );
}
