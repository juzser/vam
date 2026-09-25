/**
 * THE ONE WRITE VAM PERFORMS AGAINST CODEX: `codex queue`.
 *
 * Everything else in this directory is a read. This is the door
 * `a-second-source.md` was written around, and it was MEASURED before it was
 * designed for -- driven against a live TUI on a private tmux socket, in a
 * throwaway directory, with no daemon running:
 *
 *     $ codex queue --thread <uuid> --message 'reply with exactly: drained'
 *     Queued message <uuid> for thread <uuid>
 *
 *     pane:  › reply with exactly: drained
 *            • drained
 *
 * The live TUI polls `~/.codex/queue_1.sqlite` itself and drains it. That is
 * what makes `deliverPrompt: true` an honest claim for this source, and it is
 * the first time vam has been able to make it without owning a pane.
 *
 * ── WHAT VAM MAY CLAIM AFTERWARDS, AND IT IS NOT "SENT" ───────────────────
 *
 * `codex queue` answers when the message is IN THE QUEUE, not when a session
 * has read it. A thread whose Codex has exited has nobody polling, and the
 * message sits until the thread is resumed -- `a-second-source.md`
 * §Experiments names that as unsettled and it is still unsettled. So the word
 * on screen is QUEUED, everywhere, including for a thread that is in fact
 * being drained a second later. Claiming delivery vam did not observe is the
 * one failure this source must not have.
 *
 * ── ARGV IS A PURE FUNCTION ───────────────────────────────────────────────
 *
 * As in `pull-requests.ts` and `pr-actions.ts`: building the argument list,
 * checking the thread id and classifying a failure are pure and tested
 * without spawning anything. The spawn is the one part a test must not run,
 * because running it would queue a message into the operator's own Codex.
 */

import { execFile } from 'node:child_process';
import { cliMissingMessage } from '../../env/cli-missing.js';
import type { SourceError } from '../../ipc/channels.js';

/** How long `codex queue` gets. A local sqlite insert, not a model call. */
export const QUEUE_TIMEOUT_MS = 15_000;

const MAX_OUTPUT_BYTES = 256 * 1024;

/**
 * A BARE THREAD UUID AND NOTHING ELSE.
 *
 * `--thread` accepts "Session UUID or exact session name", and the NAME arm is
 * the reason this is strict: a row id arrives from the renderer, the least
 * trusted process in the app, and a permissive check would let it name
 * somebody else's thread by a string that is not an id at all. The id vam
 * holds is the one `threads.id` gave it, which is always this shape -- the
 * same string as the rollout filename and as `--thread`, with no `#pid`
 * suffix, unlike `claude-code/agents.ts:198` where a session id alone
 * collapses two rows.
 */
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isThreadId = (value: string): boolean => THREAD_ID.test(value);

/**
 * `codex queue --thread <uuid> --message <text>`.
 *
 * NO SHELL, EVER: this is an argv array for `execFile`, so the message is one
 * argument however it is spelled -- quotes, newlines, a leading `--`, a `$(…)`
 * -- and reaches Codex as itself. The value follows its own flag, so even a
 * message that looks like an option is taken as the option's value.
 */
export function queueArgv(threadId: string, message: string): readonly string[] {
  return ['queue', '--thread', threadId, '--message', message];
}

export type QueueResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly code?: string;
  readonly timedOut?: boolean;
  readonly failed: boolean;
};
export type RunCodex = (argv: readonly string[]) => Promise<QueueResult>;

/** Codex's own failure, in vam's words, with its `code` kept branchable. */
export function classifyQueueFailure(result: QueueResult): SourceError {
  if (result.code === 'ENOENT') {
    return {
      kind: 'unreachable',
      code: 'codex-missing',
      message: cliMissingMessage('codex', 'vam cannot queue a message for this thread'),
    };
  }
  if (result.timedOut === true) {
    return {
      kind: 'unreachable',
      code: 'timed-out',
      message: `\`codex queue\` did not answer within ${QUEUE_TIMEOUT_MS} ms; nothing here can say whether the message was queued`,
    };
  }
  const said = (result.stderr.trim() === '' ? result.stdout : result.stderr).trim();
  const lower = said.toLowerCase();
  if (lower.includes('not found') || lower.includes('no thread') || lower.includes('no session')) {
    return {
      kind: 'refused',
      code: 'unknown-thread',
      message: `Codex does not know this thread any more: ${said}`,
    };
  }
  return {
    kind: 'unreachable',
    code: 'queue-failed',
    message: `\`codex queue\` refused: ${said === '' ? 'it failed with no message' : said}`,
  };
}

/**
 * Queue one message for one thread.
 *
 * RESOLVES to the `SourceError`, never throws it -- `MainSource.recordPrompt`'s
 * contract, so a refusal keeps its `kind`, `code` and words instead of being
 * flattened into `unreachable/source-failed` by the IPC catch-all.
 */
export async function queueMessage(input: {
  readonly threadId: string;
  readonly message: string;
  readonly run: RunCodex;
}): Promise<SourceError | null> {
  if (!isThreadId(input.threadId)) {
    return {
      kind: 'refused',
      code: 'not-a-thread-id',
      message:
        'vam addresses a Codex thread by its own UUID and will not pass anything else to `--thread`, which also accepts a session NAME',
    };
  }
  if (input.message.trim() === '') {
    return {
      kind: 'refused',
      code: 'empty-message',
      message: 'there is nothing to queue',
    };
  }
  const result = await input.run(queueArgv(input.threadId, input.message));
  return result.failed ? classifyQueueFailure(result) : null;
}

/** The real runner. Never called by a test; see the header. */
export const runCodexViaCli = (): RunCodex => {
  return (argv) =>
    new Promise((resolve) => {
      execFile(
        'codex',
        [...argv],
        { timeout: QUEUE_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ stdout, stderr, failed: false });
            return;
          }
          const withCode = error as NodeJS.ErrnoException & { killed?: boolean };
          resolve({
            stdout,
            stderr: stderr === '' ? error.message : stderr,
            code: withCode.code,
            timedOut: withCode.killed === true,
            failed: true,
          });
        },
      );
    });
};
