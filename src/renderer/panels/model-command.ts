/**
 * The model control's decision table, its five rows, and the line its caption
 * prints. Pure: no React, no bridge, so the table and the line can be asserted
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
 * set as default · s to use this session only · Esc to cancel" -- both still
 * word for word on 2.1.276, re-captured with the versions below).
 *
 * VAM DRIVES THAT MENU NOW, and this header used to say it never would. The
 * reason given was that vam could not read it back -- which stopped being true
 * when `main/terminal/answer.ts` learned to read a picker off a capture, and
 * the cost of not driving it was the second half of the sentence above: EVERY
 * model pick rewrote `~/.claude/settings.json`. `main/terminal/model-switch.ts`
 * owns the whole route, in main, where `answer.ts`'s rules already live; this
 * module keeps the TABLE the popover draws, and types nothing at all.
 *
 * AND THE TABLE IS THE WHOLE OFFER NOW -- five rows, no sixth. `claude --help`
 * says `--model` takes "an alias for the latest model (e.g. 'fable', 'opus',
 * or 'sonnet') or a model's full name", and the picker used to carry a
 * free-text row for that second half. But a full name has NO ROW on the CLI's
 * own menu, so it could only go in as `/model <id>` + Return -- the form that
 * also saves it as the operator's default. vam disclosed that cost and took
 * the route anyway; offered the fallback or an outright refusal, the operator
 * chose refusal. The row is gone, main answers `not-in-menu` having typed
 * nothing, and the one-word rule that lived here is `isModelChoice` in
 * `shared/terminal.ts` alone -- see the comment where the builder used to be.
 *
 * SO THE TABLE IS:
 *
 *   delivers   terminal       vamControlled   state
 *   ---------  -------------  --------------  ----------------------------
 *   not true   any            any             `request`  -- the free-text
 *                                             line and its note, unchanged:
 *                                             nothing vam types reaches an
 *                                             agent on this source.
 *   true       !== false      true            `picker`   -- vam can drive
 *                                             the CLI's own /model menu in
 *                                             the pane it started.
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
 * typed after `/model `; `label` is the menu's word for it; `version` is the
 * number its right-hand column prints beside that word. A list rather than
 * something derived, because the CLI is the authority and this is a COPY of
 * what it printed.
 *
 * THIS COPY IS FROM CLAUDE CODE 2.1.276, TAKEN 2026-09-18 -- `claude` in an
 * empty directory over a private tmux socket, a bare `/model`, `capture-pane`:
 *
 *     ❯ 1. Default (recommended) ✔  Sonnet 5 · Efficient for routine tasks
 *       2. Sonnet                   Sonnet 5 · Efficient for routine tasks
 *       3. Fable                    Fable 5.1 · Most capable for your hardest…
 *       4. Opus                     Opus 5 · Best for everyday, complex tasks
 *       5. Haiku                    Haiku 4.5 · Fastest for quick answers
 *
 * AND THESE STRINGS GO STALE BY DESIGN. Every one of them is a fact about the
 * CLI on the day above, and vam has no way to check any of them: it never
 * reads a session's model back, and `claude --help` says each id is "an alias
 * for the LATEST model" -- so what `/model opus` SENDS stays correct forever
 * while what this table PRINTS beside it goes wrong the day Anthropic ships
 * the next Opus. The date and the version above are the whole remedy: whoever
 * next finds a number here that disagrees with the CLI should re-capture all
 * five and move the date, not patch the one that was noticed. The labels have
 * carried this habit since 2.1.274; the versions join it.
 *
 * THE MEASUREMENT OVERRULED THE REQUEST, which is why it was taken. The ask
 * arrived as "for example Opus has version 5.1"; the menu says Opus is 5 and
 * FABLE is 5.1. The capture is the authority here, not the recollection.
 *
 * `default` CARRIES A NAME AND NOT A BARE NUMBER because it has no version of
 * its own -- it is whichever model the CLI currently recommends, and its own
 * right-hand column says "Sonnet 5" for exactly that reason. "Default 5" would
 * be a version of a thing that has none.
 */
export const MODEL_CHOICES: readonly {
  readonly id: string;
  readonly label: string;
  readonly version: string;
}[] = [
  { id: 'default', label: 'Default', version: 'Sonnet 5' },
  { id: 'sonnet', label: 'Sonnet', version: '5' },
  { id: 'fable', label: 'Fable', version: '5.1' },
  { id: 'opus', label: 'Opus', version: '5' },
  { id: 'haiku', label: 'Haiku', version: '4.5' },
];

/**
 * THE MODEL A ROW WOULD PUT ON THE STATUS LINE, in the CLI's own words.
 *
 * `Sonnet` + `5` is what the footer prints as `Sonnet 5`; `Default` has no
 * version of its own and its column already carries the full name of the model
 * it resolves to, so it IS that string. Both halves come out of the table the
 * popover draws, which is the point: the name matched against the pane is the
 * name the operator is reading in the row.
 */
const runningName = (choice: (typeof MODEL_CHOICES)[number]): string =>
  choice.id === 'default' ? choice.version : `${choice.label} ${choice.version}`;

/**
 * WHICH ROWS OF THE PICKER THE SESSION'S OWN MODEL MARKS -- the ids, in the
 * CLI's menu order, of every row whose model is the one `running` names.
 *
 * `running` is the string the CLI painted on its status line and vam read back
 * (`main/terminal/model.ts`), or `null` for the many screens that do not carry
 * one. It is NOT what vam last typed: a remembered choice is the claim this
 * whole control was written to avoid.
 *
 * WHAT THE MARK MEANS, and it is not "selected". It means THIS ROW'S MODEL IS
 * WHAT THE SESSION IS RUNNING, which is a fact about the model and not about
 * the CLI's own menu cursor -- and the difference is load-bearing, because the
 * two cannot be told apart from the pane:
 *
 *     /model default   ->  Set model to Sonnet 5 (default) and saved as ...
 *     /model sonnet    ->  Set model to Sonnet 5 and saved as ...
 *     both, after      ->  `  wd1 Sonnet 5 in:0 out:0`
 *
 * Measured on 2.1.276: the two commands leave the SAME footer, while the CLI's
 * own `/model` menu ticks whichever of them was used. The CLI knows which
 * alias is selected, the status line does not carry it, and vam has nothing
 * else to read. So on `Sonnet 5` this answers BOTH rows -- which is what vam
 * can defend, since Default's own column says it IS Sonnet 5, so the model in
 * the pane is both rows' model. Picking one of the two would be right half the
 * time and wrong the other half, with nothing on screen to say which.
 *
 * A MISS IS AN ANSWER TOO. `Sonnet 4.5` (a session switched to a full model
 * id), `Opus 6` (the day the CLI ships it, before anyone re-captures the table
 * above) and a name vam has never heard of all mark nothing: the button still
 * SAYS the name, and no row claims to be it. A tick on `Sonnet` for a session
 * running Sonnet 4.5 would be a lie the operator could act on -- that row
 * sends `/model sonnet`, which would change the model.
 */
export function runningModelRows(running: string | null): readonly string[] {
  if (running === null) return [];
  return MODEL_CHOICES.filter((choice) => runningName(choice) === running).map(
    (choice) => choice.id,
  );
}

/**
 * WHAT THE MODEL BUTTON SAYS: the model this session is running, or the word
 * the control has always worn when vam cannot tell.
 *
 * THE FALLBACK IS THE OLD LABEL AND NOT A GUESS. The button was labelled
 * `model` precisely because vam held no fact about the session's model; when
 * the pane does not carry one -- a question is open, the CLI's own menu is up,
 * the line is cut -- vam is back in exactly that position and says exactly
 * what it said then. The one thing that may never appear here is a name no
 * pane reported.
 */
export function modelButtonLabel(running: string | null): string {
  return running ?? 'model';
}

/*
  NO BUILDER FOR `/model <choice>` LIVES HERE ANY MORE, and the absence is the
  point.

  TWO WENT, ONE AT A TIME. `modelCommandStrokes` cut the line into
  sixteen-character `PaneKey`s for `terminal.send`, and `/model <alias>` +
  Return is exactly the form the CLI answers with "and saved as your default
  for new sessions" -- so every pick rewrote `~/.claude/settings.json`. That
  one went when main took over the route and drove the CLI's own menu instead
  (`main/terminal/model-switch.ts`). `modelCommandLine` outlived it by one
  change: main still typed the argument form for the one choice with no menu
  row, a full model id, and the renderer still printed that line in the
  caption while refusing a choice that was not one word.

  BOTH OF THOSE REASONS ARE GONE. The operator chose refusal over the
  fallback, so main types the argument form for nothing at all; with the
  free-text row removed with it, every choice the picker can send is one of
  `MODEL_CHOICES`' own ids, so no input exists that the one-word rule could
  refuse. The rule itself did not move -- `isModelChoice` in
  `shared/terminal.ts` enforces it on whatever crosses the bridge, which is
  where enforcement belonged. What is left here is the decision table, the
  five rows the popover draws, and the label the button wears.

  AND IT IS NOT LEFT LYING ABOUT, deliberately: a renderer-side way to spell
  the line that costs somebody their default is a loaded gun, and the next
  hand to need "just the string" would find it already written.
*/
