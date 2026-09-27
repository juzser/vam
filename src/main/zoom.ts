/**
 * Page zoom is off by ACCIDENT, and stays off; a DELIBERATE zoom the
 * operator asked for now survives the identical reset.
 *
 * issue 281 SHIPPED THIS AS "off, full stop" -- the operator's own words then were
 * "zoom to be gone" -- and `./menu.ts` still closes the keyboard route by not
 * claiming `CommandOrControl+0/Plus/-` at all, for the reason its own header
 * gives (that row is `Mod-w`'s, `chords.ts`'s `close`). WHAT REVERSES HERE IS
 * NARROWER THAN THE MENU IS WIDE: the operator has now asked for a UI zoom
 * setting with its own chords (`prefs/ui-zoom.ts`, `keyboard/chords.ts`'s
 * `zoom` action) -- a DISCRETE, DELIBERATE resize the operator drives from
 * Settings or a chord -- and this file's whole job changes from "the zoom
 * factor is always 1" to "the zoom factor is always THE OPERATOR'S OWN,
 * whatever incidental gesture Chromium just tried":
 *
 *   - PINCH STAYS REFUSED. `setVisualZoomLevelLimits(1, 1)` is unchanged and
 *     unconditional -- nothing asked for trackpad pinch back, and a stepped
 *     10% setting is not what a pinch gesture produces anyway. There is no
 *     getter, so the launch harness cannot read this one back; what is
 *     asserted is the call.
 *   - WHEEL IS STILL UNDONE, ONTO THE NEW BASELINE. Chromium performs a
 *     Ctrl/Cmd + wheel zoom itself and reports it through `zoom-changed`,
 *     which is the documented hook to undo it -- "undo it" now means "put it
 *     back at the factor the operator actually chose", not "back at 1".
 *   - PERSISTED, SAME HAZARD, SAME FIX. Chromium STORES the zoom level per
 *     origin and re-applies it on navigation, so the reset below -- which
 *     runs at `web-contents-created`, before any page, and again on
 *     `did-finish-load` -- is what keeps a reload from momentarily showing
 *     Chromium's own stored level before this file's own opinion lands.
 *
 * `getFactor` IS A FUNCTION, NEVER A NUMBER, and that is the one decision this
 * generalisation adds. A plain parameter is read ONCE, at the
 * `web-contents-created` moment `main/index.ts` calls this from -- but the
 * operator can change the setting at ANY LATER TIME, on a window that already
 * has its `zoom-changed`/`did-finish-load` listeners attached, and a wheel
 * zoom five minutes after that change has to reset onto the NEW value, not
 * the one this contents was born with. `main/zoom-state.ts` is where the
 * getter's own answer lives; this file only ever calls it.
 */

/** The slice of `WebContents` this needs, so the behaviour is testable. */
export type ZoomLockable = {
  setVisualZoomLevelLimits(minimum: number, maximum: number): void;
  setZoomFactor(factor: number): void;
  setZoomLevel(level: number): void;
  on(event: 'zoom-changed' | 'did-finish-load', listener: () => void): unknown;
};

/**
 * `getFactor` defaults to "always 1", which is issue 281's own behaviour exactly
 * -- every caller from before this reversal existed (and every test written
 * against it) keeps working unchanged.
 */
export function lockZoom(contents: ZoomLockable, getFactor: () => number = () => 1): void {
  const reset = (): void => {
    contents.setZoomFactor(getFactor());
    contents.setZoomLevel(0);
  };
  contents.setVisualZoomLevelLimits(1, 1);
  reset();
  contents.on('zoom-changed', reset);
  contents.on('did-finish-load', reset);
}
