/**
 * The persisted "let paired devices write" preference.
 *
 * No fixture here holds a real path; every path is a fresh `mkdtemp`.
 */

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  openWritesPreference,
  writesPreferencePath,
} from '../../../src/main/remote/writes-preference.js';

async function tmpPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vam-writes-preference-'));
  return join(dir, 'remote-writes.json');
}

describe('openWritesPreference', () => {
  it('reads off when nothing was ever persisted -- the packaged-app default', async () => {
    const preference = await openWritesPreference(await tmpPath());
    expect(preference.get()).toBe(false);
  });

  it('an explicit `set(true)` persists, and reopening the same path reads it back', async () => {
    const path = await tmpPath();
    const first = await openWritesPreference(path);
    await first.set(true);
    expect(first.get()).toBe(true);

    const second = await openWritesPreference(path);
    expect(second.get()).toBe(true);
  });

  it('set(false) reverses a previously persisted true', async () => {
    const path = await tmpPath();
    const first = await openWritesPreference(path);
    await first.set(true);
    await first.set(false);

    const second = await openWritesPreference(path);
    expect(second.get()).toBe(false);
  });

  it('a corrupt file reads as off rather than throwing', async () => {
    const path = await tmpPath();
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, 'not json');

    const preference = await openWritesPreference(path);

    expect(preference.get()).toBe(false);
  });

  it('writesPreferencePath lives under the given userData directory', () => {
    expect(writesPreferencePath('/example/userData')).toBe('/example/userData/remote-writes.json');
  });

  it('persists the shape a later read expects', async () => {
    const path = await tmpPath();
    const preference = await openWritesPreference(path);
    await preference.set(true);

    const raw = JSON.parse(await readFile(path, 'utf8'));
    expect(raw).toEqual({ version: 1, allowWrites: true });
  });
});
