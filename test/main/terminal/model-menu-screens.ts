/**
 * The CLI's own `/model` MENU, captured from a real Claude Code TUI at each
 * cursor position, with its escape sequences intact.
 *
 * Throwaway session (Claude Code 2.1.276, tmux 3.7b) in a scratch directory on
 * a private `-L` socket, created, driven and killed inside the task that added
 * this file; the operator's own sessions were never named or sent a key. Every
 * capture is `capture-pane -p -e`, which is what `capturePaneArgv` asks for --
 * so these carry the same CSI bytes the production reader is handed.
 *
 * WHAT THEY PROVE, and none of it was guessed:
 *
 *  - THE MENU HAS NO QUESTION ABOVE IT. Its heading is `Select model` and the
 *    line under it is the CLI's own warning -- `Your pick becomes the default
 *    for new sessions` -- which is the whole reason `model-switch.ts` exists
 *    and the reason it cannot reuse `answer.ts`'s `see`.
 *  - THE ROWS PARSE UNDER `answer.ts`'s OWN `ROW` PATTERN, `❯` and all, and
 *    the captured label is the whole rest of the line: `Opus ✔
 *    Opus 5 · Best for everyday, complex tasks`. So the name has to be matched
 *    as a PREFIX of the label, never as the whole of it.
 *  - `✔` MARKS THE ROW THE SESSION IS ON, not the row the cursor is on. On
 *    `MENU_ON_OPUS` the two coincide; on `MENU_ON_HAIKU` (one Down later) the
 *    tick is still on Opus, which is what makes the distinction visible.
 *  - FABLE'S DESCRIPTION WRAPS onto a line with no number on it, which is why
 *    `readPicker`'s run-of-numbers logic is reused rather than reimplemented:
 *    a walk that treated adjacent LINES as rows would report a three-row menu.
 *  - THE CURSOR WRAPS. `MENU_ON_HAIKU` is row 5; one more Down gives
 *    `MENU_ON_DEFAULT`, row 1. Measured, which is what licenses bounding the
 *    walk to one pass of the rows.
 *  - `s` SWITCHES THE SESSION AND NOTHING ELSE. `AFTER_SESSION_ONLY` is the
 *    screen after `send-keys -l -- 's'` on the Sonnet row: the menu is gone
 *    and the footer reads `wd1 Sonnet 5 in:0 out:0`. `~/.claude/settings.json`
 *    was byte-identical afterwards -- same sha256, same mtime -- which is the
 *    measurement this whole module is built on.
 *  - `Escape` LEAVES THE MENU WITH NOTHING CHANGED. `AFTER_ESCAPE` is that
 *    screen, and it is why every refusal after the menu opens presses it.
 *
 * The one line carrying the capture directory is replaced with an invented
 * path and the long box rules are shortened to keep the file narrow. Nothing
 * else is touched.
 */

export const MENU_ON_OPUS = [
  '',
  '\u001b[91m ▐\u001b[40m▛███▛█\u001b[39m\u001b[49m   \u001b[1mClaude Code\u001b[0m \u001b[37mv2.1.276\u001b[39m',
  '\u001b[91m▝▜\u001b[40m█████\u001b[49m█▀\u001b[39m  \u001b[37mOpus 5 with medium effort · Claude API\u001b[39m',
  '\u001b[91m  ▝▝ ▝▝  \u001b[39m  \u001b[37m/…/scratch/wd1\u001b[39m',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '\u001b[94m▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔',
  '\u001b[39m   \u001b[1m\u001b[94mSelect model\u001b[0m',
  '   \u001b[37mSwitch between Claude models. Your pick becomes the default for new sessions. For \u001b[39m',
  '   \u001b[37mother/previous model names, specify with --model.\u001b[39m',
  '',
  '     \u001b[37m1. \u001b[39mDefault (recommended)  \u001b[37mSonnet 5 · Efficient for routine tasks\u001b[39m',
  '     \u001b[37m2. \u001b[39mSonnet                 \u001b[37mSonnet 5 · Efficient for routine tasks\u001b[39m',
  '     \u001b[37m3. \u001b[39mFable                  \u001b[91mFable 5.1\u001b[37m · Most capable for your hardest and longest-running \u001b[39m',
  '                               \u001b[37mtasks\u001b[39m',
  '   \u001b[94m❯\u001b[39m \u001b[37m4. \u001b[92mOpus\u001b[39m \u001b[92m✔\u001b[39m                 \u001b[37mOpus 5 · Best for everyday, complex tasks\u001b[39m',
  '     \u001b[37m5. \u001b[39mHaiku                  \u001b[37mHaiku 4.5 · Fastest for quick answers\u001b[39m',
  '',
  '   \u001b[91m◐\u001b[37m Medium effort ←/→ to adjust\u001b[39m',
  '',
  '   \u001b[37mEnter to set as default · s to use this session only · Esc to cancel\u001b[39m',
].join('\n');

export const MENU_ON_HAIKU = [
  '',
  '\u001b[91m ▐\u001b[40m▛███▛█\u001b[39m\u001b[49m   \u001b[1mClaude Code\u001b[0m \u001b[37mv2.1.276\u001b[39m',
  '\u001b[91m▝▜\u001b[40m█████\u001b[49m█▀\u001b[39m  \u001b[37mOpus 5 with medium effort · Claude API\u001b[39m',
  '\u001b[91m  ▝▝ ▝▝  \u001b[39m  \u001b[37m/…/scratch/wd1\u001b[39m',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '\u001b[94m▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔',
  '\u001b[39m   \u001b[1m\u001b[94mSelect model\u001b[0m',
  '   \u001b[37mSwitch between Claude models. Your pick becomes the default for new sessions. For \u001b[39m',
  '   \u001b[37mother/previous model names, specify with --model.\u001b[39m',
  '',
  '     \u001b[37m1. \u001b[39mDefault (recommended)  \u001b[37mSonnet 5 · Efficient for routine tasks\u001b[39m',
  '     \u001b[37m2. \u001b[39mSonnet                 \u001b[37mSonnet 5 · Efficient for routine tasks\u001b[39m',
  '     \u001b[37m3. \u001b[39mFable                  \u001b[91mFable 5.1\u001b[37m · Most capable for your hardest and longest-running \u001b[39m',
  '                               \u001b[37mtasks\u001b[39m',
  '     \u001b[37m4. \u001b[92mOpus\u001b[39m \u001b[92m✔\u001b[39m                 \u001b[37mOpus 5 · Best for everyday, complex tasks\u001b[39m',
  '   \u001b[94m❯\u001b[39m \u001b[37m5. \u001b[94mHaiku\u001b[39m                  \u001b[37mHaiku 4.5 · Fastest for quick answers\u001b[39m',
  '',
  '   \u001b[37m○ Effort not supported for Haiku\u001b[39m',
  '',
  '   \u001b[37mEnter to set as default · s to use this session only · Esc to cancel\u001b[39m',
].join('\n');

export const MENU_ON_DEFAULT = [
  '',
  '\u001b[91m ▐\u001b[40m▛███▛█\u001b[39m\u001b[49m   \u001b[1mClaude Code\u001b[0m \u001b[37mv2.1.276\u001b[39m',
  '\u001b[91m▝▜\u001b[40m█████\u001b[49m█▀\u001b[39m  \u001b[37mOpus 5 with medium effort · Claude API\u001b[39m',
  '\u001b[91m  ▝▝ ▝▝  \u001b[39m  \u001b[37m/…/scratch/wd1\u001b[39m',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '\u001b[94m▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔',
  '\u001b[39m   \u001b[1m\u001b[94mSelect model\u001b[0m',
  '   \u001b[37mSwitch between Claude models. Your pick becomes the default for new sessions. For \u001b[39m',
  '   \u001b[37mother/previous model names, specify with --model.\u001b[39m',
  '',
  '   \u001b[94m❯\u001b[39m \u001b[37m1. \u001b[94mDefault (recommended)\u001b[39m  \u001b[37mSonnet 5 · Efficient for routine tasks\u001b[39m',
  '     \u001b[37m2. \u001b[39mSonnet                 \u001b[37mSonnet 5 · Efficient for routine tasks\u001b[39m',
  '     \u001b[37m3. \u001b[39mFable                  \u001b[91mFable 5.1\u001b[37m · Most capable for your hardest and longest-running \u001b[39m',
  '                               \u001b[37mtasks\u001b[39m',
  '     \u001b[37m4. \u001b[92mOpus\u001b[39m \u001b[92m✔\u001b[39m                 \u001b[37mOpus 5 · Best for everyday, complex tasks\u001b[39m',
  '     \u001b[37m5. \u001b[39mHaiku                  \u001b[37mHaiku 4.5 · Fastest for quick answers\u001b[39m',
  '',
  '   \u001b[91m◐\u001b[37m Medium effort ←/→ to adjust\u001b[39m',
  '',
  '   \u001b[37mEnter to set as default · s to use this session only · Esc to cancel\u001b[39m',
].join('\n');

export const MENU_ON_SONNET = [
  '',
  '\u001b[91m ▐\u001b[40m▛███▛█\u001b[39m\u001b[49m   \u001b[1mClaude Code\u001b[0m \u001b[37mv2.1.276\u001b[39m',
  '\u001b[91m▝▜\u001b[40m█████\u001b[49m█▀\u001b[39m  \u001b[37mOpus 5 with medium effort · Claude API\u001b[39m',
  '\u001b[91m  ▝▝ ▝▝  \u001b[39m  \u001b[37m/…/scratch/wd1\u001b[39m',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '\u001b[94m▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔',
  '\u001b[39m   \u001b[1m\u001b[94mSelect model\u001b[0m',
  '   \u001b[37mSwitch between Claude models. Your pick becomes the default for new sessions. For \u001b[39m',
  '   \u001b[37mother/previous model names, specify with --model.\u001b[39m',
  '',
  '     \u001b[37m1. \u001b[39mDefault (recommended)  \u001b[37mSonnet 5 · Efficient for routine tasks\u001b[39m',
  '   \u001b[94m❯\u001b[39m \u001b[37m2. \u001b[94mSonnet\u001b[39m                 \u001b[37mSonnet 5 · Efficient for routine tasks\u001b[39m',
  '     \u001b[37m3. \u001b[39mFable                  \u001b[91mFable 5.1\u001b[37m · Most capable for your hardest and longest-running \u001b[39m',
  '                               \u001b[37mtasks\u001b[39m',
  '     \u001b[37m4. \u001b[92mOpus\u001b[39m \u001b[92m✔\u001b[39m                 \u001b[37mOpus 5 · Best for everyday, complex tasks\u001b[39m',
  '     \u001b[37m5. \u001b[39mHaiku                  \u001b[37mHaiku 4.5 · Fastest for quick answers\u001b[39m',
  '',
  '   \u001b[91m◐\u001b[37m Medium effort ←/→ to adjust\u001b[39m',
  '',
  '   \u001b[37mEnter to set as default · s to use this session only · Esc to cancel\u001b[39m',
].join('\n');

export const MENU_ON_FABLE = [
  '',
  '\u001b[91m ▐\u001b[40m▛███▛█\u001b[39m\u001b[49m   \u001b[1mClaude Code\u001b[0m \u001b[37mv2.1.276\u001b[39m',
  '\u001b[91m▝▜\u001b[40m█████\u001b[49m█▀\u001b[39m  \u001b[37mSonnet 5 with xhigh effort · Claude API',
  '\u001b[91m  ▝▝ ▝▝  \u001b[39m  \u001b[37m/…/scratch/wd1\u001b[39m',
  '',
  '',
  '\u001b[37m\u001b[100m❯\u001b[39m \u001b[97m/model\u001b[39m',
  '\u001b[37m\u001b[49m  ⎿  \u001b[39mSet model to \u001b[94mSonnet 5\u001b[39m for this session only',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '\u001b[94m▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔',
  '\u001b[39m   \u001b[1m\u001b[94mSelect model\u001b[0m',
  '   \u001b[37mSwitch between Claude models. Your pick becomes the default for new sessions. For \u001b[39m',
  '   \u001b[37mother/previous model names, specify with --model.\u001b[39m',
  '',
  '     \u001b[37m1. \u001b[39mDefault (recommended)  \u001b[37mSonnet 5 · Efficient for routine tasks\u001b[39m',
  '     \u001b[37m2. \u001b[92mSonnet\u001b[39m \u001b[92m✔\u001b[39m               \u001b[37mSonnet 5 · Efficient for routine tasks\u001b[39m',
  '   \u001b[94m❯\u001b[39m \u001b[37m3. \u001b[94mFable\u001b[39m                  \u001b[91mFable 5.1\u001b[37m · Most capable for your hardest and longest-running \u001b[39m',
  '                               \u001b[37mtasks\u001b[39m',
  '     \u001b[37m4. \u001b[39mOpus                   \u001b[37mOpus 5 · Best for everyday, complex tasks\u001b[39m',
  '     \u001b[37m5. \u001b[39mHaiku                  \u001b[37mHaiku 4.5 · Fastest for quick answers\u001b[39m',
  '',
  '   \u001b[91m◉\u001b[37m xHigh effort ←/→ to adjust\u001b[39m',
  '',
  '   \u001b[37mEnter to set as default · s to use this session only · Esc to cancel\u001b[39m',
].join('\n');

export const AFTER_SESSION_ONLY = [
  '',
  '\u001b[91m ▐\u001b[40m▛███▛█\u001b[39m\u001b[49m   \u001b[1mClaude Code\u001b[0m \u001b[37mv2.1.276\u001b[39m',
  '\u001b[91m▝▜\u001b[40m█████\u001b[49m█▀\u001b[39m  \u001b[37mSonnet 5 with xhigh effort · Claude API',
  '\u001b[91m  ▝▝ ▝▝  \u001b[39m  \u001b[37m/…/scratch/wd1\u001b[39m',
  '',
  '',
  '\u001b[37m\u001b[100m❯\u001b[39m \u001b[97m/model\u001b[39m',
  '\u001b[37m\u001b[49m  ⎿  \u001b[39mSet model to \u001b[94mSonnet 5\u001b[39m for this session only',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '                                                                                 \u001b[37m◉ xhigh · /effort\u001b[39m',
  '\u001b[37m────────────────────────────────────────',
  '\u001b[39m❯ ',
  '\u001b[37m────────────────────────────────────────',
  '\u001b[39m  \u001b[36mwd1\u001b[37m \u001b[2mSonnet 5\u001b[0m\u001b[37m \u001b[2min:0 out:0',
  '\u001b[0m  \u001b[93m⏵⏵ auto mode on\u001b[37m (shift+tab to cycle) · ← for agents\u001b[39m',
].join('\n');

export const AFTER_ESCAPE = [
  '',
  '\u001b[91m ▐\u001b[40m▛███▛█\u001b[39m\u001b[49m   \u001b[1mClaude Code\u001b[0m \u001b[37mv2.1.276\u001b[39m',
  '\u001b[91m▝▜\u001b[40m█████\u001b[49m█▀\u001b[39m  \u001b[37mSonnet 5 with xhigh effort · Claude API',
  '\u001b[91m  ▝▝ ▝▝  \u001b[39m  \u001b[37m/…/scratch/wd1\u001b[39m',
  '',
  '',
  '\u001b[37m\u001b[100m❯\u001b[39m \u001b[97m/model\u001b[39m',
  '\u001b[37m\u001b[49m  ⎿  \u001b[39mSet model to \u001b[94mSonnet 5\u001b[39m for this session only',
  '',
  '\u001b[37m\u001b[100m❯\u001b[39m \u001b[97m/model\u001b[39m \u001b[49m',
  '\u001b[37m  ⎿  \u001b[39mKept model as \u001b[94mSonnet 5\u001b[39m',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '                                                                                 \u001b[37m◉ xhigh · /effort\u001b[39m',
  '\u001b[37m────────────────────────────────────────',
  '\u001b[39m❯ ',
  '\u001b[37m────────────────────────────────────────',
  '\u001b[39m  \u001b[36mwd1\u001b[37m \u001b[2mSonnet 5\u001b[0m\u001b[37m \u001b[2min:0 out:0',
  '\u001b[0m  \u001b[93m⏵⏵ auto mode on\u001b[37m (shift+tab to cycle) · ← for agents\u001b[39m',
].join('\n');
