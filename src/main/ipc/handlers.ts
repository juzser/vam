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
 * Real prompts, titles and identifiers are well under this; the bound exists
 * only so a compromised renderer cannot park a hundred-megabyte string on
 * main's single event loop -- the process hosting every window -- before
 * validation has even finished looking at the payload.
 */
const MAX_TEXT_LENGTH = 10_000;
/**
 * A waiver or lesson-transition list is a handful of finding ids; 1000 is
 * generous headroom while still keeping the array bounded BEFORE anything
 * walks it with `every`.
 */
const MAX_LIST_LENGTH = 1_000;

const isText = (value: unknown): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT_LENGTH;
const isTextList = (value: unknown): boolean =>
  Array.isArray(value) && value.length <= MAX_LIST_LENGTH && value.every(isText);

/** What each argumentful channel accepts, positionally. Arity is part of it. */
const ARGUMENTS: Record<string, readonly ((value: unknown) => boolean)[]> = {
  [CHANNELS.recordPrompt]: [isText, isText],
  [CHANNELS.renameSession]: [isText, isText],
  [CHANNELS.closeSession]: [isText],
  [CHANNELS.createSession]: [isText, isText],
  [CHANNELS.applyWaivers]: [isText, isTextList],
  [CHANNELS.transitionLesson]: [isText, isText, isText],
};

function validate(channel: string, args: readonly unknown[]): SourceError | null {
  const expected = ARGUMENTS[channel];
  if (expected === undefined) {
    return refused('unknown-channel', `no such channel: ${channel}`);
  }
  if (args.length !== expected.length) {
    return refused(
      'invalid-payload',
      `${channel} takes ${expected.length} argument(s), received ${args.length}`,
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
    [CHANNELS.applyWaivers, 'governance'],
    [CHANNELS.transitionLesson, 'governance'],
  ];

  for (const [channel, capability] of gated) {
    ipcMain.handle(channel, (_event, ...args): IpcResult<void> => {
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
      // Reached only by a source that ADVERTISES the capability, which no
      // source main serves does yet. The write surface is a later task; until
      // it exists, saying so is more honest than a silent success.
      return {
        ok: false,
        error: refused('not-implemented', `${capability} is advertised but not yet wired in main`),
      };
    });
  }
}
