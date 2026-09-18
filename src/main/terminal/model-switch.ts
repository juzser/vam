/**
 * Switching a session's model by DRIVING THE CLI'S OWN MENU -- open it, prove
 * it is taking keys, walk the cursor onto the row that names the alias, and
 * press `s`, which is the key that keeps the change to this session.
 *
 * THE ROUTE THIS REPLACES WAS MEASURED AND IT REWRITES THE OPERATOR'S
 * SETTINGS. vam typed `/model <alias>` and Return into the pane. On Claude
 * Code 2.1.276 that form answers:
 *
 *     ⎿  Set model to Opus 5 and saved as your default for new sessions
 *
 * and the CLI's own menu header says the same thing in advance -- `Switch
 * between Claude models. Your pick becomes the default for new sessions.` So
 * every model pick in vam silently rewrote `~/.claude/settings.json`, from a
 * control the operator reached for to change ONE session. Nobody asked for
 * that, and nothing on the surface said it had happened.
 *
 * THE ROUTE THAT DOES NOT, measured on the same CLI over a private tmux socket
 * in a throwaway directory. A bare `/model` opens a menu:
 *
 *       1. Default (recommended)  Sonnet 5 · Efficient for routine tasks
 *       2. Sonnet                 Sonnet 5 · Efficient for routine tasks
 *       3. Fable                  Fable 5.1 · Most capable for your hardest…
 *     ❯ 4. Opus ✔                 Opus 5 · Best for everyday, complex tasks
 *       5. Haiku                  Haiku 4.5 · Fastest for quick answers
 *     Enter to set as default · s to use this session only · Esc to cancel
 *
 * `send-keys Down` moved the cursor from row 4 to row 5; `send-keys -l -- 's'`
 * then answered `Set model to Haiku 4.5 for this session only`, and
 * `~/.claude/settings.json` was byte-identical afterwards -- same sha256, same
 * mtime. The captures are in `test/main/terminal/model-menu-screens.ts`.
 *
 * SO RETURN IS THE ONE KEY THIS MODULE MAY NEVER PRESS ON A MENU. It presses
 * exactly one, the one that OPENS the menu, and `s` is literal text at the end.
 *
 * IT INHERITS `answer.ts`'s RULES RATHER THAN RESTATING THEM, and reuses its
 * reader: nothing here presses a key on a row it has not just read, and
 * POSITIONS ARE NEVER COUNTED -- the cursor is walked until the row it is ON
 * reads as the alias asked for. A menu that renders in another order than this
 * file expects would otherwise switch a session to a model nobody chose, with
 * total confidence. `deliver()` itself is NOT reused: its `see` demands the
 * question text above the rows and refuses the CLI's review screen, and the
 * model menu has neither -- its heading is `Select model` and there is no
 * review at all.
 *
 * THE PROBE IS WHY THIS IS SAFE AT ALL. One arrow, then read again: a menu
 * whose cursor does not move is not taking keys, and an `s` pressed into that
 * state lands on whatever row was already under the cursor. That is the
 * Crimson failure `answer.ts` documents, wearing this control's face -- and
 * here it would switch the session to a model the operator did not pick and
 * report success.
 *
 * AND EVERY REFUSAL AFTER THE MENU IS ASKED FOR PRESSES ESCAPE. Leaving the
 * CLI's own menu open in the operator's session -- with the keyboard captured
 * and the next thing they type going into it -- is not an acceptable failure
 * state. Measured: `Escape` closes it and changes nothing.
 */

import { isModelChoice, type ModelSwitchResult } from '../../shared/terminal.js';
import { sendDownArgv, sendEnterArgv, sendEscapeArgv, sendTextArgv } from '../sources/tmux/argv.js';
import { listVamSessions, readPane, type TmuxRun } from '../sources/tmux/spawn.js';
import { type Picker, readPicker, readPrompt } from './answer.js';
import { targetSession } from './pane.js';
import { plain } from './plain.js';

/**
 * The five rows the CLI's own menu prints, and the alias each is reached by.
 *
 * A COPY OF WHAT THE CLI PRINTED, deliberately, and not an import of the
 * renderer's `MODEL_CHOICES`. That table is a UI label table -- it carries
 * each alias's VERSION so the popover can print it, and its own note says
 * those numbers go stale by design. This is a fact about what vam TYPES INTO
 * SOMEBODY'S PANE, decided in main, and main does not take the least trusted
 * process's word for the shape of the keyboard it drives.
 *
 * `name` IS THE HEAD OF THE ROW'S LABEL, not the whole of it: the captured
 * label for row four is `Opus ✔                 Opus 5 · Best for everyday,
 * complex tasks`, because `answer.ts`'s `ROW` takes the whole rest of the
 * line. So a row is matched by its leading name -- see `rowNamed`.
 *
 * Captured from Claude Code 2.1.276 on 2026-09-18.
 */
const MENU_ROWS: readonly { readonly id: string; readonly name: string }[] = [
  { id: 'default', name: 'Default' },
  { id: 'sonnet', name: 'Sonnet' },
  { id: 'fable', name: 'Fable' },
  { id: 'opus', name: 'Opus' },
  { id: 'haiku', name: 'Haiku' },
];

/**
 * The menu row an alias names, or `null` for a choice that has no row.
 *
 * `null` IS THE COMMON, CORRECT ANSWER for a full model id -- the free-text
 * row of vam's own picker exists because `claude --help` says `--model` takes
 * "an alias for the latest model ... or a model's full name", and the CLI's
 * menu offers only the five aliases. There is no row to walk onto for
 * `claude-opus-5-20260501`, so that choice takes the argument form and the
 * caller DISCLOSES that the CLI made it the default too.
 */
export function menuRowName(choice: string): string | null {
  const id = choice.trim().toLowerCase();
  return MENU_ROWS.find((row) => row.id === id)?.name ?? null;
}

/**
 * Whether a parsed row label is the row for `name`.
 *
 * A PREFIX, ON A BOUNDARY, and both halves are load-bearing.
 *
 * It is a PREFIX because the label is the whole rest of the line, description
 * and all. It is not `includes`, and the real capture is the falsification:
 * row one reads `Default (recommended)  Sonnet 5 · Efficient for routine
 * tasks`, so `includes('Sonnet')` answers TRUE on the Default row and vam
 * would press `s` there -- switching the session to whatever Default currently
 * resolves to, while reporting the operator's choice of Sonnet.
 *
 * And the boundary is what keeps `Sonnet` from answering for a `SonnetLite`
 * the CLI has not shipped yet. `\b` alone would not do it: `-` is not a word
 * character, so `^Sonnet\b` matches `Sonnet-Lite`. The lookahead names the
 * characters a longer name could continue with.
 */
export function rowNamed(label: string, name: string): boolean {
  if (!label.startsWith(name)) return false;
  return !/[A-Za-z0-9_-]/.test(label.charAt(name.length));
}

const cursorLabel = (picker: Picker): string => picker.rows[picker.cursor]?.label ?? '';

/**
 * Switch the model of the session a row is in, to `choice`.
 *
 * Aimed by `targetSession` -- the SAME rule the read, the resize, the
 * keystroke, the answer and the model read use, and deliberately not a second
 * opinion about whose terminal this is. Its refusals are kept apart in the
 * same words for the same reason: `mispaired` is a row that published a pane
 * vam rejected, and it may never fall through to the project tag, which would
 * change the model of a session this row was never in.
 */
export async function switchSessionModel(
  run: TmuxRun,
  projectId: string,
  choice: string,
  rowId?: string,
  panes?: ReadonlyMap<string, string>,
): Promise<ModelSwitchResult> {
  // CHECKED AGAIN HERE, not because the channel does not check it, but
  // because this function is the thing that types: a choice with a space in
  // it hands the CLI a second argument, and one with a newline submits
  // `/model` bare and types the rest into the menu that opens.
  if (!isModelChoice(choice)) return { kind: 'unaimed' };

  const listed = await listVamSessions(run);
  // vam could not look, so it cannot claim a pairing problem either.
  if (listed.kind === 'unavailable') return { kind: 'unavailable' };
  const match = targetSession(listed.sessions, projectId, rowId, panes);
  if (match.kind === 'mispaired') return { kind: 'mispaired' };
  if (match.kind !== 'one') return { kind: 'unaimed' };
  const name = match.name;

  /** The screen, or `null` when vam could not read it. Never a guess. */
  const read = async (): Promise<string | null> => {
    const pane = await readPane(run, name);
    return pane.kind === 'ok' ? plain(pane.text) : null;
  };
  const press = async (argv: readonly string[]): Promise<boolean> =>
    (await run(argv)).failure === null;
  /** Close the menu, then refuse. Never the other way round. */
  const closing = async (result: ModelSwitchResult): Promise<ModelSwitchResult> => {
    await press(sendEscapeArgv(name));
    return result;
  };

  /*
    READ THE SCREEN BEFORE TYPING INTO IT, and refuse a pane that already has
    a picker on it.

    MEASURED, against a real Claude Code 2.1.276. With the CLI's own `/model`
    menu already open, typing `/model haiku` and Return did NOT switch to
    Haiku: the menu has no text buffer, so the literal text was swallowed
    whole, and the Return behind it COMMITTED WHICHEVER ROW THE CURSOR SAT ON.

        ⎿  Set model to Opus 5 and saved as your default for new sessions

    Opus was not asked for; it was merely under the cursor. That is the
    harmless version. The same shape with a PERMISSION prompt on screen means
    vam's Return answers a question about somebody's files.

    IT IS A READ AND NOT A LOCK, said plainly because the gap is real: the pane
    is asked, then typed into, and a question that appears between the two is
    not caught. There is no tmux primitive that would close that gap --
    `answer.ts` re-reads between every step for the same reason and still
    cannot -- and the window it leaves is a fraction of the one it removes.
  */
  const before = await read();
  // vam has not looked, so it will not type. Nothing has been sent.
  if (before === null) return { kind: 'unreadable' };
  if (readPicker(before) !== null) {
    // The line above the rows, which is the question itself for a permission
    // prompt. A menu with nothing above its rows leaves this empty rather
    // than inventing one, and the caption has a sentence for that.
    return { kind: 'question', title: readPrompt(before)?.title ?? '' };
  }

  const row = menuRowName(choice);
  if (row === null) {
    /*
      NO MENU ROW EXISTS FOR A FULL MODEL ID, so this cannot be walked to. The
      argument form is the only route the CLI offers -- and it is the route
      that ALSO writes the operator's default, which is why the answer says
      `default` out loud rather than passing for the honest one.

      Typed whole, in one `send-keys -l --`: the renderer used to cut this
      into sixteen-character pieces to satisfy `MAX_KEY_TEXT`, a bound that
      belongs to the one-keystroke channel and has nothing to do with a line
      main types itself. The Return is separate and LAST, so a line that fails
      to go in is never submitted half-written.
    */
    if (!(await press(sendTextArgv(name, `/model ${choice}`)))) return { kind: 'refused' };
    if (!(await press(sendEnterArgv(name)))) return { kind: 'refused' };
    return { kind: 'sent', scope: 'default' };
  }

  // THE ONE RETURN THIS MODULE PRESSES. It opens the menu; every key after it
  // is an arrow or the letter `s`.
  if (!(await press(sendTextArgv(name, '/model')))) return { kind: 'refused' };
  if (!(await press(sendEnterArgv(name)))) return { kind: 'refused' };

  /*
    IS THE MENU THERE. `no-menu` covers both "vam looked and there was none"
    and "vam could not look", because the operator's next step is the same for
    both and the honest sentence is the same: the `/model` line may have
    reached the agent as a PROMPT. That is exactly what happens when the REPL
    was busy -- the text goes into the input and the Return submits it -- and
    a refusal that claimed nothing was sent would be a claim vam cannot make.
  */
  const opened = await read();
  const first = opened === null ? null : readPicker(opened);
  if (first === null) return closing({ kind: 'no-menu' });

  // THE PROBE. One arrow, then read again.
  if (!(await press(sendDownArgv(name)))) return closing({ kind: 'refused' });
  const probed = await read();
  if (probed === null) return closing({ kind: 'unreadable' });
  const probe = readPicker(probed);
  // The menu left the screen under vam's own arrow: it is not a menu to press
  // a key on, and it is not the `no-menu` above -- vam DID open one.
  if (probe === null) return closing({ kind: 'not-live' });
  if (probe.cursor === first.cursor && cursorLabel(probe) === cursorLabel(first)) {
    return closing({ kind: 'not-live' });
  }

  // THE WALK. One pass of the rows at most: the menu wraps -- measured, Down
  // from row 5 lands on row 1 -- so every row is reachable by stepping down,
  // and the bound is what stops a menu that answers oddly from being walked
  // forever in somebody's running agent.
  let view = probe;
  for (let at = 0; at <= view.rows.length; at += 1) {
    if (rowNamed(cursorLabel(view), row)) {
      // `s`, AS LITERAL TEXT. `send-keys -l -- 's'` is what was measured;
      // without `-l` tmux looks `s` up as a key name.
      if (!(await press(sendTextArgv(name, 's')))) return closing({ kind: 'refused' });
      return { kind: 'sent', scope: 'session' };
    }
    if (!(await press(sendDownArgv(name)))) return closing({ kind: 'refused' });
    const text = await read();
    if (text === null) return closing({ kind: 'unreadable' });
    const next = readPicker(text);
    if (next === null) return closing({ kind: 'not-live' });
    view = next;
  }
  return closing({ kind: 'unmatched', label: row });
}
