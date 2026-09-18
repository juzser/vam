/**
 * Status-line screens captured from a REAL Claude Code TUI, pasted in with
 * their escape sequences intact.
 *
 * Throwaway sessions (Claude Code 2.1.276, tmux 3.7b) in scratch directories
 * on a private `-L` socket, created, driven and killed inside the task that
 * added this file; the operator's own sessions were never named or sent a key.
 * Every capture is `capture-pane -p -e`, which is what `capturePaneArgv` asks
 * for -- so these carry the same CSI bytes the production reader is handed,
 * and a parser that forgot to strip them fails here.
 *
 * WHAT THEY PROVE, and none of it was guessed:
 *
 *  - the CLI paints a PERSISTENT footer, second-to-last line of the screen:
 *    `<dir> <Model> <Version> [ctx:NN%] in:<x> out:<y>`, with the mode line
 *    (`⏵⏵ auto mode on …`) under it. The banner that also names the model
 *    scrolls away; this does not.
 *  - `ctx:` ARRIVES AFTER THE FIRST TURN and is absent on a fresh session, so
 *    the model is not a fixed number of tokens from the end of the line.
 *  - A NARROW PANE TRUNCATES IT with `…`, and the cut can land inside the
 *    model's own name (`wd1 Sonnet …` at 16 columns) -- which is why the
 *    reader demands the whole `in:`/`out:` tail before it believes a name.
 *  - AN OVERLAY REPLACES THE FOOTER ENTIRELY. A permission prompt, the CLI's
 *    own `/model` menu and the trust prompt each take the bottom of the
 *    screen, and the status line is not on it at all. That is the commonest
 *    way vam cannot tell, and it is a fact about the CLI rather than about the
 *    pairing.
 *  - A PANE THAT IS NOT RUNNING THE CLI has no footer to read either.
 *
 * Paths and the one OSC-8 link id are replaced with invented ones, and the
 * long box-drawing rules are shortened to keep the file narrow. Nothing else
 * is touched.
 */

export const SONNET_WITH_CONTEXT = [
  '',
  '',
  '  \u001b[37mRan \u001b[1m1\u001b[0m\u001b[37m shell command \u001b[39m',
  '',
  '\u001b[97m⏺\u001b[39m Sleep started in the background — I\'ll reply "ok" once it completes.',
  '',
  '\u001b[37m✻\u001b[39m \u001b[37mCooked for 8s · done 4:27 PM\u001b[39m',
  '',
  '\u001b[37m\u001b[100m❯\u001b[39m \u001b[97m/model\u001b[39m \u001b[49m',
  '\u001b[37m  ⎿  \u001b[39mKept model as \u001b[94mSonnet 5\u001b[39m',
  '',
  '\u001b[92m⏺\u001b[39m Background command "Sleep for 40 seconds" completed (exit code 0)',
  '',
  '\u001b[97m⏺\u001b[39m ok',
  '',
  '\u001b[37m✻\u001b[39m \u001b[37mSautéed for 2s · done 4:28 PM\u001b[39m',
  '',
  '\u001b[37m\u001b[100m❯ \u001b[97mCreate a file named a.txt containing the word hi\u001b[39m',
  '\u001b[49m',
  '\u001b[91m⏺\u001b[39m \u001b[1mWrite\u001b[0m(\u001b]8;id=1;file:///tmp/scratch/wd1\\a.txt\u001b]8;;\u001b\\)',
  '\u001b[37m  ⎿  User rejected write to \u001b[1ma.txt\u001b[0m',
  '     \u001b[2m\u001b[37m 1 hi\u001b[0m',
  '',
  '\u001b[37m✻\u001b[39m \u001b[37mSautéed for 4s · done 4:28 PM\u001b[39m',
  '',
  '\u001b[37m────────────────────────────────────────',
  '\u001b[39m❯ ',
  '\u001b[37m────────────────────────────────────────',
  '\u001b[39m  \u001b[36mwd1\u001b[37m \u001b[2mSonnet 5\u001b[0m\u001b[37m \u001b[32mctx:95%\u001b[37m \u001b[2min:54.9k out:272\u001b[0m',
  '  \u001b[37m⏸ manual mode on · ← for agents\u001b[39m',
].join('\n');

export const OPUS_FRESH = [
  '',
  '\u001b[91m ▐\u001b[40m▛███▛█\u001b[39m\u001b[49m   \u001b[1mClaude Code\u001b[0m \u001b[37mv2.1.276\u001b[39m',
  '\u001b[91m▝▜\u001b[40m█████\u001b[49m█▀\u001b[39m  \u001b[37mOpus 5 with medium effort · Claude API\u001b[39m',
  '\u001b[91m  ▝▝ ▝▝  \u001b[39m  \u001b[37m/…/scratch/wd1',
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
  '\u001b[37m────────────────────────────────────────',
  '\u001b[39m❯ ',
  '\u001b[37m────────────────────────────────────────',
  '\u001b[39m  \u001b[36mwd2\u001b[37m \u001b[2mOpus 5\u001b[0m\u001b[37m \u001b[2min:0 out:0\u001b[0m',
  '  \u001b[93m⏵⏵ auto mode on\u001b[37m (shift+tab to cycle) · ← for agents\u001b[39m',
].join('\n');

export const NARROW_TRUNCATED = [
  '     \u001b[2m\u001b[37m 1 h\u001b[0m',
  '     \u001b[2m\u001b[37m   i\u001b[0m',
  '',
  '\u001b[37m✻\u001b[39m \u001b[37mSautéed for 4s',
  '\u001b[39m  \u001b[37m· done 4:28 \u001b[39m',
  '  \u001b[37mPM\u001b[39m',
  '',
  '\u001b[37m────────────────',
  '\u001b[39m❯ ',
  '\u001b[37m────────────────',
  '\u001b[39m  \u001b[36mwd1\u001b[37m \u001b[2mSonnet …\u001b[0m',
  '  \u001b[37m⏸ manual  · \u001b[39m',
].join('\n');

export const PERMISSION_ASKING = [
  '',
  '\u001b[37m  ⎿  User rejected write to \u001b[1ma.txt\u001b[0m',
  '     \u001b[2m\u001b[37m 1 hi\u001b[0m',
  '',
  '',
  '',
  '',
  '',
  '\u001b[37m✻\u001b[39m \u001b[37mSautéed for 4s · done 4:28 PM\u001b[39m',
  '',
  '\u001b[37m\u001b[100m❯\u001b[39m \u001b[97m/model\u001b[39m \u001b[49m',
  '\u001b[37m  ⎿  \u001b[39mKept model as \u001b[94mSonnet 5\u001b[39m',
  '',
  '\u001b[37m\u001b[100m❯ \u001b[97mCreate a file named b.txt containing the word ho\u001b[39m',
  '',
  '\u001b[37m\u001b[49m⏺\u001b[39m \u001b[1mWrite\u001b[0m(\u001b]8;id=1;file:///tmp/scratch/wd1\\b.txt\u001b]8;;\u001b\\)',
  '',
  '\u001b[94m────────────────────────────────────────',
  '\u001b[39m \u001b[1m\u001b[94mCreate file\u001b[0m',
  ' \u001b[37mb.txt\u001b[39m',
  '\u001b[37m╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  '\u001b[39m \u001b[2m\u001b[37m 1 \u001b[0m\u001b[37mho\u001b[39m',
  '\u001b[37m╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  '\u001b[39m Do you want to create \u001b[1mb.txt\u001b[0m?',
  ' \u001b[94m❯\u001b[39m \u001b[37m1. \u001b[94mYes\u001b[39m',
  '   \u001b[37m2. \u001b[39mYes, and switch to \u001b[1maccept edits (auto-approve file edits and common file commands)\u001b[0m for this',
  '      session \u001b[1m(shift+tab)\u001b[0m',
  '   \u001b[37m3. \u001b[39mNo',
  '',
  ' \u001b[37mEsc to cancel · Tab to amend\u001b[39m',
].join('\n');

export const MODEL_MENU_OPEN = [
  '',
  '',
  '\u001b[37m✻\u001b[39m \u001b[37mSautéed for 2s · done 4:28 PM\u001b[39m',
  '',
  '\u001b[37m\u001b[100m❯ \u001b[97mCreate a file named a.txt containing the word hi\u001b[39m',
  '',
  '\u001b[91m\u001b[49m⏺\u001b[39m \u001b[1mWrite\u001b[0m(\u001b]8;id=1;file:///tmp/scratch/wd1\\a.txt\u001b]8;;\u001b\\)',
  '\u001b[37m  ⎿  User rejected write to \u001b[1ma.txt\u001b[0m',
  '     \u001b[2m\u001b[37m 1 hi\u001b[0m',
  '',
  '',
  '',
  '',
  '',
  '\u001b[37m✻\u001b[39m \u001b[37mSautéed for 4s · done 4:28 PM\u001b[39m',
  '\u001b[94m▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔',
  '\u001b[39m   \u001b[1m\u001b[94mSelect model\u001b[0m',
  '   \u001b[37mSwitch between Claude models. Your pick becomes the default for new sessions. For \u001b[39m',
  '   \u001b[37mother/previous model names, specify with --model.\u001b[39m',
  '',
  '     \u001b[37m1. \u001b[39mDefault (recommended)  \u001b[37mSonnet 5 · Efficient for routine tasks\u001b[39m',
  '   \u001b[94m❯\u001b[39m \u001b[37m2. \u001b[92mSonnet\u001b[39m \u001b[92m✔\u001b[39m               \u001b[37mSonnet 5 · Efficient for routine tasks\u001b[39m',
  '     \u001b[37m3. \u001b[39mFable                  \u001b[91mFable 5.1\u001b[37m · Most capable for your hardest and longest-running \u001b[39m',
  '                               \u001b[37mtasks\u001b[39m',
  '     \u001b[37m4. \u001b[39mOpus                   \u001b[37mOpus 5 · Best for everyday, complex tasks\u001b[39m',
  '     \u001b[37m5. \u001b[39mHaiku                  \u001b[37mHaiku 4.5 · Fastest for quick answers\u001b[39m',
  '',
  '   \u001b[91m◉\u001b[37m xHigh effort ←/→ to adjust\u001b[39m',
  '',
  '   \u001b[37mEnter to set as default · s to use this session only · Esc to cancel\u001b[39m',
].join('\n');

export const TRUST_PROMPT = [
  '',
  '\u001b[93m────────────────────────────────────────',
  '\u001b[39m \u001b[1m\u001b[93mAccessing\u001b[0m \u001b[1m\u001b[93mworkspace:\u001b[0m',
  '',
  ' \u001b[1m/tmp/scratch/wd1',
  ' \u001b[1m-4ece-ba1c-b28dc4ae87c7/scratchpad/mlabel/wd3\u001b[0m',
  '',
  ' Quick safety check: Is this a project you created or one you trust? (Like your',
  ' own code, a well-known open source project, or work from your team). If not,',
  " take a moment to review what's in this folder first.",
  '',
  " Claude Code'll be able to read, edit, and execute files here.",
  '',
  ' \u001b[37m\u001b]8;id=1;https://code.claude.com/docs/en/security\u001b\\Security guide\u001b[39m\u001b]8;;\u001b\\',
  '',
  ' \u001b[94m❯\u001b[39m \u001b[94mNo,\u001b[39m \u001b[94mexit\u001b[39m',
  '   Yes, I trust this folder',
  '',
  ' \u001b[37mEnter\u001b[39m \u001b[37mto\u001b[39m \u001b[37mconfirm\u001b[39m \u001b[37m·\u001b[39m \u001b[37mEsc\u001b[39m \u001b[37mto\u001b[39m \u001b[37mcancel\u001b[39m',
  '',
  '',
  '',
  '',
  '',
].join('\n');

export const PLAIN_SHELL = [
  '\u001b[1m\u001b[32m➜  \u001b[36mwd3\u001b[0m',
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
  '',
  '',
  '',
  '',
  '',
  '',
  '',
].join('\n');
