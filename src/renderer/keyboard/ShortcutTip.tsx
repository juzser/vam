/**
 * A button's tooltip: what the button is called, and the keys that do the same
 * thing — read from the binding table every time it opens.
 *
 * The reading is the point. The operator can rebind any action in settings, so
 * a chord written beside the button becomes a lie the first time they do, and a
 * wrong hint is worse than none. This is therefore the THIRD reader of
 * `effectiveBindings` — after `resolveChord` and the settings page — and holds
 * no key of its own.
 *
 * Mode is not flattened either: `describeAction` returns `byMode` for the two
 * families whose meaning depends on the cursor mode, so a caller that knows its
 * mode gets that meaning and one that does not gets BOTH, named. Picking one
 * silently is the same lie in a smaller font.
 *
 * `Note` is its sibling: same Radix machinery, same reason (a `title` never
 * opens on keyboard focus), for notes that name no action.
 */

import * as Tooltip from '@radix-ui/react-tooltip';
import { createContext, type ReactNode, useContext } from 'react';
import { actionId, activeBindings, bindingChords, type KeyAction } from './chords.js';
import { CURSOR_MODES, type CursorMode, describeAction, MODE_TITLES } from './keysheet.js';

/** One row of a tooltip: the chords, and the mode that reading is true in
 *  (`null` for a key that means the same in both). */
export type TipLine = {
  readonly caption: string | null;
  readonly keys: string;
};

/**
 * What the binding table says about an action, right now — and NOTHING for an
 * unbound one: not an empty bracket, not a placeholder, not the shipped
 * default the operator just cleared. A caller with no lines renders its label
 * alone, the honest surface for a button no key reaches.
 */
export function shortcutLines(
  action: KeyAction | undefined,
  mode: CursorMode | undefined,
  overrides = activeBindings(),
): readonly TipLine[] {
  if (action === undefined) {
    return [];
  }
  const keys = bindingChords(overrides, actionId(action)).join(' or ');
  if (keys === '') {
    return [];
  }
  const { byMode } = describeAction(action);
  if (byMode === null) {
    return [{ caption: null, keys }];
  }
  const modes = mode === undefined ? CURSOR_MODES : [mode];
  return modes.map((each) => ({ caption: `${MODE_TITLES[each]} · ${byMode[each]}`, keys }));
}

/**
 * True inside a `TipProvider`, so a tip does not mount a second one. Radix
 * groups per provider — once one tip is open its neighbours open with no
 * delay — and that needs ONE provider above them all; a tip rendered alone
 * (a test, a panel mounted by itself) falls back to a private one.
 */
const Grouped = createContext(false);

export function TipProvider({ children }: { readonly children: ReactNode }) {
  return (
    <Grouped value={true}>
      <Tooltip.Provider delayDuration={450} skipDelayDuration={400}>
        {children}
      </Tooltip.Provider>
    </Grouped>
  );
}

export function ShortcutTip({
  label,
  action,
  mode,
  children,
}: {
  /** What the button is called. Not derived: the sheet's action captions name
      the action for the sheet's reader, and a button says its own name. */
  readonly label: string;
  /** Omitted for a control no chord reaches — the tooltip is then the label. */
  readonly action?: KeyAction;
  /** The mode the button acts in, where that changes what the keys mean. */
  readonly mode?: CursorMode;
  readonly children: ReactNode;
}) {
  const lines = shortcutLines(action, mode);
  const body = (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        {/* Above the button with an offset, flipped by Radix when the top is
            full: a tip that covers its trigger hides what it explains. */}
        <Tooltip.Content
          side="top"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex max-w-[280px] flex-col gap-1 rounded-[7px] border border-line-strong bg-raised px-2 py-1.5 text-[11px] leading-[1.45]"
        >
          {/* ink on raised (14.9:1 dark, 15.5:1 light) and ink-dim (6.7:1 in
              both), never ink-faint: faint measures 3.27 / 3.01, under AA. */}
          <span className="text-ink">{label}</span>
          {lines.map((line) => (
            <span key={line.caption ?? line.keys} className="flex items-baseline gap-1.5">
              {line.caption === null ? null : (
                <span className="min-w-0 flex-1 text-ink-dim">{line.caption}</span>
              )}
              <span
                data-tip-keys
                className="rounded-[4px] border border-line-strong px-1 py-px font-mono text-[10px] text-ink-dim"
              >
                {line.keys}
              </span>
            </span>
          ))}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
  return useContext(Grouped) ? (
    body
  ) : (
    <Tooltip.Provider delayDuration={450}>{body}</Tooltip.Provider>
  );
}
