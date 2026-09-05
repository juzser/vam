/**
 * A button's tooltip: what the button is called, and the keys that do the same
 * thing — read from the binding table, every time it opens.
 *
 * The reading is the whole point. The operator can rebind any action in
 * settings, so a hint carrying a chord written beside the button becomes a lie
 * the first time they do, and a wrong hint is worse than none: it sends a
 * keyboard-first user to press a key that does something else. This component
 * is therefore the THIRD reader of `effectiveBindings` — after `resolveChord`,
 * which decides what a keypress does, and the settings shortcut page, which
 * edits it — and holds no key of its own.
 *
 * Mode is not flattened either. `describeAction` returns `byMode` for the two
 * families whose meaning depends on the cursor mode; a caller that knows which
 * mode its button acts in passes it and gets that meaning, and a caller that
 * does not gets BOTH lines, named. Silently picking one is the same lie in a
 * smaller font.
 *
 * `Note` is the sibling of this component: same Radix machinery and the same
 * reason for it (a `title` never opens on keyboard focus), for free-text notes
 * that name no action.
 */

import * as Tooltip from '@radix-ui/react-tooltip';
import { createContext, type ReactNode, useContext } from 'react';
import { actionId, activeBindings, bindingChords, type KeyAction } from './chords.js';
import { CURSOR_MODES, type CursorMode, describeAction, MODE_TITLES } from './keysheet.js';

/** One row of a tooltip: the chords, and which mode they mean that in. */
export type TipLine = {
  /** The mode this reading is true in, or `null` for a mode-independent key. */
  readonly caption: string | null;
  /** The chords as the settings page writes them, joined for one line. */
  readonly keys: string;
};

/**
 * What the binding table says about an action, right now.
 *
 * Returns NOTHING for an unbound action — not an empty bracket, not a
 * placeholder, not the shipped default the operator just cleared. A caller
 * with no lines renders its label alone, which is the honest surface for a
 * button no key reaches.
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
 * True inside a `TipProvider`, so a tip does not mount a second one.
 *
 * Radix groups tooltips per provider: once one is open, its neighbours open
 * with no delay, which is the behaviour of a row of icon buttons the operator
 * is scanning. That grouping needs ONE provider above them all — but a tip
 * rendered on its own (a test, a panel mounted alone) must still work, so it
 * falls back to a private provider rather than throwing.
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
        {/* `side="top"` with an offset, and Radix flips it when the top is
            full: a tooltip that covers its own button, or sits under the
            pointer that summoned it, hides the thing it explains. */}
        <Tooltip.Content
          side="top"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex max-w-[280px] flex-col gap-1 rounded-[7px] border border-line-strong bg-raised px-2 py-1.5 text-[11px] leading-[1.45]"
        >
          {/* `text-ink` on `bg-raised`, never `text-ink-faint`: faint measures
              3.27:1 dark and 3.01:1 light, below the 4.5:1 floor, and a hint
              nobody can read is not a hint. */}
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
