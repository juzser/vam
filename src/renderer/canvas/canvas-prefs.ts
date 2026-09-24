import { useCallback, useEffect, useState } from 'react';
import { layoutWidths } from '../prefs/panes.js';
import { type Prefs, readPrefs, setPaneWidth, type StorageLike, writePrefs } from '../prefs/prefs.js';

/**
 * What you arranged, as opposed to what the factory reported. Read once —
 * `localStorage` is synchronous and this is two small maps — and written on
 * every change, so a reload finds the canvas as you left it.
 */
export function useCanvasPrefs(storage: StorageLike | null) {
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs(storage));
  const savePrefs = useCallback(
    (next: Prefs) => {
      setPrefs(next);
      writePrefs(storage, next);
    },
    [storage],
  );

  /**
   * The two pane widths, live. `viewportWidth` re-renders the clamp on every
   * resize but never writes (epic.md §4.2 point 2). `liveWidths` holds a
   * pane's in-progress drag value so the other pane's rendered width can
   * react to it without touching storage; it is cleared and `savePrefs` is
   * called only at drag end, never mid-drag (AC-2(c)).
   */
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    function onResize() {
      setViewportWidth(window.innerWidth);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [liveWidths, setLiveWidths] = useState<{
    sidebar: number | null;
    detail: number | null;
  }>({ sidebar: null, detail: null });

  const storedSidebar = liveWidths.sidebar ?? prefs.panes.sidebar;
  const storedDetail = liveWidths.detail ?? prefs.panes.detail;

  const { sidebar: sidebarWidth, detail: detailWidth } = layoutWidths(
    { sidebar: storedSidebar, detail: storedDetail },
    viewportWidth,
  );

  const onPaneChange = useCallback((pane: 'sidebar' | 'detail', width: number) => {
    setLiveWidths((prev) => ({ ...prev, [pane]: width }));
  }, []);

  const onPaneCommit = useCallback(
    (pane: 'sidebar' | 'detail', width: number) => {
      setLiveWidths((prev) => ({ ...prev, [pane]: null }));
      savePrefs(setPaneWidth(prefs, pane, width));
    },
    [prefs, savePrefs],
  );

  return {
    prefs,
    setPrefs,
    savePrefs,
    viewportWidth,
    liveWidths,
    storedSidebar,
    storedDetail,
    sidebarWidth,
    detailWidth,
    onPaneChange,
    onPaneCommit,
  };
}
