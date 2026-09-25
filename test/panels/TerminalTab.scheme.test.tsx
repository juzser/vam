// @vitest-environment happy-dom

/**
 * The scheme reaches the screen -- and stops at its edge.
 *
 * `prefs/terminal-scheme.ts` resolves twenty-three colours; what a DOM test
 * can hold is WHERE they land and WHICH span wears which. Three claims:
 *
 *   1. THE SCREEN'S OWN ELEMENT CARRIES THEM, as custom properties in its
 *      inline style -- the sixteen `--vam-ansi-*` names the `text-ansi-*`
 *      utilities already read, and the seven `--vam-term-*` names. Never
 *      `:root`: the sixteen are global tokens, and a scheme put on the root
 *      would recolour every surface that reads them. The scan at the bottom
 *      holds the other half of that promise -- nothing outside the TWO
 *      terminal tabs reads the seven new names at all. `TerminalStreamTab.
 *      tsx` joined the allowlist for the operator's own frame-parity ask
 *      (`docs/design/terminal-streaming.md`): its pane frame now carries the
 *      SAME `terminalSchemeStyle(scheme)` call this file's own subject does,
 *      so the setting ON and OFF read the same background at the same
 *      opacity -- a second intentional reader, not a leak.
 *   2. THE BOLD RULE IS iTERM2'S. A bold run with no colour of its own takes
 *      `bold`; a bold run the agent coloured keeps the agent's colour. The
 *      run's classes say which, and `terminal-ansi.test.ts` holds the
 *      classifier; this holds that the screen draws what it classified.
 *   3. THE SCREEN FOLLOWS THE STORE WITHOUT A REMOUNT, in the direction the
 *      operator will actually take: the app theme flipping to light under an
 *      open terminal, and the opacity slider moving.
 *
 * What the classes RESOLVE to on a real paint -- that `text-term-bold` is
 * `#dba780` and not an unknown utility -- is `e2e/terminal-scheme-shots.mjs`,
 * which reads `getComputedStyle` off Chromium; a class name this file can
 * only assert is present.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import { applyPalette } from '../../src/renderer/prefs/prefs.js';
import {
  DEFAULT_TERMINAL_SCHEME_PREF,
  readTerminalSchemePref,
  setActiveTerminalScheme,
  TERMINAL_SCHEME_KEYS,
  TERMINAL_SCHEME_VARS,
  TERMINAL_THEMES,
  type TerminalScheme,
} from '../../src/renderer/prefs/terminal-scheme.js';
import type { PaneCursor, PaneView } from '../../src/shared/terminal.js';
import { ruleBody, THEMES, tokens } from '../support/css-tokens.js';

afterEach(cleanup);
beforeEach(() => {
  setActiveTerminalScheme(DEFAULT_TERMINAL_SCHEME_PREF, 'dark');
});

const ATLAS = 'claude-code:atlas-11111111';
const ESC = '\u001b';
const HANS = TERMINAL_THEMES.find((t) => t.id === 'hans')?.scheme as TerminalScheme;
const TANGO = TERMINAL_THEMES.find((t) => t.id === 'tango-light')?.scheme as TerminalScheme;

/** A screen with the four kinds of run the scheme has to tell apart: bold
 *  with no colour, bold in the agent's red, plain red, and plain. */
const SCREEN = `${ESC}[1mBOLD${ESC}[0m ${ESC}[1;31mERR${ESC}[0m ${ESC}[31mred${ESC}[0m plain\n`;

const view = (text: string, cursor: PaneCursor): PaneView => ({
  kind: 'ok',
  name: 'vam-atlas-a1b2c3',
  text,
  cursor,
});

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** No cursor unless a test asks for one: `placeCursor` splits the run the
 *  caret falls in, and a split `BOLD` is two spans neither of which is it. */
async function open(text = SCREEN, cursor: PaneCursor = { kind: 'unreadable' }) {
  const read = vi.fn(async () => view(text, cursor));
  render(<TerminalTab projectId={ATLAS} read={read} resize={undefined} send={undefined} />);
  await settle();
  const pane = document.querySelector<HTMLElement>('[data-terminal-pane]');
  if (pane === null) throw new Error('the pane was not drawn');
  return pane;
}

const spanNamed = (text: string): HTMLElement => {
  const span = [...document.querySelectorAll<HTMLElement>('[data-terminal-pane] pre span')].find(
    (el) => el.textContent === text,
  );
  if (span === undefined) throw new Error(`no span reads ${JSON.stringify(text)}`);
  return span;
};

describe('the screen carries the resolved scheme, scoped to itself', () => {
  it('puts all twenty-three colours on the pane as custom properties, Hans by default', async () => {
    const pane = await open();
    for (const key of TERMINAL_SCHEME_KEYS) {
      expect(pane.style.getPropertyValue(TERMINAL_SCHEME_VARS[key]), key).toBe(HANS[key]);
    }
  });

  it('paints the ground from the scheme, composited with the opacity', async () => {
    const pane = await open();
    // Hans's #1e1f29 at 1: the pane's inline background, not a token class.
    expect(pane.style.backgroundColor).toMatch(/^rgba?\(30, 31, 41(, 1)?\)$/);
    const classes = pane.getAttribute('class') ?? '';
    expect(classes).not.toContain('bg-panel');
    expect(classes).not.toContain('text-ink');
  });

  it('reads its default ink and its selection pair through the term tokens', async () => {
    const pane = await open();
    const classes = pane.getAttribute('class') ?? '';
    expect(classes).toContain('text-term-fg');
    expect(classes).toContain('selection:bg-term-selection-bg');
    expect(classes).toContain('selection:text-term-selection-fg');
  });

  it('never puts a scheme colour on the document root -- not at mount, and not when the scheme moves', async () => {
    // Both halves, because the store early-returns on an unchanged scheme:
    // a leak written after that check would pass the first read and fail
    // only once something moved. Found by mutation.
    const pane = await open();
    const root = document.documentElement.style;
    const clean = () => {
      for (const key of TERMINAL_SCHEME_KEYS) {
        expect(root.getPropertyValue(TERMINAL_SCHEME_VARS[key]), key).toBe('');
      }
    };
    clean();
    act(() => setActiveTerminalScheme(DEFAULT_TERMINAL_SCHEME_PREF, 'light'));
    expect(pane.style.getPropertyValue('--vam-term-bg')).toBe(TANGO.background);
    clean();
  });

  it('is not moved by the app palette any more -- the screen owns its colours', async () => {
    // Before the scheme, `applyPalette({'--vam-panel': …})` recoloured the
    // pane, and `TerminalTab.fit.test.tsx` held that it did. The ownership
    // moved, and this is the assertion that says so on purpose: an operator
    // re-tinting the dashboard does not re-tint the agent's screen.
    const pane = await open();
    const before = pane.style.getPropertyValue('--vam-term-bg');
    applyPalette({ '--vam-panel': '#3b0764', '--vam-ink': '#f5d0fe' });
    await settle();
    expect(pane.style.getPropertyValue('--vam-term-bg')).toBe(before);
    expect(pane.style.backgroundColor).toMatch(/^rgba?\(30, 31, 41(, 1)?\)$/);
    applyPalette({});
  });
});

describe('the bold rule is iTerm2’s', () => {
  it('gives a bold run with no colour of its own the scheme’s bold colour', async () => {
    await open();
    const classes = spanNamed('BOLD').getAttribute('class') ?? '';
    expect(classes).toContain('font-bold');
    expect(classes).toContain('text-term-bold');
  });

  it('leaves a bold run the agent coloured in the agent’s colour', async () => {
    // `ESC[1;31m` is "bold, red". The agent said red; bold does not overrule
    // it, which is the half of the rule that keeps an error line red.
    await open();
    const classes = spanNamed('ERR').getAttribute('class') ?? '';
    expect(classes).toContain('font-bold');
    expect(classes).toContain('text-ansi-red');
    expect(classes).not.toContain('text-term-bold');
  });

  it('gives a plain run nothing, so it inherits the scheme’s foreground', async () => {
    await open();
    expect(spanNamed('red').getAttribute('class') ?? '').toBe('text-ansi-red');
    expect(spanNamed(' plain').getAttribute('class') ?? '').toBe('');
  });
});

describe('the cursor paints the scheme’s pair', () => {
  it('wears the cursor colour under the cursor-accent ink, and nothing of the cell’s own', async () => {
    await open(SCREEN, { kind: 'at', column: 1, row: 0 });
    const cursor = document.querySelector('[data-terminal-cursor]');
    const classes = cursor?.getAttribute('class') ?? '';
    expect(cursor?.textContent).toBe('O');
    expect(classes).toContain('bg-term-cursor');
    expect(classes).toContain('text-term-cursor-accent');
    // The cell it fell on was bold with no colour; the block replaces that.
    expect(classes).not.toContain('text-term-bold');
    expect(classes).not.toContain('font-bold');
  });
});

describe('the screen follows the store without a remount', () => {
  it('turns Tango Light when the app theme goes light under it', async () => {
    const pane = await open();
    expect(pane.style.getPropertyValue('--vam-term-bg')).toBe(HANS.background);
    act(() => setActiveTerminalScheme(DEFAULT_TERMINAL_SCHEME_PREF, 'light'));
    for (const key of TERMINAL_SCHEME_KEYS) {
      expect(pane.style.getPropertyValue(TERMINAL_SCHEME_VARS[key]), key).toBe(TANGO[key]);
    }
    expect(pane.style.backgroundColor).toMatch(/^rgba?\(255, 255, 255(, 1)?\)$/);
  });

  it('thins the ground when the opacity moves, and keeps the scheme’s own colour beside it', async () => {
    const pane = await open();
    act(() => setActiveTerminalScheme(readTerminalSchemePref({ backgroundOpacity: 0.5 }), 'dark'));
    expect(pane.style.backgroundColor).toBe('rgba(30, 31, 41, 0.5)');
    expect(pane.style.getPropertyValue('--vam-term-bg')).toBe(HANS.background);
  });

  it('shows an override the moment it is set', async () => {
    const pane = await open();
    act(() =>
      setActiveTerminalScheme(
        readTerminalSchemePref({ dark: { theme: 'hans', overrides: { cursor: '#00ff00' } } }),
        'dark',
      ),
    );
    expect(pane.style.getPropertyValue('--vam-term-cursor')).toBe('#00ff00');
    expect(pane.style.getPropertyValue('--vam-term-bold')).toBe(HANS.bold);
  });
});

/**
 * NOTHING OUTSIDE THE SCREEN READS THE NEW NAMES. A scan, because the
 * promise is about the whole renderer and not about one component: the day a
 * sidebar row reaches for `text-term-fg` it will paint in whatever the
 * cascade gives it there, which is nothing.
 *
 * Deliberately loose in the safe direction, as `prefs.no-write-only-field`
 * argues: a mention in a comment counts, so a file cannot slip a reader past
 * the scan by explaining itself. The allowlist is the terminal and the
 * stylesheet, and the stylesheet is then held to defining the names only
 * inside the Tailwind theme block -- as `--color-term-*: var(--vam-term-*)`
 * pairs -- and never as values on `:root` or `html.light`.
 */
describe('the seven term tokens are the two terminal tabs’ alone', () => {
  const SRC = resolve(process.cwd(), 'src');
  const ALLOWED = new Set([
    'renderer/panels/TerminalTab.tsx',
    'renderer/panels/terminal-ansi.ts',
    // `TerminalStreamTab.tsx`'s own pane frame reads the scheme the
    // identical way (`terminalSchemeStyle(scheme)`) so the streaming
    // setting's frame background matches `TerminalTab.tsx`'s at the shipped
    // `backgroundOpacity` default -- see this file's own header and
    // `docs/design/terminal-streaming.md`'s frame-parity section.
    'renderer/panels/terminal-stream/TerminalStreamTab.tsx',
    'renderer/prefs/terminal-scheme.ts',
    'renderer/prefs/prefs.ts',
    'renderer/styles.css',
  ]);
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return ['.ts', '.tsx', '.css'].includes(extname(name)) ? [path] : [];
    });
  const corpus = new Map(
    files(SRC).map((path) => [
      relative(SRC, path).split('\\').join('/'),
      readFileSync(path, 'utf8'),
    ]),
  );
  const TERM =
    /--vam-term-|\b(?:text|bg)-term-(?:fg|bg|bold|cursor|cursor-accent|selection-bg|selection-fg)\b/;

  it('scanned a real corpus, and the allowlisted files really do mention the names', () => {
    expect(corpus.size).toBeGreaterThan(100);
    for (const name of ALLOWED) {
      expect(corpus.has(name), name).toBe(true);
    }
    expect(corpus.get('renderer/panels/TerminalTab.tsx')).toMatch(TERM);
    expect(corpus.get('renderer/panels/terminal-stream/TerminalStreamTab.tsx')).toMatch(TERM);
    expect(corpus.get('renderer/styles.css')).toMatch(TERM);
  });

  it('finds them in no file outside the two terminal tabs and the stylesheet', () => {
    const readers = [...corpus.entries()]
      .filter(([name, text]) => !ALLOWED.has(name) && TERM.test(text))
      .map(([name]) => name);
    expect(readers).toEqual([]);
  });

  it('declares them in the stylesheet only on the screen’s own rule, never on a theme block', () => {
    const css = corpus.get('renderer/styles.css') as string;
    for (const { selector } of THEMES) {
      const names = [...tokens(ruleBody(css, selector)).keys()].filter((n) =>
        n.startsWith('--vam-term-'),
      );
      expect(names, selector).toEqual([]);
    }
    // Every declaration of a `--vam-term-*` value sits inside the one rule
    // keyed to the pane -- the fallback layer the inline style writes over.
    const paneRule = /^\[data-terminal-pane\]\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '';
    const declaredInPane = [...tokens(paneRule).keys()].filter((n) => n.startsWith('--vam-term-'));
    expect(declaredInPane).toHaveLength(7);
    const declaredAnywhere = [...css.matchAll(/^\s*(--vam-term-[a-z-]+):/gm)].map((m) => m[1]);
    expect(declaredAnywhere.sort()).toEqual([...declaredInPane].sort());
    for (const suffix of [
      'fg',
      'bold',
      'cursor',
      'cursor-accent',
      'selection-bg',
      'selection-fg',
    ]) {
      expect(css).toContain(`--color-term-${suffix}: var(--vam-term-${suffix})`);
    }
  });
});
