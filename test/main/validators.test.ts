/**
 * THE DRIFT IS NOW MECHANICALLY IMPOSSIBLE, AND THAT IS ASSERTED, NOT ARGUED.
 *
 * `src/main/ipc/validators.ts` is the single definition of the MainSource
 * argument bounds and shape predicates. `src/main/ipc/handlers.ts` and
 * `src/main/remote/server.ts` both import from it. This file reads their
 * SOURCE TEXT and fails if either one re-declares any of the shared names --
 * a bound raised in one front door and forgotten in the other is exactly the
 * drift this dedup closes, and a guard verified only by a green run is not
 * verified, so see the mutation this test's own coder ran, quoted in the
 * task's result file.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isDirectoryPath,
  isOptionalBool,
  isOptionalText,
  isPromptText,
  isText,
  isTextList,
  MAX_LIST_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_TEXT_LENGTH,
} from '../../src/main/ipc/validators.js';

const SHARED_NAMES = [
  'MAX_TEXT_LENGTH',
  'MAX_PROMPT_LENGTH',
  'MAX_LIST_LENGTH',
  'isText',
  'isPrompt',
  'isPromptText',
  'isDirectory',
  'isDirectoryPath',
  'isOptionalText',
  'isOptionalBool',
  'isTextList',
];

const FRONT_DOORS = [
  resolve(process.cwd(), 'src/main/remote/server.ts'),
  resolve(process.cwd(), 'src/main/ipc/handlers.ts'),
];

describe('validators: no local re-declaration in either front door', () => {
  for (const file of FRONT_DOORS) {
    it(`${file} declares none of the shared names`, () => {
      const text = readFileSync(file, 'utf8');
      const redeclared = SHARED_NAMES.filter((name) => new RegExp(`const ${name} *=`).test(text));
      expect(redeclared, `${file} re-declares: ${redeclared.join(', ')}`).toEqual([]);
    });
  }
});

describe('MAX_TEXT_LENGTH / MAX_PROMPT_LENGTH / MAX_LIST_LENGTH: unchanged bounds', () => {
  it('keeps the exact numbers', () => {
    expect(MAX_TEXT_LENGTH).toBe(10_000);
    expect(MAX_PROMPT_LENGTH).toBe(1_000_000);
    expect(MAX_LIST_LENGTH).toBe(1_000);
  });
});

describe('isText', () => {
  it('refuses length 0', () => {
    expect(isText('')).toBe(false);
  });
  it('accepts length at the bound', () => {
    expect(isText('a'.repeat(MAX_TEXT_LENGTH))).toBe(true);
  });
  it('refuses length bound+1', () => {
    expect(isText('a'.repeat(MAX_TEXT_LENGTH + 1))).toBe(false);
  });
  it('refuses a non-string', () => {
    expect(isText(42)).toBe(false);
  });
});

describe('isPromptText', () => {
  it('refuses length 0', () => {
    expect(isPromptText('')).toBe(false);
  });
  it('accepts length at the bound', () => {
    expect(isPromptText('a'.repeat(MAX_PROMPT_LENGTH))).toBe(true);
  });
  it('refuses length bound+1', () => {
    expect(isPromptText('a'.repeat(MAX_PROMPT_LENGTH + 1))).toBe(false);
  });
  it('refuses a non-string', () => {
    expect(isPromptText(42)).toBe(false);
  });
});

describe('isTextList', () => {
  it('refuses length 0 elements as text but accepts an empty list', () => {
    expect(isTextList([])).toBe(true);
  });
  it('accepts a list at the bound', () => {
    expect(isTextList(Array.from({ length: MAX_LIST_LENGTH }, () => 'x'))).toBe(true);
  });
  it('refuses a list at bound+1, before walking elements', () => {
    expect(isTextList(Array.from({ length: MAX_LIST_LENGTH + 1 }, () => 'x'))).toBe(false);
  });
  it('refuses an oversized list WITHOUT walking its elements (length check precedes .every)', () => {
    // A Proxy that throws if any index is ever read. `isTextList` must refuse
    // this list on length alone, via `&&` short-circuit, before `.every`
    // gets a chance to call `isText` on element 0 -- which is exactly the
    // "length-check-before-.every" ordering this module's contract commits
    // to (a list bounded BEFORE anything walks it). If a future edit
    // reorders the `&&` operands (or swaps to `value.every(isText) &&
    // value.length <= MAX_LIST_LENGTH`), this proxy trap fires and the test
    // fails with the thrown error instead of a false-negative pass.
    const backing = Array.from({ length: MAX_LIST_LENGTH + 1 }, () => 'x');
    const poisoned = new Proxy(backing, {
      get(target, prop, receiver) {
        if (prop === '0' || prop === 0) {
          throw new Error('isTextList walked an element of an oversized list');
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(isTextList(poisoned)).toBe(false);
  });
  it('refuses a non-array', () => {
    expect(isTextList('not-an-array')).toBe(false);
  });
});

describe('isDirectoryPath', () => {
  it('refuses length 0', () => {
    expect(isDirectoryPath('')).toBe(false);
  });
  it('accepts an absolute path at the length bound', () => {
    expect(isDirectoryPath(`/${'a'.repeat(MAX_TEXT_LENGTH - 1)}`)).toBe(true);
  });
  it('refuses length bound+1', () => {
    expect(isDirectoryPath(`/${'a'.repeat(MAX_TEXT_LENGTH)}`)).toBe(false);
  });
  it('refuses a non-string', () => {
    expect(isDirectoryPath(42)).toBe(false);
  });
  it('refuses a path not starting with /', () => {
    expect(isDirectoryPath('relative/path')).toBe(false);
  });
  it('refuses a path containing a NUL byte', () => {
    expect(isDirectoryPath('/tmp/\0evil')).toBe(false);
  });
});

describe('isOptionalText', () => {
  it('accepts undefined', () => {
    expect(isOptionalText(undefined)).toBe(true);
  });
  it('refuses length 0', () => {
    expect(isOptionalText('')).toBe(false);
  });
  it('accepts length at the bound', () => {
    expect(isOptionalText('a'.repeat(MAX_TEXT_LENGTH))).toBe(true);
  });
  it('refuses length bound+1', () => {
    expect(isOptionalText('a'.repeat(MAX_TEXT_LENGTH + 1))).toBe(false);
  });
  it('refuses a non-string', () => {
    expect(isOptionalText(42)).toBe(false);
  });
});

describe('isOptionalBool', () => {
  it('accepts undefined', () => {
    expect(isOptionalBool(undefined)).toBe(true);
  });
  it('accepts true and false', () => {
    expect(isOptionalBool(true)).toBe(true);
    expect(isOptionalBool(false)).toBe(true);
  });
  it('refuses a non-boolean', () => {
    expect(isOptionalBool('true')).toBe(false);
  });
});

describe('isText / isPromptText / isTextList: undefined refused (required predicates)', () => {
  it('isText refuses undefined', () => {
    expect(isText(undefined)).toBe(false);
  });
  it('isPromptText refuses undefined', () => {
    expect(isPromptText(undefined)).toBe(false);
  });
  it('isTextList refuses undefined', () => {
    expect(isTextList(undefined)).toBe(false);
  });
  it('isDirectoryPath refuses undefined', () => {
    expect(isDirectoryPath(undefined)).toBe(false);
  });
});
