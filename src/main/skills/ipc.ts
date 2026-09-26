/**
 * The ADHD skill card's three channels: read status, install, remove.
 *
 * NOTHING HERE TRUSTS ITS ARGUMENTS, the same rule `ipc/handlers.ts` states
 * for the source channels -- except there is almost nothing to trust. Status
 * and remove read no argument at all; install reads exactly one, and folds
 * anything that is not the literal `true` to `false`, the same total
 * direction `main/terminal/concise.ts` used to take for its own switch. A
 * renderer cannot send a path here because no parameter exists for one to
 * travel through -- `deps` is built once, by `main/index.ts`, from
 * `defaultAdhdSkillDeps`, and every handler below closes over the same value.
 */

import type { AdhdSkillActionResult, AdhdSkillStatus } from '../../shared/adhd-skill.js';
import { CHANNELS } from '../ipc/channels.js';
import {
  type AdhdSkillDeps,
  installAdhdSkill,
  readAdhdSkillStatus,
  removeAdhdSkill,
} from './adhd-skill.js';

/** The slice of `ipcMain` this module uses, matching `ipc/handlers.ts`'s own
 *  `IpcMainLike` so this file is testable without `electron`. */
export type IpcMainLike = {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
};

export function registerAdhdSkillIpc(ipcMain: IpcMainLike, deps: AdhdSkillDeps): void {
  ipcMain.handle(CHANNELS.adhdSkillStatus, async (): Promise<AdhdSkillStatus> => {
    return readAdhdSkillStatus(deps);
  });

  ipcMain.handle(
    CHANNELS.adhdSkillInstall,
    async (_event, ...args: unknown[]): Promise<AdhdSkillActionResult> => {
      const force = args[0] === true;
      return installAdhdSkill(deps, force);
    },
  );

  ipcMain.handle(CHANNELS.adhdSkillRemove, async (): Promise<AdhdSkillActionResult> => {
    return removeAdhdSkill(deps);
  });
}
