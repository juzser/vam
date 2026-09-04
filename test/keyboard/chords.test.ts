import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  type ChordState,
  EMPTY_CHORD,
  normalizeKey,
  resolveChord,
} from '../../src/renderer/keyboard/chords.js';

/**
 * The commit this task branched from (`origin/main`, PR #12 merged — task-1
 * and task-2 already landed, no chord change yet). Reading the pre-resize
 * `chords.ts` straight from that commit, rather than retyping its table into
 * this test, is what AC-5(a) demands: the "before" state comes from the real
 * file that shipped, not from a hand-copied list that could drift.
 */
const BASE_SHA = '7fc191477bc8bfe97fb9321c233435d0bfd34eae';

function oldChordsSource(): string {
  return execFileSync('git', ['show', `${BASE_SHA}:src/keyboard/chords.ts`], {
    encoding: 'utf8',
  });
}

/** Pull every left-hand key out of a `const NAME: ... = { ... };` table literal. */
function extractTableKeys(source: string, constName: string): string[] {
  const tableMatch = source.match(new RegExp(`const ${constName}[^{]*\\{([\\s\\S]*?)\\n\\};`));
  if (tableMatch?.[1] === undefined) {
    throw new Error(`could not find ${constName} in the pre-resize chords.ts`);
  }
  const keys: string[] = [];
  for (const line of tableMatch[1].split('\n')) {
    const keyMatch = line.match(/^\s*(?:'([^']+)'|([A-Za-z0-9-]+)):\s*\{/);
    if (keyMatch) {
      keys.push((keyMatch[1] ?? keyMatch[2]) as string);
    }
  }
  return keys;
}

/** Feed a whole sequence and return the actions it produced, in order. */
function type(keys: string[], from: ChordState = EMPTY_CHORD) {
  let state = from;
  const actions = [];
  for (const key of keys) {
    const step = resolveChord(state, key);
    state = step.state;
    if (step.action !== null) {
      actions.push(step.action);
    }
  }
  return { state, actions };
}

describe('resolveChord — single keys', () => {
  it('maps hjkl to the four directions', () => {
    expect(type(['h']).actions).toEqual([{ kind: 'move', direction: 'left' }]);
    expect(type(['j']).actions).toEqual([{ kind: 'move', direction: 'down' }]);
    expect(type(['k']).actions).toEqual([{ kind: 'move', direction: 'up' }]);
    expect(type(['l']).actions).toEqual([{ kind: 'move', direction: 'right' }]);
  });

  it('maps the standalone keys from §4', () => {
    expect(type(['f']).actions).toEqual([{ kind: 'jump' }]);
    expect(type(['G']).actions).toEqual([{ kind: 'last' }]);
    expect(type(['/']).actions).toEqual([{ kind: 'search' }]);
    expect(type(['n']).actions).toEqual([{ kind: 'searchNext' }]);
    expect(type(['N']).actions).toEqual([{ kind: 'searchPrev' }]);
    expect(type(['Enter']).actions).toEqual([{ kind: 'open' }]);
    expect(type(['Escape']).actions).toEqual([{ kind: 'cancel' }]);
  });

  it('ignores a key that means nothing here', () => {
    expect(type(['q']).actions).toEqual([]);
  });
});

describe('resolveChord — two-key chords', () => {
  it('gg goes to the first node', () => {
    expect(type(['g', 'g']).actions).toEqual([{ kind: 'first' }]);
  });

  it('gt and gT step between projects', () => {
    expect(type(['g', 't']).actions).toEqual([{ kind: 'project', delta: 1 }]);
    expect(type(['g', 'T']).actions).toEqual([{ kind: 'project', delta: -1 }]);
  });

  it('yy copies the commands', () => {
    expect(type(['y', 'y']).actions).toEqual([{ kind: 'copy' }]);
  });

  it('emits nothing on the first key of a chord', () => {
    const { actions, state } = type(['g']);
    expect(actions).toEqual([]);
    expect(state.pending).toBe('g');
  });

  it('clears the chord once it completes, so ggg is not gg twice', () => {
    const { actions, state } = type(['g', 'g', 'g']);
    expect(actions).toEqual([{ kind: 'first' }]);
    expect(state.pending).toBe('g');
  });
});

describe('resolveChord — gr, removed', () => {
  it('gr resolves to no action at all — the removed binding must not resolve to something unhandled', () => {
    expect(type(['g', 'r']).actions).toEqual([]);
  });
});

describe('resolveChord — abandoning a chord', () => {
  it('drops an unfinished chord rather than acting on its second key', () => {
    // `gj` is not a binding. It must do nothing at all — silently falling
    // through to plain `j` would move the cursor somewhere the person did not
    // ask to go, which is worse than ignoring the key.
    const { actions, state } = type(['g', 'j']);
    expect(actions).toEqual([]);
    expect(state.pending).toBeNull();
  });

  it('lets the next key work normally after an abandoned chord', () => {
    expect(type(['g', 'j', 'j']).actions).toEqual([{ kind: 'move', direction: 'down' }]);
  });

  it('Escape cancels a half-typed chord and reports the cancel', () => {
    const { actions, state } = type(['g', 'Escape']);
    expect(actions).toEqual([{ kind: 'cancel' }]);
    expect(state.pending).toBeNull();
  });

  it('y then g does not become a g chord', () => {
    const { actions, state } = type(['y', 'g']);
    expect(actions).toEqual([]);
    expect(state.pending).toBeNull();
  });
});

describe('resolveChord — purity', () => {
  it('never mutates the state it is handed', () => {
    const before: ChordState = { pending: 'g' };
    resolveChord(before, 'g');
    expect(before.pending).toBe('g');
  });
});

describe('normalizeKey — the < / , collision question (AC-5c)', () => {
  it('a real Shift+, keydown and a real Shift+. keydown normalize distinct from plain ","', () => {
    // A browser already applies Shift to a printable key before the event
    // reaches JS: Shift+, arrives with `event.key === '<'`, not `','` with a
    // shift flag. These two objects are exactly what `keydown` hands
    // `normalizeKey` for that real gesture on a US layout.
    const shiftComma = normalizeKey({ key: '<', shiftKey: true });
    const shiftPeriod = normalizeKey({ key: '>', shiftKey: true });
    const plainComma = normalizeKey({ key: ',' });

    expect(shiftComma).toBe('<');
    expect(shiftPeriod).toBe('>');
    expect(plainComma).toBe(',');
    // The collision question, answered by the run: distinct identifiers mean
    // `<` and `>` are free to bind directly, without a `z`-prefixed fallback.
    expect(shiftComma).not.toBe(plainComma);
    expect(shiftPeriod).not.toBe(plainComma);
  });
});

describe('resize chords were free before this change (AC-5a)', () => {
  it('<, > and the z-prefix resolved to nothing in the pre-resize table', () => {
    const source = oldChordsSource();
    const singleKeys = extractTableKeys(source, 'SINGLE');
    expect(singleKeys.length).toBeGreaterThan(0); // non-vacuity: the extraction found the real table
    expect(singleKeys).not.toContain('<');
    expect(singleKeys).not.toContain('>');

    const prefixMatch = source.match(/const PREFIXES = \[([^\]]*)\]/);
    const prefixes = [...(prefixMatch?.[1] ?? '').matchAll(/'([a-zA-Z])'/g)].map((m) => m[1]);
    expect(prefixes.length).toBeGreaterThan(0);
    expect(prefixes).not.toContain('z');
  });
});

describe('every old binding still resolves the same way (AC-5b)', () => {
  it('covers the full table by construction', () => {
    // hjkl
    expect(type(['h']).actions).toEqual([{ kind: 'move', direction: 'left' }]);
    expect(type(['j']).actions).toEqual([{ kind: 'move', direction: 'down' }]);
    expect(type(['k']).actions).toEqual([{ kind: 'move', direction: 'up' }]);
    expect(type(['l']).actions).toEqual([{ kind: 'move', direction: 'right' }]);
    // single keys
    expect(type(['i']).actions).toEqual([{ kind: 'prompt' }]);
    expect(type(['I']).actions).toEqual([{ kind: 'focusAction' }]);
    expect(type(['H']).actions).toEqual([{ kind: 'focusList' }]);
    expect(type(['r']).actions).toEqual([{ kind: 'rename' }]);
    expect(type(['s']).actions).toEqual([{ kind: 'icon' }]);
    expect(type(['x']).actions).toEqual([{ kind: 'close' }]);
    expect(type(['o']).actions).toEqual([{ kind: 'newSession' }]);
    expect(type([',']).actions).toEqual([{ kind: 'settings' }]);
    expect(type(['f']).actions).toEqual([{ kind: 'jump' }]);
    expect(type(['G']).actions).toEqual([{ kind: 'last' }]);
    expect(type(['/']).actions).toEqual([{ kind: 'search' }]);
    expect(type(['n']).actions).toEqual([{ kind: 'searchNext' }]);
    expect(type(['N']).actions).toEqual([{ kind: 'searchPrev' }]);
    expect(type(['Enter']).actions).toEqual([{ kind: 'open' }]);
    expect(type(['Mod-k']).actions).toEqual([{ kind: 'palette' }]);
    // two-key chords
    expect(type(['g', 'g']).actions).toEqual([{ kind: 'first' }]);
    expect(type(['g', 't']).actions).toEqual([{ kind: 'project', delta: 1 }]);
    expect(type(['g', 'T']).actions).toEqual([{ kind: 'project', delta: -1 }]);
    expect(type(['y', 'y']).actions).toEqual([{ kind: 'copy' }]);
    // Escape
    expect(type(['Escape']).actions).toEqual([{ kind: 'cancel' }]);
  });
});

describe('the new resize chords (AC-5c continued)', () => {
  it('< and > resolve to resizePane, distinct from the settings binding', () => {
    expect(type(['<']).actions).toEqual([{ kind: 'resizePane', delta: -1 }]);
    expect(type(['>']).actions).toEqual([{ kind: 'resizePane', delta: 1 }]);
    expect(type([',']).actions).toEqual([{ kind: 'settings' }]);
  });

  it('z0 resets both panes, and z alone is a pending prefix like g and y', () => {
    const pending = type(['z']);
    expect(pending.actions).toEqual([]);
    expect(pending.state.pending).toBe('z');
    expect(type(['z', '0']).actions).toEqual([{ kind: 'resetPanes' }]);
  });

  it('an unrecognised second key after z abandons the chord silently', () => {
    const { actions, state } = type(['z', 'q']);
    expect(actions).toEqual([]);
    expect(state.pending).toBeNull();
  });
});

/**
 * ONE digit family, whose meaning follows the keyboard.
 *
 * Three arrangements in three changes, so this one is written as a RULE
 * rather than as a table: `Mod-<digit>` is a POSITION, in whatever the
 * keyboard is pointed at. The sidebar has the keyboard, it is a session; the
 * response pane has it, it is a tab. The grammar therefore reports the
 * position and nothing else — which pane is looking is not something a pure
 * reducer over a one-key memory can know, and `Canvas` already owns that
 * state as `pane`.
 *
 * What killed the previous arrangement is not taste: `Cmd+Shift+3`, `4` and
 * `5` are macOS screenshot hotkeys, matched by the OS before any Electron
 * window sees the keydown (verified on this machine in
 * `com.apple.symbolichotkeys`, entries 28-31 and 184, all enabled, with
 * modifier mask 0x120000 = shift|command over keycodes for 3, 4 and 5). Any
 * binding placed there is unreachable, whichever family holds it.
 */
describe('Mod-digit is a position, and the pane decides what it is a position in', () => {
  it('reports the position, 1-based, for every digit the row offers', () => {
    expect(type(['Mod-1']).actions).toEqual([{ kind: 'position', digit: 1 }]);
    expect(type(['Mod-4']).actions).toEqual([{ kind: 'position', digit: 4 }]);
    expect(type(['Mod-9']).actions).toEqual([{ kind: 'position', digit: 9 }]);
  });

  it('carries no pane of its own — the grammar stays a pure reducer', () => {
    // The same keystroke yields the same action whatever is on screen; the
    // fork lives in `Canvas`, which is the one place that knows `pane`.
    expect(type(['Mod-2']).actions).toEqual(type(['Mod-2']).actions);
    expect(Object.keys(type(['Mod-2']).actions[0] as object).sort()).toEqual(['digit', 'kind']);
  });

  it('binds no Mod-Shift digit at all — the OS owns three of them', () => {
    for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      expect(type([`Mod-Shift-${digit}`]).actions, digit).toEqual([]);
    }
  });

  it('leaves Mod-0 unbound — z0 already owns the zero', () => {
    expect(type(['Mod-0']).actions).toEqual([]);
    expect(type(['z', '0']).actions).toEqual([{ kind: 'resetPanes' }]);
  });

  it('a bare digit stays unbound, so a stray 7 does not move the cursor', () => {
    expect(type(['1']).actions).toEqual([]);
    expect(type(['9']).actions).toEqual([]);
  });

  /**
   * The assertion that catches a later "simplification" of `normalizeKey` back
   * to `event.key`. Dropping the Shift family does not drop this need: on
   * AZERTY the unshifted key at `Digit1` reports `&`, and only the POSITION
   * spells it `Mod-1`. Run end to end through the grammar, so it fails at the
   * binding rather than at a string comparison.
   */
  it('resolves from a real keydown, spelled by position rather than by character', () => {
    const azerty = normalizeKey({ key: '&', code: 'Digit1', metaKey: true });
    expect(azerty).toBe('Mod-1');
    expect(type([azerty as string]).actions).toEqual([{ kind: 'position', digit: 1 }]);
    const us = normalizeKey({ key: '1', code: 'Digit1', ctrlKey: true });
    expect(type([us as string]).actions).toEqual([{ kind: 'position', digit: 1 }]);
  });
});

describe('? opens the shortcut sheet', () => {
  it('resolves the string a real Shift+/ keydown normalizes to', () => {
    // Verified rather than assumed: on most layouts `?` arrives as Shift+`/`,
    // and the binding is only reachable if `normalizeKey` yields the same
    // string the table is written in.
    const key = normalizeKey({ key: '?', shiftKey: true });
    expect(key).toBe('?');
    expect(type([key as string]).actions).toEqual([{ kind: 'help' }]);
  });

  it('leaves the chord prefixes working — ? is not a prefix and eats nothing', () => {
    expect(type(['g', 'g']).actions).toEqual([{ kind: 'first' }]);
    expect(type(['?', 'g', 't']).actions).toEqual([
      { kind: 'help' },
      { kind: 'project', delta: 1 },
    ]);
    expect(type(['y', 'y']).actions).toEqual([{ kind: 'copy' }]);
    expect(type(['z', '0']).actions).toEqual([{ kind: 'resetPanes' }]);
  });

  it('does not steal the plain / search binding', () => {
    expect(type(['/']).actions).toEqual([{ kind: 'search' }]);
  });
});

/**
 * The digit row under a modifier, spelled from the KEY'S POSITION.
 *
 * Two separate questions, and the answers differ from the ones the `Tab`
 * finding produced for named keys. Shift gets no token in `normalizeKey`
 * because the browser already applied it — true for `?` and `<`, and the
 * reason a `Tab` entry would also answer a plain Tab. A digit is the other
 * case: Shift DOES alter it, so `Cmd+Shift+1` arrives as `!`, which is
 * distinct from `Mod-1` but is not the position the binding is about — and on
 * a layout whose digit row is shifted (AZERTY) plain `Cmd+1` arrives as `&`,
 * which is how the digit bindings came to be simply dead there.
 *
 * Nothing is bound under Shift any more (macOS owns `Cmd+Shift+3/4/5`), so
 * the Shift half of `normalizeKey` guards a spelling no table uses today. It
 * stays: it is what stops a shifted digit from arriving as `Mod-!` and
 * silently matching the unshifted binding, which is the bug the token exists
 * to prevent, not a feature of whichever family happened to use it.
 *
 * `event.code` is the fix for both: it names the physical digit, which is
 * exactly what "1..8 are positions" already claimed to mean.
 */
describe('normalizeKey — the digit row is a position, not a character', () => {
  it('spells a shifted digit by its position, distinctly from the unshifted one', () => {
    // A real macOS US-layout Cmd+Shift+1: the browser shifted the digit to `!`.
    const shifted = normalizeKey({ key: '!', code: 'Digit1', metaKey: true, shiftKey: true });
    const plain = normalizeKey({ key: '1', code: 'Digit1', metaKey: true });
    expect(plain).toBe('Mod-1');
    expect(shifted).toBe('Mod-Shift-1');
    // The whole point: one gesture must not answer the other's binding.
    expect(shifted).not.toBe(plain);
  });

  it('reads the digit off the position on a layout whose digit row is shifted', () => {
    // AZERTY: the unshifted key at Digit1 is `&`. Before this, `Mod-&`.
    expect(normalizeKey({ key: '&', code: 'Digit1', metaKey: true })).toBe('Mod-1');
    expect(normalizeKey({ key: '1', code: 'Digit1', metaKey: true, shiftKey: true })).toBe(
      'Mod-Shift-1',
    );
  });

  it('leaves shifted LETTERS folded, as the table comment requires', () => {
    // Cmd-K and Cmd-Shift-K stay one gesture: `palette` is bound once.
    expect(normalizeKey({ key: 'K', code: 'KeyK', metaKey: true, shiftKey: true })).toBe('Mod-k');
    expect(normalizeKey({ key: 'k', code: 'KeyK', metaKey: true })).toBe('Mod-k');
  });

  it('is unchanged for a digit typed with no modifier at all', () => {
    // The `!` typeahead in the sidebar filter must keep receiving `!`.
    expect(normalizeKey({ key: '!', code: 'Digit1', shiftKey: true })).toBe('!');
    expect(normalizeKey({ key: '1', code: 'Digit1' })).toBe('1');
  });

  it('spells Alt and Mod-Alt over the position too', () => {
    // macOS Alt+1 prints `\u00a1`; the position is still Digit1.
    expect(normalizeKey({ key: '\u00a1', code: 'Digit1', altKey: true })).toBe('Alt-1');
    expect(normalizeKey({ key: '\u00a1', code: 'Digit1', altKey: true, metaKey: true })).toBe(
      'Mod-Alt-1',
    );
  });

  it('falls back to the character when no code is reported', () => {
    expect(normalizeKey({ key: '1', metaKey: true })).toBe('Mod-1');
  });
});
