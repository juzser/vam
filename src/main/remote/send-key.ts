/**
 * ONE ALLOWLISTED KEY, INTO A SESSION'S OWN PANE -- the phone's whole route
 * into a running agent, and the one write this module exists for.
 *
 * WHY THIS EXISTS AT ALL. The phone's key strip (`DetailPanel.tsx`'s
 * `KEY_STRIP`) presses `window.api.terminal.send` -- a bridge that
 * exists only in the Electron shell. A phone reached over Tailscale Serve has
 * no `window.api`, and `remote/server.ts`'s own `UNSERVED.terminal` says why
 * the REST of the terminal surface stays that way: read, resize and answer
 * all need their own decision, and full read/write into a pane is the
 * heaviest thing this server can be asked to do. A SINGLE KEY, from a FIXED
 * ALLOWLIST, is a much smaller promise -- Escape, Tab, Enter, Shift-Tab,
 * Space and Backspace are exactly the keys Claude Code's own option pickers
 * (`AskUserQuestion`, a permission prompt, `/model`, plan approval) are
 * walked with, never a channel for arbitrary text.
 *
 * THE RESOLUTION IS RECORDPROMPT'S OWN, reused rather than re-derived
 * (`claude-code/source.ts`'s `recordPrompt`, this module's whole model):
 *
 *   - A PANE ROW (`pane-row.ts`'s `paneNameOf`) names its own tmux session,
 *     and that name is re-proven against `listVamSessions` -- vam's own
 *     prefix-filtered listing -- before anything is sent. A caller cannot
 *     hand this route a pane name; it can only hand it a row id vam already
 *     issued, which decodes to a name vam already knows.
 *   - AN AGENT ROW goes through `paneForRow` (`reply.ts`), the same
 *     multi-tier proof `recordPrompt` and the desktop's own terminal reads
 *     use: the pane the session published about itself, else vam's own
 *     creation-time pid tag, else -- only when the project holds exactly one
 *     live row and one tagged pane -- the project tag.
 *
 * Both paths end at a NAME already proven to be a tmux session vam started
 * (`isVamSession`'s own prefix, checked inside `listVamSessions`), sent
 * through `sendToPane` (`terminal/pane.ts`), which is `paneTarget`'s `=name:`
 * EXACT tmux target -- never a caller-suppliable string, and never the
 * fnmatch-permissive form a bare `-t name` would be (`tmux/argv.ts`).
 *
 * WHAT THIS ROUTE DOES NOT DO. It carries no `projectId` -- `recordPrompt`
 * itself takes none, deriving everything from `sessionId` alone through the
 * proofs above, and a caller-supplied project id would be one more value to
 * validate for no safety it does not already have. It never accepts a tmux
 * key NAME from the caller: `remoteKeyToPaneKey` (`shared/remote-key.ts`) is a closed `switch` over six
 * literal ids, so nothing this route reads off the wire ever becomes an
 * argv token by itself (see `sendToPane`'s own header on why every one of
 * the five key-press builders is a fixed argv rather than a name-driven
 * one). And it is a POST, authenticated exactly like `/api/record-prompt` --
 * see `remote/server.ts`'s route table, which is the only place this
 * function is called from.
 *
 * NO POWER BEYOND THE PROMPT ROUTE. `/api/record-prompt` (`recordPrompt` ->
 * `replyToSession` -> `typeIntoPane`) already types arbitrary text followed by
 * Enter into this same pane, so a device that can press Enter here could
 * already do so there. Neither route reads the pane first, and neither gates
 * on a pending permission or plan-approval prompt: a key sent while one is
 * showing lands on whatever option the CLI's cursor sits on.
 */

import {
  isRemoteKeyId,
  REMOTE_KEY_IDS,
  type RemoteKeyId,
  remoteKeyToPaneKey,
} from '../../shared/remote-key.js';
import type { SourceError } from '../ipc/channels.js';
import type { AgentsResult } from '../sources/claude-code/agents.js';
import { listLiveAgents } from '../sources/claude-code/agents.js';
import { sessionIdOf } from '../sources/claude-code/deliver.js';
import { paneNameOf } from '../sources/claude-code/pane-row.js';
import { paneForRow } from '../sources/claude-code/reply.js';
import { readPublishedPanes } from '../sources/claude-code/session-pane.js';
import { defaultSessionsRoot } from '../sources/claude-code/session-status.js';
import { createTmuxRunner, listVamSessions, type TmuxRun } from '../sources/tmux/spawn.js';
import { sendToPane } from '../terminal/pane.js';

// THE ALLOWLIST ITSELF NOW LIVES IN `shared/remote-key.ts`, read by both
// this route (validating what arrives over the wire) and the renderer
// (`panels/DetailPanel.tsx`, deciding which key-strip buttons this channel
// can even carry) -- one list, not two kept in step by hand. Re-exported
// here, unchanged names, so `remote/server.ts`'s own
// `import { isRemoteKeyId, type RemoteKeyId } from './send-key.js'` and
// every existing test in this directory keep working unchanged.
export { isRemoteKeyId, REMOTE_KEY_IDS, type RemoteKeyId };

const refused = (code: string, message: string): SourceError => ({
  kind: 'refused',
  code,
  message,
});
const unreachable = (code: string, message: string): SourceError => ({
  kind: 'unreachable',
  code,
  message,
});

/**
 * Deliver one allowlisted key to the pane `sessionId` names -- `recordPrompt`'s
 * own two-path resolution (`claude-code/source.ts`), reused rather than
 * re-derived; see this file's header for the full argument. `null` means
 * tmux took the key; anything else is a `SourceError` naming why, in the
 * same words `recordPrompt`'s own refusals use, never a thrown one -- the
 * route this feeds (`remote/server.ts`'s `write()`) treats a resolved
 * `SourceError` and a thrown one differently, and only the first carries a
 * `code` a caller can act on.
 *
 * `deps` IS INJECTED FOR THE REASON EVERY FILESYSTEM/PROCESS READ IN MAIN IS
 * (`terminal/ipc.ts`'s own `registerTerminalIpc`, `readPanes`'s doc): the
 * defaults spawn a real `tmux` and a real `claude agents --json` against
 * whatever the operator's own machine is running, and a test must never do
 * that. Production callers (`remote/server.ts`) pass no third argument at
 * all and get exactly those defaults; `test/main/remote/send-key.test.ts`
 * supplies its own `run`/`listAgents`/`readPanes`.
 */
export async function sendRemoteKey(
  sessionId: string,
  keyId: RemoteKeyId,
  deps: {
    readonly run?: TmuxRun;
    readonly listAgents?: () => Promise<AgentsResult>;
    readonly readPanes?: () => Promise<ReadonlyMap<string, string>>;
  } = {},
): Promise<SourceError | null> {
  // DEFENCE IN DEPTH: `remote/server.ts`'s own `valid()` already checks this
  // before `sendRemoteKey` is ever called, but this function is exported and
  // callable directly (as the tests in `send-key.test.ts` do), so it does not
  // trust that caller either. `keyId as RemoteKeyId` above is a compile-time
  // promise only; nothing stops a caller from handing this a plain `string`.
  if (!isRemoteKeyId(keyId)) {
    return refused(
      'invalid-key',
      `"${String(keyId)}" is not one of the six keys this route allows`,
    );
  }
  const run = deps.run ?? createTmuxRunner();
  const listAgents = deps.listAgents ?? listLiveAgents;
  const readPanes = deps.readPanes ?? (() => readPublishedPanes(defaultSessionsRoot()));
  const key = remoteKeyToPaneKey(keyId);

  // A PANE ROW has no agent to pair -- the row names its own tmux session,
  // and that name is re-proven against today's listing before anything is
  // sent, exactly as `start-in-pane.ts`'s `ownPane` re-proves it before
  // typing. There is no `runningProvider` distinction to make here the way
  // there is for a typed prompt: a keystroke is the same act into an empty
  // shell or a confirmed provider, so this never reaches for `ownPane`
  // itself, only the listing it is built on.
  const pane = paneNameOf(sessionId);
  if (pane !== null) {
    const listed = await listVamSessions(run);
    if (listed.kind !== 'ok') {
      return unreachable(listed.error.code, listed.error.message);
    }
    const found = listed.sessions.some((session) => session.name === pane);
    if (!found) {
      return refused(
        'not-vam-started',
        `vam has no tmux session "${pane}" of its own -- it has ended, or vam never started it -- so it will not send a key there`,
      );
    }
    const result = await sendToPane(run, pane, key);
    return result === 'sent'
      ? null
      : refused('refused', `vam could not deliver that key to "${pane}"`);
  }

  // AN AGENT ROW: the live list is re-asked for the same reason
  // `recordPrompt` re-asks it -- a canvas drawn minutes ago may name a
  // session that has since exited.
  const agentsResult = await listAgents();
  if (agentsResult.kind === 'unavailable') {
    return unreachable(agentsResult.code, agentsResult.message);
  }
  const plainSessionId = sessionIdOf(sessionId);
  const row =
    agentsResult.agents.find((agent) => agent.key === sessionId) ??
    agentsResult.agents.find((agent) => agent.sessionId === plainSessionId);
  if (row === undefined) {
    return refused(
      'unknown-session',
      `vam has no live session ${sessionId}; it may have exited since the session list was drawn`,
    );
  }
  const listed = await listVamSessions(run);
  const paneName =
    listed.kind === 'ok'
      ? paneForRow(listed.sessions, agentsResult.agents, row, await readPanes())
      : null;
  if (paneName === null) {
    const because =
      listed.kind === 'ok' ? '' : ` (vam could not reach tmux to check: ${listed.error.message})`;
    return refused(
      'no-terminal',
      `vam has no terminal it owns for session ${plainSessionId}, so there is nothing to send a key into${because}.`,
    );
  }
  const result = await sendToPane(run, paneName, key);
  return result === 'sent'
    ? null
    : refused('refused', `vam could not deliver that key to "${paneName}"`);
}
