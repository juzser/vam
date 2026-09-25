// @vitest-environment happy-dom

/**
 * THE OPERATOR'S RECHECK, AS A GUARD: "the shortcut symbols in the Keyboard
 * settings again — they still aren't consistent with the symbols updated
 * recently." They were not — `BindingLine` (`SettingsOverlay.tsx`) painted
 * `chordSymbols` as a flat string inside a `font-mono` slot, so its ⌘/⇧ read
 * thin against the Send key option (`data-submit-key-option`) while every
 * other chip in the app, routed through `ChordGlyphs`, did not.
 *
 * `test/keyboard/no-stray-glyphs.test.ts` sweeps SOURCE for a hand-typed
 * glyph and cannot see this class of defect at all — nothing here ever typed
 * `⌘` literally, it called `chordSymbols` and printed what came back. This
 * sweeps the PAINTED tree instead (`../support/chord-glyph-guard.ts`), across
 * every surface this app draws a chord on, so the next one of these is caught
 * here rather than found by an operator a second time.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DEMO_MODEL } from '../../src/renderer/fixtures/demo.js';
import { NO_BINDINGS, setActiveBindings } from '../../src/renderer/keyboard/chords.js';
import { InlineChord, ShortcutTip } from '../../src/renderer/keyboard/ShortcutTip.js';
import { CommandPalette } from '../../src/renderer/panels/CommandPalette.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
import { EMPTY_PREFS } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';
import { baseProps, entriesOf, makeSession } from '../panels/session-list-props.js';
import { findUnwrappedGlyphs, type GlyphViolation } from '../support/chord-glyph-guard.js';
import { MAC_PLATFORM, onBothPlatformsAsync, withPlatform } from '../support/platform.js';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

afterEach(() => {
  cleanup();
  setActiveBindings(NO_BINDINGS);
  localStorage.clear();
});

/** A readable failure: which surface, which glyph, in which chip. */
function describeAll(surface: string, violations: readonly GlyphViolation[]): string {
  return violations
    .map((v) => `${surface}: "${v.glyph}" unwrapped in "${v.text}" under .${v.monoAncestorClass}`)
    .join('\n');
}

describe('the falsifier: the guard actually finds the shape it looks for', () => {
  it('flags a glyph typed straight into a font-mono chip', () => {
    document.body.innerHTML = '<span class="font-mono">⌘K</span>';
    const found = findUnwrappedGlyphs(document.body);
    expect(found).toHaveLength(1);
    expect(found[0]?.glyph).toBe('⌘');
  });

  it('clears once the glyph segment is wrapped the way ChordGlyphs wraps it', () => {
    document.body.innerHTML = '<span class="font-mono"><span class="font-sans">⌘</span>K</span>';
    expect(findUnwrappedGlyphs(document.body)).toEqual([]);
  });

  it('leaves a glyph alone outside any font-mono ancestor — prose is not a chip', () => {
    document.body.innerHTML = '<p class="text-control">"⌘K" is reserved</p>';
    expect(findUnwrappedGlyphs(document.body)).toEqual([]);
  });
});

describe('every chord-painting surface routes a Mac glyph through ChordGlyphs', () => {
  it('the Keyboard settings rows — the binding list and the rebinding editor mid-capture', () => {
    withPlatform(MAC_PLATFORM, () => {
      render(
        <SettingsOverlay
          prefs={EMPTY_PREFS}
          theme="dark"
          onChange={() => {}}
          onClose={() => {}}
          initialSection="keyboard"
        />,
      );
      // Unarmed list first.
      expect(describeAll('settings: keyboard list', findUnwrappedGlyphs(document.body))).toBe('');
      // Then mid-capture: one row swaps to the input, its neighbours keep
      // painting theirs — the "rebinding editor" the operator asked to
      // recheck, not only the list behind it.
      const paletteSlot = document.querySelector<HTMLElement>('[data-binding-slot="palette:0"]');
      expect(paletteSlot, 'the palette row did not render').not.toBeNull();
      fireEvent.click(paletteSlot as HTMLElement);
      expect(document.querySelector('[data-binding-capture]')).not.toBeNull();
      expect(
        describeAll('settings: keyboard capture armed', findUnwrappedGlyphs(document.body)),
      ).toBe('');
      cleanup();
    });
  });

  it('the Send key option itself, and the whole overlay behind it — every section stays mounted, hidden rather than unmounted, so this sweeps all of it', () => {
    withPlatform(MAC_PLATFORM, () => {
      render(
        <SettingsOverlay
          prefs={EMPTY_PREFS}
          theme="dark"
          onChange={() => {}}
          onClose={() => {}}
          initialSection="sessions"
        />,
      );
      expect(document.querySelector('[data-submit-key-option="shift-enter"]')).not.toBeNull();
      expect(describeAll('settings: send key option', findUnwrappedGlyphs(document.body))).toBe('');
      cleanup();
    });
  });

  it('the key sheet', () => {
    withPlatform(MAC_PLATFORM, () => {
      render(<Canvas model={DEMO_MODEL} />);
      fireEvent.keyDown(window, { key: '?' });
      expect(document.querySelector('[data-key-sheet]')).not.toBeNull();
      expect(describeAll('key sheet', findUnwrappedGlyphs(document.body))).toBe('');
      cleanup();
    });
  });

  it('the command palette’s action rows', async () => {
    // `withPlatform` restores the platform synchronously, in a `finally`
    // right after invoking its body — safe for the rest of this file's
    // synchronous renders, wrong for `userEvent.type`'s own await
    // (`test/support/platform.ts` states the reason `onBothPlatformsAsync`
    // exists at all). Only the Mac pass matters here; the PC one is a cheap
    // no-op rather than a second export this file alone would need.
    await onBothPlatformsAsync(async (mac) => {
      if (!mac) {
        return;
      }
      const entries: SessionEntry[] = entriesOf([makeSession()]);
      render(
        <CommandPalette
          entries={entries}
          onPick={() => {}}
          onRunAction={() => {}}
          hasFocusedSession
          onClose={() => {}}
        />,
      );
      const input = screen.getByRole('combobox');
      // `close` ships on `Mod-w` — a real modifier chord to paint.
      await userEvent.type(input, '/close');
      expect(document.body.textContent).toMatch(/close/i);
      expect(describeAll('command palette', findUnwrappedGlyphs(document.body))).toBe('');
      cleanup();
    });
  });

  it('a tooltip', () => {
    withPlatform(MAC_PLATFORM, () => {
      render(
        <ShortcutTip label="Command palette" action={{ kind: 'palette' }}>
          <button type="button">K</button>
        </ShortcutTip>,
      );
      fireEvent.focus(screen.getByRole('button'));
      expect(screen.getByRole('tooltip')).not.toBeNull();
      expect(describeAll('tooltip', findUnwrappedGlyphs(document.body))).toBe('');
      cleanup();
    });
  });

  it('the sidebar’s inline chord chips', () => {
    withPlatform(MAC_PLATFORM, () => {
      render(<SessionList {...baseProps(entriesOf([makeSession()]))} />);
      expect(document.querySelectorAll('[data-inline-chord]').length).toBeGreaterThan(0);
      expect(describeAll('sidebar', findUnwrappedGlyphs(document.body))).toBe('');
      cleanup();
    });
  });

  it('an inline chip rendered on its own, off the sidebar', () => {
    withPlatform(MAC_PLATFORM, () => {
      render(<InlineChord action={{ kind: 'newSession' }} className="chip" />);
      expect(describeAll('bare InlineChord', findUnwrappedGlyphs(document.body))).toBe('');
      cleanup();
    });
  });

  it('the phone’s keystroke strip', () => {
    withPlatform(MAC_PLATFORM, () => {
      const session: Session = {
        id: 's1',
        title: 'atlas',
        epic: null,
        branch: null,
        status: 'running',
        runningAgents: 0,
        activity: null,
        age: '3m',
        decisions: [{ id: 'd1', label: 'plan', input: 'ask me', output: 'asked', commands: [] }],
        vamControlled: true,
      };
      const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
      const entry: SessionEntry = { project, session };
      render(
        <DetailPanel
          entry={entry}
          decision={session.decisions[0] ?? null}
          draft=""
          onDraftChange={() => {}}
          onSubmit={() => {}}
          composing={false}
          onCompose={() => {}}
          onStopComposing={() => {}}
          active={false}
          actionIndex={0}
          width={undefined}
          resizeHandle={null}
          phone
          {...({} as Partial<DetailPanelProps>)}
        />,
      );
      expect(document.querySelectorAll('[data-key-strip-key]').length).toBeGreaterThan(0);
      // THE ONE DOCUMENTED EXCEPTION THIS SWEEP HAS TO NAME. `KEY_STRIP`'s
      // own doc comment (`DetailPanel.tsx`) states it: `Esc`/`Enter` carry a
      // caption naming a different destination than their textarea siblings
      // (`" → agent"`) — an arrow used as prose ("leads to"), not a rendering
      // of the ArrowRight key `chordSegments` also happens to draw with the
      // same Unicode character. It is deliberately NOT `chord`/`suffix`
      // routed through `ChordGlyphs` — `suffix` is plain caption text by the
      // table's own design — so it is excluded by name rather than by
      // weakening the guard for every other glyph this strip paints (the
      // chord itself, `⎋`/`⏎`/`⇧⇥`/`␣`/`↑`/`↓`, all still checked below).
      const found = findUnwrappedGlyphs(document.body);
      const suffixArrows = found.filter((v) => v.text === ' → agent');
      const other = found.filter((v) => v.text !== ' → agent');
      expect(
        suffixArrows.length,
        'the documented "→ agent" suffix exception moved or disappeared — update this test',
      ).toBe(2);
      expect(describeAll('phone key strip', other)).toBe('');
      cleanup();
    });
  });
});
