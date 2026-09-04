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
