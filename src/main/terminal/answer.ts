/**
 * Answering the picker a session is showing, by NAVIGATING it -- read the
 * screen, step one row, prove the cursor moved, match the cursor's LABEL, and
 * only then press Return.
 *
 * THE ROUTE THIS REPLACES WAS MEASURED AND IT IS WRONG. Against a live
 * `AskUserQuestion` picker, `send-keys -l -- 'Emerald'` left the pane
 * byte-for-byte unchanged: the picker has no text buffer, and its "type
 * something" row is a MODE you select, not a field the characters fall into.
 * The Return behind them committed whatever row the cursor happened to sit on,
 * and the transcript recorded `"Which colour do you prefer?"="Crimson"`. An
 * answer built that way sends a different option than the operator chose, to a
 * running agent, and looks successful at both ends. Nothing here may ever
 * press Return on a row it has not just read.
 *
 * WHAT MAKES THE HONEST ROUTE POSSIBLE is that the pane is READABLE:
 * `capture-pane` renders the cursor as its own glyph against the row, so vam
 * can ask where the picker is instead of assuming. Every step below is
 * verify-then-act, and every check that fails REFUSES rather than guesses --
 * an error the operator can see beats a wrong answer they cannot take back.
 *
 * POSITIONS ARE NEVER COUNTED. The cursor is walked until the row it is ON
 * reads as the label the operator chose. A list that renders in another order
 * than the tool recorded -- and the CLI does reorder -- would make a position
 * count answer a different question with total confidence.
 *
 * The pairing guard in `pane.ts` stands in front of all of it, unchanged and
 * not re-implemented: the published pane wins, a published pane that disagrees
 * is a refusal, and the tag path is never a fallback for one.
 */

import type { AnswerRequest, AnswerResult } from '../../shared/answer.js';
import { sendDownArgv, sendEnterArgv, sendRightArgv } from '../sources/tmux/argv.js';
import { listVamSessions, readPane, type TmuxRun } from '../sources/tmux/spawn.js';
import { targetSession } from './pane.js';

/** One row of the picker. `checked` is null when the row carries no box at all. */
export type PickerRow = { readonly label: string; readonly checked: boolean | null };

/** The picker on screen: its rows, and which one the cursor is on. */
export type Picker = { readonly rows: readonly PickerRow[]; readonly cursor: number };

/**
 * One rendered row: an optional cursor glyph, the CLI's own number, an
 * optional checkbox, and the label. Anchored at both ends so a sentence that
 * merely mentions a number cannot pass for a row.
 */
const ROW = /^\s*(❯)?\s+(\d+)\.\s+(?:\[(.)\]\s+)?(\S.*?)\s*$/;

/**
 * The picker on a captured screen, or `null` when what is there is not one.
 *
 * The block is found FROM THE CURSOR OUT, and the numbers must run from one:
 * a screen holding a session's own numbered prose above a real picker must
 * not have that prose read as options. Exactly one cursor, or this refuses --
 * two would mean vam cannot say which list it is about to answer.
 */
export function readPicker(text: string): Picker | null {
  const parsed = text.split('\n').map((line) => ROW.exec(line));
  const cursors = parsed.flatMap((row, at) => (row?.[1] === undefined ? [] : [at]));
  const [head] = cursors;
  if (head === undefined || cursors.length !== 1) return null;
  let from = head;
  while (parsed[from - 1] != null) from -= 1;
  let to = head;
  while (parsed[to + 1] != null) to += 1;
  const rows = parsed.slice(from, to + 1);
  if (!rows.every((row, at) => row?.[2] === String(at + 1))) return null;
  return {
    cursor: head - from,
    rows: rows.map((row) => ({
      label: row?.[4] ?? '',
      checked: row?.[3] === undefined ? null : row[3].trim() !== '',
    })),
  };
}

const cursorLabel = (picker: Picker): string => picker.rows[picker.cursor]?.label ?? '';
const shape = (picker: Picker): string => picker.rows.map((row) => row.label).join(' ');

/**
 * Answer the question a session is asking, in the pane the tab is showing.
 *
 * Aimed by `targetSession` -- the SAME rule the read, the resize and the
 * keystroke use, and deliberately not a second opinion about whose terminal
 * this is. This is the most consequential thing in vam that writes: a
 * keystroke lands in someone's prompt, an answer ends a tool call.
 */
export async function answerQuestion(
  run: TmuxRun,
  projectId: string,
  request: AnswerRequest,
  rowId?: string,
  panes?: ReadonlyMap<string, string>,
): Promise<AnswerResult> {
  const listed = await listVamSessions(run);
  if (listed.kind === 'unavailable') return { kind: 'unaimed' };
  const match = targetSession(listed.sessions, projectId, rowId, panes);
  // `none`, `ambiguous` and `mispaired` all end here, and the last is the one
  // worth naming: a row that published a pane vam cannot use never falls
  // through to the project tag, which would answer a question in a session
  // this row was never in.
  if (match.kind !== 'one') return { kind: 'unaimed' };
  return deliver(run, match.name, request);
}

async function deliver(run: TmuxRun, name: string, request: AnswerRequest): Promise<AnswerResult> {
  /** The screen, or `null` when vam could not read it. Never a guess. */
  const read = async (): Promise<string | null> => {
    const pane = await readPane(run, name);
    return pane.kind === 'ok' ? pane.text : null;
  };
  /** The picker on the screen, or the outcome that stops the flow. */
  const look = async (): Promise<Picker | AnswerResult> => {
    const text = await read();
    if (text === null) return { kind: 'unreadable' };
    return readPicker(text) ?? { kind: 'no-picker' };
  };
  const press = async (argv: readonly string[]): Promise<boolean> =>
    (await run(argv)).failure === null;

  const first = await look();
  if (!('rows' in first)) return first;
  // BEFORE ANYTHING IS PRESSED: every label the operator chose has to be on
  // the screen vam just read. A label that is not there is a question this is
  // not the picker for, and there is no arrow that would fix that.
  const labels = first.rows.map((row) => row.label);
  const missing = request.labels.find((label) => !labels.includes(label));
  if (missing !== undefined) return { kind: 'unmatched', label: missing };

  // THE PROBE. One arrow, then read again: a picker whose cursor does not move
  // is not taking keys, and a Return into that state commits the row the
  // cursor was already on -- which is the Crimson failure exactly.
  if (!(await press(sendDownArgv(name)))) return { kind: 'refused' };
  const probe = await look();
  if (!('rows' in probe)) return probe;
  if (probe.cursor === first.cursor && cursorLabel(probe) === cursorLabel(first)) {
    return { kind: 'not-live' };
  }

  /** Walk the cursor onto `label`, re-reading after every single step. */
  const stepTo = async (label: string, from: Picker): Promise<Picker | AnswerResult> => {
    let view = from;
    // One pass of the list at most: it wraps, so every row is reachable, and a
    // bound is what stops a picker that answers oddly from being walked
    // forever.
    for (let step = 0; step <= view.rows.length; step += 1) {
      if (cursorLabel(view) === label) return view;
      if (!(await press(sendDownArgv(name)))) return { kind: 'refused' };
      const next = await look();
      if (!('rows' in next)) return next;
      view = next;
    }
    return { kind: 'unmatched', label };
  };

  if (!request.multiSelect) {
    const label = request.labels[0] ?? '';
    const at = await stepTo(label, probe);
    if (!('rows' in at)) return at;
    if (!(await press(sendEnterArgv(name)))) return { kind: 'refused' };
    // THE READ-BACK, and it is what the word "sent" is allowed to mean. The
    // same picker still standing is the Return not having been taken --
    // reported, never swallowed.
    const back = await read();
    if (back === null) return { kind: 'unconfirmed', label };
    const after = readPicker(back);
    if (after !== null && shape(after) === shape(at)) return { kind: 'unconfirmed', label };
    return { kind: 'sent', answer: label };
  }

  // MULTI-SELECT. Return TICKS a row rather than committing, so each toggle is
  // verified against the box the pane draws before the next one is aimed.
  let view = probe;
  for (const label of request.labels) {
    const at = await stepTo(label, view);
    if (!('rows' in at)) return at;
    if (!(await press(sendEnterArgv(name)))) return { kind: 'refused' };
    const ticked = await look();
    if (!('rows' in ticked)) return ticked;
    if (ticked.rows[ticked.cursor]?.checked !== true) return { kind: 'unconfirmed', label };
    view = ticked;
  }

  // The CLI names the whole answer in prose before it commits anything. That
  // review screen is a verification surface vam gets for free, and it is read
  // rather than skipped past: an answer it does not name is an answer vam will
  // not commit.
  if (!(await press(sendRightArgv(name)))) return { kind: 'refused' };
  const text = await read();
  if (text === null) return { kind: 'unreadable' };
  const unnamed = request.labels.find((label) => !text.includes(label));
  if (unnamed !== undefined) return { kind: 'unconfirmed', label: unnamed };
  const panel = readPicker(text);
  const chosen = request.labels[0] ?? '';
  // And the cursor has to be on the row that SUBMITS. Anywhere else, this
  // Return means something vam did not read.
  if (panel === null || !/submit/i.test(cursorLabel(panel))) {
    return { kind: 'unconfirmed', label: chosen };
  }
  if (!(await press(sendEnterArgv(name)))) return { kind: 'refused' };
  const back = await read();
  if (back === null) return { kind: 'unconfirmed', label: chosen };
  const after = readPicker(back);
  if (after !== null && shape(after) === shape(panel)) {
    return { kind: 'unconfirmed', label: chosen };
  }
  return { kind: 'sent', answer: request.labels.join(', ') };
}
