/**
 * A scrollbar that paints OVER the content instead of taking width from it.
 *
 * A native scrollbar — even a `::-webkit-scrollbar` styled to be transparent
 * at rest — still reserves its track in layout. In a 264px sidebar that is 8px
 * stolen from every row, and it shows: the project cards ended up with a wider
 * gap on the right than the left, permanently, whether or not the bar was
 * visible. Chromium has no CSS overlay mode to ask for instead (`overflow:
 * overlay` was removed), so the only honest fix is to stop rendering the
 * native bar and draw the thumb ourselves, absolutely positioned in a wrapper
 * that does not scroll.
 *
 * The thumb is `pointer-events-none`: this is an indicator, not a drag handle.
 * Wheel, trackpad and keyboard scrolling are the real interface and are
 * untouched — which also means nothing here can break `j`/`k`.
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

/** Never let the thumb shrink to a dot in a very long list. */
const MIN_THUMB_PX = 24;

type Metrics = { readonly top: number; readonly height: number; readonly needed: boolean };

const NONE: Metrics = { top: 0, height: 0, needed: false };

export function measure(el: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): Metrics {
  const { scrollTop, scrollHeight, clientHeight } = el;
  // `<=` and not `<`: a list exactly as tall as its viewport does not scroll,
  // and a thumb spanning the whole track would claim otherwise.
  if (scrollHeight <= clientHeight || clientHeight === 0) {
    return NONE;
  }
  const height = Math.max(MIN_THUMB_PX, (clientHeight / scrollHeight) * clientHeight);
  // The travel available to the thumb is the track minus the thumb itself, so
  // the bottom of the scroll lands the thumb flush with the bottom rather than
  // overhanging it.
  const travel = clientHeight - height;
  const progress = scrollTop / (scrollHeight - clientHeight);
  return { top: travel * progress, height, needed: true };
}

export function OverlayScroll({
  children,
  className,
  scrollRef,
}: {
  readonly children: ReactNode;
  readonly className: string;
  readonly scrollRef?: (el: HTMLDivElement | null) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<Metrics>(NONE);

  const sync = useCallback(() => {
    const el = ref.current;
    if (el !== null) {
      setMetrics(measure(el));
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    sync();
    // Content can change height without a scroll event — a filter narrowing
    // the list is the common one — so watch the box as well as the scrolling.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => sync());
    observer?.observe(el);
    for (const child of el.children) {
      observer?.observe(child);
    }
    return () => observer?.disconnect();
  }, [sync]);

  return (
    <div className="group relative flex min-h-0 flex-1 flex-col">
      <div
        ref={(el) => {
          ref.current = el;
          scrollRef?.(el);
        }}
        onScroll={sync}
        className={`vam-no-scrollbar ${className}`}
      >
        {children}
      </div>
      {metrics.needed && (
        <span
          aria-hidden="true"
          data-overlay-thumb
          className="pointer-events-none absolute right-[3px] w-[3px] rounded-full bg-ink-ghost opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          style={{ top: metrics.top, height: metrics.height }}
        />
      )}
    </div>
  );
}
