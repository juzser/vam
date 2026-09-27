/**
 * THE APP CHROME'S OWN ZOOM: 80..150%, ten points a step — reversing issue 281.
 *
 * issue 281 removed page zoom outright ("the operator asked for zoom to be
 * gone", `main/zoom.ts`'s own header carries the whole story) because the
 * operator's ask THEN was "off, and stays off". The operator's ask NOW is the
 * opposite of the same setting: a deliberate, stepped UI zoom with its own
 * chords, persisted and applied at launch. `main/zoom.ts`'s `lockZoom` still
 * refuses incidental pinch and undoes a stray wheel zoom — see its own header
 * for why "reversed" is narrower than "gone" — and this file is the other
 * half: what the operator's OWN choice is clamped to.
 *
 * IN `src/shared/`, LIKE `terminal.ts`, FOR THE IDENTICAL REASON: main reads
 * this to clamp what the renderer sends it (main trusts nothing the least
 * trusted process hands it — `zoom-ipc.test.ts`'s own header), and the
 * renderer reads it for the Settings row's `Stepper` and for the chord
 * handler's own arithmetic (`keyboard/chords.ts`'s `zoom` action). One table
 * rather than two copies of "80..150 by 10" drifting apart the day either
 * side's range changes alone.
 *
 * A PERCENTAGE, NOT A FACTOR. `webContents.setZoomFactor` takes 1.0 for
 * 100%, and the /100 division is `main/zoom-state.ts`'s own job, done once,
 * at the one seam that actually calls it — everywhere else (the stored
 * preference, the stepper, the chord's arithmetic, the settings row's own
 * printed value) reads and writes the same whole number an operator would
 * say out loud.
 */

/** The floor. Under it the interface reads as a phone's own zoomed-out
 *  overview rather than a smaller version of itself — text and hit targets
 *  both existing surfaces already assume a floor for (`type-scale.test.ts`'s
 *  own 11px minimum), and a UI zoom under this would silently undercut that
 *  floor no stylesheet gate reads. */
export const UI_ZOOM_MIN = 80;
/** The ceiling. "80–150% in steps" is the operator's own range. */
export const UI_ZOOM_MAX = 150;
/** Ten points a step: coarse enough that every press is a difference an eye
 *  can see (`terminal-scheme.ts`'s own opacity slider argues the identical
 *  point for its own stops), and it divides the range exactly — eight offered
 *  values, `100` among them. */
export const UI_ZOOM_STEP = 10;
/** Unzoomed — what the app has always drawn at, and what an operator who
 *  never opens this row keeps seeing. */
export const DEFAULT_UI_ZOOM = 100;

/**
 * Total, like `clampOutFontSize`: a string a hand-edited payload carries, a
 * `NaN`, an `Infinity` from devtools, an object — none of them may reach
 * `setZoomFactor`, which is the whole reason this is asked of every value on
 * BOTH sides of the bridge rather than trusted once at the picker.
 */
export function clampUiZoomPercent(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_UI_ZOOM;
  }
  return Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, raw));
}
