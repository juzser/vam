import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { normalizeKey } from '../keyboard/chords.js';

/**
 * THE RIGHT-CLICK MENU — one component, because there were about to be five.
 *
 * Operator: "add popover actions on right click — for instance right-click a
 * session in the sidebar to rename, remove… try it for the tab, the detail
 * pane and the In bubble too."
 *
 * Before this, `onContextMenu` appeared NOWHERE in the renderer: every action
 * vam has was on a chord, a hover control, or nothing. Two of them —
 * `r` (rename a session) and `s` (change its icon) — had no mouse route at
 * all, which is the gap the operator actually hit.
 *
 * ── WHY A COMPONENT AND NOT A THIRD INLINE COPY ──────────────────────────
 * `SessionList.tsx` already carries the same menu twice, for the group heading
 * and the project heading, identical down to the class string. They are NOT
 * migrated onto this: they are shipped behaviour with their own tests, and
 * rewriting them to prove a new primitive is how a refactor becomes a
 * regression. This is what the NEW surfaces use, and what those two should be
 * folded into once it has shipped a release.
 *
 * ── WHAT IT OWES ─────────────────────────────────────────────────────────
 * POSITION IS FIXED, NOT ABSOLUTE. The two menus above are `absolute` inside
 * the row they belong to, which works because they open at a known corner of
 * that row. A right-click opens wherever the pointer is, and the sidebar is a
 * scroll container with `overflow` — an absolutely positioned panel would be
 * clipped by it. `position: fixed` against the viewport is the only placement
 * that cannot be cut off by an ancestor, and it is why the flip below reasons
 * about `window.innerWidth` rather than about any parent.
 *
 * THE KEYBOARD REACHES IT WITHOUT A POINTER. Both the Menu key and Shift+F10
 * fire a `contextmenu` event, so a caller wires ONE handler and gets both
 * routes; there is no second binding to keep in step. `j`/`k` walk beside the
 * arrows because this is vam and the operator walks everything else that way.
 *
 * AN ITEM THAT CANNOT ACT IS DRAWN, DISABLED, AND SAYS WHY. Dropping it would
 * make the menu change shape with the session under the pointer — the same
 * "absent, not dimmed" question the keystroke strip answered the other way,
 * and for the opposite reason: a strip is a fixed row of five, a menu is a
 * list you read. What must never happen is the third option, a live-looking
 * item that does nothing.
 */
export type ContextMenuItem = {
  /** Also the `data-context-menu-item` value, so a test names what it clicks. */
  readonly id: string;
  readonly label: string;
  readonly onPick: () => void;
  /**
   * WHY it cannot act, or `null`/absent when it can. A sentence, not a
   * boolean: "disabled" with no reason is the failure this project keeps
   * finding in its own controls.
   */
  readonly unavailable?: string | null;
  /** The one item you must not press by mistake. */
  readonly danger?: boolean;
};

export type ContextMenuAt = { readonly x: number; readonly y: number };

/**
 * The panel's own box, in pixels, declared rather than measured.
 *
 * The flip has to happen BEFORE paint — a menu that opens off-screen and then
 * jumps is worse than one that opens in the wrong place — and before paint
 * there is nothing to measure: `getBoundingClientRect` on a freshly mounted
 * element reports zero in every browser and in happy-dom alike. So the width
 * is fixed (`w-[184px]` below is this number) and the height is computed from
 * the item count, which is the one thing the caller always knows.
 */
const MENU_WIDTH = 184;
const ITEM_HEIGHT = 30;
const MENU_PADDING = 8;
/** Kept off the exact edge, so the panel never looks like it is falling out. */
const EDGE_GUTTER = 6;

/** Where the panel really opens, given where it was asked to. */
export function placeMenu(
  at: ContextMenuAt,
  count: number,
  viewport: { readonly width: number; readonly height: number },
): { readonly left: number; readonly top: number } {
  const height = count * ITEM_HEIGHT + MENU_PADDING;
  // FLIP, THEN CLAMP. Flipping alone leaves a menu opened at x=3 with a
  // negative left; clamping alone leaves one opened near the right edge
  // hanging off it. Both, in that order, is the only pair that lands inside
  // the viewport for every input including a viewport smaller than the menu.
  const flippedLeft = at.x + MENU_WIDTH > viewport.width ? at.x - MENU_WIDTH : at.x;
  const flippedTop = at.y + height > viewport.height ? at.y - height : at.y;
  return {
    left: Math.max(EDGE_GUTTER, Math.min(flippedLeft, viewport.width - MENU_WIDTH - EDGE_GUTTER)),
    top: Math.max(EDGE_GUTTER, Math.min(flippedTop, viewport.height - height - EDGE_GUTTER)),
  };
}

export type ContextMenuProps = {
  /** Names the menu for a screen reader: "session actions", "turn actions". */
  readonly label: string;
  readonly items: readonly ContextMenuItem[];
  readonly at: ContextMenuAt;
  readonly onClose: () => void;
};

export function ContextMenu({ label, items, at, onClose }: ContextMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const actionable = items.filter((entry) => usable(entry));

  // The keyboard opens on the first item that can DO something. Landing it on
  // a disabled row would be landing it on a control that does nothing, which
  // is the thing the disabled row exists to avoid in the first place.
  useEffect(() => {
    const first = panelRef.current?.querySelector<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    );
    first?.focus();
  }, []);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null;
      if (target !== null && panelRef.current?.contains(target) === true) return;
      onClose();
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [onClose]);

  const walk = (delta: number) => {
    const buttons = [
      ...(panelRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? []),
    ];
    if (buttons.length === 0) return;
    const at_ = buttons.indexOf(document.activeElement as HTMLButtonElement);
    // A ring, as every menu is. From nowhere in particular, `down` means the
    // first item and `up` means the last.
    const next = at_ === -1 ? (delta > 0 ? 0 : buttons.length - 1) : at_ + delta;
    buttons[(next + buttons.length) % buttons.length]?.focus();
  };

  const onKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    // NORMALIZED, NOT RAW: this used to test `event.key === 'j'` / `'k'`
    // directly, which is the same hazard `keyboard/chords.ts` documents at
    // length for the chord grammar and this menu never inherited. With
    // CapsLock on, the browser hands back `'J'` / `'K'` with `shiftKey: false`
    // — indistinguishable at the character level from a real Shift press —
    // so neither branch matched, the arrows still worked, and the vim keys
    // this menu's own header advertises ("`j`/`k` walk beside the arrows")
    // went silently dead. `normalizeKey` folds a bare letter's case off
    // `shiftKey` instead, the fix already in force for the chord tables.
    const key = normalizeKey(event);
    if (key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (key === 'ArrowDown' || key === 'j') {
      event.preventDefault();
      walk(1);
      return;
    }
    if (key === 'ArrowUp' || key === 'k') {
      event.preventDefault();
      walk(-1);
    }
  };

  const placed = placeMenu(at, items.length, {
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
  });

  return (
    <div
      ref={panelRef}
      data-context-menu
      role="menu"
      aria-label={label}
      onKeyDown={onKeys}
      style={{ left: `${placed.left}px`, top: `${placed.top}px`, width: `${MENU_WIDTH}px` }}
      /* The same skin as the two menus already in `SessionList.tsx`, to the
         pixel: a third menu that looked like a different app would be the
         worst outcome of adding one. `z-40` rather than their `z-20` because
         this one is `fixed` and has to clear the sticky In band (`z-10`) and
         the pane chrome above it. */
      className="fixed z-40 flex flex-col rounded-[9px] border border-line-strong bg-card p-1 shadow-lg"
    >
      {items.map((entry) => {
        const reason = usable(entry) ? null : (entry.unavailable ?? 'unavailable');
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            data-context-menu-item={entry.id}
            disabled={reason !== null}
            {...(reason === null ? {} : { title: reason })}
            onClick={() => {
              entry.onPick();
              onClose();
            }}
            className={[
              'flex items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-left text-control',
              reason !== null
                ? // NOT `text-ink-faint`, which measures 3.27:1 and is this
                  // project's known-bad dim (issue 188). A disabled item still
                  // has to be READ -- its whole job is to carry a sentence --
                  // so it keeps `ink-quiet` and loses the pointer instead.
                  'cursor-not-allowed text-ink-quiet'
                : entry.danger
                  ? 'cursor-pointer text-failed hover:bg-failed/15'
                  : 'cursor-pointer text-ink-dim hover:bg-line-strong hover:text-ink',
            ].join(' ')}
          >
            {entry.label}
            {reason !== null && (
              // IN THE ACCESSIBLE NAME, not only in `title`. A `title` opens on
              // hover and on nothing else, and a disabled button is exactly
              // the control a pointer is least likely to rest on. The em-dash
              // separates it from the label when read aloud.
              <span className="sr-only"> — {reason}</span>
            )}
          </button>
        );
      })}
      {actionable.length === 0 && (
        // Never drawn by any caller today, and asserted rather than assumed:
        // a menu with nothing to offer is a popover the operator cannot get
        // out of except by Escape, so it says what it is.
        <span className="px-2 py-1.5 text-control text-ink-quiet">Nothing to do here</span>
      )}
    </div>
  );
}

const usable = (entry: ContextMenuItem): boolean =>
  entry.unavailable === undefined || entry.unavailable === null;
