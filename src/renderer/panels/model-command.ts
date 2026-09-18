/**
 * The model control's decision table, and the keystrokes its enabled state
 * types. Pure: no React, no bridge, so the table and the line can be asserted
 * row by row without mounting the pane.
 *
 * WHY THERE ARE THREE STATES AND NOT ONE FIELD. The composer's model control
 * was a free-text input writing `model: <text>` onto the draft's first line,
 * under a note reading "vam cannot switch models -- the factory chooses". That
 * sentence was true of the RECORDING source, where the prompt is filed in a
 * log and the factory picks the model: the request in words is the honest
 * thing, and it stays (`setModelRequest`'s own comment in `DetailPanel.tsx`).
 * It stopped being true of Claude Code at PR 383: a prompt is TYPED into the
 * session's tmux pane (`main/sources/claude-code/reply.ts`), so `model: opus`
 * lands in the CLI's prompt as words the agent reads, and switches nothing.
 *
 * WHAT DOES SWITCH IT, measured on Claude Code 2.1.274 on this machine:
 * typing `/model sonnet` and Enter into the REPL answers "Set model to Sonnet 5
 * and saved as your default for new sessions", and the status line changes at
 * once. `/model default` answers the same for the default. A BARE `/model`
 * opens an interactive menu (Default · Sonnet · Fable · Opus · Haiku, "Enter to
 * set as default · s to use this session only · Esc to cancel") -- vam never
 * drives that menu, because it cannot read it back; it sends the argument form
 * and nothing else. `claude --help` says `--model` takes "an alias for the
 * latest model (e.g. 'fable', 'opus', or 'sonnet') or a model's full name",
 * which is why the picker offers the five aliases AND a free-text row for a
 * full id.
 *
 * SO THE TABLE IS:
 *
 *   delivers   terminal       vamControlled   state
 *   ---------  -------------  --------------  ----------------------------
 *   not true   any            any             `request`  -- the free-text
 *                                             line and its note, unchanged:
 *                                             nothing vam types reaches an
 *                                             agent on this source.
 *   true       !== false      true            `picker`   -- vam can type
 *                                             `/model <x>` + Enter into the
 *                                             pane it started.
 *   true       false          any             `disabled` -- the source
 *                                             delivers but has no pane
 *                                             surface here.
 *   true       !== false      not true        `disabled` -- a session vam
 *                                             did not start: its TTY is
 *                                             somebody else's.
 *
 * `delivers` is `SourceCapabilities.deliverPrompt`, read the way the submit
 * button reads it: absent means nobody has said, and understating what a
 * control does is the safe direction. `terminal` and `vamControlled` are the
 * two facts `canCycleMode` reads, read the same way -- absent `terminal` is
 * "nobody withdrew it", which is how the Terminal tab reads its own absence.
 *
 * DISABLED, NOT ABSENT, and that is the one place this differs from the mode
 * chip beside it. The mode chip is ABSENT where no mode can be chosen, on the
 * argument that a dimmed switcher still says a mode is choosable here. The
 * operator has asked for the model control to be DISABLED instead, and the
 * difference is real: a mode is a property of vam's prompt (the draft carries
 * it), so where vam cannot set one there is nothing to show; a model is a
 * property of the SESSION, which has one whether or not vam can reach it, and
 * a button that is there-but-greyed says exactly that -- there is a model,
 * and vam has no keyboard into this session to change it. The note on the
 * disabled control carries the remedy.
 */

import type { PaneKey } from '../../shared/terminal.js';
import { composedStrokes } from './terminal-compose.js';

/** The three faces the control can wear; see the table above. */
export type ModelControlState = 'request' | 'picker' | 'disabled';

export function modelControlState(input: {
  readonly delivers: boolean | undefined;
  readonly terminal: boolean | undefined;
  readonly vamControlled: boolean | undefined;
}): ModelControlState {
  if (input.delivers !== true) return 'request';
  if (input.terminal !== false && input.vamControlled === true) return 'picker';
  return 'disabled';
}

/**
 * The CLI's own five, in the order its own menu prints them. `id` is what is
 * typed after `/model `; `label` is the menu's word for it. A list rather than
 * something derived, because the CLI is the authority and this is a copy of
 * what it printed on 2.1.274.
 */
export const MODEL_CHOICES: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'fable', label: 'Fable' },
  { id: 'opus', label: 'Opus' },
  { id: 'haiku', label: 'Haiku' },
];

/**
 * A choice is one word: an alias or a full model id, neither of which carries
 * whitespace. Anything else is refused BEFORE a key is built, because the two
 * things whitespace can be are both wrong on the wire -- a space hands the CLI
 * a second argument, and a newline in a literal payload reaches the pane as
 * 0x0a, which the REPL submits on (`tmux/argv.ts`): `/model` would go in bare,
 * opening the menu, and the rest would be typed into it. Control characters
 * are refused for the same reason `sendTextArgv` types with `-l`: the line is
 * text, never keys.
 */
const ONE_WORD = /^[^\s\p{Cc}]+$/u;

/** `/model <choice>`, or `null` when the choice is not one word. */
export function modelCommandLine(choice: string): string | null {
  const word = choice.trim();
  if (!ONE_WORD.test(word)) return null;
  return `/model ${word}`;
}

/**
 * The strokes that type the line and submit it: the text in pieces the channel
 * accepts, then ONE interpreted Enter, last.
 *
 * SPLIT, NOT WIDENED. `/model ` plus a full model id runs past `MAX_KEY_TEXT`,
 * the sixteen-character bound `shared/terminal.ts` puts on a `text` key so the
 * channel cannot become an unbounded paste. Handed over whole it would fail
 * `isPaneKey` in main, which answers `unaimed` -- drawn as a sentence about
 * session PAIRING that would be false. `composedStrokes` was written for an IME
 * commit that has the same shape (one string, longer than a keystroke) and it
 * is used unchanged: each piece is its own `send-keys -l --`, sent in order on
 * the same aimed channel, and the pane receives the bytes of one line.
 *
 * THE ENTER IS SEPARATE AND LAST, for the reason `promptKeystrokes` keeps it
 * out of the text: `-l` types and forbids interpretation, so Return has to be
 * its own key; and it comes after every piece so a run that fails midway
 * leaves the line sitting in the pane unsent rather than half-submitted.
 */
export function modelCommandStrokes(choice: string): readonly PaneKey[] | null {
  const line = modelCommandLine(choice);
  if (line === null) return null;
  return [...composedStrokes(line), { kind: 'enter' }];
}
