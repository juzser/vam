/**
 * The Terminal font-family picker's one channel: every monospace-looking
 * family this machine's font directories carry, off `list-monospace.ts`.
 *
 * BARE, NEVER AN `IpcResult`, the same posture `clipboard/ipc.ts` and
 * `update/ipc.ts` take: the only thing a caller can do with an enumeration
 * failure is fall back to free text, which the renderer already does for an
 * empty answer — there is no refusal here worth a `SourceError`'s own words.
 */

import * as fs from 'node:fs';
import { homedir } from 'node:os';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import { listMonospaceFontFamilies } from './list-monospace.js';

/**
 * `lister` IS INJECTABLE, defaulting to the real scan of THIS machine — the
 * same seam `update/ipc.ts` takes for its own network check, so a test never
 * has to touch a real filesystem to exercise the handler's own error
 * handling.
 */
export function registerFontsIpc(
  ipcMain: IpcMainLike,
  lister: () => readonly string[] = () =>
    listMonospaceFontFamilies({ platform: process.platform, homedir: homedir(), fs }),
): void {
  ipcMain.handle(CHANNELS.fontsListMonospace, async (): Promise<readonly string[]> => {
    try {
      return lister();
    } catch {
      // A failure here is a fact about this machine's disk, not a
      // `SourceError` there is a source to phrase in the words of (the same
      // argument `StatsResult` makes for its own scan) — the picker's own
      // free-text field is what an operator falls back to either way.
      return [];
    }
  });
}
