/**
 * `,` and the gear — the settings the operator already had, made editable.
 *
 * Four sections, and every one of them is wiring rather than invention: the
 * theme is `prefs.theme` and `applyTheme`, which shipped long ago with one
 * toggle as their whole interface; the layout section is a
 * picker over `LAYOUTS`, which another epic built and this one only reads; and
 * the keyboard reference is `buildKeySheet()`, the same generator the `?` sheet
 * renders, so a row here can only exist because a binding exists.
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
  bindingConflict,
  bindKey,
  clearBindings,
  isReserved,
  type KeyBindings,
  MAX_BINDINGS,
  NO_BINDINGS,
  normalizeKey,
} from '../keyboard/chords.js';
import { type BindingRow, buildBindingSheet, describeAction } from '../keyboard/keysheet.js';
import { ALL_VISIBLE, columnOrder, LAYOUTS, type LayoutName } from '../prefs/panes.js';
import {
  clearPalette,
  clearPaletteColor,
  OUT_FONT_SIZE_MAX,
  OUT_FONT_SIZE_MIN,
  PALETTE_TOKENS,
  type Prefs,
  paletteValue,
  setKeyBindings,
  setLayout,
  setOutFontSize,
  setPaletteColor,
  setPaneVisibility,
  setTheme,
  type Theme,
} from '../prefs/prefs.js';
import { LayoutPicker } from './LayoutPicker.js';
import { FULL, type LayoutChoice, SECTIONS, type SectionId } from './sections.js';

export type SettingsOverlayProps = {
  readonly prefs: Prefs;
  readonly onChange: (next: Prefs) => void;
  readonly onClose: () => void;
};

/** Derived from the same table the `?` sheet reads, so the picker cannot
 *  advertise a layout the chord layer never built. */
function layoutLabel(choice: LayoutChoice): string {
  return choice === FULL
    ? 'everything on screen'
    : describeAction({ kind: 'layout', name: choice }).label;
}

/** Which choice the stored visibility IS, or null when a hand-set combination
 *  matches none of them — an unmarked picker is honest, a wrong mark is not. */
export function currentLayout(visibility: Prefs['paneVisibility']): LayoutChoice | null {
  const order = columnOrder(visibility);
  const same = (other: Prefs['paneVisibility']) =>
    other.sidebar === visibility.sidebar &&
    other.canvas === visibility.canvas &&
    other.detail === visibility.detail &&
    // The order as well as the visibility, or the focus layout — which draws
    // all three columns, like the shipped one — would light up the `full` mark.
    columnOrder(other).join() === order.join();
  if (same(ALL_VISIBLE)) {
    return FULL;
  }
  return (Object.keys(LAYOUTS) as LayoutName[]).find((name) => same(LAYOUTS[name])) ?? null;
}

const THEMES: readonly Theme[] = ['dark', 'light', 'system'];

/** Which slot is listening for a keystroke, spelled as one value so opening a
 *  second capture box closes the first by construction. */
type Capturing = { readonly id: string; readonly slot: number } | null;

/**
 * vam has no focus-ring idiom, and the one `focus-visible` in the renderer
 * (`TerminalTab.tsx`) draws `line-strong`, which is 1.36:1 on `panel` in dark —
 * invisible in the default theme. `ink` is 15.7 / 17.7 there and clears on
 * every fill this dialog uses. The offset matters: flush against a tile's own
 * border, an outline reads as a thicker border rather than as a cursor.
 */
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

export function SettingsOverlay({ prefs, onChange, onClose }: SettingsOverlayProps) {
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  // Component state, not a pref: which pane you last had open is not a setting,
  // and persisting it would open the overlay somewhere different every time.
  const [section, setSection] = useState<SectionId>('appearance');
  const [capturing, setCapturing] = useState<Capturing>(null);
  const [message, setMessage] = useState('');
  const wide = useWideNav();

  const bind = (next: KeyBindings) => {
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
      setMessage(`"${key}" is reserved — Escape cancels this capture, g/y/z open chords`);
      return;
    }
    const clash = bindingConflict(prefs.keyBindings, row.id, key);
    if (clash !== null) {
      // Refused rather than stolen, and named. Stealing would leave the other
      // action silently unbound, discoverable only by pressing its key and
      // watching nothing happen — the worse of the two failures.
      setMessage(`"${key}" already does: ${labelFor(prefs.keyBindings, clash)}`);
      return;
    }
    bind(bindKey(prefs.keyBindings, row.id, slot, key));
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

  const layout = currentLayout(prefs.paneVisibility);

  return (
    <div
      data-settings-overlay
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
        className="absolute inset-0 cursor-default bg-canvas/70"
        onMouseDown={onClose}
      />
      {/* Fixed height, not `max-h`: with a nav column, a box that resizes per
          section makes the nav jump under the cursor between a short pane and a
          long one. One height, one nav position; the panel scrolls. */}
      <div className="relative flex h-[min(600px,80vh)] w-[min(880px,94vw)] flex-col overflow-hidden rounded-md border border-line bg-panel">
        <div className="flex h-[38px] flex-none items-center gap-2 border-line border-b px-3">
          <h2 className="font-semibold text-[13px] text-ink">settings</h2>
          {/* `ink-faint` measures 3.44 / 3.46 against `panel` — it fails 4.5:1
              in both themes, and every hint in this overlay used to wear it.

              This is the only line on the surface visible regardless of scroll
              position and of which section is open, so it is where the two
              Escapes get named, in the order they will happen. `polite`
              announces the mode change without stealing the keystroke. */}
          <span role="status" aria-live="polite" className="text-[11px] text-ink-dim">
            {capturing === null
              ? 'stored in this browser, not in a session'
              : 'waiting for a key — Esc cancels, Esc again closes'}
          </span>
          <span className="flex-1" />
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            className={`rounded border border-line px-2 py-0.5 text-ink-dim text-xs ${FOCUS_RING}`}
          >
            Esc
          </button>
        </div>

        {/* `min-h-0` or the panel's scroll container will not shrink inside the
            flex column, and the fixed height above becomes an overflow. */}
        <div className="flex min-h-0 flex-1">
          {wide ? <SectionRail section={section} onGo={go} onStep={step} /> : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {wide ? null : <SectionStrip section={section} onGo={go} onStep={step} />}

            <Panel
              id="appearance"
              active={section === 'appearance'}
              hint="theme, colours and the size of the text in out"
            >
              <Block label="theme" hint="system follows what the operating system asks for">
                <div className="flex gap-1">
                  {THEMES.map((theme) => (
                    <Choice
                      key={theme}
                      label={theme}
                      selected={prefs.theme === theme}
                      onPick={() => onChange(setTheme(prefs, theme))}
                    />
                  ))}
                </div>
              </Block>

              <Block
                label="colours"
                hint="unset follows the stylesheet, so each theme keeps its own"
                action={
                  Object.keys(prefs.palette).length === 0 ? null : (
                    <SmallButton
                      label="reset colours"
                      onPick={() => onChange(clearPalette(prefs))}
                    />
                  )
                }
              >
                <div className="grid grid-cols-2 gap-x-6 gap-y-[10px] sm:grid-cols-3">
                  {PALETTE_TOKENS.map(({ token, label }) => {
                    const overridden = prefs.palette[token] !== undefined;
                    return (
                      <div key={token} className="flex items-center gap-[10px]">
                        {/* The fill here is operator data — an override of the
                            panel's own colour paints a disc invisible against
                            the surface it sits on — so the EDGE identifies the
                            control, and owes 3:1. `ink-faint` is the only kit
                            token that clears it in both themes.
                            Overridden reads as weight and lightness (1px faint
                            to 2px ink), never as hue, and the reset button
                            beside it carries the same state as a shape. */}
                        <input
                          type="color"
                          data-palette-swatch={token}
                          aria-label={`${label} colour`}
                          value={paletteValue(prefs.palette, token)}
                          onChange={(event) =>
                            onChange(setPaletteColor(prefs, token, event.target.value))
                          }
                          className={`vam-swatch h-[22px] w-[22px] cursor-pointer rounded-full border-none bg-transparent p-0 ${FOCUS_RING} ${
                            overridden ? 'ring-2 ring-ink' : 'ring-1 ring-ink-faint'
                          }`}
                        />
                        <span className="text-[13px] text-ink">{label}</span>
                        {overridden ? (
                          <button
                            type="button"
                            aria-label={`reset ${label} colour`}
                            onClick={() => onChange(clearPaletteColor(prefs, token))}
                            className={`cursor-pointer text-ink-dim hover:text-ink ${FOCUS_RING}`}
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

              {/* Here rather than in Canvas, by Canvas's own argument: focus
                  zoom went there because it is how the canvas VIEWPORT
                  behaves. A text size is not behaviour, it is the paint — the
                  family the theme and the palette above it are in. And `out`
                  is the right pane, drawn by two layouts that hide the canvas
                  entirely; a fifth section for one control is the padding the
                  settings spec rules out. */}
              <Block
                label="out text"
                hint="how large the agent's answer is drawn in the right pane"
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
            </Panel>

            <Panel
              id="layout"
              active={section === 'layout'}
              hint="the same layouts the z chords apply"
            >
              <LayoutPicker
                current={layout}
                label={layoutLabel}
                onPick={(choice) =>
                  onChange(
                    choice === FULL
                      ? setPaneVisibility(prefs, ALL_VISIBLE)
                      : setLayout(prefs, choice),
                  )
                }
              />
            </Panel>

            <Panel
              id="canvas"
              active={section === 'canvas'}
              hint="how the canvas itself behaves — not a colour, and not chrome"
            >
              {/* The focus zoom share used to live here. The automatic zoom
                  onto a focused node is gone — it overrode a zoom the operator
                  had set by hand — so the control configured nothing and went
                  with it. `prefs.focusViewportShare` deliberately stays in the
                  store: dropping a persisted field is a data migration, and
                  prefs degrade per field, so an unread one is inert. */}
            </Panel>

            <Panel
              id="keyboard"
              active={section === 'keyboard'}
              hint="click a key and press the one you want — Escape cancels"
            >
              {message === '' ? null : (
                <p data-binding-message className="mb-2 text-waiting text-xs">
                  {message}
                </p>
              )}
              <div className="mb-2">
                {Object.keys(prefs.keyBindings).length === 0 ? null : (
                  <SmallButton label="reset shortcuts" onPick={() => bind(NO_BINDINGS)} />
                )}
              </div>
              {/* One column, not two. Groups of unequal length interleaved
                  vertically, so a heading marked the top of one of two parallel
                  streams rather than a boundary; the cost is scroll length on a
                  panel that already scrolls, which is the cheaper thing. */}
              <div className="flex flex-col">
                {buildBindingSheet(prefs.keyBindings).map((group) => (
                  <section key={group.group} className="mt-7 first:mt-0">
                    <h4 className="mb-[10px] border-line-loud border-b pb-[6px] font-semibold text-[13px] text-ink">
                      {group.title}
                    </h4>
                    <ul>
                      {group.rows.map((row) => (
                        <BindingLine
                          key={row.id}
                          row={row}
                          capturing={capturing}
                          onCapture={setCapturing}
                          onKey={(slot, event) => capture(row, slot, event)}
                          onReset={() => bind(clearBindings(prefs.keyBindings, row.id))}
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
        <span className="font-mono text-[9.5px] text-ink-dim uppercase tracking-[0.12em]">
          Sections
        </span>
      </div>
      <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-0.5 p-1.5">
        {SECTIONS.map(({ id, label, Icon }) => {
          const selected = props.section === id;
          return (
            <button
              key={id}
              {...tabProps(props, id)}
              // `segment-on` on `sidebar` is 1.36:1 — below the 3:1 an
              // author-drawn state needs — so a 2px rail in `ink` (15.3:1)
              // carries the selection. The unselected items reserve the same
              // 2px in `transparent`, or the label jumps when selection moves.
              className={`flex h-[28px] w-full cursor-pointer items-center gap-2 rounded-[7px] border-l-2 pr-2 pl-[6px] text-left text-[12px] ${FOCUS_RING} ${
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
 * re-invented. Not an icon rail — `lucide-react` has no glyph that
 * unambiguously means "Layout" at 13px with no label, and four new symbols is a
 * poor trade for 168px on a window size a desktop tool is rarely at.
 */
function SectionStrip(props: NavProps) {
  return (
    <div
      data-settings-nav
      role="tablist"
      aria-orientation="horizontal"
      className="mb-[11px] flex items-center gap-[3px] rounded-[9px] border border-line-loud bg-well p-[3px] md:hidden"
    >
      {SECTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          {...tabProps(props, id)}
          className={`flex h-[26px] flex-1 cursor-pointer items-center justify-center gap-[5px] rounded-[7px] text-[12px] ${FOCUS_RING} ${
            props.section === id
              ? 'bg-segment-on font-medium text-ink'
              : 'text-ink-dim hover:text-ink'
          }`}
        >
          <Icon size={13} strokeWidth={1.6} />
          {/* Four labels at 12px do not fit 300px of strip. */}
          <span className="hidden sm:inline">{label}</span>
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
  // Optional, because a section can be empty: Canvas is, since the automatic
  // focus zoom it configured was removed. The heading and its hint still say
  // what the section is for, which is the honest state to be in until either
  // the next canvas setting lands or the section itself is retired.
  readonly children?: React.ReactNode;
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
          the heading has to out-rank four setting labels already at 13px. No
          uppercase — at this size it reads as shouting and costs the word-shape
          a scanned list is read by. */}
      <div className="mb-5 border-line-loud border-b pb-3">
        <h3 className="font-semibold text-[15px] text-ink">{id}</h3>
        <span className="text-[12px] text-ink-dim">{hint}</span>
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
      className={`flex h-[28px] cursor-pointer items-center rounded border px-3 text-[12px] ${FOCUS_RING} ${
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
 *  identifier of the control and owes 1.4.11 its 3:1. */
const SLOT_BOX = 'h-[26px] w-[68px] rounded-[6px] border px-2 text-center font-mono text-[12px]';

/** One action: its name, its slots, and a way back to the shipped keys. */
function BindingLine({
  row,
  capturing,
  onCapture,
  onKey,
  onReset,
}: {
  readonly row: BindingRow;
  readonly capturing: Capturing;
  readonly onCapture: (next: Capturing) => void;
  readonly onKey: (slot: number, event: React.KeyboardEvent) => void;
  readonly onReset: () => void;
}) {
  const slots = Array.from({ length: MAX_BINDINGS }, (_, slot) => slot);
  const armed = capturing?.id === row.id;
  return (
    // Fixed key columns are what makes the list scan: every label starts at the
    // same x, so the eye reads a column of actions rather than a ragged edge.
    <li className="grid grid-cols-[68px_68px_1fr_auto] items-center gap-x-[10px] py-[3px]">
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
              placeholder="press a key… Esc to cancel"
              onKeyDown={(event) => onKey(slot, event)}
              onBlur={() => onCapture(null)}
              // The ring is drawn permanently here, not on `focus-visible`: it
              // is showing the armed state, not the cursor. It is also the only
              // permanent ring on this surface, which is how the operator tells
              // which Escape they are about to press.
              className={`${SLOT_BOX} border-ink bg-raised text-ink outline-2 outline-ink outline-offset-2`}
            />
          );
        }
        // An empty second slot is still a control: it is how a second binding
        // is added, and it is the only affordance that says one is possible.
        return (
          <button
            key={slot}
            type="button"
            data-binding-slot={`${row.id}:${slot}`}
            aria-label={keys === undefined ? `add a key for ${row.label}` : `${keys}, ${row.label}`}
            onClick={() => onCapture({ id: row.id, slot })}
            className={`${SLOT_BOX} cursor-pointer hover:border-ink hover:text-ink ${FOCUS_RING} ${
              keys === undefined
                ? 'border-ink-faint border-dashed bg-transparent text-ink-dim'
                : 'border-ink-faint bg-sunken text-ink'
            }`}
          >
            {keys === undefined ? (
              // `ink-ghost` is 1.75:1 in dark — a `+` nobody can see is not an
              // affordance. This is a meaningful non-text mark at 7.13 / 7.73.
              <Plus size={12} strokeWidth={2} className="mx-auto" aria-hidden="true" />
            ) : (
              <kbd data-settings-keys className="border-none bg-transparent">
                {keys}
              </kbd>
            )}
          </button>
        );
      })}
      {/* While the row is armed its label column carries the instruction that
          used to live in the capture box's 160px placeholder — which is how the
          box keeps the same 68px geometry in every state. */}
      <span className="text-[13px] text-ink">
        {armed ? 'press a key — Esc cancels' : row.label}
      </span>
      {row.overridden ? (
        <button
          type="button"
          data-binding-reset={row.id}
          aria-label={`reset ${row.label} shortcut`}
          onClick={onReset}
          className={`cursor-pointer text-ink-dim hover:text-ink ${FOCUS_RING}`}
        >
          <RotateCcw size={12} strokeWidth={1.8} aria-hidden="true" />
        </button>
      ) : null}
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
        <h4 className="font-medium text-[13px] text-ink">{label}</h4>
        {action === undefined ? null : <span className="ml-auto">{action}</span>}
      </div>
      {/* A 12px line running the full ~660px panel is a paragraph, not a
          caption. */}
      <p className="mt-1 max-w-[52ch] text-[12px] text-ink-dim">{hint}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SmallButton({ label, onPick }: { readonly label: string; readonly onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`cursor-pointer rounded border border-line px-2 py-0.5 text-ink-dim text-xs ${FOCUS_RING}`}
    >
      {label}
    </button>
  );
}

const STEP_BUTTON =
  'flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-[6px] text-ink-dim hover:bg-segment-on hover:text-ink disabled:cursor-default disabled:text-ink-faint disabled:hover:bg-transparent disabled:hover:text-ink-faint';

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
 * border is its sole identifier and owes 1.4.11 its 3:1. `line-loudest` is 2.08
 * in dark and fails that; `ink-faint` (3.46 / 3.44) is the only token in the kit
 * that clears it in both themes. See the refinement spec before substituting.
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
            nav and the layout picker already use in this overlay. */}
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
          className="h-[24px] w-[52px] bg-transparent text-center font-mono text-[12px] text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
      <span className="ml-2 font-mono text-[12px] text-ink-dim">{unit}</span>
    </div>
  );
}
