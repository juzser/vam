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
 * Mode is not flattened either: `describeAction` returns `byMode` for a family
 * whose meaning depends on the cursor mode, so a caller that knows its mode
 * gets that meaning and one that does not gets BOTH, named. Picking one
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
import { createContext, Fragment, type ReactNode, useContext } from 'react';
import {
  actionId,
  activeBindings,
  applePlatform,
  bindingChords,
  chordSegments,
  chordSymbols,
  isSelectOnlyChord,
  type KeyAction,
  parseChord,
} from './chords.js';
import { CURSOR_MODES, type CursorMode, describeAction, MODE_TITLES } from './keysheet.js';

/** One row of a tooltip: the chords, and the mode that reading is true in
 *  (`null` for a key that means the same in both). */
type TipLine = {
  readonly caption: string | null;
  readonly keys: string;
  /**
   * The SAME chords `keys` above already rendered into one sentence, kept
   * here raw and unjoined — what `Chip` needs to draw each one through its
   * own `ChordGlyphs` call, one per chord, joined by a literal " or " that a
   * pre-joined string has no seam left to insert. `keys` stays the rendering
   * for the one consumer that only ever wanted a sentence: the `sr-only`
   * twin beside the chip.
   */
  readonly chords: readonly string[];
};

/**
 * What the binding table says about an action, right now — and NOTHING for an
 * unbound one: not an empty bracket, not a placeholder, not the shipped
 * default the operator just cleared. A caller with no lines renders its label
 * alone, the honest surface for a button no key reaches.
 *
 * AND THE CHORDS ARE JOINED ONLY WHERE THEY MEAN THE SAME THING — which they
 * stopped doing the day `pickView` grew a one-key spelling.
 *
 * Its two slots are not alike: `Ctrl-Alt-1` reaches the Response view from
 * anywhere, and a bare `1` is text wherever there is a caret and stands down
 * (`isSelectOnlyChord`, `chords.ts`). Joined, this tip read "Ctrl-Alt-1 or 1"
 * with nothing to say that half of it does nothing in the mode the operator
 * may be in — the same lie the key sheet had to be taught to split, one
 * surface over, and the reason this file's own header calls picking one
 * silently "the same lie in a smaller font".
 *
 * So a Select-only spelling gets a LINE of its own, captioned with the mode it
 * is true in, and a caller that has declared itself in Insert is not shown it
 * at all. An action with no Select-only chord — which is every other action in
 * the grammar — takes the unchanged path above it and still prints one joined
 * line.
 */
export function shortcutLines(
  action: KeyAction | undefined,
  mode: CursorMode | undefined,
  overrides = activeBindings(),
  mac: boolean = applePlatform(),
): readonly TipLine[] {
  if (action === undefined) {
    return [];
  }
  const chords = bindingChords(overrides, actionId(action));
  if (chords.length === 0) {
    return [];
  }
  const { label, byMode } = describeAction(action);
  // THE TOKENS DECIDE, THE SYMBOLS ARE PRINTED. Every judgement below is made
  // against the spelling the grammar holds -- `isSelectOnlyChord` parses one,
  // and a rendered `⌘K` parses as nothing at all -- and `chordSymbols` is
  // applied at the LAST step, where the string stops being data and becomes
  // what the operator reads. `mac` is a parameter for `chords.ts`'s reason:
  // both platforms have to be assertable from one test run.
  const say = (list: readonly string[]) =>
    list.map((chord) => chordSymbols(chord, mac)).join(' or ');
  const selectOnly = chords.filter((chord) => isSelectOnlyChord(parseChord(chord)));
  const modes = mode === undefined ? CURSOR_MODES : [mode];
  if (selectOnly.length === 0) {
    const keys = say(chords);
    return byMode === null
      ? [{ caption: null, keys, chords }]
      : modes.map((each) => ({
          caption: `${MODE_TITLES[each]} · ${byMode[each]}`,
          keys,
          chords,
        }));
  }
  const anywhere = chords.filter((chord) => !selectOnly.includes(chord));
  const lines: TipLine[] = [];
  if (anywhere.length > 0) {
    const keys = say(anywhere);
    lines.push(
      ...(byMode === null
        ? [{ caption: null, keys, chords: anywhere }]
        : modes.map((each) => ({
            caption: `${MODE_TITLES[each]} · ${byMode[each]}`,
            keys,
            chords: anywhere,
          }))),
    );
  }
  // Shown unless the caller has said it is in Insert, where the key is not
  // this action's at all. `mode === undefined` means "I do not know", and the
  // honest answer to that is both lines.
  if (mode !== 'insert') {
    lines.push({
      caption: `${MODE_TITLES.select} · ${byMode === null ? label : byMode.select}`,
      keys: say(selectOnly),
      chords: selectOnly,
    });
  }
  return lines;
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
 * ONE CHORD, PAINTED — every surface that draws a chip rather than only
 * SAYING one (`InlineChord` below, the tooltip's own `Chip`, `KeySheet.tsx`,
 * the status bar's `?` hint) reaches for this instead of `chordSymbols`
 * directly, so every one of them paints the identical rendering rather than
 * re-deriving it — `chordSegments` (`chords.ts`) is the one glyph table this
 * and `chordSymbols` both read, and this component is now the one PAINTED
 * form the whole app uses, the Send key option included (`SettingsOverlay.
 * tsx`).
 *
 * THE SEND KEY OPTION'S OWN LOOK — BUT THAT LOOK IS A FONT, MEASURED, NOT
 * ONLY A SIZE. Pull request 468 painted a modifier glyph at `text-[1.3em]`,
 * one size larger than the key beside it, on the operator's OWN finding that
 * a `⇧⌘P` chip read cramped at one size. #471 answered a newer ask — "the
 * icons in the Send key option under Sessions settings are the best" — by
 * dropping the wrapper span entirely, so every glyph fell back to the chip's
 * own ambient font at the key's own size.
 *
 * That held for `SettingsOverlay.tsx`'s Send key buttons themselves — their
 * ambient font already IS the body sans stack (`text-control`, no
 * `font-mono`) — but the operator kept seeing a difference everywhere else,
 * and a real Chromium measurement (`e2e/chord-symbol-shots.mjs`) found why:
 * every OTHER chip in this app (`Chip` below, `InlineChord`, `KeySheet.tsx`,
 * `CommandPalette.tsx`, the phone's key strip) is `font-mono`, and Geist
 * Mono draws a noticeably narrower ⌘ than Geist does at the same size — the
 * Send key option's own ⇧ measured ~11.8px wide at 12px, a tooltip chip's
 * ⌘ ~6.6px wide at 11px in the mono face. Thin next to the reference is
 * exactly what was reported.
 *
 * SO THE SPAN RETURNS — FOR GLYPH SEGMENTS ONLY. `chordSegments` tags which
 * segment is one of Apple's own pictograms (`chords.ts`'s `glyph` field): a
 * modifier on a Mac, or a named key this table draws as one (⏎ ⎋ ⇥ ⌫ an
 * arrow, …). Exactly those are wrapped in the body sans stack — the SAME
 * face the Send key option's ambient font already gives its own buttons, so
 * that button's look never moves. A bare letter or digit (`P`, `1`) is not a
 * pictogram and stays unwrapped, inheriting whatever font the chip around it
 * chose — "letters/digits keep the chip's own font" is the other half of
 * this ask. Off a Mac nothing is tagged a glyph at all, so nothing is
 * wrapped there either: the word spellings (`Ctrl+Shift+P`) are untouched.
 *
 * `.textContent` OF THE RESULT IS STILL `chordSymbols(chord, mac)`, CHARACTER
 * FOR CHARACTER — the span changes what paints, never what a screen reader
 * or a `.textContent` comparison sees. `test/keyboard/shortcut-tip.test.tsx`
 * holds the two to that agreement, so a hand-rolled separator here can never
 * drift from the sentence `chordSymbols` still owes a tooltip's `sr-only`
 * twin.
 */
export function ChordGlyphs({
  chord,
  mac = applePlatform(),
}: {
  readonly chord: string;
  readonly mac?: boolean;
}) {
  const segments = chordSegments(chord, mac);
  const sep = mac ? ' ' : '+';
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={segment.text}>
          {index > 0 ? sep : null}
          {segment.glyph ? <span className="font-sans">{segment.text}</span> : segment.text}
        </Fragment>
      ))}
    </>
  );
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
  const chord = primaryChord(action);
  // `data-inline-chord` so a shell can suppress the whole family from CSS. The
  // phone does (`styles.css`): a chord is exactly the part of this hint a
  // touchscreen cannot use. Suppressed, never deleted -- the keydown listener
  // is not phone-gated, so a folio keyboard at 390px still fires every chord,
  // and the key sheet still documents them for that case.
  return chord === null ? null : (
    <span data-inline-chord className={className}>
      <ChordGlyphs chord={chord} />
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
 * PAINTED half draws each chord through `ChordGlyphs` (the Send key option's
 * own flat, one-size rendering — see that component's doc comment), joined
 * by a literal " or " for the rare action that holds two; the SPOKEN half
 * stays `keys`, `shortcutLines`' own pre-joined sentence, so neither surface
 * prettifies what the key sheet spells and the two can never name a
 * different chord.
 */
function Chip({ keys, chords }: { readonly keys: string; readonly chords: readonly string[] }) {
  return (
    <>
      <span
        data-tip-keys
        aria-hidden="true"
        className="shrink-0 rounded-[4px] border border-on-tip-line px-1 py-px font-mono text-meta text-on-tip-dim"
      >
        {chords.map((chord, index) => (
          <Fragment key={chord}>
            {index > 0 ? ' or ' : null}
            <ChordGlyphs chord={chord} />
          </Fragment>
        ))}
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
          className="z-50 flex max-w-[280px] flex-col gap-1 rounded-[7px] bg-tip px-2 py-1.5 text-control shadow-tip"
        >
          {/* THE TIP IS ITS OWN SURFACE and carries its own inks. `on-tip`
              (13.92:1 dark, 15.55:1 light) and `on-tip-dim` (6.89 / 6.78) --
              the readings `ink` and `ink-dim` had on the `raised` fill this
              used to have, re-solved against it. A page ink in here would be
              tuned for the surface BEHIND the tip, which the tip is now the
              inverse of, so `text-ink-dim` would land a pale grey on a pale
              fill. There is no third ink: nothing in a tip is decoration. */}
          {merge ? (
            <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span className="min-w-0 flex-1 text-on-tip">{label}</span>
              {lines[0] === undefined ? null : (
                <Chip keys={lines[0].keys} chords={lines[0].chords} />
              )}
            </span>
          ) : (
            <>
              <span className="text-on-tip">{label}</span>
              {lines.map((line) => (
                <span key={line.caption ?? line.keys} className="flex items-baseline gap-1.5">
                  {line.caption === null ? null : (
                    <span className="min-w-0 flex-1 text-on-tip-dim">{line.caption}</span>
                  )}
                  <Chip keys={line.keys} chords={line.chords} />
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
