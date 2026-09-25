/**
 * WHAT THE PANE ITSELF IS SHOWING, WHILE START SESSION IS WAITED ON.
 *
 * The operator, twice:
 *
 *  (1) "if the CLI has an update or needs to trust the folder, the Response
 *      view is stuck in the loading state while the terminal is asking about
 *      the update and trust." Measured against a REAL `claude`, on a private
 *      tmux socket, sending no paid prompt: neither dialog reaches `claude
 *      agents --json --all` at all -- the live-agent list `source.ts`'s own
 *      poll is built on -- for as long as it sits unanswered (36+ continuous
 *      seconds, in the run that measured it). The row therefore never leaves
 *      `unstarted`, and nothing before this file ever looked at what the pane
 *      itself was drawing.
 *  (2) "even when the terminal has finished starting the session, the
 *      Response view is still stuck loading." Also measured: once the CLI
 *      reaches its own ready screen, the live-agent list DOES pick it up
 *      (`~/.claude/sessions/<pid>.json` publishes within a couple of
 *      seconds) -- but only on `source.ts`'s own ~10s poll. `detectStartScreen`
 *      gives the renderer a second, faster, independent proof of the same
 *      fact, read straight off the pane -- the SAME `capture-pane` path
 *      `terminal/answer.ts` already reads a running session's picker
 *      through -- so the wait does not have to sit through a whole poll
 *      cycle it does not need.
 *
 * ONE MARKER SET WORKS FOR BOTH PROVIDERS, THOUGH THEIR SCREENS DO NOT
 * MATCH. Measured against both real CLIs: `claude`'s trust dialog carries no
 * option numbers at all (`❯ No, exit` / `  Yes, I trust this folder`), while
 * `codex`'s is a numbered picker (`readPicker`'s own shape). Keying a
 * detector to either SHAPE misses the other provider outright, so this reads
 * the option LABEL text instead -- present, one way or another, on both.
 *
 * `pane_current_command` IS NOT PART OF THIS CLASSIFIER, on purpose. Measured
 * against the real `claude` 2.1.282: it reports the bare version string
 * (`2.1.282`) as the pane's foreground command, on the trust dialog AND on
 * the ready screen alike -- never the word `claude`. It answers exactly one
 * question honestly (is a shell still running here?) and answers a
 * DIFFERENT one -- which screen is up? -- with the same misleading string
 * either way. `start-in-pane.ts`'s `isShellCommand` veto is the right place
 * for the first question; this file is the pane TEXT read for the second.
 */

import { plain } from '../../terminal/plain.js';
import { sendDownArgv, sendEnterArgv } from '../tmux/argv.js';
import { readPane, type TmuxRun } from '../tmux/spawn.js';

/**
 * `unknown` is not a failure to classify -- it is the honest answer for
 * output this module was not taught, and it is the one that matters most:
 * folding an unrecognised blocking screen into `ready` would clear the
 * loading state on a guess, and folding it into any of the named screens
 * would draw a card promising an action (like `trust`'s Yes/No) that is not
 * actually on the pane. The caller's own bounded wait (`Canvas.tsx`) is what
 * an `unknown` screen is for.
 */
export type StartScreenKind = 'trust' | 'update' | 'login' | 'onboarding' | 'ready' | 'unknown';

/**
 * One marker per screen, checked in this order because it is the order that
 * cannot mis-fire: a screen this module already recognises never ALSO
 * carries the `ready` marker (the box a dialog draws is never confused for
 * the plain composer caret), so the first match wins outright rather than
 * needing a tie-break.
 *
 * EACH PATTERN IS TESTED PER LINE, PLAIN-STRIPPED, TRIMMED -- never against
 * the whole screen joined into one string. `answer.ts`'s own title check
 * joins lines for prose that can wrap across a break with no space inserted;
 * this file's markers are all short, single-line option labels or headings
 * instead (measured: `claude`'s "Yes, I trust this folder" and codex's
 * "Trust and continue" both stay on one line even at a real 40-column width,
 * `CLAUDE_TRUST_NARROW`'s own fixture), so matching per line is both simpler
 * and immune to the DIFFERENT failure mode joining would risk -- gluing two
 * unrelated rows into a string that satisfies a pattern neither row alone
 * would.
 */
const TRUST_MARKERS: readonly RegExp[] = [
  /trust this folder/i,
  /trust these files/i,
  /trust and continue/i,
];
const UPDATE_MARKERS: readonly RegExp[] = [
  /update available/i,
  /^update now$/i,
  /new version of claude code/i,
];
const LOGIN_MARKERS: readonly RegExp[] = [
  /select login method/i,
  /log in with your/i,
  /paste your api key/i,
  /sign in to/i,
];
const ONBOARDING_MARKERS: readonly RegExp[] = [
  /choose the text style/i,
  /select (?:a |your )?theme/i,
  /choose your theme/i,
];

/** The idle composer's own caret, at the start of a line -- `❯` (`claude`)
 *  or `›` (`codex`), both measured against the real ready screen. Checked
 *  LAST, after every named blocking screen has had its chance: `claude`'s
 *  own trust dialog also draws a `❯` in front of its selected row, so this
 *  marker alone cannot tell the two apart -- the ORDER is what does. */
const READY_CARET = /^\s*[❯›]\s/;

function matchesAny(line: string, markers: readonly RegExp[]): boolean {
  return markers.some((marker) => marker.test(line));
}

/**
 * The screen a captured pane is showing, or `unknown` when it is none of the
 * ones this module has been taught. Never throws, and never guesses `ready`
 * for text it does not recognise (`StartScreenKind`'s own header).
 */
export function detectStartScreen(rawText: string): StartScreenKind {
  const lines = plain(rawText)
    .normalize('NFC')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  for (const line of lines) {
    if (matchesAny(line, TRUST_MARKERS)) return 'trust';
  }
  for (const line of lines) {
    if (matchesAny(line, UPDATE_MARKERS)) return 'update';
  }
  for (const line of lines) {
    if (matchesAny(line, LOGIN_MARKERS)) return 'login';
  }
  for (const line of lines) {
    if (matchesAny(line, ONBOARDING_MARKERS)) return 'onboarding';
  }
  for (const line of lines) {
    if (READY_CARET.test(line)) return 'ready';
  }
  return 'unknown';
}

/**
 * The trust dialog's own two rows, read by LABEL rather than by position --
 * `terminal/answer.ts`'s own rule for the identical reason: a default cursor
 * position is a fact about the screen the CLI drew a moment ago, not a fact
 * this function may assume still holds by the time it is asked to act.
 *
 * NUMBERED OR NOT, BOTH PROVIDERS FIT ONE SHAPE HERE: a leading cursor glyph
 * (`❯`/`›`, `plain()`-stripped, an optional `N.` before the label) marks the
 * SELECTED row; every other row carrying one of the two known labels is
 * UNSELECTED. `codex`'s numbering is stripped along with the glyph, so
 * "Trust and continue" and "Back to Agent Command Center" match the exact
 * same label patterns `claude`'s own unnumbered rows do.
 */
type TrustRow = { readonly accept: boolean; readonly selected: boolean };

/**
 * THE WHOLE ROW, ANCHORED -- never a substring test. Measured against
 * `codex`'s own prose (`CODEX_TRUST`'s body carries "...only if you trust
 * these files. Your trust decision will be saved." above the picker itself),
 * a substring match on "trust these files" would have read that SENTENCE as
 * an unselected copy of the option row, and it sorts before the real one --
 * `rows.find` would hand back the prose line's `selected: false` instead of
 * the picker's own, and send a needless `Down` before pressing a row that
 * was never the one on screen. Anchoring to the row's FULL label text (after
 * a cursor glyph and any `N.` numbering are stripped) is what a stray
 * sentence containing the same words cannot satisfy.
 */
const ACCEPT_LABEL = /^(?:trust and continue|yes,\s*i trust this folder)$/i;
const DECLINE_LABEL = /^(?:back to agent command center|no,\s*exit)$/i;

function readTrustRows(text: string): readonly TrustRow[] {
  const rows: TrustRow[] = [];
  for (const rawLine of plain(text).normalize('NFC').split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;
    const cursorMatch = /^[❯›]\s*(?:\d+\.\s*)?(.*)$/.exec(line);
    const numberedMatch = cursorMatch === null ? /^\d+\.\s*(.*)$/.exec(line) : null;
    const label = (cursorMatch?.[1] ?? numberedMatch?.[1] ?? line).trim();
    const selected = cursorMatch !== null;
    if (ACCEPT_LABEL.test(label)) rows.push({ accept: true, selected });
    else if (DECLINE_LABEL.test(label)) rows.push({ accept: false, selected });
  }
  return rows;
}

/** `SourceError`'s own two fields this module ever fills in -- every refusal
 *  here is a `refused`, never an `unreachable` (nothing here lost tmux
 *  itself, it only ever found the wrong screen or a keystroke that did not
 *  land), so the narrower shape is what `shared/start-screen.ts`'s
 *  `AnswerTrustResult` mirrors rather than importing the wider one. */
export type TrustRefusal = {
  readonly kind: 'refused';
  readonly code: string;
  readonly message: string;
};

const refusal = (message: string): TrustRefusal => ({
  kind: 'refused',
  code: 'no-trust-prompt',
  message,
});

/**
 * Answer the trust dialog in pane `name`: `trust` chooses "Yes"/"Trust and
 * continue", declining chooses "No, exit"/"Back to Agent Command Center`.
 * `null` when the keys landed; a refusal when there was no trust
 * dialog to answer, or vam could not read or move the cursor -- never a
 * guess pressed into a screen that might be asking something else.
 *
 * VERIFY THEN ACT, `answer.ts`'s own rule: the screen is read, confirmed to
 * still be the trust dialog, and only THEN is a key sent -- and at most ONE
 * `Down`, because both real dialogs measured have exactly two rows, so a
 * cursor not already on the wanted one is always one step from it.
 */
export async function answerTrustDialog(
  run: TmuxRun,
  name: string,
  trust: boolean,
): Promise<TrustRefusal | null> {
  const read = async (): Promise<string | null> => {
    const pane = await readPane(run, name);
    return pane.kind === 'ok' ? pane.text : null;
  };
  const text = await read();
  if (text === null) {
    return refusal(`vam could not read "${name}" to answer its trust dialog`);
  }
  if (detectStartScreen(text) !== 'trust') {
    return refusal(`"${name}" is not showing a trust dialog right now, so vam will not answer one`);
  }
  const rows = readTrustRows(text);
  const wanted = rows.find((row) => row.accept === trust);
  if (wanted === undefined) {
    return refusal(`vam read a trust dialog on "${name}" but could not find the option it wants`);
  }
  if (!wanted.selected) {
    const moved = await run(sendDownArgv(name));
    if (moved.failure !== null) {
      return refusal(`vam could not move the cursor on "${name}" to answer its trust dialog`);
    }
  }
  const entered = await run(sendEnterArgv(name));
  if (entered.failure !== null) {
    return refusal(`vam moved the cursor on "${name}" but could not press Enter to confirm`);
  }
  return null;
}
