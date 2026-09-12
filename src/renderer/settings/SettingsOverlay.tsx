/**
 * `,` and the gear — the settings the operator already had, made editable.
 *
 * Every section is wiring rather than invention: the theme is `prefs.theme`
 * and `applyTheme`, which shipped long ago with one toggle as their whole
 * interface; and the keyboard reference is
 * `buildKeySheet()`, the same generator the `?` sheet renders, so a row here
 * can only exist because a binding exists.
 *
 * The overlay idiom is `CommandPalette`'s and `KeySheet`'s, deliberately not a
 * third one: a scrim that is a real button, Escape caught HERE as well as on
 * the window (the window listener ignores keys typed in an input, and this
 * overlay has one), and the keyboard handed back to wherever it came from on
 * close.
 *
 * Nothing here writes to the document or to storage. It calls `onChange` with
 * the next `Prefs` and `Canvas.tsx`'s single `savePrefs` does both, so the
 * theme still has exactly one path onto `<html>`.
 */

import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PROVIDERS, resolveProvider } from '../../shared/providers.js';
import { t } from '../i18n/strings.js';
import {
  bindingClashes,
  bindKey,
  clearBindings,
  isReserved,
  type KeyBindings,
  MAX_BINDINGS,
  NO_BINDINGS,
  newClashes,
  normalizeKey,
} from '../keyboard/chords.js';
import { type BindingRow, buildBindingSheet } from '../keyboard/keysheet.js';
import { usePhoneViewport } from '../phone/viewport.js';
import {
  applyPaletteTemplate,
  PALETTE_TEMPLATES,
  templatePalette,
} from '../prefs/palette-templates.js';
import {
  clearPalette,
  clearPaletteColor,
  type EffectiveTheme,
  OUT_FONT_SIZE_MAX,
  OUT_FONT_SIZE_MIN,
  PALETTE_TOKENS,
  type Prefs,
  paletteFor,
  paletteValue,
  setDefaultProvider,
  setFocusView,
  setKeyBindings,
  setOutFontSize,
  setPaletteColor,
  setPromptSubmitKey,
  setTheme,
  stylesheetPaletteValue,
  type Theme,
} from '../prefs/prefs.js';
import { type PromptSubmitKey, SUBMIT_KEY_LABELS } from '../prefs/submit-key.js';
import { desktopRemoteApi, RemotePanel } from './RemotePanel.js';
import { SECTIONS, type SectionId, shortcutSections } from './sections.js';

export type SettingsOverlayProps = {
  readonly prefs: Prefs;
  /**
   * The theme ON SCREEN, resolved — which is the theme whose colours this
   * overlay edits. Passed in rather than derived from `prefs.theme` for the
   * one case that makes the distinction real: under `system` the appearance
   * changes with no write to `prefs`, and `Canvas.tsx` already holds the
   * resolved value that the sidebar's label reads. A second resolution here
   * would be a second idea of which theme is showing, and the two disagree the
   * first time the OS flips with the overlay open.
   */
  readonly theme: EffectiveTheme;
  readonly onChange: (next: Prefs) => void;
  readonly onClose: () => void;
  /**
   * Which section is on screen the moment the overlay opens. Absent means
   * `appearance`, where the overlay has opened since before sections existed
   * (see the note on `SECTIONS`) — the Remote icon is the one caller that
   * needs to land somewhere else, so it is optional rather than threading a
   * fifth required prop through every other opener.
   */
  readonly initialSection?: SectionId;
};

const THEMES: readonly Theme[] = ['dark', 'light', 'system'];

/**
 * The two modes, in the order they escalate: what the column already draws,
 * then what it folds. Hard-coded here beside the row that draws them, the way
 * `THEMES` is -- three words in a union are not a table.
 */

/**
 * The two keys, shipped default first. Hard-coded beside the row that draws
 * them, like `THEMES` above -- two words in a union
 * are not a table. What each one is CALLED is not decided here: that is
 * `SUBMIT_KEY_LABELS`, which the composer's own caption reads as well, so the
 * picker and the box cannot come to spell one key two ways.
 */
const SUBMIT_KEYS: readonly PromptSubmitKey[] = ['enter', 'shift-enter'];

/** Which slot is listening for a keystroke, spelled as one value so opening a
 *  second capture box closes the first by construction. */
/**
 * `scope` is the section the armed box is IN, and it exists because one
 * binding is now drawn in two places: a mode-dependent shortcut appears under
 * Select and under Insert (`shortcutSections`). Without it, arming a box would
 * arm both copies -- two inputs, each autofocusing, fighting for the next
 * keystroke. The binding is still one binding: editing either copy rebinds it
 * everywhere, which is the truth about a key that has two meanings and one
 * chord.
 */
type Capturing = { readonly id: string; readonly slot: number; readonly scope: string } | null;

/**
 * vam has no focus-ring idiom, and the one `focus-visible` in the renderer
 * (`TerminalTab.tsx`) draws `line-strong`, which is 1.25:1 on `panel` in dark —
 * invisible in the default theme. `ink` is 14.9 / 17.7 there and clears on
 * every fill this dialog uses. The offset matters: flush against a tile's own
 * border, an outline reads as a thicker border rather than as a cursor.
 */
/**
 * IS THERE A CHOICE HERE AT ALL? Read from the table rather than assumed, and
 * it is what decides whether this section OFFERS a provider or REPORTS one.
 *
 * `PROVIDERS` has one row and will until a second source exists in main
 * (`src/shared/providers.ts` argues why). A segmented picker over one row is a
 * control that cannot act: its single button is `aria-pressed` from the first
 * paint, it hovers, it takes the keyboard, and clicking it calls `onChange`
 * with a `Prefs` identical to the one it was handed. `RemotePanel`'s header, in
 * this same directory, states the rule it breaks — "A CONTROL THAT CANNOT ACT
 * IS NOT DRAWN AS ONE" — and `DetailPanel`'s provider button says the same
 * thing in the other spelling, "ABSENT, NOT DISABLED".
 *
 * So the picker is CONDITIONAL, not deleted. The day a second provider ships
 * this is `true` and the segmented control is back, unchanged, with no edit
 * here; `test/settings/provider-double.test.tsx` mocks that table and proves
 * it. Withdrawing the control does not withdraw the ANSWER: the label and the
 * command it runs are what the operator came to this section to read, and both
 * stay.
 */
const CAN_CHOOSE_PROVIDER = PROVIDERS.length > 1;

/**
 * Why the list is one item long, said where the operator can read it rather
 * than only in a source comment. Codex CLI and Cursor CLI are on the roadmap
 * and neither is implemented: a provider is not a command to spawn, it is a
 * source that can read back what that command is doing, and vam has one of
 * those. Offering a provider that cannot start would be worse than offering a
 * single honest choice.
 *
 * TWO SENTENCES FOR TWO STATES, because "the only one offered" describes a
 * picker and there is none while this is the one-row world: what the operator
 * needs told is that nothing is being withheld from them.
 */
const PROVIDER_HINT = CAN_CHOOSE_PROVIDER
  ? 'the agent o starts in a new session.'
  : 'the agent o starts in a new session. Claude Code is the only one vam can ' +
    'read back today, so there is nothing to choose yet.';

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

const tabId = (id: SectionId) => `vam-settings-tab-${id}`;
const panelId = (id: SectionId) => `vam-settings-panel-${id}`;

/** The two-column form's breakpoint, one spelling shared by the media query and
 *  the Tailwind `md:` classes it agrees with. */
const WIDE_NAV = '(min-width: 768px)';

/**
 * Which nav to render — not which to hide.
 *
 * `hidden md:flex` alone would leave BOTH markups in the document and announce
 * every section twice; `inert` is not available in this React version, so the
 * honest fix is to render exactly one. A missing `matchMedia` (a jsdom-ish
 * environment) yields the wide form, the same safe direction `prefs.ts` takes.
 */
function useWideNav(): boolean {
  const [wide, setWide] = useState(() => globalThis.matchMedia?.(WIDE_NAV).matches ?? true);
  useEffect(() => {
    const query = globalThis.matchMedia?.(WIDE_NAV);
    if (!query) return;
    const sync = () => setWide(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return wide;
}

export function SettingsOverlay({
  prefs,
  theme,
  onChange,
  onClose,
  initialSection,
}: SettingsOverlayProps) {
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  // Component state, not a pref: which pane you last had open is not a setting,
  // and persisting it would open the overlay somewhere different every time.
  // Read once, at mount — the overlay is only ever mounted fresh (`Canvas.tsx`
  // conditionally renders it), so there is no later prop change to track.
  const [section, setSection] = useState<SectionId>(initialSection ?? 'appearance');
  const [capturing, setCapturing] = useState<Capturing>(null);
  const [message, setMessage] = useState('');
  const wide = useWideNav();
  /** Is this the phone shell's width? Read for COPY, never for layout — the
   *  dialog's own breakpoint is `useWideNav` above, and a second reader of one
   *  fact is how two of them disagree. */
  const phone = usePhoneViewport();
  /** Read off the map on screen, not remembered from a write: the overlay can
   *  be OPENED over a contested map, which is the case no write path sees. */
  const clashes = bindingClashes(prefs.keyBindings);

  /**
   * EVERY write to the binding map, judged on the WHOLE map it would produce.
   *
   * Audit F3's fix, and it is here rather than in each caller because the
   * defect WAS a caller that had no check: the capture box judged the one key
   * it was handed, and the reset button judged nothing, so resetting `rename`
   * could hand `r` back to it while `icon` held it — after which `r` invoked
   * `icon` and the editor went on printing it for `rename`. Reset cannot be
   * fixed by checking a keystroke, because the key it restores is a DEFAULT
   * the operator never typed; the only question that covers both acts is the
   * one about the resulting map.
   *
   * REFUSED, NOT RESOLVED. The alternative — take the key and unbind whoever
   * held it — is the failure the capture path already argues against: it
   * leaves the other action silently keyless, discoverable only by pressing
   * its key and watching nothing happen. A refusal is visible in the moment,
   * names the action in the way, and leaves both exits open: move that action
   * off the key, or "reset shortcuts", which can never be refused because the
   * shipped grammar contests nothing.
   */
  const bind = (next: KeyBindings, editing: string | null) => {
    const clash = newClashes(prefs.keyBindings, next)[0];
    if (clash !== undefined) {
      const other = clash.winner === editing ? (clash.shadowed[0] ?? clash.winner) : clash.winner;
      setMessage(
        `"${clash.chord}" already does: ${labelFor(next, other)} — move that first, or use "reset shortcuts"`,
      );
      return;
    }
    setCapturing(null);
    setMessage('');
    onChange(setKeyBindings(prefs, next));
  };

  /**
   * One captured keystroke, judged.
   *
   * `preventDefault` is not politeness: the whole point of this box is that the
   * keystroke IS the value, so it must not also reach the page — and
   * `stopPropagation` keeps Escape from reaching the dialog's own handler,
   * which would close the settings panel instead of cancelling the capture.
   *
   * A refusal keeps the box open and says why. Silence would leave the operator
   * pressing a key that does nothing, with no way to tell a reserved key from
   * a taken one.
   */
  const capture = (row: BindingRow, slot: number, event: React.KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const key = normalizeKey(event);
    if (key === null) {
      // A bare Shift or Meta is a hand moving, not a keystroke.
      return;
    }
    if (key === 'Escape') {
      setCapturing(null);
      setMessage('');
      return;
    }
    if (isReserved(key)) {
      setMessage(
        `"${key}" is reserved — Escape cancels this capture, g/y/z open chords, Mod-[ leaves the prompt box`,
      );
      return;
    }
    // The conflict check that used to stand here asked only about `key`, and
    // was the half of the editor that made the missing check on reset look
    // like protection. `bind` asks about the whole resulting map, which
    // answers this case and the one it could not see.
    bind(bindKey(prefs.keyBindings, row.id, slot, key), row.id);
  };

  /**
   * Section changes take focus to the nav item, never into the panel: with
   * automatic activation, arrowing through four sections would throw the cursor
   * into four different panels. It is also not optional for `Ctrl-Tab` — the
   * panel the cursor was in has just become `hidden`, and focus inside a hidden
   * subtree is no focus at all.
   */
  const go = (next: SectionId) => {
    setSection(next);
    dialog.current?.querySelector<HTMLElement>(`[data-settings-nav-item="${next}"]`)?.focus();
  };

  const step = (delta: number) => {
    const at = SECTIONS.findIndex((entry) => entry.id === section);
    const next = SECTIONS[(at + delta + SECTIONS.length) % SECTIONS.length];
    if (next !== undefined) {
      go(next.id);
    }
  };

  useEffect(() => {
    const returnTo = document.activeElement;
    // The nav is the top of the reading order and the first thing to steer;
    // Escape works from anywhere in the dialog, so the close button gains
    // nothing from being first.
    dialog.current?.querySelector<HTMLElement>('[data-settings-nav-item]')?.focus();
    return () => {
      if (returnTo instanceof HTMLElement && document.contains(returnTo)) {
        returnTo.focus();
      }
    };
  }, []);

  return (
    <div
      data-settings-overlay
      data-overlay-host
      ref={dialog}
      role="dialog"
      // Not plain "settings": the sidebar's gear already owns that accessible
      // name, and while this is open the two collide — `getByLabelText`
      // ("found multiple") and a screen reader alike.
      aria-label="settings panel"
      aria-modal="true"
      className="absolute inset-0 z-50 flex items-start justify-center pt-16"
      onKeyDown={(event) => {
        // Two Escapes, in the order the operator meets them: the first cancels
        // an armed capture, the second closes the dialog.
        //
        // This branch is the DURABLE half of the fix, not the load-bearing
        // one — `autoFocus` on the capture box is what actually made Escape
        // reach React at all, and with focus in the box the box's own
        // `stopPropagation` gets here first, so this line rarely runs today. It
        // stays because it is what makes the surface survive the NEXT focus
        // bug, which is precisely the bug that shipped. Deleting it as dead
        // code would be right about the code and wrong about the reason.
        if (event.key === 'Escape') {
          event.preventDefault();
          if (capturing !== null) {
            setCapturing(null);
            setMessage('');
            return;
          }
          onClose();
          return;
        }
        // The section switch that survives a text field — and this panel has
        // one today and gains colour and key-capture fields beside it. A bare
        // `j`/`k` that stops working depending on where the cursor sits is
        // worse than no chord at all.
        if (event.key === 'Tab' && event.ctrlKey) {
          event.preventDefault();
          step(event.shiftKey ? -1 : 1);
        }
      }}
    >
      <button
        type="button"
        aria-label="close settings"
        className="absolute inset-0 cursor-default bg-ground/70"
        onMouseDown={onClose}
      />
      {/* Fixed height, not `max-h`: with a nav column, a box that resizes per
          section makes the nav jump under the cursor between a short pane and a
          long one. One height, one nav position; the panel scrolls. */}
      <div className="relative flex h-[min(600px,80vh)] w-[min(880px,94vw)] flex-col overflow-hidden rounded-md border border-line bg-panel">
        <div className="flex h-[38px] flex-none items-center gap-2 border-line border-b px-3">
          {/* The dialog's own name, in the rank above the panel heading and
              wearing the same treatment: uppercase with tracking, which this
              file already uses for the nav's "Sections" eyebrow. One word,
              named once, never scanned against siblings. */}
          <h2
            data-settings-heading
            className="font-semibold text-body text-ink uppercase tracking-[0.07em]"
          >
            {t('settings.title')}
          </h2>
          {/* `ink-faint` measures 3.44 / 3.46 against `panel` — it fails 4.5:1
              in both themes, and every hint in this overlay used to wear it.

              This is the only line on the surface visible regardless of scroll
              position and of which section is open, so it is where the two
              Escapes get named, in the order they will happen. `polite`
              announces the mode change without stealing the keystroke. */}
          <span role="status" aria-live="polite" className="vam-sentence text-control text-ink-dim">
            {capturing === null
              ? t('settings.status.stored')
              : 'waiting for a key — Esc cancels, Esc again closes'}
          </span>
          <span className="flex-1" />
          {/* THE KEY ON THE DESKTOP, THE ACT ON A PHONE.
              This button's entire accessible name was `Esc`. It closes when
              tapped, which is what made it worse than a dead control: it reads
              as a keyboard HINT, so a finger looks past it for a real close and
              finds none -- the scrim closes too and says nothing either. The
              chord is real on a desktop and stays printed there; at phone width
              the glyph is the session bar's own `×`, and the NAME comes from
              the catalogue on both, so a screen reader stops being handed a
              keystroke where it asked what the button does. */}
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label={t('settings.close')}
            className={`vam-tap rounded border border-line px-2 py-0.5 text-ink-dim text-control ${FOCUS_RING}`}
          >
            {phone ? '×' : 'Esc'}
          </button>
        </div>

        {/* `min-h-0` or the panel's scroll container will not shrink inside the
            flex column, and the fixed height above becomes an overflow. */}
        <div className="flex min-h-0 flex-1">
          {wide ? <SectionRail section={section} onGo={go} onStep={step} /> : null}
          {/* Named, because it is the scrollport a `sticky` child measures
              against and the box an e2e guard has to compare a message to:
              "the refusal is painted" and "the refusal is where the operator
              is looking" are different questions, and the second one needs
              this element. */}
          <div data-settings-scroll className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {wide ? null : <SectionStrip section={section} onGo={go} onStep={step} />}

            <Panel
              id="appearance"
              active={section === 'appearance'}
              hint={t('settings.appearance.hint')}
            >
              <Block
                label={t('settings.appearance.theme.label')}
                hint={t('settings.appearance.theme.hint')}
              >
                <div className="flex gap-1">
                  {THEMES.map((choice) => (
                    <Choice
                      key={choice}
                      label={choice}
                      selected={prefs.theme === choice}
                      onPick={() => onChange(setTheme(prefs, choice))}
                    />
                  ))}
                </div>
              </Block>

              {/* TEMPLATES FIRST, SWATCHES SECOND — coarse to fine, which is
                  the order the operator asked for ("at the top") and also the
                  order the two controls relate in: a template writes every
                  swatch below at once, and the swatches then edit what it
                  wrote. NOT above `theme`, because a template applies INTO a
                  theme -- choosing which screen you are on has to come first,
                  or both rows under it are editing a palette you cannot see.

                  EACH BUTTON SHOWS ITS OWN COLOURS rather than only its name.
                  Three discs -- pane, card, In bubble -- are the three surfaces
                  the operator has actually reported on, drawn in the values the
                  press will apply, so the preview IS the palette rather than a
                  picture of one. They are `aria-hidden` and the button keeps a
                  written name, because a colour is not a label. */}
              <Block
                label={t('settings.appearance.templates.label')}
                hint={t('settings.appearance.templates.hint', { theme })}
              >
                <div className="flex flex-wrap gap-1.5">
                  {PALETTE_TEMPLATES.map((template) => {
                    const values = templatePalette(template.id, theme);
                    // THE `default` CHIP HAS NO COLOURS OF ITS OWN -- pressing
                    // it deletes the bucket so the cascade falls back to
                    // `styles.css` -- so its discs have to ASK the stylesheet.
                    // Not `paletteValue`: by the time this row is on screen
                    // the cascade is the operator's own palette, and the chip
                    // would preview `ember` while promising vam.
                    const preview = (token: string): string | undefined =>
                      template.kind === 'stylesheet'
                        ? stylesheetPaletteValue(token)
                        : values[token];
                    return (
                      <button
                        key={template.id}
                        type="button"
                        data-palette-template={template.id}
                        title={`${template.hint} — studied from ${template.studied}`}
                        aria-label={`apply the ${template.label} colour template to ${theme}`}
                        onClick={() => onChange(applyPaletteTemplate(prefs, theme, template.id))}
                        className={`vam-tap flex h-[28px] cursor-pointer items-center gap-2 rounded border border-line px-2.5 text-control text-ink-dim capitalize hover:border-line-loud hover:text-ink ${FOCUS_RING}`}
                      >
                        <span aria-hidden="true" className="flex items-center">
                          {(['--vam-pane', '--vam-card', '--vam-in-bubble'] as const).map(
                            (token, i) => (
                              <span
                                key={token}
                                data-template-disc={token}
                                // Overlapped by a third of their width: three
                                // discs in a row read as one palette, three
                                // discs apart read as three separate settings.
                                // The edge is a RING rather than a border so a
                                // template whose surface sits close to the
                                // panel behind this row still has one.
                                className="h-[13px] w-[13px] rounded-full ring-1 ring-line-loud"
                                style={{
                                  backgroundColor: preview(token),
                                  marginLeft: i === 0 ? 0 : -4,
                                }}
                              />
                            ),
                          )}
                        </span>
                        {template.label}
                      </button>
                    );
                  })}
                </div>
              </Block>

              {/* ONE theme is editable here: the one on screen. The other two
                  options were a picker for which theme you are editing, and
                  both buckets side by side — and both lose the same thing. A
                  swatch shows a colour, and the only place a colour can be
                  judged is against the theme it will be worn in; editing the
                  invisible theme means picking blind, and the ring below ("this
                  token is overridden") would stop having one answer. Editing
                  what you can see keeps every signal on this row about the
                  screen in front of you, and switching theme above is how you
                  reach the other set. The heading says which, so it is never
                  read off the swatches. */}
              <Block
                label={t('settings.appearance.colours.label', { theme })}
                hint={t('settings.appearance.colours.hint', {
                  other: theme === 'dark' ? 'light' : 'dark',
                })}
                action={
                  Object.keys(paletteFor(prefs.palette, theme)).length === 0 ? null : (
                    <SmallButton
                      label={t('settings.appearance.colours.reset', { theme })}
                      onPick={() => onChange(clearPalette(prefs, theme))}
                    />
                  )
                }
              >
                <div className="grid grid-cols-2 gap-x-6 gap-y-[10px] sm:grid-cols-3">
                  {PALETTE_TOKENS.map(({ token, label }) => {
                    const overridden = paletteFor(prefs.palette, theme)[token] !== undefined;
                    return (
                      <div key={token} className="flex items-center gap-[10px]">
                        {/* The fill here is operator data — an override of the
                            panel's own colour paints a disc invisible against
                            the surface it sits on — so the EDGE identifies the
                            control, and owes 3:1. Its ground is `panel`, the
                            surface outside the disc, where `ink-faint` now
                            measures 4.99 dark / 5.38 light — it was 3.46 / 3.44
                            and cleared 3:1 with little to spare (issue 188).
                            Overridden reads as weight and lightness (1px faint
                            to 2px ink), never as hue, and the reset button
                            beside it carries the same state as a shape.
                            24 square, not 22: this is a replaced element, so a
                            `::after` hit area does not render on it and its
                            visual size IS its target. Two pixels are invisible
                            against the 13px label and the grid's pitch. */}
                        <input
                          type="color"
                          data-palette-swatch={token}
                          aria-label={`${label} colour, ${theme}`}
                          value={paletteValue(paletteFor(prefs.palette, theme), token)}
                          onChange={(event) =>
                            onChange(setPaletteColor(prefs, theme, token, event.target.value))
                          }
                          className={`vam-swatch vam-tap h-[24px] w-[24px] cursor-pointer rounded-full border-none bg-transparent p-0 ${FOCUS_RING} ${
                            overridden ? 'ring-2 ring-ink' : 'ring-1 ring-ink-faint'
                          }`}
                        />
                        <span className="text-body text-ink capitalize">{label}</span>
                        {overridden ? (
                          <button
                            type="button"
                            aria-label={`reset ${label} colour, ${theme}`}
                            onClick={() => onChange(clearPaletteColor(prefs, theme, token))}
                            className={`vam-hit-24 cursor-pointer text-ink-dim hover:text-ink ${FOCUS_RING}`}
                          >
                            {/* `×` reads as "remove this colour"; the action is
                                "go back to the stylesheet's". */}
                            <RotateCcw size={12} strokeWidth={1.8} aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Block>

              {/* Here, and not in a section of its own: a text size is not
                  behaviour, it is the paint — the family the theme and the
                  palette above it are in. `out` is the detail pane's answer
                  block (`data-detail-block="out"` in `DetailPanel.tsx`), which
                  is a live thing with a live name; the earlier arguments this
                  comment carried were about a Canvas section and the layouts
                  that hid the canvas, and both are gone.

                  THE HINT NAMES NO PANE, and that is a correction rather than
                  a rewording. It said "in the right pane", which was true of
                  the two-column shell it was written for; since the split work
                  (`leaves(panes)` in `Canvas.tsx`) the shell can hold several
                  response panes at once, side by side or stacked, and the pref
                  is applied as `--vam-out-font-size` on the document root, so
                  it reaches every one of them. A caption pointing at one pane
                  promises a scope the setting does not have. */}
              <Block
                label={t('settings.appearance.outText.label')}
                hint={t('settings.appearance.outText.hint')}
              >
                <Stepper
                  name="out text size"
                  min={OUT_FONT_SIZE_MIN}
                  max={OUT_FONT_SIZE_MAX}
                  step={1}
                  value={prefs.outFontSize}
                  unit="px"
                  onCommit={(next) => onChange(setOutFontSize(prefs, next))}
                />
              </Block>

              {/* CONCISE MODE, and it is here for the same reason `out text`
                  is: this is not behaviour, it is how densely the transcript
                  is drawn -- the family the theme, the colours and the text
                  size above it are in. Nothing it changes reaches a session.

                  GLOBAL, so it belongs in a dialog rather than on a pane. See
                  `Prefs.focusView` for why it is not per pane (an
                  arrangement the operator would re-make on every split) and
                  not per session (a display choice keyed to an id the store
                  prunes).

                  NO SHORTCUT. The grammar would allow one, but the digit row
                  is contested and every free key is worth more to an action
                  than to a preference you set once and leave. If the operator
                  turns out to flip this often, it earns a key then. */}
              {/* THE LABEL AND THE HINT ARE THE WHOLE DOCUMENTATION. This row
                  is the only place an operator learns what focus view does,
                  and the two facts they need are what it FOLDS and that the
                  folded thing COMES BACK. The retired "turn progress / shown /
                  collapsed" wording carried neither: it named a quantity
                  ("how much of each turn's working") and two words that could
                  be read as "deleted" and "kept". */}
              <Block
                label={t('settings.appearance.focusView.label')}
                hint={t('settings.appearance.focusView.hint')}
              >
                <button
                  type="button"
                  data-focus-view-toggle
                  role="switch"
                  aria-checked={prefs.focusView}
                  onClick={() => onChange(setFocusView(prefs, !prefs.focusView))}
                  className={`vam-tap flex h-[28px] cursor-pointer items-center rounded border px-3 text-control capitalize ${FOCUS_RING} ${
                    prefs.focusView
                      ? 'border-line-loudest bg-raised text-ink'
                      : 'border-line text-ink-dim'
                  }`}
                >
                  {t(
                    prefs.focusView
                      ? 'settings.appearance.focusView.on'
                      : 'settings.appearance.focusView.off',
                  )}
                </button>
                {/* THE PROMISE, ON SCREEN. This row asks the operator to give
                    up detail, and what it must never cost them is the alarm
                    (`Decision.errorCount`) or the way back. A guarantee kept
                    only in the source is one the person making the choice
                    cannot read -- so what `drawsProgressLine` holds back, and
                    what `drawsUnfoldControl` restores, are both named here, in
                    the words the column draws them in. */}
                <p data-focus-view-note className="mt-3 max-w-[52ch] text-control text-ink-dim">
                  A folded turn keeps <code className="text-ink">···</code> where its working was —
                  press it and that turn comes back, on its own. Nothing is folded from a turn whose
                  tools failed: it keeps its line and its{' '}
                  <code className="text-ink">· N failed</code> count, and so does the newest turn
                  while the session is working or waiting.
                </p>
              </Block>
            </Panel>

            <Panel id="sessions" active={section === 'sessions'} hint={t('settings.sessions.hint')}>
              <Block label={t('settings.sessions.provider.label')} hint={PROVIDER_HINT}>
                {CAN_CHOOSE_PROVIDER ? (
                  <div className="flex gap-1">
                    {PROVIDERS.map((provider) => (
                      <button
                        key={provider.id}
                        type="button"
                        data-provider-option={provider.id}
                        aria-pressed={prefs.defaultProvider === provider.id}
                        onClick={() => onChange(setDefaultProvider(prefs, provider.id))}
                        className={`vam-tap flex h-[28px] cursor-pointer items-center rounded border px-3 text-control ${FOCUS_RING} ${
                          prefs.defaultProvider === provider.id
                            ? 'border-line-loudest bg-raised text-ink'
                            : 'border-line text-ink-dim'
                        }`}
                      >
                        {provider.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  /* The answer, drawn as an answer. `text-body` and `ink` are
                     the steps a settings VALUE takes elsewhere in this dialog,
                     and the row keeps the 28px the picker occupied so the
                     section's rhythm does not change when a second provider
                     brings the buttons back. No border and no fill: an outline
                     around a sentence is how a statement comes to read as the
                     button it deliberately is not. */
                  <p
                    data-provider-fixed={resolveProvider(prefs.defaultProvider).id}
                    className="flex h-[28px] items-center text-body text-ink"
                  >
                    {resolveProvider(prefs.defaultProvider).label}
                  </p>
                )}
                <p className="mt-3 text-control text-ink-dim">
                  o runs{' '}
                  <code className="text-ink">
                    {resolveProvider(prefs.defaultProvider).command.join(' ')}
                  </code>{' '}
                  in the project’s directory.
                </p>
              </Block>

              {/* HERE, AND NOT UNDER KEYBOARD, and the reason is the one the
                  `turn progress` row states from the other side: that one is in
                  Appearance because nothing it changes reaches a session. This
                  one decides WHEN A PROMPT LEAVES FOR ONE, which is the same
                  family as the agent that receives it.

                  It could not go under Keyboard in any case. That section is
                  generated from the chord tables, and this key is not in them
                  ON PURPOSE -- the window listener never sees a keystroke typed
                  in a textarea, which is exactly where this one is pressed
                  (`DetailPanel`'s `onKeyDown` says so over Shift+Tab, bound
                  there for the identical reason).

                  A REAL CHOICE, which is what earns a row here at all: both
                  values are reachable, both change what the box does on the
                  next keystroke, and the composer paints which one is live.
                  The picker that was withdrawn in PR 303 failed all three. */}
              <Block
                label={t('settings.sessions.sendKey.label')}
                hint={t('settings.sessions.sendKey.hint')}
              >
                <div className="flex gap-1">
                  {SUBMIT_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      data-submit-key-option={key}
                      aria-pressed={prefs.promptSubmitKey === key}
                      onClick={() => onChange(setPromptSubmitKey(prefs, key))}
                      // Capitalised with every other control name here. A key
                      // name is already capital, so the transform changes
                      // nothing it is applied to -- which is the point: one
                      // rule with no exceptions beats a rule plus a list of
                      // strings that are allowed to break it.
                      className={`vam-tap flex h-[28px] cursor-pointer items-center rounded border px-3 text-control capitalize ${FOCUS_RING} ${
                        prefs.promptSubmitKey === key
                          ? 'border-line-loudest bg-raised text-ink'
                          : 'border-line text-ink-dim'
                      }`}
                    >
                      {SUBMIT_KEY_LABELS[key]}
                    </button>
                  ))}
                </div>
                {/* THE OTHER HALF, ON SCREEN. This row moves two keys, not
                    one: whichever does not send takes the newline. Naming only
                    the send would leave the operator to find the newline by
                    losing a draft to it — and the composer's own caption has
                    room for the send key alone. */}
                <p data-submit-key-note className="mt-3 max-w-[52ch] text-control text-ink-dim">
                  the other one takes a newline, so the box stays multiline either way. The composer
                  says which is which while you type.
                </p>
              </Block>
            </Panel>

            <Panel id="remote" active={section === 'remote'} hint={t('settings.remote.hint')}>
              {/* The bridge is read HERE rather than passed down from the
                  canvas: `window.api` exists only in the Electron shell, and
                  this is the one section that needs it. */}
              <RemotePanel
                api={desktopRemoteApi()}
                copyText={window.api?.clipboard?.writeText}
                active={section === 'remote'}
              />
            </Panel>

            <Panel id="keyboard" active={section === 'keyboard'} hint={t('settings.keyboard.hint')}>
              {/* STICKY, and that is the whole point of the wrapper.
                  MEASURED, not designed: the reset control that produces a
                  refusal can be thirty rows down a panel that scrolls, and
                  clicking it scrolls that row into view — so a refusal drawn
                  at the top of the section was painted somewhere the operator
                  was not looking. A silent refusal is the same failure as a
                  silent theft, one step later. `bg-panel` and the negative
                  margins are what stop the rows scrolling under it from
                  reading through it and past its edges. */}
              {message === '' && clashes.length === 0 ? null : (
                <div className="-mx-5 -mt-4 sticky -top-4 z-10 bg-panel px-5 pt-4 pb-2">
                  {message === '' ? null : (
                    <p data-binding-message className="text-waiting text-control">
                      {message}
                    </p>
                  )}
                  {/* A STANDING notice, not a reaction to a click: the editor
                      can no longer MINT a contested key, but it can be opened
                      over one — a stored override collides with a shipped key
                      the day a later vam moves one onto it, with nothing
                      hand-edited. That state used to be legible only by
                      pressing the key and watching the wrong thing happen.
                      `polite` rather than `assertive`: it is a report about
                      the list below, not about the operator's last
                      keystroke. */}
                  {clashes.length === 0 ? null : (
                    <p
                      data-binding-clash
                      role="status"
                      aria-live="polite"
                      className="text-control text-waiting"
                    >
                      {clashes
                        .map(
                          (clash) =>
                            `two actions claim "${clash.chord}" — ${labelFor(prefs.keyBindings, clash.winner)} has it, ${clash.shadowed
                              .map((id) => labelFor(prefs.keyBindings, id))
                              .join(', ')} does not.`,
                        )
                        .join(' ')}
                    </p>
                  )}
                </div>
              )}
              <div className="mb-2">
                {Object.keys(prefs.keyBindings).length === 0 ? null : (
                  <SmallButton
                    label={t('settings.keyboard.reset')}
                    onPick={() => bind(NO_BINDINGS, null)}
                  />
                )}
              </div>
              {/* One column, not two. Groups of unequal length interleaved
                  vertically, so a heading marked the top of one of two parallel
                  streams rather than a boundary; the cost is scroll length on a
                  panel that already scrolls, which is the cheaper thing. */}
              <div className="flex flex-col">
                {shortcutSections(buildBindingSheet(prefs.keyBindings)).map((section) => (
                  <section
                    key={section.id}
                    data-shortcut-section={section.id}
                    className="mt-7 first:mt-0"
                  >
                    {/* The SAME heading as a group's, for a mode as well: the
                        refinement spec fixed one heading here (§4-5) and a mode
                        is not a reason to invent a second. */}
                    <h4 className="mb-[10px] border-line-loud border-b pb-[6px] font-semibold text-body text-ink capitalize">
                      {section.title}
                    </h4>
                    {section.hint === null ? null : (
                      <p className="mt-[-4px] mb-[10px] max-w-[52ch] text-control text-ink-dim">
                        {section.hint}
                      </p>
                    )}
                    <ul>
                      {section.rows.map((row) => (
                        <BindingLine
                          key={`${section.id}:${row.id}`}
                          row={row}
                          scope={section.id}
                          capturing={capturing}
                          onCapture={setCapturing}
                          onKey={(slot, event) => capture(row, slot, event)}
                          onReset={() => bind(clearBindings(prefs.keyBindings, row.id), row.id)}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

type NavProps = {
  readonly section: SectionId;
  readonly onGo: (next: SectionId) => void;
  readonly onStep: (delta: number) => void;
};

/** The arrows move the SELECTION, and the panel changes with them: every panel
 *  here is already mounted, so the extra keystroke manual activation costs
 *  would buy nothing. Home/End are the ends. */
function navKeys({ onGo, onStep }: NavProps, event: React.KeyboardEvent) {
  const first = SECTIONS[0];
  const last = SECTIONS[SECTIONS.length - 1];
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    event.preventDefault();
    onStep(1);
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    event.preventDefault();
    onStep(-1);
  } else if (event.key === 'Home' && first !== undefined) {
    event.preventDefault();
    onGo(first.id);
  } else if (event.key === 'End' && last !== undefined) {
    event.preventDefault();
    onGo(last.id);
  }
}

/** Shared by both forms so a section cannot be selectable in one and not the
 *  other, and so there is exactly one nav state. */
function tabProps(props: NavProps, id: SectionId) {
  const selected = props.section === id;
  return {
    type: 'button' as const,
    role: 'tab',
    id: tabId(id),
    'data-settings-nav-item': id,
    'aria-selected': selected,
    'aria-controls': panelId(id),
    // Roving: the nav is one tab stop, and Tab from it lands in the panel.
    tabIndex: selected ? 0 : -1,
    onClick: () => props.onGo(id),
    onKeyDown: (event: React.KeyboardEvent) => navKeys(props, event),
  };
}

/**
 * The two-column form: the narrow left column `bg-sidebar` names, wearing the
 * `data-projects-header` caption vocabulary verbatim.
 *
 * `sidebar` against `panel` is 1.03:1 in dark — the fill alone cannot separate
 * the columns and the `border-r` does the separating, which is exactly how the
 * app's real sidebar seam is drawn.
 */
function SectionRail(props: NavProps) {
  return (
    <nav
      data-settings-nav
      className="hidden w-[168px] flex-none flex-col border-line border-r bg-sidebar md:flex"
    >
      <div className="flex flex-none items-center border-line border-b px-3 py-2">
        <span className="font-mono text-meta text-ink-dim uppercase tracking-[0.12em]">
          {t('settings.nav.heading')}
        </span>
      </div>
      <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-0.5 p-1.5">
        {SECTIONS.map(({ id, label, Icon }) => {
          const selected = props.section === id;
          return (
            <button
              key={id}
              {...tabProps(props, id)}
              // `segment-on` on `sidebar` is 1.21:1 — below the 3:1 an
              // author-drawn state needs — so a 2px rail in `ink` (14.4:1)
              // carries the selection. The unselected items reserve the same
              // 2px in `transparent`, or the label jumps when selection moves.
              className={`flex h-[28px] w-full cursor-pointer items-center gap-2 rounded-[7px] border-l-2 pr-2 pl-[6px] text-left text-control ${FOCUS_RING} ${
                selected
                  ? 'border-ink bg-segment-on font-medium text-ink'
                  : 'border-transparent text-ink-dim hover:text-ink'
              }`}
            >
              <Icon size={13} strokeWidth={1.6} />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * The narrow form: `DetailPanel`'s tab-bar geometry, reused rather than
 * re-invented.
 *
 * NEVER AN ICON RAIL, AT ANY WIDTH. `lucide-react` has no glyph that
 * unambiguously means "Appearance" or "Remote" at 13px with no label, and the
 * cost is not only that a sighted operator has to decode four small symbols:
 * a tab whose only content is an unlabelled `<svg>` has NO ACCESSIBLE NAME AT
 * ALL. This strip used to hide the label below `sm` with `hidden sm:inline`,
 * and the tree Chromium built at 390px was measured as four anonymous entries
 * — `tab / tab / tab / tab`. `e2e/settings-chrome-shots.mjs` holds the name at
 * every width the strip is the nav at, because no unit test can: jsdom applies
 * no stylesheet and so cannot see a breakpoint.
 *
 * THE LABEL THEREFORE NEVER HIDES; THE STRIP WRAPS INSTEAD. Measured in
 * Chromium, four labelled tabs need 306px of strip and get 278px at a 320px
 * viewport — one row genuinely does not fit down there, and at 390px it fits
 * by 2px, with the labels butting against the edges. So below `sm` the four
 * lay out two by two (134px a cell at 320px, against the 88px the widest —
 * "Appearance", icon and gap included — actually needs), and from `sm` up they
 * sit on one row with room to spare (135px a cell at 639px). At `md` the whole
 * nav is handed to `SectionRail` and this component is not rendered.
 */
function SectionStrip(props: NavProps) {
  return (
    <div
      data-settings-nav
      role="tablist"
      aria-orientation="horizontal"
      className="mb-[11px] grid grid-cols-2 gap-[3px] rounded-[9px] border border-line-loud bg-well p-[3px] sm:grid-cols-4 md:hidden"
    >
      {SECTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          {...tabProps(props, id)}
          className={`vam-tap flex h-[26px] cursor-pointer items-center justify-center gap-[5px] rounded-[7px] text-control ${FOCUS_RING} ${
            props.section === id
              ? 'bg-segment-on font-medium text-ink'
              : 'text-ink-dim hover:text-ink'
          }`}
        >
          <Icon size={13} strokeWidth={1.6} />
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * One section's panel. All four are mounted and the inactive three carry the
 * plain HTML `hidden` attribute: that is the standard tabs implementation, it
 * removes the subtree from the accessibility tree, and it keeps every
 * `querySelectorAll`/`getByLabelText` assertion that reads this overlay
 * immediately after `,` — without navigating anywhere — asserting what it was
 * written to assert.
 */
function Panel({
  id,
  active,
  hint,
  children,
}: {
  readonly id: SectionId;
  readonly active: boolean;
  readonly hint: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section
      data-settings-panel={id}
      role="tabpanel"
      id={panelId(id)}
      aria-labelledby={tabId(id)}
      hidden={!active}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the tabs pattern asks for exactly this -- the nav is ONE tab stop, so Tab out of it must land in the panel
      tabIndex={0}
      className={FOCUS_RING}
    >
      {/* 15px is a step the declared scale does not have, and it is deliberate:
          the heading has to out-rank four setting labels already at 13px.

          IT SHOUTS NOW, AND THE OLD ARGUMENT AGAINST THAT IS ANSWERED RATHER
          THAN DELETED. This comment used to read "no uppercase — at this size
          it reads as shouting and costs the word-shape a scanned list is read
          by", and the second half is the real objection: capitals are read
          letter by letter because the ascenders and descenders a word is
          recognised by are gone. That cost is paid by a LIST. This is one
          word, once, naming where you are — never scanned against siblings,
          because the other three are in the nav beside it. The operator asked
          for the rank to be visible, and tracking is the standard answer to
          the legibility half: capitals set solid are what actually reads as
          shouting.

          AND IT IS THE SECTION'S LABEL, NOT ITS `id`. The nav said
          "Appearance" and this said "appearance" — one destination, spelled
          two ways, one of them a raw identifier that had never been written
          for a person to read. */}
      <div className="mb-5 border-line-loud border-b pb-3">
        <h3
          data-settings-heading
          className="font-semibold text-heading text-ink uppercase tracking-[0.07em]"
        >
          {SECTIONS.find((section) => section.id === id)?.label ?? id}
        </h3>
        {/* A `<p>`, NOT A `<span>`, and the reason is the case rule rather
            than semantics -- though it is a paragraph either way.
            `::first-letter` only applies to a BLOCK container, so this hint
            wore `vam-sentence` and stayed lower case while the identical class
            worked on the status line in the title bar, whose parent is a flex
            container and whose children are therefore blockified. Measured off
            the screenshot, not reasoned about: the guard's corpus did not
            reach outside `[data-settings-rows]` and could not see it. */}
        <p data-settings-panel-hint className="vam-sentence text-control text-ink-dim">
          {hint}
        </p>
      </div>
      {/* Its own wrapper, so `first:` in `Block` means the first ROW. */}
      <div data-settings-rows>{children}</div>
    </section>
  );
}

function Choice({
  label,
  selected,
  onPick,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      // Restyled, deliberately not re-roled: three `aria-pressed` toggles for a
      // single-select is a real (small) wart, but a radiogroup is outside the
      // asks and costs two assertions. Raised as a follow-up instead.
      // Capitalised like every other control name on this surface -- as CSS,
      // so `label` keeps one canonical spelling for the tests and the
      // accessible name.
      className={`vam-tap flex h-[28px] cursor-pointer items-center rounded border px-3 text-control capitalize ${FOCUS_RING} ${
        selected ? 'border-line-loudest bg-raised text-ink' : 'border-line text-ink-dim'
      }`}
    >
      {label}
    </button>
  );
}

/** What an action is called, read off the same rows the editor renders. */
function labelFor(overrides: KeyBindings, id: string): string {
  for (const group of buildBindingSheet(overrides)) {
    for (const row of group.rows) {
      if (row.id === id) return row.label;
    }
  }
  return id;
}

/**
 * The floor the two key columns sit on, in pixels.
 *
 * DERIVED FROM THE CHORDS, NOT CHOSEN. The column was 68px, sized when the
 * widest thing in it was `gt`. `Mod-Shift-[` / `Mod-Shift-]` and `Mod-Alt-[` /
 * `Mod-Alt-]` arrived with the pane-stepping work and nothing resized the
 * column they landed in, so — measured in Chromium on the shipped bundle, at
 * the 68px it had been:
 *
 *   Mod-Shift-]   50.58px of ink over 2 lines   scrollHeight 36 / client 24
 *   Mod-Shift-[   43.36px of ink over 3 lines   scrollHeight 54 / client 24
 *
 * The slot is 26px tall and does not scroll, so those were not tight — they
 * were WRAPPED AND CUT, and of `Mod-Shift-[` an operator saw its first line
 * and nothing else. A shortcut you cannot read is the same defect as a
 * shortcut that is not there.
 *
 * Eleven characters at a measured 7.226px per advance (`Enter` and `Mod-1`,
 * five characters each, 36.13px each, at this same 12px) is 79.5px of ink;
 * with `px-2` and a 1px border either side that is 97.5px. 104 is that plus
 * one character of headroom, for a fallback face a shade wider than Geist
 * Mono. `test/settings/binding-columns.test.tsx` recomputes it from the sheet
 * rather than trusting this comment, and `e2e/settings-chrome-shots.mjs`
 * measures the rendered result in a browser, where the wrapping was found.
 *
 * SPELLED OUT AT BOTH CALL SITES rather than interpolated from a constant:
 * Tailwind generates a utility only for a class name it can find as text in
 * the source, so `min-w-[${N}px]` would compile to a class that does not
 * exist — silently, with no build error and nothing on screen but the old
 * width. The two places are `SLOT_BOX` below and the row's `grid-cols-[…]`.
 */

/** One box, one geometry, three fills — a slot is field-shaped in every state,
 *  not a chip that turns into an input. The border is `ink-faint` for the
 *  stepper's reason: `sunken` on `panel` is 1.04:1, so the edge is the sole
 *  identifier of the control and owes 1.4.11 its 3:1.
 *
 *  `min-w` AND NOT `w`, because a CAPTURED chord has no length bound —
 *  `normalizeKey` answers `Mod-Alt-<event.key>` and `event.key` is whatever
 *  the keyboard reports, so `Mod-Alt-ArrowRight` is eighteen characters and
 *  `Mod-Alt-AudioVolumeDown` is twenty-three. No fixed width holds those. The
 *  floor keeps every shipped chord on one x down the list; past it the slot
 *  grows into the `max-content` half of the row's track and the LABEL yields,
 *  because a label truncates legibly and a key does not.
 *
 *  `whitespace-nowrap` DOES NOT DO THAT — the growth is the track's doing, and
 *  deleting this class at 1100px or 390px changes nothing, which is exactly
 *  how it survived its first mutation. It earns its place at 320px, where the
 *  grid runs OUT of room: the track falls back to the 104px floor, the slot
 *  measures 154px against 166px of chord, and without this the chord wraps
 *  onto a second line that a 26px box cannot show. With it the overflow is
 *  sideways, one line, and still 113px inside the panel that clips. That is
 *  the whole of what it does, and `e2e/settings-chrome-shots.mjs` plants a
 *  long chord at 320px so that deleting it goes red. */
const SLOT_BOX =
  'vam-tap h-[26px] min-w-[104px] whitespace-nowrap rounded-[6px] border px-2 text-center font-mono text-control';

/** One action: its name, its slots, and a way back to the shipped keys. */
function BindingLine({
  row,
  scope,
  capturing,
  onCapture,
  onKey,
  onReset,
}: {
  readonly row: BindingRow;
  /** Which section this copy is drawn in; see `Capturing`. */
  readonly scope: string;
  readonly capturing: Capturing;
  readonly onCapture: (next: Capturing) => void;
  readonly onKey: (slot: number, event: React.KeyboardEvent) => void;
  readonly onReset: () => void;
}) {
  const slots = Array.from({ length: MAX_BINDINGS }, (_, slot) => slot);
  const armed = capturing?.id === row.id && capturing.scope === scope;
  return (
    // Three columns, in the order the row is read: what the action is, then its
    // first key, then its second. The label takes the one flexible track and
    // the key slots sit on a FLOOR, which is what makes the list scan -- every
    // label starts at the same x AND both key columns hold one x down the whole
    // list, however long the label above them was.
    //
    // `minmax(104px,max-content)` rather than a fixed width, and the second
    // half of that is not decoration: the floor holds every chord the shipped
    // tables contain (see `SLOT_MIN_PX`'s note), and `max-content` is what
    // happens past it, because a captured chord has no length bound. On such a
    // row the LABEL gives up the pixels -- it truncates legibly, and a key
    // missing its last four characters does not.
    <li className="grid grid-cols-[1fr_minmax(104px,max-content)_minmax(104px,max-content)] items-center gap-x-[10px] py-[3px]">
      {/* The reset control rides in the label column rather than claiming a
          fourth one: a track that exists only on overridden rows would shove
          their key slots sideways, and the operator asked for three columns.
          `min-w-0` overrides a grid item's auto minimum, so a long label
          truncates here instead of widening the track. */}
      <span className="flex min-w-0 items-center gap-2">
        {/* While the row is armed the label column carries the instruction that
            used to live in the capture box's 160px placeholder -- which is how
            the box keeps the same geometry in every state. The armed box takes
            a fixed `w-[104px]` rather than `SLOT_BOX`'s floor: an `<input>`
            with no width contributes its `size` default (about twenty
            characters) to a `max-content` track, so arming a row would widen
            the whole column for as long as the box was open. */}
        {/* A DESCRIPTION, NOT A NAME, so it takes sentence case like a hint
            rather than the capitalisation a control's name takes. These read
            "previous tab of this project — a ring, so it never runs out";
            `capitalize` would give "Previous Tab Of This Project", which is a
            title, and there are seventy of them down one list. */}
        <span
          data-binding-label={row.id}
          title={row.label}
          className="vam-sentence truncate text-body text-ink"
        >
          {armed ? 'press a key — Esc cancels' : row.label}
        </span>
        {row.overridden ? (
          <button
            type="button"
            data-binding-reset={row.id}
            aria-label={`reset ${row.label} shortcut`}
            onClick={onReset}
            className={`shrink-0 cursor-pointer text-ink-dim hover:text-ink ${FOCUS_RING}`}
          >
            <RotateCcw size={12} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
      </span>
      {slots.map((slot) => {
        const keys = row.keys[slot];
        if (armed && capturing.slot === slot) {
          return (
            <input
              key={slot}
              data-binding-capture
              aria-label={`press a key for ${row.label}`}
              // The box has to HOLD the keyboard, or neither arbitration runs:
              // `capture`'s `stopPropagation` and `Canvas.tsx`'s `typing` guard
              // are both keyed to an INPUT having focus, and without this focus
              // fell to <body> — outside React's root — where the window
              // listener swallowed every key but Escape and Escape closed the
              // whole overlay. `autoFocus` rather than a ref-and-effect is
              // `CommandPalette`'s idiom, and it scrolls the box into view in a
              // panel that scrolls.
              // biome-ignore lint/a11y/noAutofocus: the box exists only to take the next keystroke -- arming it without the keyboard is what the bug WAS
              autoFocus
              readOnly
              value=""
              // Self-describing, because while this box is armed it swallows
              // every key except Escape — including `Ctrl-Tab` — and a state
              // that eats the keyboard has to be readable rather than inferred.
              placeholder={t('settings.keyboard.capture')}
              onKeyDown={(event) => onKey(slot, event)}
              onBlur={() => onCapture(null)}
              // The ring is drawn permanently here, not on `focus-visible`: it
              // is showing the armed state, not the cursor. It is also the only
              // permanent ring on this surface, which is how the operator tells
              // which Escape they are about to press.
              className={`${SLOT_BOX} w-[104px] border-ink bg-raised text-ink outline-2 outline-ink outline-offset-2`}
            />
          );
        }
        // A key another action wins is drawn STRUCK THROUGH and says so in its
        // accessible name — a slot that looks like every other slot is exactly
        // how F3 stayed invisible, and a strikethrough alone is nothing at all
        // to a screen reader.
        const dead = keys === undefined ? undefined : row.dead[keys];
        // An empty second slot is still a control: it is how a second binding
        // is added, and it is the only affordance that says one is possible.
        return (
          <button
            key={slot}
            type="button"
            data-binding-slot={`${row.id}:${slot}`}
            data-binding-dead={dead === undefined ? undefined : keys}
            title={dead === undefined ? undefined : `dead — ${dead} has "${keys}"`}
            aria-label={
              keys === undefined
                ? `add a key for ${row.label}`
                : dead === undefined
                  ? `${keys}, ${row.label}`
                  : `${keys}, ${row.label} — dead, ${dead} has this key`
            }
            onClick={() => onCapture({ id: row.id, slot, scope })}
            className={`${SLOT_BOX} cursor-pointer hover:border-ink hover:text-ink ${FOCUS_RING} ${
              keys === undefined
                ? 'border-ink-faint border-dashed bg-transparent text-ink-dim'
                : dead === undefined
                  ? 'border-ink-faint bg-sunken text-ink'
                  : 'border-waiting bg-transparent text-ink-dim line-through'
            }`}
          >
            {keys === undefined ? (
              <Plus size={12} strokeWidth={2} className="mx-auto" aria-hidden="true" />
            ) : (
              <kbd data-settings-keys className="border-none bg-transparent">
                {keys}
              </kbd>
            )}
          </button>
        );
      })}
    </li>
  );
}

/**
 * One setting: its name, what it is for underneath rather than beside, and the
 * control under both. 24px and a hairline separate one from the next — the
 * space is the separator and the rule only confirms it, which is why the rule
 * stays a hairline: at 2px each row would start reading as a card it is not.
 *
 * `first:` matches the first DOM sibling, so these live inside their own
 * `[data-settings-rows]` wrapper (see `Panel`) — as siblings of the section
 * heading, the first row would draw a top rule directly under the heading's
 * bottom one.
 */
function Block({
  label,
  hint,
  action,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="mt-6 border-line-loud border-t pt-6 first:mt-0 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-3">
        {/* CAPITALISED, NOT SHOUTED, and the difference from the panel heading
            above is the whole reason there are two rules. There are four or
            five of these down one panel and they ARE scanned against each
            other; a column of capitals is a column with no word shapes left to
            find your row by. The transform is CSS rather than rewritten
            strings so the DOM keeps one canonical spelling -- every test that
            quotes a label still holds, and a screen reader is handed a word
            instead of something it may spell out. */}
        <h4 className="font-medium text-body text-ink capitalize">{label}</h4>
        {action === undefined ? null : <span className="ml-auto">{action}</span>}
      </div>
      {/* A 12px line running the full ~660px panel is a paragraph, not a
          caption -- and a paragraph takes SENTENCE case. `capitalize` here
          would give "System Follows What The Operating System Asks For", which
          is the failure that looks most like the fix, so `vam-sentence` moves
          the first letter and nothing else. */}
      <p className="vam-sentence mt-1 max-w-[52ch] text-control text-ink-dim">{hint}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SmallButton({ label, onPick }: { readonly label: string; readonly onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`vam-tap cursor-pointer rounded border border-line px-2 py-0.5 text-ink-dim text-control ${FOCUS_RING}`}
    >
      {label}
    </button>
  );
}

const STEP_BUTTON =
  'vam-tap flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-[6px] text-ink-dim hover:bg-segment-on hover:text-ink disabled:cursor-default disabled:text-ink-faint disabled:hover:bg-transparent disabled:hover:text-ink-faint';

/**
 * A native `type="number"` between two token-drawn buttons.
 *
 * Not a range input, whose track and thumb take the OS accent colour that no
 * `--vam-*` token reaches — that unstyleable chrome is the whole of what needed
 * to look better here. Not a hand-rolled `role="spinbutton"` either: native
 * gives the role, the arrow stepping and `min`/`max`/`value` for free, and both
 * values are fifteen and eleven discrete steps, which is a stepper's range.
 *
 * The pill's border is `ink-faint` rather than a `line-*` token because `well`
 * on `panel` is 1.03:1 — the fill does not draw the control at all, so the
 * border is its sole identifier and owes 1.4.11 its 3:1. `line-loudest` is
 * 2.26 on `well` in dark and fails that; `ink-faint` is the one kit token
 * that clears it in both themes. THE GROUND IS `well`, the fill this border
 * encloses, not the
 * `panel` an earlier version of this note measured against: at 3.46 / 3.44 on
 * `panel` it read as a pass while measuring 3.57 / 2.91 on `well`, and the
 * light figure was under 3:1 the whole time. `ink-faint` was raised for that
 * and for the text it carries, and the border now measures 5.40 / 4.56 on the
 * ground it actually has (issue 188). See the refinement spec before
 * substituting.
 */
function Stepper({
  name,
  min,
  max,
  step,
  value,
  unit,
  onCommit,
}: {
  readonly name: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly unit: string;
  readonly onCommit: (next: number) => void;
}) {
  // What is being typed, while it is being typed. Without it, clearing the box
  // to retype `18` would commit `0`, which the setter clamps to the minimum
  // under the cursor. The setters clamp totally either way — this is about the
  // typing, not about safety.
  const [draft, setDraft] = useState<string | null>(null);
  const nudge = (to: number) => {
    setDraft(null);
    onCommit(Math.min(max, Math.max(min, to)));
  };
  return (
    <div className="flex items-center">
      <div className="inline-flex h-[30px] items-center rounded-[8px] border border-ink-faint bg-well p-[3px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink has-[:focus-visible]:outline-offset-2">
        {/* The ring is on the pill, not the field: at `outline-offset-2` around
            a field inset by 3px it would land on the pill's own border and read
            as a thicker border rather than as a cursor. */}
        {/* One tab stop, the field: the arrows do by keyboard what these do by
            mouse, which is the ARIA spinbutton pattern and the roving idiom the
            nav already uses in this overlay. */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={`decrease ${name}`}
          disabled={value <= min}
          onClick={() => nudge(value - step)}
          className={STEP_BUTTON}
        >
          <Minus size={13} strokeWidth={2} />
        </button>
        <input
          type="number"
          aria-label={name}
          min={min}
          max={max}
          step={step}
          value={draft ?? value}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            if (raw !== '' && Number.isFinite(Number(raw))) {
              onCommit(Number(raw));
            }
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            // The arrows are the browser's; only these four need a handler.
            const to =
              event.key === 'PageUp'
                ? value + step * 5
                : event.key === 'PageDown'
                  ? value - step * 5
                  : event.key === 'Home'
                    ? min
                    : event.key === 'End'
                      ? max
                      : null;
            if (to === null) return;
            event.preventDefault();
            nudge(to);
          }}
          className="vam-tap h-[24px] w-[52px] bg-transparent text-center font-mono text-control text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={`increase ${name}`}
          disabled={value >= max}
          onClick={() => nudge(value + step)}
          className={STEP_BUTTON}
        >
          <Plus size={13} strokeWidth={2} />
        </button>
      </div>
      {/* A UNIT IS NOT A NAME, and it is marked as one so the case ladder can
          tell the difference. `px` capitalised is `Px`, which is not a CSS
          unit and not a word -- the one string on this surface that must stay
          exactly as typed. */}
      <span data-settings-unit className="ml-2 font-mono text-control text-ink-dim">
        {unit}
      </span>
    </div>
  );
}
