/**
 * The icon chooser — orca's emoji picker, and the coloured half orca does not
 * have.
 *
 * Orca ships `emoji-picker-react` (its bundle carries `.repo-icon-emoji-picker`
 * and `EmojiPickerReact`), so this is the same picker rather than an imitation:
 * a full set with search and categories. The first draft here was ten hardcoded
 * glyphs, which is a different thing wearing the same shape — the whole reason a
 * person picks an icon is that theirs means something to them, and a shortlist
 * decides in advance which meanings are available.
 *
 * THAT ARGUMENT SURVIVES THE GLYPH GRID ABOVE IT, and it is worth saying why
 * the two are not in tension. The operator asked for a COLOUR, and an emoji
 * cannot take one — it is a picture the font draws, and `color` does not reach
 * it. A glyph that can be recoloured has to be one vam draws itself, which is a
 * set vam has to name (`icon-value.tsx` argues its size). So the twenty-four
 * are not a shortlist of the emoji: they are the icons that CAN wear a tone,
 * offered BESIDE the unbounded set rather than instead of it. Nobody loses a
 * meaning; some meanings gain a colour.
 *
 * The emoji grid lives in its own lazy chunk (`EmojiGrid`) because the dataset
 * is 300kB and most sessions never open this. The shell you see here stays
 * synchronous, so `s` always puts a panel on screen at once — and the glyph
 * grid is part of that shell rather than a second lazy chunk: twenty-four named
 * imports are bytes the entry chunk barely notices, and a tone row that arrived
 * a frame late would be a control that flickers into existence.
 *
 * Rendered as an overlay from `Canvas`, the way the command palette is, because
 * the picker is wider than the 248px sidebar it belongs to.
 */

import { lazy, Suspense, useEffect, useRef } from 'react';
import {
  DEFAULT_TONE,
  ICON_GLYPH_NAMES,
  ICON_GLYPHS,
  ICON_TONE_INK,
  ICON_TONES,
  type IconValue,
  parseIcon,
  storedIcon,
} from './icon-value.js';

// The grid is a 300kB dataset; the shell around it is not. Only the grid waits.
const EmojiGrid = lazy(() => import('./EmojiGrid.js'));

/**
 * WHY THE TONE ROW CANNOT ACT, as a sentence, or `null` when it can.
 *
 * `ContextMenu.tsx` states the rule this implements: an item that cannot act is
 * drawn, disabled, AND SAYS WHY -- "a sentence, not a boolean: 'disabled' with
 * no reason is the failure this project keeps finding in its own controls."
 * Eight dimmed circles are exactly that failure. Dropping the row instead would
 * be worse: the panel would change shape depending on which kind of icon you
 * already had, so the colour control would be a feature you could only find by
 * accident -- the same "absent, not dimmed" question the context menu answered
 * the same way, and for the same reason.
 *
 * TWO REASONS, NOT ONE, because two different things are true. "You picked an
 * emoji, and an emoji cannot be repainted" is a fact about the icon; "you have
 * not picked anything yet" is a fact about the picker. Collapsing them would
 * tell an operator with no icon at all that their emoji was the problem.
 *
 * Exported so the sentence on screen and the sentence a `title` carries are one
 * string, and so a test asserts the module's own words rather than a second
 * copy of them.
 */
export function toneRefusal(value: IconValue | null): string | null {
  if (value === null) return 'pick a glyph above — a tone paints the glyph, and there is none yet';
  if (value.kind === 'emoji') {
    return 'an emoji brings its own colours — pick a glyph above to use a tone';
  }
  return null;
}

export type IconPickerProps = {
  /** The session being given an icon — named so you cannot pick for the wrong one. */
  readonly title: string;
  /**
   * WHAT IS STORED FOR THIS TARGET RIGHT NOW, in its stored form.
   *
   * The picker needs it for two things it could not otherwise do: mark what is
   * already chosen, and answer "can a tone act here at all". It is the raw
   * string rather than a parsed value so that every caller keeps handing over
   * exactly what it holds in prefs, and the one reader of the format stays
   * `icon-value.tsx`.
   */
  readonly value: string | null;
  readonly onPick: (icon: string) => void;
  readonly onClose: () => void;
};

export function IconPicker({ title, value, onPick, onClose }: IconPickerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const current = parseIcon(value);
  const refused = toneRefusal(current);
  const chosenGlyph = current?.kind === 'glyph' ? current.glyph : null;
  // The tone a NEW glyph is born in: the one already on screen if there is one,
  // so that changing the picture is not a silent second edit to the colour.
  const chosenTone = current?.kind === 'glyph' ? current.tone : DEFAULT_TONE;

  // Escape has to work from inside the picker's own search box, which the window
  // listener deliberately ignores along with every other input.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }
    const shell = shellRef.current;
    shell?.addEventListener('keydown', onKeyDown);
    return () => shell?.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      data-overlay-host
      className="absolute inset-0 z-30 flex items-start justify-center pt-[12vh]"
    >
      <button
        type="button"
        aria-label="close the icon panel"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ground/70"
      />
      <div
        ref={shellRef}
        data-icon-picker
        // The width lives here rather than on the grid because the phone
        // sheet needs the grid to be `100%` of whatever the sheet is; on the
        // desktop the panel is what fixes the picker at the grid's own 340px.
        className="relative z-10 w-[340px] overflow-hidden rounded-[var(--radius-lg)] border border-line bg-panel shadow-[var(--shadow-node)]"
      >
        <div className="flex items-center gap-2 border-line border-b px-3 py-2">
          <span className="text-meta text-ink-faint">icon cho</span>
          <span className="font-mono font-semibold text-body text-ink">{title}</span>
          <button
            type="button"
            onClick={() => onPick('')}
            className="ml-auto cursor-pointer rounded-[var(--radius-sm)] border border-line px-1.5 py-0.5 text-control text-ink-dim hover:border-line-strong hover:text-ink"
          >
            clear icon
          </button>
        </div>

        {/* THREE ROWS OF EIGHT, and the tone row below is eight wide too, so the
            two controls are one grid and read as one decision: which picture,
            and what colour. */}
        <div data-icon-glyphs className="grid grid-cols-8 gap-1 border-line border-b px-2 py-2">
          {ICON_GLYPH_NAMES.map((name) => {
            const Glyph = ICON_GLYPHS[name];
            const on = name === chosenGlyph;
            return (
              <button
                key={name}
                type="button"
                data-icon-choice={name}
                aria-pressed={on}
                // THE NAME, SPOKEN. An icon button has nowhere to put a label,
                // and "button" twenty-four times is a list nobody can use.
                aria-label={`icon ${name}`}
                title={name}
                onClick={() => onPick(storedIcon({ kind: 'glyph', glyph: name, tone: chosenTone }))}
                className={`flex h-7 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] ${
                  on ? 'bg-line-strong text-ink' : 'hover:bg-raised'
                }`}
              >
                {/* Drawn in the tone it WOULD take, so the grid previews the
                    pick rather than offering a menu of grey shapes: choose teal,
                    and the glyphs are teal before the press rather than after. */}
                <Glyph
                  aria-hidden="true"
                  size={15}
                  strokeWidth={1.7}
                  className={ICON_TONE_INK[chosenTone]}
                />
              </button>
            );
          })}
        </div>

        <div data-icon-tones className="border-line border-b px-2 py-2">
          <div className="grid grid-cols-8 gap-1">
            {ICON_TONES.map((tone) => {
              const on = current?.kind === 'glyph' && current.tone === tone;
              return (
                <button
                  key={tone}
                  type="button"
                  data-icon-tone-swatch={tone}
                  aria-pressed={on}
                  aria-label={`colour ${tone}`}
                  disabled={refused !== null}
                  title={refused ?? tone}
                  onClick={() => {
                    // Unreachable while `disabled` holds; kept because the
                    // guard is about the DATA (there is no glyph to repaint),
                    // and an attribute is not where that belongs.
                    if (chosenGlyph === null) return;
                    onPick(storedIcon({ kind: 'glyph', glyph: chosenGlyph, tone }));
                  }}
                  className={`flex h-7 items-center justify-center rounded-[var(--radius-sm)] ${
                    refused === null
                      ? 'cursor-pointer hover:bg-raised'
                      : // Dimmed AND unpointable, with the sentence below doing
                        // the explaining. Opacity alone would leave a
                        // live-looking control that does nothing.
                        'cursor-not-allowed opacity-45'
                  } ${on ? 'bg-line-strong' : ''}`}
                >
                  {/* A filled disc, not a letter: the swatch IS the colour.
                      `bg-current` paints the fill from the same token class the
                      glyph wears, so one list of eight inks serves both and
                      13.1 is satisfied by the same token either way. The border
                      keeps `neutral` a circle on the panel rather than a
                      smudge. */}
                  <span
                    aria-hidden="true"
                    className={`h-[14px] w-[14px] rounded-full border border-line-strong bg-current ${ICON_TONE_INK[tone]}`}
                  />
                </button>
              );
            })}
          </div>
          {refused !== null && (
            <p data-icon-tone-refusal className="mt-1.5 text-control text-ink-quiet">
              {refused}
            </p>
          )}
        </div>

        <Suspense
          fallback={
            <div className="flex h-[380px] w-full items-center justify-center text-control text-ink-faint">
              loading icon grid…
            </div>
          }
        >
          <EmojiGrid onPick={onPick} />
        </Suspense>
      </div>
    </div>
  );
}
