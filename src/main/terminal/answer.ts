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

import type {
  AnswerRequest,
  AnswerResult,
  AnswerStep,
  PanePrompt,
  PromptView,
} from '../../shared/answer.js';
import { MAX_QUESTION_TEXT } from '../../shared/answer.js';
import { sendDownArgv, sendEnterArgv, sendRightArgv } from '../sources/tmux/argv.js';
import { listVamSessions, readPane, type TmuxRun } from '../sources/tmux/spawn.js';
import { targetSession } from './pane.js';

/** One row of the picker. `checked` is null when the row carries no box at all. */
/** Every answer but `sent`: a stop, before `deliver` says how far it got. */
type Stop = Exclude<AnswerResult, { readonly kind: 'sent' }>;

export type PickerRow = { readonly label: string; readonly checked: boolean | null };

/** The picker on screen: its rows, and which one the cursor is on. */
export type Picker = { readonly rows: readonly PickerRow[]; readonly cursor: number };

/**
 * One rendered row: an optional box border, an optional cursor glyph, the
 * CLI's own number, an optional checkbox, and the label. Anchored at both ends
 * so a sentence that merely mentions a number cannot pass for a row.
 *
 * THE BORDER IS WHY A PERMISSION PROMPT USED TO READ AS NO PICKER AT ALL.
 * `AskUserQuestion` draws its options at the left margin, which is the only
 * shape this pattern was ever fed; the CLI's tool-approval prompt draws the
 * same numbered grammar inside a rounded box, so every row arrives as
 * `│ ❯ 1. Yes … │`. `^\s*` cannot cross the leading `│`, so no line matched, so
 * `readPicker` returned null and the one machine vam already had for answering
 * a picker refused the commonest thing a session waits on. The border is
 * OPTIONAL and appears once at each end: it cannot make a line that is not a
 * row into one, because the number, the dot and the anchors are untouched.
 */
/**
 * Every CSI sequence, so a screen can be read as text.
 *
 * `capturePaneArgv` asks for `-e`, which is what makes the Terminal tab
 * COLOURED -- and it means every capture arrives with escape sequences in it.
 * A row drawn as the cursor is exactly the row the CLI inverts, so the label
 * this parser lifts off it carries the sequence unless something takes it
 * off: the operator would be shown the bytes, and `text.includes(label)` on
 * the review screen would compare a coloured label against a differently
 * coloured line. Stripped once, at the two doors -- the parser and the read --
 * so nothing downstream has to remember.
 */
const CSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;:?]*[ -/]*[@-~]`, 'g');

const plain = (text: string): string => text.replace(CSI, '');

const ROW = /^\s*│?\s*(❯)?\s+(\d+)\.\s+(?:\[(.)\]\s+)?(\S.*?)\s*│?\s*$/;

/**
 * The picker on a captured screen, or `null` when what is there is not one.
 *
 * ROWS ARE FOUND BY THEIR NUMBERING, NOT BY BEING ADJACENT LINES, and that is
 * the correction a real capture forced. What stood here walked outwards from
 * the cursor while each neighbouring LINE parsed as a row -- and a real
 * `AskUserQuestion` picker prints each option's description on its own line
 * between the rows:
 *
 *     ❯ 1. Crimson
 *          A deep, rich red.
 *       2. Cobalt
 *
 * So the walk stopped at the first description and reported a ONE-ROW picker.
 * With the cursor on row one that made every other option "not on the screen";
 * with the cursor anywhere else the numbering check failed and the answer was
 * "there is no picker here". Both refuse rather than misfire, which is why it
 * was invisible -- and both mean the feature could not work against the thing
 * it was built for. Measured, not reasoned: see `answer-live-screens.ts`.
 *
 * The group is therefore the run of rows numbered 1, 2, 3 ... in order, and
 * the one containing the cursor is the picker. A screen holding a session's
 * own numbered prose ABOVE a real picker still cannot merge with it: prose
 * that restarts at 1 is its own run, and prose that does not is in no run at
 * all. Exactly one cursor, or this refuses -- two would mean vam cannot say
 * which list it is about to answer.
 */
export function readPicker(text: string): Picker | null {
  const parsed = plain(text)
    .split('\n')
    .map((line) => ROW.exec(line));
  const cursors = parsed.flatMap((row, at) => (row?.[1] === undefined ? [] : [at]));
  const [head] = cursors;
  if (head === undefined || cursors.length !== 1) return null;
  /** Every run of rows numbered from one, in the order they are drawn. */
  const runs: RegExpExecArray[][] = [];
  let holdsCursor = false;
  let found: RegExpExecArray[] | null = null;
  for (const [at, row] of parsed.entries()) {
    if (row === null) continue;
    const run = runs.at(-1);
    if (run !== undefined && row[2] === String(run.length + 1)) {
      run.push(row);
    } else if (row[2] === '1') {
      if (holdsCursor) found = runs.at(-1) ?? null;
      holdsCursor = false;
      runs.push([row]);
    } else {
      continue;
    }
    if (at === head) holdsCursor = true;
  }
  const picker = found ?? (holdsCursor ? (runs.at(-1) ?? null) : null);
  if (picker === null) return null;
  return {
    cursor: picker.findIndex((row) => row[1] !== undefined),
    rows: picker.map((row) => ({
      label: row[4] ?? '',
      checked: row[3] === undefined ? null : row[3].trim() !== '',
    })),
  };
}

/** A box border, at either end of a line, and nothing else. */
const BORDER = /^\s*\u2502?\s*|\s*\u2502?\s*$/g;

/**
 * The prompt on a captured screen -- a picker, and the line that NAMES it.
 *
 * WHY THE TITLE IS THE WHOLE POINT. A permission prompt writes no transcript
 * record, so the renderer has no question text of its own to send back: the
 * only place the question exists is the screen. And `answerQuestion` will not
 * press a key on a screen it has not first matched the question against
 * (`see`), which is what keeps a walk from answering the question the CLI
 * advanced to. So reading the title here is what makes the existing answer
 * machine usable for a shape that has no record -- and a prompt with nothing
 * above it is refused rather than answered with an empty needle that every
 * screen would satisfy.
 *
 * The line taken is the LAST non-empty one above the first row, not the box's
 * heading: the CLI draws `Bash command` at the top of the frame and the
 * question directly over the options, and the heading is the same string for
 * every Bash approval there will ever be.
 */
export function readPrompt(text: string): PanePrompt | null {
  const picker = readPicker(text);
  if (picker === null) return null;
  const lines = plain(text).split('\n');
  const first = lines.findIndex((line) => ROW.test(line));
  const title = lines
    .slice(0, first)
    .map((line) => line.replace(BORDER, ''))
    .reverse()
    .find((line) => line !== '');
  if (title === undefined || title.length > MAX_QUESTION_TEXT) return null;
  return { title, options: picker.rows.map((row) => row.label) };
}

/**
 * The prompt the session in this row's pane is showing, or why there is none.
 *
 * AIMED BY `targetSession`, the same rule the read, the resize, the keystroke
 * and the answer use -- and the refusals are kept apart for the same reason
 * they are there: `mispaired` is a row that published a pane vam rejected, and
 * it may never fall through to the project tag, which would show the operator
 * a prompt from a session this row was never in and then answer it.
 *
 * `none` is a pane vam READ and found no prompt on. It is not `unreadable`,
 * which is vam not having looked, and the card draws them differently because
 * one of them means the question may still be there.
 */
export async function readSessionPrompt(
  run: TmuxRun,
  projectId: string,
  rowId?: string,
  panes?: ReadonlyMap<string, string>,
): Promise<PromptView> {
  const listed = await listVamSessions(run);
  if (listed.kind === 'unavailable') return { kind: 'unavailable' };
  const match = targetSession(listed.sessions, projectId, rowId, panes);
  if (match.kind === 'mispaired') return { kind: 'mispaired' };
  if (match.kind !== 'one') return { kind: 'unaimed' };
  const pane = await readPane(run, match.name);
  if (pane.kind !== 'ok') return { kind: 'unreadable' };
  const prompt = readPrompt(pane.text);
  return prompt === null ? { kind: 'none' } : { kind: 'prompt', prompt };
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
  // vam could not look. It therefore cannot report a pairing problem, which is
  // what `unaimed` is drawn as -- see `AnswerResult`.
  if (listed.kind === 'unavailable') return { kind: 'unavailable' };
  const match = targetSession(listed.sessions, projectId, rowId, panes);
  // A row that published a pane vam cannot use never falls through to the
  // project tag, which would answer a question in a session this row was never
  // in -- and it is reported as what it is rather than as `none`.
  if (match.kind === 'mispaired') return { kind: 'mispaired' };
  // `none` and `ambiguous`: no session of vam's answers for this project, or
  // two do.
  if (match.kind !== 'one') return { kind: 'unaimed' };
  return deliver(run, match.name, request);
}

async function deliver(run: TmuxRun, name: string, request: AnswerRequest): Promise<AnswerResult> {
  /** What has been pressed on a row, in asking order. An INTENTION, until: */
  const answers: string[] = [];
  /**
   * HOW MANY OF THEM THE PICKER IS PROVEN TO HAVE TAKEN IN, and the proof is
   * the CLI's own: a single-select Return both answers and advances, so a
   * screen showing question N is proof that questions 1..N-1 went in, and a
   * review naming every chosen option is proof for the whole set. Nothing is
   * counted on the strength of vam having pressed the key -- that is the
   * overclaim this whole module exists against, and it would be the same lie
   * as "not sent" wearing the other face.
   */
  let landed = 0;
  /**
   * A stop, told with how far the set got. `committed` is left ABSENT while
   * nothing is proven, so "not sent" stays the wording for the common case
   * and is impossible for the case where it would deny a delivery.
   */
  const stop = (result: Stop): AnswerResult =>
    landed === 0 ? result : { ...result, committed: answers.slice(0, landed) };
  /** The screen, or `null` when vam could not read it. Never a guess. */
  const read = async (): Promise<string | null> => {
    const pane = await readPane(run, name);
    return pane.kind === 'ok' ? plain(pane.text) : null;
  };
  const press = async (argv: readonly string[]): Promise<boolean> =>
    (await run(argv)).failure === null;

  /**
   * THE ONE READ EVERY STEP OF THE LOOP GOES THROUGH, and the reason a set is
   * no more dangerous than a single question.
   *
   * It answers "the picker for THIS step", or the reason there is none -- so
   * the question text is re-checked after EVERY keystroke, not once per step.
   * The CLI advances itself when a question is answered, which means the
   * screen can become another question's between two arrows of vam's own walk;
   * matching a label there is precisely the failure the label matching exists
   * to prevent, and a loop gives it more chances. Measured, in a real
   * two-question call: `Cobalt` was an option in both questions, so the wrong
   * screen would have answered confidently.
   */
  const see = async (step: AnswerStep): Promise<Picker | Stop> => {
    const text = await read();
    if (text === null) return { kind: 'unreadable' };
    const lines = text.split('\n');
    // NAMED ABOVE THE ROWS, not merely present. The CLI prints the question
    // over its options -- measured -- and it also ECHOES every question of the
    // set on its review screen and again in the transcript once the call is
    // answered. So `includes` alone is satisfied by screens that are talking
    // ABOUT the question rather than asking it, and the review's own
    // Submit/Cancel rows would then be searched for the operator's option.
    const asked = lines.findIndex((line) => line.includes(step.question));
    const firstRow = lines.findIndex((line) => ROW.test(line));
    if (asked === -1 || (firstRow !== -1 && asked > firstRow)) {
      return { kind: 'wrong-question', question: step.question };
    }
    const picker = readPicker(text);
    if (picker === null) return { kind: 'no-picker' };
    // THE REVIEW IS NOT A QUESTION, and it names every question of the set
    // above its own rows -- so the rule above does not catch it. Walked as if
    // it were question two, it is a real picker on a real screen offering
    // `Submit answers` and `Cancel`, and the step would be searching those two
    // for the operator's option. It is the LAST screen of the set and vam
    // reaches it deliberately, in the tail; meeting it with a step still
    // outstanding means the walk lost its place.
    if (picker.rows.some((row) => /^submit answers$/i.test(row.label))) {
      return { kind: 'wrong-question', question: step.question };
    }
    return picker;
  };

  /** Walk the cursor onto `label`, re-reading -- and re-checking -- every step. */
  const stepTo = async (step: AnswerStep, label: string, from: Picker): Promise<Picker | Stop> => {
    let view = from;
    // One pass of the list at most: it wraps, so every row is reachable, and a
    // bound is what stops a picker that answers oddly from being walked
    // forever.
    for (let at = 0; at <= view.rows.length; at += 1) {
      if (cursorLabel(view) === label) return view;
      if (!(await press(sendDownArgv(name)))) return { kind: 'refused' };
      const next = await see(step);
      if (!('rows' in next)) return next;
      view = next;
    }
    return { kind: 'unmatched', label };
  };

  for (const step of request.steps) {
    // WHERE DID THE CLI LAND. Before a single label is matched against it.
    const first = await see(step);
    if (!('rows' in first)) return stop(first);
    // THE SCREEN IS THIS STEP'S OWN QUESTION, which is exactly the proof that
    // every step before it was taken in: the CLI is the thing that advanced.
    landed = answers.length;
    // And every label the operator marked has to be ON that screen. A label
    // that is not there is a question this is not the picker for, and there is
    // no arrow that would fix that.
    const labels = first.rows.map((row) => row.label);
    const missing = step.labels.find((label) => !labels.includes(label));
    if (missing !== undefined) return stop({ kind: 'unmatched', label: missing });

    // THE PROBE. One arrow, then read again: a picker whose cursor does not
    // move is not taking keys, and a Return into that state commits the row the
    // cursor was already on -- which is the Crimson failure exactly.
    if (!(await press(sendDownArgv(name)))) return stop({ kind: 'refused' });
    const probe = await see(step);
    if (!('rows' in probe)) return stop(probe);
    if (probe.cursor === first.cursor && cursorLabel(probe) === cursorLabel(first)) {
      return stop({ kind: 'not-live' });
    }

    if (!step.multiSelect) {
      const label = step.labels[0] ?? '';
      const at = await stepTo(step, label, probe);
      if (!('rows' in at)) return stop(at);
      // Return here both ANSWERS and ADVANCES -- measured: the strip flips to
      // a tick, the text becomes the next question and the cursor resets to
      // row one. So nothing is read after it HERE: where it landed is the
      // first thing the next turn of the loop asks, and the tail asks it for
      // the last step.
      if (!(await press(sendEnterArgv(name)))) return stop({ kind: 'refused' });
      answers.push(label);
      continue;
    }

    // MULTI-SELECT. Return TICKS a row rather than answering, so each toggle is
    // verified against the box the pane draws before the next one is aimed, and
    // the question is still checked every time.
    let view = probe;
    for (const label of step.labels) {
      const at = await stepTo(step, label, view);
      if (!('rows' in at)) return stop(at);
      if (!(await press(sendEnterArgv(name)))) return stop({ kind: 'refused' });
      const ticked = await see(step);
      if (!('rows' in ticked)) return stop(ticked);
      if (ticked.rows[ticked.cursor]?.checked !== true) {
        return stop({ kind: 'unconfirmed', label });
      }
      view = ticked;
    }
    // A ticked question is not an answered one: Right is what leaves it, for
    // the next question or for the review.
    if (!(await press(sendRightArgv(name)))) return stop({ kind: 'refused' });
    answers.push(step.labels.join(', '));
  }

  const answer = answers.join(', ');
  const chosen = request.steps.flatMap((step) => step.labels);
  /**
   * THE REVIEW IS EXPECTED EXCEPT IN ONE CASE, and the split is measured
   * rather than reasoned. A set of several questions ends on the CLI's own
   * review screen, and so does a multi-select one. A SINGLE single-select
   * question does not: its Return answers the call outright and the picker is
   * simply gone. So an empty screen is confirmation for that one shape and a
   * missing review for every other.
   */
  const reviewed = request.steps.length > 1 || request.steps.some((step) => step.multiSelect);
  const last = chosen.at(-1) ?? '';
  /**
   * WHETHER THE LAST KEY WAS AN ANSWER OR NOT, which is what an unreadable
   * screen here means. A single-select step ends on a Return that ANSWERS, so
   * vam has already written and cannot confirm it -- `unconfirmed`. A
   * multi-select step ends on a Right, which only moves, so nothing has been
   * committed and the honest word is that vam could not look.
   */
  const answered = request.steps.at(-1)?.multiSelect === false;
  const text = await read();
  if (text === null)
    return answered ? stop({ kind: 'unconfirmed', label: last }) : stop({ kind: 'unreadable' });
  const panel = readPicker(text);
  if (panel === null) {
    return reviewed ? stop({ kind: 'unconfirmed', label: last }) : { kind: 'sent', answer };
  }
  // The cursor has to be on the row that SUBMITS. Anywhere else, this Return
  // would mean something vam did not read.
  if (!/submit/i.test(cursorLabel(panel))) return stop({ kind: 'unconfirmed', label: last });
  // And the review has to NAME the whole answer. It prints every question and
  // what it will send for each, which is a verification surface vam gets for
  // free -- an answer it does not name is an answer vam will not commit.
  const unnamed = chosen.find((label) => !text.includes(label));
  if (unnamed !== undefined) return stop({ kind: 'unconfirmed', label: unnamed });
  // The review names every one of them, which is the CLI saying it took the
  // last step in too. Nothing after this point may re-send any of the set.
  landed = answers.length;
  if (!(await press(sendEnterArgv(name)))) return stop({ kind: 'refused' });
  const back = await read();
  if (back === null) return stop({ kind: 'unconfirmed', label: last });
  const after = readPicker(back);
  if (after !== null && shape(after) === shape(panel)) {
    return stop({ kind: 'unconfirmed', label: last });
  }
  return { kind: 'sent', answer };
}
