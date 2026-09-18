// Node, not happy-dom: this file reads bytes, and happy-dom leaves
// `import.meta.url` in a scheme `readFileSync` will not take.

/**
 * The sheet geometry, read as content — and it is a content scan, plainly.
 *
 * jsdom applies no stylesheet and lays nothing out, so nothing rendered can
 * tell you where a dialog's bottom edge is. What a scan CAN hold true is that
 * the rules exist, that they anchor rather than centre, that they cap and
 * scroll rather than overflow off-screen, and that they key on the marker
 * rather than on every dialog in the tree. A real hit box and a real
 * keyboard-open still need the Playwright pass at 390px, which is not written.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const CSS = read('../../src/renderer/styles.css');
const HOSTS = [
  '../../src/renderer/settings/SettingsOverlay.tsx',
  '../../src/renderer/errors/ErrorLogPanel.tsx',
  '../../src/renderer/panels/IconPicker.tsx',
  '../../src/renderer/panels/ProjectPicker.tsx',
];

/** The block that retargets the marked hosts, isolated from the rest. */
const sheetRules = CSS.slice(CSS.indexOf('.vam-phone [data-overlay-host]'));

describe('the overlay sheet rules', () => {
  it('anchors to the bottom instead of centring below a top padding', () => {
    expect(sheetRules).toMatch(/\.vam-phone \[data-overlay-host\] \{[^}]*align-items: flex-end;/);
    // `pt-16` / `pt-[18vh]` / `pt-[12vh]` is what put the panel's own bottom
    // below the fold; the class stays on the element and is overridden here.
    expect(sheetRules).toMatch(/\.vam-phone \[data-overlay-host\] \{[^}]*padding-top: 0;/);
  });

  it('caps the sheet and lets it scroll within itself', () => {
    expect(sheetRules).toMatch(/max-height: 85dvh;/);
    expect(sheetRules).toMatch(/overflow-y: auto;/);
    // SettingsOverlay's panel is `h-[min(600px,80vh)]`, a fixed height that
    // would win over a max-height and reintroduce the unreachable bottom.
    expect(sheetRules).toMatch(/height: auto;/);
  });

  /**
   * THE ONE ICON-PICKER RULE THE DEFAULT GATE CAN SEE, and it is worth saying
   * why it is only a scan.
   *
   * The picker is the single host here with a NESTED scroller, and what keeps
   * its emoji grid reachable above an iOS keyboard is that the grid is a whole
   * sheet tall: everything above it is then overflow, so the sheet can scroll
   * those rows away (`styles.css` argues it where the rule lives). That is a
   * layout fact and this file lays nothing out — `e2e/phone-shell.pw.ts`
   * measures it at 390x844, and this line is bounded by that one.
   *
   * IT IS STILL WORTH THE LINE, because `test:e2e:phone` is NOT one of the
   * commands this project's local gate runs: the regression this guards
   * against reached CI having passed every check a person runs by hand. A scan
   * that proves the declaration was TYPED is the only thing in the default
   * suite that can notice it being deleted.
   */
  it('gives the icon picker grid a sheet of its own to scroll above', () => {
    expect(sheetRules).toMatch(
      /\.vam-phone \[data-icon-picker\] > \.epr-main \{[^}]*min-height: 85dvh;/,
    );
  });

  it('clears the home indicator at the edge it is now anchored to', () => {
    expect(sheetRules).toMatch(/padding-bottom: max\(12px, env\(safe-area-inset-bottom\)\);/);
  });

  it('dresses the panel, never the scrim button that closes it', () => {
    expect(sheetRules).toContain('.vam-phone [data-overlay-host] > :not(button)');
  });

  it('keys on the marker, not on every dialog in the tree', () => {
    // `[role='dialog']` would also catch the anchored filter popover, which is
    // positioned against its own toggle rather than against the viewport.
    expect(sheetRules).not.toMatch(/\.vam-phone \[role='dialog'\]/);
  });

  it('is carried by every overlay a phone can actually open', () => {
    for (const host of HOSTS) {
      expect(read(host)).toContain('data-overlay-host');
    }
  });

  it('is NOT carried by the two chord-only surfaces, which need a design, not a port', () => {
    // The command palette and the key sheet are reached by `Ctrl-K` and `?`,
    // and there are no chords on a phone. A sheet geometry would make them
    // look reachable while nothing can open them.
    expect(read('../../src/renderer/panels/CommandPalette.tsx')).not.toContain('data-overlay-host');
    expect(read('../../src/renderer/panels/KeySheet.tsx')).not.toContain('data-overlay-host');
  });
});
