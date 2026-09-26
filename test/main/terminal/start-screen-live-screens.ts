/**
 * Screens captured from the REAL `claude` (v2.1.282) and `codex` (v0.157.0)
 * CLIs, pasted in unaltered (`-e`, escape sequences intact -- exactly what
 * `capturePaneArgv` asks tmux for). Both were driven on a private `-L` tmux
 * socket, in scratch directories created, driven and killed inside the task
 * that added this file. No paid prompt was ever sent to either -- both are
 * screens the CLI draws before a first message would even be possible, and
 * the operator's own session was never named or sent a key.
 *
 * WHAT THESE PROVE, and none of it was guessed:
 *
 *  - `claude`'s trust dialog carries NO option numbers at all -- `❯ No, exit`
 *    / `  Yes, I trust this folder` -- while `codex`'s is a numbered picker
 *    (`readPicker`'s own shape, `terminal/answer.ts`). A detector keyed to
 *    one shape misses the other; `start-screen.ts` matches on the option
 *    LABEL text instead, which both carry.
 *  - `pane_current_command` during EITHER dialog, and on `claude`'s own ready
 *    screen, is the bare version string (`2.1.282`), never the word `claude`
 *    -- measured with `tmux display-message -p '#{pane_current_command}'`
 *    against the real process. `codex` reports `codex` faithfully; only
 *    Claude Code has this quirk.
 *  - neither dialog appears in `claude agents --json --all` at all -- the
 *    live-agent list vam's own poll already uses -- until it is answered:
 *    measured continuously across 36+ seconds of a real trust dialog sitting
 *    unanswered. That is cause (1) the task this file was added for names.
 *  - `claude`'s trust dialog carries an OSC-8 hyperlink (`Security guide`)
 *    that `plain()`'s CSI-only regex does NOT strip -- `CLAUDE_TRUST` below
 *    keeps that leftover on purpose, so the detector is proven against it
 *    rather than against text `plain()` was never actually asked to clean.
 *  - `CLAUDE_TRUST_NARROW` is the identical dialog at a real 40-column width:
 *    the prose wraps (`Is this a project` / `you created or one you
 *    trust?`), but the option LABELS -- what the detector actually keys on --
 *    stay on one line each, which is why the detector matches per-line
 *    rather than joining the whole screen into one string first.
 *  - `CLAUDE_TRUST` and `CLAUDE_TRUST_CURSOR_ON_YES` differ ONLY in which
 *    option line carries the cursor markup -- measured by sending one `Down`
 *    against the real dialog and re-capturing -- which is what proves the
 *    detector reads the LABEL text rather than assuming a fixed default
 *    cursor position.
 *
 * Paths are replaced with a generic placeholder; nothing else is touched.
 * There is no real path, session id or machine name in any of them.
 */

const RULE104 = '─'.repeat(104);
const RULE40 = '─'.repeat(40);

const TRUST_HEADER =
  '\u001b[1m\u001b[32m➜  \u001b[36mnew-project\u001b[0m claude\n\n' +
  `\u001b[93m${RULE104}\n` +
  '\u001b[39m \u001b[1m\u001b[93mAccessing\u001b[0m \u001b[1m\u001b[93mworkspace:\n\n' +
  '\u001b[0m \u001b[1m/Users/operator/code/new-proj\n\u001b[0m \u001b[1mect\n\n' +
  '\u001b[0m Quick safety check: Is this a project you created or one you trust? (Like your own code, a\n' +
  " well-known open source project, or work from your team). If not, take a moment to review what's in\n" +
  ' this folder first.\n\n' +
  " Claude Code'll be able to read, edit, and execute files here.\n\n" +
  ' \u001b[37m\u001b]8;id=zaxmda;https://code.claude.com/docs/en/security\u001b\\Security guide\u001b]8;;\u001b\\\n\n';

const TRUST_FOOTER =
  '\u001b[39m \u001b[37mEnter\u001b[39m \u001b[37mto\u001b[39m \u001b[37mconfirm\u001b[39m \u001b[37m·\u001b[39m \u001b[37mEsc\u001b[39m \u001b[37mto\u001b[39m \u001b[37mcancel\n\n\n\n\n\n\n\n\n\n\n';

/** The exact option-row bytes, verified against the real CLI in both states. */
const NO_SELECTED = '\u001b[39m \u001b[94m❯\u001b[39m \u001b[94mNo,\u001b[39m \u001b[94mexit\n';
const YES_UNSELECTED = '\u001b[39m   Yes, I trust this folder\n\n';
const NO_UNSELECTED = '\u001b[39m   No, exit\n';
const YES_SELECTED = ' \u001b[94m❯\u001b[39m \u001b[94mYes, I trust this folder\n\n';

/** `claude`'s trust dialog, as first drawn -- cursor on the default "No, exit". */
export const CLAUDE_TRUST = TRUST_HEADER + NO_SELECTED + YES_UNSELECTED + TRUST_FOOTER;

/** The SAME dialog after one real `Down` -- cursor now on "Yes, I trust this folder". */
export const CLAUDE_TRUST_CURSOR_ON_YES =
  TRUST_HEADER + NO_UNSELECTED + YES_SELECTED + TRUST_FOOTER;

/** `claude`'s ready TUI, idle, no message ever sent -- `auto mode on` footer. */
export const CLAUDE_READY =
  '\n\u001b[91m ▐\u001b[40m▛███▛█\u001b[39m\u001b[49m   \u001b[1mClaude Code\u001b[0m \u001b[37mv2.1.282\n' +
  '\u001b[91m▝▜\u001b[40m█████\u001b[49m█▀\u001b[39m  \u001b[37mOpus 5.5 · Claude Max\n' +
  '\u001b[91m ▝▝   ▝▝ \u001b[39m  \u001b[37m/Users/operator/code/new-project\n' +
  '\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n' +
  '\u001b[39m                                                                                \u001b[37m◐ medium · /effort\n' +
  `${RULE104}\n` +
  '\u001b[39m❯ \u001b[2mTry "write a test for <filepath>"\n' +
  `\u001b[0m\u001b[37m${RULE104}\n` +
  '\u001b[39m  \u001b[36mnew-project\u001b[37m \u001b[2mOpus 5.5\u001b[0m\u001b[37m \u001b[2min:0 out:0\n' +
  '\u001b[0m  \u001b[93m⏵⏵ auto mode on\u001b[37m (shift+tab to cycle) · ← 1 agent\u001b[39m   \n';

/** `CLAUDE_TRUST`, real-captured at a 40-column pane -- the prose wraps. */
export const CLAUDE_TRUST_NARROW =
  'claude\n\u001b[1m\u001b[32m➜  \u001b[36mnew-project\u001b[0m claude\n\n' +
  `\u001b[93m${RULE40}\n` +
  '\u001b[39m \u001b[1m\u001b[93mAccessing\u001b[0m \u001b[1m\u001b[93mworkspace:\n\n' +
  '\u001b[0m \u001b[1m/Users/operator/code/new-proj\n\u001b[0m \u001b[1mect-narrow\n\u001b[0m \u001b[1m-dir\n\n' +
  '\u001b[0m Quick safety check: Is this a project\n' +
  ' you created or one you trust? (Like\n' +
  ' your own code, a well-known open\n' +
  ' source project, or work from your\n' +
  ' team). If not, take a moment to review\n' +
  " what's in this folder first.\n\n" +
  " Claude Code'll be able to read, edit,\n" +
  ' and execute files here.\n\n' +
  ' \u001b[37m\u001b]8;id=zaxmda;https://code.claude.com/docs/en/security\u001b\\Security guide\u001b]8;;\u001b\\\n\n' +
  NO_SELECTED +
  YES_UNSELECTED +
  ' \u001b[37mEnter\u001b[39m \u001b[37mto\u001b[39m \u001b[37mconfirm\u001b[39m \u001b[37m·\u001b[39m \u001b[37mEsc\u001b[39m \u001b[37mto\u001b[39m \u001b[37mcancel\n\n\n\n';

/** `codex`'s trust dialog -- numbered, cursor on the default "1. Trust and continue". */
export const CODEX_TRUST =
  '\u001b[1m  Folder access\u001b[0m\n' +
  '  \u001b[2m/Users/operator/code/new-project\n' +
  '\u001b[0m  \u001b[2mect-codex\n' +
  '\u001b[0m\n' +
  '  Trust this folder? Codex can read, edit, and run files here, subject to your permission\n' +
  '  settings. Folder settings can run code automatically, even without a model request. Continue\n' +
  '  only if you trust these files. Your trust decision will be saved.\n\n' +
  '\u001b[1;7m› 1. Trust and continue\n' +
  '\u001b[0m  2. Back to Agent Command Center\n\n' +
  '  \u001b[1menter\u001b[0;2m continue · \u001b[0;1mesc\u001b[0;2m back\n\n\n\n\n\n\n\n\n\n\n\n\n\n' +
  '\u001b[0m\n\n\n';

/**
 * `codex`'s ready TUI. Driven live on the same private socket; typed back out
 * here as PLAIN text (no escape codes) because that capture was read off this
 * task's own terminal transcript rather than redirected to a file, so the
 * exact escape bytes were not kept -- unlike the five fixtures above, every
 * one of which came straight out of a file `tmux capture-pane -e` wrote. The
 * wording and layout are real (`OpenAI Codex (v0.157.0)`, the `› Ask Codex to
 * do anything` composer, `? for shortcuts` footer); only the colour escapes
 * are reconstructed as absent rather than measured.
 */
export const CODEX_READY_PLAIN = [
  '╭────────────────────────────────────────────────────╮',
  '│ >_ OpenAI Codex (v0.157.0)                          │',
  '│                                                    │',
  '│ model:     GPT-6-Astra high   /model to change     │',
  '│ directory: /Users/operator/code/new-project         │',
  '╰────────────────────────────────────────────────────╯',
  '',
  '                                Tip: Press ctrl+g to edit your current draft in an external editor.',
  '',
  '› Ask Codex to do anything',
  '',
  '  GPT-6-Astra high · /Users/operator/code/new-project',
  '  ← for agents · ? for shortcuts                                           ⚠ 1 warning · f2 to view',
].join('\n');
