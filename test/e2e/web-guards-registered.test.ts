/**
 * Pins that two web guards stay registered (EC-117).
 *
 * Closes f-vam-ux-3/followup-35bd1034-35bd1034 and
 * f-vam-ux-3/followup-cf3eb152-cf3eb152. task-46 fixed both and added the e2e
 * checks (fix commit e7a94dfa): EC-91 in `e2e/phone-question-shots.mjs` and
 * EC-101 in `e2e/turn-steps-shots.mjs`. Those scripts run only because
 * `e2e/run-web-guards.mjs` lists them in its GUARDS array. Vitest cannot
 * measure the paint or the geometry; it can pin that both stay listed.
 * A name on a comment line is not an entry, so commenting a guard out fails.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

function guardNames(): string[] {
  const lines = readFileSync(root('e2e/run-web-guards.mjs'), 'utf8').split('\n');
  const start = lines.indexOf('const GUARDS = [');
  const end = lines.findIndex((line, index) => index > start && line === '];');
  expect(start, 'the `const GUARDS = [` line').toBeGreaterThanOrEqual(0);
  expect(end, 'the closing `];` line').toBeGreaterThan(start);
  const block = lines.slice(start + 1, end).join('\n');
  return [...block.matchAll(/^\s*'([^']+)',?\s*$/gm)].map((match) => match[1] as string);
}

describe('web guards stay registered (EC-117)', () => {
  it.each([
    ['phone-question-shots', 'EC-91'],
    ['turn-steps-shots', 'EC-101'],
  ])('%s (%s) is listed once and its script exists', (name) => {
    expect(guardNames().filter((entry) => entry === name)).toHaveLength(1);
    expect(existsSync(root(`e2e/${name}.mjs`))).toBe(true);
  });
});
