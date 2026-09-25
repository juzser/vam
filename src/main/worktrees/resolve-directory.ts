/**
 * `projectId -> directory`, for the worktrees feature -- the SAME two-tier
 * resolution `create-session.ts`'s `createSessionInProject` already applies
 * (its own `paneProjectDirectory`), reimplemented here as a small pure
 * function rather than imported, so this module carries no dependency on
 * that file's tmux/session machinery. `renderer/domain/model.ts` carries no
 * `cwd` field on `Project` (deliberately -- see that file), so a live agent
 * or a live pane is the ONLY way main can ever turn a project id back into a
 * path at all.
 *
 * LIVE AGENTS FIRST, A PANE ONLY WHEN NO AGENT ANSWERS -- a project right
 * after "Start" is a pane row with no agent yet, exactly as
 * `createSessionInProject`'s own header explains.
 *
 * A PROJECT ID MORE THAN ONE PANE DISAGREES ABOUT is refused (`null`), never
 * guessed at: the same rule `paneProjectDirectory` applies to a project no
 * live agent names either.
 */

import type { LiveAgent } from '../sources/claude-code/agents.js';
import { projectIdOf } from '../sources/claude-code/project-id.js';
import type { TmuxSession } from '../sources/tmux/spawn.js';

export function resolveProjectDirectoryFrom(
  agents: readonly LiveAgent[],
  panes: readonly TmuxSession[],
  projectId: string,
): string | null {
  const fromAgent = agents.find((agent) => projectIdOf(agent.cwd) === projectId)?.cwd;
  if (fromAgent !== undefined) return fromAgent;

  const cwds = new Set<string>();
  for (const pane of panes) {
    if (pane.cwd === undefined || pane.cwd === '') continue;
    const id =
      pane.project !== undefined && pane.project !== '' ? pane.project : projectIdOf(pane.cwd);
    if (id === projectId) cwds.add(pane.cwd);
  }
  return cwds.size === 1 ? (cwds.values().next().value as string) : null;
}
