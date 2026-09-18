/**
 * WHICH MODEL A SESSION IS ACTUALLY RUNNING, read off the screen it paints.
 *
 * THE PROBLEM THIS SOLVES. vam does not run the agent: it drives the CLI's own
 * `/model` menu in a tmux pane (`model-switch.ts` next door) and has never
 * read the ANSWER LINE back. So what vam last ASKED FOR is not what the
 * session is on -- the operator can type `/model opus` in the pane themselves,
 * a CLI can refuse, and a session vam resumed was started by somebody else
 * entirely. A button wearing a remembered choice would be a claim nothing
 * checked, which is why the button was labelled "model" and nothing else.
 *
 * IT DOES NOT HAVE TO BE A GUESS, and the measurement is the whole of this
 * module's licence to exist. Claude Code 2.1.276 paints a PERSISTENT footer,
 * second-to-last line of the pane:
 *
 *     ▐▛███▛█   Claude Code v2.1.276          <- the banner, which scrolls away
 *    ▝▜██████▀  Sonnet 5 with xhigh effort · Claude API
 *     ...
 *     ────────────────────────────────────────
 *     ❯
 *     ────────────────────────────────────────
 *       wd1 Sonnet 5 ctx:95% in:54.9k out:272  <- this line, always on screen
 *       ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents
 *
 * `<dir> <Model> <Version> [ctx:NN%] in:<x> out:<y>`, and vam already captures
 * this pane (`sources/tmux/spawn.ts`). The screens the rule below was written
 * against are in `test/main/terminal/model-status-screens.ts`, captured from a
 * real CLI over a private tmux socket.
 *
 * WHAT IT CANNOT TELL, stated here because the UI above it must not pretend
 * otherwise. `/model default` and `/model sonnet` produce the SAME line --
 * both were driven and both printed `wd1 Sonnet 5 in:0 out:0`, while the CLI's
 * own menu ticks the one that was actually chosen. The status line carries the
 * MODEL, never which alias selected it, and `model-command.ts` says what the
 * picker does with that.
 */

import type { SessionModel } from '../../shared/terminal.js';
import { listVamSessions, readPane, type TmuxRun } from '../sources/tmux/spawn.js';
import { targetSession } from './pane.js';
import { plain } from './plain.js';

/**
 * How far up from the bottom of the screen the footer may be looked for.
 *
 * IT IS A WINDOW AND NOT THE WHOLE SCREEN, because the shape below is not
 * rare enough to be safe anywhere on a pane: a session printing a captured
 * status line into its own transcript -- which is how this module was
 * written, and what this repo's agents do all day -- would hand a reader a
 * perfect match twenty lines above the real one. The footer is the bottom of
 * the screen by construction, so the search is bounded to the bottom.
 *
 * FIVE NON-BLANK LINES, counted after blanks are dropped: the footer is the
 * second-to-last line on every capture taken, and the slack is for a CLI that
 * adds a hint line under the mode line. Blanks are skipped rather than
 * counted because `capture-pane` returns the whole pane, so a screen the CLI
 * has not filled ends in them.
 */
const STATUS_TAIL_LINES = 5;

/** A `key:value` field of the footer -- `ctx:95%`, `in:54.9k`, `out:272`. */
const FIELD = /^[A-Za-z]+:\S*$/;

/**
 * A version: digits, and dots between them. `5`, `5.1`, `4.5` -- measured
 * values, and the shape that separates a version from the directory name and
 * from the `…` a cut line ends in.
 */
const VERSION = /^\d+(?:\.\d+)*$/;

/**
 * A model's name: starts with a letter, carries no whitespace and NO ELLIPSIS.
 *
 * The ellipsis is the load-bearing half. tmux gives the CLI a fixed width and
 * the CLI cuts its own line to fit, so at 16 columns the footer reads
 * `wd1 Sonnet …` and at 24 `wd1 Sonnet 5 in:0 o…`. A name cut in the middle
 * is still a plausible-looking word (`Son…`), and a reader that took it would
 * put a model on the button that nothing is running.
 */
const NAME = /^[A-Za-z][^\s…]*$/;

/**
 * The model the CLI says this screen's session is on, or `null` for "vam
 * could not tell".
 *
 * NULL IS A VALUE HERE AND NOT AN ERROR, and it is the commonest answer there
 * is. Measured: a permission prompt, the CLI's own `/model` menu and the trust
 * prompt each REPLACE the footer while they are open, a narrow pane cuts it,
 * a pane running a shell never had one, and a CLI that redesigns its status
 * line will not match this shape. All of them land here, and the surface above
 * draws what it drew before rather than a name it invented.
 *
 * THE LINE IS MATCHED WHOLE, from the tail inwards:
 *
 *   - it must END with `in:<x> out:<y>`, which is the proof the CLI did not
 *     cut it -- everything vam reads sits to the LEFT of that tail, so a line
 *     carrying it is a line that fitted;
 *   - the model is the two tokens before the first `key:value` field, not a
 *     count from either end: `ctx:` appears only after the session's first
 *     turn, so a fixed offset reads one thing on a fresh session and another
 *     on a used one;
 *   - taking the LAST two of those tokens rather than the first is what keeps
 *     a directory with a space in its name (`my notes Opus 5 in:0 out:0`) from
 *     being read as the model;
 *   - and there must be at least one token in front of them, because the
 *     directory is always there and a footer without one is not this footer.
 *
 * NO VOCABULARY OF MODEL NAMES is consulted, deliberately. `MODEL_CHOICES` is
 * a UI table that goes stale by design (`model-command.ts`), and a parser that
 * only believed the five aliases would answer "I cannot tell" on the day the
 * CLI shipped the sixth -- exactly when the operator most needs to be told
 * what they are running. The shape is the check.
 */
export function readModelLine(text: string): string | null {
  const lines = plain(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  for (const line of lines.slice(-STATUS_TAIL_LINES).reverse()) {
    const name = modelOnLine(line);
    if (name !== null) return name;
  }
  return null;
}

function modelOnLine(line: string): string | null {
  const tokens = line.split(/\s+/);
  const out = tokens.at(-1) ?? '';
  const into = tokens.at(-2) ?? '';
  // The tail, in the order every capture shows it. `in:` sits immediately
  // before `out:`; a field between them would mean the footer has been
  // rearranged, and a rearranged footer is the case this must not read
  // confidently.
  if (!/^in:\S+$/.test(into) || !/^out:\S+$/.test(out)) return null;
  // WHERE THE FIELDS BEGIN, and `-1` is checked rather than passed on: a
  // `findIndex` that found nothing would be handed to `slice` as "up to the
  // last element", which silently drops one token and reads a model out of a
  // line that has no fields at all. The tail above already makes that
  // impossible; a second reader would not know that, and this is the line
  // they would have to know it from.
  const fields = tokens.findIndex((token) => FIELD.test(token));
  if (fields < 0) return null;
  const head = tokens.slice(0, fields);
  const version = head.at(-1) ?? '';
  const name = head.at(-2) ?? '';
  // Three tokens at least: a directory, a name and a version. Two would be a
  // footer with no directory, which no capture has ever shown.
  if (head.length < 3 || !VERSION.test(version) || !NAME.test(name)) return null;
  return `${name} ${version}`;
}

/**
 * The model of the session a row is in -- the pane resolved by the SAME
 * `targetSession` rule the read, the resize, the keystroke and the answer use.
 *
 * A READ, so it is safe to poll: nothing here presses a key. It is aimed by
 * that one rule rather than a second opinion for the reason `readSessionPrompt`
 * beside it is -- a model read out of the wrong pane would be drawn on this
 * row's button, which is a sentence about somebody else's session wearing this
 * one's name.
 *
 * EVERY REFUSAL IS THE SAME ANSWER, and that is a decision rather than an
 * omission. `unaimed`, `mispaired`, a tmux that would not answer and a screen
 * with no footer on it are four different facts, and the pane channel next
 * door keeps them apart because the Terminal tab draws a different sentence
 * for each. This one has a single consumer -- a button label -- which draws
 * exactly one thing for all four: the word it wore before vam could read
 * anything. A second kind here would be a distinction no surface makes.
 */
export async function readSessionModel(
  run: TmuxRun,
  projectId: string,
  rowId?: string,
  panes?: ReadonlyMap<string, string>,
): Promise<SessionModel> {
  const listed = await listVamSessions(run);
  if (listed.kind === 'unavailable') return { kind: 'unknown' };
  const match = targetSession(listed.sessions, projectId, rowId, panes);
  if (match.kind !== 'one') return { kind: 'unknown' };
  // The SCREEN and only the screen: no history is asked for, the way the
  // prompt reader asks for none. The footer is on the screen by definition,
  // and scrollback would be a thousand lines of transcript for a reader that
  // looks at five.
  const pane = await readPane(run, match.name);
  if (pane.kind !== 'ok') return { kind: 'unknown' };
  const name = readModelLine(pane.text);
  return name === null ? { kind: 'unknown' } : { kind: 'model', name };
}
