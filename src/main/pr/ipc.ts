/**
 * THE PRs TAB'S TWO CHANNELS: open a pull request, and act on one.
 *
 * WHAT CHANGED, AND WHEN. `sources/claude-code/pull-requests.ts` said, from
 * the day it was written, that opening a pull request in a browser "is a
 * second outbound capability and is deliberately not here". That was the right
 * default and it held until the operator reviewed the tab on 2026-09-18 and
 * asked for it -- along with actions -- in as many words: clicking a row
 * should open the pull request, and there should be a way to merge and to
 * delete the branch. So both exist now, by request, and the reader's header
 * records the date rather than quietly losing the sentence.
 *
 * THE TWO ARE NOT THE SAME KIND OF THING and this file keeps them apart:
 *
 *  - `prsOpen` NAMES A DESTINATION, which is the capability the window's
 *    deny-by-default navigation policy exists to refuse (`src/main/csp.ts`,
 *    `src/main/index.ts`). What pays for it is `checkPrLink`, run HERE, on
 *    main's side: https, on github.com, no credentials. The renderer runs the
 *    same function -- the reader drops an address it would not open, so a row
 *    draws no link rather than a link that refuses -- and that call is a
 *    convenience. Deleting it would change nothing about what can open.
 *  - `prsAction` WRITES, with the operator's own credentials, to a repository
 *    on GitHub, irreversibly. Three separate things guard it and none of them
 *    is in the renderer: every argument is validated here, the WORKING
 *    DIRECTORY is resolved from the session id on this side rather than taken
 *    from the caller, and the runner is non-re-entrant.
 *
 * WHY THE DIRECTORY IS NOT AN ARGUMENT. `pull-requests.ts` refuses `--repo`
 * so that a pane can only ever describe the repository vam is actually
 * standing in. A channel that took a path would hand that invariant back: a
 * renderer could merge a pull request in a checkout no session is in. So it
 * takes a SESSION ID and resolves the directory the same way the reader does.
 *
 * AND IT ANSWERS IN DATA. A refusal travels as a value on this bridge, like
 * `link/ipc.ts`'s: throwing would reach the renderer as an electron-rewritten
 * rejection with gh's own sentence stripped out of it, and gh's own sentence
 * is the entire point of surfacing a failed merge at all.
 */

import { checkPrLink, type PrLinkOutcome } from '../../shared/pr-link.js';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import {
  checkBranchName,
  checkPrNumber,
  MERGE_METHODS,
  type PrAction,
  type PrActionOutcome,
} from '../sources/claude-code/pr-actions.js';

const refuse = (code: string, message: string): PrActionOutcome => ({ ok: false, code, message });

/**
 * The renderer's argument turned into an action, or refused.
 *
 * ALLOWLISTED, NOT SANITISED. `method` is checked against `MERGE_METHODS`
 * rather than against a list of forbidden words, which is what keeps `--admin`
 * unreachable from this channel: a method vam does not know is a refusal, not
 * an argument passed along.
 *
 * THE NUMBER AND THE BRANCH ARE CHECKED HERE TOO, with `pr-actions.ts`'s own
 * functions, and that is deliberate duplication rather than an oversight. The
 * runner checks them as well, so every route into it is covered -- but the
 * runner is INJECTED at wiring time, and a boundary whose guarantee depends on
 * which implementation somebody passed in is not a boundary. One shared pair
 * of functions, called on both sides: the check cannot drift, and neither call
 * site can be deleted without the other still holding.
 */
function readAction(raw: unknown): { ok: true; action: PrAction } | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'vam does not know that pull request action.' };
  }
  const action = raw as Record<string, unknown>;
  if (action['kind'] === 'merge') {
    const method = MERGE_METHODS.find((known) => known === action['method']);
    if (method === undefined) {
      return { ok: false, reason: 'vam does not know that way of merging.' };
    }
    const number = checkPrNumber(action['number']);
    if (!number.ok) return number;
    return { ok: true, action: { kind: 'merge', number: number.number, method } };
  }
  if (action['kind'] === 'delete-branch') {
    const branch = checkBranchName(action['branch']);
    if (!branch.ok) return branch;
    return { ok: true, action: { kind: 'delete-branch', branch: branch.branch } };
  }
  return { ok: false, reason: 'vam does not know that pull request action.' };
}

export type PrIpcDeps = {
  /** `shell.openExternal`, injected so this file spawns no browser in a test. */
  readonly openExternal: (url: string) => Promise<void>;
  /** A session id turned into the directory to act in. `null` when vam cannot say. */
  readonly resolveCwd: (sessionId: string) => Promise<string | null>;
  /** The non-re-entrant runner from `pr-actions.ts`. */
  readonly run: (input: { cwd: string; action: PrAction }) => Promise<PrActionOutcome>;
};

export function registerPrIpc(ipcMain: IpcMainLike, deps: PrIpcDeps): void {
  ipcMain.handle(CHANNELS.prsOpen, async (_event, ...args: unknown[]): Promise<PrLinkOutcome> => {
    if (args.length !== 1) {
      return { ok: false, reason: 'vam opens one pull request at a time.' };
    }
    // `checkPrLink` takes `unknown` and answers a sentence for every bad
    // shape, so there is no separate validation pass to drift from it.
    const outcome = checkPrLink(args[0]);
    if (!outcome.ok) return outcome;
    try {
      await deps.openExternal(outcome.url);
      return outcome;
    } catch {
      // No browser, or a shell that declined. The row is still on screen with
      // its number on it; it must not be told a browser opened.
      return { ok: false, reason: `vam could not get a browser to open ${outcome.url}.` };
    }
  });

  ipcMain.handle(
    CHANNELS.prsAction,
    async (_event, ...args: unknown[]): Promise<PrActionOutcome> => {
      const [sessionId, raw] = args;
      if (args.length !== 2 || typeof sessionId !== 'string' || sessionId === '') {
        return refuse(
          'bad-request',
          'vam was not told which session this pull request belongs to.',
        );
      }
      const parsed = readAction(raw);
      if (!parsed.ok) return refuse('bad-request', parsed.reason);
      const { action } = parsed;
      const cwd = await deps.resolveCwd(sessionId);
      if (cwd === null) {
        // NOT "the action failed". vam could not find the directory to act in,
        // which is a different fact from GitHub having refused -- the reader's
        // own rule, one channel over.
        return refuse(
          'no-directory',
          'vam could not tell which directory this session is in, so it has nowhere to run that from.',
        );
      }
      try {
        return await deps.run({ cwd, action });
      } catch (error) {
        // The runner turns every ordinary failure into a value; a throw here is
        // something neither it nor this handler foresaw, and it must still
        // arrive as a sentence rather than as a rejected invoke.
        return refuse(
          'gh-failed',
          `that action failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    },
  );
}
