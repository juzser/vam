import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openUpdateState, updateStatePath } from '../../src/main/update/state-file.js';

async function dir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vam-update-state-'));
}

describe('update state file', () => {
  it('lives under userData', () => {
    expect(updateStatePath('/u')).toBe(join('/u', 'update-state.json'));
  });

  it('defaults: auto-check on, never checked, nothing dismissed', async () => {
    const store = await openUpdateState(join(await dir(), 'update-state.json'));
    expect(store.get()).toEqual({
      version: 1,
      autoCheck: true,
      lastCheckAt: null,
      dismissedVersion: null,
    });
  });

  it('persists a patch and reads it back after a reopen', async () => {
    const path = join(await dir(), 'update-state.json');
    const store = await openUpdateState(path);
    await store.update({ autoCheck: false, lastCheckAt: 123 });
    await store.update({ dismissedVersion: '0.2.0' });
    expect(store.get()).toEqual({
      version: 1,
      autoCheck: false,
      lastCheckAt: 123,
      dismissedVersion: '0.2.0',
    });
    expect((await openUpdateState(path)).get()).toEqual(store.get());
  });

  it('writes the file private (0o600) and leaves no temp file behind', async () => {
    const path = join(await dir(), 'update-state.json');
    const store = await openUpdateState(path);
    await store.update({ autoCheck: false });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(stat(`${path}.tmp`)).rejects.toThrow();
  });

  it('reads a corrupt file as defaults', async () => {
    const path = join(await dir(), 'update-state.json');
    await writeFile(path, '{not json');
    expect((await openUpdateState(path)).get().autoCheck).toBe(true);
  });

  it('ignores wrongly typed fields individually', async () => {
    const path = join(await dir(), 'update-state.json');
    await writeFile(
      path,
      JSON.stringify({ version: 1, autoCheck: 'no', lastCheckAt: 'x', dismissedVersion: 4 }),
    );
    expect((await openUpdateState(path)).get()).toEqual({
      version: 1,
      autoCheck: true,
      lastCheckAt: null,
      dismissedVersion: null,
    });
  });

  it('keeps autoCheck false when the file says false', async () => {
    const path = join(await dir(), 'update-state.json');
    await writeFile(path, JSON.stringify({ version: 1, autoCheck: false }));
    expect((await openUpdateState(path)).get().autoCheck).toBe(false);
    expect(JSON.parse(await readFile(path, 'utf8')).autoCheck).toBe(false);
  });

  it('serialises concurrent updates so none is lost', async () => {
    const path = join(await dir(), 'update-state.json');
    const store = await openUpdateState(path);
    await Promise.all([
      store.update({ lastCheckAt: 1 }),
      store.update({ dismissedVersion: '9.9.9' }),
      store.update({ autoCheck: false }),
    ]);
    expect((await openUpdateState(path)).get()).toEqual({
      version: 1,
      autoCheck: false,
      lastCheckAt: 1,
      dismissedVersion: '9.9.9',
    });
  });
});
