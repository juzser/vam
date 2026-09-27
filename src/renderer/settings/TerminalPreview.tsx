/**
 * THE TERMINAL SECTION'S LIVE PREVIEW CARD.
 *
 * A small, xterm-styled sample rendering — NEVER a real `@xterm/xterm`
 * instance. `TerminalStreamTab.tsx` pays the cost of a real terminal for the
 * reason it has to: it is a REAL session's screen, receiving real bytes. A
 * swatch that only ever shows three fixed lines has no bytes to receive, and
 * standing up xterm's own `Terminal`, `FitAddon` and DOM renderer for that
 * would be the "minimum viable new code" rung's opposite — plain styled text
 * says the identical thing at a fraction of the weight.
 *
 * "INSTANTLY" MEANS THE SAME WIRING THE REAL SCREEN USES, not a poll: this
 * reads the identical three module stores `TerminalStreamTab.tsx` reads
 * (`activeTerminalFontFamily`, `activeTerminalFontSize`, `activeTerminal
 * Scheme`) through the same `useSyncExternalStore` shape, so a Settings row
 * committing a new value repaints this card the same render pass it repaints
 * an open Terminal tab — no debounce, no "Preview" button to press.
 *
 * COLOURS REACH IT THE WAY THEY REACH THE REAL SCREEN: `terminalSchemeStyle`
 * sets the SAME custom properties (`--vam-term-bg`, `--vam-term-fg`, the
 * sixteen `--vam-ansi-*` names) on THIS element, which is what lets the
 * ordinary `text-ansi-*` utilities (`TerminalTab.tsx`'s own `spanClasses`
 * uses the identical ones) paint the sample lines in the chosen scheme's
 * colours rather than the app's own palette.
 */

import type { CSSProperties } from 'react';
import { useSyncExternalStore } from 'react';
import {
  activeTerminalFontSize,
  subscribeTerminalFontSize,
  TERMINAL_LINE_HEIGHT,
} from '../prefs/terminal-font.js';
import {
  activeTerminalFontFamily,
  subscribeTerminalFontFamily,
} from '../prefs/terminal-font-family.js';
import {
  activeTerminalScheme,
  subscribeTerminalScheme,
  terminalSchemeStyle,
} from '../prefs/terminal-scheme.js';

export function TerminalPreview() {
  const fontFamily = useSyncExternalStore(subscribeTerminalFontFamily, activeTerminalFontFamily);
  const fontSize = useSyncExternalStore(subscribeTerminalFontSize, activeTerminalFontSize);
  const scheme = useSyncExternalStore(subscribeTerminalScheme, activeTerminalScheme);
  const style: CSSProperties = {
    ...(terminalSchemeStyle(scheme) as CSSProperties),
    fontFamily,
    fontSize,
    lineHeight: TERMINAL_LINE_HEIGHT,
  };
  return (
    <div
      data-terminal-preview
      aria-hidden="true"
      style={style}
      className="select-none rounded-[9px] border border-line px-3 py-2 font-mono text-control text-term-fg"
    >
      {/* `<div>`, NEVER `<p>` -- a sample terminal LINE is not prose, and
          `test/settings/copy-budget.test.tsx` counts every `<p>` inside a
          settings panel as a caption an operator reads. A `<p>hello</p>`
          here would be swept into that word-count budget as though it were
          this row's own explanatory sentence. */}
      <div>
        <span className="text-ansi-green">operator</span>
        <span>@vam </span>
        <span className="text-ansi-blue">~/project</span>
        <span> $ echo hello</span>
      </div>
      <div>hello</div>
      <div>
        <span className="text-ansi-red">error:</span>
        <span> a sample line, in this scheme’s red</span>
      </div>
      <div>
        <span className="text-ansi-yellow">warning:</span>
        <span> and its yellow</span>
      </div>
    </div>
  );
}
