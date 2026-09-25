/**
 * The worktrees feature's three IPC handlers -- list, create, remove -- each
 * validated here before `worktrees.ts` is ever called, the same rule every
 * handler in `ipc/handlers.ts` follows: the renderer is the least trusted
 * process in this app, and a handler that trusted its shape would be a write
 * primitive addressable by anything that got into the page.
 *
 * `worktrees.ts`'s own functions already resolve to `SourceError | T`, never
 * throw -- `toResult` is the one place that shape is folded into the
 * `IpcResult` envelope every other channel already answers through.
 */

import type {
  CreateWorktreeInput,
  RemoveWorktreeInput,
  RemoveWorktreeOutcome,
  WorktreeInfo,
} from '../../shared/worktree.js';
import { CHANNELS, type IpcResult, type SourceError } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import { isDirectoryPath, isOptionalBool, isOptionalText, isText } from '../ipc/validators.js';
import { createWorktree, listWorktrees, removeWorktree, type WorktreesDeps } from './worktrees.js';

const refused = (code: string, message: string): SourceError => ({
  kind: 'refused',
  code,
  message,
});

function isCreateInput(value: unknown): value is CreateWorktreeInput {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return isText(row.projectId) && isText(row.name) && isOptionalText(row.baseRef);
}

/**
 * `worktreeId` is validated as a directory PATH (`isDirectoryPath`), not a
 * plain label -- it is the realpath `list()` handed back, and the same
 * absolute-and-NUL-free bound every other path-shaped argument on this
 * bridge already carries (`create-session-in`'s own `cwd`).
 *
 * `projectId` is REQUIRED (`isText`, not `isOptionalText`) -- `worktrees.ts`
 * rule 6: without it, `removeWorktree` has no known repo to confine
 * `worktreeId` against at all, so a missing `projectId` is refused at the
 * SHAPE gate here rather than reaching main's own "unknown project" refusal
 * one call deeper.
 */
function isRemoveInput(value: unknown): value is RemoveWorktreeInput {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isText(row.projectId) &&
    isDirectoryPath(row.worktreeId) &&
    isOptionalBool(row.force) &&
    isOptionalText(row.confirmName)
  );
}

function toResult<T extends object>(outcome: SourceError | T): IpcResult<T> {
  return 'kind' in outcome ? { ok: false, error: outcome } : { ok: true, value: outcome };
}

export function registerWorktreesIpc(ipcMain: IpcMainLike, deps: WorktreesDeps): void {
  ipcMain.handle(
    CHANNELS.worktreeList,
    async (_event, ...args): Promise<IpcResult<readonly WorktreeInfo[]>> => {
      const [projectId] = args;
      if (!isText(projectId)) {
        return {
          ok: false,
          error: refused('invalid-payload', 'worktree:list takes one project id'),
        };
      }
      return toResult(await listWorktrees(projectId, deps));
    },
  );

  ipcMain.handle(
    CHANNELS.worktreeCreate,
    async (_event, ...args): Promise<IpcResult<WorktreeInfo>> => {
      const [input] = args;
      if (!isCreateInput(input)) {
        return {
          ok: false,
          error: refused('invalid-payload', 'worktree:create takes {projectId, name, baseRef?}'),
        };
      }
      return toResult(await createWorktree(input, deps));
    },
  );

  ipcMain.handle(
    CHANNELS.worktreeRemove,
    async (_event, ...args): Promise<IpcResult<RemoveWorktreeOutcome>> => {
      const [input] = args;
      if (!isRemoveInput(input)) {
        return {
          ok: false,
          error: refused(
            'invalid-payload',
            'worktree:remove takes {projectId, worktreeId, force?, confirmName?}',
          ),
        };
      }
      return toResult(await removeWorktree(input, deps));
    },
  );
}
