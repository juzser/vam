/**
 * THE MODEL A SESSION'S LAST TURN RAN ON, read out of its own transcript.
 *
 * ── WHY A SECOND SOURCE EXISTS ────────────────────────────────────────────
 *
 * `main/terminal/model.ts` reads the model off the CLI's painted footer, and
 * everything that module says about itself is still true. What it could not
 * say is that the footer is OPTIONAL: `~/.claude/settings.json` may set
 * `statusLine` to a command of the operator's own, and the CLI then paints
 * that command's output instead of its own line.
 *
 * MEASURED ON THE OPERATOR'S OWN MACHINE, which is why this module exists at
 * all. Their `statusLine` runs `bash ~/.claude/statusline-command.sh`, and a
 * read-only `capture-pane` of one of their live sessions shows it emitting
 * raw JSON across several lines:
 *
 *       ⣿ {
 *       "id": "claude-opus-5",
 *       "display_name": "Opus 5"
 *       } · agent-scatola · master · ctx 28%
 *       ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents
 *
 * `readModelLine` correctly answers "I cannot tell" for that screen -- it does
 * not end in `in:<x> out:<y>`, so nothing about it is the footer -- and the
 * button correctly keeps the word it wore before. The design was right and the
 * SOURCE was the problem: a fact vam can only get from a surface the operator
 * is free to replace is a fact vam loses for a whole class of machines.
 *
 * NOTE WHAT THIS DOES NOT DO: it does not parse that custom status line. A
 * status line is whatever its author wants; the next operator's emits
 * something else entirely, and a reader of one person's script is a reader of
 * nothing. The transcript is the CLI's own record, in the CLI's own shape.
 *
 * ── WHAT WAS MEASURED, over the 94 transcripts under `~/.claude/projects`
 * on 2026-09-19 ───────────────────────────────────────────────────────────
 *
 *  - `message.model` is carried by `assistant` lines and by NOTHING else:
 *    10,910 occurrences across the last 4 MiB of every transcript, every one
 *    of them on a line of `type: "assistant"`.
 *  - Five distinct values: `claude-opus-5` (10,489), `claude-fable-5-1` (363),
 *    `claude-sonnet-5` (40), `<synthetic>` (14), `claude-haiku-4-5-20251001`
 *    (4).
 *  - With the window below, 84 of the 94 answer on the FIRST read, 79 answer
 *    at all, mean cost 39,891 bytes, worst 196,608 across six steps, and none
 *    reached the budget. The 15 that do not answer are sessions with no
 *    `assistant` line at all, which is `unknown` and must stay `unknown`.
 *
 * ── WHAT THIS ANSWERS, STATED PRECISELY ──────────────────────────────────
 *
 * The model the API SERVED on the most recent turn. That is not the same fact
 * as the footer's, and the difference is why the footer is asked first
 * (`main/terminal/model.ts` holds the precedence and the argument for it):
 * a `/model` switch with no turn since moves the footer immediately and does
 * not move this until the session next answers. So this LAGS, by exactly one
 * turn, and the surface that draws it says so in its own words rather than
 * claiming the session is running what it merely last ran.
 */

import { MAX_TAIL_READ_BYTES } from './tail.js';
import { locateTranscript } from './transcript-index.js';
import { fileTranscriptSource, type TranscriptSource } from './window.js';

/**
 * One step of the backward read, and the first one.
 *
 * SMALLER THAN `TAIL_WINDOW_BYTES`, AND MEASURED RATHER THAN CHOSEN. The live
 * view's tail needs the raw material of a whole turn -- a prompt and a reply
 * and everything the reply is made of -- so 128 KiB is what it pays. This read
 * wants ONE FIELD off the newest assistant line, and it runs on its own faster
 * clock: every `MODEL_POLL_MS` (4s, `DetailPanel.tsx`) for the row an operator
 * is looking at, against `load()`'s slower sweep of every live session.
 *
 * Measured over the 94 transcripts, comparing the two sizes on the same rule:
 * at 128 KiB, 92 of 94 answer in one read and the mean cost is 98,790 bytes;
 * at 32 KiB, 84 answer in one read and the mean is 39,891. The same 79 files
 * answer either way -- so the larger window buys eight files one fewer read
 * and costs every file two and a half times the bytes, every four seconds. The
 * worst case moves the same way: 393,216 bytes at 128 KiB against 196,608 at
 * 32 KiB, because a step past an oversized line skips exactly one step's
 * worth.
 */
export const MODEL_WINDOW_BYTES = 32 * 1024;

/**
 * A MODEL ID BY SHAPE: lowercase alphanumeric segments joined by single
 * dashes. `claude-opus-5`, `claude-haiku-4-5-20251001`, and the id of a model
 * nobody has shipped yet.
 *
 * NO VOCABULARY OF MODEL NAMES IS CONSULTED, which is `model.ts`'s rule kept
 * at a second reader and for the same reason it gives: "a parser that only
 * believed the five aliases would answer 'I cannot tell' on the day the CLI
 * shipped the sixth -- exactly when the operator most needs to be told what
 * they are running". The shape is the check.
 *
 * AND THE SHAPE IS WHAT REFUSES `<synthetic>`, which is the one value in the
 * corpus that is not a model: the CLI writes it on an `assistant` line it
 * produced ITSELF, without calling the API -- an interrupt, an error, a
 * cancelled turn; its `usage` counts are all zero. Measured: 14 lines, and on
 * two of the three transcripts whose newest model value it is, the turn above
 * it ran on `claude-opus-5`. Skipping it and reading on is therefore not a
 * special case for one string -- the angle brackets are simply not id-shaped
 * -- and it answers the question that was asked: what did the API last serve.
 * One transcript in the corpus has `<synthetic>` and nothing else in it, and
 * the honest answer there is `unknown`.
 */
const MODEL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const DIGITS = /^\d+$/;
const LETTERS = /^[a-z]+$/;
/** Eight digits: `20251001`. A date stamp, and never a version number. */
const DATE_STAMP = /^\d{8}$/;

/**
 * The model id on one parsed transcript line, or `null` for "not this line".
 *
 * `assistant` AND NOTHING ELSE, because that is the measurement: all 10,910
 * `message.model` values in the corpus sit on assistant lines. A `model` field
 * on some other line type is a field this reader has never seen, and a reader
 * that started believing one would be reading a shape nobody checked.
 */
export function modelIdOnLine(line: unknown): string | null {
  if (typeof line !== 'object' || line === null) return null;
  const record = line as Record<string, unknown>;
  if (record['type'] !== 'assistant') return null;
  const message = record['message'];
  if (typeof message !== 'object' || message === null) return null;
  const model = (message as Record<string, unknown>)['model'];
  if (typeof model !== 'string' || !MODEL_ID.test(model)) return null;
  return model;
}

/**
 * THE NAME THE BUTTON WEARS for a model id -- derived, in the shape the CLI's
 * own footer prints.
 *
 * WHY DERIVE AT ALL, rather than show `claude-opus-5`. The other source of
 * this same fact prints `Opus 5` (`main/terminal/model.ts`), and the picker's
 * tick compares the name against the CLI's own menu words
 * (`runningModelRows`). A button that read `Opus 5` while the footer existed
 * and `claude-opus-5` when it did not would be one control with two
 * vocabularies, ticking a row in one state and nothing in the other -- on a
 * fact that has not changed. One shape, from both sources.
 *
 * THE RULE, and every part of it is mechanical:
 *
 *   - the NAME is the last alphabetic segment BEFORE the first numeric one,
 *     which is `model.ts`'s own footer rule said about dashes instead of
 *     spaces: taking the last rather than the first is what keeps a prefix --
 *     `claude` here, a directory with a space in it there -- out of the name;
 *   - the VERSION is the run of numeric segments after it, joined with dots:
 *     `5`, `4-5` -> `4.5`, `5-1` -> `5.1`;
 *   - a segment of exactly EIGHT DIGITS ends that run, because it is a date
 *     stamp and not a version component. Held against a measurement this repo
 *     already took (`fixtures/demo.ts`): `/model claude-sonnet-4-5-20250929`
 *     paints `Sonnet 4.5` on the footer, so dropping the stamp is what makes
 *     the two sources agree rather than a convenience;
 *   - and the first letter is capitalised, which is the whole of the
 *     "prettifying" -- no word is translated into another word.
 *
 * WHEN IT REFUSES, IT SHOWS THE ID. An alphabetic segment AFTER the version
 * means this is not the shape that was measured -- `claude-3-5-sonnet-
 * 20241022` is the older API naming, family after the numbers, and the rule
 * above would read `Claude` out of it. `Claude 3.5` is a name an operator
 * could act on and it is the wrong one, so the id goes through whole instead.
 * A clipped `claude-3-5-…` on the button is ugly; the note and the accessible
 * name carry it in full, and ugly-and-true beats tidy-and-wrong.
 */
export function displayModelName(id: string): string {
  const parts = id.split('-');
  const firstNumber = parts.findIndex((part) => DIGITS.test(part));
  const nameAt = firstNumber === -1 ? parts.length - 1 : firstNumber - 1;
  const name = parts[nameAt];
  if (nameAt < 0 || name === undefined || !LETTERS.test(name)) return id;
  const numbers: string[] = [];
  let at = nameAt + 1;
  for (; at < parts.length; at++) {
    const part = parts[at] ?? '';
    if (!DIGITS.test(part) || DATE_STAMP.test(part)) break;
    numbers.push(part);
  }
  // WHAT IS LEFT OVER DECIDES WHETHER THIS WAS READ AT ALL. Everything after
  // the version must be numeric -- a date stamp, and nothing else. A word
  // there means the id is built the other way round and nothing may be
  // derived from it.
  if (parts.slice(at).some((part) => !DIGITS.test(part))) return id;
  const word = `${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`;
  return numbers.length === 0 ? word : `${word} ${numbers.join('.')}`;
}

/**
 * The newest model id in one window of transcript text, or `null`.
 *
 * BACKWARDS, because the newest line is the one that answers and a window can
 * hold hundreds. A LINE THAT FAILS `JSON.parse` IS SKIPPED AND NEVER FATAL:
 * an append-only log read while it is being written ends in half a line, and
 * a reader that treated that as the end of the world would go blind for the
 * few milliseconds a turn is landing -- which is exactly when it is being
 * looked at. A measuring tool in this repo once inherited that bug and
 * reported a confident zero.
 */
export function newestModelId(text: string): string | null {
  const lines = text.split('\n');
  for (let at = lines.length - 1; at >= 0; at--) {
    const raw = lines[at] ?? '';
    if (raw.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const id = modelIdOnLine(parsed);
    if (id !== null) return id;
  }
  return null;
}

/**
 * The newest model id in a transcript, read backwards a window at a time.
 *
 * THE SAME STEPPING RULE `tail.ts` USES, and deliberately the same: each step
 * ends where the previous one's first WHOLE line began, so nothing is read
 * twice and widening costs what it covers. What differs is only the stop
 * rule -- that one stops when the window holds a whole turn, this one stops
 * the moment a model is named.
 *
 * AN OVERSIZED LINE CANNOT END THE SEARCH, which is the half that has to be
 * written down. A step landing wholly inside one line yields no whole line at
 * all (`window.ts` answers an empty window), and this read steps to the
 * requested start and carries on -- skipping that line's content entirely.
 * MEASURED, and not hypothetically: two real transcripts here carry a
 * 131,880-byte `attachment` line ELEVEN lines from the end, with the
 * session's only `assistant` line directly above it. A single-window read of
 * either answers `null` while the file plainly says `claude-fable-5-1`; this
 * one answers, in six steps and 196,608 bytes. That is this repo's own
 * measured starvation defect (`claude-code-tail-window.test.ts`) arriving at
 * a second reader, and the reason this one steps rather than reading a fixed
 * tail.
 *
 * THE BUDGET IS `MAX_TAIL_READ_BYTES`, shared with the live tail and argued
 * there: it is sized to clear the largest single line on this machine --
 * 1,356,930 bytes -- with room to read a window past it. Nothing in the
 * measured corpus comes within a tenth of it; it is a valve, not the rule.
 *
 * `step` and `budget` are arguments for the reason every read in this
 * directory injects its own: a fixture that had to be 2 MiB to exercise the
 * ceiling would be a fixture nobody reads. Production passes neither.
 */
export async function readTranscriptModel(
  source: TranscriptSource,
  step: number = MODEL_WINDOW_BYTES,
  budget: number = MAX_TAIL_READ_BYTES,
): Promise<string | null> {
  const stride = Math.max(1, step);
  let boundary = await source.size();
  let spent = 0;
  for (;;) {
    const from = Math.max(0, boundary - stride);
    const window = await source.read(from, boundary);
    spent += boundary - from;
    if (window.text !== '') {
      const id = newestModelId(window.text);
      if (id !== null) return id;
    }
    // BYTE 0 IS THE WHOLE TRANSCRIPT: what was not found here does not exist,
    // and no amount of widening can be asked to find it. A session that has
    // only been asked a question lands here, and `null` is the true answer.
    if (from === 0) return null;
    boundary = window.text === '' ? from : window.start;
    if (spent + stride > budget) return null;
  }
}

/**
 * The name to put on one row's model button, read from that row's transcript,
 * or `null` for "vam could not tell".
 *
 * FOUND BY SESSION ID THROUGH THE INDEX, never by parsing a slug -- the slug
 * is a lossy flattening of a directory and cannot be turned back into one
 * (`transcript-index.ts`). `rowId` may be a row key (`<sessionId>#<pid>`),
 * which `locateTranscript` is the single place that knows.
 *
 * EVERY FAILURE IS `null` AND NOT A THROW. This runs on a poll behind a button
 * label: a transcript removed between the index walk and the read, a file this
 * user cannot open, a directory that vanished -- the label has one thing to
 * draw for all of them, which is the word it wore before (`model.ts` makes the
 * same argument about its four refusals).
 */
export async function readSessionModelFromTranscript(
  root: string,
  rowId: string,
  // Injectable for the reason every filesystem read in this directory is: a
  // test reads an invented transcript, never the operator's.
  sourceOf: (path: string) => TranscriptSource = fileTranscriptSource,
): Promise<string | null> {
  const { path } = await locateTranscript(root, rowId);
  if (path === undefined) return null;
  try {
    const id = await readTranscriptModel(sourceOf(path));
    return id === null ? null : displayModelName(id);
  } catch {
    return null;
  }
}
