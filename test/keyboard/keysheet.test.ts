/**
 * The property that is the whole feature: the shortcut sheet is DERIVED from
 * the binding tables, so it cannot advertise a key that is not bound.
 *
 * Three shipped defects this week were one bug — a caption naming a control
 * that does not exist (`⇧Tab · cycle mode` with nothing on Tab). A
 * hand-written sheet would be a fourth and a bigger one, so every assertion
 * below walks `BINDING_TABLES` rather than a list written here: a list would
 * rot the moment a binding is added, which is precisely the failure mode.
 */

import { describe, expect, it } from 'vitest';
import { BINDING_TABLES, type KeyAction } from '../../src/renderer/keyboard/chords.js';
import {
  buildKeySheet,
  describeAction,
  GROUP_ORDER,
} from '../../src/renderer/keyboard/keysheet.js';

/** Every binding as the sheet must spell it: a chord is its two keys. */
function boundKeys(): { keys: string; action: KeyAction }[] {
  return BINDING_TABLES.flatMap(({ prefix, table }) =>
    Object.entries(table).map(([key, action]) => ({ keys: `${prefix}${key}`, action })),
  );
}

const sheetRows = () => buildKeySheet().flatMap((group) => group.rows);

describe('the sheet is generated from the binding tables', () => {
  it('walks a real corpus — the tables are not empty', () => {
    // Without this, every sweep below passes vacuously over zero entries.
    expect(BINDING_TABLES.length).toBeGreaterThanOrEqual(5);
    expect(boundKeys().length).toBeGreaterThan(25);
  });

  it('lists every entry of every binding table, exactly once', () => {
    const rendered = sheetRows().map((row) => row.keys);
    for (const { keys } of boundKeys()) {
      expect(rendered, `binding "${keys}" is bound but missing from the sheet`).toContain(keys);
    }
    // Unique per KEY AND MODE. A mode-dependent binding is deliberately listed
    // twice — once per cursor mode — so the old "exactly once per key" rule
    // would now forbid the very split the sheet exists to show. What must
    // still never happen is the same key listed twice for the same mode.
    const stamped = sheetRows().map((row) => `${row.keys}@${row.mode ?? 'both'}`);
    expect(new Set(stamped).size).toBe(stamped.length);
  });

  it('shows no key that is not in a table', () => {
    const bound = new Set(boundKeys().map(({ keys }) => keys));
    for (const row of sheetRows()) {
      expect(bound.has(row.keys), `sheet advertises "${row.keys}", which is not bound`).toBe(true);
    }
  });

  it('renders a chord as the two-key sequence it is, never its bare second key', () => {
    const rendered = new Set(sheetRows().map((row) => row.keys));
    for (const keys of ['gg', 'gt', 'gT', 'yy', 'z0']) {
      expect(rendered.has(keys), `"${keys}" must be shown as a sequence`).toBe(true);
    }
    // `t` alone is unbound: printing it would be exactly this feature's bug.
    for (const bare of ['t', 'T', 'y', '0']) {
      expect(rendered.has(bare), `"${bare}" is not bound on its own`).toBe(false);
    }
  });
});

/**
 * THE SHEET MAY NOT CAPTION A KEY THAT ONLY EVER REFUSES.
 *
 * The generated sheet's property is "no row without a binding". `+`, `-` and
 * `Z` had bindings, so they had rows — captioned 'zoom in', 'zoom out' and
 * 'fit the whole canvas in view' while their handlers answered "nothing to
 * zoom — the canvas view is gone". The canvas was deleted in 0.2, and a
 * caption for a control that cannot act is the defect this module exists to
 * make impossible, wearing the one shape the derivation does not catch: the
 * binding was real and did nothing.
 *
 * "Absent, not dimmed" is the codebase's rule, so the bindings are gone
 * rather than relabelled, and the keys are free for a real meaning.
 */
describe('nothing survives that names the deleted canvas view', () => {
  it('captions no row for a view vam no longer has', () => {
    for (const row of sheetRows()) {
      expect(row.label.toLowerCase(), `sheet row "${row.keys}"`).not.toMatch(
        /zoom|fit the whole canvas/,
      );
    }
  });

  it('leaves the keys it used to hold unbound', () => {
    const bound = new Set(boundKeys().map(({ keys }) => keys));
    for (const key of ['+', '-', 'Z']) {
      expect(bound.has(key), `"${key}" is still bound to something`).toBe(false);
    }
  });
});

/**
 * FOUR CAPTIONS DESCRIBED A GRAPH THE 0.2 REWRITE DELETED, or a mode split
 * only the `?` sheet resolves — audit of the keyboard-grammar prose.
 *
 * `jump` said "a labelled node"; labels land on sidebar ROWS now
 * (`jumpLabels` in `Canvas.tsx`), and only on the first `JUMP_KEYS.length`
 * of them. `copy` said "this step's commands"; there is no per-decision card
 * to walk a step onto any more, and `yy` reads `focusedDecision` — the
 * focused SESSION's newest TURN (`Canvas.tsx`'s own comment on that memo).
 * `focusAction` said "the action pane" as if there were several; the pane
 * holds exactly one (`buildActions`, `panels/actions.ts`).
 *
 * `open`'s BASE label is the one of these four with a `byMode` beside it —
 * and the base is what leaks past the mode split. `buildKeySheet` and the
 * settings editor's own per-mode sections (`sections.ts`'s `shortcutSections`)
 * both resolve `byMode` correctly; `SettingsOverlay.tsx`'s `labelFor`, which
 * names an action in a binding-clash message, does not — it reads this exact
 * field. "open the focused step" there would tell an operator whose `Enter`
 * collided with something else that their key "opens the focused step",
 * which Select never did even before the graph left.
 */
describe('captions match the model that exists, not the graph that left', () => {
  it('jump names sidebar rows, not graph nodes, and says how many labels reach', () => {
    const label = describeAction({ kind: 'jump' }).label;
    expect(label).not.toMatch(/node/);
    expect(label).toMatch(/first 20/);
  });

  it('copy names the turn it actually reads, not a step no card draws any more', () => {
    const label = describeAction({ kind: 'copy' }).label;
    expect(label).not.toMatch(/\bstep\b/);
    expect(label).toMatch(/newest turn/);
  });

  it('focusAction does not promise a choice the pane cannot offer', () => {
    const label = describeAction({ kind: 'focusAction' }).label;
    expect(label).toMatch(/prompt box/);
  });

  it('open’s BASE label — the one a binding clash actually shows — is true on its own', () => {
    const label = describeAction({ kind: 'open' }).label;
    // Must not repeat the retired "focused step" claim…
    expect(label).not.toMatch(/focused step/);
    // …and must not silently promise Select opens something, the way the old
    // one-caption-for-both-modes row did (audit F1).
    expect(label.toLowerCase()).toMatch(/select/);
    expect(label.toLowerCase()).toMatch(/insert/);
  });
});

describe('labels', () => {
  it('gives every bound action a non-empty label in a known group', () => {
    for (const { keys, action } of boundKeys()) {
      const meta = describeAction(action);
      expect(meta.label.length, `"${keys}" (${action.kind}) has an empty label`).toBeGreaterThan(0);
      expect(GROUP_ORDER).toContain(meta.group);
    }
  });

  it('throws on an action with no label instead of rendering a blank row', () => {
    // The next binding added without a label has to break a test, not ship a
    // row of empty space nobody notices.
    expect(() => describeAction({ kind: 'notALabelledAction' } as unknown as KeyAction)).toThrow(
      /notALabelledAction/,
    );
  });

  it('distinguishes the parameterised actions rather than repeating one label', () => {
    const labels = sheetRows().map((row) => row.label);
    expect(new Set(labels).size).toBeGreaterThan(labels.length / 2);
  });
});

describe('grouping', () => {
  it('emits groups in the declared order and never an empty one', () => {
    const groups = buildKeySheet();
    expect(groups.map((g) => g.group)).toEqual(
      GROUP_ORDER.filter((g) => groups.some((built) => built.group === g)),
    );
    for (const group of groups) {
      expect(group.rows.length).toBeGreaterThan(0);
      expect(group.title.length).toBeGreaterThan(0);
    }
  });
});
