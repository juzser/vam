/**
 * `,` and the gear — the settings the operator already had, made editable.
 *
 * Every section is wiring rather than invention: the theme is `prefs.theme`
 * and `applyTheme`, which shipped long ago with one toggle as their whole
 * interface; and the keyboard reference is
 * `buildKeySheet()`, the same generator the `?` sheet renders, so a row here
 * can only exist because a binding exists.
 *
 * ── THE CARDS RESTRUCTURE (STEP 1: layout only, no new setting) ───────────
 * Operator: "these are Orca's appearance settings; see what vam can do and
 * add it. Split into clear, separate sections." This overlay used to be a
 * TAB STRIP: exactly one section's panel on screen, its siblings mounted but
 * `hidden`. It is now ONE SCROLLING PAGE of ten collapsible cards
 * (`primitives.tsx`'s `SettingsCard`), each with its own header, an optional
 * "Advanced" disclosure for its rarely-touched rows, and a divider before the
 * next. `settings/sections.ts` carries which ten and why each is ordered
 * where it is; this file carries the cards themselves and the nav that jumps
 * between them.
 *
 * THE NAV IS JUMP LINKS NOW, NOT TABS. `SectionRail`/`SectionStrip` still
 * draw the same rail (desktop) and horizontally-scrolling strip (narrow
 * desktop) they always did, and arrow/Home/End/Ctrl-Tab still step a
 * `section` pointer through `SECTIONS` exactly as before — but activating an
 * item no longer swaps which single panel is unhidden, because nothing is
 * hidden by section any more. It scrolls that card's header into view and
 * keeps the keyboard on the nav item, the same "focus follows the selection,
 * never dives into the panel" rule the tab strip kept. A card a nav item
 * points at may itself be collapsed; jumping to it does not force it open,
 * the same way clicking a browser's own in-page link does not expand an
 * accordion under it.
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
import {
  CAN_CHOOSE_PROVIDER as CAN_CHOOSE_PROVIDER_SHARED,
  PROVIDERS,
  resolveProvider,
} from '../../shared/providers.js';
import type { SourceId } from '../domain/model.js';
import { t } from '../i18n/strings.js';
import {
  bindingClashes,
  bindKey,
  chordSymbols,
  clearBindings,
  isReserved,
  type KeyBindings,
  MAX_BINDINGS,
  NO_BINDINGS,
  newClashes,
  normalizeKey,
} from '../keyboard/chords.js';
import { type BindingRow, buildBindingSheet } from '../keyboard/keysheet.js';
import { ChordGlyphs } from '../keyboard/ShortcutTip.js';
import { usePhoneViewport } from '../phone/viewport.js';
import { EDITOR_INDENT_MAX, EDITOR_INDENT_MIN } from '../prefs/editor.js';
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
  setCacheTimer,
  setDefaultProvider,
  setEditorHighlight,
  setEditorIndent,
  setFocusView,
  setKeyBindings,
  setNarrowViews,
  setNotifyWaiting,
  setOutFontSize,
  setPaletteColor,
  setPromptSubmitKey,
  setStreamingTerminal,
  setTerminalFontSize,
  setTheme,
  stylesheetPaletteValue,
  type Theme,
} from '../prefs/prefs.js';
import { type PromptSubmitKey, SUBMIT_KEY_LABELS } from '../prefs/submit-key.js';
import { TERMINAL_FONT_SIZES } from '../prefs/terminal-font.js';
import {
  clearTerminalSchemeColor,
  clearTerminalSchemeOverrides,
  DEFAULT_TERMINAL_THEME,
  resolveTerminalScheme,
  setTerminalBackgroundOpacity,
  setTerminalSchemeColor,
  setTerminalTheme,
  TERMINAL_BACKGROUND_OPACITY_MAX,
  TERMINAL_BACKGROUND_OPACITY_MIN,
  TERMINAL_BACKGROUND_OPACITY_STEP,
  TERMINAL_SCHEME_KEYS,
  TERMINAL_SCHEME_LABELS,
  type TerminalSchemeKey,
  type TerminalTheme,
  terminalThemesFor,
} from '../prefs/terminal-scheme.js';
import type { SourceDeclines } from '../sources/port.js';
import { AdhdSkillCard, desktopAdhdSkillApi } from './AdhdSkillCard.js';
import { desktopGithubApi, GithubPanel } from './GithubPanel.js';
import { desktopNotifyApi, NotifyTest } from './NotifyTest.js';
import { AdvancedDisclosure, SettingsCard, SettingsRow, SettingsSubgroup } from './primitives.js';
import { RemoteLimits } from './RemoteLimits.js';
import { desktopRemoteApi, RemotePanel } from './RemotePanel.js';
import { Switch } from './Switch.js';
import { PHONE_SECTIONS, SECTIONS, type SectionId, shortcutSections } from './sections.js';
import { desktopUpdateApi, UpdatePanel } from './UpdatePanel.js';

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
   * Which card the overlay scrolls to the moment it opens. Absent means
   * `interface`, where the overlay has opened since before sections existed
   * (see the note on `SECTIONS`) — the Remote icon is the one caller that
   * needs to land somewhere else, so it is optional rather than threading a
   * fifth required prop through every other opener.
   */
  readonly initialSection?: SectionId;
  /**
   * The source's own words for every capability it lacks, drawn under the
   * Remote section by `RemoteLimits`. Never this file's words: a sentence
   * written here would go stale the first time a source gained a capability.
   *
   * OPTIONAL, and `{}` is the honest default rather than a convenience: a
   * source that declines nothing and a caller that has not wired this are the
   * same picture -- no list -- and every caller that HAS a source passes it.
   */
  readonly declines?: SourceDeclines;
  /**
   * Every project vam knows about, for the Integrations section's repo
   * picker -- one entry per project the sidebar groups sessions under.
   * OPTIONAL, and `[]` is the honest default: a caller that has not wired
   * this (or a build with no live projects yet) gets a picker with nothing
   * to aim at rather than a crash, the same rule `declines` above follows.
   */
  readonly projects?: readonly {
    readonly id: string;
    readonly source: SourceId;
    readonly name: string;
  }[];
};

const THEMES: readonly Theme[] = ['dark', 'light', 'system'];

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
 * IS THERE A CHOICE HERE AT ALL? It decides whether this section OFFERS a
 * provider or REPORTS one -- and the answer is no longer derived here.
 *
 * It read `PROVIDERS.length > 1` in this file, which was right and was only
 * half the rule: the composer's own provider picker (`DetailPanel.tsx`) asks
 * the same question about the same table and did not ask it at all. One
 * derivation, in `src/shared/providers.ts` beside the table, is what stops the
 * two surfaces disagreeing about whether there is a choice to offer -- and
 * that file carries the whole argument, including what each control costs
 * while the answer is `false`.
 */
const CAN_CHOOSE_PROVIDER = CAN_CHOOSE_PROVIDER_SHARED;

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

/** Whether a phone may see this section at all — `PHONE_SECTIONS`'s own rule,
 *  read once here rather than re-derived at every card. */
function showsOnPhone(id: SectionId, phone: boolean): boolean {
  return !phone || PHONE_SECTIONS.includes(id);
}

/** A section's own nav entry (label, icon), read off `SECTIONS` rather than
 *  repeated at the call site — the one thing that keeps a card's own heading
 *  and its nav item unable to disagree about what a section is called. */
function sectionMeta(id: SectionId) {
  const entry = SECTIONS.find((section) => section.id === id);
  if (entry === undefined) throw new Error(`unknown settings section: ${id}`);
  return entry;
}

export function SettingsOverlay({
  prefs,
  theme,
  onChange,
  onClose,
  initialSection,
  declines = {},
  projects = [],
}: SettingsOverlayProps) {
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  /**
   * WHICH CARD THE NAV LAST POINTED AT — never "which panel is visible", since
   * every card is always in the document (collapsed or not). It drives the
   * roving tabindex and `aria-current` in `SectionRail`/`SectionStrip`, and
   * `step` reads it back to find the NEXT section on Ctrl-Tab. Read once, at
   * mount — the overlay is only ever mounted fresh (`Canvas.tsx` conditionally
   * renders it), so there is no later prop change to track.
   */
  const [section, setSection] = useState<SectionId>(initialSection ?? 'interface');
  const [capturing, setCapturing] = useState<Capturing>(null);
  const [message, setMessage] = useState('');
  const wide = useWideNav();
  /**
   * Is this the phone shell's width?
   *
   * It used to be read for COPY only, with the dialog's own breakpoint left to
   * `useWideNav`. It decides WHICH SECTIONS EXIST now as well (operator
   * instruction; see `PHONE_SECTIONS`) -- which is not a second opinion about
   * layout, it is a different question: `useWideNav` asks whether there is
   * room for a nav column, this asks whether the device can act on what the
   * nav would point at.
   */
  const phone = usePhoneViewport();
  /**
   * `GithubPanel`/`RemotePanel` poll a bridge while their own card is on
   * screen (see each one's own header for why), and "on screen" now means
   * "its card is not collapsed" rather than "its tab is selected" — these two
   * booleans are what `SettingsCard`'s `onOpenChange` reports back, seeded
   * `true` because a card starts open and the card's own mount-time callback
   * corrects this before either panel's first effect run.
   */
  const [integrationsOpen, setIntegrationsOpen] = useState(true);
  const [remoteOpen, setRemoteOpen] = useState(true);
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
      // RENDERED, NOT THE STORED TOKEN — the same rule the reserved-key
      // refusal below already states out loud: the quoted key is named the
      // way the operator's own keyboard makes it (⌘K on a Mac, Ctrl+K off
      // one), never the grammar's internal `Mod-k` spelling.
      setMessage(
        `"${chordSymbols(clash.chord)}" already does: ${labelFor(next, other)} — move that first, or use "reset shortcuts"`,
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
      // THE TWO CHORDS IN THIS SENTENCE ARE RENDERED, ITS WORDS ARE NOT. The
      // quoted key is the keystroke the operator just made, so it is named the
      // way their keyboard makes it (⌘[ on a Mac, Ctrl+[ off one), and so is
      // the one reserved chord the sentence points at. "Escape" and `g/y/z`
      // stay English: they are prose naming keys, not chords being displayed,
      // and the armed row beside this already says "Esc cancels".
      setMessage(
        `"${chordSymbols(key)}" is reserved — Escape cancels this capture, g/y/z open chords, ${chordSymbols('Mod-[')} leaves the prompt box`,
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
   * Which nav item to jump to. Sets the "current" pointer, keeps the keyboard
   * ON THE NAV ITEM (never dives into the card, the tab strip's own rule),
   * and scrolls that card's header into view in the scrollport. It does NOT
   * force the card open: a collapsed card scrolls to its own header exactly
   * like an unvisited one, the same as any in-page link scrolling to an
   * accordion it does not itself expand.
   */
  const go = (next: SectionId) => {
    setSection(next);
    dialog.current?.querySelector<HTMLElement>(`[data-settings-nav-item="${next}"]`)?.focus();
    dialog.current
      ?.querySelector<HTMLElement>(`[data-settings-panel="${next}"]`)
      ?.scrollIntoView({ block: 'start' });
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
          long one. One height, one nav position; the cards column scrolls. */}
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

        {/* `min-h-0` or the scroll container will not shrink inside the flex
            column, and the fixed height above becomes an overflow. */}
        <div className="flex min-h-0 flex-1">
          {/* NO NAV ON A PHONE. `PHONE_SECTIONS` leaves one destination, and a
              nav with one destination is a control where every press lands
              where you already are. The close button above is the way out, and
              it is the reason that button had to be a real control rather than
              the `Esc` hint it used to be. */}
          {wide && !phone ? <SectionRail section={section} onGo={go} onStep={step} /> : null}
          {/* Named, because it is the scrollport a `sticky` child measures
              against and the box an e2e guard has to compare a message to:
              "the refusal is painted" and "the refusal is where the operator
              is looking" are different questions, and the second one needs
              this element. */}
          <div data-settings-scroll className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {wide || phone ? null : <SectionStrip section={section} onGo={go} onStep={step} />}

            {showsOnPhone('interface', phone) ? (
              <SettingsCard
                id="interface"
                label={sectionMeta('interface').label}
                Icon={sectionMeta('interface').Icon}
                hint={t('settings.interface.hint')}
              >
                <SettingsRow
                  label={t('settings.interface.theme.label')}
                  hint={t('settings.interface.theme.hint')}
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
                </SettingsRow>

                {/* TEMPLATES, coarse to fine, which is the order the operator
                    asked for ("at the top") and also the order the two
                    controls relate in: a template writes every swatch at once,
                    and the swatches (behind Advanced now) then edit what it
                    wrote. EACH BUTTON SHOWS ITS OWN COLOURS rather than only
                    its name — three discs, aria-hidden, and the button keeps a
                    written name, because a colour is not a label. */}
                <SettingsRow
                  label={t('settings.interface.templates.label')}
                  hint={t('settings.interface.templates.hint', { theme })}
                >
                  <div className="flex flex-wrap gap-1.5">
                    {PALETTE_TEMPLATES.map((template) => {
                      const values = templatePalette(template.id, theme);
                      // THE `default` CHIP HAS NO COLOURS OF ITS OWN -- pressing
                      // it deletes the bucket so the cascade falls back to
                      // `styles.css` -- so its discs have to ASK the stylesheet.
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
                </SettingsRow>

                <SettingsRow
                  label={t('settings.interface.outText.label')}
                  hint={t('settings.interface.outText.hint')}
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
                </SettingsRow>

                {/* THE PER-TOKEN COLOURS, BEHIND ADVANCED. Most operators pick
                    a template above and never open this: it is the row a
                    template writes into, one swatch per token, editing the
                    theme on screen only (a colour can only be judged against
                    the ground it will be worn on). */}
                <AdvancedDisclosure id="interface">
                  <SettingsRow
                    label={t('settings.interface.colours.label', { theme })}
                    hint={t('settings.interface.colours.hint', {
                      other: theme === 'dark' ? 'light' : 'dark',
                    })}
                    action={
                      Object.keys(paletteFor(prefs.palette, theme)).length === 0 ? null : (
                        <SmallButton
                          label={t('settings.interface.colours.reset', { theme })}
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
                                <RotateCcw size={12} strokeWidth={1.8} aria-hidden="true" />
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </SettingsRow>
                </AdvancedDisclosure>
              </SettingsCard>
            ) : null}

            {showsOnPhone('terminal', phone) ? (
              <SettingsCard
                id="terminal"
                label={sectionMeta('terminal').label}
                Icon={sectionMeta('terminal').Icon}
                hint={t('settings.terminal.hint')}
              >
                <SettingsSubgroup title={t('settings.terminal.typography.title')}>
                  <SettingsRow
                    label={t('settings.terminal.text.label')}
                    hint={t('settings.terminal.text.hint')}
                  >
                    <div className="flex gap-1">
                      {TERMINAL_FONT_SIZES.map((size) => (
                        <button
                          key={size}
                          type="button"
                          data-terminal-size-option={size}
                          aria-pressed={prefs.terminalFontSize === size}
                          aria-label={`terminal text ${size}px`}
                          onClick={() => onChange(setTerminalFontSize(prefs, size))}
                          className={`vam-tap flex h-[28px] cursor-pointer items-center rounded border px-3 font-mono text-control capitalize ${FOCUS_RING} ${
                            prefs.terminalFontSize === size
                              ? 'border-line-loudest bg-raised text-ink'
                              : 'border-line text-ink-dim'
                          }`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </SettingsRow>
                </SettingsSubgroup>

                <SettingsSubgroup title={t('settings.terminal.themes.title')}>
                  {(['dark', 'light'] as const).map((on) => (
                    <TerminalThemeRow key={on} on={on} prefs={prefs} onChange={onChange} />
                  ))}
                </SettingsSubgroup>

                <AdvancedDisclosure id="terminal">
                  <TerminalAdvancedRows prefs={prefs} theme={theme} onChange={onChange} />
                  <SettingsRow
                    label={t('settings.terminal.streamingTerminal.label')}
                    hint={t('settings.terminal.streamingTerminal.hint')}
                  >
                    <Switch
                      name="streaming-terminal"
                      label={t('settings.terminal.streamingTerminal.label')}
                      checked={prefs.streamingTerminal}
                      onChange={(next) => onChange(setStreamingTerminal(prefs, next))}
                      on={t('settings.terminal.streamingTerminal.on')}
                      off={t('settings.terminal.streamingTerminal.off')}
                    />
                  </SettingsRow>
                </AdvancedDisclosure>
              </SettingsCard>
            ) : null}

            {showsOnPhone('window', phone) ? (
              <SettingsCard
                id="window"
                label={sectionMeta('window').label}
                Icon={sectionMeta('window').Icon}
                hint={t('settings.window.hint')}
              >
                <SettingsRow
                  label={t('settings.window.narrowViews.label')}
                  hint={t('settings.window.narrowViews.hint')}
                >
                  <Switch
                    name="narrow-views"
                    label={t('settings.window.narrowViews.label')}
                    checked={prefs.narrowViews}
                    onChange={(next) => onChange(setNarrowViews(prefs, next))}
                    on={t('settings.window.narrowViews.on')}
                    off={t('settings.window.narrowViews.off')}
                  />
                </SettingsRow>
              </SettingsCard>
            ) : null}

            {showsOnPhone('agents', phone) ? (
              <SettingsCard
                id="agents"
                label={sectionMeta('agents').label}
                Icon={sectionMeta('agents').Icon}
                hint={t('settings.agents.hint')}
              >
                <SettingsRow label={t('settings.agents.provider.label')} hint={PROVIDER_HINT}>
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
                          <span data-verbatim className="normal-case">
                            {provider.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
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
                </SettingsRow>

                <SettingsRow
                  label={t('settings.agents.sendKey.label')}
                  hint={t('settings.agents.sendKey.hint')}
                >
                  <div className="flex gap-1">
                    {SUBMIT_KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        data-submit-key-option={key}
                        aria-pressed={prefs.promptSubmitKey === key}
                        onClick={() => onChange(setPromptSubmitKey(prefs, key))}
                        className={`vam-tap flex h-[28px] cursor-pointer items-center rounded border px-3 text-control capitalize ${FOCUS_RING} ${
                          prefs.promptSubmitKey === key
                            ? 'border-line-loudest bg-raised text-ink'
                            : 'border-line text-ink-dim'
                        }`}
                      >
                        <ChordGlyphs chord={SUBMIT_KEY_LABELS[key]} />
                      </button>
                    ))}
                  </div>
                  <p data-submit-key-note className="mt-3 max-w-[52ch] text-control text-ink-dim">
                    the other one takes a newline, so the box stays multiline either way. The
                    composer says which is which while you type.
                  </p>
                </SettingsRow>

                <SettingsRow
                  name="cache-timer"
                  label={t('settings.agents.cacheTimer.label')}
                  hint={t('settings.agents.cacheTimer.hint')}
                >
                  <Switch
                    name="cache-timer"
                    label={t('settings.agents.cacheTimer.label')}
                    checked={prefs.cacheTimer}
                    onChange={(next) => onChange(setCacheTimer(prefs, next))}
                    on={t('settings.agents.cacheTimer.on')}
                    off={t('settings.agents.cacheTimer.off')}
                  />
                  <p data-cache-timer-note className="mt-3 max-w-[52ch] text-control text-ink-dim">
                    {t('settings.agents.cacheTimer.note')}
                  </p>
                </SettingsRow>

                <AdhdSkillCard prefs={prefs} onChange={onChange} api={desktopAdhdSkillApi()} />
              </SettingsCard>
            ) : null}

            {showsOnPhone('behaviour', phone) ? (
              <SettingsCard
                id="behaviour"
                label={sectionMeta('behaviour').label}
                Icon={sectionMeta('behaviour').Icon}
                hint={t('settings.behaviour.hint')}
              >
                <SettingsRow
                  label={t('settings.behaviour.focusView.label')}
                  hint={t('settings.behaviour.focusView.hint')}
                >
                  <Switch
                    name="focus-view"
                    label={t('settings.behaviour.focusView.label')}
                    checked={prefs.focusView}
                    onChange={(next) => onChange(setFocusView(prefs, next))}
                    on={t('settings.behaviour.focusView.on')}
                    off={t('settings.behaviour.focusView.off')}
                  />
                  <p data-focus-view-note className="mt-3 max-w-[52ch] text-control text-ink-dim">
                    A folded turn keeps <code className="text-ink">···</code> where its working was
                    — press it and the turn comes back. Nothing is folded from a turn whose tools
                    failed, or from the newest turn while the session is working or waiting.
                  </p>
                </SettingsRow>

                <SettingsSubgroup title={t('settings.behaviour.files.title')}>
                  <SettingsRow
                    label={t('settings.behaviour.editorHighlight.label')}
                    hint={t('settings.behaviour.editorHighlight.hint')}
                  >
                    <Switch
                      name="editor-highlight"
                      label={t('settings.behaviour.editorHighlight.label')}
                      checked={prefs.editorHighlight}
                      onChange={(next) => onChange(setEditorHighlight(prefs, next))}
                      on={t('settings.behaviour.editorHighlight.on')}
                      off={t('settings.behaviour.editorHighlight.off')}
                    />
                    <p
                      data-editor-highlight-note
                      className="mt-3 max-w-[52ch] text-control text-ink-dim"
                    >
                      only JSON, <code className="text-ink">.env</code>,{' '}
                      <code className="text-ink">.ini</code> and markdown are coloured — every other
                      file is drawn as plain text.
                    </p>
                  </SettingsRow>

                  <SettingsRow
                    label={t('settings.behaviour.editorIndent.label')}
                    hint={t('settings.behaviour.editorIndent.hint')}
                  >
                    <Stepper
                      name="editor indent"
                      min={EDITOR_INDENT_MIN}
                      max={EDITOR_INDENT_MAX}
                      step={1}
                      value={prefs.editorIndent}
                      unit="spaces"
                      onCommit={(next) => onChange(setEditorIndent(prefs, next))}
                    />
                  </SettingsRow>
                </SettingsSubgroup>
              </SettingsCard>
            ) : null}

            {showsOnPhone('notifications', phone) ? (
              <SettingsCard
                id="notifications"
                label={sectionMeta('notifications').label}
                Icon={sectionMeta('notifications').Icon}
                hint={t('settings.notifications.hint')}
              >
                <SettingsRow
                  name="notify-waiting"
                  label={t('settings.notifications.waiting.label')}
                  hint={t('settings.notifications.waiting.hint')}
                >
                  <Switch
                    name="notify-waiting"
                    label={t('settings.notifications.waiting.label')}
                    checked={prefs.notifyWaiting}
                    onChange={(next) => onChange(setNotifyWaiting(prefs, next))}
                    on={t('settings.notifications.waiting.on')}
                    off={t('settings.notifications.waiting.off')}
                  />
                  <p
                    data-notify-waiting-note
                    className="mt-3 max-w-[52ch] text-control text-ink-dim"
                  >
                    {t('settings.notifications.waiting.note')}
                  </p>
                </SettingsRow>

                <SettingsRow
                  name="notify-test"
                  label={t('settings.notifications.test.label')}
                  hint={t('settings.notifications.test.hint')}
                >
                  <NotifyTest api={desktopNotifyApi()} />
                </SettingsRow>
              </SettingsCard>
            ) : null}

            {showsOnPhone('integrations', phone) ? (
              <SettingsCard
                id="integrations"
                label={sectionMeta('integrations').label}
                Icon={sectionMeta('integrations').Icon}
                hint={t('settings.integrations.hint')}
                onOpenChange={setIntegrationsOpen}
              >
                {/* The bridge is read HERE, like `RemotePanel` below -- `window.api`
                    exists only in the Electron shell, and this is the one
                    section that needs it. */}
                <GithubPanel
                  api={desktopGithubApi()}
                  active={integrationsOpen}
                  prefs={prefs}
                  onChange={onChange}
                  projects={projects}
                  copyText={window.api?.clipboard?.writeText}
                  chooseDirectory={window.api?.dialog?.chooseDirectory}
                />
              </SettingsCard>
            ) : null}

            {showsOnPhone('remote', phone) ? (
              <SettingsCard
                id="remote"
                label={sectionMeta('remote').label}
                Icon={sectionMeta('remote').Icon}
                hint={t('settings.remote.hint')}
                onOpenChange={setRemoteOpen}
              >
                {/* The bridge is read HERE rather than passed down from the
                    canvas: `window.api` exists only in the Electron shell, and
                    this is the one section that needs it. */}
                <RemotePanel
                  api={desktopRemoteApi()}
                  copyText={window.api?.clipboard?.writeText}
                  active={remoteOpen}
                />
                {/* WHAT THIS CONNECTION CANNOT DO, which the phone's session
                    screen used to spend 45px a session carrying. It sits UNDER
                    the panel rather than above it: the panel answers "how do I
                    reach this desktop", which is what the operator opened the
                    section for, and this answers "and what will not work once I
                    have" -- a fact worth having, and not the first thing. */}
                <div className="mt-4">
                  <RemoteLimits declines={declines} />
                </div>
              </SettingsCard>
            ) : null}

            {showsOnPhone('keyboard', phone) ? (
              <SettingsCard
                id="keyboard"
                label={sectionMeta('keyboard').label}
                Icon={sectionMeta('keyboard').Icon}
                hint={t('settings.keyboard.hint')}
              >
                {/* STICKY, and that is the whole point of the wrapper.
                    MEASURED, not designed: the reset control that produces a
                    refusal can be thirty rows down a card that scrolls, and
                    clicking it scrolls that row into view — so a refusal drawn
                    at the top of the section was painted somewhere the operator
                    was not looking. A silent refusal is the same failure as a
                    silent theft, one step later. `bg-panel` and the negative
                    margins are what stop the rows scrolling under it from
                    reading through it and past its edges. */}
                {message === '' && clashes.length === 0 ? null : (
                  <div className="-mx-4 -mt-4 sticky -top-4 z-10 bg-panel px-4 pt-4 pb-2">
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
                              `two actions claim "${chordSymbols(clash.chord)}" — ${labelFor(prefs.keyBindings, clash.winner)} has it, ${clash.shadowed
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
                    card that already scrolls, which is the cheaper thing. */}
                <div className="flex flex-col">
                  {shortcutSections(buildBindingSheet(prefs.keyBindings)).map((shortcutSection) => (
                    <section
                      key={shortcutSection.id}
                      data-shortcut-section={shortcutSection.id}
                      className="mt-7 first:mt-0"
                    >
                      {/* The SAME heading as a group's, for a mode as well: the
                          refinement spec fixed one heading here (§4-5) and a mode
                          is not a reason to invent a second. */}
                      <h4 className="mb-[10px] border-line-loud border-b pb-[6px] font-semibold text-body text-ink capitalize">
                        {shortcutSection.title}
                      </h4>
                      {shortcutSection.hint === null ? null : (
                        <p className="mt-[-4px] mb-[10px] max-w-[52ch] text-control text-ink-dim">
                          {shortcutSection.hint}
                        </p>
                      )}
                      <ul>
                        {shortcutSection.rows.map((row) => (
                          <BindingLine
                            key={`${shortcutSection.id}:${row.id}`}
                            row={row}
                            scope={shortcutSection.id}
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
              </SettingsCard>
            ) : null}

            {/* THE VERSION, AND A WAY TO ASK. The check itself is not new --
                one request at launch, and a popover that draws only when
                there is something to do about it. What was missing is a place
                to ASK, where "you are current", "nothing has been published",
                "GitHub is rate-limiting you" and "it never got out" can be
                four different sentences instead of one silence.
                `UpdatePanel.tsx` carries the argument. */}
            {showsOnPhone('update', phone) ? (
              <SettingsCard
                id="update"
                label={sectionMeta('update').label}
                Icon={sectionMeta('update').Icon}
                hint={t('settings.update.hint')}
              >
                <UpdatePanel api={desktopUpdateApi()} />
              </SettingsCard>
            ) : null}
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

/** The arrows move the "current" pointer and scroll its card into view — Home
 *  and End are the ends. */
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

/**
 * Shared by both nav forms so a section cannot be reachable in one and not
 * the other, and so there is exactly one nav state.
 *
 * `aria-current` REPLACES `aria-selected`/`role="tab"`, because activating an
 * item no longer selects a single visible panel from a set of hidden ones --
 * it jumps to a card that was already there. This is the TOC/in-page-link
 * pattern (`aria-current="true"` on the entry nearest where the reader is),
 * not the exclusive-tabs pattern, and giving it the tabs role once every card
 * is simultaneously visible would tell a screen reader something false.
 */
function navItemProps(props: NavProps, id: SectionId) {
  const current = props.section === id;
  return {
    type: 'button' as const,
    'data-settings-nav-item': id,
    'aria-current': current ? ('true' as const) : undefined,
    // Roving: the nav is one tab stop, and Tab from it lands in the cards
    // column.
    tabIndex: current ? 0 : -1,
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
      <div role="toolbar" aria-orientation="vertical" className="flex flex-col gap-0.5 p-1.5">
        {SECTIONS.map(({ id, label, Icon }) => {
          const current = props.section === id;
          return (
            <button
              key={id}
              {...navItemProps(props, id)}
              // `segment-on` on `sidebar` is 1.21:1 — below the 3:1 an
              // author-drawn state needs — so a 2px rail in `ink` (14.4:1)
              // carries the selection. The unselected items reserve the same
              // 2px in `transparent`, or the label jumps when selection moves.
              className={`flex h-[28px] w-full cursor-pointer items-center gap-2 rounded-[7px] border-l-2 pr-2 pl-[6px] text-left text-control ${FOCUS_RING} ${
                current
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
 * The narrow form: a horizontally SCROLLING strip, one row, never wrapping.
 *
 * IT USED TO WRAP INTO A 2×2 (THEN 4×2) GRID, which was arithmetic tied to a
 * fixed section count that had already gone stale once (Notifications
 * arrived and the wrap literal needed retuning) — and ten sections is a grid
 * five cells wide, which does not fit a phone-width dialog at any row count
 * worth choosing. A single scrolling row sidesteps the arithmetic entirely:
 * it costs nothing to add an eleventh section, and the ends of the strip
 * (`overflow-x-auto` plus a bit of end padding so the last chip is not flush
 * against the edge) are the only affordance an operator needs to learn there
 * is more to scroll to.
 *
 * NEVER AN ICON RAIL, AT ANY WIDTH — unchanged from the wrapping strip this
 * replaces: `lucide-react` has no glyph that unambiguously means "Interface"
 * or "Remote" at 13px with no label, and a tab whose only content is an
 * unlabelled `<svg>` has no accessible name at all. The label therefore never
 * hides; the strip scrolls sideways instead.
 */
function SectionStrip(props: NavProps) {
  return (
    <div
      data-settings-nav
      role="toolbar"
      aria-orientation="horizontal"
      className="mb-[11px] flex gap-[3px] overflow-x-auto rounded-[9px] border border-line-loud bg-well p-[3px] md:hidden"
    >
      {SECTIONS.map(({ id, label, Icon }) => {
        const current = props.section === id;
        return (
          <button
            key={id}
            {...navItemProps(props, id)}
            className={`vam-tap flex h-[26px] flex-none cursor-pointer items-center justify-center gap-[5px] whitespace-nowrap rounded-[7px] px-2.5 text-control ${FOCUS_RING} ${
              current ? 'bg-segment-on font-medium text-ink' : 'text-ink-dim hover:text-ink'
            }`}
          >
            <Icon size={13} strokeWidth={1.6} />
            {label}
          </button>
        );
      })}
    </div>
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
 *  grid runs OUT of room: the track falls back to its floor, the slot is
 *  narrower than the chord, and without this the chord wraps onto a second
 *  line that a 26px box cannot show. With it the overflow is sideways, one
 *  line, and still inside the panel that clips. `e2e/settings-chrome-shots.mjs`
 *  plants a long chord to prove deleting it goes red. */
const SLOT_BOX =
  'vam-tap h-[26px] min-w-[112px] whitespace-nowrap rounded border px-2 text-center font-mono text-control';

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
    <li className="grid grid-cols-[1fr_minmax(112px,max-content)_minmax(112px,max-content)] items-center gap-x-[10px] py-[3px]">
      {/* The reset control rides in the label column rather than claiming a
          fourth one: a track that exists only on overridden rows would shove
          their key slots sideways, and the operator asked for three columns.
          `min-w-0` overrides a grid item's auto minimum, so a long label
          truncates here instead of widening the track. */}
      <span className="flex min-w-0 items-center gap-2">
        {/* While the row is armed the label column carries the instruction that
            used to live in the capture box's 160px placeholder -- which is how
            the box keeps the same geometry in every state. The armed box takes
            a fixed `w-[112px]` rather than `SLOT_BOX`'s floor: an `<input>`
            with no width contributes its `size` default (about twenty
            characters) to a `max-content` track, so arming a row would widen
            the whole column for as long as the box was open. */}
        {/* A DESCRIPTION, NOT A NAME, so it takes sentence case like a hint
            rather than the capitalisation a control's name takes. */}
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
              placeholder={t('settings.keyboard.capture')}
              onKeyDown={(event) => onKey(slot, event)}
              onBlur={() => onCapture(null)}
              // The ring is drawn permanently here, not on `focus-visible`: it
              // is showing the armed state, not the cursor. It is also the only
              // permanent ring on this surface, which is how the operator tells
              // which Escape they are about to press.
              className={`${SLOT_BOX} w-[112px] border-ink bg-raised text-ink outline-2 outline-ink outline-offset-2`}
            />
          );
        }
        // A key another action wins is drawn STRUCK THROUGH and says so in its
        // accessible name — a slot that looks like every other slot is exactly
        // how F3 stayed invisible, and a strikethrough alone is nothing at all
        // to a screen reader.
        const dead = keys === undefined ? undefined : row.dead[keys];
        const said = keys === undefined ? undefined : chordSymbols(keys);
        // An empty second slot is still a control: it is how a second binding
        // is added, and it is the only affordance that says one is possible.
        return (
          <button
            key={slot}
            type="button"
            data-binding-slot={`${row.id}:${slot}`}
            data-binding-dead={dead === undefined ? undefined : keys}
            title={dead === undefined ? undefined : `dead — ${dead} has "${said}"`}
            aria-label={
              said === undefined
                ? `add a key for ${row.label}`
                : dead === undefined
                  ? `${said}, ${row.label}`
                  : `${said}, ${row.label} — dead, ${dead} has this key`
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
              // PAINTED THROUGH `ChordGlyphs`, NOT `said` DIRECTLY — see the
              // component's own doc comment for why a slot's `font-mono`
              // otherwise paints a noticeably narrower ⌘.
              <kbd data-settings-keys className="border-none bg-transparent">
                <ChordGlyphs chord={keys} />
              </kbd>
            )}
          </button>
        );
      })}
    </li>
  );
}

/* ---------------------------------------------------------------------------
 * The terminal's colour scheme: two theme rows, the colour grid, the opacity.
 * ------------------------------------------------------------------------ */

/**
 * The three colours a chip previews: the ground, the ink and the caret. They
 * are the three a screen shows before any agent has written a coloured run,
 * which makes them the picture of a scheme the way pane, card and In bubble
 * are the picture of a palette (the template chips above). NOT the ANSI ramp:
 * eight discs on a 28px chip are a barcode, and the ramp is what the grid
 * below is for.
 */
const THEME_PREVIEW: readonly TerminalSchemeKey[] = ['background', 'foreground', 'cursor'];

/** Only a plain six-digit colour, with or without its hash: the shape the
 *  setter accepts, and the one a person pastes from any palette page. Case is
 *  kept as typed, as the setter keeps it. */
const TYPED_HEX = /^#?([0-9a-f]{6})$/i;

function typedHex(raw: string): string | null {
  const match = TYPED_HEX.exec(raw.trim());
  return match === null ? null : `#${match[1]}`;
}

/**
 * THE ADVANCED HALF OF THE TERMINAL CARD: the colour grid (edits the theme on
 * screen) and the background opacity slider. The two theme-picker rows
 * (`TerminalThemeRow`, one per app theme) are NOT drawn here any more — they
 * sit in the card's own "Themes" sub-group, always on screen, because
 * choosing a published scheme by name is the row most operators DO touch;
 * only overriding one of its colours by hand is rare enough to earn Advanced.
 */
function TerminalAdvancedRows({
  prefs,
  theme,
  onChange,
}: {
  readonly prefs: Prefs;
  readonly theme: EffectiveTheme;
  readonly onChange: (next: Prefs) => void;
}) {
  const other: EffectiveTheme = theme === 'dark' ? 'light' : 'dark';
  const resolved = resolveTerminalScheme(prefs.terminalScheme, theme);
  const overrides = prefs.terminalScheme[theme].overrides;
  const overridden = Object.keys(overrides).length > 0;
  const percent = Math.round(prefs.terminalScheme.backgroundOpacity * 100);
  return (
    <>
      <SettingsRow
        name="terminal-colours"
        label={t('settings.terminal.colours.label', { theme })}
        hint={t('settings.terminal.colours.hint', { theme, other })}
        action={
          overridden ? (
            <SmallButton
              label={t('settings.terminal.colours.reset', { theme })}
              onPick={() => onChange(clearTerminalSchemeOverrides(prefs, theme))}
            />
          ) : null
        }
      >
        {/* TWO COLUMNS, MEASURED. A cell is a 24px swatch, a 72px hex field, a
            16px reset slot and three 8px gaps around a label, and the widest
            label ("selection background") sets at 130px in the body face --
            266px a cell. The ANSI ramp would read better as two rows of eight,
            and cannot: a hex field per colour is what the operator asked for. */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-[10px] sm:grid-cols-2">
          {TERMINAL_SCHEME_KEYS.map((key) => {
            const label = TERMINAL_SCHEME_LABELS[key];
            const hex = resolved[key];
            const moved = overrides[key] !== undefined;
            return (
              /* THE RESET SLOT IS ALWAYS THERE, 16px wide, and only sometimes
                 holds a button: with an `auto` track the hex field would
                 step sideways every time a reset appeared beside it. */
              <div
                key={key}
                data-terminal-colour={key}
                data-terminal-overridden={moved ? '' : undefined}
                // THE RAMP STARTS A ROW OF ITS OWN. Seven named colours in two
                // columns leave `black` in the right-hand cell of the fourth
                // row, and from there the sixteen read as nothing -- pushed to
                // the first column they read as the pairs every emulator lists
                // them in.
                className={`grid grid-cols-[24px_minmax(0,1fr)_auto_16px] items-center gap-x-[8px] ${
                  key === 'black' ? 'sm:col-start-1' : ''
                }`}
              >
                {/* THE SAME DISC AS THE PALETTE'S, ring and all. THE FILL IS
                    SET TWICE ON PURPOSE: `value` is what Chromium paints in
                    the swatch's shadow part, unreadable through
                    `getComputedStyle` -- measured, it answers transparent --
                    so the element's own background carries the same colour
                    underneath it, where a guard can read it. */}
                <input
                  type="color"
                  data-terminal-swatch={key}
                  aria-label={`terminal ${label} colour, ${theme}`}
                  value={hex}
                  style={{ backgroundColor: hex }}
                  onChange={(event) =>
                    onChange(setTerminalSchemeColor(prefs, theme, key, event.target.value))
                  }
                  className={`vam-swatch vam-tap h-[24px] w-[24px] cursor-pointer rounded-full border-none p-0 ${FOCUS_RING} ${
                    moved ? 'ring-2 ring-ink' : 'ring-1 ring-ink-faint'
                  }`}
                />
                <span className="text-body text-ink capitalize">{label}</span>
                <HexField
                  name={`terminal ${label} hex, ${theme}`}
                  hook={key}
                  value={hex}
                  onCommit={(next) => onChange(setTerminalSchemeColor(prefs, theme, key, next))}
                />
                <span className="flex justify-center">
                  {moved ? (
                    <button
                      type="button"
                      data-terminal-reset={key}
                      aria-label={`reset terminal ${label} colour, ${theme}`}
                      onClick={() => onChange(clearTerminalSchemeColor(prefs, theme, key))}
                      className={`vam-hit-24 flex h-[24px] w-[16px] cursor-pointer items-center justify-center rounded text-ink-dim hover:text-ink ${FOCUS_RING}`}
                    >
                      <RotateCcw size={12} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </SettingsRow>

      {/* A SLIDER, WHERE `Stepper` ARGUES AGAINST ONE, and the two arguments
          do not collide. The stepper refused a range input for its CHROME: a
          track and a thumb in the OS accent colour that no token reaches.
          This one is drawn with `appearance: none` and two tokens, so there
          is no such chrome. And the quantity is different in kind: a text
          size is read as a number and set to one, where an opacity is
          WATCHED -- the operator drags it and looks at the screen behind the
          dialog. The value is still printed, because a thumb's position is
          not a fact anyone can repeat to somebody else. */}
      <SettingsRow
        name="terminal-background"
        label={t('settings.terminal.opacity.label')}
        hint={t('settings.terminal.opacity.hint')}
      >
        <div className="flex items-center gap-3">
          {/* THE TRACK IS `ink-faint` AND THE THUMB IS `ink` (`.vam-slider`,
              styles.css), for the switch's reason: no line token clears
              1.4.11's 3:1 on this panel, and the parts that carry the state
              have to. */}
          <input
            type="range"
            data-terminal-opacity
            aria-label="terminal background opacity"
            aria-valuetext={`${percent}%`}
            min={TERMINAL_BACKGROUND_OPACITY_MIN}
            max={TERMINAL_BACKGROUND_OPACITY_MAX}
            step={TERMINAL_BACKGROUND_OPACITY_STEP}
            value={prefs.terminalScheme.backgroundOpacity}
            onChange={(event) =>
              onChange(setTerminalBackgroundOpacity(prefs, Number(event.target.value)))
            }
            className={`vam-slider vam-tap h-[24px] w-[180px] cursor-pointer ${FOCUS_RING}`}
          />
          <span
            data-terminal-opacity-value
            className="w-[4ch] font-mono text-control text-ink-dim capitalize"
          >
            {percent}%
          </span>
        </div>
      </SettingsRow>
    </>
  );
}

/** One app theme's row of scheme chips, the one in force pressed. */
function TerminalThemeRow({
  on,
  prefs,
  onChange,
}: {
  readonly on: EffectiveTheme;
  readonly prefs: Prefs;
  readonly onChange: (next: Prefs) => void;
}) {
  const chosen = prefs.terminalScheme[on].theme;
  const fallback = terminalThemesFor(on).find((theme) => theme.id === DEFAULT_TERMINAL_THEME[on]);
  return (
    <SettingsRow
      name={`terminal-theme-${on}`}
      label={t('settings.terminal.theme.label', { on })}
      hint={t('settings.terminal.theme.hint', {
        on,
        default: fallback?.label ?? DEFAULT_TERMINAL_THEME[on],
      })}
    >
      <div data-terminal-theme-row={on} className="flex flex-wrap gap-1.5">
        {terminalThemesFor(on).map((theme) => (
          <TerminalThemeChip
            key={theme.id}
            theme={theme}
            pressed={chosen === theme.id}
            onPick={() => onChange(setTerminalTheme(prefs, on, theme.id))}
          />
        ))}
      </div>
    </SettingsRow>
  );
}

/**
 * The palette template chip's geometry -- three overlapped discs and a name
 * on a 28px pill -- with the terminal-size button's STATE: this is a choice
 * that stays chosen, so the pressed one wears the pressed fill and says so.
 *
 * THE NAME IS VERBATIM. Every other control name on this surface is
 * capitalised by the panel's CSS, and these are the names the palettes are
 * published under: `vam` is the product and is spelled lower everywhere it
 * appears, `Catppuccin Mocha` already carries its own capitals. So the label
 * opts out with `data-verbatim`, the same attribute the Update section's
 * version line uses for the same reason -- somebody chose these letters --
 * and `e2e/settings-chrome-shots.mjs` measures that a verbatim control
 * starting with the product name paints it lower case.
 */
function TerminalThemeChip({
  theme,
  pressed,
  onPick,
}: {
  readonly theme: TerminalTheme;
  readonly pressed: boolean;
  readonly onPick: () => void;
}) {
  return (
    <button
      type="button"
      data-terminal-theme={theme.id}
      aria-pressed={pressed}
      aria-label={`${theme.label} terminal theme, ${theme.on}`}
      title={`studied from ${theme.studied}`}
      onClick={onPick}
      className={`vam-tap flex h-[28px] cursor-pointer items-center gap-2 rounded border px-2.5 text-control capitalize ${FOCUS_RING} ${
        pressed
          ? 'border-line-loudest bg-raised text-ink'
          : 'border-line text-ink-dim hover:border-line-loud hover:text-ink'
      }`}
    >
      <span aria-hidden="true" className="flex items-center">
        {THEME_PREVIEW.map((key, i) => (
          <span
            key={key}
            data-theme-disc={key}
            className="h-[13px] w-[13px] rounded-full ring-1 ring-line-loud"
            style={{ backgroundColor: theme.scheme[key], marginLeft: i === 0 ? 0 : -4 }}
          />
        ))}
      </span>
      <span data-verbatim className="normal-case">
        {theme.label}
      </span>
    </button>
  );
}

/**
 * A hex colour, typed. The `Stepper`'s draft idiom: what is being typed
 * stays in the box while it is being typed, is committed the moment it is a
 * colour, and is dropped on blur -- so a box left holding `#12` shows the
 * stored value again rather than a colour that was never written. The
 * setter refuses anything that is not six hex digits, so a commit is only
 * ever attempted with a value it will take.
 *
 * The pill is the stepper's: `well` under `ink-faint`, because `well` on
 * `panel` is 1.03:1 and the border is the control's sole identifier.
 */
function HexField({
  name,
  hook,
  value,
  onCommit,
}: {
  readonly name: string;
  readonly hook: TerminalSchemeKey;
  readonly value: string;
  readonly onCommit: (hex: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      data-terminal-hex={hook}
      aria-label={name}
      spellCheck={false}
      autoComplete="off"
      maxLength={7}
      value={draft ?? value}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        const hex = typedHex(raw);
        if (hex !== null) onCommit(hex);
      }}
      onBlur={() => setDraft(null)}
      className={`vam-tap h-[24px] w-[72px] rounded border border-ink-faint bg-well px-1.5 text-center font-mono text-control text-ink outline-none ${FOCUS_RING}`}
    />
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
  'vam-tap flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded text-ink-dim hover:bg-segment-on hover:text-ink disabled:cursor-default disabled:text-ink-faint disabled:hover:bg-transparent disabled:hover:text-ink-faint';

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
 * border is its sole identifier and owes 1.4.11 its 3:1.
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
