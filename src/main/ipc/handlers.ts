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

import type { AgentWork } from '../../shared/agent-work.js';
import type { HistoryCursor, TranscriptPage } from '../../shared/history.js';
import { setPrRepoOverrides } from '../sources/claude-code/pr-repos.js';
import type { MainSource } from '../sources/source.js';
import { CHANNELS, type IpcResult, type SourceError } from './channels.js';
import {
  isDirectoryPath,
  isOptionalBool,
  isOptionalText,
  isPromptText,
  isText,
  isTextList,
} from './validators.js';

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
 * A history cursor: a turn id, a token a previous page handed back, or NULL --
 * "from the newest end". `null` is admitted explicitly rather than left to
 * `isOptionalText`'s `undefined`, because it is what the renderer sends for the
 * first step back and a validator that only tolerated `undefined` would refuse
 * every opening request. `isText`'s bound applies to the other two: the cursor
 * arrives from the least trusted process in the app.
 */
const isCursor = (value: unknown): boolean =>
  value === undefined || value === null || isText(value);

/** What each argumentful channel accepts, positionally. Arity is part of it. */
const ARGUMENTS: Record<string, readonly ((value: unknown) => boolean)[]> = {
  [CHANNELS.recordPrompt]: [isText, isPromptText],
  [CHANNELS.renameSession]: [isText, isText],
  [CHANNELS.closeSession]: [isText, isOptionalBool],
  [CHANNELS.createSession]: [isText, isText, isOptionalText],
  [CHANNELS.createSessionIn]: [isDirectoryPath, isText, isOptionalText],
  [CHANNELS.sessionHistory]: [isText, isCursor],
  [CHANNELS.sessionAgentWork]: [isText, isText],
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

  /**
   * The operator's per-project pull-request directories, pushed from the
   * renderer's prefs on every write.
   *
   * ANSWERS THROUGH THE SAME ENVELOPE as everything above, so a caller has one
   * shape to read -- but it takes no capability gate, because it does not ask
   * the SOURCE for anything. It sets a preference main consults later, and a
   * source that cannot read pull requests simply never consults it.
   *
   * `setPrRepoOverrides` is total: anything that is not the expected shape
   * lands as "no overrides", which is what vam did before this existed. The
   * renderer is the least trusted process here, so the validation is on this
   * side of the bridge rather than trusted from the other.
   */
  ipcMain.handle(CHANNELS.setPrRepos, async (_event, ...args): Promise<IpcResult<void>> => {
    setPrRepoOverrides(args[0]);
    return { ok: true, value: undefined };
  });

  /**
   * Scrolling back through one session.
   *
   * Registered on its own rather than in the gated loop below for two reasons
   * it does not share with any of them: it RETURNS A VALUE (the loop's members
   * all answer `void` or a refusal), and it is not gated by a capability
   * boolean -- `TranscriptPage` carries the source's own words for "this one
   * cannot page" in its `unavailable` arm, which is what `sources/source.ts`
   * explains and what keeps a thirteenth flag out of `SourceCapabilities`.
   */
  ipcMain.handle(
    CHANNELS.sessionHistory,
    async (_event, ...args): Promise<IpcResult<TranscriptPage>> => {
      const invalid = validate(CHANNELS.sessionHistory, args);
      if (invalid !== null) {
        return { ok: false, error: invalid };
      }
      const read = source.readHistory;
      if (read === undefined) {
        return {
          ok: false,
          error: refused(
            'unsupported:history',
            'this source cannot read earlier parts of a session; it serves only what it already loaded',
          ),
        };
      }
      // `answer` wraps only the UNEXPECTED. A source resolving to the page
      // type's own `unavailable` arm has answered, so that travels as `ok`.
      return await answer<TranscriptPage>(() =>
        read(args[0] as string, (args[1] ?? null) as HistoryCursor | null),
      )();
    },
  );

  /**
   * One of a session's agents, read on demand. Registered beside
   * `sessionHistory` and for its two reasons: it RETURNS A VALUE, and it is
   * not gated by a capability boolean -- `AgentWork` carries the source's own
   * words for "this one has no agent surface" in its `unavailable` arm.
   */
  ipcMain.handle(
    CHANNELS.sessionAgentWork,
    async (_event, ...args): Promise<IpcResult<AgentWork>> => {
      const invalid = validate(CHANNELS.sessionAgentWork, args);
      if (invalid !== null) {
        return { ok: false, error: invalid };
      }
      const read = source.readAgentWork;
      if (read === undefined) {
        return {
          ok: false,
          error: refused(
            'unsupported:agent-work',
            'this source cannot report what a session’s agents are doing',
          ),
        };
      }
      // `answer` wraps only the UNEXPECTED, as above: a source resolving to
      // the type's own `unavailable` arm HAS answered, so that travels as ok.
      return await answer<AgentWork>(() => read(args[0] as string, args[1] as string))();
    },
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
        const failure = await source.closeSession(
          args[0] as string,
          args[1] as boolean | undefined,
        );
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
