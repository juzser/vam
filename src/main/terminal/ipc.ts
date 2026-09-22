/**
 * The terminal channels: one read, answered by a `PaneView`, and one resize.
 *
 * Bare, never an `IpcResult`, for the reason `usage/ipc.ts` and
 * `clipboard/ipc.ts` answer bare: `PaneView` already carries its own failure
 * branch with the `SourceError` tmux produced, so wrapping it would give the
 * caller two different ways to be told the same thing and one of them would
 * eventually be left undrawn.
 *
 * Nothing here is pushed. The renderer asks only while the Terminal tab is
 * open, so a closed tab spawns no tmux at all -- which is the operator's
 * requirement for this tab, and the reason main holds no timer of its own.
 */

import { type AnswerResult, isAnswerRequest, type PromptView } from '../../shared/answer.js';
import {
  isModelChoice,
  isPaneKey,
  isPaneReadMode,
  isPaneSize,
  type ModelSwitchResult,
  type PaneReadMode,
  type PaneSendResult,
  type PaneView,
  type SessionModel,
} from '../../shared/terminal.js';
import { CHANNELS } from '../ipc/channels.js';
import type { IpcMainLike } from '../ipc/handlers.js';
import { readPublishedPanes } from '../sources/claude-code/session-pane.js';
import { defaultSessionsRoot } from '../sources/claude-code/session-status.js';
import { defaultTranscriptRoot } from '../sources/claude-code/transcript-index.js';
import { readSessionModelFromTranscript } from '../sources/claude-code/transcript-model.js';
import { PANE_HISTORY_LINES } from '../sources/tmux/argv.js';
import { listVamSessions, type TmuxRun } from '../sources/tmux/spawn.js';
import { answerQuestion, readSessionPrompt } from './answer.js';
import { setConciseOutput } from './concise.js';
import { readSessionModel } from './model.js';
import { switchSessionModel } from './model-switch.js';
import {
  readAimedPane,
  readSessionPane,
  resizeSessionPane,
  sendToPane,
  targetSession,
} from './pane.js';

/**
 * A project id is a digest (`sources/claude-code/project-id.ts`), and it
 * arrives from the least trusted process in the app. The bound is far above
 * any real id and keeps a compromised renderer from handing tmux a megabyte to
 * match against.
 */
export const MAX_PROJECT_ID_LENGTH = 500;

/**
 * `readPanes` is injected for the reason every filesystem read in main is: the
 * default enumerates the operator's own `~/.claude/sessions`, and a test must
 * never do that. It is what makes the tab's answer per SESSION rather than per
 * project -- see `terminal/pane.ts`.
 */
/**
 * How long a proven pairing may be reused without proving it again.
 *
 * THE PROBLEM IT SOLVES, measured. Every keystroke resolved the pane from
 * scratch: a `readdir` plus a `readFile` per session file, then a
 * `list-sessions` spawn, then the `send-keys` spawn -- and the renderer
 * serializes the sends so a line cannot arrive out of order, which makes each
 * key's cost the operator's wait. On a private `-L` server, idle: 5.7ms for
 * the listing, 5.4ms for the send, 0.3ms for the files. Two thirds of that is
 * proving, for the second time in a millisecond, what has not changed.
 *
 * WHAT IT COSTS, and it is a real cost, not a rounding one. The per-key
 * resolution WAS the aiming check, and `sendSessionKey`'s own note explains
 * the window it never closed: ownership is decided by one tmux call and the
 * key is delivered by another, so a session that dies and has its exact name
 * reused in between receives the keystroke. Reusing a pairing widens that
 * window from milliseconds to this constant.
 *
 * WHY TWO SECONDS IS SAFE ENOUGH, in three parts. First, a pane that has
 * merely DIED still fails safe: tmux answers `can't find pane` and the send
 * reports `refused`, which drops the entry and stops the run. Only reuse of
 * the exact name is dangerous, and a vam session name carries six base-36
 * characters of randomness -- another process would have to create a session
 * with that precise name inside the window. Second, the window is bounded in
 * practice by something much shorter than this: the tab re-reads the pane four
 * times a second and that read RE-PROVES the pairing (see below), so a live
 * tab refreshes or clears this before the constant is ever reached. Third,
 * typing only happens while that tab is open and its window visible, which is
 * exactly when that quarter-second revalidation is running.
 *
 * It is a backstop, in other words, not the mechanism.
 *
 * AND IT IS NOW A BACKSTOP FOR A SECOND CALLER, which is the one change worth
 * re-reading the three parts above for. The echo READ rides this aim too
 * (`terminalRead`, `PaneReadMode`), so a proven pairing is what aims a capture
 * as well as a keystroke. The three arguments hold for it unchanged, and it is
 * held to the same rule that keeps them true: only a read that PROVED a
 * pairing may write `at`. An echo read never does, so no amount of typing can
 * carry an unproven aim past this constant.
 */
export const AIM_TTL_MS = 2_000;

/** A pairing proven for one row, and when it was proven. */
type Aim = { readonly name: string; readonly at: number };

/** `projectId|rowId` -- a project with two sessions has two aims. */
const aimKey = (projectId: string, rowId?: string): string => `${projectId}|${rowId ?? ''}`;

export function registerTerminalIpc(
  ipcMain: IpcMainLike,
  run: TmuxRun,
  readPanes: () => Promise<ReadonlyMap<string, string>> = () =>
    readPublishedPanes(defaultSessionsRoot()),
  /** Injected so a test can hold time still rather than sleep through it. */
  now: () => number = () => Date.now(),
  /**
   * THE MODEL CHANNEL'S SECOND SOURCE: what a row's own transcript says its
   * last turn ran on, for the sessions whose painted footer vam cannot read
   * (`terminal/model.ts` holds the precedence and the argument for it).
   *
   * Injected for the reason `readPanes` above is -- the default walks the
   * operator's own `~/.claude/projects`, and a test must never do that -- and
   * defaulted to the real reader for the same reason that one is: this is the
   * production wiring, and a channel registered without it would answer
   * `unknown` forever on exactly the machines the fallback was built for.
   */
  readTranscriptModel: (rowId: string) => Promise<string | null> = (rowId) =>
    readSessionModelFromTranscript(defaultTranscriptRoot(), rowId),
): void {
  /**
   * The pairing proven for the row currently being typed into. One entry per
   * row rather than one for the app: a project with two sessions has two
   * panes, and an aim that outlived its row would be the wrong pane wearing
   * the right one's name.
   */
  const aims = new Map<string, Aim>();

  /**
   * THE CONCISE-OUTPUT SWITCH, pushed from the renderer's prefs on every write
   * and every read (`prefs.ts`'s `activatePrefs`).
   *
   * REGISTERED HERE rather than beside `setPrRepos` in `ipc/handlers.ts`,
   * because the module it feeds is this directory's: what the switch changes
   * is what vam types into a pane, which is the subject of every other channel
   * on this registration. It answers through the `IpcResult` envelope all the
   * same, so the preload's one `unwrap` covers both preference channels.
   *
   * NO VALIDATION TABLE AND NO CAPABILITY GATE, for the reason `setPrRepos`
   * needs neither: it asks the source for nothing, and `setConciseOutput` is
   * TOTAL -- anything that is not exactly `true` lands as off, which is what
   * vam did before this existed. The check is on this side of the bridge
   * because the renderer is the least trusted process in the app.
   */
  ipcMain.handle(CHANNELS.setConciseOutput, async (_event, ...args: unknown[]) => {
    setConciseOutput(args[0]);
    return { ok: true, value: undefined } as const;
  });

  ipcMain.handle(CHANNELS.terminalRead, async (_event, ...args: unknown[]): Promise<PaneView> => {
    const [projectId, rowId, asked] = args;
    // The row is OPTIONAL: a caller that names only a project still gets the
    // project-wide answer. Both ids are bounded for the same reason -- they
    // arrive from the least trusted process in the app. So is the MODE, and
    // it is checked against its closed list rather than defaulted from: it
    // decides how much this re-proves before aiming a read at a tmux session,
    // and an unrecognised word is a malformed ask, not a reason to guess.
    if (
      args.length < 1 ||
      args.length > 3 ||
      typeof projectId !== 'string' ||
      projectId.length > MAX_PROJECT_ID_LENGTH ||
      (rowId !== undefined &&
        (typeof rowId !== 'string' || rowId.length > MAX_PROJECT_ID_LENGTH)) ||
      (asked !== undefined && !isPaneReadMode(asked))
    ) {
      // A refusal is data here like everywhere else on this bridge, and it is
      // deliberately NOT an empty pane: vam did not look, so it may not say
      // there is nothing to see.
      return {
        kind: 'unavailable',
        error: {
          kind: 'refused',
          code: 'bad-request',
          message: 'vam asked for a terminal pane in a way it could not use',
        },
      };
    }
    const mode: PaneReadMode = asked ?? 'poll';
    const key = aimKey(projectId, rowId);
    /**
     * HOW MUCH SCROLLBACK, and it is the renderer's situation that decides.
     * `echo` and `poll-live` are both a read for a view stuck to the live
     * end, where the 500 lines above the screen are not on anybody's screen:
     * measured on tmux 3.7b, asking for them costs 78KB and ~4.8ms more per
     * read even through the control-mode runner's own cheaper connection
     * (`shared/terminal.ts`, `PaneReadMode`, which carries both the original
     * and the re-measured numbers). Every other situation -- `poll` (an
     * operator scrolled away, or nothing drawn yet) and `echo-scrollback` --
     * gets the whole window, because the scrollback has to be in the DOM for
     * there to be anything to scroll.
     */
    const history = mode === 'echo' || mode === 'poll-live' ? 0 : PANE_HISTORY_LINES;
    /**
     * WHICH READ PROVES WHAT, written out because this is the one place in vam
     * where a read is allowed to aim at a tmux session without proving it may.
     *
     * `poll` AND `poll-live` BOTH PROVE: same tick, same `list-sessions`, same
     * match against the recorded `@vam-project` and the row's published pane
     * by `targetSession` -- `poll-live` only ever changes how much of the
     * SCREEN is asked for (`history` above), never whether the pairing is
     * re-checked. The pairing either establishes is what refreshes the aim
     * below. Every refusal vam has -- `not-vam`, `gone`, `ambiguous`,
     * `mispaired` -- is minted there and nowhere else.
     *
     * An `echo`/`echo-scrollback` RIDES that proof: one `capture-pane` spawn
     * aimed at the name the aim holds, with no `list-sessions` (~5ms) and no
     * `readdir` of the published panes (~0.4ms) in front of it. It is the hot
     * path of somebody typing, which asks about 30 times a second.
     *
     * THE WORST CASE, stated rather than implied: if the row is re-paired to a
     * different pane between two proofs -- a session ends and the row
     * republishes itself, say -- an echo read draws the OLD pane's screen
     * until the next `poll`/`poll-live`. That is a stale SCREEN, never a
     * keystroke in the wrong place: this channel only reads, and
     * `terminalSend` does its own aiming. The window is bounded three ways.
     * The tab polls four times a second while it is visible (`REFRESH_MS`),
     * and stops polling AND echoing together when it is not, so an echo read
     * cannot outlive the poll that backs it. `AIM_TTL_MS` is the backstop
     * when the polls themselves are slow. And an echo read may not EXTEND
     * either bound: it deliberately does not refresh `at`, so a typing run
     * cannot keep an unproven pairing alive by typing. If tmux cannot find the
     * pane the aim names, the aim is dropped here exactly as a failed send
     * drops it.
     */
    const aimed = mode === 'poll' || mode === 'poll-live' ? undefined : aims.get(key);
    if (aimed !== undefined && now() - aimed.at < AIM_TTL_MS) {
      const echoed = await readAimedPane(run, aimed.name, history);
      // Not `aims.set`: see above. Only a proof may set the timestamp, and
      // this read made none.
      if (echoed.kind !== 'ok') aims.delete(key);
      return echoed;
    }
    const view = await readSessionPane(
      run,
      projectId,
      rowId,
      rowId === undefined ? undefined : await readPanes(),
      history,
    );
    /**
     * THE READ IS THE REVALIDATION, and this is the line that makes reusing a
     * pairing defensible. This handler runs four times a second for as long as
     * the tab is open and visible, and it has just resolved the pane by the
     * same `targetSession` rule the send uses. So an `ok` refreshes the aim,
     * and every other answer -- gone, ambiguous, mispaired, unreachable --
     * destroys it. A pairing that stops being true is therefore dropped within
     * about a quarter of a second, by work that was happening anyway, instead
     * of being ridden to the end of `AIM_TTL_MS`.
     */
    if (view.kind === 'ok') aims.set(key, { name: view.name, at: now() });
    else aims.delete(key);
    return view;
  });

  /**
   * The fit. The renderer measures its wrapper in pixels, turns that into
   * cells and asks for it here -- and it is asked for rather than obeyed.
   *
   * BOTH BOUNDS ARE RE-CHECKED, against the same constants the renderer used
   * (`shared/terminal.ts`), because this is the first channel that CHANGES
   * something on the operator's tmux server. A size is an allocation request
   * to a program on their machine, and the renderer is the least trusted
   * process in the app; that its own arithmetic clamps is not a reason for
   * this to take its word for the result.
   *
   * `false` covers every refusal, including a session vam did not start. There
   * is nothing on the tab to draw a reason into, and a pane that cannot be
   * resized is one whose own `PaneView` already says why.
   */
  ipcMain.handle(CHANNELS.terminalResize, async (_event, ...args: unknown[]): Promise<boolean> => {
    const [projectId, columns, rows, rowId] = args;
    if (
      args.length < 3 ||
      args.length > 4 ||
      typeof projectId !== 'string' ||
      projectId.length > MAX_PROJECT_ID_LENGTH ||
      typeof columns !== 'number' ||
      typeof rows !== 'number' ||
      !isPaneSize({ columns, rows }) ||
      (rowId !== undefined && (typeof rowId !== 'string' || rowId.length > MAX_PROJECT_ID_LENGTH))
    ) {
      return false;
    }
    // The row travels with the ask for the read's reason and one more: the
    // session being resized has to be the session whose screen is on screen,
    // and the published pane is what makes that per SESSION rather than per
    // project (`terminal/pane.ts`).
    return resizeSessionPane(
      run,
      projectId,
      { columns, rows },
      rowId,
      rowId === undefined ? undefined : await readPanes(),
    );
  });

  /**
   * The keystroke. It is the only channel in vam that types into a session
   * somebody's agent is running in, and the validation is the guard: `args`
   * is checked by shape rather than trusted, the keystroke is checked to be
   * one of the two things tmux can deliver, and its text is bounded so this
   * cannot become an unbounded paste (`shared/terminal.ts`).
   *
   * `unaimed` covers every refusal this handler makes itself, including a
   * malformed ask: nothing was sent, and nothing was aimed. The two answers
   * from below it are passed through unchanged, because the tab draws a
   * different sentence for a pairing it cannot make than for a session that
   * ended under it.
   */
  ipcMain.handle(
    CHANNELS.terminalSend,
    async (_event, ...args: unknown[]): Promise<PaneSendResult> => {
      const [projectId, key, rowId] = args;
      if (
        args.length < 2 ||
        args.length > 3 ||
        typeof projectId !== 'string' ||
        projectId.length > MAX_PROJECT_ID_LENGTH ||
        !isPaneKey(key) ||
        (rowId !== undefined && (typeof rowId !== 'string' || rowId.length > MAX_PROJECT_ID_LENGTH))
      ) {
        return 'unaimed';
      }
      const cacheKey = aimKey(projectId, rowId);
      const aimed = aims.get(cacheKey);
      if (aimed !== undefined && now() - aimed.at < AIM_TTL_MS) {
        // The hot path, and the whole point: no `readdir`, no `list-sessions`,
        // one spawn instead of two. The pairing behind it was proven either by
        // the first key of this run or by the read a moment ago.
        const result = await sendToPane(run, aimed.name, key);
        // tmux declining is the fail-safe half of the window this reuse
        // widens: the session it named is not there, so the aim is wrong and
        // the next key must prove one again rather than push after it.
        if (result !== 'sent') aims.delete(cacheKey);
        return result;
      }
      const panes = rowId === undefined ? undefined : await readPanes();
      const listed = await listVamSessions(run);
      // The three causes stay three. vam could not ASK tmux, so it cannot
      // claim a pairing problem either -- `pane.ts:sendSessionKey` makes
      // exactly this mapping and the aiming re-implemented here dropped it,
      // which is the same collapse `shared/terminal.ts` records having been
      // fixed once already.
      if (listed.kind === 'unavailable') return 'unavailable';
      const match = targetSession(listed.sessions, projectId, rowId, panes);
      // A row sitting in a pane vam rejected is not a row vam could not name
      // a session for: the read path keeps them apart, and so does this.
      if (match.kind === 'mispaired') return 'mispaired';
      if (match.kind !== 'one') return 'unaimed';
      const result = await sendToPane(run, match.name, key);
      // Remembered only once it has actually carried a key. An aim that has
      // never delivered is a guess with a timestamp on it.
      if (result === 'sent') aims.set(cacheKey, { name: match.name, at: now() });
      return result;
    },
  );

  /**
   * The answer. It ENDS a tool call in a running agent, which is one step
   * beyond typing into one, so the ask is validated by shape here and not
   * because the preload built it -- and `unaimed` is every refusal this
   * handler makes itself: nothing was read, nothing was aimed, nothing sent.
   *
   * Everything below it is passed through unchanged, because the card draws a
   * different sentence for each: a picker that is not there, one that did not
   * respond to the probe arrow, an option that is nowhere on screen, and a
   * read-back that disagreed are four different things to a person, and only
   * the last means keys went in.
   */
  ipcMain.handle(
    CHANNELS.terminalAnswer,
    async (_event, ...args: unknown[]): Promise<AnswerResult> => {
      const [projectId, request, rowId] = args;
      if (
        args.length < 2 ||
        args.length > 3 ||
        typeof projectId !== 'string' ||
        projectId.length > MAX_PROJECT_ID_LENGTH ||
        !isAnswerRequest(request) ||
        (rowId !== undefined && (typeof rowId !== 'string' || rowId.length > MAX_PROJECT_ID_LENGTH))
      ) {
        return { kind: 'unaimed' };
      }
      return answerQuestion(
        run,
        projectId,
        request,
        rowId,
        rowId === undefined ? undefined : await readPanes(),
      );
    },
  );

  /**
   * The prompt on the pane. A READ, so it is safe to poll -- nothing here
   * presses a key -- but it is the read the ANSWER is built out of, so it is
   * aimed by exactly the same rule and its refusals are kept apart in exactly
   * the same words. A card drawn from a prompt vam read in the wrong pane
   * would be answered in the wrong pane.
   */
  ipcMain.handle(
    CHANNELS.terminalPrompt,
    async (_event, ...args: unknown[]): Promise<PromptView> => {
      const [projectId, rowId] = args;
      if (
        args.length < 1 ||
        args.length > 2 ||
        typeof projectId !== 'string' ||
        projectId.length > MAX_PROJECT_ID_LENGTH ||
        (rowId !== undefined && (typeof rowId !== 'string' || rowId.length > MAX_PROJECT_ID_LENGTH))
      ) {
        return { kind: 'unaimed' };
      }
      return readSessionPrompt(
        run,
        projectId,
        rowId,
        rowId === undefined ? undefined : await readPanes(),
      );
    },
  );

  /**
   * The model of a session. A READ like the prompt above it, aimed by the same
   * rule, and the one channel here whose answer is drawn while no tab of its
   * own is open: the model button sits in the composer, so this is asked for a
   * row the operator is merely LOOKING at.
   *
   * TWO SOURCES BEHIND ONE CHANNEL, and the channel's shape did not change for
   * it: the pane's painted footer first, the row's own transcript where that
   * footer cannot be read (`terminal/model.ts`). The second is the one read
   * here that touches the filesystem rather than tmux, which is why it is
   * injected above rather than reached for in this handler.
   *
   * IT DOES NOT TOUCH THE AIM CACHE, and that is deliberate. The tab's read
   * refreshes a proven pairing because it resolves the same pane a keystroke
   * would go to, a second apart, while somebody types. This one runs on its
   * own slower clock for a control that sends nothing by itself, and an aim
   * refreshed by a poll nobody is typing behind would widen the window
   * `AIM_TTL_MS` exists to bound (see its note) for no gain -- the first key
   * of a run proves its own pairing, which is what that constant is for.
   *
   * `unknown` IS EVERY REFUSAL, including a malformed ask. A label cannot draw
   * a reason: it either has a name to show or wears the word it always wore.
   */
  ipcMain.handle(
    CHANNELS.terminalModel,
    async (_event, ...args: unknown[]): Promise<SessionModel> => {
      const [projectId, rowId] = args;
      if (
        args.length < 1 ||
        args.length > 2 ||
        typeof projectId !== 'string' ||
        projectId.length > MAX_PROJECT_ID_LENGTH ||
        (rowId !== undefined && (typeof rowId !== 'string' || rowId.length > MAX_PROJECT_ID_LENGTH))
      ) {
        return { kind: 'unknown' };
      }
      return readSessionModel(
        run,
        projectId,
        rowId,
        rowId === undefined ? undefined : await readPanes(),
        readTranscriptModel,
      );
    },
  );

  /**
   * CHANGING the model, which is the one channel here that drives a MENU in
   * somebody's running agent -- so the ask is validated by shape on this side
   * of the bridge, exactly as `terminalAnswer` is and for the same reason: the
   * renderer is the least trusted process in the app, and the choice it sends
   * becomes text typed into a pane.
   *
   * `unaimed` IS EVERY REFUSAL THIS HANDLER MAKES ITSELF -- nothing was read,
   * nothing was aimed, nothing sent -- and that is `terminalAnswer`'s own
   * rule, kept rather than re-decided. Everything below it is passed through
   * unchanged, because the composer draws a different sentence for each: a
   * question already on screen, a menu that never opened, a menu that would
   * not take an arrow and a row that is not there are four different things to
   * a person, and only one of them means the operator should go and look.
   */
  ipcMain.handle(
    CHANNELS.terminalSwitchModel,
    async (_event, ...args: unknown[]): Promise<ModelSwitchResult> => {
      const [projectId, choice, rowId] = args;
      if (
        args.length < 2 ||
        args.length > 3 ||
        typeof projectId !== 'string' ||
        projectId.length > MAX_PROJECT_ID_LENGTH ||
        !isModelChoice(choice) ||
        (rowId !== undefined && (typeof rowId !== 'string' || rowId.length > MAX_PROJECT_ID_LENGTH))
      ) {
        return { kind: 'unaimed' };
      }
      return switchSessionModel(
        run,
        projectId,
        choice,
        rowId,
        rowId === undefined ? undefined : await readPanes(),
      );
    },
  );
}
