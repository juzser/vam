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

import { useEffect, useRef } from 'react';
import { buildKeySheet, describeAction } from '../keyboard/keysheet.js';
import { ALL_VISIBLE, LAYOUTS, type LayoutName } from '../prefs/panes.js';
import {
  FOCUS_SHARE_MAX,
  FOCUS_SHARE_MIN,
  type Prefs,
  setFocusShare,
  setLayout,
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
  const same = (other: Prefs['paneVisibility']) =>
    other.sidebar === visibility.sidebar &&
    other.canvas === visibility.canvas &&
    other.detail === visibility.detail;
  if (same(ALL_VISIBLE)) {
    return FULL;
  }
  return (Object.keys(LAYOUTS) as LayoutName[]).find((name) => same(LAYOUTS[name])) ?? null;
}

const THEMES: readonly Theme[] = ['dark', 'light', 'system'];

export function SettingsOverlay({ prefs, onChange, onClose }: SettingsOverlayProps) {
  const closeButton = useRef<HTMLButtonElement | null>(null);

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
      aria-label="settings"
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

        <Section title="appearance" hint="system follows what the operating system asks for">
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
        </Section>

        <Section title="focus zoom" hint="how much of the canvas a focused session fills">
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
        </Section>

        <Section title="layout" hint="the same layouts the z chords apply">
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
        </Section>

        <Section title="keyboard" hint="read-only — generated from the chord tables">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {buildKeySheet().map((group) => (
              <section key={group.group}>
                <h4 className="mb-1 text-ink-faint text-xs uppercase tracking-wide">
                  {group.title}
                </h4>
                <ul>
                  {group.rows.map((row) => (
                    <li key={row.keys} className="flex items-baseline gap-2 py-0.5 text-xs">
                      <kbd
                        data-settings-keys
                        className="min-w-12 rounded border border-line bg-raised px-1 text-center font-mono text-ink"
                      >
                        {row.keys}
                      </kbd>
                      <span className="text-ink-dim">{row.label}</span>
                    </li>
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
