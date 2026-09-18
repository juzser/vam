/**
 * Page zoom is off, and stays off.
 *
 * `./menu.ts` closes the keyboard route by not claiming
 * `CommandOrControl+0/Plus/-` at all. This closes the rest on the
 * `webContents` itself, so a window created after startup obeys the same rule:
 *
 *   - PINCH: `setVisualZoomLevelLimits(1, 1)`. There is no getter, so the
 *     launch harness cannot read it back; what is asserted is the call.
 *   - WHEEL: Chromium performs a Ctrl/Cmd + wheel zoom itself and reports it
 *     through `zoom-changed`, which is the documented hook to undo it.
 *   - PERSISTED: Chromium STORES the zoom level per origin and re-applies it
 *     on navigation, so the reset below -- which runs at
 *     `web-contents-created`, before any page -- is overwritten by every load.
 *     Measured: a launch after one that reached level 2.5 came up at zoom
 *     factor 1.577, zoomed with no key ever pressed. Without the
 *     `did-finish-load` listener, anyone who zoomed before this shipped is
 *     stuck zoomed forever, with the shortcut to undo it now removed.
 */

/** The slice of `WebContents` this needs, so the behaviour is testable. */
export type ZoomLockable = {
  setVisualZoomLevelLimits(minimum: number, maximum: number): void;
  setZoomFactor(factor: number): void;
  setZoomLevel(level: number): void;
  on(event: 'zoom-changed' | 'did-finish-load', listener: () => void): unknown;
};

export function lockZoom(contents: ZoomLockable): void {
  const reset = (): void => {
    contents.setZoomFactor(1);
    contents.setZoomLevel(0);
  };
  contents.setVisualZoomLevelLimits(1, 1);
  reset();
  contents.on('zoom-changed', reset);
  contents.on('did-finish-load', reset);
}
