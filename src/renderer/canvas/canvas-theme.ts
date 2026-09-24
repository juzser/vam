import { useEffect, useState } from 'react';
import {
  applyPalette,
  applyTheme,
  type EffectiveTheme,
  type Prefs,
  paletteFor,
  type Theme,
  watchOsTheme,
} from '../prefs/prefs.js';
import { setActiveTerminalScheme } from '../prefs/terminal-scheme.js';

// The class on <html> is what styles.css switches on, and prefs is the only
// source for it — so this effect, not the toggle's click handler, is what
// moves the document. A handler that also wrote the class would be a second
// writer, and the two disagree the first time prefs is restored from storage.
// `system` is a subscription, not a sample: without the listener the OS
// flipping at sunset leaves a dashboard on the appearance it had at mount,
// which is not what the overlay's own hint promises. Keeping the resolved
// value in state is what lets the sidebar's label and its click describe the
// screen rather than the store.
// The colour overrides move HERE too, in the same statement, because they are
// stored per theme: the class and the bucket in force are two halves of one
// appearance, and a flip that moved only the class would leave a light theme
// wearing dark's canvas until the next write. `writePrefs` covers an edit;
// only this covers the OS changing its mind with nothing else happening.
// The terminal's scheme is the third half of the same appearance and is
// stored per theme for the same reason, so it moves in the same statement:
// without this line an open terminal would keep its dark scheme after the
// OS flipped to light under `system`, with nothing else on screen wrong.
export function useCanvasTheme(prefs: Prefs) {
  const [effective, setEffective] = useState<EffectiveTheme>('dark');
  useEffect(() => {
    const show = (theme: Theme) => {
      const next = applyTheme(theme);
      setEffective(next);
      applyPalette(paletteFor(prefs.palette, next));
      setActiveTerminalScheme(prefs.terminalScheme, next);
    };
    show(prefs.theme);
    if (prefs.theme !== 'system') return;
    return watchOsTheme(() => show('system'));
  }, [prefs.theme, prefs.palette, prefs.terminalScheme]);

  return { effective };
}
