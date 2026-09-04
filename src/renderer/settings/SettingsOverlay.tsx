/**
 * `,` and the gear — the settings the operator already had, made editable.
 *
 * Four sections, and every one of them is wiring rather than invention: the
 * theme is `prefs.theme` and `applyTheme`, which shipped long ago with one
 * toggle as their whole interface; the focus zoom share is the constant in
 * `Canvas.tsx` whose own comment promised this pane; the layout section is a
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
  FOCUS_SHARE_MAX,
  FOCUS_SHARE_MIN,
  PALETTE_TOKENS,
  type Prefs,
  paletteValue,
  setFocusShare,
  setKeyBindings,
  setLayout,
  setPaletteColor,
  setPaneVisibility,
  setTheme,
  type Theme,
} from '../prefs/prefs.js';

export type SettingsOverlayProps = {
  readonly prefs: Prefs;
  readonly onChange: (next: Prefs) => void;
  readonly onClose: () => void;
};

/** The shipped layout is not in `LAYOUTS` — it is the absence of one, and it is
 *  what `z0` restores. Named here so the picker can offer a way back. */
const FULL = 'full';
type LayoutChoice = typeof FULL | LayoutName;

const LAYOUT_CHOICES: readonly LayoutChoice[] = [FULL, ...(Object.keys(LAYOUTS) as LayoutName[])];

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

export function SettingsOverlay({ prefs, onChange, onClose }: SettingsOverlayProps) {
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const [capturing, setCapturing] = useState<Capturing>(null);
  const [message, setMessage] = useState('');

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
      setMessage(`"${key}" is reserved — Escape cancels and closes, g/y/z open chords`);
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

  useEffect(() => {
    const returnTo = document.activeElement;
    closeButton.current?.focus();
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
      role="dialog"
      // Not plain "settings": the sidebar's gear already owns that accessible
      // name, and while this is open the two collide — `getByLabelText`
      // ("found multiple") and a screen reader alike.
      aria-label="settings panel"
      aria-modal="true"
      className="absolute inset-0 z-50 flex items-start justify-center pt-16"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <button
        type="button"
        aria-label="close settings"
        className="absolute inset-0 cursor-default bg-canvas/70"
        onMouseDown={onClose}
      />
      <div className="relative max-h-[80vh] w-[min(720px,92vw)] overflow-y-auto rounded-md border border-line bg-panel p-4">
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="font-semibold text-ink text-sm">settings</h2>
          <span className="text-ink-faint text-xs">stored in this browser, not in a session</span>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            className="ml-auto rounded border border-line px-2 py-0.5 text-ink-dim text-xs"
          >
            Esc
          </button>
        </div>

        <Section
          title="appearance"
          hint="theme, colours, zoom and layout — everything about how vam looks"
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
                <SmallButton label="reset colours" onPick={() => onChange(clearPalette(prefs))} />
              )
            }
          >
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
              {PALETTE_TOKENS.map(({ token, label }) => (
                <div key={token} className="flex items-center gap-2 text-xs">
                  <input
                    type="color"
                    aria-label={`${label} colour`}
                    value={paletteValue(prefs.palette, token)}
                    onChange={(event) =>
                      onChange(setPaletteColor(prefs, token, event.target.value))
                    }
                    className="h-5 w-8 cursor-pointer rounded border border-line bg-raised"
                  />
                  <span className="text-ink-dim">{label}</span>
                  {prefs.palette[token] === undefined ? null : (
                    <button
                      type="button"
                      aria-label={`reset ${label} colour`}
                      onClick={() => onChange(clearPaletteColor(prefs, token))}
                      className="cursor-pointer text-ink-faint"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Block>

          <Block label="focus zoom" hint="how much of the canvas a focused session fills">
            <div className="flex items-center gap-3">
              <input
                type="range"
                aria-label="focus zoom share"
                min={FOCUS_SHARE_MIN}
                max={FOCUS_SHARE_MAX}
                step={0.05}
                value={prefs.focusViewportShare}
                onChange={(event) => onChange(setFocusShare(prefs, Number(event.target.value)))}
                className="w-56"
              />
              <span className="font-mono text-ink-dim text-xs">
                {Math.round(prefs.focusViewportShare * 100)}%
              </span>
            </div>
          </Block>

          <Block label="layout" hint="the same layouts the z chords apply">
            <div className="flex gap-1">
              {LAYOUT_CHOICES.map((choice) => (
                <Choice
                  key={choice}
                  label={layoutLabel(choice)}
                  marker={choice}
                  selected={layout === choice}
                  onPick={() =>
                    onChange(
                      choice === FULL
                        ? setPaneVisibility(prefs, ALL_VISIBLE)
                        : setLayout(prefs, choice),
                    )
                  }
                />
              ))}
            </div>
          </Block>
        </Section>

        <Section title="keyboard" hint="click a key and press the one you want — Escape cancels">
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
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {buildBindingSheet(prefs.keyBindings).map((group) => (
              <section key={group.group}>
                <h4 className="mb-1 text-ink-faint text-xs uppercase tracking-wide">
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
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="border-line border-t py-3">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-ink text-xs uppercase tracking-wide">{title}</h3>
        <span className="text-ink-faint text-xs">{hint}</span>
      </div>
      {children}
    </section>
  );
}

function Choice({
  label,
  marker,
  selected,
  onPick,
}: {
  readonly label: string;
  readonly marker?: string;
  readonly selected: boolean;
  readonly onPick: () => void;
}) {
  return (
    <button
      type="button"
      {...(marker === undefined ? {} : { 'data-layout-option': marker })}
      aria-pressed={selected}
      onClick={onPick}
      className={`cursor-pointer rounded border px-2 py-1 text-xs ${
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
  return (
    <li className="flex items-baseline gap-2 py-0.5 text-xs">
      {slots.map((slot) => {
        const keys = row.keys[slot];
        if (capturing?.id === row.id && capturing.slot === slot) {
          return (
            <input
              key={slot}
              data-binding-capture
              aria-label={`press a key for ${row.label}`}
              readOnly
              value=""
              placeholder="press a key"
              onKeyDown={(event) => onKey(slot, event)}
              onBlur={() => onCapture(null)}
              className="min-w-12 rounded border border-line-loudest bg-raised px-1 text-center font-mono text-ink"
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
            className="cursor-pointer"
          >
            {keys === undefined ? (
              <span className="min-w-12 text-ink-ghost">+</span>
            ) : (
              <kbd
                data-settings-keys
                className="min-w-12 rounded border border-line bg-raised px-1 text-center font-mono text-ink"
              >
                {keys}
              </kbd>
            )}
          </button>
        );
      })}
      <span className="text-ink-dim">{row.label}</span>
      {row.overridden ? (
        <button
          type="button"
          data-binding-reset={row.id}
          aria-label={`reset ${row.label} shortcut`}
          onClick={onReset}
          className="cursor-pointer text-ink-faint"
        >
          ×
        </button>
      ) : null}
    </li>
  );
}

/** A labelled sub-block inside a section — appearance holds four of them. */
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
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-baseline gap-2">
        <h4 className="text-ink-dim text-xs">{label}</h4>
        <span className="text-ink-faint text-xs">{hint}</span>
        {action === undefined ? null : <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </div>
  );
}

function SmallButton({ label, onPick }: { readonly label: string; readonly onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="cursor-pointer rounded border border-line px-2 py-0.5 text-ink-dim text-xs"
    >
      {label}
    </button>
  );
}
