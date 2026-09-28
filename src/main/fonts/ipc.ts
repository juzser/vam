/**
 * The Terminal and UI font-family pickers' two channels: every family this
 * machine's font directories carry that looks monospace (`list-
 * monospace.ts`) or matches the curated UI list (`list-sans.ts`,
 * settings-views restructure, item G).
 *
 * BARE, NEVER AN `IpcResult`, the same posture `clipboard/ipc.ts` and
 * `update/ipc.ts` take: the only thing a caller can do with an enumeration
 * failure is fall back to the curated list (`shared/fonts.ts`), which the
 * renderer already does for an empty answer — there is no refusal here
 * worth a `SourceError`'s own words.
 */

import * as fs from 'node:fs';
import { homedir } from 'node:os';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import { listMonospaceFontFamilies } from './list-monospace.js';
import { listSansFontFamilies } from './list-sans.js';

/**
 * `monospaceLister`/`sansLister` ARE EACH INJECTABLE, defaulting to the real
 * scan of THIS machine — the same seam `update/ipc.ts` takes for its own
 * network check, so a test never has to touch a real filesystem to exercise
 * either handler's own error handling, and overriding one never disturbs
 * the other's default.
 */
export function registerFontsIpc(
  ipcMain: IpcMainLike,
  monospaceLister: () => readonly string[] = () =>
    listMonospaceFontFamilies({ platform: process.platform, homedir: homedir(), fs }),
  sansLister: () => readonly string[] = () =>
    listSansFontFamilies({ platform: process.platform, homedir: homedir(), fs }),
): void {
  ipcMain.handle(CHANNELS.fontsListMonospace, async (): Promise<readonly string[]> => {
    try {
      return monospaceLister();
    } catch {
      // A failure here is a fact about this machine's disk, not a
      // `SourceError` there is a source to phrase in the words of (the same
      // argument `StatsResult` makes for its own scan) — the picker's own
      // curated-list fallback is what an operator sees either way.
      return [];
    }
  });
  ipcMain.handle(CHANNELS.fontsListSans, async (): Promise<readonly string[]> => {
    try {
      return sansLister();
    } catch {
      return [];
    }
  });
}
