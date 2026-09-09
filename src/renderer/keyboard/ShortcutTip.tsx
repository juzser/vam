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
 * opens on keyboard focus), for notes that name no action. The bindings come
 * from `chords.ts`, the labels from `keysheet.ts` — `describeAction` lives in
 * the second, not the first.
 *
 * TWO INVARIANTS IT DEPENDS ON AND DOES NOT ENFORCE.
 *
 * 1. `activeBindings()` is a module singleton, not React state, so a rebind
 *    lands in the next OPEN rather than in an open tip. Nothing here would
 *    notice; what makes that safe is that settings is a MODAL overlay, so no
 *    tip can be open while the keys are being edited. A shell that ever puts
 *    the keyboard editor and the chrome on screen together breaks it, and the
 *    fix is a subscription here — which is why the warning is stated AGAIN in
 *    `phone/PhoneShell.tsx`, the file a shell author actually opens: nobody
 *    re-hosting these panels has any reason to read this one.
 * 2. `Tooltip.Trigger asChild` adds NO element: the trigger is the caller's own
 *    button with a few attributes merged in. Wrapping is therefore invisible to
 *    descendant selectors — `group-hover/row:` reveals, a `button` rule setting
 *    a minimum touch target — which is what makes it safe to apply per button
 *    in panels other people are editing. `test/keyboard/shortcut-tip.test.tsx`
 *    holds that shape, so a change of primitive fails a test rather than
 *    quietly restructuring somebody's panel.
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
 * The ONE chord to print inside a control, beside its name — and nothing when
 * the action is unbound.
 *
 * One, not all of them, and that is the difference between the two surfaces
 * this module serves: a tooltip is a box of its own and can name every binding
 * an action holds, while an inline chip shares a 28px-high button with a label
 * in a pane the operator can drag narrow. `newSession` holds two chords out of
 * the box (`o` and `Mod-n`), and the footer cell that used to read `o` would
 * read `o or Mod-n` if it printed the same string the tip does.
 */
export function primaryChord(action: KeyAction, overrides = activeBindings()): string | null {
  return bindingChords(overrides, actionId(action))[0] ?? null;
}

/**
 * That chord as the chip itself. Lives here rather than in one panel because
 * three cells across two files print a key beside a control, and every one of
 * them was a literal before this: `/`, `o`, and the status bar's `?`.
 */
export function InlineChord({
  action,
  className,
}: {
  readonly action: KeyAction;
  readonly className: string;
}) {
  const keys = primaryChord(action);
  // `data-inline-chord` so a shell can suppress the whole family from CSS. The
  // phone does (`styles.css`): a chord is exactly the part of this hint a
  // touchscreen cannot use. Suppressed, never deleted -- the keydown listener
  // is not phone-gated, so a folio keyboard at 390px still fires every chord,
  // and the key sheet still documents them for that case.
  return keys === null ? null : (
    <span data-inline-chord className={className}>
      {keys}
    </span>
  );
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

/**
 * The chord, drawn as a chip and SAID as a shortcut.
 *
 * The chip's separation from the label is entirely visual -- a gap and a
 * border -- and the whole tip is the target of `aria-describedby`, so a
 * screen reader flattens it into the label. Measured, the Settings tip
 * announced as "Settings," : a name with a comma welded to it, where the
 * comma is the entire shortcut. "Search sessions/" and "Filter sessionsF"
 * were the same sentence.
 *
 * A border is not readable, so the word is spoken instead: the visible chip
 * goes `aria-hidden` and an `sr-only` twin carries "shortcut: <chord>". The
 * chord itself is `chordText`'s output verbatim in both, so the two surfaces
 * cannot drift and neither one prettifies what the key sheet spells.
 */
function Chip({ keys }: { readonly keys: string }) {
  return (
    <>
      <span
        data-tip-keys
        aria-hidden="true"
        className="shrink-0 rounded-[4px] border border-line-strong px-1 py-px font-mono text-[10px] text-ink-dim"
      >
        {keys}
      </span>
      <span className="sr-only">{` shortcut: ${keys}`}</span>
    </>
  );
}

export function ShortcutTip({
  label,
  action,
  mode,
  children,
}: {
  /** What the button is called — its own name, not the sheet's caption. */
  readonly label: string;
  /** Omitted for a control no chord reaches — the tooltip is then the label. */
  readonly action?: KeyAction;
  /** The mode the button acts in, where that changes what the keys mean. */
  readonly mode?: CursorMode;
  readonly children: ReactNode;
}) {
  const lines = shortcutLines(action, mode);
  // One line, not two, EXCEPT where a caption is doing real work: a
  // mode-dependent action already reads as "caption  keys" per row, and
  // folding the label in too would overflow the 280px box for anything but a
  // short label. So only the unambiguous case (no caption) merges; a
  // mode-qualified action keeps the label as a header above its row(s).
  const merge = lines.length <= 1 && (lines[0]?.caption ?? null) === null;
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
          className="z-50 flex max-w-[280px] flex-col gap-1 rounded-[7px] border border-line-tip bg-raised px-2 py-1.5 text-[11px] leading-[1.45] shadow-tip"
        >
          {/* ink on raised (14.9:1 dark, 15.5:1 light) and ink-dim (6.7:1 in
              both), never ink-faint: faint measures 3.27 / 3.01, under AA. */}
          {merge ? (
            <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span className="min-w-0 flex-1 text-ink">{label}</span>
              {lines[0] === undefined ? null : <Chip keys={lines[0].keys} />}
            </span>
          ) : (
            <>
              <span className="text-ink">{label}</span>
              {lines.map((line) => (
                <span key={line.caption ?? line.keys} className="flex items-baseline gap-1.5">
                  {line.caption === null ? null : (
                    <span className="min-w-0 flex-1 text-ink-dim">{line.caption}</span>
                  )}
                  <Chip keys={line.keys} />
                </span>
              ))}
            </>
          )}
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
