/**
 * The persisted "let paired devices write" preference.
 *
 * Writes are an explicit act (`server.ts`'s module comment). Defaulting them
 * to on the moment `VAM_REMOTE_PORT` stopped being required would undo that
 * on purpose; defaulting them to off and leaving no way to turn them on in a
 * packaged app -- which has no shell to set `VAM_REMOTE_WRITES` in -- would
 * make the feature's whole point (a phone that can actually send a prompt)
 * permanently unreachable. So this is a PREFERENCE: an operator choice made
 * at the pairing screen, off until they explicitly turn it on, and durable
 * across a restart -- unlike an environment variable, which a packaged app
 * never has.
 *
 * Read once at launch (`src/main/index.ts`), the same way `RemoteConfig`
 * itself is: the write routes are registered or not when the server starts
 * (`server.ts` point 3), and a preference changed while it is running takes
 * effect the next time vam starts, exactly like `VAM_REMOTE_WRITES` always
 * has.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** The preference's home under Electron `userData`. */
export const writesPreferencePath = (userData: string): string =>
  join(userData, 'remote-writes.json');

export type WritesPreference = {
  get(): boolean;
  set(next: boolean): Promise<void>;
};

/** A file this process cannot parse is read as "off", never as "on". */
async function read(path: string): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return (parsed as { allowWrites?: unknown } | null)?.allowWrites === true;
  } catch {
    return false;
  }
}

async function persist(path: string, allowWrites: boolean): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
  // Written beside the target and renamed, exactly as `devices.ts` does: a
  // crash mid-write must not leave a half-file this process then reads as
  // the wrong answer.
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, allowWrites }), { mode: FILE_MODE });
  await rename(temporary, path);
}

export async function openWritesPreference(path: string): Promise<WritesPreference> {
  let enabled = await read(path);
  return {
    get: () => enabled,
    async set(next: boolean): Promise<void> {
      await persist(path, next);
      enabled = next;
    },
  };
}
