/**
 * The updater's persisted state: whether to check on its own, when it last
 * did, and which release the operator said "Later" to.
 *
 * Mirrors `../remote/writes-preference.ts`: read once at open, kept in
 * memory, every change written beside the target and renamed so a crash
 * mid-write cannot leave a half-file. A file this process cannot parse is read
 * as the defaults, field by field.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export type UpdateState = {
  readonly version: 1;
  readonly autoCheck: boolean;
  /** Epoch ms of the last check attempt, or null when there never was one. */
  readonly lastCheckAt: number | null;
  /** The release the operator dismissed with "Later"; auto checks stay quiet about it. */
  readonly dismissedVersion: string | null;
};

export type UpdateStatePatch = Partial<Omit<UpdateState, 'version'>>;

export const DEFAULT_UPDATE_STATE: UpdateState = {
  version: 1,
  autoCheck: true,
  lastCheckAt: null,
  dismissedVersion: null,
};

/** The state's home under Electron `userData`. */
export const updateStatePath = (userData: string): string => join(userData, 'update-state.json');

export type UpdateStateStore = {
  get(): UpdateState;
  update(patch: UpdateStatePatch): Promise<void>;
};

async function read(path: string): Promise<UpdateState> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown> | null;
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_UPDATE_STATE;
    return {
      version: 1,
      autoCheck: typeof parsed.autoCheck === 'boolean' ? parsed.autoCheck : true,
      lastCheckAt:
        typeof parsed.lastCheckAt === 'number' && Number.isFinite(parsed.lastCheckAt)
          ? parsed.lastCheckAt
          : null,
      dismissedVersion:
        typeof parsed.dismissedVersion === 'string' ? parsed.dismissedVersion : null,
    };
  } catch {
    return DEFAULT_UPDATE_STATE;
  }
}

async function persist(path: string, state: UpdateState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: FILE_MODE });
  await rename(temporary, path);
}

export async function openUpdateState(path: string): Promise<UpdateStateStore> {
  let state = await read(path);
  // Writes are chained so two overlapping updates cannot race on the temp file.
  let queue: Promise<void> = Promise.resolve();
  return {
    get: () => state,
    update(patch: UpdateStatePatch): Promise<void> {
      state = { ...state, ...patch };
      const snapshot = state;
      const next = queue.then(() => persist(path, snapshot));
      queue = next.catch(() => {});
      return next;
    },
  };
}
