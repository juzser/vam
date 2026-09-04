/**
 * Main's side of the bridge: one handler per channel, and NOT ONE OF THEM
 * TRUSTS ITS ARGUMENTS.
 *
 * The renderer is the least trusted process in an Electron app, and every
 * argument arriving here was chosen by it. So each handler validates first and
 * answers a `SourceError` when the shape is wrong -- before anything reaches a
 * source. A `recordPrompt` that trusted its `sessionId` would be a write
 * primitive addressable by anything that got into the page.
 *
 * Refusals are RETURNED, never thrown: a listener that throws reaches the
 * renderer as a rejection whose message electron has rewritten, losing the
 * `kind` and `code` a consumer renders. The final `catch` exists for the
 * unexpected -- an unhandled rejection must never escape into main.
 */

import type { MainSource } from '../sources/source.js';
import { CHANNELS, type IpcResult, type SourceError } from './channels.js';

/** The slice of `ipcMain` this module uses, so it can be tested without electron. */
export type IpcMainLike = {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
};

const refused = (code: string, message: string): SourceError => ({
  kind: 'refused',
  code,
  message,
});

/**
 * Session ids, titles and lesson/finding ids are short by construction --
 * they are UI-generated labels, never user-typed prose. 10,000 is far above
 * any of them; the bound exists only so a compromised renderer cannot park
 * a hundred-megabyte string on main's single event loop -- the process
 * hosting every window -- before validation has even finished looking at
 * the payload.
 */
const MAX_TEXT_LENGTH = 10_000;
/**
 * The prompt BODY (`recordPrompt`'s second argument) is a different
 * population from an identifier: it is exactly the free text vam's prompt
 * box exists to record, and f-vam-electron-shell/task-4-load-ipc-c7bf7335
 * found that a shared 10,000-char bound refused legitimate input. Sized
 * from 2,900 real, typed Claude Code prompts (sidechains, tool results and
 * injected system-reminders excluded) as a proxy population -- vam's own
 * prompt box has no history yet:
 *
 *   median    968
 *   p90    36,424
 *   p99    60,268
 *   max   616,040
 *
 * A uniform 10,000-char bound refused 1,067 of 2,900 (36.8%) of them --
 * the distribution is bimodal (short interactive prompts plus routinely
 * pasted long ones), so the small median made the old bound feel safe
 * while it was wrong. 1,000,000 clears the observed max with headroom and
 * still refuses the half-gigabyte payload the original S3 finding was
 * about.
 */
const MAX_PROMPT_LENGTH = 1_000_000;

/**
 * A waiver or lesson-transition list is a handful of finding ids; 1000 is
 * generous headroom while still keeping the array bounded BEFORE anything
 * walks it with `every`.
 */
const MAX_LIST_LENGTH = 1_000;

const isText = (value: unknown): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_LENGTH;
const isPromptText = (value: unknown): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_PROMPT_LENGTH;
const isTextList = (value: unknown): boolean =>
  Array.isArray(value) && value.length <= MAX_LIST_LENGTH && value.every(isText);

/**
 * A directory to start a session in. ABSOLUTE, and with no NUL byte: the
 * renderer chose this string, and it becomes a process's cwd. `..` is not
 * rejected -- a path may legitimately contain one and main resolves nothing
 * here -- but a relative path would be resolved against main's own cwd, which
 * is a directory the operator never picked. Whether it exists is main's own
 * question, asked where the session is actually started.
 */
const isDirectoryPath = (value: unknown): boolean =>
  isText(value) && (value as string).startsWith('/') && !(value as string).includes('\0');

/**
 * The provider a new session should run, which the renderer may omit -- a
 * renderer that predates the setting, or one whose store could not be read,
 * sends nothing and main starts its default provider. Accepting `undefined` is
 * also what MARKS an argument optional below: a validator that admits
 * `undefined` cannot be a required argument, so the arity check reads the
 * minimum off the validators themselves rather than off a second list that
 * could disagree with them.
 */
const isOptionalText = (value: unknown): boolean => value === undefined || isText(value);

/** What each argumentful channel accepts, positionally. Arity is part of it. */
const ARGUMENTS: Record<string, readonly ((value: unknown) => boolean)[]> = {
  [CHANNELS.recordPrompt]: [isText, isPromptText],
  [CHANNELS.renameSession]: [isText, isText],
  [CHANNELS.closeSession]: [isText],
  [CHANNELS.createSession]: [isText, isText, isOptionalText],
  [CHANNELS.createSessionIn]: [isDirectoryPath, isText, isOptionalText],
  [CHANNELS.applyWaivers]: [isText, isTextList],
  [CHANNELS.transitionLesson]: [isText, isText, isText],
};

function validate(channel: string, args: readonly unknown[]): SourceError | null {
  const expected = ARGUMENTS[channel];
  if (expected === undefined) {
    return refused('unknown-channel', `no such channel: ${channel}`);
  }
  const required = expected.filter((check) => !check(undefined)).length;
  if (args.length < required || args.length > expected.length) {
    return refused(
      'invalid-payload',
      `${channel} takes ${required}..${expected.length} argument(s), received ${args.length}`,
    );
  }
  const bad = expected.map((check, i) => (check(args[i]) ? null : i)).filter((i) => i !== null);
  return bad.length === 0
    ? null
    : refused('invalid-payload', `${channel}: argument(s) ${bad.join(', ')} are of the wrong type`);
}

/**
 * Registers every channel against `source`.
 *
 * The write and governance channels exist because the bridge's shape is fixed
 * at preload time and cannot depend on what a source can do
 * (`src/shared/preload-api.ts`). They validate, then refuse in the source's own
 * words -- there is no write surface behind them to reach.
 */
export function registerSourceIpc(ipcMain: IpcMainLike, source: MainSource): void {
  const answer = <T>(produce: () => Promise<T> | T) => {
    return async (): Promise<IpcResult<T>> => {
      try {
        return { ok: true, value: await produce() };
      } catch (error) {
        return {
          ok: false,
          error: {
            kind: 'unreachable',
            code: 'source-failed',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    };
  };

  ipcMain.handle(
    CHANNELS.describe,
    answer(() => source.descriptor),
  );
  ipcMain.handle(
    CHANNELS.load,
    answer(() => source.load()),
  );

  const { capabilities, declines } = source.descriptor;
  const gated: [string, keyof typeof capabilities][] = [
    [CHANNELS.recordPrompt, 'recordPrompt'],
    [CHANNELS.renameSession, 'renameSession'],
    [CHANNELS.closeSession, 'closeSession'],
    [CHANNELS.createSession, 'createSession'],
    [CHANNELS.createSessionIn, 'createSession'],
    [CHANNELS.applyWaivers, 'governance'],
    [CHANNELS.transitionLesson, 'governance'],
  ];

  for (const [channel, capability] of gated) {
    ipcMain.handle(channel, async (_event, ...args): Promise<IpcResult<void>> => {
      const invalid = validate(channel, args);
      if (invalid !== null) {
        return { ok: false, error: invalid };
      }
      if (!capabilities[capability]) {
        return {
          ok: false,
          error: refused(
            `unsupported:${capability}`,
            declines[capability] ?? `this source does not support ${capability}`,
          ),
        };
      }
      // The writes main can perform today, each with a surface behind it. Validation and the capability gate above both ran first:
      // nothing reaches a source's write path unvalidated, and nothing
      // reaches it that the source did not advertise.
      //
      // The source's own error is forwarded whole in both cases. Re-wrapping
      // it here would cost the `code` a consumer branches on and the message
      // it renders -- for `closeSession` that message is the one telling the
      // operator their interactive session is theirs to close.
      if (channel === CHANNELS.recordPrompt && source.recordPrompt !== undefined) {
        const failure = await source.recordPrompt(args[0] as string, args[1] as string);
        return failure === null ? { ok: true, value: undefined } : { ok: false, error: failure };
      }
      if (channel === CHANNELS.closeSession && source.closeSession !== undefined) {
        const failure = await source.closeSession(args[0] as string);
        return failure === null ? { ok: true, value: undefined } : { ok: false, error: failure };
      }
      if (channel === CHANNELS.createSession && source.createSession !== undefined) {
        const failure = await source.createSession(
          args[0] as string,
          args[1] as string,
          args[2] as string | undefined,
        );
        return failure === null ? { ok: true, value: undefined } : { ok: false, error: failure };
      }
      if (channel === CHANNELS.createSessionIn && source.createSessionInDirectory !== undefined) {
        const failure = await source.createSessionInDirectory(
          args[0] as string,
          args[1] as string,
          args[2] as string | undefined,
        );
        return failure === null ? { ok: true, value: undefined } : { ok: false, error: failure };
      }
      // Advertised, but this source carries no member for it. Saying so beats
      // a silent success.
      return {
        ok: false,
        error: refused('not-implemented', `${capability} is advertised but not yet wired in main`),
      };
    });
  }
}
