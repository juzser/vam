/**
 * The right panel: the focused turn, in full, and the place you answer it.
 *
 * This is the half of the split the canvas exists to make possible. Once the
 * full text lives here, a canvas card can be a strict summary without losing
 * anything — and a decision made from a truncated line is the failure mode this
 * panel removes. So `IN` and `OUT` are shown whole, wrapped, scrollable and
 * selectable, in contrast with the rest of the app.
 *
 * `user-select` is turned back ON here, and only here. Everywhere else it is off
 * because a stray drag selecting half the canvas is noise; here the text is the
 * point and copying part of an output is a reasonable thing to want.
 *
 * The composer at the bottom is a prompt box. The bash commands a turn
 * proposed used to be drawn in a strip above it, on every turn that mentioned
 * one; the operator asked for the strip to go and for the same commands to be
 * offered on demand instead, so typing `!` in the box opens them as a
 * suggestion list and picking one writes it into the prompt. The extraction is
 * unchanged and unwidened (`main/sources/claude-code/commands.ts`) -- this is a
 * second presentation of that list, never a second rule -- and `bangQuery`
 * below carries the reasoning for the keys.
 *
 * The option chooser above the composer is REAL NOW, and the distinction that
 * makes it legitimate is worth keeping. A picker stood here briefly, drawn
 * from the mockup and fed by a placeholder declared in this file: a header
 * reading "the agent is asking" and three cards whose every word was a
 * constant, shown to any merely idle session because `statusOf`
 * (`main/sources/claude-code/agents.ts`) calls every non-busy session
 * `waiting`. It was removed on the finding that nothing vam reads records
 * what a session is asking -- which is true of a question written in PROSE,
 * and false of one asked through the `AskUserQuestion` tool, whose text,
 * header, `multiSelect` flag and options are all in the transcript. So
 * `QuestionCard` below draws that record or nothing, per session rather than
 * per status, and picking an option still answers nothing: see its comment.
 *
 * What the composer's button claims is now the SOURCE's to say. PR #70 gave
 * the Claude Code source a real channel into a running session, so for that
 * source a prompt is delivered and answered; the factory source still only
 * appends to a log. `delivers` carries the difference, and with nothing said
 * the wording stays at "record".
 *
 * ## The mockup's four tabs, and the fifth that was never in it
 *
 * ADE puts Response / PRs / Terminal / Agents across the top, and all four now
 * have something behind them — which was not true when this comment was first
 * written, and the sentence it replaces claimed the opposite long after it
 * stopped being so.
 *
 * What each one needs, and why they arrived separately: PRs asks `gh` per
 * branch; Agents reads the roster beside a session's transcript; Terminal
 * reads a tmux pane, and only for sessions vam itself started, because no
 * process can take over another's controlling TTY.
 *
 * `Files` is the operator's own addition, not the mockup's: a file manager and
 * editor scoped to the session's own working directory, for the `.env` and
 * "a few other files" no chat transcript was ever going to be the right place
 * to touch. See `FilesTab.tsx`. It is withdrawn the OPPOSITE way Terminal is
 * (`tabs.ts`'s own header) — absent unless this build actually has the
 * desktop bridge behind it, never a per-source decline, because no source
 * declares it and none ever will (`CHANNELS.filesRead`'s header: no remote
 * route, by design).
 *
 * The `LIVE_TABS` list below is the honest part: a tab is live for a SOURCE
 * that reports the thing it draws, and the factory source still reports none
 * of the three. So the tabs are real and their emptiness is source-specific, rather
 * than the tabs being labels.
 */

import {
  ArrowUp,
  Bot,
  Box,
  Check,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  Circle,
  CircleSlash,
  FileText,
  GitPullRequest,
  Hand,
  Image as ImageIcon,
  ListChecks,
  LoaderCircle,
  MessageSquare,
  Mic,
  NotepadText,
  Paperclip,
  Play,
  Plus,
  Sparkles,
  SquareTerminal,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  type KeyboardEvent,
  lazy,
  memo,
  type ReactElement,
  type ReactNode,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { AgentWork } from '../../shared/agent-work.js';
import type { AnswerRequest, AnswerResult, PanePrompt, PromptView } from '../../shared/answer.js';
import type { PrAction } from '../../shared/pr-action.js';
import {
  CAN_CHOOSE_PROVIDER,
  PROVIDERS,
  type ProviderId,
  resolveProvider,
} from '../../shared/providers.js';
import type {
  ModelSwitchResult,
  PaneKey,
  PaneSendResult,
  SessionModel,
} from '../../shared/terminal.js';
import { relativeTime } from '../adapter/relative-time.js';
import type {
  AgentQuestion,
  Command,
  Decision,
  PullRequest,
  PullRequestList,
  SessionAgent,
  SessionStatus,
  SlashCommand,
  TurnStep,
} from '../domain/model.js';
import type { SessionEntry } from '../domain/selectors.js';
import { t } from '../i18n/strings.js';
import { chordSymbols, normalizeKey } from '../keyboard/chords.js';
import { insertScopeMark, insertStopMark } from '../keyboard/focus-scope.js';
import { questionKeys, resolveQuestionKey } from '../keyboard/question-keys.js';
import { ChordGlyphs, ShortcutTip } from '../keyboard/ShortcutTip.js';
import {
  activeFocusView,
  drawsProgressLine,
  drawsTurnSteps,
  drawsUnfoldControl,
  subscribeFocusView,
} from '../prefs/progress.js';
import {
  activeStreamingTerminal,
  subscribeStreamingTerminal,
} from '../prefs/streaming-terminal.js';
// `SUBMIT_KEY_LABELS` and `DEFAULT_PROMPT_SUBMIT_KEY` are no longer imported
// here: this file's only reader of either was the send-key caption under the
// prompt input, which is gone with the row it sat on (see the comment at the
// end of the prompt box). The table itself is untouched and still has a
// reader -- the Settings picker, which is where the key is chosen and named.
import {
  activePromptSubmitKey,
  submitsPrompt,
  subscribePromptSubmitKey,
} from '../prefs/submit-key.js';
import {
  activeNarrowViews,
  narrowProseMaxWidth,
  PROSE_RULER_CLASS,
  PROSE_RULER_TEXT,
  subscribeNarrowViews,
} from '../prefs/view-width.js';
import { useAgentWorkReader } from '../sources/agent-work-reader.js';
import { useHistoryReader } from '../sources/history-reader.js';
import { describeFailure, type SourceError } from '../sources/port.js';
import { markRegisterOf, PROVIDER_MARKS, SourceMark } from '../sources/provider-marks.js';
import { useAgentWork } from '../sources/useAgentWork.js';
import { useVisibilityInterval } from '../useVisibilityInterval.js';
import { appendImagePath, removeImagePath } from './attach-image-path.js';
import { ConfirmPrAction } from './ConfirmPrAction.js';
import { ContextMenu, type ContextMenuItem } from './ContextMenu.js';
import { copyText } from './clipboard.js';
import { type ComposerImage, readPastedImages, spliceDraft } from './composer-paste.js';
import { type DictationHandle, dictationAvailable, startDictation } from './dictation.js';
import type { FileOpenRequest } from './FilesTab.js';
import {
  GettingStarted,
  type GettingStartedProps,
  IconFrame,
  StartShortcuts,
  TERMINAL_ONLY_SHORTCUT_ROWS,
} from './GettingStarted.js';
import {
  MODEL_CHOICES,
  modelButtonLabel,
  modelButtonName,
  modelControlState,
  modelRunningClause,
  type RunningModel,
  runningModelRows,
} from './model-command.js';
import { Note } from './Note.js';
import { type OutActionResult, OutActionsProvider } from './out-actions.js';
import { OUT_MARKDOWN, OUT_URL_TRANSFORM } from './out-markdown.js';
import { newestSet, toolUseOf } from './question-set.js';
import { GLYPH_PX, MARK_LANE_PX } from './status-mark.js';
import { hasContentAbove, hasContentBelow, isAtBottom, shouldStick } from './stick-to-bottom.js';
import { TerminalTab } from './TerminalTab.js';
import { drawsComposer, narrowsAsProse, TABS, type Tab, visibleTabs } from './tabs.js';
import {
  appendOlder,
  applyWalk,
  columnOf,
  cursorToAsk,
  moreState,
  type PagerState,
  RESTING_PAGER,
  walkOlder,
} from './transcript-history.js';

// `react-markdown` + `remark-gfm`, in their own lazy chunk: see
// `LazyMarkdown.tsx`'s own header for the measured cost and why the split
// sits at this boundary rather than inside `out-markdown.tsx`.
const LazyMarkdown = lazy(() => import('./LazyMarkdown.js'));

// `FilesTab`, in its own lazy chunk -- the same `React.lazy` + `Suspense`
// split as `LazyMarkdown` above, at the same boundary this repo's
// bundle-budget guard measures. `FilesTab.tsx` is 2,700+ lines and drags in
// `files-highlight.ts` and the hand-rolled tokenizer `highlight.ts` behind
// it, none of which a session with the Files tab withdrawn (`files` prop
// absent/false) ever needs. `FileOpenRequest` stays a TYPE-ONLY import
// above -- only the component VALUE needs to move behind `lazy()`.
const LazyFilesTab = lazy(() => import('./FilesTab.js').then((m) => ({ default: m.FilesTab })));

// `TerminalStreamTab`, in its own lazy chunk -- the same split as
// `LazyFilesTab` above, at the same bundle-budget boundary: it carries
// xterm.js, which is not small, and most sessions never turn the
// `streamingTerminal` beta on (see `prefs/streaming-terminal.ts`).
const LazyTerminalStreamTab = lazy(() =>
  import('./terminal-stream/TerminalStreamTab.js').then((m) => ({
    default: m.TerminalStreamTab,
  })),
);

/**
 * How often the pane is re-read while a row says it is waiting.
 *
 * A prompt is a SCREEN, not a record: it appears when the agent asks and
 * vanishes when it is answered -- from vam, from the terminal, or from another
 * window -- and nothing tells vam either way. The Terminal tab already reads
 * its pane once a second; this is slower because it is drawn as a decision
 * rather than as a live screen, and it runs only for a row that is waiting and
 * that vam started.
 */
const PROMPT_POLL_MS = 2_000;

/**
 * How often the pane is re-read for the model the session is running.
 *
 * SLOWER THAN THE PROMPT ABOVE IT, because it is a slower fact: a model
 * changes when somebody types `/model`, where a prompt appears and vanishes on
 * its own. What it buys at all is that vam is not the only one who can type
 * that line -- the operator can switch the model in their own terminal, and
 * the status line is HIDDEN behind any open question, so a read that never
 * repeated would leave the button unlabelled until the row changed.
 *
 * IT IS ALSO THE BOUND ON HOW STALE THE LABEL CAN BE, which is why it is not
 * slower still: four seconds is the longest the button can name a model the
 * session has stopped running. A pick vam makes itself does not wait for it
 * (`sendModel` looks again at once).
 *
 * WHAT IT COSTS: two tmux invocations per tick per pane showing a composer for
 * a session vam started -- the listing that proves the pairing and the capture
 * -- measured at 5.7ms and 5.4ms on a private socket. It runs nowhere else:
 * the recording source and every session vam did not start ask for nothing.
 */
const MODEL_POLL_MS = 4_000;

/**
 * One empty turn list, shared. A frozen constant rather than a fresh `[]` at
 * each call site: it is the initial value of a `useState` and the fallback for
 * a pane with no session at all, and both of those are read every render.
 */
const NO_TURNS: readonly Decision[] = Object.freeze([]);

/**
 * HOW NEAR THE TOP COUNTS AS ASKING FOR MORE.
 *
 * The operator's own words were "load more when scrolling up", so the gesture
 * is the scroll and not only the button. A margin rather than zero: at
 * `scrollTop === 0` the reader has already hit the wall and is waiting, and the
 * boundary block itself is about this tall, so this fires as it comes into view
 * rather than after it has been stared at.
 */
const NEAR_TOP_PX = 120;

/** The three things this pane needs to know about a file it was handed. */
export type AttachedFile = {
  readonly name: string;
  readonly size: number;
  /** What `File.text()` decoded, replacement characters and all. */
  readonly text: string;
};

/** Refused, with the sentence the composer shows, or accepted with a new draft. */
export type AttachResult =
  | { readonly ok: true; readonly draft: string }
  | { readonly ok: false; readonly message: string };

/**
 * The most text vam will inline into one prompt: 64 KB.
 *
 * A number, and a small one, because the prompt is written verbatim onto an
 * append-only session log. Past the limit the file is refused by name rather
 * than truncated — half a file in a log reads as a whole one later.
 */
export const ATTACH_LIMIT_BYTES = 64 * 1024;

const ATTACH_HEAD = '--- attached: ';
const ATTACH_TAIL = ' ---';
const ATTACH_END = '--- end attached ---';
const ATTACH_BLOCK = /\n*^--- attached: (.+) ---$\n[\s\S]*?^--- end attached ---$/m;

/**
 * Put a file's own text into the draft, or say why not.
 *
 * This is what "the attachment button works" can honestly mean here. vam's one
 * write is `POST /api/prompt` with `{sessionId, prompt}` — text, nothing else —
 * and there is no upload route to add one to without changing a different repo.
 * So the file is read in the renderer and its contents become part of the very
 * string that gets recorded: the whole thing genuinely arrives, and nothing on
 * screen implies a transfer vam cannot perform.
 */
/**
 * The refusals a NAME AND A SIZE already settle, decided before a byte is read.
 *
 * `File.size` costs nothing and `File.text()` decodes the whole file into one
 * JS string: on a large one that is a frozen renderer at best and a dead one
 * past V8's string cap, and a dead renderer takes the draft the operator was
 * composing with it. Telling somebody afterwards that the file was too big is
 * a sentence delivered to a window that is no longer there.
 *
 * Two call sites, and they need it for opposite reasons: the picker calls it
 * FIRST, so the decode never starts, and `attachIntoDraft` calls it because it
 * is also reachable with text already in hand.
 */
export function refuseUnreadFile(
  draft: string,
  file: { name: string; size: number },
): string | null {
  const already = readAttachedName(draft);
  if (already !== null) return `one file at a time — take ${already} off first`;
  if (file.size > ATTACH_LIMIT_BYTES) {
    return `${file.name} is larger than 64 KB — vam inlines the file's own text, so it refuses rather than sending half of it`;
  }
  return null;
}

export function attachIntoDraft(draft: string, file: AttachedFile): AttachResult {
  const unread = refuseUnreadFile(draft, file);
  if (unread !== null) return { ok: false, message: unread };
  // The replacement character is what a UTF-8 decode leaves behind when the
  // bytes were never UTF-8, and a NUL is the other reliable sign of the same
  // thing. Either way what would be inlined is noise, not text.
  if (file.text.includes('\u{FFFD}') || file.text.includes('\u{0}')) {
    return { ok: false, message: `${file.name} is not text vam can read — nothing was attached` };
  }
  const name = file.name.replace(/[\r\n]+/g, ' ');
  const head = draft === '' ? '' : `${draft}\n\n`;
  return {
    ok: true,
    draft: `${head}${ATTACH_HEAD}${name}${ATTACH_TAIL}\n${file.text}\n${ATTACH_END}`,
  };
}

/** The name of the file inlined in this draft, if there is one. */
export function readAttachedName(draft: string): string | null {
  return ATTACH_BLOCK.exec(draft)?.[1] ?? null;
}

/** Take the inlined block back out, leaving the words the operator typed. */
export function detachFromDraft(draft: string): string {
  return draft.replace(ATTACH_BLOCK, '');
}

// `m`, so the line is found wherever it sits. Without it the regex is anchored
// at offset 0 and the second header written would hide the first from its own
// reader — a bug that only appears once two of these exist.
const MODEL_LINE = /^model: (.*)\n?/m;
const MODE_LINE = /^mode: (.*)\n?/m;

/** What a prompt carrying no `mode:` line means. */
const DEFAULT_MODE = 'Auto';

/** The model this draft asks for, or `''` when it asks for none. */
export function readModelRequest(draft: string): string {
  return MODEL_LINE.exec(draft)?.[1] ?? '';
}

/**
 * Write the model request onto the draft's first line, or take it off.
 *
 * vam has no model API and must not invent one: the factory picks the model,
 * and a control that quietly changed nothing would be worse than the honest
 * placeholder it replaces. What vam does have is the prompt text it records
 * verbatim, so the request goes THERE — one leading line, in the words a
 * person reading the session log will read. It is a request written down, and
 * the note on the field says exactly that.
 */
export function setModelRequest(draft: string, model: string): string {
  const rest = draft.replace(MODEL_LINE, '');
  return model === '' ? rest : `model: ${model}\n${rest}`;
}

/** The mode this draft asks for, or `''` when it asks for none. */
export function readModeRequest(draft: string): string {
  return MODE_LINE.exec(draft)?.[1] ?? '';
}

/**
 * Write the mode request onto the draft, or take it off.
 *
 * Exactly the reasoning behind `setModelRequest`: the factory has no
 * per-session mode, so a control that changed vam's own state and nothing else
 * would look like it worked and do nothing. What vam has is the prompt it
 * records verbatim, so the request goes there in words a person reading the
 * log will read. Selecting the default mode clears the line rather than
 * writing `mode: Auto` — a prompt should not carry a sentence that says
 * "unchanged".
 */
export function setModeRequest(draft: string, mode: string): string {
  const rest = draft.replace(MODE_LINE, '');
  return mode === DEFAULT_MODE ? rest : `mode: ${mode}\n${rest}`;
}

/**
 * The header this pane once drew its own status dot in is gone (A12.2): the
 * sidebar row already carries the same four-way status map for every
 * session, always visible, and the `out` rule below carries the one status
 * fact that is actually about the turn on screen — whether IT is still being
 * worked (`outIsLive`). A third copy in a header that no longer exists would
 * be the same colour said a third way for no new information.
 */

/**
 * What the operator is typing after a `!` that begins a line, or `null` when
 * no suggestion list should be open.
 *
 * LINE START ONLY, and that is the whole rule. `commands.ts` recognises a
 * proposed command only when `!` begins a LINE -- a deliberately narrow rule,
 * with every inference clause removed at the operator's request -- so a `!`
 * inside a sentence is not a command anywhere else in vam. Completing one
 * there would invent a second, wider rule for the same glyph, in the one place
 * where the text is about to be sent to an agent.
 *
 * The query stops at the first whitespace for the same reason: a command is
 * one line and a list that kept matching while the operator wrote prose would
 * hang over text nobody is choosing from.
 */
export function bangQuery(text: string, caret: number): string | null {
  const before = text.slice(0, Math.max(0, caret));
  const typed = before.slice(before.lastIndexOf('\n') + 1);
  if (!typed.startsWith('!')) return null;
  const query = typed.slice(1);
  return /\s/.test(query) ? null : query;
}

/**
 * How many suggestion rows the popover draws at once. Whatever it leaves out
 * is COUNTED on screen (`data-bang-more`), never silently cropped.
 *
 * The strip this list replaced showed six, because six was one turn's worth
 * (`commands.ts`'s own `MAX_COMMANDS`). This list is a whole session's worth,
 * so it is eight -- enough that the newest turn's six still fit with the
 * previous turn's beginning visible behind them, and few enough that the box
 * does not become a page floating over the composer.
 */
export const MAX_BANG_ROWS = 8;

/**
 * The popover's own box, shared by both typeaheads so they cannot drift apart.
 *
 * `max-h-[30vh]` IS THE LOAD-BEARING PART, and it was put here by a
 * measurement rather than by taste: the box sits in normal flow ABOVE the
 * composer, so a tall list pushes the composer down -- and eight two-line `/`
 * rows measured 412px in a real browser, which put the prompt box's bottom
 * edge at 872px in an 800px window. The list had evicted the thing it exists
 * to complete, Record button and all. `e2e/prompt-suggest-shots.mjs` measures
 * exactly that now, on both lists.
 *
 * A BOUNDED HEIGHT WAS TRIED HERE AND TAKEN OUT AGAIN, ONCE. `max-h-[30vh]`
 * plus a scrolling row container plus a `scrollIntoView` on the selected row:
 * three moving parts, and nothing could falsify them. With the row cap at
 * eight and the layer floating, the list fit above the composer at 800px AND
 * at 480px, with no card sitting on a preview panel yet -- so a static bound
 * would have been a number with no measurement behind it, exactly the thing
 * that comment warned against.
 *
 * THE PREVIEW PANEL CHANGED WHAT "FITS" MEANS. `QuestionCard`'s panel can now
 * add real height to a card that used to be a fixed size, which moves the
 * composer -- and therefore this layer's `bottom-full` anchor -- lower than
 * this file's own measurements assumed. `e2e/prompt-suggest-shots.mjs`
 * caught it: at 480px, `popoverTop` went to -18. So the bound is back, and it
 * is not a repeat of the deleted one -- it is MEASURED rather than guessed,
 * every render, off the one thing that actually determines how much room
 * there is: this layer's own `getBoundingClientRect().bottom`, which
 * `bottom-full` fixes at the composer's top regardless of the layer's own
 * height. `suggestMaxHeight` below is `bottom - SUGGEST_EDGE_GUTTER`, so the
 * layer's top can never go above the viewport -- at any card height, any
 * window height -- and `overflow-y-auto` (`vam-no-scrollbar` hides the bar,
 * matching every other scroller in this app) is what a list longer than that
 * does instead of running off the top.
 */
/** Kept off the very top edge, so a clamped list never looks like it is
 *  falling out of frame. */
const SUGGEST_EDGE_GUTTER = 8;
/**
 * WHERE THE TYPEAHEADS ARE PAINTED, and this is a correction with a
 * measurement behind it.
 *
 * They used to sit IN FLOW inside the composer's block, above the prompt box.
 * That reads fine with one row and is wrong with eight: measured in a real
 * browser, the `/` list's eight two-line rows came to 412px and pushed the
 * prompt box's bottom edge to 872px in an 800px window -- the Record button
 * and the mode row off the bottom of the screen. The list had evicted the
 * thing it exists to complete, and a shorter cap would only have moved the
 * window size at which it happened.
 *
 * FLOATING OVER THE TRANSCRIPT IS THE FIX, because it makes the composer's
 * position independent of the list's height: `bottom-full` hangs the layer off
 * the top edge of the block the composer is in, so nothing below it moves at
 * all, at any viewport. That is what a popover is, and it is what the `!` list
 * should have been from the start. `e2e/prompt-suggest-shots.mjs` measures
 * both lists against the composer's own rect for exactly this.
 *
 * One layer for all three blocks -- both lists and the gap note -- so they
 * stack in a known order instead of three absolute boxes overlapping, and
 * rendered only when one of them has something to say, so an empty layer never
 * sits over the transcript catching clicks.
 */
const SUGGEST_LAYER = 'absolute inset-x-3.5 bottom-full z-20 mb-2 flex flex-col gap-1.5';

/**
 * `vam-no-scrollbar overflow-y-auto`: EACH BOX, not `SUGGEST_LAYER` around
 * them. The layer only ANCHORS the boxes (`bottom-full`); overflow on IT
 * clips paint but the CSS box model does not shrink a child to fit a
 * scrolling ancestor just because the ancestor clips -- `[data-bang-suggest]`
 * and `[data-slash-suggest]` are what `e2e/prompt-suggest-shots.mjs` actually
 * measures, and a clamp on their common ancestor left THEIR OWN rect at full,
 * unclamped height, `popoverBottom` still past the composer's top. Learned by
 * measuring it, not reasoned to: `suggestMaxHeight`'s own comment.
 */
const SUGGEST_BOX =
  'vam-no-scrollbar flex flex-col gap-0.5 overflow-y-auto rounded-[10px] border border-line-strong bg-card px-1.5 py-1.5';

/**
 * `provider`/`model`/`mode`: three short option lists, each opened off its
 * own small toggle in `data-prompt-tools` -- the row directly under the
 * textarea. `bottom-full left-0` used to resolve against that toggle's own
 * `position: relative` wrapper, so a popover of any real height grew upward
 * into the textarea it sits a `gap-2.5` above (`src/shared/providers.ts`'s
 * own measurement: "99x34 overlapping the textarea by 28px"). Their wrapper
 * no longer carries `position: relative` (search `data-popover-root`), so
 * `bottom-full` here resolves against `data-composer-bar` instead -- the
 * same ancestor `SUGGEST_LAYER` floats against -- and the popover clears the
 * WHOLE composer rather than only the toggle it hangs off.
 *
 * `left-0` still means "this popover's own containing block", which moved
 * with the rest of it: today that reads as the composer's own left padding
 * edge rather than the toggle's, which is the one visible trade-off this
 * takes -- a provider/model/mode popover no longer opens flush against its
 * own button. `SUGGEST_LAYER`'s boxes have drawn from that same left edge
 * all along, so this is not a new idiom, only a third and fourth control
 * joining the first two.
 *
 * `vam-no-scrollbar overflow-y-auto` plus a measured `maxHeight`
 * (`suggestMaxHeight`) are what `SUGGEST_BOX` already does for the typeahead
 * lists -- the same cap, so a table that outgrows the room above the
 * composer scrolls instead of pushing past the top of the screen.
 */
const COMPOSER_POPOVER_MENU =
  'absolute bottom-full left-0 z-10 mb-2 flex flex-col gap-0.5 overflow-y-auto rounded-[10px] border border-line-strong bg-card p-1 shadow-sm vam-no-scrollbar';

/**
 * EVERY COMMAND THE COLUMN CARRIES, in the order they should be offered.
 *
 * WHY THIS IS NOT JUST THE FOCUSED TURN, which is what it used to be. The
 * focused turn is the newest one unless `h`/`l` moved -- the turn that has
 * just answered. A command is proposed at the END of a piece of work, so the
 * newest turn is precisely the turn least likely to carry one, and the
 * operator's report ("typing `!` shows nothing") was this and not a missing
 * feature: the list worked, on the one turn in twenty that had a command in
 * it. The column draws the whole session now, so a list narrower than the
 * column is a list that hides what is on screen.
 *
 * THE ORDER, and the one place it departs from newest-first: the FOCUSED turn
 * comes first, then everything else newest-first. `h`/`l` is a deliberate
 * move onto a turn the operator wants to read, so its commands are the ones
 * being reached for; with no move made it IS the newest turn and the two
 * orders are the same list. It is also what keeps the focused turn's commands
 * offered when it sits outside the column entirely -- a turn selected before
 * the byte window slid past it (`selectedTurnMissing`).
 *
 * DEDUPLICATED ON THE COMMAND TEXT, first occurrence winning, because the
 * command text is what gets inserted: two entries that would type the same
 * characters are one choice wearing two labels, and rounds of the same work
 * repeat "run the gate" verbatim on every turn. The LABEL is not part of the
 * key -- an agent rewording its own request is not a second command.
 */
export function commandsInColumn(
  focused: Decision | null,
  column: readonly Decision[],
): readonly Command[] {
  const seen = new Set<string>();
  const out: Command[] = [];
  const turns = focused === null ? column : [focused, ...column.filter((t) => t.id !== focused.id)];
  for (const turn of turns) {
    for (const command of turn.commands) {
      if (seen.has(command.command)) continue;
      seen.add(command.command);
      out.push(command);
    }
  }
  return out;
}

/**
 * The proposed commands a query matches, on either half a person might
 * remember: the label the agent gave it, or the command itself.
 *
 * An empty query matches everything -- typing `!` alone is the operator asking
 * what there is, not asking for nothing.
 */
export function matchCommands(commands: readonly Command[], query: string): readonly Command[] {
  const needle = query.toLowerCase();
  return commands.filter(
    (command) =>
      command.label.toLowerCase().includes(needle) ||
      command.command.toLowerCase().includes(needle),
  );
}

/**
 * Replace the `!`-token the caret sits in with the chosen command, keeping the
 * `!` (the operator typed it, and the agent's own line carries it) and keeping
 * whatever follows the caret on that line.
 */
export function applyBang(
  text: string,
  caret: number,
  command: string,
): { readonly text: string; readonly caret: number } {
  const start = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const inserted = `!${command}`;
  return {
    text: text.slice(0, start) + inserted + text.slice(caret),
    caret: start + inserted.length,
  };
}

/**
 * `bangQuery`'s counterpart for `/`. SAME RULE, LINE START ONLY: a slash
 * command is the first thing on its line, per Claude Code's own convention.
 * Never open together with `bangQuery` -- a token cannot start with both.
 */
export function slashCommandQuery(text: string, caret: number): string | null {
  const before = text.slice(0, Math.max(0, caret));
  const typed = before.slice(before.lastIndexOf('\n') + 1);
  if (!typed.startsWith('/')) return null;
  const query = typed.slice(1);
  return /\s/.test(query) ? null : query;
}

/** The provider's commands a query matches, on the name or its description. */
export function matchSlashCommands(
  commands: readonly SlashCommand[],
  query: string,
): readonly SlashCommand[] {
  const needle = query.toLowerCase();
  return commands.filter(
    (command) =>
      command.name.toLowerCase().includes(needle) ||
      (command.description ?? '').toLowerCase().includes(needle),
  );
}

/** `applyBang`'s counterpart: keeps the `/` and whatever follows the caret. */
export function applySlashCommand(
  text: string,
  caret: number,
  name: string,
): { readonly text: string; readonly caret: number } {
  const start = text.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const inserted = `/${name}`;
  return {
    text: text.slice(0, start) + inserted + text.slice(caret),
    caret: start + inserted.length,
  };
}

export type DetailPanelProps = {
  readonly entry: SessionEntry | null;
  /** The step the canvas has focused — the newest one unless `h`/`l` moved. */
  readonly decision: Decision | null;
  /**
   * WHICH CANVAS NODE THE CURSOR SITS ON — `Canvas.tsx`'s own `focusedId`,
   * passed through unexamined. This is NOT a second copy of `decision`: it
   * changes only on an explicit navigation (a click, a jump, `h`/`j`/`k`/`l`
   * landing somewhere new), never merely because the data underneath
   * refreshed. That distinction did not used to matter — turn ids were
   * positional (`${prefix}:${index}`), so the canvas's DEFAULT pick
   * (`decisions[0]`, drawn whenever the cursor sits on the session card
   * rather than a specific step) kept the same id string across a poll
   * whether or not the newest turn actually changed. Turn ids are now
   * content-derived (`transcript.ts`), so that default pick genuinely gets a
   * NEW id every time a new turn arrives — exactly the case that must NOT
   * drag an operator reading history back to the newest turn. This is what
   * lets the panel tell "the canvas cursor actually moved" apart from "a new
   * turn arrived while the cursor stayed put".
   *
   * `undefined` (`PhoneShell`, which has no step cursor at all) is treated as
   * NO SIGNAL: session identity is the only thing that resets the pick
   * there, which is what "no yank" means for a shell with nothing to
   * navigate.
   */
  readonly focusNodeId?: string | null;
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmit: () => void;
  /** True while the prompt box owns the keyboard. */
  readonly composing: boolean;
  readonly onCompose: () => void;
  readonly onStopComposing: () => void;
  /**
   * True while `I` has moved keyboard control into this pane. `j`/`k` then walk
   * the actions below instead of the sessions, and `Esc` / `Mod-Shift-h` /
   * `Mod-0` hands control back.
   */
  readonly active: boolean;
  /** Which action `j`/`k` has landed on while `active`. */
  readonly actionIndex: number;
  /**
   * Whether this session's source DELIVERS a prompt into a running agent
   * rather than only filing it in a log — `SourceCapabilities.deliverPrompt`
   * in `sources/port.ts`, not a source id. Omitted means "nobody has said",
   * which reads as the recording wording, because understating what a button
   * does is the safe direction and overstating it is not.
   *
   * `Canvas.tsx` passes it for a `'session'` source (the desktop shell, built
   * from `sources/preload-factory.ts` over the Claude Code source's real
   * `capabilities`) as `source.source.capabilities.deliverPrompt`; a `'live'`
   * source holds a bare smith-api client with no `capabilities` object, so it
   * always reads as the recording wording. Guessing from `Session.source`
   * instead would be sniffing an id for a capability, which is the thing
   * `port.ts` exists to stop.
   */
  readonly delivers?: boolean;
  /**
   * The bridge that ANSWERS the open question, when the shell has one.
   *
   * Injected here rather than reached for inside the card, the way the
   * Terminal tab's three members are passed at their call site: a member
   * wired invisibly is one refactor away from being dropped with nothing to
   * notice, and a test that cannot hand this a fake would have to fake a
   * global to say anything at all. `undefined` in the browser build, where
   * there is no main process to read a pane -- and the card then draws no
   * Submit rather than one that cannot send.
   */
  readonly answer?: (
    projectId: string,
    request: AnswerRequest,
    rowId?: string,
  ) => Promise<AnswerResult>;
  /**
   * The bridge that READS the question a session is asking that nothing wrote
   * down -- a tool-approval prompt, which has no transcript record while it is
   * open and so can never become an `AgentQuestion`.
   *
   * Beside `answer` because it is the other half of one act: what this returns
   * is what the card offers, and the labels it offers are matched back against
   * the same screen. `undefined` in the browser build, and the card is then
   * simply not drawn for that shape -- structural absence, not a control that
   * refuses when pressed.
   */
  readonly prompt?: (projectId: string, rowId?: string) => Promise<PromptView>;
  /**
   * The bridge that reads WHICH MODEL this row's session is running, off the
   * CLI's own status line in the pane vam started for it.
   *
   * Injected here rather than reached for inside the control, exactly as
   * `prompt` and the Terminal tab's three members are: a member wired
   * invisibly is one refactor away from being dropped with nothing to notice,
   * and a test that cannot hand this a fake would have to fake a global to say
   * anything at all.
   *
   * `undefined` in the browser build, and then the model button wears the word
   * it has always worn -- structural absence, never a name vam made up. The
   * same is true of every answer that is not a name (`shared/terminal.ts`):
   * this control has ONE fallback, not two.
   */
  readonly model?: (projectId: string, rowId?: string) => Promise<SessionModel>;
  /**
   * Whether the focused session's source has a terminal surface --
   * `capabilities.terminal`, passed down exactly as `delivers` is.
   *
   * `false` WITHDRAWS THE TAB. It was declared by the source and read by
   * nothing while the tab mounted unconditionally, so the flag could be
   * flipped either way with no visible effect -- a capability nobody reads is
   * worse than none, because the next person trusts it. Absent means the
   * caller said nothing and the tab stays, which is the same reading `delivers`
   * gives its own absence.
   */
  readonly terminal?: boolean;
  /**
   * Whether THIS BUILD can show a file editor at all -- `true` only once the
   * caller has confirmed `window.api.files` exists. See `tabs.ts`'s
   * `visibleTabs` header for why this defaults the OPPOSITE way `terminal`
   * does: there is no per-source capability behind Files to read (nothing
   * declares it, nothing ever will -- `CHANNELS.filesRead`'s own header), so
   * `undefined`/`false` both withdraw the tab and only an explicit `true`
   * shows it. Every existing caller of this panel, including every test that
   * predates this tab, keeps Files withdrawn without needing to learn a new
   * prop.
   */
  readonly files?: boolean;
  /**
   * Opens the native image picker for the focused session, scoped to and
   * validated against its own working directory -- present only when
   * `SourceCapabilities.promptAttachments` is true AND this shell can reach
   * main (`sources/port.ts`'s `SourceWrites.pickImageAttachment`). Absent
   * means absent, per the port's own rule: the attach-image button is drawn
   * only when this is a function, never drawn-but-disabled. `undefined` in
   * the browser build, where there is no filesystem to pick from at all, and
   * for any source that has not written a delivery for it.
   */
  readonly pickImageAttachment?: (sessionId: string) => Promise<string | null>;
  /**
   * True while a write is in flight.
   *
   * A reply is a run of tmux `send-keys` into the session's pane (`reply.ts`),
   * each a subprocess of its own, plus the listing that resolves the pane
   * first: quick, but not instant, and a multi-line prompt is several of them.
   * `Canvas` has had the flag since the composer was written -- it guards
   * against a double submit -- and it never reached the pane, so the operator
   * saw nothing happen and every further Enter was swallowed without a word.
   */
  readonly sending?: boolean;
  /**
   * The tab `Mod-<digit>` has just asked for, or null when nothing has
   * been asked.
   *
   * A REQUEST, not the selection: the tab stays this pane's own state, so the
   * bar keeps working with no caller at all and the canvas gets no
   * presentation toggle in its model. A fresh object each press is what keeps
   * asking twice for the same tab an ask, which `Tab | null` could not say.
   */
  readonly tabRequest?: { readonly tab: Tab } | null;
  /**
   * What the last view shortcut REFUSED, drawn as a `role="status"` line
   * beside the icons — or null at rest.
   *
   * A PROP, not state, since `Alt+<digit>` became a real binding: the chord
   * machine in `Canvas.tsx` owns the keystroke now (`pickView`), so it is
   * the only thing that can know a digit was refused. This panel used to
   * hold both the listener and the note; keeping the note here while the
   * listener moved would mean a second listener, which is the whole hole
   * promotion closed.
   */
  readonly viewNote?: string | null;
  /**
   * The tab a previous run left showing, as an OPAQUE STRING, and the way to
   * report a change back.
   *
   * A string rather than a `Tab` because the store it comes from must not know
   * what the tabs are called, and a `prefs.ts` that imported them would gain a
   * dependency on the pane's vocabulary. So the dependency runs the other way
   * -- the store keeps whatever it was handed, and the validating happens
   * HERE, against `TABS`. Anything that is not a current tab name is the default,
   * which makes renaming or withdrawing a tab cost one default tab rather than
   * a migration.
   *
   * Both optional, and the pane works with neither: without them the tab is
   * component state that starts at the default, exactly as it was.
   */
  /**
   * Whether THIS pane is the one holding the keyboard -- the canvas's own
   * `focusedPaneId`, passed down rather than re-derived, because a second
   * notion of focus in this file could disagree with the ring the canvas
   * paints (`data-split-focused`).
   *
   * It gates TWO things, and they are the same claim twice: whether the
   * view-icon overlay is DRAWN, and whether this instance's `Alt+<digit>`
   * listener ANSWERS. Operator instruction -- the four icons repeated in
   * every pane of a split, over content the background pane must not be
   * swapping either. The second half was missing while this comment asserted
   * it, so every pane consumed the key at once; `tabRequest` was already
   * focused-only, and now the two routes agree. Hidden means NOT DRAWN, never
   * drawn-and-inert: `ViewIcons`' promise that each icon is a real button Tab
   * reaches is kept whole in the pane that has focus, and an invisible row
   * still catching clicks would be the worse trade.
   *
   * Defaults to `true`: an unsplit shell is the focused pane, and so is the
   * desktop detail column, which has no pane identity at all.
   */
  readonly paneFocused?: boolean;
  /**
   * The last send in THIS session that failed, or null -- the sentence the
   * status bar already showed, drawn again where the operator is looking.
   *
   * Operator instruction. A refused send rolls its optimistic turn back and
   * puts the words back in the composer, so from the pane a send that failed
   * and a send never attempted were the same picture; the only trace was one
   * line in the status bar that the next act overwrote. The caller owns the
   * string because the caller is the one that performs the send and already
   * holds the sentence (`noteFailure`'s return) -- this component would have
   * to re-derive it from a source it does not talk to.
   *
   * ONE SENTENCE, NOT A LIST. The error log is the history; this is the
   * standing verdict on the last thing the operator tried, and it goes away
   * when they try again.
   */
  readonly sendFailure?: string | null;
  /**
   * The view this pane is showing, when the CALLER owns that fact.
   *
   * WHY A CALLER OWNS IT AT ALL. A view is a per-session choice -- operator
   * instruction: "when session 1 switches to the PRs view, the rest of the
   * sessions do not switch" -- and this component cannot keep that promise by
   * itself. A pane reuses ONE instance for every session it shows, so a view
   * held in local state here is a fact about the PANE, and switching the
   * session tab handed the next session whatever the last one was left on.
   * `Canvas.tsx` keeps a per-session record beside the drafts and action
   * cursors it already keys that way, and names the current session's entry
   * here.
   *
   * An OPAQUE STRING for the same reason `initialTab` is one: the validating
   * happens here, against `TABS`, so a caller need not know the vocabulary.
   *
   * ABSENT means this pane owns its own view, seeded from `initialTab` --
   * what every caller predating the split shell does, and what keeps this
   * component usable on its own.
   */
  readonly tab?: string | null;
  readonly initialTab?: string | null;
  readonly onTabChange?: (tab: string) => void;
  /**
   * The current rendered width (task-1's `renderedWidth`), applied inline.
   *
   * Optional, and ABSENT means full width: a missing width is already the true
   * statement "nobody is sizing me", which is the phone shell's case, and a
   * `'fill'` sentinel would be a second way to say it.
   */
  readonly width?: number;
  /** `PaneResizer`, positioned by the caller — kept out of this file's own concerns. */
  /**
   * Is this pane the whole screen, with an app bar above it?
   *
   * The phone shell draws the session's title and its project in that bar, and
   * this header block drew both again immediately below -- verbatim, ~48px of
   * an 844px screen (UI spec D2). On phone the bar takes the epic and the agent
   * count too, and `data-prompt-target` moves there with them, so the guarantee
   * that hook carries -- SOMETHING on screen names the session about to be
   * written to -- is kept rather than dropped with the block.
   */
  /**
   * WHERE THIS PROJECT'S PULL REQUESTS ARE READ FROM, and the two acts that
   * change it. Built by `Canvas`, which owns `prefs` and `savePrefs`.
   *
   * ABSENT is the browser build and the phone: `dialog` is a desktop bridge,
   * and a control that cannot open a directory picker is a control that cannot
   * act. The PRs list itself still draws -- main applies the override for both
   * surfaces, since one `DESKTOP_SOURCE` serves the IPC and the remote server
   * alike -- so what is missing here is the way to CHANGE it, not the effect.
   */
  readonly prRepo?: {
    /** The chosen directory, or `null` for the session's own. */
    readonly directory: string | null;
    /**
     * What to call the repository when nothing is overridden: the project's
     * own name, which is the one the sidebar groups this session under.
     *
     * Optional because the heading has a truthful fallback without it, and a
     * caller that has not wired it up should get that rather than a blank.
     */
    readonly projectName?: string;
    readonly choose: () => void;
    readonly clear: () => void;
  };
  readonly phone?: boolean;
  /**
   * REPORTS `openQuestion` -- this pane's own "is there a live
   * `AskUserQuestion` on screen right now" fact -- to a caller that has no
   * other route to it.
   *
   * `PhoneShell`'s session-tab strip needs this: the spec (docs/design/
   * phone-core-loop.md §3.2) collapses that strip "whenever a question is
   * open", the same `!typing` condition it already uses for the keyboard.
   * But `openQuestion` is derived HERE, from `entry.session.questions` AND
   * the pane-read fallback (`paneAsk`, a tool-approval prompt with no
   * transcript record) -- both of which are this component's own state, not
   * anything a re-hosting shell reads on its own. A callback is the
   * established route for exactly this shape of fact: `onSuggest` (below)
   * already reports a different piece of this same card's derived state
   * upward for the SAME reason (the composer's Tab-completion ghost).
   *
   * Called on every render where the value could have changed (`useEffect`,
   * keyed on the value itself), never assumed to fire once. Optional: every
   * caller that does not re-host this pane inside chrome of its own (the
   * desktop split) has nothing that needs telling.
   */
  readonly onQuestionOpenChange?: (open: boolean) => void;
  readonly resizeHandle: ReactNode;
  /**
   * Can this source record a prompt at all? Optional, and `undefined` means
   * yes -- every existing caller is a shell whose source can. `false` withdraws
   * the composer rather than drawing one that would be refused.
   */
  readonly records?: boolean;
  /**
   * A15.4: the provider a fresh vam starts NEW sessions with —
   * `prefs.defaultProvider`, read here only to DRAW the current choice next
   * to the model field it used to be merely named beside. Optional, and
   * `undefined` reads as the same default `resolveProvider` (`shared/
   * providers.js`) gives every other unusable value, so a caller that has
   * not wired this up yet still gets a sane label rather than a blank one.
   */
  readonly defaultProvider?: ProviderId;
  /**
   * Persists a NEW default provider, or `undefined` to withdraw the control
   * entirely — ABSENT, NOT DISABLED, the same rule `pickImageAttachment`
   * follows above: a caller with nowhere to put the choice should not draw
   * a button that looks pickable and refuses when pressed.
   *
   * THIS SETS THE GLOBAL DEFAULT, NOT THIS SESSION'S OWN PROVIDER — a fact
   * about the plumbing, not a design choice. `defaultProvider` is read once,
   * at NEW session creation (`sources/http-factory.ts`,
   * `sources/preload-factory.ts`); every reply to a session already running is
   * typed into its pane (`main/sources/claude-code/reply.ts`), which never
   * consults it. A control drawn beside THIS session's composer
   * that claimed to change how ITS next reply is handled would be exactly
   * the lie `setModelRequest`'s own comment refuses elsewhere in this file —
   * there is no channel that would make it true. So the choice made here
   * changes what the NEXT session created starts with, wherever it is
   * started from; it is the same preference Settings writes, reachable from
   * where the operator is already looking.
   */
  readonly onSetDefaultProvider?: (id: ProviderId) => void;
  /**
   * START SESSION, for a row whose pane has nothing in it (`status:
   * 'unstarted'`, `model.ts`). Called with the provider the operator chose
   * on the start screen; the CALLER resolves that id to a command and types
   * it into the pane through `recordPrompt` (`Canvas.tsx`, `startSessionIn`)
   * -- the same keystrokes the Terminal view would take by hand, and nothing
   * spawned. An ID rather than a command crosses this boundary so a renderer
   * cannot send main a word its provider table never listed.
   *
   * Optional, and ABSENT withdraws the button on the same rule as
   * `onSetDefaultProvider`: the screen still says what the row is and how to
   * start something in it (the Terminal view), it just cannot do it from here.
   */
  readonly onStartSession?: (id: ProviderId) => void;
  /**
   * RESUME, for a `terminal` row -- a pane whose agent exited but whose
   * conversation vam still knows (`model.ts`). The SECONDARY action on the
   * getting-started screen, beside Start session: it types
   * `entry.session.resumeCommand` into the pane the row already owns
   * (`recordPrompt`, the same channel `onStartSession` uses) rather than the
   * chosen provider's bare command, so the same conversation continues in the
   * same pane instead of a new one starting over it.
   *
   * Optional, and ABSENT withdraws the button on `onStartSession`'s own rule.
   * Also unoffered, regardless of this prop, when the row carries no
   * `resumeCommand` at all -- vam could not build one, or the status is not
   * `terminal` -- so a caller wires this once and the screen decides per row
   * whether there is anything for it to do.
   */
  readonly onResumeInPane?: () => void;
  /**
   * THE WAIT BETWEEN THE PRESS AND THE AGENT REGISTERING -- for Start session
   * or Resume, whichever this pane's row last pressed. `Canvas.tsx` owns it
   * (`startingPaneByKey`, keyed by `entry.session.pane` so it survives the
   * `unstarted`/`terminal` id changing identity the moment the agent
   * registers -- see that state's own comment) because a `StartSession`-local
   * `useState` would not: this same `DetailPanel` instance is reused across
   * every tab a pane holds (`Canvas.tsx`'s own comment on `renderLeaf`), so a
   * wait that lived in this component's own state would follow the pane to
   * whichever OTHER session the operator switched to next, or vanish the
   * moment they switched away and back.
   *
   * Operator: "after clicking Start session ... there needs to be a loading
   * state while the session is being created." `null`/absent draws the
   * ordinary picker; present freezes it and the Start/Resume buttons until
   * the caller clears it (the row left `unstarted`/`terminal`, or the write
   * itself was refused) or `timedOut` turns the spinner into a quiet link to
   * the Terminal view (see `StartTimeoutHint`) -- vam has nothing further to
   * wait ON, and a spinner with no end is worse than admitting that.
   */
  readonly startingPane?: StartingPaneWait | null;
  /**
   * SWITCH THIS PANE TO ITS TERMINAL TAB -- the escape hatch
   * `StartTimeoutHint` offers once `startingPane.timedOut` is true. Built by
   * the caller from `onTabChange`/`pickTab` (`DetailPanel`'s own, further
   * down) rather than threaded in as a raw setter, so this component never
   * has to know the tab bar's own vocabulary. ABSENT, NOT DISABLED when the
   * Terminal tab itself is withdrawn (no `terminal` capability) -- a link
   * promising a view that is not on the bar would land exactly nowhere.
   */
  readonly onShowTerminal?: () => void;
  /**
   * THE GETTING-STARTED SCREEN'S OWN DATA (`GettingStarted.tsx`) — present
   * only when the CALLER (`Canvas.tsx`) has confirmed vam has no session to
   * show ANYWHERE in the app, not merely that this one pane's `entry` is
   * `null`. A pane can hold nothing while a sibling pane, or another project
   * entirely, still has a real session, and this screen is a statement about
   * the whole app -- so unlike `onStartSession`/`onResumeInPane`, whose
   * absence follows this PANE's own `entry`, this follows a fact this panel
   * cannot derive from its own props and must be handed. `entry !== null`
   * withdraws the screen regardless of what this carries — see the render
   * site's own guard.
   */
  readonly gettingStarted?: GettingStartedProps;
  /**
   * `prefs.filesTreeWidth` — the width the operator last dragged the Files
   * tab's tree to, or `null`/absent for "never dragged", which draws the
   * clamped share that tree has always drawn. Read here only to hand on to
   * `FilesTab`; this panel has no opinion about it.
   */
  readonly filesTreeWidth?: number | null;
  /**
   * Persists a new tree width, or `undefined` to withdraw the drag handle
   * entirely — ABSENT, NOT DISABLED, the same rule `onSetDefaultProvider`
   * above follows: a caller with nowhere to put the number must not draw a
   * grip that looks draggable and springs back the moment it is released.
   *
   * GLOBAL, not this pane's and not this session's — see the field's own
   * comment in `prefs.ts` for why an arrangement the operator would otherwise
   * re-make on every split is stored once.
   */
  readonly onFilesTreeWidth?: (width: number) => void;
  /**
   * Persists the operator's raw/preview choice for `.md` files, or
   * `undefined` to withdraw the write — `onFilesTreeWidth`'s own rule, one
   * field up. Read here only to hand on to `FilesTab`; this panel has no
   * opinion about which mode a document opens in, only `prefs.ts` and
   * `FilesTab.tsx`'s own `activeFilesMarkdownView()` do.
   */
  readonly onFilesMarkdownView?: (view: 'preview' | 'raw') => void;
};

/**
 * The four views. All four now select something.
 *
 * `Agents` joined `Response` when a source that actually reports a roster
 * arrived (`Session.agents`), `PRs` joined them when one learned to ask `gh`,
 * and `Terminal` was the last placeholder: it had no data source because vam
 * held no PTY, and the tmux provider is that source. Nothing in `TABS` is a
 * label any more, so the `data-placeholder` branch that drew the inert ones is
 * gone with it.
 *
 * The list itself now lives in `tabs.ts`, and re-exported rather than moved
 * because `Alt+<digit>` (A12.2, A5.4) counts POSITIONS in the DRAWN bar: the
 * count had to become something the handler and the key sheet could read
 * without importing this component, and a handler with its own idea of how
 * many views there are is a fifth digit that opens nothing.
 */
export { TABS, type Tab } from './tabs.js';

/**
 * The three modes, and which one the draft says is current.
 *
 * They were a row of pills under the prompt input; the operator asked for one
 * ICON, beside the model field, showing only the mode that is current. The
 * list stays whole because all three must still be REACHABLE — the icon opens
 * a small popover over it, the pattern the provider picker beside it already
 * set, rather than a second idea of what a chooser looks like in this row.
 */
const MODES = ['Auto', 'Manual', 'Plan'] as const;

type Mode = (typeof MODES)[number];

/**
 * HOW EACH MODE IS DRAWN AND WHAT IT MEANS — one row per mode, because the
 * four facts below all answer the same question and a reader who knows one has
 * to be able to find the others.
 *
 * THE GLYPH, chosen for what the mode MEANS and not for decoration — two that
 * read alike would make the control unreadable at a glance.
 *
 * THE HUE, at the operator's ask: "the icon needs to be filled with colour
 * (for example auto is yellow)." Until then the glyph was `ink-dim` in all
 * three states, so SHAPE was the only channel that said which mode was
 * current — and shape is the one an operator has to already know the key for.
 * The three tokens are in `styles.css`, under their own names rather than
 * borrowed from the status palette; that comment carries the whole argument
 * and the measured ratios.
 *
 * WHETHER IT IS FILLED, AND THIS IS A MEASUREMENT RATHER THAN A TASTE. Lucide
 * ships strokes, and "fill it" is not free on a stroke: rendered at the real
 * 12px and at 64px on this card, `Sparkles` fills into a solid four-point star
 * and reads BETTER filled than stroked, but `Hand` is four OPEN finger
 * outlines and filling each one closes it into a wedge — the open hand becomes
 * a fist, which is a different gesture, not a bolder hand. `ListChecks` is
 * three zero-area rules and two check polylines, so a fill paints nothing at
 * all at 12px and turns the ticks into solid arrowheads above it. So the fill
 * goes where it survives and the other two take their colour on the STROKE,
 * one weight heavier so the three read as one control rather than as a solid
 * mark beside two hairlines.
 *
 * A FILLED GLYPH CARRIES NO STROKE, at the operator's second ask: "in the
 * mode switch in the prompt input, when the mode is filled it should not have
 * a stroke, or the icon looks too thick." It was drawn both ways at once --
 * `Sparkles` was filled in `currentColor` AND stroked at 1.7 on top of the
 * fill, which at 12px puts most of a pixel of extra ink outside every edge of
 * a shape that is already solid. The star read as a blob beside two hairline
 * glyphs. So the two channels are now exclusive, and that is the invariant
 * `DetailPanel.mode-icon.test.tsx` states over the RENDERED glyphs and
 * `e2e/prompt-mode-icon-shots.mjs` re-asks of the paint: FILLED means
 * `strokeWidth: 0`, STROKED means `fill: 'none'`. Nothing is drawn twice.
 *
 * WHAT DROPPING THE STROKE COSTS, measured in the browser rather than guessed:
 * `Sparkles` is four shapes, and `getBBox` gives them as 20x20 (the star), 0x4,
 * 4x0 and a 4x4 circle. The two middle ones are ZERO-AREA -- they exist only as
 * a stroke, the little cross above the star -- so at `strokeWidth: 0` they paint
 * nothing and the mark becomes the star and its dot. That is a real loss and it
 * is accepted rather than unnoticed: at the shipped 12px those accents were two
 * four-unit hairlines, and the star is what carries the glyph. The same
 * arithmetic is why `ListChecks` could never be filled -- three of its five
 * shapes are zero-area, so a fill paints almost nothing at all.
 *
 * THE SENTENCE, which used to be this comment's own gloss and is now shipped:
 * the tooltip says which mode is current and what that mode does, because a
 * hue means nothing until something names it.
 */
type ModeSkin = {
  readonly Glyph: typeof Sparkles;
  /** The `text-mode-*` utility, one per mode — see `styles.css`. */
  readonly ink: string;
  /** `currentColor` where the glyph survives being filled, `none` where it does not. */
  readonly fill: 'currentColor' | 'none';
  /** Zero wherever `fill` is `currentColor` -- the two channels are exclusive. */
  readonly strokeWidth: number;
  /** What the mode does, in the operator's terms, for the tooltip. */
  readonly means: string;
};

const MODE_SKIN: Readonly<Record<Mode, ModeSkin>> = {
  Auto: {
    Glyph: Sparkles,
    ink: 'text-mode-auto',
    fill: 'currentColor',
    strokeWidth: 0,
    means: 'the agent decides its own next step',
  },
  Manual: {
    Glyph: Hand,
    ink: 'text-mode-manual',
    fill: 'none',
    strokeWidth: 2.2,
    means: 'a hand on each step',
  },
  Plan: {
    Glyph: ListChecks,
    ink: 'text-mode-plan',
    fill: 'none',
    strokeWidth: 2.2,
    means: 'it writes the list before it touches anything',
  },
};

/**
 * The mode icon, drawn the one way — in the toggle and in the popover's three
 * options both, because the picker is where an operator LEARNS which hue is
 * which and a coloured toggle over a grey list would teach nothing.
 */
function ModeGlyph({ mode }: { readonly mode: Mode }) {
  const skin = MODE_SKIN[mode];
  return (
    <skin.Glyph
      data-mode-glyph={mode.toLowerCase()}
      size={12}
      fill={skin.fill}
      strokeWidth={skin.strokeWidth}
      className={skin.ink}
    />
  );
}

/**
 * One glyph per view — chosen for what each shows, not decoration. `Agents`
 * draws `Bot`, matching `phone/PhoneShell.tsx`'s own `VIEW_ICON` — the
 * operator's ask, and the two shells drifting apart otherwise (this one
 * drew `Users`, lucide's generic person glyph, for the same view).
 */
const VIEW_ICON: Readonly<Record<Tab, typeof MessageSquare>> = {
  Response: MessageSquare,
  PRs: GitPullRequest,
  Terminal: SquareTerminal,
  Agents: Bot,
  Files: FileText,
};

/**
 * A12.2: the four views stop being a labelled pill row and become small
 * ICONS in the top-right of the tab — the operator's own words, "they stop
 * being called tabs", now that a session IS a tab (A11) and calling both
 * things the same word is the collision the sidebar's project/repo naming
 * already hit once.
 *
 * ICON-ONLY DOES NOT MEAN UNLABELLED. `aria-label` carries the NAME — just
 * the name, since the operator asked for tooltips here. It used to end
 * `— Alt+N`, with a byte-identical `title` beside it, and both are gone:
 *
 *   - the chord in the accessible NAME is announced on every focus of all
 *     four buttons and cannot be dismissed, which is noise a screen-reader
 *     user pays for four times over;
 *   - and it was a LITERAL. `Alt+<digit>` is a real binding now (`pickView`
 *     in `keyboard/chords.ts`), so an operator who rebinds it would have
 *     been left with a name announcing a key that does nothing — the
 *     "caption that lies" this project already deleted from the key sheet.
 *   - the `title` was the same string a second time, and the worse copy: no
 *     browser opens one on keyboard focus, so it was invisible to the
 *     primary input device of a keyboard-first tool.
 *
 * The shortcut lives in `ShortcutTip` instead, which re-reads the binding
 * table on every open, and in the generated key sheet. Derived in both, so
 * neither can go stale — and `ShortcutTip` prints NOTHING for an unbound
 * action rather than an empty bracket.
 *
 * The Agents badge survives unchanged (a real source, omitted at zero) and
 * is now the ONLY place the running-agent count is shown in this pane, which
 * is why the count stays in the name — see the identity line in the `in`
 * block for why the header's old "N agents" line does not need a second
 * home.
 *
 * EVERY ICON IS STILL A REAL <button> — Tab reaches it, Enter and Space
 * activate it, `aria-pressed` says which one is showing. That property is
 * what this file has always meant by "not a keyboard trap with a hover
 * state", and shrinking the control to an icon does not get to spend it.
 */
function ViewIcons({
  tabs,
  runningAgents,
  current,
  onSelect,
}: {
  /** The views this source offers -- `TABS` minus the ones it has said it lacks. */
  readonly tabs: readonly Tab[];
  readonly runningAgents: number;
  readonly current: Tab;
  readonly onSelect: (tab: Tab) => void;
}) {
  return (
    // A `nav`, not a `tablist`. The role was an orphan: switching a body it
    // does not own, this bar never had a `tabpanel` and there is none anywhere
    // in this file, so `aria-required-children` failed (WCAG 1.3.1, Level A)
    // on the one platform where a screen reader is standard equipment. It is a
    // segmented control, `aria-pressed` is what one says, and `StepRail` in
    // `phone/PhoneShell.tsx` reached the same conclusion first.
    <nav
      aria-label="views"
      /* This bar is DESKTOP-ONLY now -- see the `phone` gate at its call site.
         The phone's own icon row deliberately does NOT wear this hook, so no
         rule written for a desktop bar can silently collect it. */
      data-view-tabs
      /* `pointer-events-auto` opts back into clicks the corner overlay's own
         wrapper declines (A15.5) — without it these buttons would be inert,
         not merely see-through. The pill fill (`bg-pane`, matching the
         pane) plus a hairline border is what keeps the glyphs legible over
         whatever scrolls beneath rather than letting icon and letterform
         overlap into noise. */
      className="pointer-events-auto flex flex-none items-center gap-1 rounded-[9px] border border-line-strong bg-pane px-1 py-1 shadow-sm"
    >
      {tabs.map((tab) => {
        const selected = tab === current;
        const badge = tab === 'Agents' && runningAgents > 0 ? runningAgents : null;
        const Icon = VIEW_ICON[tab];
        // The digit named here MUST be `tab`'s own fixed slot in `TABS`, not
        // its position in `tabs` (the drawn list): `visibleTabs` withdraws
        // Terminal without renumbering anything after it (A15.6), so
        // captioning from `tabs`' own index would tell the operator to press
        // a digit `tabForDigit` refuses — the exact defect fixed there, just
        // spoken instead of wired.
        const digit = TABS.indexOf(tab) + 1;
        const name = badge === null ? `${tab} view` : `${tab} view, ${badge} running`;
        return (
          // The chord is READ from the table on every open, off the same
          // fixed digit the name is derived from -- so a rebind moves the
          // hint, and an unbound view simply shows its name.
          <ShortcutTip key={tab} label={name} action={{ kind: 'pickView', digit }}>
            <button
              type="button"
              data-view={tab.toLowerCase()}
              aria-pressed={selected}
              aria-label={name}
              onClick={() => onSelect(tab)}
              className={[
                'vam-tap relative flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-[7px]',
                selected
                  ? 'bg-line-strong text-ink'
                  : // `raised`, NOT `line-strong` like the card-backed menus
                    // further down this file. This bar sits on `bg-pane`, where
                    // `raised` is already the rung above the ground -- and
                    // `line-strong` is what SELECTED wears one line up, so
                    // hovering to it would make an unselected tab
                    // indistinguishable from the open one.
                    'text-ink-dim hover:bg-raised hover:text-ink',
              ].join(' ')}
            >
              <Icon size={13} strokeWidth={1.7} aria-hidden="true" />
              {badge !== null && (
                <span
                  data-view-badge
                  /* THE PAINT IS NOT THE ANNOUNCEMENT: the count is in the
                     button's own `aria-label` above, so drawing it twice
                     would have a screen reader say it twice. */
                  aria-hidden="true"
                  /* `running`, NOT `waiting`, and this is a correction rather
                     than a preference. Amber has one meaning in this app and
                     `styles.css` states it at `--color-waiting`: a session
                     blocked on your answer. This badge counts agents that are
                     RUNNING, so wearing amber made a working session read as
                     one needing intervention -- on the row where that is the
                     most expensive thing to get wrong. Green is the hue this
                     count already owns.

                     And the numeral could not be read either way: pale ink on
                     that amber measured 1.834:1 in dark and 2.499:1 in light,
                     against WCAG 1.4.3's 4.5. `on-running` is the ink the
                     green fill needs (11.36:1 / 7.13:1), and 9px of mono in a
                     13px circle goes up to 10.5 in 16 -- the smallest badge
                     that fits two digits at that size without clipping. */
                  className="absolute -top-[4px] -right-[4px] flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-running px-[4px] font-mono text-meta text-on-running leading-none"
                >
                  {badge}
                </span>
              )}
            </button>
          </ShortcutTip>
        );
      })}
    </nav>
  );
}

/**
 * How a pull request's checks are drawn: A SHAPE AND THEN A HUE, which is
 * `status-mark.tsx`'s house rule carried to a second vocabulary.
 *
 * IT WAS FOUR DISCS DIFFERING ONLY IN COLOUR, and two things were wrong with
 * that at once.
 *
 * The first is WCAG 1.4.1: hue alone is the channel that is missing for
 * somebody, and this mark is the only carrier of the checks verdict on any row
 * whose rail is saying something more severe -- `conflicts` and
 * `changes requested` both outrank a checks word in `prVerdict` below, so on
 * those rows the disc was the whole answer.
 *
 * The second is that one of the four discs was not visible at all.
 * `none` was `bg-line-strong` on `bg-card`, MEASURED at 1.713:1 in dark and
 * 1.457:1 in light against WCAG 1.4.11's 3:1 floor for a non-text mark --
 * a 6px speck the operator could not see, reporting "this repository runs no
 * checks" to nobody. `text-ink-faint` is 6.17:1 / 5.38:1 and says the same
 * quiet thing legibly; the argument for keeping `none` QUIET is unchanged --
 * a repository with no checks configured has nothing to report, and painting
 * it green would be the pane inventing a passing build.
 *
 * `none` KEEPS THE CIRCLE, at rest: the house's "nothing is happening" shape
 * (`status-mark.tsx`'s `idle`), and the only glyph here that draws no verdict.
 *
 * NOT `StatusMark` ITSELF. That component is typed on `SessionStatus`, and a
 * pull request's checks are a different vocabulary with a different ladder --
 * making it take both would be one table answering two questions. The LANE is
 * shared, though, imported rather than retyped, so the two marks are the same
 * size wherever they meet.
 */
const CHECK_MARK: Record<
  PullRequest['checks'],
  { readonly glyph: (size: number) => ReactElement; readonly ink: string; readonly label: string }
> = {
  passing: {
    glyph: (size) => <Check size={size} strokeWidth={2} />,
    ink: 'text-running',
    label: 'checks pass',
  },
  failing: {
    glyph: (size) => <TriangleAlert size={size} strokeWidth={1.8} />,
    ink: 'text-failed',
    label: 'checks fail',
  },
  pending: {
    /* `.vam-spin` is the stylesheet's own rule and is not scoped to a
       sidebar mark, so it reaches here unchanged. WHAT IT DOES NOT BRING is
       `status-mark.tsx`'s two-body reduced-motion swap: that swap is keyed on
       `[data-status-mark]` in `styles.css`, so under
       `prefers-reduced-motion` this arc parks rather than becoming a whole
       ring. Stated rather than discovered: the hue and the rail's own
       `checks running` both still carry the fact, and closing the gap
       properly means a stylesheet rule, which this change deliberately does
       not touch. */
    glyph: (size) => <LoaderCircle className="vam-spin" size={size} strokeWidth={1.8} />,
    ink: 'text-waiting',
    label: 'checks running',
  },
  none: {
    glyph: (size) => <Circle size={size} strokeWidth={1.8} />,
    ink: 'text-ink-faint',
    label: 'no checks',
  },
};

/**
 * THE ONE WORD THE RAIL SAYS ABOUT READINESS, and the ladder that picks it.
 *
 * THE ROW USED TO DRAW UP TO FOUR OF THESE AT ONCE, from four different
 * vocabularies -- `open` (GitHub's state), `checks fail` (a CI verdict),
 * `review required` (a review decision) and `conflicts` (a mergeability
 * ruling) -- wrapped across two or three bands, in an order decided by how
 * they happened to fit. The operator's report was that the cluster "all runs
 * together", and four words from four vocabularies with no ranking between
 * them is what that is.
 *
 * SO THE SLOT HOLDS EXACTLY ONE WORD: the most severe LIVE BLOCKER. The order
 * below is the order in which a blocker has to be dealt with, so the word the
 * reader gets is the one that is in the way next.
 *
 * `review required` IS NOT ON THE LADDER AT ALL. It is GitHub's default for
 * every open pull request with a requested reviewer: it is implied by `open`,
 * it never changes a decision, and it was the field doing most of the wrapping
 * -- it is what pushed the conflicting row onto a third band. It stays in the
 * row's accessible sentence (`prSentence`), so a reader who stops on the row
 * still has it; it is off the PAINT, where it was costing a slot.
 *
 * `approved` is dropped as a rail word for the same kind of reason: a row
 * whose state reads `open` and whose verdict reads `checks pass` IS the ready
 * row, and a green `approved` beside it is a second way to say so.
 *
 * `checks pass` DOES duplicate the mark to its left, and that is deliberate:
 * the mark is the only other carrier, and a word is what keeps the fact off a
 * hue-only channel on the rows where the ladder gives the slot to something
 * more severe.
 */
function prVerdict(pr: PullRequest): { readonly label: string; readonly ink: string } {
  if (pr.mergeable === 'conflicting') return { label: 'conflicts', ink: 'text-danger' };
  if (pr.review === 'changes-requested') return { label: 'changes requested', ink: 'text-danger' };
  if (pr.checks === 'failing') return { label: 'checks fail', ink: 'text-failed' };
  if (pr.checks === 'pending') return { label: 'checks running', ink: 'text-waiting' };
  return { label: CHECK_MARK[pr.checks].label, ink: 'text-ink-faint' };
}

/**
 * The one word each review decision gets. NO INK BESIDE IT ANY MORE: none of
 * the three is painted on the row, so a colour for them would be a token
 * nothing renders.
 */
const PR_REVIEW_WORD: Record<NonNullable<PullRequest['review']>, string> = {
  approved: 'approved',
  'changes-requested': 'changes requested',
  'review-required': 'review required',
};

/**
 * EVERYTHING THE RAIL KNOWS, AS ONE SENTENCE, for a reader who is not looking
 * at the paint.
 *
 * The rail draws two words where it used to draw four, and the two it stopped
 * drawing -- `review required`, `approved` -- were dropped because they cost a
 * slot and changed no decision, NOT because the row stopped knowing them. This
 * is where they stay: on the row control's accessible name, which no
 * `innerText` reads and no pixel is spent on.
 */
function prSentence(pr: PullRequest): string {
  const parts = [pr.state, CHECK_MARK[pr.checks].label];
  if (pr.review !== null) parts.push(PR_REVIEW_WORD[pr.review]);
  if (pr.mergeable === 'conflicting') parts.push('conflicts');
  return parts.join(', ');
}

/** The one word each state gets. `draft` is not a kind of `open`. */
const PR_STATE_INK: Record<PullRequest['state'], string> = {
  open: 'text-running',
  draft: 'text-ink-faint',
  merged: 'text-done',
  closed: 'text-ink-dim',
};

/**
 * The PRs tab's content: what GitHub said about this session's branch, or why
 * vam could not ask.
 *
 * THREE STATES, AND THE TWO EMPTY ONES ARE THE WHOLE POINT (model.ts). Absent
 * is a source with no pull-request surface at all. `ok` with an empty list is
 * vam having asked GitHub and been told none -- the ONE true empty case.
 * `unavailable` is vam not having found out, and it renders the reason `gh`
 * gave, verbatim, because "run `gh auth login`" is only actionable if the
 * operator can see that authentication is what is wrong.
 *
 * An empty list drawn for a failure would tell the operator there is nothing
 * to look at, on the strength of never having looked. That is the failure
 * this component is shaped to make impossible.
 */
function PullRequestsTab({
  pullRequests,
  repo,
  sessionId,
  bridge,
  reserveCornerHeight = 0,
  now = () => new Date(),
}: {
  readonly pullRequests: PullRequestList | undefined;
  readonly repo?: DetailPanelProps['prRepo'];
  /**
   * WHOSE pull requests these are, for the action channel. Main turns this
   * into the directory to act in -- the renderer never names one, which is
   * what keeps a pane from acting on a repository its session is not in
   * (`src/main/pr/ipc.ts`).
   */
  readonly sessionId: string | null;
  /**
   * The desktop bridge, or `undefined` in the browser build and on the phone.
   * ABSENT, NOT DISABLED: with no bridge the list still reads -- it comes
   * through the source, which works everywhere -- and simply grows no controls
   * that could not act.
   */
  readonly bridge?: PrsBridge;
  /**
   * How far the floating view pill reaches DOWN into this tab, in px, or 0
   * when no pill is drawn (an unfocused pane, the phone). Passed rather than
   * measured, for the reason `cornerReserveHeight` gives at its declaration:
   * measuring the pill in a layout effect and re-rendering with the result
   * is what unpinned a column once already. See the `<ul>` below.
   */
  readonly reserveCornerHeight?: number;
  /** Injected so the relative time in a row is testable against a fixed instant. */
  readonly now?: () => Date;
}) {
  /**
   * WHAT THE LAST ACTION SAID -- gh's own sentence, or vam's refusal.
   *
   * ONE NOTE FOR THE WHOLE TAB rather than one per row, because there is only
   * ever one action in flight (main's runner refuses a second) and a column of
   * stale sentences beside rows that have moved on is worse than the one
   * current answer. It carries the pull request number so the operator can see
   * which row the sentence is about.
   */
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  /** The question standing in front of an irreversible act, or nothing. */
  const [asking, setAsking] = useState<PendingPrAction | null>(null);
  /**
   * IS ONE ALREADY RUNNING. Main refuses a second write outright -- that is
   * the real bar, and it is on the far side of the process boundary. THIS is
   * the half the operator can see: a merge waits on GitHub, so the button is
   * slow, so it gets pressed again, and a second press that simply vanished
   * would be indistinguishable from a button that does not work. So the second
   * press is REFUSED IN WORDS here rather than sent and silently dropped.
   */
  const [running, setRunning] = useState(false);

  const ask = (pending: PendingPrAction) => {
    if (running) {
      setNote({ ok: false, text: 'vam is already running a pull request action — wait for it.' });
      return;
    }
    setNote(null);
    setAsking(pending);
  };

  const go = (pending: PendingPrAction) => {
    setAsking(null);
    const act = bridge?.act;
    if (act === undefined || sessionId === null) return;
    setRunning(true);
    void act(sessionId, pending.action)
      .then((outcome) => {
        // gh's OWN words, success or failure. "the merge failed" is not
        // actionable; "the base branch policy prohibits the merge" is.
        setNote({ ok: outcome.ok, text: outcome.message });
      })
      .catch((error: unknown) => {
        setNote({
          ok: false,
          text: error instanceof Error ? error.message : 'that action failed.',
        });
      })
      .finally(() => setRunning(false));
  };

  const open = (url: string) => {
    const openIt = bridge?.open;
    if (openIt === undefined) return;
    setNote(null);
    void openIt(url).then((outcome) => {
      // A browser that declined must not look like one that opened.
      if (!outcome.ok) setNote({ ok: false, text: outcome.reason });
    });
  };

  /**
   * WHICH DIRECTORY THIS PANE IS ASKING FROM, and how to point it elsewhere.
   *
   * THE PROBLEM, IN THE OPERATOR'S WORDS: a session started from an
   * orchestrator or a factory runs in that factory's directory, so the pane
   * reports the factory's pull requests while the work is in another
   * repository. Nothing on screen said which directory was being asked, so the
   * answer looked wrong rather than aimed wrong.
   *
   * A HEADING, AT THE TOP, ON THE OPERATOR'S SECOND LOOK. It shipped as a
   * footer under the list, on the argument that the way to change something
   * belongs beside the answer it changes. That was the wrong way round: the
   * repository is what this whole pane is ABOUT, and a reader who has to reach
   * the bottom to learn which one they are looking at has already read the
   * list under the wrong assumption. "Put a heading section at the top -- the
   * current repo on the left, choose-another on the right, as a button."
   *
   * SO IT IS DRAWN ALWAYS, not only when overridden. A name is not a sentence:
   * the old row spent a line saying "asking in this session's own directory",
   * which restated the default forever; a heading reading `factory` is the
   * same fact as a label, and it is the one the reader needs BEFORE the list
   * rather than after it.
   *
   * The way back out (`prs.repo.clear`) draws only once there is something to
   * go back from, and sits inboard of the button rather than beside the name:
   * a control that undoes nothing is not drawn at all, and the choose button
   * stays in one place whether or not it is there.
   */
  /**
   * THE NAME OF THE REPOSITORY THIS PANE IS ASKING IN.
   *
   * The last segment of the chosen directory, which is what a repository is
   * called, or the project's own name when nobody has chosen one. A heading is
   * a NAME: the full path is on `title`, where it settles which of two
   * checkouts this is without spending the row on it.
   */
  const repoName =
    repo?.directory === null || repo?.directory === undefined
      ? (repo?.projectName ?? t('prs.repo.session'))
      : (repo.directory.replace(/\/+$/, '').split('/').pop() ?? repo.directory);
  const heading =
    repo === undefined ? null : (
      <div
        data-prs-repo
        data-prs-repo-overridden={repo.directory === null ? undefined : 'true'}
        className="flex flex-none items-center gap-2 border-line border-b pb-2"
      >
        <span
          data-prs-repo-name
          title={repo.directory ?? undefined}
          className="min-w-0 flex-1 truncate font-medium text-control text-ink"
        >
          {repoName}
        </span>
        {repo.directory === null ? null : (
          <button
            type="button"
            data-prs-repo-clear
            onClick={repo.clear}
            className={`vam-hit-24 flex-none cursor-pointer rounded px-1 text-ink-faint text-meta hover:text-ink ${FOCUS_RING}`}
          >
            {t('prs.repo.clear')}
          </button>
        )}
        <button
          type="button"
          data-prs-repo-choose
          onClick={repo.choose}
          className={`vam-hit-24 flex-none cursor-pointer rounded border border-line px-2 py-0.5 text-ink-dim text-meta hover:border-line-loud hover:text-ink ${FOCUS_RING}`}
        >
          {t('prs.repo.choose')}
        </button>
      </div>
    );
  const framed = (body: ReactNode) => (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {heading}
      {body}
    </div>
  );
  if (pullRequests === undefined) {
    return framed(
      <p data-prs data-prs-absent className="text-control text-ink-faint">
        This source does not report pull requests for a session.
      </p>,
    );
  }
  if (pullRequests.kind === 'unavailable') {
    return framed(
      <p
        data-prs
        data-prs-unavailable
        data-prs-code={pullRequests.code}
        className="text-control text-ink-faint"
      >
        {/* vam could not ask. Not "there are none". */}
        {pullRequests.message}
      </p>,
    );
  }
  if (pullRequests.prs.length === 0) {
    return framed(
      <p data-prs data-prs-empty className="text-control text-ink-faint">
        This branch has no pull request on GitHub.
      </p>,
    );
  }
  const at = now();
  return framed(
    <>
      <ul
        data-prs
        /**
         * THE CORNER THE VIEW PILL FLOATS OVER, RESERVED -- and it is this
         * change that made it necessary.
         *
         * `data-view-overlay` is absolutely positioned at the pane's top
         * right and reaches ~34px down into whatever is below it. That cost
         * nothing while this row stacked everything into ONE LEFT COLUMN:
         * the top right of the first row was empty, so the pill floated over
         * blank card. Putting the status rail there puts the first row's
         * state word, checks and diff directly under it -- laid out, measured
         * as visible by every rectangle check, and then PAINTED OVER. That is
         * audit F1's exact shape, and the same one the identity line was
         * deleted for.
         *
         * DOWNWARDS, NOT SIDEWAYS. `reserveCorner` (the width) would take
         * ~96px off the right of EVERY row to clear a pill that overhangs
         * only the first; the height clears it for the one row it touches and
         * costs the others nothing. Zero when the pane is unfocused, because
         * an unfocused pane paints no pill at all.
         *
         * MEASURED AS OCCLUSION, not as a rectangle: `e2e/prs-tab-shots.mjs`
         * asks `elementFromPoint` what is on top of each status glyph, which
         * is the only question that can see a half-buried control.
         */
        style={reserveCornerHeight > 0 ? { paddingTop: reserveCornerHeight } : undefined}
        className="vam-no-scrollbar flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
      >
        {pullRequests.prs.map((pr) => (
          <PullRequestRow
            key={pr.number}
            pr={pr}
            now={at}
            /* WITHDRAWN, NOT DISABLED, three times over: no bridge (the
               browser build), nothing to open (an address vam would refuse,
               which the reader already turned into `null`), and no session to
               act for. Each absence removes a control rather than drawing one
               that refuses under a finger. */
            onOpen={bridge?.open === undefined ? null : open}
            onAsk={bridge?.act === undefined || sessionId === null ? null : ask}
          />
        ))}
      </ul>
      {note === null ? null : (
        <p
          data-pr-note
          data-pr-note-ok={note.ok ? 'true' : undefined}
          /* `aria-live`: this sentence appears without anything moving focus,
             which is precisely the case a screen reader is otherwise not told
             about. */
          aria-live="polite"
          className={`flex-none select-text text-control ${note.ok ? 'text-ink-dim' : 'text-danger'}`}
        >
          {note.text}
        </p>
      )}
      {asking === null ? null : (
        <ConfirmPrAction
          verb={asking.verb}
          number={asking.number}
          title={asking.title}
          consequence={asking.consequence}
          command={asking.command}
          onConfirm={() => go(asking)}
          onCancel={() => setAsking(null)}
        />
      )}
    </>,
  );
}

/**
 * The bridge the PRs tab acts through. Named here rather than reached for
 * inside the tab, for the reason `TerminalTab`'s three members are passed from
 * the call site: a fact reached for invisibly is a fact a later edit drops
 * with nothing to notice.
 */
type PrsBridge = NonNullable<typeof globalThis.window extends never ? never : Window['api']>['prs'];

/** A question waiting to be answered, and everything needed to draw it. */
type PendingPrAction = {
  readonly verb: string;
  readonly number: number;
  readonly title: string;
  readonly consequence: string;
  readonly command: string;
  readonly action: PrAction;
};

/**
 * THE WIDTH AT WHICH A PULL REQUEST ROW HAS TWO SIDES.
 *
 * WRITTEN OUT AS `356` IN EVERY CLASS BELOW, and this constant is what a test
 * reads rather than what the markup interpolates -- the same bargain
 * `AGENT_SPLIT_PX` makes and for the same reason: Tailwind finds classes by
 * scanning source TEXT for complete strings, so `@min-[${PR_SPLIT_PX}px]:…`
 * is not a string it can find and the rule would simply never be generated.
 * The row would then be one column at every width, silently, which is the
 * exact shape this repo has already shipped once.
 *
 * A CONTAINER QUERY, NOT A VIEWPORT ONE. The detail pane is resizable between
 * `DETAIL_MIN` (320) and `DETAIL_MAX` (520), so a desktop pane can be
 * NARROWER than a phone screen. Asking the viewport would put two columns in
 * a 320px pane and one column on a 390px phone -- both backwards.
 *
 * 356 IS MEASURED, NOT CHOSEN. The status rail is `PR_STATUS_PX` wide because
 * that is what both of its fixed lines add up to, and the split's gap takes 12
 * more. What is left for identity at 356 is 188px, less the checks mark's lane
 * (`MARK_LANE_PX`, 14) and its 8px gap: 166px of title. Below that a title
 * stops being a title and becomes two words and an ellipsis, so below that the
 * two sides STACK instead of crushing each other. Measured against the paint in
 * `e2e/prs-tab-shots.mjs`, which walks the row's own container across the
 * seam and asserts where it actually falls -- a class that was merely TYPED
 * proves nothing about what paints.
 *
 * WHAT IT MEANS IN PRACTICE: vam's default pane and its widest both split;
 * the narrowest legal pane (`DETAIL_MIN`, 320) and the 390px phone both
 * stack. The phone landing on the stacked side is not a compromise -- a 390px
 * screen has no room for two columns of eleven fields, and the one thing
 * worse than a row that stacks is a row that clips.
 */
export const PR_SPLIT_PX = 356;

/**
 * HOW WIDE THE STATUS RAIL IS above the split, typed as `w-[156px]` below for
 * the reason `PR_SPLIT_PX` gives.
 *
 * 156 IS THE SUM OF BOTH FIXED LINES, which is a DERIVATION and not a
 * measurement of any string: `PR_SLOT_STATE` + 6 + `PR_SLOT_VERDICT` is
 * 46 + 6 + 104, and `PR_SLOT_DIFF` + 6 + `PR_SLOT_FILES` is 94 + 6 + 56. Both
 * lines fill the rail exactly, which is what lets its right edge stay flush
 * while every slot's left edge lands on the same x on every row -- and it is
 * why line one could be rebalanced to fit its longest phrase without anything
 * outside the rail noticing.
 *
 * IT WAS 168, AND THE NUMBER WAS WRONG IN THE DIRECTION ITS OWN COMMENT
 * CLAIMED IT WAS RIGHT. That comment said 168 was "the widest natural line
 * the rail holds". Scanned pixel by pixel out of the committed desktop
 * screenshot, the widest INKED band in the whole rail was 132px
 * (`review required conflicts`), and the rail's leftmost 36px was never
 * painted on any of the five rows. So the rail was carrying 36px of
 * guaranteed-blank width taken out of the title, on the strength of a
 * sentence about a line that does not exist. What replaced the claim is an
 * arithmetic identity over four constants a guard reads out of this file --
 * a number that can be checked rather than believed.
 *
 * FIXED RATHER THAN CONTENT-SIZED on purpose. The whole gain of a right rail
 * is that the words line up DOWN the list -- "which of these is ready" is one
 * vertical scan. A rail sized to each row's own content would start at a
 * different x on every row and give that back.
 */
export const PR_STATUS_PX = 156;

/**
 * THE FOUR SLOTS OF THE RAIL, in px, and none of them may ever shrink.
 *
 * WHAT THE RAGGEDNESS ACTUALLY WAS. Over the eleven inked status bands of the
 * committed desktop shot the left edges fell at x = 1121, 1124, 1141, 1142,
 * 1143, 1145, 1153, 1156, 1165, 1176 and 1184 -- a 63px spread -- while every
 * right edge sat at 1251-1252. The rail was right-aligned and its STARTS were
 * noise, because the fields were flex children of a wrapping line and each one
 * was sized by its own word. Reading "which of these is blocked" down a
 * column meant re-finding where the column began on every row.
 *
 * SO EVERY SLOT IS `flex-none` AT A FIXED WIDTH. The rail is fixed-width, so a
 * shrinking slot has nothing to negotiate about; what shrink actually bought
 * was exactly the raggedness above. Words align on their STARTS (lines 1) and
 * numbers align on their ENDS (line 2), which is the direction each is read
 * in.
 *
 * WHAT THE WIDTHS ARE SIZED AGAINST, measured in Chromium at `--text-meta`
 * (11px): `merged` 40.0, `changes requested` 100.4, `checks running` 79.9,
 * `+6269 −317` 66.2 (mono), `76 files` 38.3. Every slot is oversized against
 * that -- AND THE MEASUREMENT IS NOT THE GUARANTEE. This repo has already
 * frozen 6.0079px/char on macOS into a premise that was 5.718 on the CI
 * runner. The guarantee is mechanical instead: `truncate` inside a `flex-none`
 * box cannot push the rail wider whatever the font does, and
 * `e2e/prs-tab-shots.mjs` asserts `scrollWidth <= clientWidth` per slot, so a
 * platform whose metrics are wider reddens rather than clipping in silence.
 *
 * LINE ONE IS 46 + 104, NOT 56 + 94, and the difference is the whole of the
 * clipping this rail used to do. At 94 the verdict slot could not hold
 * `changes requested` (100.4) and it degraded to `changes requeste…` -- ON THE
 * TOP ROW OF THE FIXTURE, the first thing an eye lands on, and the only
 * clipped string anywhere on the surface. A deliberate truncation that happens
 * exactly once does not read as a rule; it reads as the layout failing.
 *
 * The 10px came from the state slot, which had 16px of slack: `merged` is the
 * widest state word at 40.0 and keeps ~6px at 46. The verdict now has ~3.6px
 * spare. THE RAIL IS STILL 156 -- 46 + 6 + 104 -- so nothing above or below
 * moves: the rail's floor, the stacked height, the width left for the title
 * and every edge the guard pins are all untouched, and line two keeps
 * 94 + 6 + 56. The two lines have never shared an internal boundary and do not
 * need one: line one is read from its starts, line two from its ends.
 *
 * SO NOTHING IN THE RAIL CLIPS, BY CONSTRUCTION. Every slot still carries its
 * whole text on `title` -- that is the fallback for a platform whose metrics
 * are wider than these, not a bargain being struck here -- and the guard's
 * overflow check is now a plain failure rather than one with an exception
 * carved into it. Shortening the label to `changes req.` was never the answer
 * either: an abbreviation invents a vocabulary GitHub does not use.
 */
export const PR_SLOT_STATE_PX = 46;
export const PR_SLOT_VERDICT_PX = 104;
export const PR_SLOT_DIFF_PX = 94;
export const PR_SLOT_FILES_PX = 56;

/**
 * HOW TALL THE RAIL IS AT MINIMUM, and so how tall every row is.
 *
 * 16 + 2 + 16 + 8 + 30: line one, the `mt-0.5` between the lines, line two,
 * the `mt-2` above the action, and the action's own 30px paint.
 *
 * THE ROWS USED TO BE 108, 56, 74, 90 AND 108 -- a 52px spread over five rows
 * with 7px gutters, which is the "it all runs together" the operator reported
 * as much as the cluster was. A row with less to say now spends the space on
 * the action slot it reserves and on the empty half of its number line;
 * nothing is stretched or centred.
 *
 * `min-h`, NOT `h`. A fixed height CLIPS the day a field is added, silently. A
 * minimum grows, and the guard's uniform-height assertion reddens instead of
 * the pane lying -- which is also what happens if `--vam-pane-size` is turned
 * up, since `--text-body` and `--text-control` scale with it and `--text-meta`
 * does not.
 */
export const PR_RAIL_MIN_PX = 72;

/**
 * HOW TALL THE STACKED ROW IS RESERVED FOR, below `PR_SPLIT_PX`.
 *
 * ONLY THE STACKED CASE NEEDS THIS. Above the split the rail is the taller of
 * the two sides on every row -- 72 against an identity that reaches 60 at
 * worst -- so `PR_RAIL_MIN_PX` alone makes the height uniform there. Stacked,
 * the two are ADDED (identity + a 6px gap + rail), and a row with one identity
 * line would sit 40px shorter than a row with three: exactly the raggedness
 * the split layout just stopped having.
 *
 * 60 + 6 + 72. THE 60 IS A DERIVATION AND IT IS NOT THE OBVIOUS ONE: title 20,
 * `mt-0.5`, meta 16, `mt-0.5`, and then the author-and-labels line at **20**
 * rather than the 16 its text step would suggest -- `data-pr-label` is a pill
 * with `py-px` and a 1px border, which is 4px of chrome around an 11px line
 * box. A row with an author and no labels draws that line at 16 and is the
 * shorter case the floor is here to lift.
 *
 * DERIVED, NOT MEASURED AGAIN, so the moment a fourth identity line is added
 * this number is too small, the heights go ragged, and the guard's
 * uniform-height assertion says so at 520px rather than the pane quietly
 * clipping.
 */
export const PR_STACKED_MIN_PX = 138;

/**
 * THE TWO HALVES OF A PULL REQUEST ACTION BUTTON: the box a finger hits, and
 * the box that is painted.
 *
 * THEY ARE NOT THE SAME BOX, and the operator's two reports are what say so.
 * "The action buttons need different colours" came first; "bigger" came next.
 * The old chip was `px-2 py-0.5 text-meta` -- 22px tall on an 11px type step,
 * which is the scale's own FLOOR and is documented there as "chrome
 * ANNOTATING what is being read", never a control. A control that offers to
 * merge somebody's pull request should not be drawn in the size reserved for
 * a timestamp.
 *
 * SO THE PAINT IS 30px AND `--text-control`, which is the size this app's
 * phone chrome already paints (`.vam-phone .vam-tap > [data-tap-skin]`), and
 * `px-3` rather than `px-2` so the word has room either side of it. Nothing
 * here is a new number: 30 and the 8px radius are `styles.css`'s own, argued
 * at length where they were chosen.
 *
 * AND THE HIT IS 44 ON A PHONE, through `vam-tap` -- which is this repo's
 * OPT-IN, per control, and deliberately not a net cast from the stylesheet
 * over `[data-phone-shell] button` (that was tried once and burst a heading
 * row). `data-tap-pill` is the second half: the shared skin rule pins every
 * skin to a 30x30 SQUARE, correct for the icon skins it was written for and
 * wrong for a skin holding a WORD -- "Delete branch" clamped to 30px wide
 * would spill its own label past the box it is painted in, which a
 * `getBoundingClientRect` check asking only "is it AT LEAST 44?" stays green
 * through. `e2e/prs-tab-shots.mjs` measures BOTH: the hit box clears 44, and
 * the label fits inside its own skin.
 *
 * THE COLOURS ARE NOT HERE. Each control names its own, because green, grey
 * and red are the whole point of the pair being distinguishable and a shared
 * string is where that distinction would quietly come back.
 */
const PR_ACTION_HIT = 'vam-tap flex flex-none items-center justify-center rounded-[8px]';
const PR_ACTION_SKIN =
  'flex h-[30px] items-center justify-center whitespace-nowrap rounded-[8px] border px-3 text-control';

/**
 * ONE PULL REQUEST, drawn.
 *
 * ITS OWN COMPONENT because the row grew from four facts to fifteen when the
 * operator asked for "more information", and a fifteen-fact row inline inside
 * a list inside a tab is where a narrow-pane defect goes to hide.
 *
 * EVERY ADDED FIELD IS `| null` AND EVERY ONE OF THEM DRAWS NOTHING WHEN IT
 * IS. That is the model's rule (`model.ts`) carried to the paint: `null` is
 * "gh did not say", and "+0 −0" or an arrow with nothing on one side of it
 * would be vam inventing an answer it does not have. `0` is NOT null and does
 * draw -- a pull request that only deletes says `+0`.
 *
 * THE ROW IS A BUTTON, not a `div` with a click handler: it is the control
 * that opens the pull request, so it has to be reachable by Tab, activate on
 * Return and Space, and announce itself. The action buttons are SIBLINGS of it
 * rather than children -- a button inside a button is invalid markup and, in
 * practice, one click that fires both.
 *
 * TWO SIDES: WHAT IT IS, AND WHAT STATE IT IS IN. The operator's ask on
 * 2026-09-19 was to separate the information and split it left and right, and
 * the seam the fields fall either side of is that question. IDENTITY is what
 * does not change while the pull request is open -- its title, its number,
 * the branches it moves between, who wrote it, what it is labelled -- and it
 * goes LEFT, where reading starts. STATUS is everything that can be different
 * on the next poll -- the state word, the checks, the diff, the review, a
 * conflict, how long ago it moved -- and it goes RIGHT, right-aligned into
 * its own `PR_STATUS_REM` column, with the two controls that act on it
 * beneath. Scanning a list for "which of these is ready" is then one column
 * of aligned words rather than fifteen facts to read past.
 *
 * THE CHECK DOT STAYS LEFT and is the one status fact that does. It is 6px of
 * colour on the title's own line: it is what the eye runs DOWN the list on,
 * and moved to the right rail it would be a coloured speck at the end of a
 * paragraph. Its WORDS ("checks pass") went right with the rest of the
 * status, so the fact is in both places for the two different ways it is
 * read.
 *
 * THE METADATA STILL WRAPS, and both sides do it independently. Measured
 * against the phone (`e2e/playwright.phone`) and the narrowest legal pane:
 * below `PR_SPLIT_PX` the two sides STACK rather than crush each other, and
 * within each side the fields wrap with a small gap rather than sit in a
 * fixed grid -- a row that clipped would hide the one field the operator
 * opened this tab to read.
 */
function PullRequestRow({
  pr,
  now,
  onOpen,
  onAsk,
}: {
  readonly pr: PullRequest;
  readonly now: Date;
  readonly onOpen: ((url: string) => void) | null;
  readonly onAsk: ((pending: PendingPrAction) => void) | null;
}) {
  const url = pr.url;
  const clickable = onOpen !== null && url !== null;
  /**
   * WHAT MAY BE MERGED. `open` only -- a draft is its author's explicit "not
   * yet", and a merged or closed pull request has nothing left to merge. The
   * control is WITHDRAWN in every other case rather than drawn and refused.
   */
  const mayMerge = onAsk !== null && pr.state === 'open';
  /**
   * WHAT MAY HAVE ITS BRANCH DELETED, and the bound here is not tidiness.
   * Deleting the head branch of an OPEN pull request CLOSES that pull request
   * on GitHub -- so this button, offered there, would silently be a second and
   * unannounced "close this". Two acts behind one word is not something this
   * pane does, so the offer is limited to a pull request that is already
   * decided and whose branch vam actually knows the name of.
   */
  // Bound to a local BEFORE the closures below read it: a narrowing on
  // `pr.headRefName` does not survive into a callback, and a branch name is
  // the one argument in this row that must not be able to arrive as `null`.
  const headRef = pr.headRefName === '' ? null : pr.headRefName;
  const mayDeleteBranch =
    onAsk !== null && (pr.state === 'merged' || pr.state === 'closed') && headRef !== null;

  /**
   * WHETHER GITHUB HAS RULED THAT THIS CANNOT MERGE, and the whole point of
   * this line is the comparison it does NOT make.
   *
   * `mergeable` has THREE values, not two. `'conflicting'` is GitHub saying
   * it tried and the branches disagree. `'mergeable'` is GitHub saying it
   * tried and they do not. `null` is GitHub not having tried -- it computes
   * mergeability lazily and `UNKNOWN` is what MOST open pull requests carry,
   * which the reader maps to `null` (`model.ts`). So `!== 'mergeable'` would
   * grey the control on nearly every row the operator owns and refuse merges
   * GitHub has no objection to at all. Only the literal `'conflicting'`
   * counts, and `test/panels/DetailPanel.pr-detail.test.tsx` pins all three.
   */
  const conflicting = pr.mergeable === 'conflicting';

  /**
   * WHAT THE PULL REQUEST IS -- the left side. Nothing here changes while it
   * is open, which is why it is the side that holds still.
   */
  const identity = (
    <>
      {/* Truncated, not shortened: the pane is a narrow column and this one
          is now narrower still. The whole title stays in the DOM for anything
          that reads it, AND on `title=` for an eye -- a truncated name with
          nowhere to read the rest is information the pane had and threw away,
          which is the same bargain `data-pr-branches` makes below. */}
      <span data-pr-title title={pr.title} className="block truncate text-left text-body text-ink">
        {pr.title}
      </span>
      {/* THE META LINE, AND THE AGE IS ON IT NOW.
          `3h` used to be the third quantity on the rail's number line, sharing
          one size, one 6px gap and no separator with `+6269 −317` and
          `76 files` -- three magnitudes of three different kinds reading as
          one run of digits. It is not a quantity about the DIFF, it is a fact
          about the ROW, and this house already puts ages on the left meta
          line: `SessionList.tsx` draws `data-session-age` · `data-session-
          branch` in exactly this shape, mono, with a `·` between.

          SO THE SHRINK RULE IS COPIED, NOT RE-DERIVED. The branch pair is the
          only thing here allowed to give way (`min-w-0 truncate`, whole pair
          on `title`); the number and the age are `flex-none` and never do.
          `overflow-hidden` on the parent is what actually refuses to paint a
          branch past its box -- no arithmetic budget, so an age string nobody
          expected (`12345d`, or `relativeTime`'s raw-ISO parse-failure
          branch) cannot overrun it. That is the sidebar's own stated reason;
          `e2e/branch-overlap.spec.ts` is where it was measured. */}
      <span className="mt-0.5 flex min-w-0 items-center gap-x-1.5 overflow-hidden text-meta text-ink-faint">
        <span data-pr-number className="flex-none font-mono">
          {`#${pr.number}`}
        </span>
        {pr.headRefName === null || pr.baseRefName === null ? null : (
          /* HEAD then BASE: the order IS the sentence -- this branch into
             that one. `min-w-0` + `truncate` so a long branch name cannot
             push the row wider than the pane. */
          <>
            <span className="flex-none">·</span>
            <span
              data-pr-branches
              /* MEASURED at 390px: a real branch name truncates there, and a
                 truncated name with nowhere to read the rest is information
                 the pane had and threw away. The full pair lives on `title`,
                 which is the same bargain the repo heading above makes with
                 its directory path. */
              title={`${pr.headRefName} → ${pr.baseRefName}`}
              className="min-w-0 truncate font-mono"
            >
              {`${pr.headRefName} → ${pr.baseRefName}`}
            </span>
          </>
        )}
        {pr.updatedAt === null ? null : (
          <>
            <span className="flex-none">·</span>
            <span data-pr-updated className="flex-none font-mono">
              {relativeTime(pr.updatedAt, now)}
            </span>
          </>
        )}
      </span>
      {pr.author === null && pr.labels.length === 0 ? null : (
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-meta">
          {pr.author === null ? null : (
            <span data-pr-author className="text-ink-faint">{`@${pr.author}`}</span>
          )}
          {pr.labels.map((label) => (
            <span
              key={label}
              data-pr-label
              className="rounded-full border border-line px-1.5 py-px text-ink-dim"
            >
              {label}
            </span>
          ))}
        </span>
      )}
    </>
  );

  /**
   * WHAT STATE IT IS IN -- the right side: TWO FIXED LINES AND AN ANCHORED
   * ACTION, which is the whole of the operator's "it all runs together".
   *
   * FOUR SLOTS AT FOUR CONSTANT x POSITIONS. Line one holds words and is read
   * left to right, so its two slots are left-aligned and a reader's eye finds
   * `open` and then the verdict at the same place on every row. Line two holds
   * magnitudes and is compared down the column, so its two slots are
   * right-aligned and `tabular-nums` keeps the digit columns from jittering.
   * Nothing separates the slots but their geometry: a `·` would be ink spent
   * on a boundary the grid already draws.
   *
   * WHERE A SLOT IS EMPTY THE BOX STAYS. `gh` not having said how many files
   * moved must draw NOTHING -- that is the model's rule -- but it must not
   * shift the slot beside it either, or the alignment this whole rail exists
   * for is conditional on a field being present. So an absent field leaves its
   * width behind as a spacer with no hook and no ink on it.
   */
  const verdict = prVerdict(pr);
  const diff =
    pr.additions === null && pr.deletions === null
      ? null
      : [
          pr.additions === null ? null : `+${pr.additions}`,
          pr.deletions === null ? null : `−${pr.deletions}`,
        ]
          .filter((part) => part !== null)
          .join(' ');
  const status = (
    <>
      <span className="flex items-start justify-end gap-x-1.5 text-meta">
        <span
          data-pr-state-label
          title={pr.state}
          style={{ width: PR_SLOT_STATE_PX }}
          className={`flex-none truncate ${PR_STATE_INK[pr.state]}`}
        >
          {pr.state}
        </span>
        <span
          data-pr-verdict
          /* THE WIDEST PHRASE THE RAIL HOLDS, and the slot is sized to it
             rather than around it: `changes requested` measures 100.4px and
             the slot is 104, bought from the state slot's 16px of slack --
             see `PR_SLOT_VERDICT_PX`. The `title` is the fallback for a
             platform whose metrics are wider than these, not a bargain being
             struck here; nothing in this rail clips on the metrics it was
             measured against. */
          title={verdict.label}
          style={{ width: PR_SLOT_VERDICT_PX }}
          className={`flex-none truncate ${verdict.ink}`}
        >
          {verdict.label}
        </span>
      </span>
      {diff === null && pr.changedFiles === null ? null : (
        <span className="mt-0.5 flex items-start justify-end gap-x-1.5 text-meta">
          {diff === null ? (
            <span aria-hidden="true" style={{ width: PR_SLOT_DIFF_PX }} className="flex-none" />
          ) : (
            <span
              data-pr-diff
              /* ONE BOX FOR THE PAIR, and `truncate` is why: `text-overflow`
                 belongs to a box with its own text, so two flex children in a
                 flex line would clip with no ellipsis at all. The two inks
                 stay separate spans inside it -- green for what arrived, red
                 for what left -- which is what the guard and the unit suite
                 both read.

                 `tabular-nums` IS LOAD-BEARING. Right-aligned proportional
                 digits still jitter column to column, and "which of these is
                 the big one" is a digit-column scan. Mono here against a
                 proportional `76 files` is the second channel that stops the
                 two reading as one number. */
              title={diff}
              style={{ width: PR_SLOT_DIFF_PX }}
              className="flex-none truncate text-right font-mono tabular-nums"
            >
              {pr.additions === null ? null : (
                <span data-pr-additions className="text-done">{`+${pr.additions}`}</span>
              )}
              {pr.additions !== null && pr.deletions !== null ? ' ' : null}
              {pr.deletions === null ? null : (
                <span data-pr-deletions className="text-danger">{`−${pr.deletions}`}</span>
              )}
            </span>
          )}
          {pr.changedFiles === null ? (
            <span aria-hidden="true" style={{ width: PR_SLOT_FILES_PX }} className="flex-none" />
          ) : (
            <span
              data-pr-files
              title={`${pr.changedFiles} ${pr.changedFiles === 1 ? 'file' : 'files'}`}
              style={{ width: PR_SLOT_FILES_PX }}
              className="flex-none truncate text-right text-ink-faint"
            >
              {`${pr.changedFiles} ${pr.changedFiles === 1 ? 'file' : 'files'}`}
            </span>
          )}
        </span>
      )}
      {mayMerge || mayDeleteBranch ? (
        /* `mt-auto` IS THE ANCHOR. The action used to sit wherever the two
           lines above it happened to end -- 63px below the card's top on one
           row, 29 on the next, 47 on the third -- so there was no y to aim at.
           Pushed to the bottom of a rail with a floor (`PR_RAIL_MIN_PX`), its
           bottom edge is 9px above the row's own on every row that has one,
           and its right edge is the rail's. A row with NO action keeps the
           30px anyway: that reserved quiet is what buys the uniform height. */
        <span
          data-pr-actions
          className="mt-auto flex flex-none flex-wrap items-center justify-end gap-1.5 pt-2"
        >
          {mayMerge && conflicting ? (
            /**
             * DISABLED, NOT ABSENT, and the difference is a sentence. GitHub
             * has RULED here -- it computed the merge and the branches
             * disagree -- so withdrawing the control would say "there is no
             * action on this row", which is false: there is one, and it is
             * blocked on a named, fixable cause. A greyed control says "there
             * is an action here and it is not available now", and the note on
             * it carries the reason. Same shape as `data-model-picker-shell`,
             * and for the same two mechanical reasons: a disabled button
             * takes NO pointer events and NO focus, so neither hover nor Tab
             * would ever reach an explanation hung on the button itself.
             */
            <Note text="GitHub says this branch conflicts with its base. Merge or rebase the base branch into it and push, then this can go in.">
              <span
                data-pr-merge-note
                // biome-ignore lint/a11y/noNoninteractiveTabindex: the tab stop IS the feature -- see the block comment above.
                tabIndex={0}
                className={`inline-flex flex-none rounded ${FOCUS_RING}`}
              >
                <button
                  type="button"
                  data-pr-merge
                  data-pr-merge-state="conflicting"
                  disabled
                  aria-disabled="true"
                  aria-label={`merge pull request ${pr.number} — GitHub says it conflicts with its base`}
                  className={`${PR_ACTION_HIT} cursor-not-allowed`}
                >
                  {/* `text-ink-faint` on `border-line-strong` is the disabled
                      ink this app already uses (`data-model-picker-state
                      ="disabled"`, and `SettingsOverlay`'s steppers), and it
                      is measured as PAINT in `e2e/prs-tab-shots.mjs`: the
                      label must still clear 3:1 in both themes, because a
                      greyed control an operator cannot read is a control that
                      is not there. */}
                  <span
                    data-tap-skin
                    data-tap-pill
                    className={`${PR_ACTION_SKIN} border-line-strong text-ink-faint`}
                  >
                    Merge
                  </span>
                </button>
              </span>
            </Note>
          ) : null}
          {mayMerge && !conflicting ? (
            <button
              type="button"
              data-pr-merge
              data-pr-merge-state="ready"
              aria-label={`merge pull request ${pr.number}`}
              onClick={() =>
                onAsk({
                  verb: 'Merge',
                  number: pr.number,
                  title: pr.title,
                  consequence:
                    'This merges the pull request on GitHub, now, with your own credentials. vam cannot undo it, and nothing about your branch protection is overridden — if the repository refuses, GitHub’s own words are what you will see.',
                  // The exact command, so the strategy is never a private
                  // decision of this button's. See `ConfirmPrAction`.
                  command: `gh pr merge ${pr.number} --squash`,
                  action: { kind: 'merge', number: pr.number, method: 'squash' },
                })
              }
              className={`${PR_ACTION_HIT} cursor-pointer ${FOCUS_RING}`}
            >
              {/* GREEN, at the operator's ask, and `--color-icon-green` rather
                  than `--color-running`. The greens this palette holds are the
                  running status and the icon tone, and `--color-running` is
                  ALREADY ON THIS ROW three spans away: `PR_STATE_INK.open` is
                  `text-running`. Painting the affirmative control with it
                  would make the button and the word `open` the same colour and
                  the same claim. The icon tones are named by TONE and make no
                  claim at all (`styles.css`), which is exactly what a control
                  wants. `--color-done` is not a candidate either -- in this
                  palette it is BLUE, and it is on this row too, carrying
                  `+additions`. Measured as paint in both themes by
                  `e2e/prs-tab-shots.mjs`. */}
              <span
                data-tap-skin
                data-tap-pill
                className={`${PR_ACTION_SKIN} border-icon-green text-icon-green hover:bg-icon-green hover:text-ground`}
              >
                Merge
              </span>
            </button>
          ) : null}
          {mayDeleteBranch && headRef !== null ? (
            <button
              type="button"
              data-pr-delete-branch
              aria-label={`delete the remote branch ${headRef}`}
              onClick={() =>
                onAsk({
                  verb: 'Delete branch',
                  number: pr.number,
                  title: pr.title,
                  consequence: `This deletes the remote branch ${headRef} on GitHub. vam cannot undo it. Your local copy of the branch is untouched.`,
                  command: `gh api --method DELETE repos/{owner}/{repo}/git/refs/heads/${headRef}`,
                  action: { kind: 'delete-branch', branch: headRef },
                })
              }
              className={`${PR_ACTION_HIT} cursor-pointer ${FOCUS_RING}`}
            >
              {/* RED AT REST, not only under a pointer. It wore `border-line
                  … text-ink-dim` -- byte-identical to Merge -- and became red
                  on hover, which is a warning an operator gets only once they
                  have already reached for it. `--color-danger` is this app's
                  ACTION red and says so in `styles.css`: "an action must not
                  be mistakable for the status of the row beside it".

                  RED WORD, NEUTRAL BOUNDARY, and that pairing is the answer to
                  a real tension. Merge is the affirmative and must have the
                  stronger presence; a full red outline on the destructive one
                  would out-shout it, and a list of merged pull requests would
                  be a column of red chips. So the ink carries the warning, the
                  boundary stays `line-strong` like every other quiet control,
                  and the full `bg-danger` commitment arrives on hover -- which
                  is `ConfirmPrAction`'s own Go button, the other place in this
                  feature where something irreversible is offered. */}
              <span
                data-tap-skin
                data-tap-pill
                className={`${PR_ACTION_SKIN} border-line-strong text-danger hover:border-danger hover:bg-danger hover:text-ground`}
              >
                Delete branch
              </span>
            </button>
          ) : null}
        </span>
      ) : null}
    </>
  );

  return (
    <li
      data-pr-row
      data-pr-state={pr.state}
      data-pr-checks={pr.checks}
      /* THE QUERY CONTAINER IS THE ROW AND THE RESPONDING BOX IS INSIDE IT. A
         container query does not apply to the element that DECLARES the
         container, so `@container` and `@min-[356px]:flex-row` on one element
         is a rule that can never fire -- the row would be one column at every
         width and nothing on screen would say so. `AgentsTab` paid for that
         lesson; this is the same two-box shape, measured the same way. */
      className="@container rounded-[9px] border border-line bg-card px-3 py-2"
    >
      <div
        data-pr-split
        /* `min-h-[138px]` IS `PR_STACKED_MIN_PX`, and it is withdrawn above the
           split (`@min-[356px]:min-h-0`) because up there the rail's own floor
           already makes every row the same height. Stacked, identity and rail
           are ADDED rather than compared, so without a floor a one-line row
           would be 38px shorter than a three-line one -- the raggedness the
           split layout just stopped having. Both strings are written out for
           Tailwind's scanner, like every other number in this row. */
        className="flex min-h-[138px] flex-col gap-1.5 @min-[356px]:min-h-0 @min-[356px]:flex-row @min-[356px]:items-start @min-[356px]:gap-3"
      >
        <div data-pr-identity className="flex min-w-0 flex-1 items-start gap-2">
          <span
            data-pr-checks-mark
            title={CHECK_MARK[pr.checks].label}
            /* THE LANE IS A CONSTANT AND THE GLYPH MOVES INSIDE IT --
               `status-mark.tsx`'s rule, imported rather than retyped so the
               two marks stay the same size wherever they meet. The size is an
               inline `style` for that file's own reason: Tailwind's scanner
               reads source text, so a class assembled from a constant is a
               class it never generates and the lane would collapse to its
               content.

               `mt-[3px]` sits the 14px lane's optical centre on the title's
               first line. It was `mt-[7px]` when the mark was a 6px dot; a
               taller lane needs less of an offset to centre on the same line,
               and centring against the whole row would drift down as fields
               appear. */
            style={{ width: MARK_LANE_PX, height: MARK_LANE_PX }}
            className={`mt-[3px] flex flex-none items-center justify-center ${CHECK_MARK[pr.checks].ink}`}
          >
            {CHECK_MARK[pr.checks].glyph(GLYPH_PX)}
          </span>
          {clickable ? (
            <button
              type="button"
              data-pr-open
              title={url}
              /* THE ROW'S SENTENCE, and the only place `review required` and
                 `approved` still live. The rail stopped painting them (see
                 `prVerdict`); the row did not stop knowing them, and an
                 attribute costs no pixels and no `innerText`. */
              aria-label={`open pull request ${pr.number} on GitHub — ${prSentence(pr)}`}
              onClick={() => onOpen(url)}
              /* `vam-tap` for the phone's floor, and a note on what that is
                 worth TODAY: `onOpen` is `null` without a desktop bridge and
                 the browser build has none, so this control is not drawn on a
                 phone at all -- verified at 390px against both `?demo=1` and a
                 remote-shaped source, where the PRs view draws rows and no
                 opener. The class is here so the day a phone gets a route to
                 open a link the control is already a touch target, and the
                 phone census cannot hold it to that until then. */
              className={`vam-tap flex min-w-0 flex-1 cursor-pointer flex-col rounded text-left ${FOCUS_RING}`}
            >
              {identity}
            </button>
          ) : (
            /* No bridge, so no control to hang an accessible name on -- the
               sentence goes on `title` instead, which is the carrier the two
               truncating fields in here already use. */
            <span title={prSentence(pr)} className="flex min-w-0 flex-1 flex-col">
              {identity}
            </span>
          )}
        </div>
        {/* `w-[156px]` IS `PR_STATUS_PX` and `min-h-[72px]` is
            `PR_RAIL_MIN_PX`, typed where Tailwind can read them and named
            where a person can -- see `PR_SPLIT_PX` for why the numbers cannot
            be interpolated. Below the split it is a full-width block under the
            identity, its lines still `justify-end` so it reads as a detached
            right-hand column; above it, a fixed rail the identity flexes
            against, so the status words line up down the list instead of
            starting wherever the longest title happened to end.

            THE FLOOR IS ON THE RAIL RATHER THAN THE ROW because the rail is
            the taller side on every row above the split, so a floor here is a
            floor on the row -- and it is the rail that owns the reserved
            action slot the floor is mostly made of. */}
        <div
          data-pr-status
          className="flex min-h-[72px] min-w-0 flex-col @min-[356px]:w-[156px] @min-[356px]:flex-none"
        >
          {status}
        </div>
      </div>
    </li>
  );
}

/**
 * The Agents tab's content: which subagents this session spawned, running
 * ones first and by default running ones only.
 *
 * FOUR STATES, AND THREE OF THEM DRAW NO ROW FOR DIFFERENT REASONS
 * (model.ts). Absent is a source with no agent surface at all — the factory
 * reports a live count and nothing about which agents they are — and empty is
 * a source that looked and found none, which is the common case, since most
 * sessions never spawn a subagent. The third is new with the filter: agents
 * exist and none of them is running. That one must NOT fall through to
 * "spawned no agents", which would be the caption outrunning the data while
 * twenty finished agents sit one keypress away; it says how many there are and
 * keeps the toggle on screen beside it. Each gets one plain sentence. None
 * gets a spinner or a placeholder row: this pane has spent several rounds
 * having invented content removed from it.
 *
 * The default is running-only because that is what the operator opened the tab
 * to see; the toggle exists because a filter with no way out hides work. It
 * carries the count of what it is hiding, so a hidden row is never silently
 * invisible — and it counts IDLE agents, never running ones, precisely so it
 * cannot be read against the tab's `●N` running badge, which counts the whole
 * directory before the roster cap and may legitimately exceed the rows here.
 *
 * The toggle's state is component state, not a `prefs.ts` field, for the same
 * reason the chosen tab is: nothing outside this pane has an opinion about it,
 * and persisting a presentation toggle would put it in a payload every other
 * surface has to migrate around. Unlike the tab it resets per pane render,
 * which is the wanted default — the next session is asked the same question.
 *
 * It is a button, not a key chord: nothing binds it, so nothing captions it as
 * bound.
 *
 * A row survives an unreadable meta file. The agent's id and whether it is
 * running come from its own transcript, so they are facts whatever the meta
 * file says; the labels are what goes `unknown`, and the row still says who is
 * working. The roster is capped at the source (`agent-roster.ts`), so this
 * renders everything it is given and counts only what it hides.
 */
/**
 * THE WIDTH AT WHICH THE LIST AND THE DETAIL SIT SIDE BY SIDE.
 *
 * WRITTEN OUT AS `420` IN EVERY CLASS BELOW, and this constant is what a test
 * reads rather than what the markup interpolates. Tailwind finds classes by
 * scanning source TEXT for complete strings: `@min-[${AGENT_SPLIT_PX}px]:flex`
 * is not a string it can find, so the rule would simply never be generated and
 * the pane would silently have one column at every width. This repo has
 * already paid for that exact shape once -- a selector that matched nothing,
 * live through review and merge -- so the number is typed where Tailwind can
 * read it and named here where a person can.
 *
 * A CONTAINER QUERY, NOT A VIEWPORT ONE, and that is the whole reason this is
 * a number in CSS rather than the `phone` prop: the detail pane is resizable
 * between `DETAIL_MIN` (320) and `DETAIL_MAX` (520), so a desktop pane can be
 * narrower than a phone screen. Asking the viewport would put two columns in a
 * 320px pane and one column on a 430px phone -- both backwards.
 *
 * 420 is where both halves still do their job: the navigator needs ~150px
 * before an agent type like `security-reviewer` stops being readable at all,
 * and a turn needs ~250px before its prose stops reading as prose (the same
 * floor `DETAIL_MIN`'s own note argues from). Below it the detail takes the
 * pane and `data-agent-back` is the way out.
 */
export const AGENT_SPLIT_PX = 420;

/**
 * ONE TURN OF AN AGENT'S THREAD: what it was asked, what it said, what it
 * called.
 *
 * DELIBERATELY NOT `TurnBlock`. That component carries the session's own
 * conversation and everything the operator can DO to it -- unfold, the prompt
 * menu, the answer menu, focus view, cancel -- and none of those exist here:
 * there is no channel from this pane into a subagent, so a copy of it wearing
 * dead affordances would promise a control that does nothing. What IS shared
 * is `StepRow`, which is the genuinely common piece, and it is imported rather
 * than reproduced.
 */
function AgentTurn({ turn }: { readonly turn: Decision }) {
  const steps = turn.steps ?? [];
  const shown = steps.slice(0, MAX_STEP_ROWS);
  const hidden = steps.length - shown.length;
  return (
    <li data-agent-turn={turn.id} className="flex min-w-0 flex-col gap-1.5">
      <div
        data-agent-turn-in
        className="vam-clamp-6 min-w-0 whitespace-pre-wrap break-words rounded-[9px] bg-raised px-2.5 py-2 text-body text-ink"
      >
        {turn.input}
      </div>
      <div
        data-agent-turn-out
        /* `text-ink-dim`: there is no `--color-ink-soft` token and never was,
           so this class named nothing and the line simply inherited whatever
           ink its parent wore -- the quieter tone it asks for was never
           painted. Found by the sweep that `test/renderer/colour-tokens.test.ts`
           now runs on every build. */
        className="min-w-0 whitespace-pre-wrap break-words px-2.5 text-body text-ink-dim"
      >
        {/* ABSENT IS ITS OWN SENTENCE. An agent that has been asked and has
            not answered is the commonest live case, and a blank space there
            reads as an agent that answered with nothing. */}
        {turn.output ?? <span className="text-ink-faint italic">no answer yet</span>}
      </div>
      {steps.length > 0 && (
        <ul
          data-agent-turn-steps
          className="flex min-w-0 flex-col gap-0.5 px-2.5 font-mono text-meta text-ink-faint"
        >
          {shown.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
          {/* The cap says its own size, on the rule `MAX_STEP_ROWS` states:
              a fold that will not name what it folded is the thing this
              surface exists to refuse. */}
          {hidden > 0 && (
            <li data-agent-steps-more>{t('steps.more', { count: String(hidden) })}</li>
          )}
        </ul>
      )}
    </li>
  );
}

/** One plain sentence, which is all any of this pane's empty states get. */
function AgentNote({ children, mark }: { readonly children: ReactNode; readonly mark?: string }) {
  return (
    <p {...(mark === undefined ? {} : { [mark]: true })} className="text-control text-ink-faint">
      {children}
    </p>
  );
}

/**
 * WHAT ONE AGENT IS DOING -- the right-hand side of the navigator.
 *
 * FIVE STATES AND FIVE SENTENCES, on the rule the list beside it already
 * keeps: nothing picked, still asking, vam could not read, read and found
 * nothing, and the work itself. The two in the middle are the ones a careless
 * version collapses, and collapsing them makes vam's own latency or vam's own
 * failure read as a fact about the agent.
 */
function AgentDetail({
  work,
  state,
  onBack,
}: {
  readonly work: AgentWork | null;
  readonly state: 'idle' | 'loading' | 'ready';
  readonly onBack: () => void;
}) {
  const body = () => {
    if (state === 'idle') {
      return <AgentNote>Pick an agent to see what it is doing.</AgentNote>;
    }
    if (state === 'loading' || work === null) {
      return <AgentNote>Asking this agent’s transcript…</AgentNote>;
    }
    if (work.kind === 'unavailable') {
      // The source's own words, whole. `port.ts` built them to be read.
      return <AgentNote>{work.error.message}</AgentNote>;
    }
    if (work.turns.length === 0 && work.brief === null) {
      return <AgentNote>This agent has done nothing vam could read yet.</AgentNote>;
    }
    return (
      <ul className="vam-no-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {work.brief !== null && <AgentTurn turn={work.brief} />}
        {/* THE MIDDLE VAM DID NOT READ, said rather than hidden. Only 6% of
            the subagent transcripts measured fit in one window, so this is the
            usual case; drawing the brief joined to the newest turn would claim
            the agent went straight from one to the other. */}
        {!work.whole && (
          <li data-agent-gap className="px-2.5 text-meta text-ink-faint">
            — vam read this agent’s beginning and its newest work, not the middle —
          </li>
        )}
        {work.turns.map((turn) => (
          <AgentTurn key={turn.id} turn={turn} />
        ))}
      </ul>
    );
  };

  return (
    <div data-agent-detail className="flex min-h-0 flex-1 flex-col gap-2">
      {/* THE WAY BACK, named for where it GOES rather than for its container
          -- the rule the phone shell's own control keeps. It is drawn only
          below the split, where the detail has taken the pane; above it the
          list is already on screen and a back control would point at it. */}
      {state !== 'idle' && (
        <button
          type="button"
          data-agent-back
          onClick={onBack}
          className={
            'flex-none cursor-pointer self-start rounded-[var(--radius-sm)] px-1.5 py-0.5 text-control text-ink-faint hover:bg-raised hover:text-ink @min-[420px]:hidden'
          }
        >
          ‹ All agents
        </button>
      )}
      {body()}
    </div>
  );
}

/**
 * WHAT A PANE'S ROW IS WAITING ON, between a press and the agent registering
 * -- `Canvas.tsx`'s `startingPaneByKey`, and the shape crossing the boundary
 * `startingPane`'s own comment (`DetailPanelProps`) explains at length. Two
 * shapes because the two acts need different words once they are drawn
 * (`ProviderStartControls`/`TerminalOnlyStart`'s own Resume button): Start
 * names the provider it typed, Resume does not need to -- there is only ever
 * one command a resume pane can type.
 */
export type StartingPaneWait =
  | { readonly kind: 'start'; readonly provider: ProviderId; readonly timedOut: boolean }
  | { readonly kind: 'resume'; readonly timedOut: boolean };

/**
 * THE PROVIDER PICKER AND THE START BUTTON, on their own -- the one act
 * every "nothing is running here" screen offers, extracted so there is
 * exactly one implementation of it rather than one per screen that draws it.
 * `StartSession` (the plain `unstarted` pane) and `TerminalOnlyStart` (a
 * `terminal` pane, whose conversation vam still knows) both mount this and
 * differ only in the words around it.
 *
 * A SEGMENTED PICKER, NOT THE COMPOSER'S POPOVER -- the same `aria-pressed`
 * row the settings section draws, because it is the same kind of choice.
 * That popover changes the GLOBAL default for the next session created; this
 * chooses what THIS pane runs now, and a control that looked like the other
 * while meaning something else is the confusion `onSetDefaultProvider`'s
 * comment spends a paragraph on. The stored default is where the picker
 * STARTS, which is the one honest link between them: it is what the operator
 * said they usually want.
 *
 * CONTROLLED, NOT SELF-OWNED -- `chosen` used to be this component's own
 * `useState`, seeded from `defaultProvider` and never read anywhere else.
 * `StartSession` now draws the CHOSEN provider's own mark beside this same
 * picker (the operator's own ask: "for an unstarted pane use the currently
 * chosen provider in its picker, updating when the choice changes"), which
 * needs the live value one level up. Lifting it here is the one-component
 * version of that; `TerminalOnlyStart` does not read the value but still
 * owns a `useState` of its own to hand this component the same two props,
 * so there is exactly one shape for "the picker's current choice" rather
 * than one owned and one lifted.
 */
function ProviderStartControls({
  chosen,
  onChosenChange,
  onStart,
  disabled = false,
  starting = null,
}: {
  readonly chosen: ProviderId;
  readonly onChosenChange: (id: ProviderId) => void;
  readonly onStart: (id: ProviderId) => void;
  /**
   * FROZEN WHILE THIS PANE'S ROW IS WAITING -- for Start OR for Resume, the
   * screen's other act: only one write may be in flight against a pane at
   * once, so the picker freezes for the OTHER act's wait too, not only its
   * own. See `starting` below for the fact that IS its own.
   */
  readonly disabled?: boolean;
  /**
   * Non-null only while THIS control's own press is what the pane is
   * waiting on -- swaps "Start session" for a spinner naming the provider
   * being started. Null while `disabled` for the OTHER act's wait instead
   * (Resume), so this button never claims to be starting a provider it did
   * not start. `spinning` false past the operator's own timeout
   * (`StartSession`/`TerminalOnlyStart`'s own comment): the label stays
   * honest but the animation -- which promises an end no one can see -- does
   * not run forever.
   */
  readonly starting?: { readonly label: string; readonly spinning: boolean } | null;
}) {
  return (
    <>
      <fieldset
        data-start-providers
        aria-label="which agent to start"
        disabled={disabled}
        className="flex items-center gap-1 rounded-[10px] border border-line-strong bg-card p-1 disabled:cursor-progress disabled:opacity-60"
      >
        {PROVIDERS.map((provider) => {
          const selected = provider.id === chosen;
          const mark = PROVIDER_MARKS[provider.id];
          return (
            <button
              key={provider.id}
              type="button"
              aria-pressed={selected}
              data-start-provider={provider.id}
              onClick={() => onChosenChange(provider.id)}
              className={[
                'vam-tap flex cursor-pointer items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-control',
                selected
                  ? 'bg-line-strong text-ink'
                  : 'text-ink-dim hover:bg-line-strong hover:text-ink',
              ].join(' ')}
            >
              {mark === undefined ? <Box size={12} strokeWidth={1.7} /> : <mark.Glyph size={12} />}
              {provider.label}
            </button>
          );
        })}
      </fieldset>
      <button
        type="button"
        data-start-session-button
        onClick={() => onStart(chosen)}
        disabled={disabled}
        aria-busy={starting !== null}
        className="vam-tap flex cursor-pointer items-center gap-1.5 rounded-[8px] bg-ink px-3.5 py-1.5 text-control text-panel hover:opacity-90 disabled:cursor-progress disabled:opacity-70"
      >
        {starting !== null ? (
          <>
            <LoaderCircle
              size={12}
              strokeWidth={1.8}
              className={starting.spinning ? 'vam-spin' : undefined}
            />
            {starting.label}
          </>
        ) : (
          <>
            <Play size={12} strokeWidth={2} />
            Start session
          </>
        )}
      </button>
    </>
  );
}

/**
 * THE ESCAPE HATCH, past the operator's own 30s timeout.
 *
 * Operator: a spinner that could be wrong forever is worse than one that
 * admits it. `tmux new-session -d`/`typeIntoOwnPane` return once the KEYS are
 * typed, not once an agent answers, and most of the time that is seconds --
 * but "most of the time" is not "always", and vam has no second signal to
 * wait on once the ordinary window has passed. So past it the spinner stops
 * (`ProviderStartControls`' own `spinning`) and this quiet sentence takes
 * over: not a failure (nothing failed; the write landed), just a way out that
 * does not depend on guessing right.
 *
 * SHARED BY BOTH START SCREENS because it says the exact same thing about the
 * exact same fact, the same reason `StartShortcuts` below is shared by both.
 */
function StartTimeoutHint({
  onShowTerminal,
}: {
  readonly onShowTerminal: (() => void) | undefined;
}) {
  return (
    <p data-start-timeout-hint className="max-w-[36ch] text-meta text-ink-quiet">
      {onShowTerminal === undefined ? (
        'Still starting — check the Terminal view.'
      ) : (
        <>
          {'Still starting — '}
          <button
            type="button"
            onClick={onShowTerminal}
            className="vam-tap cursor-pointer underline decoration-line-strong underline-offset-2 hover:text-ink"
          >
            check the Terminal view
          </button>
        </>
      )}
    </p>
  );
}

/**
 * THE START SCREEN: the Response view of a pane with nothing started in it.
 *
 * `docs/design/vam-owns-the-session.md` §3, and the operator's own words,
 * twice: "the Response view needs a provider picker and a Start session
 * button -- or the user can switch to the terminal view and start a session
 * by typing `claude`, `codex`, and so on." Both routes end in the same pane
 * with the same keystrokes, so this screen says so rather than pretending
 * the button is the only door.
 *
 * ONE ACT, AND IT IS NOT A PROMPT. No composer is drawn under this (see
 * `composerHidden`): the pane holds a shell, and the only thing worth typing
 * into a shell from here is the provider's own command. `onStart` hands the
 * caller the chosen ID; the caller resolves it and types it. Absent, the
 * button is withdrawn and the Terminal sentence carries the whole of what can
 * be done -- the same absent-not-disabled rule every optional write in this
 * file follows.
 *
 * THE PANE IS NAMED. It is the row's title (`pane-row.ts`) and the only
 * thing that tells two empty panes in one project apart; saying it here is
 * what lets the operator check they are starting in the one they meant.
 *
 * THE MARK IS THE CHOSEN PROVIDER'S, LIVE -- the operator's own words: "for
 * an unstarted pane use the currently chosen provider in its picker,
 * updating when the choice changes." There is no session here yet, so there
 * is no AGENT mark the way `TerminalOnlyStart` has one; the picker's own
 * selection is the closest honest fact, and it is the SAME resolver every
 * other mark in this app draws through (`SourceMark`). Withdrawn along with
 * the picker itself when `onStart` is absent -- a mark for a choice with no
 * control to make it would be naming a fact this screen cannot act on.
 */
function StartSession({
  paneName,
  defaultProvider,
  onStart,
  startingPane = null,
  onShowTerminal,
}: {
  readonly paneName: string;
  readonly defaultProvider: ProviderId | undefined;
  readonly onStart: ((id: ProviderId) => void) | undefined;
  readonly startingPane?: StartingPaneWait | null;
  readonly onShowTerminal?: () => void;
}) {
  const [chosen, setChosen] = useState<ProviderId>(() => resolveProvider(defaultProvider).id);
  const starting = startingPane ?? null;
  return (
    <div
      data-start-session
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
    >
      {onStart !== undefined && (
        <IconFrame>
          <span
            data-start-session-mark
            data-source-mark={markRegisterOf(chosen)}
            role="img"
            aria-label={`the chosen provider: ${chosen}`}
          >
            <SourceMark source={chosen} lane={40} />
          </span>
        </IconFrame>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-control text-ink">Nothing is running in this pane yet.</p>
        <p className="text-meta text-ink-quiet">
          <span className="font-mono">{paneName}</span>
          {' — a shell, in this project’s directory'}
        </p>
      </div>
      {onStart !== undefined && (
        <ProviderStartControls
          chosen={chosen}
          onChosenChange={setChosen}
          onStart={onStart}
          disabled={starting !== null}
          starting={
            starting?.kind === 'start'
              ? {
                  label: `Starting ${resolveProvider(starting.provider).label}…`,
                  spinning: !starting.timedOut,
                }
              : null
          }
        />
      )}
      {starting?.timedOut && <StartTimeoutHint onShowTerminal={onShowTerminal} />}
      <p className="max-w-[36ch] text-meta text-ink-quiet">
        {onStart === undefined
          ? 'Switch to the Terminal view and type the agent’s command — `claude` or `codex` — to start one here.'
          : 'Or switch to the Terminal view and type the command yourself; either way it runs in this same pane.'}
      </p>
    </div>
  );
}

/**
 * THE GETTING-STARTED SCREEN: the Response view of a `terminal` row -- a pane
 * whose agent exited but whose conversation vam still knows (`model.ts`).
 *
 * REPLACES THE TRANSCRIPT, ON THE OPERATOR'S OWN REVISION of the first draft
 * of this design: "it should then show a getting-started screen, with the
 * logo and some information, shortcuts to create a project, create a
 * session, … and a 'Start session' button with a provider choice. The
 * terminal stays in terminal mode, and the user will need to type `claude`
 * themselves to start a session." So this is NOT `StartSession` with a
 * transcript still open behind it -- the pane is at a shell prompt right now,
 * same as an `unstarted` one, and the screen says exactly that; the
 * conversation's identity (`entry.session.title`) is what tells the operator
 * WHICH shell this is, not a history replayed under it. The Terminal tab
 * beside this one is unaffected and still shows the real screen.
 *
 * NO SECOND IMPLEMENTATION OF THE PICKER -- `ProviderStartControls` above is
 * the whole of Start session, shared verbatim with `StartSession`, on the
 * same `start-in-pane.ts` write path (`onStart`, resolved by the caller
 * exactly as `StartSession`'s is).
 *
 * THE SHORTCUTS ARE READ FROM THE CHORD TABLE, never retyped: `StartShortcuts`
 * (`GettingStarted.tsx`) draws whatever `primaryChord` finds bound for each
 * action right now and nothing when the operator has unbound it, so a rebind
 * can never leave this screen naming a key that does nothing. Extracted
 * rather than kept inline because `GettingStarted` below -- the WHOLE APP's
 * own "nothing to show" screen -- ends the identical sentence; one `<ul>`
 * shared by both is the only way a change to it cannot land on one screen and
 * not the other.
 *
 * RESUME IS SECONDARY, and stays a plain text-weight link rather than a
 * second filled button: Start session is the primary act this screen
 * commits to (a NEW turn on the operator's chosen provider), and Resume is
 * the quieter "or go back to what was here" -- offered only when the row
 * actually carries a `resumeCommand` and a caller wired `onResumeInPane`,
 * the same absent-not-disabled rule every optional control in this file
 * follows.
 *
 * THE MARK IS THIS SESSION'S OWN AGENT, NOT VAM'S -- the operator's own
 * revision: "change the agent screen's icon to the agent's icon." This
 * screen belongs to ONE session, whose agent really did exit, so its mark
 * names the SOURCE that ran it (`source`, resolved by the caller the same
 * way `terminalFor`/`isSessionDismissed` already do: `entry.session.source
 * ?? entry.project.source`) through `SourceMark` -- the ONE resolver the
 * sidebar row and the status bar already draw theirs through, never a
 * second logo table and never another provider's mark for a source nobody
 * has drawn (`markRegisterOf`'s neutral register). `GettingStarted` below,
 * the WHOLE APP's own screen with no session to name, keeps vam's own mark
 * instead -- there is no agent to be wrong about there.
 */
function TerminalOnlyStart({
  title,
  paneName,
  source,
  defaultProvider,
  onStart,
  resumeCommand,
  onResumeInPane,
  startingPane = null,
  onShowTerminal,
}: {
  readonly title: string;
  readonly paneName: string;
  readonly source: string;
  readonly defaultProvider: ProviderId | undefined;
  readonly onStart: ((id: ProviderId) => void) | undefined;
  readonly resumeCommand: string | undefined;
  readonly onResumeInPane: (() => void) | undefined;
  readonly startingPane?: StartingPaneWait | null;
  readonly onShowTerminal?: () => void;
}) {
  // `ProviderStartControls` is CONTROLLED (see its own header) -- this
  // screen's own mark above stays `source`, the session's PAST agent, never
  // this restart picker's current pick, so this state exists only to give
  // that shared component the two props it now needs.
  const [chosen, setChosen] = useState<ProviderId>(() => resolveProvider(defaultProvider).id);
  const starting = startingPane ?? null;
  return (
    <div
      data-terminal-only-start
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
    >
      {/* THE SESSION'S OWN AGENT MARK -- see this function's own header.
          `data-source-mark` records which register answered (brand, native,
          neutral), the same idiom the sidebar row and the status bar's
          `SourceGlyph` already carry it by. */}
      <IconFrame>
        <span
          data-terminal-only-mark
          data-source-mark={markRegisterOf(source)}
          role="img"
          aria-label={`this session's agent: ${source}`}
        >
          <SourceMark source={source} lane={40} />
        </span>
      </IconFrame>
      <div className="flex flex-col gap-1">
        <p className="text-control text-ink">{title}</p>
        <p className="text-meta text-ink-quiet">
          <span className="font-mono">{paneName}</span>
          {' — its agent isn’t running here now; this pane is at a shell prompt.'}
        </p>
      </div>
      <StartShortcuts testId="terminal-only-shortcuts" rows={TERMINAL_ONLY_SHORTCUT_ROWS} />
      {onStart !== undefined && (
        <ProviderStartControls
          chosen={chosen}
          onChosenChange={setChosen}
          onStart={onStart}
          disabled={starting !== null}
          starting={
            starting?.kind === 'start'
              ? {
                  label: `Starting ${resolveProvider(starting.provider).label}…`,
                  spinning: !starting.timedOut,
                }
              : null
          }
        />
      )}
      {resumeCommand !== undefined && onResumeInPane !== undefined && (
        <button
          type="button"
          data-resume-in-pane
          onClick={onResumeInPane}
          disabled={starting !== null}
          aria-busy={starting?.kind === 'resume'}
          className="vam-tap flex cursor-pointer items-center gap-1.5 text-control text-ink-dim underline decoration-line-strong underline-offset-2 hover:text-ink disabled:cursor-progress disabled:no-underline disabled:opacity-70"
        >
          {starting?.kind === 'resume' ? (
            <>
              <LoaderCircle
                size={12}
                strokeWidth={1.8}
                className={starting.timedOut ? undefined : 'vam-spin'}
              />
              Resuming…
            </>
          ) : (
            <>Resume “{title}”</>
          )}
        </button>
      )}
      {starting?.timedOut && <StartTimeoutHint onShowTerminal={onShowTerminal} />}
      <p className="max-w-[36ch] text-meta text-ink-quiet">
        {onStart === undefined
          ? 'Switch to the Terminal view and type the agent’s command — `claude` or `codex` — to start one here.'
          : 'Or switch to the Terminal view and type the command yourself; either way it runs in this same pane.'}
      </p>
    </div>
  );
}

/**
 * The Agents tab: which subagents this session spawned, running ones first and
 * by default running ones only -- and what the one you pick is doing.
 *
 * FOUR STATES, AND THREE OF THEM DRAW NO ROW FOR DIFFERENT REASONS
 * (model.ts). Absent is a source with no agent surface at all — the factory
 * reports a live count and nothing about which agents they are — and empty is
 * a source that looked and found none, which is the common case, since most
 * sessions never spawn a subagent. The third is new with the filter: agents
 * exist and none of them is running. That one must NOT fall through to
 * "spawned no agents", which would be the caption outrunning the data while
 * twenty finished agents sit one keypress away; it says how many there are and
 * keeps the toggle on screen beside it. Each gets one plain sentence. None
 * gets a spinner or a placeholder row: this pane has spent several rounds
 * having invented content removed from it.
 *
 * The default is running-only because that is what the operator opened the tab
 * to see; the toggle exists because a filter with no way out hides work. It
 * carries the count of what it is hiding, so a hidden row is never silently
 * invisible — and it counts IDLE agents, never running ones, precisely so it
 * cannot be read against the tab's `●N` running badge, which counts the whole
 * directory before the roster cap and may legitimately exceed the rows here.
 *
 * The toggle's state is component state, not a `prefs.ts` field, for the same
 * reason the chosen tab is: nothing outside this pane has an opinion about it,
 * and persisting a presentation toggle would put it in a payload every other
 * surface has to migrate around. Unlike the tab it resets per pane render,
 * which is the wanted default — the next session is asked the same question.
 *
 * It is a button, not a key chord: nothing binds it, so nothing captions it as
 * bound.
 *
 * A row survives an unreadable meta file. The agent's id and whether it is
 * running come from its own transcript, so they are facts whatever the meta
 * file says; the labels are what goes `unknown`, and the row still says who is
 * working. The roster is capped at the source (`agent-roster.ts`), so this
 * renders everything it is given and counts only what it hides.
 *
 * ── AND IT IS A NAVIGATOR NOW ────────────────────────────────────────────
 * The operator asked for the list to become a secondary navigator with the
 * selected agent's work beside it. The list keeps every rule above; what is
 * new is a SELECTION, which drives one on-demand read (`useAgentWork`). The
 * selection lives here rather than in `prefs.ts` for the toggle's own reason,
 * and it is DROPPED when its agent leaves the list: rows come off a poll, a
 * finishing agent falls out of the running-only filter, and a detail still
 * captioned with it would describe a row that is no longer on screen.
 */
function AgentsTab({
  agents,
  sessionId,
}: {
  readonly agents: readonly SessionAgent[] | undefined;
  readonly sessionId: string;
}) {
  /**
   * FROM CONTEXT, not from a prop, and `agent-work-reader.ts` carries the
   * argument: this is the source's member rather than this pane's, it takes
   * the session id it acts on, and every split leaf wants the same function.
   * `null` is an honest "this source cannot look", never a stub.
   */
  const agentWork = useAgentWorkReader() ?? undefined;
  const [showIdle, setShowIdle] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const idleCount = (agents ?? []).filter((agent) => !agent.running).length;
  const shown = showIdle ? (agents ?? []) : (agents ?? []).filter((agent) => agent.running);
  // A SELECTION MAY NOT OUTLIVE ITS ROW. Derived rather than cleaned up in an
  // effect: an effect would render once with the stale pairing on screen, and
  // the stale pairing is a detail captioned with an agent that is not there.
  const selected = shown.some((agent) => agent.id === picked) ? picked : null;
  const work = useAgentWork(sessionId, selected, agentWork);

  if (agents === undefined || agents.length === 0) {
    return (
      <p data-agents data-agents-empty className="text-control text-ink-faint">
        {agents === undefined
          ? 'This source does not report which agents a session is running.'
          : 'This session has spawned no agents.'}
      </p>
    );
  }
  const toggle =
    idleCount === 0 ? null : (
      <button
        type="button"
        data-agents-toggle
        aria-pressed={showIdle}
        onClick={() => setShowIdle((open) => !open)}
        /* `vam-tap` is the phone's 44px floor, opted into at the component the
           way `styles.css` asks for a control the shell HOSTS. Agents is one
           of the three views a phone can be in and the only control in it --
           measured 74x20 there, half a touch target, and invisible to the
           repo's census because that census only ever opened Response. */
        className="vam-tap flex-none cursor-pointer self-start rounded-[var(--radius-sm)] px-1.5 py-0.5 text-control text-ink-faint hover:bg-raised hover:text-ink"
      >
        {showIdle ? `hide ${idleCount} idle` : `show ${idleCount} idle`}
      </button>
    );
  return (
    <div
      data-agents
      /* THE QUERY CONTAINER IS THE OUTER BOX AND THE RESPONDING ROW IS INSIDE
         IT. A container query does not apply to the element that DECLARES the
         container, so `@container` and `@min-[420px]:flex-row` on one div is a
         rule that can never fire -- the pane would be one column at every
         width and nothing on screen would say so. Hence two boxes, and a
         browser guard that measures where the halves actually land: a class
         that was merely TYPED proves nothing about what paints. */
      className="@container flex min-h-0 flex-1 flex-col"
    >
      <div data-agents-split className="flex min-h-0 flex-1 flex-col gap-3 @min-[420px]:flex-row">
        {shown.length === 0 ? (
          <div data-agents-list className="flex min-h-0 flex-1 flex-col gap-1.5">
            <p data-agents-empty className="text-control text-ink-faint">
              {agents.length === 1
                ? 'This session’s one agent is not running right now.'
                : `None of this session’s ${agents.length} agents is running right now.`}
            </p>
            {toggle}
          </div>
        ) : (
          <>
            {/* THE NAVIGATOR. Below the split it yields the pane to the detail
              once something is picked; above it, it stays -- picking a second
              agent has to be one click, which is the whole word "navigator". */}
            <div
              data-agents-list
              className={[
                'flex min-h-0 flex-col gap-1.5',
                '@min-[420px]:w-[9.5rem] @min-[420px]:flex-none',
                'flex-1',
                selected === null ? '' : '@max-[420px]:hidden',
              ].join(' ')}
            >
              <ul className="vam-no-scrollbar flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
                {shown.map((agent) => (
                  <li
                    key={agent.id}
                    data-agent-row
                    data-agent-running={agent.running ? 'true' : 'false'}
                    data-agent-selected={agent.id === selected ? 'true' : undefined}
                  >
                    <button
                      type="button"
                      data-agent-pick={agent.id}
                      aria-current={agent.id === selected ? 'true' : undefined}
                      onClick={() => setPicked(agent.id)}
                      className={[
                        'flex w-full cursor-pointer items-center gap-2 rounded-[9px] border px-3 py-2 text-left',
                        agent.id === selected
                          ? 'border-line-strong bg-raised'
                          : 'border-line bg-card hover:bg-raised',
                      ].join(' ')}
                    >
                      {/* The same dot the pane header uses for a session, meaning the same
                    thing: filled and breathing while it works, quiet when it is
                    done. `running` here is "wrote to its transcript in the last few
                    minutes", which is all the source can see. */}
                      <span
                        className={[
                          'h-1.5 w-1.5 flex-none rounded-full',
                          agent.running ? 'bg-running vam-breathe' : 'bg-line-strong',
                        ].join(' ')}
                      />
                      <span className="min-w-0 flex-1">
                        <span data-agent-type className="block truncate text-body text-ink">
                          {/* No type means no readable meta file beside the transcript, so
                        the id is the only name this agent has. */}
                          {agent.type ?? `${agent.id} (type unknown)`}
                        </span>
                        <span
                          data-agent-description
                          className="mt-0.5 block truncate text-meta text-ink-faint"
                        >
                          {/* Truncated, not wrapped: a spawn description is a sentence
                        and the whole roster stays scannable. */}
                          {agent.description ?? 'no description recorded'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {toggle}
            </div>
            <div
              className={[
                'flex min-h-0 min-w-0 flex-1 flex-col',
                selected === null ? '@max-[420px]:hidden' : '',
              ].join(' ')}
            >
              <AgentDetail work={work.work} state={work.state} onBack={() => setPicked(null)} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * THE THREE BAND SEPARATORS ARE GONE (the `Rule` component with them).
 *
 * `in`, `progress` and `out` each used to open with a rule: a coloured glyph,
 * the region's word in letter-spaced capitals, a hairline across the pane and
 * a meta slot on the right. The operator asked for all three to go, for the
 * content to run out full, and for progress to condense -- the shape the
 * Claude Code plugin for VSCode has, where the prompt and the answer read as
 * continuous prose and the intermediate work collapses into one line you can
 * open.
 *
 * A separator can go; what it carried cannot. Each of the three meta slots
 * held something real, and each has a home below:
 *  - `in` held `you · <turn label>`, which joins the identity line that was
 *    already directly above it (project, epic) -- one row instead of two;
 *  - `progress` held the turns-read count and the jump `<select>`, which are
 *    now the condensed progress line itself;
 *  - `out` held the session's current activity and the two scroll-to-edge
 *    buttons, which move to that same line -- the one row of chrome the
 *    column has left, and the only place they stay reachable without a
 *    heading to hang off.
 *
 * The words survive as screen-reader-only region names (`sr-only` spans on
 * each section). A sighted reader still has the prompt's box, the spacing and
 * the prose to tell the three apart; a screen-reader user had only those
 * three words, and dropping them would trade a visual tidy-up for a real
 * loss -- this pane's own three-states reasoning (`noAnswerNote`, model.ts)
 * exists precisely so a region never goes silent about what it knows.
 */

/**
 * `in` USED TO CAP ITSELF AT TWO LINES (`IN_BODY_PX`, `IN_LEADING`,
 * `IN_LINES`, `IN_MAX_HEIGHT`, all gone with the box that wore them).
 *
 * The cap came with its own scrollbar and its own bordered panel, and that
 * combination is what the operator was still reading as a separate block once
 * the band labels came off: a boxed, independently scrolling prompt stacked
 * on top of an answer is two panels however few captions it has. So the
 * prompt is prose in the one column now -- full length, no border, no
 * scroller -- and it stays readable while you scroll by STICKING to the top
 * of that column instead of by reserving height forever.
 *
 * The pathological case is honest to name: a very long prompt now sticks at
 * full length and can cover the pane. Capping it again would restore exactly
 * the seam this removes, and clipping it would hide text; the operator asked
 * for the content to run out full, so it does.
 */

/**
 * `progress` used to open into a scrollable list of turns, capped to about
 * five rows' worth of height before it scrolled on its own (`PROGRESS_LINES`,
 * `PROGRESS_MAX_HEIGHT`). A12.2 collapses it into a single `<select>` instead
 * (see the `progress` block below) — one control regardless of how many
 * turns exist, so there is no list height left to cap. Both constants died
 * with the list; nothing else read them.
 */

/** What `to-canvas.ts` joins each summarised answer with, and splits on here. */
const ANSWER_SEPARATOR = ' · ';

/**
 * What the start of a summarised answer looks like: one bare token, then the
 * separator. `summarise` builds `eventType · taskId · detail`, so the token is
 * an event type and it never contains a space — which is what makes this
 * distinguishable from a sentence that merely uses the separator, and from
 * every markdown construct, none of which start with a bare word and a middot.
 */
const ANSWER_HEAD = /^[\w.:-]+ · /;

/**
 * The adapter's newline-joined answers, back into one string per answer.
 *
 * The newline it joins with is AMBIGUOUS and that is the whole problem here:
 * it separates two answers, and it is also every line break inside a single
 * answer's own text. The previous rendering split on it flatly, which was
 * right while an answer was one line of prose and is wrong the moment an
 * answer is markdown — a fenced block or a table is many lines and splitting
 * it produces neither a fence nor a table, just its wreckage.
 *
 * So a block breaks only where a new answer's head begins. The one input this
 * misreads is a fenced block whose own content starts a line with a bare token
 * and the separator; nothing in the joined form can tell that apart, and the
 * adapter is where a real fix would live.
 */
export function splitAnswers(output: string): string[] {
  const blocks: string[][] = [];
  for (const line of output.split('\n')) {
    const current = blocks[blocks.length - 1];
    if (current === undefined || ANSWER_HEAD.test(line)) blocks.push([line]);
    else current.push(line);
  }
  return blocks.map((lines) => lines.join('\n').trim()).filter((block) => block !== '');
}

/**
 * The sentence that stands in for an answer there is none of.
 *
 * Two absences, and they are not the same absence. `''` is a turn that
 * resolved to nothing (model.ts): it USED to fall through to `OutText`, where
 * `splitAnswers('')` filters its one empty block away and leaves an `OUT` rule
 * over blank space -- indistinguishable from a failed render.
 *
 * `null` is a turn that collected no answer event, and the adapter sets it
 * whatever the session's status (`to-canvas.ts`) -- so "still running" was
 * shown to `done` and `failed` sessions too, telling the operator to wait for
 * something that will never arrive. Only a running session is still running.
 * A `waiting` session gets neither sentence: its turn has not ended, and the
 * prose about whose move it is was removed from this pane deliberately -- the
 * breathing amber dot in the header says it.
 *
 * A THIRD ABSENCE, and it is not a reading at all. On a turn vam painted
 * itself (`unconfirmed`, model.ts) there is no source report to describe:
 * every sentence below is a claim about what a source said, and the last of
 * them -- "this turn ended without an answer" -- is the one vam least can
 * support, because nothing ended. It was the sentence the operator was shown
 * beside a Terminal tab holding the agent's actual answer. So the paint gets
 * its own, which says only what is true: the words went out and vam has not
 * heard back yet.
 *
 * A FOURTH, AND IT IS THE SAME SENTENCE CAUGHT A SECOND TIME. The paint was
 * one route to "this turn ended without an answer" beside a Terminal tab
 * holding the reply; a turn vam could not READ is the other, and it survived
 * the first fix because it is not a paint -- the source really did report this
 * turn, from a byte window that held no conversation in it at all. A single
 * transcript line can be larger than the whole window (`tail.ts`: 670 such
 * lines across 23 of the 85 transcripts measured, the largest 1,356,930
 * bytes), and then the only line left able to open a turn is the `last-prompt`
 * marker, whose branch has no answer to give. `Decision.unread` is a source
 * saying so, and it shadows every sentence below: a session vam cannot read is
 * not a session whose turn ended without an answer, and not one still working
 * on it either.
 */
function noAnswerNote(
  output: string | null,
  status: SessionStatus | null,
  unconfirmed: boolean | undefined,
  unread: boolean | undefined,
): string {
  // FIRST, and it shadows none of the sentences under it: a paint's `output` is
  // `null` by construction (`optimistic.ts`), so the two answers-exist branches
  // below were never reachable for one anyway. What it does displace is the
  // status-derived tail, which reads the SESSION's status -- and a session that
  // is `done` is not evidence about a turn the source has never mentioned.
  if (unconfirmed === true) {
    return '\u2014 waiting for the source to report this turn back \u2014';
  }
  // SECOND, and above the status-derived tail for the same reason the paint is:
  // the SESSION's status is not evidence about a turn whose transcript vam
  // could not reach. `done` does not mean this turn ended; `running` does not
  // mean its answer is still coming. Both may already be written down in a
  // window vam was not allowed to read.
  if (unread === true) {
    return '\u2014 vam could not read the answer to this turn \u2014';
  }
  // A live turn that HAS an answer still gets a line, and the absence wordings
  // would all be lies about it: it is not empty, and it is not answerless. All
  // this line asserts there is what the caret asserts -- the session is
  // running -- and it is reached only when the source could not say more.
  if (output !== null && output !== '') return '\u2014 the session is still running \u2014';
  if (output === '') return '\u2014 this turn resolved to nothing \u2014';
  if (status === 'running') return '\u2014 the session is still running, no answer yet \u2014';
  if (status === 'waiting' || status === null) return '\u2014 no answer for this turn yet \u2014';
  return '\u2014 this turn ended without an answer \u2014';
}

/**
 * `out`'s markdown component map, which lives in `./out-markdown.tsx` now --
 * it grew a second caller (`FilesTab.tsx`'s markdown preview) and importing
 * it from here would have been an import cycle through this file.
 *
 * RE-EXPORTED rather than moved silently: `test/panels/out-colour.test.tsx`
 * and `test/panels/out-font-size.test.tsx` both reach it at this path, and
 * this is the file whose name says what the map is FOR.
 */
export { OUT_MARKDOWN, OUT_URL_TRANSFORM };

/**
 * One answer: the machine-ish head it was built with, then its own markdown.
 *
 * The operator asked for `out` to read the way GitHub renders markdown, and
 * the honest place to put that is INSIDE each answer rather than over the
 * whole region. `toDecisions` builds a LIST — one summarised answer per line,
 * `eventType · taskId · detail` — and markdown has no notion of that list:
 * handed the joined string it would fold every answer into one paragraph,
 * which is exactly the flat wall the two-tone treatment was written to end.
 * So the adapter's structure stays and is what markdown is rendered within.
 * The head is a value the adapter computed, not text an agent wrote, so it
 * stays mono in `ink` and is not fed to the renderer; the detail is the
 * agent's own words and is.
 *
 * Nothing here enables `rehype-raw` or hands a string to `innerHTML`, and
 * that is not an omission: react-markdown parses to React elements and drops
 * embedded HTML by default, which is the property this library was chosen
 * for. `out` is untrusted text.
 */
function OutText({ output }: { readonly output: string }) {
  return (
    <div className="flex flex-col gap-[11px]">
      {splitAnswers(output).map((block, i) => {
        const [first = '', ...rest] = block.split('\n');
        const cut = first.lastIndexOf(ANSWER_SEPARATOR);
        // Only a line the adapter actually built gets the two-tone treatment;
        // anything else is an agent's prose and is left whole.
        const head = cut === -1 ? null : first.slice(0, cut);
        const body = [
          cut === -1 ? first : first.slice(cut + ANSWER_SEPARATOR.length),
          ...rest,
        ].join('\n');
        return (
          <div
            // The blocks have no ids of their own; their order in one answer is
            // stable and is the only thing distinguishing them.
            // biome-ignore lint/suspicious/noArrayIndexKey: no stabler id exists
            key={i}
            data-out-line
            className="flex min-w-0 flex-col gap-1 break-words"
          >
            {head !== null && (
              <span data-out-head className="font-mono text-[0.917em] text-ink">
                {head}
              </span>
            )}
            <div data-out-body className="flex min-w-0 flex-col gap-2">
              {/* `urlTransform` is vam's own, and it is a NARROWING: see
                  `OUT_URL_TRANSFORM`. react-markdown's default silently
                  blanks four schemes and admits four others, which left this
                  pane with two disagreeing lists and a refusal that could not
                  name what it refused. */}
              {/* The fallback is the answer's own raw text, unstyled -- not a
                  spinner or an empty box. `LazyMarkdown`'s chunk is local
                  (built into the app / served from the same origin), so on
                  every render after the first it is already cached and this
                  fallback never paints at all; the one render it can paint is
                  strictly more readable than a blank pane. */}
              <Suspense fallback={<div className="whitespace-pre-wrap text-ink-dim">{body}</div>}>
                <LazyMarkdown components={OUT_MARKDOWN} urlTransform={OUT_URL_TRANSFORM}>
                  {body}
                </LazyMarkdown>
              </Suspense>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The question a session is asking, when it asked one through the
 * `AskUserQuestion` tool -- and the one thing this card must never do.
 *
 * A picker stood here once whose every word was a constant, shown to any idle
 * session because `statusOf` calls everything non-busy `waiting`. This one is
 * drawn from the transcript or not at all: the text, the header, `multiSelect`
 * and the options are the tool's own record (`sources/claude-code/questions.ts`),
 * and a session that asked nothing gets no box rather than an empty one.
 *
 * PICKING ANSWERS NOTHING, and the card says so in words rather than by
 * omission. Vam's only write channel is the prompt box of a session it started;
 * there is no path that could deliver a chosen option back to the tool call
 * waiting on it. So a click MARKS the option -- the operator's own note of
 * where they landed, which they can then type into the box below -- and no
 * control here is labelled send, submit or answer.
 *
 * `multiSelect` decides the shape, so the roles are `checkbox` or `radio`
 * accordingly and a single-select card cannot hold two marks. Arrow keys walk
 * the list and the digits jump straight to an option, because `i` lands here
 * whenever a question is open -- and picking the third option should not cost
 * three arrow presses. Marking by number is still marking: nothing about the
 * paragraph above changes because the keystroke got shorter.
 */
/**
 * The number an option is picked by, or `undefined` past the ninth.
 *
 * Nine, because that is how many digits there are once `0` is left out -- and
 * `0` is left out for the reason `Mod-0` is unbound in the chord table: a
 * zeroth option is not a position anyone counts. An option past the ninth is
 * still there, still clickable and still reachable with the arrows; it simply
 * has no number, which is honest, where numbering it `0` or `10` would be a
 * badge for a key that does nothing.
 */
const NUMBERED_OPTIONS: readonly (string | undefined)[] = Array.from({ length: 9 }, (_, index) =>
  String(index + 1),
);

/**
 * THE FOCUS RING, and it is the app's, not a new one.
 *
 * `SettingsOverlay.tsx`, `PairingPanel.tsx` and `phone/PhoneShell.tsx` each
 * declare this exact string, with the reasoning written out in the first of
 * them: the renderer's other `focus-visible` (`TerminalTab.tsx`) draws
 * `line-strong`, which is 1.25:1 on `panel` in dark and therefore invisible in
 * the default theme, while `ink` measures 14.9 / 17.7 and clears every fill
 * this pane paints. The offset is load-bearing too -- flush against a
 * control's own border an outline reads as a thicker border rather than as a
 * cursor.
 *
 * A fourth copy rather than a shared export because the three that exist are
 * three copies already and one of the files holding them is being edited on
 * another branch; the string is what is shared, and `e2e/tooltip-shots.mjs`
 * measures the ring as PAINT rather than trusting any of the four.
 */
const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

/**
 * THE OPTION ROW'S OWN FOCUS RING -- subtler than `FOCUS_RING`, and scoped to
 * this card rather than a fifth copy of the app's own.
 *
 * A PICKED OPTION ALREADY WEARS A COLOUR (`border-running`) AND A FILL
 * (`OPTION_FILL`); the operator's ask was that focus read as a CURSOR beside
 * those, not as a second, competing "this is chosen" signal. `FOCUS_RING`'s own
 * `outline-ink` is the app's boldest ink for the reason its own comment gives --
 * it has to clear a fill on every OTHER surface it is drawn on -- and next to a
 * green picked border that weight reads as a second selection rather than a
 * cursor. `ink-dim` is the one already measured on THIS card, one step down
 * (`OPTION_QUIET_INK`'s own comment): 5.942:1 dark, 5.304:1 light against
 * `bg-card`, both comfortably clear of the 3:1 WCAG 1.4.11 floor a non-text
 * outline owes, and visibly quieter than `ink`. `outline-offset-1` (not `-2`)
 * keeps the ring close without touching the border it sits beside -- an
 * offset outline is drawn OUTSIDE the border box either way, so a picked
 * row's own border is never covered, only bordered again a pixel further out.
 */
const OPTION_FOCUS_RING =
  'focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-ink-dim';

/**
 * THE FILL A CONTROL ON THIS CARD TAKES WHEN IT IS TOUCHED, and the reason it
 * is not `raised`.
 *
 * PR 288 repointed the question card from `bg-panel` to `bg-card` and moved
 * most hover fills with it. The options were missed, and the miss inverted
 * them: `--vam-raised` is a rung above `panel`, which is what the card used to
 * be, and a rung BELOW `card`, which is what it is now. Measured on the
 * painted node, a hovered option sat at 1.032:1 UNDER the card holding it. So
 * touching an answer punched it below its own surface -- the exact hole PR 288
 * existed to remove, one level further in, in the flow that unblocks an agent
 * waiting on a reply.
 *
 * `line-strong` rather than a token of its own, because this file already
 * paints exactly this object: every `[data-tap-skin]` in the composer is
 * `bg-card hover:bg-line-strong`, which IS "a control on a card, touched". A
 * second name for a value already spent on that role would be two names for
 * one decision.
 *
 * DIRECTION IS PER THEME AND THAT IS NOT A DODGE. Dark climbs
 * pane < card < control, so this fill is lighter than the card: 1.125:1, ΔE
 * 4.29, against the card's own step off the pane of ΔE 2.95. Light's card is
 * the theme's white -- there is nothing above it -- so its controls darken
 * instead, as `segment-on`, every tap skin here and the artboard's own answer
 * pills already do: ΔE 14.63 against a card step of 6.24.
 * `e2e/pane-colour-shots.mjs` re-measures every one of those numbers on the
 * painted node, hovered, marked and folded, in both themes.
 */
const OPTION_FILL = 'bg-line-strong';

/**
 * THE OTHER HALF OF THE SAME DECISION, and it cannot be dropped.
 *
 * A card is already at the ceiling its own captions allow -- `styles.css` says
 * so where it fixes `--vam-card`: `ink-quiet`/`ink-faint` measure 4.735:1
 * there and fail one step lighter. So ANY fill a rung above the card puts an
 * option's quietest greys under WCAG 1.4.3, and measurement agrees: on
 * `line-strong` the faint grey reads 4.208:1 in dark and 3.691:1 in light.
 *
 * The fill and the ink therefore move TOGETHER. The number and the preview
 * lift to `ink-dim` (5.942:1 dark, 5.304:1 light) exactly while the fill is
 * under them, which keeps the resting hierarchy -- label, then description,
 * then the number and the preview -- that painting them `ink-dim` outright
 * would collapse. Both halves are held separately by the e2e guard: the fill
 * without the lift reddens the ink checks, the lift without the fill reddens
 * the elevation checks.
 */
const OPTION_QUIET_INK =
  'text-ink-faint group-hover:text-ink-dim group-data-[picked=true]:text-ink-dim';

/**
 * What Submit is allowed to claim, in the operator's words.
 *
 * ONE SENTENCE PER OUTCOME, and they are not interchangeable: a pairing vam
 * could not make, a picker that is not on screen, a picker that did not
 * respond to the probe arrow and a read-back that disagreed send a person to
 * four different places. A single "could not send" for all of them is the
 * failure the answer channel's own outcomes exist to prevent
 * (`shared/answer.ts`).
 *
 * `sent` NAMES WHAT THE PICKER READ BACK rather than what was asked for. That
 * is the whole difference between this and the route that was measured and
 * rejected: a Submit that typed the option's text reported success while the
 * agent recorded a different option, and the read-back is the only reason the
 * word is honest here.
 */
function outcomeWording(result: AnswerResult): string {
  if (result.kind === 'sent') return `sent — the picker now reads ${result.answer}`;
  const cause = stopWording(result);
  const committed = result.committed ?? [];
  // A PART-SENT SET IS NOT A DENIAL. A single-select Return answers its
  // question and advances, so a stop on step two of two leaves question one
  // inside the picker -- and "not sent" is then the one sentence that is
  // false. It names what went in and stops there: whether anything is still
  // open is the card's fact, not this sentence's, and Submit says it by
  // being drawn for exactly what is left.
  if (committed.length > 0) return `${committed.join(', ')} went in — then it stopped: ${cause}`;
  // `unconfirmed` never took the "not sent" prefix and still must not: the
  // keys DID go in, and denying them is the whole failure this file guards.
  return result.kind === 'unconfirmed' ? `unconfirmed — ${cause}` : `not sent — ${cause}`;
}

/** Why it stopped, as a clause the sentence above puts a subject in front of. */
function stopWording(result: Exclude<AnswerResult, { readonly kind: 'sent' }>): string {
  switch (result.kind) {
    case 'unaimed':
      return 'vam could not name one session of its own for this project';
    // NOT the sentence above, and the difference is where it sends a person:
    // vam never got a listing, so there is no pairing to go and look at.
    case 'unavailable':
      return 'vam could not ask tmux, so it never looked for a session';
    // vam named a session and refused it. Saying it could not name one is
    // false in the way that costs an operator time.
    case 'mispaired':
      return 'this row is in a pane vam cannot use for this project';
    case 'refused':
      return 'tmux would not deliver to that session';
    case 'unreadable':
      return 'vam could not read the screen';
    case 'no-picker':
      return 'that picker is not on the screen';
    case 'not-live':
      return 'the picker did not answer the probe arrow';
    case 'unmatched':
      return `${result.label} is not on the screen`;
    case 'wrong-question':
      // The set is walked one question at a time and the CLI moves itself
      // between them, so "vam looked and it was not this one" is a real answer
      // and a different one from every refusal above it.
      return `the session is not showing ${result.question}`;
    default:
      return `the keys went in and the screen does not agree about ${result.label}`;
  }
}

/**
 * What the mode row may claim after a Shift-Tab. ONE SENTENCE PER OUTCOME,
 * for the reason `outcomeWording` has one -- and saying NOTHING is the
 * outcome to avoid: the chord is invisible once pressed, so silence reads as
 * "the mode changed" for an agent that was never put into it.
 */
type CycleNote = {
  /** `busy` while the keys are out, then one of the two answers. */
  readonly kind: 'busy' | 'sent' | 'refused';
  readonly text: string;
};

function cycleWording(result: PaneSendResult): string | null {
  switch (result) {
    case 'sent':
      return null;
    case 'unaimed':
      return 'not sent — vam could not name one session of its own for this row';
    case 'unavailable':
      return 'not sent — vam could not ask tmux, so it never looked for a session';
    case 'mispaired':
      return 'not sent — this row is in a pane vam cannot use for this project';
    default:
      return 'not sent — tmux would not deliver to that session';
  }
}

/**
 * The model control's own note -- ONE route now, and what it costs, which is
 * nothing beyond this session.
 *
 * IT USED TO NAME TWO. "an alias switches this session only; a full id also
 * becomes the default for new sessions" was true while the picker carried a
 * free-text row and main fell back to `/model <id>` + Return for it. The
 * operator chose refusal over that fallback, so the second clause describes a
 * route that does not exist -- and a note promising a settings change vam will
 * not make is worse than one that never mentioned it.
 *
 * See the `Note` it is handed to for the measurement, and `MAX_TIP` in
 * `DetailPanel.tooltip-length.test.tsx` for why it is this short.
 */
const MODEL_PICKER_NOTE =
  'drives this session’s own /model menu — it switches this session only, and changes nothing for later ones';

/**
 * WHAT THE MODEL PICKER MAY CLAIM after a switch, one sentence per outcome.
 *
 * THE SCOPE IS THE HEADLINE AND IT LEADS, because the caption is a single
 * `truncate` line: whatever is said first is the part that survives a narrow
 * pane. And there is one scope to lead with now -- vam drives the CLI's own
 * menu and presses `s`, which the CLI answers with `for this session only`.
 * The second success sentence this used to have, "also saved as the default
 * for new sessions", belonged to the argument form vam took for a full model
 * id; the operator chose refusal over that disclosure, so what was a second
 * kind of success is `not-in-menu`, a refusal that names the remedy.
 *
 * A REFUSAL NAMES THE WAY OUT WHERE THERE IS ONE, which is why `not-in-menu`
 * spells the line rather than merely declining: typing `/model <id>` at the
 * REPL is still the operator's to do, and doing it knowingly is their call.
 * What vam will not do is make that write on their behalf.
 *
 * THE LAST FOUR ARE THE PANE CHANNEL'S OWN WORDS, said by calling
 * `cycleWording` rather than by copying it: `unaimed`, `unavailable`,
 * `mispaired` and `refused` are the same four states the mode chip and the
 * keystroke strip meet, and two surfaces describing one state in different
 * words is its own defect (`shared/terminal.ts` records that one being fixed).
 */
function modelSwitchNote(result: ModelSwitchResult, title: string, choice: string): CycleNote {
  switch (result.kind) {
    case 'sent':
      return {
        kind: 'sent',
        // NOT "typed /model opus": vam typed `/model` bare and walked the
        // menu, and a caption naming a line vam did not type would be the
        // kind of small lie this whole module exists to remove.
        text: `${choice} set for this session only, on the /model menu in the terminal of ${title} — the session answers there`,
      };
    case 'not-in-menu':
      return {
        kind: 'refused',
        // THE WAY OUT COMES FIRST, and that is not a style choice. This
        // caption is drawn in a `truncate whitespace-nowrap` line (see
        // `data-mode-cycle` below), so roughly forty characters of it are
        // ever on screen at a composer's width -- and the first draft of
        // this sentence put the remedy at character 163 of 220, where no
        // operator would have read the one part that tells them what to do.
        // `title` on that span is what keeps the rest reachable.
        //
        // `choice` is read off the RESULT and not off the closure: main
        // answers about what it was asked, and a caption naming the local
        // variable would drift the day the two stop being the same string.
        text: `not sent — type /model ${result.choice} in the Terminal tab yourself: it has no row on the /model menu, and the form that takes one also saves it as your default`,
      };
    case 'question':
      return {
        kind: 'refused',
        // The question in its OWN words: the operator has to know which one,
        // and the pane may be off screen behind this tab. A picker with
        // nothing above its rows leaves main no title to send, and vam says
        // that rather than quoting an empty string.
        text:
          result.title === ''
            ? `not sent — ${title} has a menu open; close or answer it first, then switch`
            : `not sent — ${title} is asking “${result.title}”; answer it first, then switch`,
      };
    case 'no-menu':
      return {
        kind: 'refused',
        // SAID PLAINLY, because it is what really happens when the REPL is
        // busy: the text lands in the input and the Return submits it. A
        // refusal claiming nothing was sent would be a claim vam cannot make.
        text: `not sent — ${title} did not open its /model menu, and the /model line may have reached the agent as a prompt`,
      };
    case 'not-live':
      return {
        kind: 'refused',
        text: `not sent — the /model menu of ${title} did not answer vam’s arrow, so vam closed it rather than press a row it had not read`,
      };
    case 'unmatched':
      return {
        kind: 'refused',
        text: `not sent — ${result.label} is not a row on the /model menu of ${title}`,
      };
    case 'unreadable':
      return { kind: 'refused', text: `not sent — vam could not read the screen of ${title}` };
    default:
      // `cycleWording` answers `null` for `sent` alone, which cannot reach
      // here: the four kinds left are exactly the pane channel's refusals.
      return { kind: 'refused', text: cycleWording(result.kind) ?? 'not sent' };
  }
}

/**
 * The phone keystroke strip's seven keys -- vam's real `PaneKey` shapes, not
 * orca's five: there is no `PaneKey` kind for a plain Tab (`terminal.ts`), so
 * it is refused outright rather than drawn as a button that always fails.
 * `id` is the strip's own attribute name, distinct from `PaneKey['kind']`
 * only for `space` (a `text` key rather than a kind of its own) and for
 * `up`/`down` (both `nav`, distinguished by `PaneKey.nav` the way `space`
 * is distinguished by `PaneKey.text`).
 *
 * UP/DOWN ARE THE ADDITION, vam/terminal-arrows: a phone has no arrow keys at
 * all, and Claude Code's own option pickers -- `AskUserQuestion`, a
 * permission prompt, `/model`, `/config`, plan approval -- are walked with
 * exactly them, the same report the Terminal tab's own keyboard fix answers.
 * Left/Right are not here: nothing on this strip is a line of text to move a
 * caret through, and every picker this strip exists for walks its rows with
 * Up/Down alone.
 *
 * Escape and Enter carry a visible caption naming a different destination
 * than their textarea siblings already claim (`Esc → sidebar`, the send
 * arrow) -- the one place this spec asks for exact wording rather than
 * leaving it to the coder.
 *
 * `chord` IS A `chords.ts` TOKEN, NOT A GLYPH -- this shipped as seven
 * literal unicode captions (`⏎`, `⌫`, `⇧⇥`, `␣`) typed straight in, painted
 * unconditionally on every platform including the Android phone this same
 * bundle is served to over Tailscale. A second table nobody kept in sync
 * with the first: `Esc` was a hard-coded WORD even on an iPhone, where every
 * other surface in this app paints `chords.ts`'s own `⎋`, and `⇧⇥` carried no
 * space where the rest of the app has painted one between every glyph since
 * the operator asked for it. `chord`/`suffix` let the button ask
 * `chordSymbols`/`ChordGlyphs` the same question every other chord in the
 * app asks, so this strip can no longer drift from that one table.
 */
const KEY_STRIP: readonly {
  readonly id: string;
  readonly key: PaneKey;
  readonly chord: string;
  readonly suffix: string;
  readonly ariaLabel: string;
}[] = [
  {
    id: 'escape',
    key: { kind: 'escape' },
    chord: 'Escape',
    suffix: ' → agent',
    ariaLabel: 'press Escape in the session',
  },
  {
    id: 'enter',
    key: { kind: 'enter', shift: false },
    chord: 'Enter',
    suffix: ' → agent',
    ariaLabel: 'press Enter in the session',
  },
  {
    id: 'backspace',
    key: { kind: 'backspace' },
    chord: 'Backspace',
    suffix: '',
    ariaLabel: 'press Backspace in the session',
  },
  {
    id: 'back-tab',
    key: { kind: 'back-tab' },
    chord: 'Shift-Tab',
    suffix: '',
    ariaLabel: 'press Shift-Tab in the session',
  },
  {
    id: 'space',
    key: { kind: 'text', text: ' ' },
    chord: ' ',
    suffix: '',
    ariaLabel: 'press Space in the session',
  },
  {
    id: 'up',
    key: { kind: 'nav', nav: 'up' },
    chord: 'ArrowUp',
    suffix: '',
    ariaLabel: 'press the up arrow in the session',
  },
  {
    id: 'down',
    key: { kind: 'nav', nav: 'down' },
    chord: 'ArrowDown',
    suffix: '',
    ariaLabel: 'press the down arrow in the session',
  },
];

/** The strip button's plain-text caption -- what `sendKey` reports in the
 *  shared "sent"/"sending…" banner, where a component has no home. Read off
 *  the SAME token the button paints, through the SAME `chordSymbols`, so the
 *  banner and the button can never name the key two different ways. */
function stripCaption(item: (typeof KEY_STRIP)[number]): string {
  return `${chordSymbols(item.chord)}${item.suffix}`;
}

/**
 * THE PERSISTENT-PERMISSION KEYWORD TABLE -- one list, read in one place,
 * for the one thing it is allowed to do: put a subtle marker on an option
 * row and ask for a second tap before marking it. DEVIATION, approved
 * (docs/design/phone-core-loop.md §3.3, §3.7 PR4).
 *
 * IT READS OPTION TEXT, and that is against this file's own discipline
 * everywhere else (`answer.ts`: "nothing here reads mtime, status… the
 * mistakes the placeholder picker was built on" -- vam displays what a tool
 * wrote, it does not interpret it). This is the one approved exception,
 * because the two options the operator flagged are not symmetric in risk:
 * "Yes, don't ask again" changes a STANDING POLICY for the rest of the
 * session, and a phone reply is typically a fast, half-attentive tap.
 *
 * WHY, so a future reader does not widen it believing it is inert: this is
 * a STRING MATCH ON A LABEL, not a classification vam has any authority
 * over. It must never become a gate -- `answer.ts` still sends whatever the
 * card marks, on the same Submit, exactly as before. It only slows the FIRST
 * tap on a matching row down to an arm-then-confirm, and only the row's own
 * decoration says why.
 *
 * CASE-INSENSITIVE, SUBSTRING: Claude Code's own option vocabulary varies
 * the exact phrasing around a fixed core ("Yes, and do not ask again for
 * scripts/rebuild-index.sh" -- `fixtures/demo.ts`'s `DEMO_PROMPT`, the
 * ACTUAL wording `factory-sse-1` draws in the `?demo=1` fixture this spec's
 * own screenshots use), so the match has to find the phrase inside a longer
 * sentence, not equal it. BOTH the contraction and the expanded form are
 * listed rather than guessed at: a model may write either.
 */
const PERSISTENT_PERMISSION_KEYWORDS: readonly string[] = [
  "don't ask again",
  'do not ask again',
  'always allow',
  'allow all',
  'skip',
  'bypass',
];

/** Whether an option's own label names a persistent-permission choice --
 *  see the table above for what this may and may not be used for. */
function isPersistentPermissionOption(label: string): boolean {
  const lower = label.toLowerCase();
  return PERSISTENT_PERMISSION_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/** How long an armed persistent-permission row waits for its confirming tap
 *  before disarming on its own -- long enough that a genuine second tap is
 *  never raced by it, short enough that a row does not stay "armed" (and
 *  therefore one accidental tap away from marking itself) for the rest of
 *  the operator's visit to this question. */
const ARM_TIMEOUT_MS = 3000;

function QuestionCard({
  questions,
  firstOptionRef,
  onChat,
  onAnswer,
  onSuggest,
  phone = false,
}: {
  /**
   * THE WHOLE SET asked by one `AskUserQuestion` call, in asking order.
   *
   * It was one question, and that was a hole rather than a simplification: a
   * call carrying two put the newest -- the SECOND -- on screen and the first
   * nowhere at all. The tool has always modelled a set
   * (`panels/question-set.ts`); this draws it as steps, one at a time, which
   * is also how the CLI itself walks it.
   */
  readonly questions: readonly AgentQuestion[];
  readonly firstOptionRef: RefObject<HTMLButtonElement | null>;
  /** "Chat about this" — the one entry that does something rather than mark. */
  readonly onChat: () => void;
  /**
   * Deliver the marks to the session's own picker, or `null` where there is no
   * delivery to offer. `null` DRAWS NO BUTTON: a Submit over a source vam
   * cannot write to is a control that lies about what it will do.
   */
  readonly onAnswer: ((request: AnswerRequest) => Promise<AnswerResult>) | null;
  /**
   * What the composer should OFFER as a ghost, whenever there is a composer to
   * offer it in -- the label of the showing step's mark, or its first option
   * where nothing is marked yet, and `null` when this step has nothing to
   * suggest. The card owns `marks` and `showing`, so the alternative was
   * re-deriving a suggestion in the pane that could disagree with the card the
   * operator is looking at.
   *
   * It is a SUGGESTION and nothing more: what the composer does with it is the
   * existing record-or-submit path, unchanged. See the prompt box's own Tab
   * branch.
   */
  readonly onSuggest?: (label: string | null) => void;
  /**
   * Draws the phone-inline skin instead of the desktop's fixed-block card
   * (docs/design/phone-core-loop.md §3.3): the same internals (state,
   * handlers, `AnswerRequest` construction, ARIA structure) -- ONLY the root
   * element's own classes change, from a bordered `bg-card` box to a
   * left-edge accent bar that inherits the transcript's own turn spacing,
   * because the card is now a message IN that transcript rather than a
   * panel pulled out of it. `false` (desktop, and every existing caller) is
   * byte-identical to before this prop existed.
   */
  readonly phone?: boolean;
}) {
  /**
   * THE SEND KEY, off the same preference the composer itself reads
   * (`prefs/submit-key.ts`) -- Submit's own chord chip, below, follows
   * whichever key the operator chose, the same subscription `DetailPanel`
   * already holds for its composer's use.
   */
  const submitKey = useSyncExternalStore(
    subscribePromptSubmitKey,
    activePromptSubmitKey,
    activePromptSubmitKey,
  );
  /** Which step is showing, and what has been marked on EACH of them. */
  const [showing, setShowing] = useState(0);
  /**
   * The card's grammar, off the operator's own table rather than out of the
   * literals that used to sit in the handler below. The sheet already promised
   * the `move` binding walks these options; now it does. Every shape of card
   * -- single, multi-select, and each step of a multi-question call -- reads
   * this one value, because a picker driven by one grammar beside a prompt
   * driven by another is what the operator asked to stop.
   */
  const keys = questionKeys();
  const [marks, setMarks] = useState<Readonly<Record<string, readonly string[]>>>({});
  /**
   * WHICH OPTION A PHONE TAP HAS ARMED, NOT YET CONFIRMED -- the double-tap
   * for a persistent-permission option (`isPersistentPermissionOption`'s own
   * doc has the argument). `null` at rest, and a real tap on the row a
   * SECOND time (`toggle`, below) is what confirms it. Scoped to `phone`
   * only, and to a REAL tap only (`viaPointer`) -- desktop and every
   * keyboard route are byte-identical to before this existed.
   */
  const [armedLabel, setArmedLabel] = useState<string | null>(null);
  const armTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarm = () => {
    if (armTimeout.current !== null) clearTimeout(armTimeout.current);
    armTimeout.current = null;
    setArmedLabel(null);
  };
  /** What the last Submit came back with, and whether one is in flight. */
  const [outcome, setOutcome] = useState<AnswerResult | null>(null);
  const [sending, setSending] = useState(false);
  /**
   * WHY THE LAST SUBMIT DID NOT GO, when the reason is on this side.
   *
   * Separate from `outcome`, which is what the SESSION'S PICKER said: a set
   * short of a mark never reached it, so filing that under the same state
   * would put words in the picker's mouth.
   *
   * It exists because Submit used to be `disabled` while any step was
   * unmarked -- visible, faint, taking no click and no focus, and explaining
   * nothing. That is "absent, not dimmed" broken in the one flow that
   * releases a blocked agent, and it was worst on a call carrying ONE
   * question: the marked-count hint only rendered past the first, so a lone
   * unanswered question got no sentence at all. The control is operable now
   * and refuses out loud, naming the step it is short of and putting the
   * cursor on it.
   */
  const [refusal, setRefusal] = useState<string | null>(null);
  /**
   * WHAT A PREVIOUS SUBMIT ALREADY GOT INTO THE PICKER, in asking order.
   *
   * The set is walked one question at a time and each single-select answer
   * advances the CLI, so an attempt that stopped half way left the screen on a
   * later question. Re-sending the whole set from there is matched against a
   * screen that has moved on -- `wrong-question`, every time, which is how a
   * part-delivered set became one the operator could not finish from the UI at
   * all. Submit resumes at the first step the picker has not taken.
   */
  const [taken, setTaken] = useState<readonly string[]>([]);

  // One `tool_result` closes a whole call, so a part-answered set is not
  // something Claude Code produces -- but the model permits it, and a step
  // that is settled shows its answer and stands aside rather than blocking the
  // rest. The card is drawn while ANY step is open.
  const question = questions[Math.min(showing, questions.length - 1)];
  const openSteps = questions.filter((one) => one.answer === null);
  const open = openSteps.length > 0;
  /**
   * Amber IS `open`, nothing narrower. A card with an open step is a live
   * block whether or not vam can type the answer -- `--color-waiting` means
   * "blocked on you", not "vam can act here". `onAnswer` used to gate this
   * too, and the note-suppression rule it copied from the same term, which
   * meant `WaitingNote`'s own remedy line stayed drawn over the exact card
   * whose `data-question-note` states a route of its own -- two sentences
   * naming two different routes for one ask (`permission-prompt-desktop.png`).
   * A single condition here means the paint and the attribute can never
   * disagree with each other.
   */
  const waiting = open;
  const picked = question === undefined ? [] : (marks[question.id] ?? []);
  /** What is left to send: every open step the picker has not already taken. */
  const pending = openSteps.slice(taken.length);
  /** The pending steps still waiting for a mark -- what Submit is short of. */
  const unmarked = pending.filter((one) => (marks[one.id] ?? []).length === 0);
  const takenIds = new Set(openSteps.slice(0, taken.length).map((one) => one.id));
  /**
   * An ANSWERED step suggests nothing: there is nothing left to reply with.
   * A multi-select's marks are joined the way the operator would have typed
   * them, because that is all the composer can carry -- text.
   */
  const suggested =
    question === undefined || question.answer !== null
      ? null
      : picked.length > 0
        ? picked.join(', ')
        : (question.options[0]?.label ?? null);
  useEffect(() => {
    onSuggest?.(suggested);
    // Withdrawn on the way out, so a card that unmounts -- the question was
    // answered, the session changed -- cannot leave a stale offer standing in
    // a composer that outlives it.
    return () => onSuggest?.(null);
  }, [suggested, onSuggest]);

  /**
   * Steps CLAMP where options wrap, and the difference is deliberate. A list of
   * options is a ring -- there is no last one. A set of steps is a sequence
   * with a Submit at the end of it, and stepping past the last one back to the
   * first reads as progress that did not happen.
   *
   * IT ALSO CARRIES THE CURSOR. The option cursor is DOM focus rather than an
   * index, so the button holding it unmounts when the step changes and focus
   * falls back to `document.body` -- and from the body the keys are no longer
   * this listbox's. React reconciles the options by label, so the cursor
   * survived only when a label happened to recur in the next question (it
   * does: `Cobalt` was measured in both questions of a real call), which made
   * the same gesture work or fail depending on the call. `landing` is the step
   * a walk asks the effect below to put the cursor on -- and a walk that the
   * clamp turned into a no-op asks for nothing, because the cursor is already
   * where the operator put it.
   */
  /**
   * WHICH STEP HAS FOLDED ITS OPTIONS AWAY, by question id.
   *
   * Operator: "after choosing an option, shouldn't the option panel hide?" —
   * asked, not specified, and the trap in it is this card's own rule: A PICK
   * IS ONLY A MARK. A list that simply vanishes on a click reads as "sent",
   * which is the defect this file has spent its whole life refusing. So the
   * fold keeps the mark on screen, keeps `data-question-note` (the sentence
   * that says a mark is not a delivery) under it, and keeps a way back in.
   *
   * KEYED BY QUESTION so walking to another step of the same call arrives
   * expanded — the fold is about the step you just answered, not the card.
   *
   * SET ON A POINTER PICK ONLY. The listbox owns the picker's keyboard (the
   * digits, `j`/`k`, `h`/`l`, `c`) through a listener on the element itself,
   * so folding after a keyboard pick would unmount the grammar mid-sequence
   * and drop the cursor to `document.body`. `UIEvent.detail` carries which
   * one happened, the same fact the tab strip reads for the same reason.
   *
   * AND SINGLE-SELECT ONLY: on a multi-select, one pick is not a choice made.
   */
  const [foldedStep, setFoldedStep] = useState<string | null>(null);
  const [landing, setLanding] = useState<number | null>(null);
  const stepTabRef = useRef<HTMLButtonElement>(null);
  /**
   * WHICH OPTION THE PREVIEW PANEL FOLLOWS -- the operator's own cursor, read
   * off real DOM focus rather than re-derived, because focus is already the
   * one true cursor this listbox has (`landing`'s own comment). `null` while
   * nothing in this step has been focused yet, which the panel below reads as
   * "fall back to the marked option, else the first one that has a preview at
   * all" rather than as "show nothing".
   *
   * RESET ON A STEP CHANGE. A label that recurs across steps is the same
   * hazard `landing`'s comment names for the DOM cursor -- "Cobalt" seen in
   * both -- and this is a second value with the same failure mode, so it gets
   * the same discipline: cleared the instant the step itself changes, before
   * the landing effect below puts real focus (and therefore a real value)
   * back onto it.
   */
  const [focusedLabel, setFocusedLabel] = useState<string | null>(null);
  // `question?.id` -- `questions` can be empty before the early `return null`
  // below, and `folded`/`showingTaken` beside this guard the same way. The
  // body reads nothing off `question`: the dependency is deliberate, WHEN
  // this fires is what matters (a fresh step means the DOM buttons carrying
  // the label are fresh too), not what it reads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  useEffect(() => {
    setFocusedLabel(null);
  }, [question?.id]);
  // A step change is a different question -- an arm standing from the last
  // one would confirm on a row that never asked for a second tap. Same
  // discipline the effect just above states, for a different piece of state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `disarm` is a fresh closure every render; only `question?.id` should re-run this.
  useEffect(() => {
    disarm();
    return disarm;
  }, [question?.id]);
  /** Whether it moved. The caller needs the answer: a step that clamped is a
   *  keystroke the card did not use, and `h` means something else when it is
   *  not walking (see `onKeys`). */
  const walk = (by: number): boolean => {
    const next = Math.min(Math.max(showing + by, 0), questions.length - 1);
    if (next === showing) return false;
    setShowing(next);
    setLanding(next);
    return true;
  };

  /**
   * The cursor lands on the new step's first option -- or on its TAB, in the
   * two cases where the options are not something to choose between any more:
   * a step already answered, which draws no list at all, and a step the picker
   * has already taken in, whose list is still drawn and still clickable while
   * Submit carries only what comes after it. Landing on marks that can never
   * be sent is landing on a control that does nothing, which is the same
   * failure as landing on the canvas.
   *
   * Only after a WALK: arriving at the card is `active`'s business one screen
   * down, and stealing focus on every render would take it off whatever the
   * operator clicked.
   */
  const showingTaken = question !== undefined && takenIds.has(question.id);
  /** This step's options are folded away behind its own mark — see
   *  `foldedStep`. Never with nothing marked: there would be nothing to fold. */
  const folded = question !== undefined && foldedStep === question.id && picked.length > 0;
  /**
   * THE PREVIEW PANEL'S OWN INPUTS -- see its render below for the shape.
   *
   * `hasPreview` gates the panel's existence: at least one option of THIS
   * step carries one, or there is nothing to split the card over and it
   * draws exactly as it always has. `activeOption` is the panel's content --
   * the focused option, else the marked one, else the first option that
   * carries a preview at all, so the panel is never blank while `hasPreview`
   * is true. `sideBySide` is single-select only: Claude Code's own picker
   * shows a preview column beside a single-select list and never beside a
   * multi-select one (multiple marks would leave several previews wanting
   * the same column), so a multi-select question with previews gets the
   * panel BELOW the list, at every width.
   */
  const hasPreview = question?.options.some((one) => (one.preview ?? null) !== null) ?? false;
  const sideBySide = hasPreview && question?.multiSelect === false;
  const activeOption =
    question === undefined
      ? undefined
      : ((focusedLabel === null
          ? undefined
          : question.options.find((one) => one.label === focusedLabel)) ??
        (picked[0] === undefined
          ? undefined
          : question.options.find((one) => one.label === picked[0])) ??
        question.options.find((one) => (one.preview ?? null) !== null));
  useEffect(() => {
    if (landing === null) return;
    setLanding(null);
    const target = showingTaken
      ? stepTabRef.current
      : (firstOptionRef.current ?? stepTabRef.current);
    target?.focus();
  }, [landing, showingTaken, firstOptionRef]);

  /**
   * `marksOverride` exists for ONE caller: Enter marking the last unmarked
   * option and sending in the same keystroke. `setMarks` is async, so a
   * `send()` invoked right after it inside the same handler would still read
   * the marks from BEFORE this keystroke — every step but the one just marked
   * would be right, and that one would come up empty and trip the guard two
   * lines down, so the operator's last Enter would look like it did nothing.
   * Defaults to the component's own state, so every other caller (the Submit
   * button, `Mod-Enter`) is unchanged.
   */
  const send = async (marksOverride: Readonly<Record<string, readonly string[]>> = marks) => {
    // The marks IN THE ORDER THEY ARE DRAWN, not the order they were clicked:
    // the review screen on the other side names them in the picker's own
    // order, and an answer that reads back in a different one would look like
    // a disagreement.
    // EVERY OPEN STEP, in asking order, each carrying its own question TEXT --
    // which is what lets the other side check which question it is looking at
    // before it matches a label against it (`main/terminal/answer.ts`). An
    // answered step is not re-answered.
    const steps = pending.map((one) => ({
      question: one.question,
      labels: one.options
        .map((option) => option.label)
        .filter((label) => (marksOverride[one.id] ?? []).includes(label)),
      multiSelect: one.multiSelect,
    }));
    if (onAnswer === null || sending || steps.length === 0) return;
    if (steps.some((one) => one.labels.length === 0)) return;
    setRefusal(null);
    setSending(true);
    const result = await onAnswer({ steps });
    setOutcome(result);
    // What the picker took in before it stopped is not offered again: those
    // questions are behind the CLI's own cursor now.
    const got = result.kind === 'sent' ? undefined : result.committed;
    if (got !== undefined) setTaken((already) => [...already, ...got]);
    setSending(false);
  };

  /**
   * What Submit does when the set is not complete: say which step is short,
   * and go to it.
   *
   * WALKING IS HALF THE ANSWER. A card shows one step at a time, so naming a
   * step the operator then has to go and find is a refusal that costs them
   * the search. `landing` is the same channel the `h`/`l` walk uses, so the
   * cursor ends up on that step's first option and the next keystroke marks
   * it.
   */
  const refuse = (short: AgentQuestion) => {
    const at = questions.indexOf(short);
    const named = short.header ?? `step ${at + 1}`;
    setRefusal(`not sent — ${named} has no mark yet: ${short.question}`);
    if (at < 0) return;
    setShowing(at);
    setLanding(at);
  };

  /**
   * SUBMIT'S OWN DECISION, whoever asks for it: send if every pending step
   * carries a mark, else name and go to the first one that does not. The
   * button's `onClick` used to inline this; `Mod-Enter` needed the identical
   * rule from a second place, so it is a function now rather than a second
   * copy that could drift from the first.
   */
  const trySend = () => {
    const short = unmarked[0];
    if (short === undefined) {
      void send();
      return;
    }
    refuse(short);
  };

  const toggle = (label: string, viaPointer = false) => {
    // ARM, DO NOT MARK -- the first real tap on a persistent-permission row,
    // on phone. `viaPointer` is already exactly "a real tap, not a keyboard
    // route" (see the option button's own `onClick`), which is also the
    // right scope for this: the deviation is about a fast, half-attentive
    // finger, not about a keyboard grammar that already types out an
    // explicit key per step. Confirmed on the SECOND tap of the SAME row,
    // which falls through to the ordinary mark below.
    if (phone && viaPointer && isPersistentPermissionOption(label) && armedLabel !== label) {
      setArmedLabel(label);
      if (armTimeout.current !== null) clearTimeout(armTimeout.current);
      armTimeout.current = setTimeout(disarm, ARM_TIMEOUT_MS);
      return;
    }
    if (armedLabel === label) disarm();
    // The refusal named a missing mark. Marking anything is the operator
    // answering it, so it stops being on screen -- a refusal that outlives
    // its cause is the next thing to be ignored.
    setRefusal(null);
    if (viaPointer && question !== undefined && !question.multiSelect) {
      // Fold only when the click MARKS. Clicking the marked option again
      // clears it, and folding on that would hide an empty list behind a
      // summary with nothing to summarise.
      setFoldedStep((marks[question.id] ?? []).includes(label) ? null : question.id);
    }
    setMarks((current) => {
      if (question === undefined) return current;
      const held = current[question.id] ?? [];
      return {
        ...current,
        [question.id]: question.multiSelect
          ? held.includes(label)
            ? held.filter((one) => one !== label)
            : [...held, label]
          : held.includes(label)
            ? []
            : [label],
      };
    });
  };

  /**
   * ENTER'S OWN PICK — a CLI picker's Enter, not a form's, and the reason it
   * is not `toggle` twice over.
   *
   * NEVER AN UNMARK. `toggle` flips a held option off on a second press;
   * Enter must not, because the second half of this function reads what the
   * cursor is ON as "answered" and would walk the operator PAST a step whose
   * only mark it had just taken away — an Enter that silently unpicked its
   * own row.
   *
   * THE MARK AND THE DECISION ARE ONE COMPUTATION, not `toggle()` followed by
   * a read of `marks` — `setMarks` is async, so a read straight back would
   * still see the value from before this keystroke for the option just
   * marked, exactly the trap `send`'s `marksOverride` comment states. Working
   * out `nextMarks` here once, and handing it to both `setMarks` and `send`,
   * is what keeps the write and the decision from disagreeing about what this
   * keystroke did.
   */
  const confirm = (option: { readonly label: string }) => {
    if (question === undefined) return;
    setRefusal(null);
    const already = picked.includes(option.label);
    const nextMarks: Readonly<Record<string, readonly string[]>> = already
      ? marks
      : {
          ...marks,
          [question.id]: question.multiSelect ? [...picked, option.label] : [option.label],
        };
    if (!already) setMarks(nextMarks);
    const short = pending.find((one) => (nextMarks[one.id] ?? []).length === 0);
    if (short === undefined) {
      void send(nextMarks);
      return;
    }
    refuse(short);
  };

  /**
   * The listbox's keys — ONE RESOLUTION, AND IT IS NOT THIS FILE'S.
   *
   * `resolveQuestionKey` (`keyboard/question-keys.ts`) turns a NORMALIZED
   * keystroke into what the card should do, with the operator's own bindings
   * ahead of the built-in digits and Enter/Space. That module carries the
   * argument and audit F2, which is what this listener used to be: a second
   * vocabulary (raw `event.key`) resolved in a second order (its own digits
   * first), so a motion rebound onto `1` was silently lost and one rebound
   * onto `Mod-j` could never match at all.
   *
   * The blanket "reject anything modified" guard is gone with it, and nothing
   * is weaker for that: a normalized `Mod-c` is not `c` and a normalized
   * `Mod-2` is not `2`, so the copy chord and the tab chords reach the window
   * listener by construction instead of by this file listing them.
   *
   * The digits stay BARE, and one of the two reasons that was safe has EXPIRED
   * -- corrected here rather than left to be believed. This paragraph used to
   * end "and the canvas grammar binds no bare digit". IT BINDS NINE OF THEM
   * NOW: `1`..`9` are `pickView`'s one-key spelling (`SELECT_DIGITS`,
   * `keyboard/chords.ts`), added at the operator's request.
   *
   * The other reason stands and was always the load-bearing one: this listener
   * only fires while the keyboard is already inside the options list, it sits
   * BELOW the window listener in the bubble path, and it cancels what it
   * handled -- so the card claims a digit first and `Canvas.tsx` returns on
   * `defaultPrevented`. The new binding adds a second, independent guard
   * rather than relying on that: a bare digit is Select-only
   * (`isSelectOnlyChord`), and an open question card is an insert scope.
   */
  const onKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const action = resolveQuestionKey(normalizeKey(event));
    if (action === null) return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-question-option]'),
    ];
    if (action.kind === 'chat') {
      // The way out of the picker and into prose. The entry itself is a button
      // outside the list, reached by Tab or mouse and activated by Enter,
      // Space or a click, like any other.
      event.preventDefault();
      onChat();
      return;
    }
    if (action.kind === 'mark') {
      const option = question?.options[action.at];
      if (option === undefined) return;
      event.preventDefault();
      toggle(option.label);
      // The keyboard follows the mark, so the arrows walk on from where you
      // landed rather than from wherever you were.
      buttons[action.at]?.focus();
      return;
    }
    /**
     * `j`/`k` walk the options and `h`/`l` walk the STEPS — the Insert half of
     * the operator's table, with both axes meaning something.
     *
     * The horizontal pair used to do nothing at all, deliberately: unhandled,
     * it falls through to the canvas grammar and walks under a pane the
     * operator is reading, which is the same "the keys work, they just do the
     * wrong thing" failure the mode naming exists to end. It is still stopped
     * from reaching the canvas; a set of questions simply gives it the meaning
     * the vertical pair always had — down the options, across the questions.
     * THE WAYS BACK TO SELECT, named correctly: Escape (which peels the
     * keyboard itself -- `case 'cancel'` in `Canvas.tsx`), `Cmd/Ctrl+Shift+H`,
     * and `h` itself once there is no step left to walk back to. This comment
     * used to name a bare `H`; that binding is gone -- the operator moved it
     * to `Mod-Shift-h` because macOS claims `Cmd+H` for Hide -- and a bare `H`
     * now reaches no table at all.
     *
     * BEFORE the option-cursor check below, because a step whose question is
     * already answered draws no options at all: gating the step walk on a
     * focused option would strand the keyboard on that step.
     */
    if (action.kind === 'walkStep') {
      const walked = walk(action.delta);
      /**
       * A CLAMPED `h` IS NOT THIS CARD'S KEY -- and that one line is the
       * difference between the sheet telling the truth and not.
       *
       * `h` carries a second meaning the card does not own: everywhere else in
       * Insert it hands the keyboard back to Select, which is what the sheet
       * promises ("previous step of a question with several, else back to
       * Select"). Claiming the key unconditionally made the `else` unreachable
       * -- `preventDefault` fired whether or not the walk moved, the canvas
       * listener stood down at `event.defaultPrevented`, and a clamp at step 0
       * ate the keystroke in silence. A single question has only step 0, so
       * that was every ordinary question vam draws.
       *
       * `l` is NOT symmetric here, and the asymmetry is the point rather than
       * an oversight: `l` has no second meaning to fall through to, so letting
       * it pass would buy one refusal sentence on the status bar for an
       * ordinary press inside a widget the operator is reading. `Canvas.
       * cursor-mode.test.tsx` pins that silence deliberately ("a refusal on an
       * ordinary walk would be exactly the noise that teaches an operator to
       * stop reading the bar"), and nothing here disturbs it.
       */
      if (walked || action.delta > 0) event.preventDefault();
      return;
    }
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1 || buttons.length === 0) return;
    /**
     * SPACE AND ENTER BOTH SELECT THE OPTION UNDER THE CURSOR, and both are
     * handled here rather than left to the button's native activation for a
     * reason worth stating: Enter also means something in this pane. The
     * canvas grammar's `open` fires on Enter while the keyboard is in the
     * right pane and raises the composer, and the pull request numbered one
     * hundred and eleven is the record of what happens when a cursor and an
     * Enter disagree about what they are pointing at. Handling it here and
     * calling `preventDefault` gives Enter ONE meaning while the keyboard is
     * in the list — because the canvas listener stands aside for a key that
     * has already been answered.
     */
    if (action.kind === 'toggle') {
      const option = question?.options[at];
      if (option === undefined) return;
      event.preventDefault();
      toggle(option.label);
      return;
    }
    // ENTER — MARK THEN ADVANCE, never a second copy of `toggle`'s unmark.
    // `confirm` decides submit-or-walk itself; see its own comment for why
    // that decision cannot be made by reading `marks` back after the mark.
    if (action.kind === 'confirm') {
      const option = question?.options[at];
      if (option === undefined) return;
      event.preventDefault();
      confirm(option);
      return;
    }
    // `Mod-Enter` IS NOT THIS LISTENER'S — it acts on the whole card, not on
    // whichever option the cursor happens to sit on, so it is handled once,
    // on the outer `data-question` container below. Returning here (not
    // `preventDefault`) lets the same keydown keep bubbling to it, the same
    // way `walkStep` on the step strip and everything else this listener does
    // not claim already does.
    if (action.kind === 'submit') return;
    event.preventDefault();
    buttons[(at + action.delta + buttons.length) % buttons.length]?.focus();
  };

  if (question === undefined) return null;

  return (
    // `Mod-Enter` is a SHORTCUT to an act that already has a real,
    // keyboard-reachable control: the Submit `<button>` below, drawn under
    // the identical condition this listener checks (`open && pending.length
    // > 0 && onAnswer !== null`) and operable on its own by Tab plus a bare
    // Enter or Space. Nothing here is the ONLY route to the act, which is
    // what the rule exists to guarantee — this listener only makes the same
    // act reachable without first tabbing to that button (see the two
    // rulings this file already carries, above the `in` block's own
    // `onContextMenu`, for the same argument made in full).
    // biome-ignore lint/a11y/noStaticElementInteractions: see above.
    <div
      data-question
      data-question-open={open ? 'true' : undefined}
      data-question-select={question.multiSelect ? 'multi' : 'single'}
      data-question-waiting={waiting ? 'true' : undefined}
      /**
       * `Mod-Enter` SENDS FROM ANYWHERE ON THE CARD, whatever has the cursor —
       * an option, the step strip, "Chat about this", the fold's own "change"
       * button, or Submit itself (where it is a second way to press the same
       * control, and native activation already does the same thing on a bare
       * Enter). One listener rather than one per surface, because the act does
       * not depend on WHERE the keyboard is, only on whether the set can be
       * sent — `onKeys` below deliberately lets a `submit` keydown bubble past
       * it rather than claim it a second time.
       */
      onKeyDown={(event) => {
        const action = resolveQuestionKey(normalizeKey(event));
        if (action?.kind !== 'submit') return;
        if (!open || pending.length === 0 || onAnswer === null) return;
        event.preventDefault();
        trySend();
      }}
      /* `@container`: the preview panel's `@min-[720px]:flex-row` measures
         THIS element's own width, not the viewport's -- the card can be
         narrow inside a wide window (a split pane, a narrowed reading
         column), and a container query is the only rule that reads the
         rectangle it is actually drawn in. Declared here and consumed lower
         (the two-column wrapper, the listbox's width, the panel itself, the
         row's own marker) rather than on any of THOSE elements: a container
         query never applies to the element that declares the container
         (`AgentsTab`'s `data-pr-row` carries the same comment). */
      className={
        phone
          ? /* PHONE: no bordered card, no `bg-card` box -- the card IS a
               message in the transcript now (docs/design/phone-core-loop.md
               §3.3), so it takes the transcript's own turn rhythm (`gap-1.5`,
               the same gap `TurnBlock`s stack with) instead of a panel pulled
               out of it. The amber "needs you" accent moves from an
               all-around border to a LEFT-EDGE bar -- `border-l-2`, the same
               `border-waiting` token the desktop card already wears, only
               worn on one edge instead of four; nothing new, only moved. */
            [
              '@container flex flex-col gap-1.5 border-l-2 py-1 pl-2.5',
              waiting ? 'border-waiting' : 'border-line',
            ].join(' ')
          : [
              '@container flex flex-col gap-1.5 rounded-[10px] border bg-card px-2.5 py-2',
              waiting ? 'border-waiting' : 'border-line-strong',
            ].join(' ')
      }
    >
      {/* The strip, and ONLY when there is more than one question: a step
          counter over a single question is furniture that says nothing. It
          names each step by its own header where the tool gave one, marks the
          ones already settled and the ones already marked, and says where in
          the sequence the operator is -- because a card that shows one
          question at a time and does not say so is the hole this replaces
          wearing a different shape. */}
      {questions.length > 1 && (
        <nav
          // NOT a tablist, for the reason `ViewIcons` above is not one: the
          // region a step changes is the card below, which is no `tabpanel` of
          // theirs and never was. A `nav` is what this is -- navigation within
          // one call -- and a `nav` can carry the name a bare box cannot, which
          // is what legitimises the horizontal keys landing here.
          aria-label="the questions this call asked"
          data-question-steps
          // THE STRIP TAKES THE HORIZONTAL KEYS TOO, and not for symmetry: the
          // options list carries them, and a step whose question is already
          // answered HAS no options list. Without this the keyboard reaches
          // that step and cannot leave it.
          //
          // THROUGH THE SAME RESOLUTION THE LIST USES (audit F2). It read the
          // literals `h`, `l` and the two arrows, so an operator who moved the
          // horizontal motion kept a strip answering the keys they had moved
          // AWAY from and ignoring the ones they had moved to — the identical
          // defect `question-keys.ts` was written to end one element over, in
          // a second copy nobody looked at. Only `walkStep` is taken: the
          // tabs are real buttons, so Enter and Space activate them natively
          // and a `toggle` claimed here would cancel that.
          onKeyDown={(event) => {
            const action = resolveQuestionKey(normalizeKey(event));
            if (action?.kind !== 'walkStep') return;
            event.preventDefault();
            walk(action.delta);
          }}
          className="flex flex-wrap items-center gap-1 border-line border-b pb-1.5"
        >
          {questions.map((one, index) => (
            <button
              key={one.id}
              type="button"
              aria-pressed={index === showing}
              ref={index === showing ? stepTabRef : undefined}
              data-question-step
              data-current={index === showing ? 'true' : undefined}
              data-answered={one.answer === null ? undefined : 'true'}
              data-marked={(marks[one.id] ?? []).length > 0 ? 'true' : undefined}
              // The picker has taken this one in, so Submit no longer carries
              // it -- said on the step itself rather than only in the outcome
              // line, which the next Submit replaces.
              data-sent={takenIds.has(one.id) ? 'true' : undefined}
              onClick={() => setShowing(index)}
              className={[
                // `vam-tap` is how a control names itself a touch target
                // (`styles.css`); the phone floor is 44 and these were 21 tall.
                // The question surface reached a phone viewport for the first
                // time when the demo fixture gained a question at all.
                'vam-tap cursor-pointer rounded-[5px] border px-1.5 py-0.5 text-control',
                index === showing ? 'border-running text-ink' : 'border-line text-ink-faint',
              ].join(' ')}
            >
              {one.header ?? `${index + 1}`}
              {one.answer !== null || (marks[one.id] ?? []).length > 0 ? ' ✓' : ''}
            </button>
          ))}
          <span data-question-position className="ml-auto text-meta text-ink-faint">
            step {showing + 1} of {questions.length}
          </span>
        </nav>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        {question.header !== null && (
          <span data-question-header className="text-meta text-ink-faint uppercase tracking-wide">
            {question.header}
          </span>
        )}
        <span data-question-text className="text-body text-ink">
          {question.question}
        </span>
      </div>
      {question.answer !== null ? (
        // THIS step is settled while others may not be. It shows what was
        // answered and offers nothing to mark; the set's Submit below is for
        // whatever is still open.
        <span data-question-answer className="text-control text-ink-dim">
          resolved — {question.answer}
        </span>
      ) : (
        <>
          {folded ? (
            /* THE FOLD, and everything it is careful to keep. The mark
               itself, so nothing is hidden about what was chosen; the way
               back into the list; and — drawn below by the card, not here —
               `data-question-note`, the sentence saying a mark is not a
               delivery. "Marked, not sent" is repeated here rather than left
               to that note alone, because this row is what replaces the list
               and it must not be readable as a receipt. */
            <div
              data-question-collapsed
              className={`flex items-baseline gap-2 rounded-[6px] border border-running px-1.5 py-1 ${OPTION_FILL}`}
            >
              <span data-question-marked className="min-w-0 flex-1 text-control text-ink">
                {picked.join(', ')}
                {/* `ink-dim`, not `ink-faint`: this row RESTS on the fill,
                    so there is no hover state to lift its ink and
                    `OPTION_QUIET_INK` would never fire. 4.21:1 at faint,
                    5.94:1 here. */}
                <span className="text-meta text-ink-dim"> — marked, not sent</span>
              </span>
              <button
                type="button"
                data-question-expand
                onClick={() => setFoldedStep(null)}
                className="vam-tap flex-none cursor-pointer rounded-[6px] px-1.5 py-0.5 text-control text-ink-dim underline decoration-dotted hover:text-ink"
              >
                change
              </button>
            </div>
          ) : (
            /* A listbox, not a form control: nothing here is submitted, and
              `aria-multiselectable` is the one honest way to say that several
              may be marked.

              WHAT PICKING AN OPTION WOULD PRODUCE never prints IN this row any
              more -- a diagram this size is`GET /events\nkeeps ONE socket
              open\nfor the life of the run`-shaped, and a multi-line preview
              `truncate`d to one line inside the row is the break the operator
              reported ("when the graph goes with the option, the display
              breaks"). The row carries only a quiet marker now
              (`data-question-preview-hint`, right of the label so it costs the
              row no height); the full text is `activeOption`'s, drawn once
              below rather than once per option. */
            <div
              className={
                hasPreview
                  ? [
                      'flex flex-col gap-1.5',
                      sideBySide
                        ? '@min-[720px]:flex-row @min-[720px]:items-start @min-[720px]:gap-3'
                        : '',
                    ].join(' ')
                  : undefined
              }
            >
              <div
                role="listbox"
                aria-multiselectable={question.multiSelect}
                aria-label="the options this question offers"
                onKeyDown={onKeys}
                className={
                  sideBySide
                    ? 'flex flex-col gap-1 @min-[720px]:w-[40%] @min-[720px]:min-w-[240px] @min-[720px]:flex-none'
                    : 'flex flex-col gap-1'
                }
              >
                {question.options.map((option, index) => {
                  // DEVIATION, approved (docs/design/phone-core-loop.md
                  // §3.3, §3.7 PR4) -- see `isPersistentPermissionOption`'s
                  // own doc for the table and the argument. `phone` only:
                  // desktop draws this row exactly as it always has.
                  const risky = phone && isPersistentPermissionOption(option.label);
                  const armed = risky && armedLabel === option.label;
                  return (
                    <button
                      key={option.label}
                      ref={index === 0 ? firstOptionRef : undefined}
                      type="button"
                      role="option"
                      aria-selected={picked.includes(option.label)}
                      data-question-option
                      data-question-number={NUMBERED_OPTIONS[index]}
                      data-picked={picked.includes(option.label) ? 'true' : undefined}
                      data-question-risk={risky ? 'true' : undefined}
                      data-question-armed={armed ? 'true' : undefined}
                      onClick={(event) => toggle(option.label, event.detail > 0)}
                      onFocus={() => setFocusedLabel(option.label)}
                      className={[
                        // `group` is what lets the quiet spans below hear about a
                        // hover on this button -- see `OPTION_QUIET_INK`.
                        'group vam-tap flex cursor-pointer flex-col items-start gap-0.5 rounded-[6px] border px-1.5 py-1 text-left',
                        OPTION_FOCUS_RING,
                        picked.includes(option.label)
                          ? `border-running ${OPTION_FILL}`
                          : armed
                            ? 'border-waiting'
                            : `border-line hover:${OPTION_FILL}`,
                      ].join(' ')}
                    >
                      <span className="flex max-w-full items-baseline gap-1.5 text-control text-ink">
                        {/* THE PICKED MARK -- a lucide `Check`, not a second
                            colour: the border and fill above already say
                            "chosen"; this is what says it to someone who
                            cannot use either (a screen reader gets it for
                            free off `aria-selected`, but a sighted operator
                            scanning a list of similarly-bordered rows gets
                            an icon, not a hue to eyeball). `aria-hidden`
                            because `aria-selected` already carries the fact
                            on the row itself -- a second announcement would
                            repeat it. */}
                        {picked.includes(option.label) && (
                          <Check
                            aria-hidden="true"
                            data-question-picked-mark
                            size={13}
                            strokeWidth={2.5}
                            className="flex-none text-running"
                          />
                        )}
                        {NUMBERED_OPTIONS[index] !== undefined && (
                          <span className={`text-meta tabular-nums ${OPTION_QUIET_INK}`}>
                            {NUMBERED_OPTIONS[index]}
                          </span>
                        )}
                        <span data-question-label className="min-w-0">
                          {option.label}
                        </span>
                        {(option.preview ?? null) !== null && (
                          <span
                            data-question-preview-hint
                            className={`ml-auto flex-none text-meta ${OPTION_QUIET_INK}`}
                          >
                            {sideBySide ? (
                              <>
                                <span className="hidden @min-[720px]:inline">preview →</span>
                                <span className="@min-[720px]:hidden">preview ↓</span>
                              </>
                            ) : (
                              'preview ↓'
                            )}
                          </span>
                        )}
                      </span>
                      {/* THE MARKER: a thin `text-waiting` suffix, never a
                          dialog -- see the deviation's own argument for why a
                          second modal defeats the fast-reply brief this whole
                          spec serves. Two words while at rest, so the risk is
                          visible before the first tap; the SECOND tap's own
                          words while armed, so the row itself explains what
                          it is waiting for rather than leaving the operator
                          to guess why nothing happened. */}
                      {risky && (
                        <span data-question-risk-note className="text-meta text-waiting">
                          {armed ? 'tap again to confirm' : "won't ask again this session"}
                        </span>
                      )}
                      {option.description !== null && (
                        // UNDER THE LABEL, NOT UNDER THE NUMBER. MEASURED on
                        // Claude Code 2.1.280: "fixed multi-select option
                        // descriptions being indented under the option number
                        // instead of under the label". A row with no indent at
                        // all starts flush with the NUMBER above it, which is
                        // the shape the fix ended -- so a spacer reserves the
                        // number's own column, tabular-nums and the same
                        // `gap-1.5` as the row it lines up with, rather than a
                        // guessed pixel amount. `aria-hidden` and no text of its
                        // own: it costs nothing in the accessible name or in a
                        // reader that walks `textContent`, only the width.
                        <span className="flex max-w-full items-baseline gap-1.5">
                          {NUMBERED_OPTIONS[index] !== undefined && (
                            <span
                              aria-hidden="true"
                              className="inline-block w-[1ch] flex-none text-meta tabular-nums"
                            />
                          )}
                          <span
                            data-question-description
                            className="min-w-0 text-meta text-ink-dim"
                          >
                            {option.description}
                          </span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {/* THE PANEL: the FULL preview of `activeOption` -- focused,
                  else marked, else the first option that has one -- never the
                  truncated fragment the row used to carry. `whitespace-pre`
                  for real pre semantics (`white-space: pre`, so the diagram's
                  own spacing survives) -- a literal `<pre>` was the first
                  cut, but its implicit ARIA role is `generic`, which
                  (correctly) accepts no accessible name at all, so
                  `aria-label` cannot sit on one. `<section>` gains the role
                  `region` the moment it HAS a name, which is exactly this
                  case. The surface is the transcript's own fenced code block
                  (`Fenced`, `out-markdown.tsx`'s `pre` rule), reused rather
                  than restyled. No `aria-live`: it changes on every walk,
                  which is exactly the chatter a live region should not
                  announce -- `aria-label` names WHICH option it is showing
                  instead, which is what actually needs to be read once the
                  operator asks for it. */}
              {hasPreview && activeOption !== undefined && (
                <section
                  data-question-preview-panel
                  data-for={question.options.indexOf(activeOption)}
                  aria-label={`preview of ${activeOption.label}`}
                  className={[
                    'vam-no-scrollbar min-w-0 max-h-[40vh] overflow-auto whitespace-pre rounded-[7px] border border-line bg-ground px-2.5 py-2 font-mono text-[0.917em] text-ink-dim leading-[1.55]',
                    sideBySide ? '@min-[720px]:flex-1' : '',
                  ].join(' ')}
                >
                  {(activeOption.preview ?? null) !== null ? (
                    activeOption.preview
                  ) : (
                    <span data-question-preview-empty className={OPTION_QUIET_INK}>
                      no preview for this option
                    </span>
                  )}
                </section>
              )}
            </div>
          )}
          {/* Not in the transcript: `AskUserQuestion`'s tool_use records the
              model's own options and nothing else, and the free-text row is
              the CLI's own UI. So vam appends it and SAYS it appended it —
              outside the listbox, because it is neither something the agent
              offered nor something a mark applies to. */}
          <button
            type="button"
            data-question-chat
            data-question-synthetic="true"
            onClick={onChat}
            className={`group vam-tap flex cursor-pointer items-baseline gap-1.5 rounded-[6px] border border-line border-dashed px-1.5 py-1 text-left hover:${OPTION_FILL}`}
          >
            {/* THE HINT COMES OFF THE SAME TABLE THE HANDLER READS, and is
              not printed at all when the key is not held -- a caption naming a
              key that does nothing is the defect, not the absence of one.
              `data-inline-chord` PUTS IT IN THE FAMILY, and that is the rest of
              the same rule. `styles.css` suppresses the chord hints on a phone,
              and this hook was not one of them -- so the single card a phone
              operator has to use went on printing `c` at 6x16, on a screen with
              no `c` to press, through every release of that rule. Suppressed,
              never deleted: the key still fires under a folio keyboard at
              390px. `data-question-chat-key` stays beside it because it names
              WHICH hint this is, which the family hook cannot. */}
            {keys.chat[0] !== undefined && (
              <span
                data-question-chat-key
                data-inline-chord
                className={`text-meta tabular-nums ${OPTION_QUIET_INK}`}
              >
                {keys.chat[0]}
              </span>
            )}
            <span className="min-w-0 text-control text-ink">Chat about this</span>
            <span className={`min-w-0 text-meta ${OPTION_QUIET_INK}`}>
              — vam adds this one; it opens the box below
            </span>
          </button>
        </>
      )}
      {/* SUBMIT BELONGS TO THE SET, not to the step. The agent is waiting on
          the call, not on its first question, and a control inside a step
          would read as though that step could be sent on its own -- so it sits
          below all of them, and it waits until every OPEN step carries a mark.
          An already-answered step is not one of those. */}
      {open && pending.length > 0 && onAnswer !== null && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-question-submit
            /* `sending` ONLY. It used to read `unmarked.length > 0 ||
               sending`, which took the click, the focus and the explanation
               away together -- see `refusal`. The in-flight half stays: a
               second Submit while the first is out would type into a picker
               that is already moving. */
            disabled={sending}
            /* What the control is short of, as a fact rather than as a
               colour, for anything that has to check the state without
               reading a sentence. */
            data-question-short={unmarked.length > 0 ? 'true' : undefined}
            onClick={trySend}
            className={[
              'flex items-center gap-1.5 rounded-[6px] border px-1.5 py-1 text-control',
              sending
                ? 'cursor-default border-line text-ink-faint'
                : `cursor-pointer border-running text-ink hover:${OPTION_FILL}`,
            ].join(' ')}
          >
            {sending ? (
              'Submitting…'
            ) : (
              <>
                {/* THE CHORD THAT SENDS, drawn the way every other one on
                    this card is (`ChordGlyphs`, the Send-key option's own
                    flat rendering) and read off the SAME preference the
                    composer itself sends on (`prefs/submit-key.ts`) -- a
                    card that said "Enter submits" while the operator had
                    chosen Shift-Enter would be naming a key that does
                    nothing, the exact defect `InlineChord`'s own doc argues
                    against for a withdrawn chord. `aria-hidden`: the chip is
                    a repeat of what native activation already promises a
                    focused button, not new information a reader lacks. */}
                <span
                  data-question-submit-key
                  aria-hidden="true"
                  className="rounded-[4px] border border-line-strong px-1 py-px font-mono text-ink-dim text-meta"
                >
                  <ChordGlyphs chord={submitKey === 'shift-enter' ? 'Shift-Enter' : 'Enter'} />
                </span>
                Submit
              </>
            )}
          </button>
          {/* WHAT IS STILL MISSING, and now for one question as well as for
              several. This was `questions.length > 1`, so the commonest call
              there is -- a single question -- had a faint Submit above a
              sentence about marking and nothing saying the mark was what it
              was waiting for. Silent once the set is complete: the chord chip
              on Submit itself says what used to be said here ("Enter
              submits"), and a control that already carries its own key need
              not be repeated beside it. */}
          <span data-question-progress className="text-meta text-ink-faint">
            {pending.length > 1
              ? unmarked.length > 0
                ? `${pending.length - unmarked.length} of ${pending.length} marked`
                : null
              : unmarked.length > 0
                ? 'not marked yet — pick an option above'
                : null}
          </span>
        </div>
      )}
      {refusal !== null && (
        /* `waiting` amber, the same ink the mode row's refusal takes: this is
           a control declining to act, not a report from the session. The two
           are separate elements for the same reason they are separate state
           -- an operator must be able to tell "vam did not send this" from
           "the picker said no". */
        <p data-question-refusal className="text-control text-waiting">
          {refusal}
        </p>
      )}
      {outcome !== null && (
        <p data-question-outcome data-outcome={outcome.kind} className="text-control text-ink-dim">
          {outcomeWording(outcome)}
        </p>
      )}
      {/* `onAnswer === null` ONLY. The other half of this sentence --
          "a pick is only a mark until you press Submit…" -- is gone: Submit
          now carries its own chord chip and a picked option carries its own
          Check, which is what that sentence used to have to say in words.
          `data-question-note` stays undrawn rather than emptied for the
          delivering case: `WaitingNote`'s own suppression test
          (`newestQuestion === null || !openQuestion`, above) never reads this
          attribute, so nothing downstream depends on the node existing with
          nothing in it. */}
      {open && onAnswer === null && (
        <p data-question-note className="text-control text-ink-faint">
          {/* Still exactly true where there is no delivery: nothing here can
              reach the tool call, and a control that implied otherwise would
              be the lie this sentence was written against.

              IT USED TO END "type your choice in the box below", AND THERE
              IS NO BOX BELOW. `composerHidden` withdraws the composer for an
              unanswered question -- on the desktop as well as the phone, so
              this was never a phone bug -- and measured at 390x844 the card
              sat over `[data-composer-bar]` count 0 and `textarea` count 0.
              Picking an option does not draw one either. The one route from
              a card to a box is the card's own last row, so the sentence
              names THAT -- a control drawn just above it, which already says
              "it opens the box below" in its own caption. Drawing the
              composer instead was the other candidate and was measured and
              refused: it costs 140px on the one screen this whole change is
              about, and it would put two surfaces under one prompt. */}
          vam cannot answer this for you — a pick is only a mark, and nothing goes back to the
          session; tap Chat about this to open the box and type your choice.
        </p>
      )}
    </div>
  );
}

/**
 * The mark for one turn, and the only place these glyphs are chosen -- the
 * `<select>`, the expanded list and the turn's own line in the column would
 * otherwise draw the same conditional three times, which is how they come to
 * disagree about what a turn is.
 *
 * FAILURE OUTRANKS PROGRESS. `◌` says "not finished" and `✓` says "finished",
 * and both are true of a turn whose tools blew up -- which is exactly how the
 * fold came to cost the operator the alarm while keeping the detail. `!` means
 * SOMETHING INSIDE THIS TURN FAILED, which is a narrower claim than "this turn
 * failed": the count beside the line says how many, and the turn may well have
 * recovered. It is still the thing worth seeing from a collapsed row.
 */
function turnMark(d: Decision): string {
  return (d.errorCount ?? 0) > 0 ? '!' : d.output === null ? '◌' : '✓';
}

/**
 * HOW MANY OF A TURN'S CALLS THE COLUMN DRAWS, and the number is measured
 * rather than chosen.
 *
 * Over the 77 real session transcripts on this machine: a turn that fits
 * inside one 128 KiB window -- which is every turn a live poll reads, because
 * that window IS the poll -- made a median of 3 calls, a p90 of 8, and at most
 * 20, across 387 such turns. So at 20 nothing a running session shows is ever
 * cut, and this is not a fold on the working the operator just asked to see.
 *
 * IT EXISTS FOR THE OTHER HALF OF THAT CORPUS. A turn whose bytes SPAN the
 * window -- the case `history.ts` widens the read for, up to 4 MiB, so that a
 * scrolled-back page carries whole turns -- ran to a median of 30 calls and a
 * largest of 2,144 (785 turns). Two thousand rows under one prompt is that
 * turn's answer pushed off the screen by its own working, on a column the
 * operator is scrolling through history in.
 *
 * AND WHAT IS CUT IS SAID, IN A NUMBER VAM HELD. `steps` is already a list of
 * what was READ; a cap that would not name its own remainder would be the
 * second, silent fold on a surface built to refuse exactly that.
 */
const MAX_STEP_ROWS = 20;

/**
 * ONE CALL, AS A ROW. The mark is a glyph and a colour, and a failure may
 * depend on neither: the word rides in `sr-only` beside it, because the count
 * on the line above says something failed and only this says which one.
 */
function StepRow({ step }: { readonly step: TurnStep }) {
  return (
    <li
      data-progress-step={step.id}
      data-progress-step-failed={step.failed ? 'true' : undefined}
      className="flex min-w-0 items-center gap-1.5"
    >
      <span aria-hidden="true" className={step.failed ? 'text-failed' : undefined}>
        {step.failed ? '!' : '·'}
      </span>
      {step.failed && <span className="sr-only">{t('steps.failed')}</span>}
      <span data-progress-step-label className="min-w-0 truncate">
        {step.label}
      </span>
    </li>
  );
}

/**
 * ONE TURN OF THE TRANSCRIPT, as a block of the column.
 *
 * The pane used to draw exactly one of these -- whichever turn `selectedId`
 * pointed at -- while `entry.session.decisions` already carried up to
 * `MAX_DECISIONS` (3,276) of them, newest first. The operator asked for the
 * whole session, scrolled, with the prompt pinned: "show the WHOLE session,
 * load more when scrolling up, and the sticky In should follow wherever you
 * scroll." So the column maps every turn through this, oldest at the top.
 *
 * ITS OWN BOX, AND THAT IS THE MECHANISM, NOT A TIDINESS. `position: sticky`
 * is bounded by the sticky element's CONTAINING BLOCK: with every `in` a flat
 * sibling of the column, each one would pin at `top: 0` for the rest of the
 * scroll and pile up behind the next -- and a shorter prompt arriving on top
 * of a taller one leaves the taller one's tail sticking out below it. Wrapped,
 * each `in` is released exactly when its own turn scrolls past, which is what
 * "the In of the turn you are inside" means and what the operator's "follows
 * wherever you scroll" asked for. The cost of the wrapper is paid at
 * `--vam-turn-cap` -- see the `max-h` below.
 *
 * MEMOISED, because at 3,276 turns this is the difference between a keystroke
 * in the composer costing one render and costing 3,276 of them. Every prop is
 * a primitive or the turn object itself, which `transcript.ts` rebuilds only
 * when its content actually changes (ids are content-derived), so the default
 * shallow compare is the right one.
 */
const TurnBlock = memo(function TurnBlock({
  decision,
  marked,
  newest,
  live,
  activity,
  waitingCause,
  age,
  status,
  reserveCorner,
  focusView,
  unfolded,
  onUnfold,
  onPromptMenu,
  onAnswerMenu,
}: {
  readonly decision: Decision;
  /** Is this the turn the picker (or the canvas) has landed on? */
  readonly marked: boolean;
  /** Is this the newest turn vam read -- the only one "right now" is about? */
  readonly newest: boolean;
  /** Is the session still working on THIS turn? `newest` and `running`. */
  readonly live: boolean;
  readonly activity: string | null;
  readonly waitingCause: string | null;
  readonly age: string | null;
  readonly status: SessionStatus | null;
  /**
   * HOW MUCH OF THIS BUBBLE'S FIRST LINE THE VIEW PILL SITS OVER, in px --
   * 0 when no pill is drawn. The pane's own `cornerOverhang`, which is the
   * pill's width less the distance this bubble's right edge already sits
   * inside the pane's; see its comment. Not the pill's full width: reserving
   * that costs ~60px of the first line for a gap nothing is painted in, and
   * `e2e/narrow-pane-overlay-shots.mjs` fails on THAT as well as on covering
   * the text -- a reservation is wrong in both directions.
   */
  readonly reserveCorner: number;
  /** Focus view, as the operator set it -- see `prefs/progress.ts`. */
  readonly focusView: boolean;
  /** Has the operator pressed this turn's way back? */
  readonly unfolded: boolean;
  /** Ask for this turn's working. Given the turn's id, never a closure per
   *  turn: the column can hold hundreds of these. */
  readonly onUnfold: (id: string) => void;
  /** Right-click on this turn's In bubble. Given the turn's id and the
   *  pointer, on the same rule as `onUnfold`: one stable callback for a column
   *  that can hold 3,276 of these, not a closure per turn. */
  readonly onPromptMenu: (id: string, at: { readonly x: number; readonly y: number }) => void;
  /** The same, for its answer. */
  readonly onAnswerMenu: (id: string, at: { readonly x: number; readonly y: number }) => void;
}) {
  const failed = decision.errorCount ?? 0;
  const ageNote = promptAgeNote(decision);
  /**
   * DOES THIS TURN SPEND A ROW ON ITS OWN WORKING?
   *
   * The rule is `drawsProgressLine`, in `prefs/progress.ts`, and it is there
   * rather than inline for one reason: it is the thing that must never fold a
   * failure away, and a conditional written here would be a second opinion
   * about that -- which is how the two come to disagree. Everything it needs
   * is on this block already, so nothing is computed for it.
   */
  const turnFacts = {
    errorCount: decision.errorCount,
    newest,
    activity,
    waitingCause,
    unfolded,
  };
  const showProgress = drawsProgressLine(focusView, turnFacts);
  /**
   * AND THE WAY BACK, FROM THE SAME PAIR OF PREDICATES. Not `!showProgress`:
   * that would draw one on every turn while focus view is off, where nothing
   * is folded and there is nothing to restore. `drawsUnfoldControl` is the
   * complement of the line WITHIN focus view, written once so the two cannot
   * drift into a turn that has neither.
   */
  const showUnfold = drawsUnfoldControl(focusView, turnFacts);
  /**
   * AND THE WORKING ITSELF -- the calls the turn made, which is the thing
   * "hide tool calls" was always about. Same file, same reason: three
   * predicates written in one place, where the invariant that binds them (a
   * step is never drawn where the line is not) can be swept.
   *
   * CAPPED HERE AND NOT AT THE SOURCE. `steps` is a list of what vam READ, and
   * the reader's budget is the window, exactly as it is for `MAX_DECISIONS`;
   * how many rows a COLUMN can spend is a different question with a different
   * answer, and `dropped` below is what makes the cap say its own size.
   */
  const steps = decision.steps ?? [];
  const showSteps = drawsTurnSteps(focusView, turnFacts) && steps.length > 0;
  const dropped = Math.max(0, steps.length - MAX_STEP_ROWS);
  return (
    <article
      data-column-turn={decision.id}
      /* MARKED, NOT SHOWN ALONE. `selectedId` used to decide which turn was
         drawn at all; in a column that is the wrong verb -- the others do not
         go away, the column scrolls to this one and says which one it is. */
      data-turn-current={marked ? 'true' : undefined}
      data-turn-newest={newest ? 'true' : undefined}
      /* `relative` is what makes this the sticky block's containing block --
         see the note above. `gap` matches the column's own so a turn's three
         parts sit at the same rhythm as the turns do. */
      className="relative flex flex-none flex-col gap-1.5"
    >
      {/* STICKY, not merely first: `position: sticky` against the column's own
          scroll (the operator's ask -- "the sticky In should follow wherever
          you scroll"), with an opaque background -- the pane's own, see the
          fill note below -- so the answer scrolling underneath does not bleed
          through the prompt.

          BOUNDED, because an unbounded sticky block is not a pin, it is a lid
          (audit F2, measured: a 3,822-character prompt left the answer 19px
          and a 10,920-character one covered `progress` and `out` AT MAXIMUM
          SCROLL). What is capped is what STICKS: the paragraph keeps its full
          length and gets its own scroll inside the bubble, so nothing typed is
          truncated. That is VSCode's sticky-scroll bargain.

          `45cqh` RATHER THAN `45%`, AND THAT IS THE WRAPPER'S BILL. A
          percentage max-height resolves against the CONTAINING BLOCK: the
          column has a definite height (`flex-1` down a `min-h-0` chain), the
          `<article>` above does not, so the very same `45%` that bounded the
          pin while one turn was drawn resolves to `none` inside a wrapper --
          audit F2 back, with not one class changed to notice it by. A
          container query unit resolves against the nearest SIZE CONTAINER
          instead, which the column declares (`container-type: size` in its own
          class list), so the cap is 45% of the column however deep in the tree
          the block sits. Measured on this head: column 400px, resolved
          `max-height: 180px`, both turns, wrapper and all. And measured in CI
          as RESOLVED PIXELS by `e2e/transcript-column-shots.mjs` -- a cap that
          quietly became `none` (or stayed the unresolvable `45%`, which
          `getComputedStyle` cheerfully reports back verbatim) is exactly the
          shape of bug a class-name assertion cannot see. */}
      {/* FULL-BLEED TO BOTH PANE EDGES, which is two different numbers since
          the column reserved its right-hand strip for the floating jumps:
          `-ml-3.5` gives back the column's left padding, `-mr-11` gives back
          that strip, and each side's padding puts the content back. The FILL
          has to reach both edges or the transcript shows through beside the
          pinned prompt; the CONTENT must not reach the right one, or the
          bubble would run under a jump.

          `bg-pane`, NOT `bg-ground`. This band is what the operator reported
          as "black background areas ... the In block": `ground` is the darkest
          value in the palette and the pane it bands is two steps up it, so a
          strip that exists purely to stop the transcript bleeding through was
          painting itself darker than the surface it sits in. The
          band's job is to be invisible and the BUBBLE is the thing meant to be
          seen; opacity is what it needs, not depth. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the rule is RIGHT
          about this one and the answer is still a suppression, so the reason
          is written out. A transcript block has no focusable child, so the
          Menu key -- which fires `contextmenu` on the FOCUSED element -- cannot
          open this menu, and unlike the session row and the tab there is no
          button here to move the handler onto. Making one would mean a tab
          stop per turn, and the column draws up to 3,276 of them.
          WHAT MAKES IT SOUND: neither ACT is pointer-only. Copy is `yy` and
          cancel is Escape in the composer, both bound, both in the key sheet.
          This menu is a shortcut to acts the keyboard already has -- which is
          what the rule exists to guarantee -- rather than the only route to
          them. If an act is ever added here that has no chord, this comment
          stops being true and the suppression has to go. */}
      <section
        data-detail-block="in"
        /* THE BAND, not just the bubble: the operator aiming at a prompt aims
           at the block it sits in, and the tinted bubble is inset from it.
           `preventDefault` is what stops Electron opening the SHELL's menu --
           Reload, Inspect Element -- over a transcript. */
        onContextMenu={(event) => {
          event.preventDefault();
          onPromptMenu(decision.id, { x: event.clientX, y: event.clientY });
        }}
        className="-ml-3.5 -mr-11 sticky top-0 z-10 flex max-h-[45cqh] min-h-0 flex-none flex-col gap-1 bg-pane pt-1.5 pr-11 pb-1.5 pl-3.5"
      >
        {/* The region's name, announced and not drawn. */}
        <span className="sr-only">in</span>
        {/* HOW OLD THE PIN IS -- see `promptAgeNote`. Above the bubble rather
            than inside it: the bubble is the operator's own words and nothing
            vam writes belongs in there. `text-ink-dim` and `text-meta`, the
            same dim the branch and the age already use, because a long turn is
            ORDINARY and an error colour would be a claim of its own. */}
        {ageNote !== null && (
          <span data-prompt-age className="flex-none font-mono text-ink-dim text-meta">
            {ageNote}
          </span>
        )}
        {/* THE BUBBLE (operator: "the IN prompt should have a different colour
            so it stands out, and sit in a bubble"). A tinted, rounded ground
            INSIDE the one continuous column, not the bordered band PR 266
            deleted. It is also the element the `max-h` above bounds against:
            `overflow-y-auto` here is what keeps a 10,000-character prompt
            whole while the block it sticks in stays capped. */}
        <div
          data-detail-scroll="in"
          /* The scrollbar is NOT hidden here, unlike the column's. It is the
             only thing on screen saying the prompt continues past the
             bubble's bottom edge, and a bound nobody can see is how "the
             answer is unreachable" became "the prompt is". */
          /* PADDING IS WHAT MAKES THE TINT A SHAPE, and it is bounded on BOTH
             sides -- 10x8, held to a 7-12px band measured AS PAINT by
             `e2e/long-prompt-shots.mjs`, because a padding rule that matches
             nothing has passed review in this project before. */
          /* `bg-in-bubble`, NOT `bg-raised`. The operator has asked about this
             bubble four times: once for it to exist, then -- having got it --
             "the In bubble needs more contrast within the pane", then "lean
             it towards grey", and now, having seen the teal on screen again:
             "drop it for a plain grey that contrasts with the panel
             background". `raised` on a `pane` band measures 1.030:1 in dark
             and 1.015:1 in light, three units per channel, which is under the
             step at which a person reliably sees an edge: the bubble was in
             the DOM and not on the screen.

             "THE PANEL BACKGROUND" IS THIS ELEMENT'S OWN GROUND, `bg-pane`
             (the `data-detail-block="in"` band two levels up), NOT
             `--vam-panel` -- a separate, lower token. Named here because the
             two are easy to conflate and only one of them is what this
             bubble is actually drawn on.

             THE FILL IS NOW A STRAIGHT GREY IN DARK -- `--vam-in-bubble`'s
             own value is in `styles.css`, not restated here: `a*`/`b*`
             zeroed, `L*` carried across unchanged, so the
             ratio against the pane holds where it read as a teal -- 1.499:1,
             over the palette's 1.4 floor -- and ΔE now reads 11.41 off pure
             lightness, over the 6.24 floor and over four times `--vam-raised`'s
             own step off the pane, both measured as paint by
             `e2e/pane-colour-shots.mjs` and as tokens by
             `test/renderer/surface-elevation.test.ts`. Light is not part of
             this ask and keeps its own cool-leaning fill.

             THE INK BELOW IS PART OF THE CHOICE, AND IT MOVED TOO -- the
             operator's separate ask for a lighter prompt. `text-ink`, not
             `text-ink-dim`: 6.887:1 on the dark fill, up from 4.782; 17.17:1
             in light. `text-ink-faint` still reads under floor on the dark
             fill (3.718:1) and must not be used here. The guard measures the
             ink this element is really painted with, so that constraint is
             enforced rather than noted. */
          className="min-h-0 min-w-0 overflow-y-auto rounded-[10px] bg-in-bubble px-2.5 py-2"
        >
          <p className="whitespace-pre-wrap break-words text-body text-ink">
            {/* THE RESERVED CORNER, audit F1's obligation. A float rather than
                padding because only the FIRST LINE meets the pill: padding
                would indent all 300 lines of a long prompt to clear something
                34px tall. The bound is measured by
                `e2e/narrow-pane-overlay-shots.mjs`, which fails both if the
                reservation misses the pill and if it runs far past it --
                over-reserving takes the prompt's opening words out for
                nothing, which is what the deleted identity line's 7rem did.

                66px, DOWN FROM 6rem, AND NOT A TASTE. Measured at five widths,
                the pill's left edge is 46px past this bubble's content edge
                now that the column reserves a 44px strip on the right for the
                floating jumps (see `data-detail-column`) and the bubble ends
                10px inside it. 66 covers those 46 with the same 20px of slack
                the 96 carried before the strip existed; leaving it at 96 would
                have reserved 50px of first line for something already clear,
                and the guard above would have said so.

                ON EVERY TURN, not only on the pinned one. The pill floats over
                the top-right corner of the COLUMN, so whichever turn's prompt
                is pinned there is the one it covers -- and which turn that is
                changes with every scroll event. Reserving only for the pinned
                one would mean rewriting the DOM as you scroll and reflowing a
                paragraph under the reader's eye each time a new turn takes the
                pin; reserving on all of them costs a shorter first line in the
                turns that are not pinned and cannot be wrong at any scroll
                offset. Only when the overlay is actually drawn -- an unfocused
                pane paints no pill. */}
            {reserveCorner > 0 && (
              <span
                data-detail-corner-reserve
                aria-hidden="true"
                className="float-right h-[22px]"
                /* EXACTLY THE PART OF THE PILL THAT OVERHANGS THIS BUBBLE --
                   measured, both edges, every time either can have moved.
                   The `66px` this replaces was fitted to a THREE-icon pill
                   (90px) and survived only because this bubble's right edge
                   already sat ~44px inside the pane's, leaving 46px to
                   cover. A source with a terminal draws four icons and one
                   with the file bridge draws five (146px): ~102px to cover,
                   and the first line of the pinned prompt -- the most-read
                   text in the app -- would have run under the difference.
                   Reserving the pill's whole width instead is the OTHER
                   failure the guard names: 60px of a narrow pane's first
                   line spent on a gap nothing was ever painted in. Only the
                   overhang is right, and only measurement knows it. */
                style={{ width: reserveCorner }}
              />
            )}
            {decision.input}
          </p>
        </div>
      </section>

      {/* THE TURN'S OWN CONDENSED LINE. It used to be the session's -- one
          line for the whole pane, carrying the turn count and the picker,
          because only one turn was ever on screen. In a column those are facts
          about the COLUMN and have moved to its two ends (the boundary block
          at the top, the navigation bar at the bottom); what is left here is
          what is true of THIS turn: which turn it is, and whether anything
          inside it failed.

          AND WHETHER IT IS DRAWN AT ALL IS THE OPERATOR'S, since they asked
          for concise mode to be adjustable. ABSENT, NOT DIMMED, and the whole
          `<section>` goes rather than the line inside it: the region carries
          the announced name `progress`, and a wrapper left behind would have a
          screen reader open a region containing nothing. `display: none` in a
          stylesheet would have left exactly that wrapper, which is the second
          reason this is a React condition and not CSS -- the first being that
          a hidden element is still an element, and a guard that reads the DOM
          could not tell the two modes apart at all. */}
      {/* THE WAY BACK, WHERE THE WORKING WAS.

          "Folded activity stays one click away" -- and the setting this
          replaces had no such clause, which is why it was a deletion with a
          preference in front of it rather than a fold. So a folded turn is
          never left with nothing: it draws this instead, in the same place,
          and pressing it puts that turn's line back.

          A BUTTON, NAMED IN WORDS. A control that cannot be found is the same
          defect as one that cannot act, so this is not a hover affordance and
          not a bare glyph: it takes a tab stop and its accessible name says
          what pressing it produces. The drawn part is deliberately almost
          nothing -- an ellipsis at the progress line's own size and ink -- so
          that folding still BUYS the operator the quiet page they asked for.
          A chip as loud as the line it replaced would be the setting doing
          nothing at all.

          ONE TURN, NOT THE COLUMN. The name says "this turn" because there is
          one per turn and they are otherwise identical, and because a control
          that unfolded everything would be a second copy of the setting
          reached from a place that promised something smaller. */}
      {showUnfold && (
        <button
          type="button"
          data-turn-unfold={decision.id}
          onClick={() => onUnfold(decision.id)}
          aria-label={`show this turn's working — ${decision.label}`}
          /* IN FLOW, WHERE THE WORKING WAS -- and that is a reversal, so the
             history is kept. The first cut put this OUT of flow, absolutely
             positioned in the article's top-right corner, so that it cost no
             height: vam then folded ONE line per turn, and a way back that
             took a row of its own gave the row straight back
             (`e2e/transcript-column-shots.mjs` caught exactly that:
             "collapsed 959px vs shown 959px"). The operator's report on that
             corner: "the three-dot mark for expanding progress steps is out
             of place." Measured: a 24px box at x 1032..1056 with its top 4px
             ABOVE its own article -- over the sticky prompt bubble, which a
             reader takes for the PREVIOUS turn's corner, and nowhere near the
             rows the fold removed.

             SO IT STANDS EXACTLY WHERE THE PROGRESS REGION STANDS when it is
             back: between the prompt block and the answer, flush with the
             answer's left edge. An ellipsis means "something is elided HERE";
             drawn there, the click replaces the mark with the working in
             place rather than inserting rows somewhere else on the page.
             Document order was already this (the button precedes the region,
             `test/panels/DetailPanel.turn-progress.test.tsx` pins it); only
             the paint disagreed.

             AND IT STILL BUYS THE FOLD ITS HEIGHT. The 24px box wears
             `-my-1.5`, which absorbs the column's 6px gap on each side: the
             box runs from the prompt block's bottom to the answer's top and
             costs 24px where the region it stands in for costs 28 -- a 16px
             line and its 6px gap on either side -- plus every step row on
             top of that. Measured: a stepless turn is 98.8px open and 94.8px
             folded, so it still folds shorter, by 4px; a turn with twenty
             calls folds a screen shorter. `e2e/transcript-column-shots.mjs` keeps
             `collapsed < shown`, and `e2e/turn-steps-shots.mjs` measures the
             rectangle: below its own prompt, above its own answer, at the
             answer's left, 24 square, ink at 3:1 or better.

             A REAL 24x24 BOX RATHER THAN `vam-hit-24`: that utility grows the
             hit area with a pseudo-element, and in flow the box can simply
             BE the element, the drawn mark small inside it.

             `ink-quiet`, not `ink-ghost` -- issue 201 ruled `ghost` out of
             anything that has to be READ, and on a folded turn this is the
             only thing there is to read. Measured at 7.25:1 on the pane, the
             same ink the step rows wear; the corner, not the ink, was what
             made it hard to find. */
          /* `vam-tap` grows this to the phone's 44 (`styles.css`), which is a
             floor 24 does not meet -- five of these draw on one folded
             screen, and this is the ONLY route back to a folded turn's
             working. In flow, the same `-my-1.5` makes that 32px net. */
          className={`vam-tap -my-1.5 flex h-6 w-6 flex-none cursor-pointer items-center justify-center self-start rounded font-mono text-ink-quiet text-meta leading-none hover:text-ink ${FOCUS_RING}`}
        >
          {/* The phone's other half: hit 44, PAINT 30, the pattern the view
              icons and the keystroke strip already use. On the desktop this
              span is unstyled and the box stays 24. */}
          <span data-tap-skin aria-hidden="true">
            ···
          </span>
        </button>
      )}
      {showProgress && (
        <section data-detail-block="progress" className="flex flex-none flex-col gap-1">
          {/* Announced, not drawn. */}
          <span className="sr-only">progress</span>
          <div
            data-progress-line
            className="flex items-center gap-1.5 font-mono text-meta text-ink-faint"
          >
            <span data-progress-turn-label className="flex min-w-0 items-center gap-1 truncate">
              {/* Answered, still open, or carrying a failure -- the same marks
                the picker draws, from the same function. Decorative, so
                hidden: the label is what a screen reader should read. */}
              <span aria-hidden="true" className={failed > 0 ? 'text-failed' : undefined}>
                {turnMark(decision)}
              </span>
              <span className="min-w-0 truncate">{decision.label}</span>
            </span>
            {/* THE FOLD MAY COST DETAIL, NEVER ALARM. A turn's mark cannot say
              how many tool calls blew up inside it, and the count is what the
              operator would otherwise have to open the turn to find. Drawn
              only above zero: ABSENT is "this source cannot report tool
              failures" and ZERO is "vam looked and found none", and neither is
              news. */}
            {failed > 0 && (
              <span data-progress-failed className="text-failed">
                · {failed} failed
              </span>
            )}
            {/* `session.activity` is what the session is doing RIGHT NOW, so it
              belongs to the turn currently being worked and to no other -- on
              an older turn it described the present while the operator read
              the past. In a column that turn is the last one, at the bottom,
              which is where the eye already is. */}
            {newest && activity !== null && (
              <>
                {/* The line's own middot, so the label and the activity do not
                  run together into one phrase. Decorative: a screen reader
                  reads two values. */}
                <span aria-hidden="true">·</span>
                <span data-progress-activity className="min-w-0 truncate">
                  {activity}
                </span>
              </>
            )}
            {/* WHAT IT IS BLOCKED ON, in the session's own words. The pane used
              to compute `waitingFor` and spend it as a boolean, so every
              waiting session read the same on screen: "it needs something" and
              "it needs permission to run rm" were one picture. VERBATIM,
              because the observed causes are a sample of an open set
              (`session-status.ts`). */}
            {newest && waitingCause !== null && (
              <>
                <span aria-hidden="true">·</span>
                <span data-progress-waiting className="min-w-0 truncate text-waiting">
                  {waitingCause}
                </span>
              </>
            )}
          </div>
          {/* THE CALLS THE TURN MADE, which is what "show the whole progress"
              asked for. Before this the line above was the whole of a turn's
              working on screen -- its mark and the agent's name -- while the
              reader had parsed every `tool_use` part and kept one.

              INSIDE THIS SECTION, NOT BESIDE IT. That is what keeps focus view
              folding ONE thing: `drawsTurnSteps` is a strict subset of
              `drawsProgressLine` (swept in `prefs.focus-view.test.ts`), so
              there is no state where a row outlives the line it belongs to.

              AN ORDERED LIST, because the order is the content: this is what
              the turn did and then did next. `list-none` is explicit rather
              than left to the preflight -- a marker column here would indent
              every row past the line it sits under. */}
          {showSteps && (
            <ol
              data-progress-steps
              className="flex min-w-0 list-none flex-col gap-0.5 pl-3 font-mono text-ink-faint text-meta"
            >
              {steps.slice(0, MAX_STEP_ROWS).map((step) => (
                <StepRow key={step.id} step={step} />
              ))}
              {/* WHAT THE CAP LEFT OUT, as a number vam read. A list that is a
                  count of what was READ cannot then quietly draw fewer than it
                  holds: that is the silent fold this surface exists against,
                  and it is the same qualifier `turns read` carries one level
                  up. */}
              {dropped > 0 && (
                <li data-progress-steps-more className="text-ink-quiet">
                  {t('steps.more', { count: String(dropped) })}
                </li>
              )}
            </ol>
          )}
        </section>
      )}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: the rule is RIGHT
          about this one and the answer is still a suppression, so the reason
          is written out. A transcript block has no focusable child, so the
          Menu key -- which fires `contextmenu` on the FOCUSED element -- cannot
          open this menu, and unlike the session row and the tab there is no
          button here to move the handler onto. Making one would mean a tab
          stop per turn, and the column draws up to 3,276 of them.
          WHAT MAKES IT SOUND: neither ACT is pointer-only. Copy is `yy`, which copies
          this turn's commands, and the answer itself is selectable text.
          This menu is a shortcut to acts the keyboard already has -- which is
          what the rule exists to guarantee -- rather than the only route to
          them. If an act is ever added here that has no chord, this comment
          stops being true and the suppression has to go. */}
      <section
        data-detail-block="out"
        /* The "detail pane" half of the same request. One item, so the handler
           is the same one the bubble uses with a different `kind`. */
        onContextMenu={(event) => {
          event.preventDefault();
          onAnswerMenu(decision.id, { x: event.clientX, y: event.clientY });
        }}
        className="flex flex-none flex-col gap-1.5"
      >
        <span className="sr-only">out</span>
        <div
          data-detail-scroll="out"
          className="flex flex-col gap-2 text-[length:var(--vam-out-font-size,12px)]"
        >
          {decision.output !== null && decision.output !== '' && (
            <OutText output={decision.output} />
          )}
          {(decision.output === null || decision.output === '' || live) && (
            /* The live line and the answer are not alternatives, and treating
               them as one is what made this line unreachable in practice: it
               used to render only when `output` was empty, but `transcript.ts`
               writes `turns[last].output` on every assistant text, so a
               running session has an answer within seconds and the operator
               never saw the line again. It is rendered whenever the turn is
               live, and BELOW the answer: here is what the session has said,
               here is what it is doing now. When there is no answer it is the
               only thing in the region, so the empty-turn sentence prints
               once, in this same element, rather than in a second one.

               While the session is working, this line is the only thing in the
               pane that changes -- so it carries the work rather than a
               sentence that reads the same on a session that has quietly died.
               The idiom is the agent's own running caption: a star, the word
               for what it is doing, and an ellipsis that animates. The WORD is
               `activity` -- the newest tool call the source reported -- so it
               cycles as the work does, off data vam has, rather than off a
               rotating list of invented gerunds. Under
               `prefers-reduced-motion` the dots park on at full opacity
               (styles.css), which still reads as "still going". It is withheld
               from every stopped status -- `live` is `running` AND
               newest-turn only. A null `activity` is a source that cannot say
               (model.ts): the sentence stays as the word and no words are
               invented, because it asserts only that the session is running,
               which it is. */
            <p
              data-out-empty={decision.output === null || decision.output === '' ? true : undefined}
              data-out-live={live ? 'true' : undefined}
              className="text-control text-ink-faint"
            >
              {live ? (
                /* Star and word share one accent, the app's own `running`
                   token; the detail is dim. Decorative marks are hidden from
                   assistive tech, which should read the activity and not a
                   star and three dots. */
                <span data-out-running className="text-running">
                  <span aria-hidden="true" data-out-running-star className="vam-running-star">
                    {'✳'}
                  </span>{' '}
                  <span data-out-running-word className="vam-running-word">
                    {/* `activity` is the newest tool call the source read, and
                        on a turn vam painted itself that reading is about the
                        PREVIOUS turn -- it was taken before this prompt was
                        sent. Drawing it here would name work the agent did
                        earlier as this turn's working, which is the same
                        unsupported claim `noAnswerNote` refuses one line down.
                        So the paint's own sentence wins over it. */}
                    {decision.unconfirmed === true || decision.unread === true
                      ? noAnswerNote(decision.output, status, decision.unconfirmed, decision.unread)
                      : (activity ??
                        noAnswerNote(
                          decision.output,
                          status,
                          decision.unconfirmed,
                          decision.unread,
                        ))}
                  </span>
                  <span aria-hidden="true" data-out-ellipsis className="vam-ellipsis">
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                  </span>
                  {age !== null && (
                    <span data-out-running-detail className="text-ink-faint">
                      {' '}
                      (last active {age} ago)
                    </span>
                  )}
                </span>
              ) : (
                noAnswerNote(decision.output, status, decision.unconfirmed, decision.unread)
              )}
            </p>
          )}
        </div>
      </section>
    </article>
  );
});

export function DetailPanel(props: DetailPanelProps) {
  const {
    entry,
    decision: canvasDecision,
    focusNodeId,
    draft,
    onDraftChange,
    onSubmit,
    composing,
    onCompose,
    onStopComposing,
    active,
    actionIndex,
    delivers,
    answer,
    prompt,
    model,
    terminal,
    files,
    pickImageAttachment,
    sending = false,
    width,
    resizeHandle,
    records,
    prRepo,
    phone = false,
    onQuestionOpenChange,
    defaultProvider,
    onSetDefaultProvider,
    onStartSession,
    onResumeInPane,
    startingPane = null,
    gettingStarted,
    paneFocused = true,
  } = props;

  const inputRef = useRef<HTMLTextAreaElement>(null);
  /**
   * WHICH TURN THIS PANEL IS READING, independent of which one the canvas
   * itself is focused on.
   *
   * `canvasDecision` is the canvas's own pick: the newest turn by default, or
   * whichever of its three visible slots `h`/`l` has moved to (`Canvas.tsx`).
   * This panel used to have no memory of its own -- every render drew exactly
   * that decision -- which was fine while the canvas's cap of three and the
   * model's cap of three were the same number, but the parser now keeps every
   * turn a session has (`transcript.ts`), so the progress list below can hold
   * turns the canvas never shows at all. `selectedId` is this panel's own
   * answer to "which turn am I looking at": it starts on the canvas's pick
   * and moves only when a progress row is clicked (below), or when the
   * canvas ITSELF navigates -- a session refocused, or its cursor moved to a
   * different step -- which is what "follows it" means.
   *
   * TWO SIGNALS DECIDE THAT, NEITHER ONE ALONE. Session identity
   * (`sessionKey`) always resets the pick -- a new session is a new document,
   * the same rule `cycleAbout`/`noteFor` below already applies to the
   * mode-cycle note. `focusNodeId` (see its own doc on the prop) is what
   * catches an EXPLICIT canvas navigation within one session. `canvasDecision`
   * itself is deliberately NOT the trigger any more: turn ids are now
   * content-derived (`transcript.ts`), so the canvas's default pick
   * (`decisions[0]`) gets a genuinely new id every time a new turn arrives,
   * with no navigation at all -- keying the follow on THAT would drag an
   * operator reading history back to the newest turn on every poll, the
   * mirror image of the bug this whole mechanism exists to prevent.
   *
   * COMPARED DURING RENDER, THE SAME TRICK `cycleAbout`/`noteFor` BELOW
   * ALREADY USES for the identical shape of problem: this state belongs to a
   * subject and the subject just changed under it. An effect would draw one
   * frame of the OLD turn before catching up -- exactly the half-read flash
   * `focusKey` below already exists to avoid for a genuine focus change.
   */
  const canvasDecisionId = canvasDecision?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(canvasDecisionId);
  const sessionKey = entry?.session.id ?? null;
  const sessionKeyRef = useRef(sessionKey);
  const focusNodeRef = useRef(focusNodeId);
  /**
   * WHICH TURN THE COLUMN SHOULD BE SCROLLED TO, once, on the next paint.
   *
   * A ref rather than state because nothing renders from it: it is a
   * one-shot instruction to the layout effect below, consumed and cleared
   * there. Set by an explicit pick and by a canvas navigation -- the two
   * things that mean "take me to that turn" now that picking one no longer
   * hides the rest. Session identity is deliberately NOT here: a new document
   * opens at its newest turn, which is the stick-to-bottom effect's job, and
   * an instruction to scroll into the middle of it would fight that.
   */
  const scrollToTurnRef = useRef<string | null>(null);
  let followCanvas = false;
  let sessionChanged = false;
  if (sessionKeyRef.current !== sessionKey) {
    sessionKeyRef.current = sessionKey;
    followCanvas = true;
    sessionChanged = true;
  }
  // `undefined` (no caller offering the signal, e.g. `PhoneShell`) is never a
  // "change" -- only a caller that actually reports a node id can ask this
  // panel to follow one.
  if (focusNodeId !== undefined && focusNodeRef.current !== focusNodeId) {
    focusNodeRef.current = focusNodeId;
    followCanvas = true;
    // WITHIN ONE SESSION ONLY. Focusing a different session changes this id
    // too, and there the bottom is where the column must open -- landing
    // mid-history is the half-read flash `focusKey` has always existed to
    // avoid.
    if (!sessionChanged && canvasDecisionId !== null) scrollToTurnRef.current = canvasDecisionId;
  }
  if (followCanvas && selectedId !== canvasDecisionId) setSelectedId(canvasDecisionId);
  /**
   * THE SOURCE'S BACKWARD PAGER, or `null` when this source has none.
   *
   * Read from context rather than taken as a prop, and `sources/history-reader.ts`
   * carries the argument for that: it is the one member this pane uses that
   * belongs to the SOURCE rather than to this pane, it takes the session id it
   * acts on as an argument, and every split leaf wants the same function.
   * `null` is a real answer -- an honest "this source cannot read further
   * back" -- never a stub that resolves empty, because a stub is how "nothing
   * older" and "vam could not ask" become one sentence.
   */
  const readHistory = useHistoryReader();
  /**
   * THE TURNS THIS PANE HAS WALKED BACK INTO, newest first, and where the walk
   * has got to. Two pieces of state, one subject.
   *
   * WHY THEY LIVE HERE, in this component, rather than in the model:
   *
   *  - `entry` is rebuilt WHOLESALE by the poll (`useSourceModel`), so anything
   *    written into it would be erased every ten seconds by the very thing it
   *    has to survive;
   *  - the thing that must not move when a page lands is THIS pane's scroll
   *    offset, and `Canvas.tsx` mounts one `DetailPanel` per split leaf -- two
   *    panes on the same session scroll independently, so a store shared
   *    between them would tie one operator's scroll-back to the other's;
   *  - and it is per-pane state that nothing outside this pane renders from,
   *    which is the same test `cycleNote` and the tab already pass.
   *
   * ONLY THE OLDER HALF IS REMEMBERED, and `transcript-history.ts` carries the
   * argument in full: the live list is used exactly as the poll delivered it,
   * so this pane holds no second opinion about a turn the poll is still
   * carrying, and `Canvas.tsx`'s optimistic paint -- with the retraction that
   * follows a refused write -- stays the poll's business rather than becoming a
   * phantom this pane preserves.
   */
  const [older, setOlder] = useState<readonly Decision[]>(NO_TURNS);
  const [pager, setPager] = useState<PagerState>(RESTING_PAGER);
  /**
   * WHICH SESSION A WALK IS RUNNING FOR, or `null` when none is. A ref, because
   * nothing renders from it -- `pager.phase` is what the block draws -- and
   * because it has to be readable and writable between two ticks of one async
   * function without a render in between, which is what makes "one request in
   * flight" a guarantee rather than a race.
   */
  const readingRef = useRef<string | null>(null);
  // A NEW SESSION IS A NEW DOCUMENT: another session's turns must not be above
  // it, its cursor is meaningless here, and a walk still in flight for the old
  // one must not be allowed to block this one's first ask. Read from a local
  // for THIS render -- the state updates queued here land on the next one, and
  // drawing the old session's history for one frame is the half-read flash
  // `focusKey` has always existed to avoid.
  if (sessionChanged) readingRef.current = null;
  if (sessionChanged && older.length > 0) setOlder(NO_TURNS);
  if (sessionChanged && pager !== RESTING_PAGER) setPager(RESTING_PAGER);
  const olderNow = sessionChanged ? NO_TURNS : older;
  const pagerNow = sessionChanged ? RESTING_PAGER : pager;
  const mergedColumn = columnOf(entry?.session.decisions ?? NO_TURNS, olderNow);
  /**
   * A PICK THE COLUMN NO LONGER CARRIES AT ALL -- not merely off the newest
   * slice, but genuinely absent, the same gap `source.ts` already documents for
   * `questions` past `TAIL_BYTES`: vam cannot tell "answered a while ago" from
   * "never happened" for something outside the window, so it must not pretend
   * otherwise. Checked before falling back to `canvasDecision`, which is what
   * stops that fallback from quietly relabelling a different turn as the one
   * the operator picked.
   *
   * AGAINST THE COLUMN, NOT AGAINST `decisions`, and that changed with paging.
   * The column now holds turns the live tail does not -- ones read back into
   * it, and ones the tail's byte window has since slid past -- so asking
   * `decisions` alone would print "the turn you were reading has scrolled out
   * of what vam can see" over a turn that is on screen, forty pixels below.
   */
  const selectedTurnMissing =
    entry !== null &&
    selectedId !== null &&
    selectedId !== canvasDecisionId &&
    !mergedColumn.some((d) => d.id === selectedId);
  /**
   * RENDERED FROM THE PROP WHEN IT MATCHES, RATHER THAN RE-FOUND BY ID. While
   * this panel is following the canvas's own pick (the common case),
   * `canvasDecision` is already the freshest object this render has -- built
   * from this same `entry.session.decisions` -- so using it as given is what
   * keeps a streaming answer on the newest turn live. A re-lookup would still
   * find the same id, but there is no reason to add one. Only once the
   * operator has picked something else does this reach into the COLUMN for it,
   * which is the one place that turn's current content actually lives -- the
   * merged list rather than `decisions`, for `selectedTurnMissing`'s own reason
   * above, and it stays fresh because `columnOf` puts the poll's own list
   * first: a turn the poll still carries is found there, in the poll's copy,
   * before the pager's older one is ever reached. `null` when it is not there
   * at all, so `selectedTurnMissing`'s message draws instead of a substitute.
   */
  const decision: Decision | null = selectedTurnMissing
    ? null
    : selectedId === canvasDecisionId
      ? canvasDecision
      : (mergedColumn.find((d) => d.id === selectedId) ?? canvasDecision);
  /**
   * WHAT THE LAST SHIFT-TAB DID, in flight and afterwards, or `null` at rest.
   *
   * Three states rather than a refusal alone, because this caption is the
   * whole of the feedback for the chord: the composer is drawn only while the
   * tab is not Terminal, so the pane it presses into is by construction not on
   * screen, and the MODE pills read the draft, which Shift-Tab does not touch.
   * With `busy` and `sent` missing, a successful press put the resting text
   * back and was pixel-identical to a key nothing was bound to.
   *
   * Component state because it is about ONE keypress in this pane and nothing
   * outside has an opinion about it -- the same reason the tab and the
   * progress region are held here.
   */
  const [cycleNote, setCycleNote] = useState<CycleNote | null>(null);
  /**
   * The note belongs to the session it was raised for.
   *
   * This pane is NOT remounted when `entry` changes, so A's amber "tmux would
   * not deliver to that session", still on screen over B's mode row, is a
   * claim about B that nothing ever made. The row is part of the identity
   * because two sessions of one project are two different panes -- the same
   * three lines, for the same reason, as `TerminalTab`'s `refusalFor`.
   */
  const cycleAbout = `${entry?.project.id ?? ''}|${entry?.session.id ?? ''}`;
  const noteFor = useRef(cycleAbout);
  if (noteFor.current !== cycleAbout) {
    noteFor.current = cycleAbout;
    if (cycleNote !== null) setCycleNote(null);
  }
  /**
   * Whether a mode can ACTUALLY be chosen for the focused session -- the one
   * condition the row is drawn on: hidden where the factory has already
   * chosen and vam cannot change it, shown only where a choice is possible.
   *
   * TWO FACTS, NEITHER ALONE. `vamControlled` is the necessary one: vam can
   * press a key only in a pane it started, because no process may take over
   * another's controlling TTY (`main/sources/tmux/argv.ts`). It is not
   * sufficient -- the source's `terminal` capability is what says there is a
   * pane surface at all, and absent is "nobody established this", not a fact
   * to draw a control on. ABSENT, NOT DISABLED: a dimmed switcher still says
   * a mode is choosable here, which is what this row was deleted for once.
   */
  const canCycleMode = entry !== null && terminal !== false && entry.session.vamControlled === true;
  /**
   * KEYSTROKES INTO THIS SESSION'S PANE, shared by the mode row's own
   * Shift-Tab, every button of the phone keystroke strip and the composer's
   * Escape -- they are the SAME channel (`window.api.terminal.send`) into the
   * SAME pane, so one in-flight guard and one refusal caption serve all of
   * them rather than each growing its own copy. `cycleNote` is the shared
   * note; `sentText`/`busyText` are the one difference between a mode cycle
   * and a keystroke.
   *
   * THE MODEL PICKER USED TO BE ON THIS LIST AND IS NOT ANY MORE. It typed
   * `/model <alias>` + Enter, which is the form the CLI ALSO saves as the
   * operator's default for new sessions; it goes down `terminal.switchModel`
   * now, where main drives the CLI's own menu (`sendModel`). It still SHARES
   * `cycleNote` -- one caption in the row, one in-flight guard -- because
   * neither of those was ever about the channel.
   *
   * One press at a time, ACROSS EVERY CONTROL: held down, a repeat here
   * queued a `back-tab` per repeat into a live agent with nothing on screen
   * counting them, a phone tap repeated in a hurry is the same failure, and a
   * model picked twice while the first pick is still typing would interleave
   * two lines in one pane.
   *
   * A RUN, NOT A KEY, since the model picker: `/model opus` is a line and an
   * Enter rather than a chord, and `pressPaneKey` below is the one-stroke
   * case of this. ONE STROKE AT A TIME, AWAITED, and the run STOPS at the
   * first that does not land. The pane is a byte stream, so pieces sent in
   * order arrive as one line; but a Return pressed after a refused piece
   * would submit a mangled line into a running agent, so a refusal anywhere
   * in the run ends it with the text sitting in the pane unsent -- `reply.ts`
   * keeps exactly this rule for a prompt, and its refusal says so. Every
   * stroke is aimed by main by the same rule as the first (`terminal/ipc.ts`
   * reuses a proven pairing for two seconds, which is what makes a run of
   * three not three listings).
   *
   * `window.api` exists only in the Electron shell, and its absence is
   * reported rather than made into a no-op.
   */
  const typePaneStrokes = async (
    strokes: readonly PaneKey[],
    sentText: string,
    busyText: string,
  ) => {
    if (entry === null) return;
    if (cycleNote?.kind === 'busy') return;
    const send = globalThis.window?.api?.terminal?.send;
    if (send === undefined) {
      setCycleNote({
        kind: 'refused',
        text: 'not sent — this build has no keyboard into a session’s pane',
      });
      return;
    }
    // BEFORE THE AWAIT: one to three tmux spawns follow, at ten seconds each.
    setCycleNote({ kind: 'busy', text: busyText });
    const mine = cycleAbout;
    let landed: PaneSendResult = 'sent';
    let typed = 0;
    for (const stroke of strokes) {
      landed = await send(entry.project.id, stroke, entry.session.id).catch(
        (): PaneSendResult => 'refused',
      );
      if (landed !== 'sent') break;
      typed += 1;
    }
    // Thirty seconds is long enough to move on, and an answer about the
    // session that was here then says nothing about the one that is here now.
    if (noteFor.current !== mine) return;
    const refusal = cycleWording(landed);
    // A run that typed something and then stopped has left it on screen in
    // the pane, and the caption must say so: "not sent" alone would send the
    // operator looking for a pairing problem while the half-line sits there
    // waiting for a Return that vam did not press.
    const sitting =
      refusal !== null && typed > 0 && strokes.length > 1
        ? `${refusal} — what was typed is sitting in the pane unsent`
        : refusal;
    setCycleNote(
      sitting === null ? { kind: 'sent', text: sentText } : { kind: 'refused', text: sitting },
    );
  };
  /** The one-stroke case: the chord, the strip's keys, the composer's Escape. */
  const pressPaneKey = (key: PaneKey, sentText: string, busyText: string) =>
    typePaneStrokes([key], sentText, busyText);
  /**
   * Press the session's own Shift-Tab, OVER THE ONE CHANNEL THAT ALREADY
   * TYPES INTO A PANE: `terminal.send` resolves the pane in main and refuses
   * every answer but a single session it can prove is this row's, so a second
   * path would be a second chance to get that wrong -- into somebody's
   * running agent.
   */
  const cycleMode = () =>
    // THE DELIVERY, NOT THE MODE. vam presses the session's own chord into the
    // pane and never reads back which mode the agent landed in, so naming one
    // here would be a claim nothing checked.
    //
    // `chordSymbols('Shift-Tab')` RATHER THAN A LITERAL `⇧Tab` -- this used
    // to hard-code the Mac spelling unconditionally, on a desktop control
    // every platform vam ships reaches. `keysheet.ts`'s own Files-tab row
    // already asked `chordSymbols` this exact question; this caption now
    // asks it too, rather than answering a second way.
    pressPaneKey(
      { kind: 'back-tab' },
      `${chordSymbols('Shift-Tab')} sent — vam does not read the mode back`,
      `${chordSymbols('Shift-Tab')} · sending…`,
    );
  /** One keystroke-strip button's press, over the shared bridge above. */
  const sendKey = (item: (typeof KEY_STRIP)[number]) =>
    pressPaneKey(item.key, `${stripCaption(item)} sent`, `${stripCaption(item)} · sending…`);
  /**
   * Switch this session's model -- ONE CALL, because the whole policy lives in
   * main now (`main/terminal/model-switch.ts`).
   *
   * WHAT THIS FUNCTION USED TO DO, AND WHY IT STOPPED. It built the strokes for
   * `/model <alias>` and typed them over `terminal.send`. Measured on Claude
   * Code 2.1.276, that form answers:
   *
   *     ⎿  Set model to Opus 5 and saved as your default for new sessions
   *
   * -- so every pick in vam silently rewrote `~/.claude/settings.json`, from a
   * control the operator reached for to change ONE session. The CLI's own menu
   * offers `s` for "this session only", and driving a menu means reading a
   * screen and walking a cursor: that is `answer.ts`'s discipline, it belongs
   * in main, and it may not be half here and half there. ONE RULE, ONE PLACE.
   *
   * THE ONE CHECK THAT STAYS HERE IS THE BRIDGE, AND THE ORDER IS THE POINT. A
   * build with no keyboard into a pane -- the browser arm, where `window.api`
   * is undefined -- cannot switch a model whatever is on the screen, so it must
   * say so rather than report anything about a question the pane happens to be
   * asking. The web guard `model-picker-shots.mjs` caught exactly that: it
   * drives the browser build against a demo row that IS asking one, and the
   * caption came back naming the question, which would send the operator off to
   * answer something that would not have helped.
   *
   * AND THE ONE-WORD CHECK IS GONE FROM HERE WITH THE FIELD THAT COULD FAIL
   * IT. `modelCommandLine` refused a choice carrying a space or a newline
   * before the bridge was touched, because the free-text row let an operator
   * type either. Every caller is now one of `MODEL_CHOICES`' own five ids, so
   * that branch had no input left that could reach it -- and a refusal nothing
   * can produce is a refusal nothing can test. The rule itself did not move:
   * `isModelChoice` in main enforces it on whatever the renderer sends, which
   * is where enforcement belonged all along.
   */
  const sendModel = async (choice: string) => {
    if (entry === null) return;
    if (cycleNote?.kind === 'busy') return;
    const switchModel = globalThis.window?.api?.terminal?.switchModel;
    if (switchModel === undefined) {
      setCycleNote({
        kind: 'refused',
        text: 'not sent — this build has no keyboard into a session’s pane',
      });
      return;
    }
    // BEFORE THE AWAIT: main reads the pane, opens a menu and walks it, which
    // is several tmux spawns at ten seconds each, and a control that looks
    // idle through that reads as one that did nothing.
    // NAMED BY THE ALIAS, NOT BY A `/model <alias>` LINE. This used to print
    // one, which was true while a full id really was typed that way; vam types
    // `/model` bare and walks the menu for every choice it accepts now, so a
    // busy caption quoting the argument form would name a line vam never sends
    // -- the same small lie the `sent` caption below refuses to tell.
    setCycleNote({ kind: 'busy', text: `${choice} · switching…` });
    const mine = cycleAbout;
    const result = await switchModel(entry.project.id, choice, entry.session.id).catch(
      (): ModelSwitchResult => ({ kind: 'refused' }),
    );
    // The row changed under the walk; an answer about the session that was
    // here then says nothing about the one that is here now.
    if (noteFor.current !== mine) return;
    setCycleNote(modelSwitchNote(result, entry.session.title, choice));
    // LOOK AGAIN, AND DO NOT ASSUME. The menu has just been driven, so this is
    // the one moment the model is known to be about to change -- but what goes
    // on the button is still whatever the PANE says next, which is what makes a
    // CLI that refused the switch show the old model rather than the asked-for
    // one. If this read is a beat early the interval corrects it; nothing here
    // writes a name. `null` while no poll is running, which is every state
    // where there was nothing to label anyway.
    lookForModel.current?.();
  };
  /** The first option of the open question, when one is being asked. */
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  /**
   * Which view the pane is showing -- the caller's fact when it has one, this
   * component's own when it does not.
   *
   * IT USED TO BE LOCAL STATE THAT DELIBERATELY SURVIVED A SESSION SWITCH, on
   * the reasoning that "an operator who opened Agents is looking at agents,
   * not at whichever tab the last session left behind". The operator has
   * overruled it: a view is a per-session choice, and switching session 1 to
   * PRs must leave every other session where it was. The sentence above was
   * true of ONE session in ONE pane and became false the moment a pane could
   * show several -- `Canvas.tsx` claimed the isolation in a comment on
   * `renderLeaf` while `key={leaf.id}` remounted nothing.
   *
   * The validating stays HERE, for both routes, because this is where the bar
   * is: a name that is not on it (an older vam's tab, a hand-edited store) is
   * simply not a view, so it costs the default and nothing else.
   */
  const [ownTab, setOwnTab] = useState<Tab>(() => {
    const remembered = props.initialTab;
    return TABS.find((name) => name === remembered) ?? 'Response';
  });
  const named = props.tab;
  const controlled = named !== undefined;
  const tab = controlled ? (TABS.find((name) => name === named) ?? 'Response') : ownTab;
  const onTabChange = props.onTabChange;
  /**
   * Report the operator's CHOICE, never `current`. `current` falls back to
   * Response while a source withdraws the Terminal tab, and reporting that
   * would let walking past a session without a terminal erase a choice the
   * operator never changed.
   *
   * FROM THE ACT, NOT FROM AN EFFECT, and that is what closes a loop rather
   * than opening one. This used to be `useEffect(() => onTabChange?.(tab))`
   * gated on `paneFocused`: `onTabChange` is a fresh closure every render, so
   * it fired on every render, and with two panes showing two different tabs
   * each write re-rendered the other pane, which wrote back, forever --
   * measured, a synchronous `savePrefs` loop that hung the shell. Calling it
   * only when a view is actually PICKED means there is no render-driven write
   * left to loop, so the `paneFocused` gate that was holding the loop shut is
   * no longer load-bearing and is gone with it. A background pane can now
   * report its own session's view, which is correct: it is still an act the
   * operator performed, in the pane they performed it in.
   */
  const pickTab = useCallback(
    (next: Tab) => {
      if (!controlled) setOwnTab(next);
      onTabChange?.(next);
    },
    [controlled, onTabChange],
  );
  const tabRequest = props.tabRequest ?? null;
  const viewNote = props.viewNote ?? null;
  /**
   * A withdrawn tab is not refused here: `current` below already falls back to
   * Response when the showing tab is not on offer, so asking for Terminal
   * where there is none lands exactly where clicking would have.
   *
   * THROUGH A REF, and the reason is the loop this file has now had twice.
   * `pickTab` closes over `onTabChange`, which every caller builds inline and
   * therefore hands over fresh on every render. In the dependency array that
   * makes this effect re-run on every render, re-applying a request the
   * operator pressed once -- so a view picked in one session was re-asserted
   * onto the next session the pane showed, which is the exact bleed the
   * per-session view exists to stop, arriving through the fix for it. The
   * request object is the only thing that should re-run this, so it is the
   * only dependency.
   */
  const pickTabRef = useRef(pickTab);
  pickTabRef.current = pickTab;
  useEffect(() => {
    if (tabRequest !== null) {
      pickTabRef.current(tabRequest.tab);
    }
  }, [tabRequest]);
  /**
   * WHAT A CONTROL INSIDE AN AGENT'S ANSWER CAN ASK THIS PANE FOR.
   *
   * Published through a context rather than threaded as props, and
   * `out-actions.ts` owes the argument for that: `OUT_MARKDOWN` is a module
   * constant because it is a react-markdown PROP, so a map rebuilt per render
   * would re-render every answer in the column. The PROVIDER is here, per
   * pane, because `openFileRef` is about THIS pane's session and THIS pane's
   * Files tab -- two split panes showing two sessions must not share one.
   */
  const [fileOpenRequest, setFileOpenRequest] = useState<FileOpenRequest | null>(null);
  const refSessionId = entry?.session.id ?? null;
  const outActions = useMemo(
    () => ({
      /**
       * The address is already parsed and already checked HERE (the control
       * runs `checkLink` to decide how to draw itself); main parses and checks
       * it again on its own side, which is where the guarantee is.
       *
       * ONLY ONE OF THE TWO SHELLS EVER REACHES THE BRIDGE, and it is worth
       * saying out loud rather than leaving a reader to assume both do.
       * `App.tsx` routes on `window.api !== undefined`: with it, the desktop
       * canvas; without it, the browser shell (the demo and a paired phone
       * alike), and the two are mutually exclusive. So this member answers for
       * real in the Electron app, and everywhere else it answers the refusal
       * below -- in words, never a press that does nothing.
       *
       * THAT LEAVES A PHONE WITHOUT A WAY TO OPEN A LINK, which is a real
       * cost and not an oversight. A `window.open` fallback would work there
       * (a phone browser has tabs; there is no application window to hijack),
       * but it would put a call this repo denies by policy into a component
       * that also runs inside Electron, where the denial is load-bearing --
       * and the gate that keeps them apart would be one `undefined` check in
       * the renderer, which is the least trusted process here. If the remote
       * endpoint ever wants this, it should be decided for the phone
       * deliberately, not inherited from a fallback nobody re-read.
       */
      openLink: async (url: string): Promise<OutActionResult> => {
        const open = globalThis.window?.api?.link?.open;
        if (open === undefined) {
          return {
            ok: false,
            reason: 'the vam desktop app is what opens links; this build has no bridge to it.',
          };
        }
        return await open(url);
      },
      /**
       * THE REFERENCE CROSSES AS TEXT. Main resolves it against this session's
       * own working directory and answers an absolute path, or refuses in the
       * session's own words (`main/files/resolve-ipc.ts`) -- this pane never
       * joins a root to a path, because string arithmetic cannot answer
       * containment (`main/dialog/attach-image.ts` measured that).
       *
       * The tab is asked for only AFTER a path comes back. Switching first
       * would land the operator on a Files tab showing nothing, with the
       * reason drawn on the tab they just left.
       */
      openFileRef: async (reference: string): Promise<OutActionResult> => {
        const resolve = globalThis.window?.api?.files?.resolve;
        if (resolve === undefined || files !== true || refSessionId === null) {
          return {
            ok: false,
            reason: 'the vam desktop app is what opens files; this build has no Files tab.',
          };
        }
        try {
          const target = await resolve(refSessionId, reference);
          // A FRESH OBJECT every time: pressing the same reference twice is
          // two asks. Same shape as `tabRequest` above, same reason.
          setFileOpenRequest({ sessionId: refSessionId, path: target.path, line: target.line });
          pickTabRef.current('Files');
          return { ok: true };
        } catch (reason) {
          const error = reason as SourceError;
          return {
            ok: false,
            reason: error.message ?? 'vam could not open that file.',
          };
        }
      },
    }),
    [refSessionId, files],
  );
  // Which tabs this source actually has. A withdrawn tab cannot stay SHOWING:
  // the operator can be on Terminal when focus moves to a session from a
  // source without one, and a tab bar with nothing selected over a pane
  // drawing a tab that is no longer offered is the state this collapses.
  //
  // `phone` IS PASSED HERE, NOT ONLY IN THE PHONE SHELL'S ICON ROW, and that
  // is what makes the PRs withdrawal structural rather than cosmetic. This
  // panel is the component the phone RE-HOSTS, and the `current === 'PRs'`
  // branch far below is the only thing that ever mounts the tab. Withdrawing
  // the icon alone would leave that branch reachable by any route that names a
  // tab without going through the row -- a remembered `prefs.detailTab`, a
  // `tabRequest` from somewhere else, an `initialTab` off the store -- and
  // `current`'s fallback is precisely what catches all of them at once.
  const tabs = visibleTabs(terminal !== false, files === true, phone);
  const current = tabs.includes(tab) ? tab : 'Response';

  /**
   * `StartTimeoutHint`'s own escape hatch: switch THIS pane to Terminal,
   * through `pickTab` -- the one function that also reports the choice
   * upward (`onTabChange`) and remembers it locally when uncontrolled -- so
   * the link behaves exactly like clicking the Terminal icon by hand rather
   * than being a second, poorer route to the same tab. ABSENT when Terminal
   * itself is withdrawn (`tabs` above already answers that): a link past a
   * 30s wait promising a view that is not on the bar would land nowhere.
   */
  const onShowTerminal = tabs.includes('Terminal') ? () => pickTab('Terminal') : undefined;

  /** Whether the step counter has been asked for the sentence it abbreviates. */

  /**
   * Where `i` lands. The prompt box, unless the session is asking something --
   * a question with options is the thing the operator came to act on, and
   * walking to it with the mouse in a keyboard-first app is the gap this
   * closes. Tab or Esc still reaches the box from there, and a card that
   * answers nothing cannot swallow a prompt: nothing is submitted from it.
   */
  useEffect(() => {
    if (!composing) return;
    if (firstOptionRef.current !== null) firstOptionRef.current.focus();
    else inputRef.current?.focus();
  }, [composing]);

  /**
   * THIS PANE NO LONGER MOVES FOCUS TO FOLLOW THE MODE — the mode follows
   * focus, so an effect that did both was the loop as well as the bug.
   *
   * What stood here watched `active` (`isFocused && mode === 'insert'`) and
   * focused the first option on the way in, blurring it on the way out. Both
   * halves were necessary while the mode was a flag, and both were incomplete:
   * the entry took nothing when the pane had no question (audit F5 — Insert
   * with nothing focused to insert into), and the exit blurred ONLY
   * `[data-question-option]`, so `Mod-0` typed in the composer left a
   * read-only textarea holding the keyboard while the bar read Select (F4).
   *
   * `Canvas.tsx` owns both directions now, through `keyboard/focus-scope.ts`:
   * `focusInsertStop` on the way in — which lands on this pane's first stop in
   * document order, the question's options when there are any and the prompt
   * row otherwise — and `releaseInsert` on the way out, which blurs whatever
   * is in an insert scope rather than one attribute's worth of it. One
   * authority for where the keyboard is, which is the whole point.
   */

  /**
   * The `out` region rides its own bottom: the newest output is the thing a
   * decision gets made from, so it is what the pane shows without a scroll.
   * `stuck` is a ref rather than state because nothing renders from it — it is
   * read inside the effect that fires when the content changes, and turning it
   * into state would re-render the pane on every scroll event for no pixel.
   */
  const outRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  /**
   * Which of the two jumps would actually move `out`. This one DOES render, so
   * unlike `stuck` it is state — a control that scrolls nowhere is worse than
   * no control, so each is drawn only while there is something on its side.
   */
  const [jumps, setJumps] = useState({ above: false, below: false });
  const syncJumps = (box: HTMLElement) => {
    const next = { above: hasContentAbove(box), below: hasContentBelow(box) };
    setJumps((now) => (now.above === next.above && now.below === next.below ? now : next));
  };
  const jumpTo = (edge: 'top' | 'bottom') => {
    const box = outRef.current;
    if (box === null) return;
    // Going up also lets go of the bottom, and it is done HERE rather than left
    // to the scroll event: new output arriving before that event lands would
    // otherwise find `stuck` still true and yank the region straight back down.
    stuckRef.current = edge === 'bottom';
    box.scrollTop = edge === 'top' ? 0 : box.scrollHeight;
    syncJumps(box);
  };

  /**
   * `questionInlineRef`/`questionInViewport` -- see the deviation's own
   * comment beside `openStepCount`, just below, where `openQuestion` first
   * exists: this state is declared here (with `jumpTo`, `outRef`) but the
   * effect that DRIVES it has to live after `openQuestion` is computed, so
   * it sits beside `openStepCount` instead.
   */
  const questionInlineRef = useRef<HTMLDivElement>(null);
  const [questionInViewport, setQuestionInViewport] = useState(true);

  /**
   * WHERE THE READER WAS, taken the instant before a page is prepended and
   * spent by the layout effect below. A ref rather than state because nothing
   * renders from it and because it has to survive between an async resolution
   * and the very next commit, with no render of its own in between.
   */
  const anchorRef = useRef<{ readonly scrollHeight: number; readonly scrollTop: number } | null>(
    null,
  );
  /**
   * PUT BACK WHERE THEY WERE, AFTER CONTENT WAS ADDED ABOVE THEM.
   *
   * THE DEFECT EVERY INFINITE-SCROLL SHIPS. A scroll offset is measured from
   * the TOP of the content, so inserting anything above the viewport moves
   * everything the reader is looking at down by exactly the height of what was
   * inserted -- mid-sentence, while they read. The fix is arithmetic and it is
   * not optional: remember `scrollHeight` before, and add whatever it grew by
   * to `scrollTop` after.
   *
   * NOT LEFT TO THE BROWSER. Chrome and Safari both implement CSS scroll
   * anchoring, which does exactly this by itself -- except that it is
   * SUPPRESSED WHILE THE SCROLLER IS AT ITS TOP, and the top is the one place
   * this feature is ever used from. Relying on it would mean shipping the bug
   * with a spec citation attached.
   *
   * A LAYOUT EFFECT, so the correction lands in the same frame the turns do:
   * a passive effect would paint the jumped position once and then fix it,
   * which is the flicker rather than the fix. NO DEPENDENCY ARRAY, the same
   * reasoning `scrollToTurnRef`'s effect states below: the instruction is set
   * from an async resolution, and a dependency list would have to name every
   * path that can set a ref.
   *
   * `stuckRef` IS NOT TOUCHED. A reader at the top is by definition not at the
   * bottom, and this correction is what keeps them where they were rather than
   * a navigation of its own.
   */
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (anchor === null) return;
    anchorRef.current = null;
    const box = outRef.current;
    if (box === null) return;
    const grew = box.scrollHeight - anchor.scrollHeight;
    if (grew <= 0) return;
    box.scrollTop = anchor.scrollTop + grew;
    syncJumps(box);
  });

  /**
   * ONE STEP BACK THROUGH THE TRANSCRIPT: the whole of the join, and the only
   * thing that calls the source's pager.
   *
   * ONE WALK AT A TIME, and the guard is a ref rather than `pager.phase`
   * because two scroll events in one frame both read the same pre-render state:
   * a check against rendered state would let both through and fire two requests
   * for the same cursor. The gesture is not DROPPED either -- the walk that is
   * already running is for the same cursor, so a second one would be a second
   * copy of the answer that is already coming.
   *
   * THE CURSOR IS NOT OURS TO INVENT (`cursorToAsk`): the first ask passes the
   * id of the oldest turn on screen, which is the shape PR 283's overlap fix is
   * keyed on, and every ask after that passes back verbatim what the previous
   * page handed over.
   *
   * THE ANSWER MAY BE ABOUT A SESSION THAT IS NO LONGER HERE. A walk can take
   * three reads of up to 8 MiB each; the pane can be moved to another session
   * in that time, and everything below is dropped when it has been -- an answer
   * about the session that was here then says nothing about the one that is
   * here now, the same rule `pressPaneKey` above already keeps for its own
   * refusals.
   */
  const readOlder = () => {
    const sessionId = entry?.session.id;
    if (sessionId === undefined || readHistory === null) return;
    if (readingRef.current !== null) return;
    if (pagerNow.phase === 'start') return;
    const cursor = cursorToAsk(pagerNow.cursor, mergedColumn);
    // Nothing on screen to page before, and no cursor either: there is no
    // question to ask, so no request is made and nothing is drawn as pending.
    if (cursor === null) return;
    readingRef.current = sessionId;
    setPager((now) => ({ ...now, phase: 'reading', error: null }));
    void walkOlder(readHistory, sessionId, cursor).then((walk) => {
      if (readingRef.current === sessionId) readingRef.current = null;
      if (sessionKeyRef.current !== sessionId) return;
      // BEFORE THE STATE THAT ADDS THEM, and this ordering is the anchoring:
      // the offsets have to be the ones from the frame the reader is still
      // looking at, not the ones after React has laid the new turns out.
      const box = outRef.current;
      if (walk.kind === 'page' && walk.turns.length > 0 && box !== null) {
        anchorRef.current = { scrollHeight: box.scrollHeight, scrollTop: box.scrollTop };
      }
      if (walk.kind === 'page' && walk.turns.length > 0) {
        setOlder((held) => appendOlder(held, walk.turns));
      }
      setPager((now) => applyWalk(now, walk));
    });
  };
  /**
   * "Load more when scrolling up" -- the operator's own words, so the scroll IS
   * the gesture and the control below is the second way to ask, not the first.
   *
   * Only while there is genuinely more to ask for: a source with no pager, a
   * proven start and a read that just failed all fall through here, so a reader
   * resting at the top of a column that cannot grow makes no requests at all.
   * A FAILED read in particular is deliberately not retried by scrolling --
   * that would be a retry loop nobody asked for, running as fast as scroll
   * events arrive; the control says the words and waits to be pressed.
   */
  const askIfNearTop = (box: HTMLElement) => {
    if (box.scrollTop > NEAR_TOP_PX) return;
    if (moreState(pagerNow, readHistory) !== 'available') return;
    readOlder();
  };

  /**
   * Images pasted into THIS composition. They are held, not sent: vam's write
   * is text, so only the `[image #N]` placeholder travels (`composer-paste.ts`).
   * The list is dropped when the draft empties, which is what a sent or
   * cleared prompt looks like from here -- the numbering starts over with the
   * composition it counts.
   */
  const [images, setImages] = useState<readonly ComposerImage[]>([]);
  useEffect(() => {
    if (draft === '') setImages([]);
  }, [draft]);

  /** The file waiting in the draft, and the last refusal, if there was one. */
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  /**
   * SPEAKING A PROMPT INSTEAD OF TYPING IT (operator: "add a record feature so
   * a prompt can be spoken, with the icon next to Send").
   *
   * `dictation.ts` wraps the platform's own recogniser -- vam records no audio
   * and sends none; what comes back is text. Three pieces of state, because
   * they answer three different questions: is a recogniser THERE at all (read
   * once, at mount, since a platform does not grow one), is it LISTENING now,
   * and what did it say when it refused.
   */
  const [canDictate] = useState(() => dictationAvailable());
  const [listening, setListening] = useState(false);
  const [dictateError, setDictateError] = useState<string | null>(null);
  const dictation = useRef<DictationHandle | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const toggleDictation = useCallback(() => {
    if (dictation.current !== null) {
      dictation.current.stop();
      dictation.current = null;
      setListening(false);
      return;
    }
    // The last refusal goes when a new attempt starts: a message about a
    // microphone that was denied five minutes ago, sitting under a
    // microphone that is listening now, is the stalest kind of lie.
    setDictateError(null);
    const handle = startDictation({
      onText: (text) => {
        // APPENDED, NEVER SUBSTITUTED. The operator may have typed half a
        // prompt already, and a microphone that clears it is worse than one
        // that does nothing. Read through a ref because the recogniser
        // outlives the render that started it.
        const current = draftRef.current;
        onDraftChange(current === '' ? text : `${current} ${text}`);
      },
      onError: (message) => setDictateError(message),
      onEnd: () => {
        dictation.current = null;
        setListening(false);
      },
    });
    if (handle === null) return;
    dictation.current = handle;
    setListening(true);
  }, [onDraftChange]);
  useEffect(
    () => () => {
      // A pane that unmounts mid-sentence leaves a recogniser holding the
      // microphone otherwise, with nothing left to stop it.
      dictation.current?.stop();
      dictation.current = null;
    },
    [],
  );
  const attachedName = readAttachedName(draft);
  const takeFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    // Cleared immediately, so choosing the same file twice still fires.
    input.value = '';
    if (file === undefined) return;
    // BEFORE THE AWAIT, on the size the picker already handed over: the read
    // that a refusal here prevents is the one that can take the renderer, and
    // the draft, down with it. What survives the decode is bounded by the
    // limit, so it is sub-frame and needs no in-flight indicator of its own.
    const unread = refuseUnreadFile(draft, { name: file.name, size: file.size });
    if (unread !== null) {
      setAttachError(unread);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      // A file removed between the picker and the read, or one the shell
      // cannot open. Uncaught this was an unhandled rejection and a silent
      // paperclip -- the operator's only reading of which is that it worked.
      setAttachError(`${file.name} could not be read — nothing was attached`);
      return;
    }
    const result = attachIntoDraft(draft, { name: file.name, size: file.size, text });
    setAttachError(result.ok ? null : result.message);
    if (result.ok) onDraftChange(result.draft);
  };

  /**
   * The image path last appended, so the chip can be shown and taken back
   * off, mirroring `attachedName` for a text attach. Cleared with the draft,
   * same as `images` above -- an emptied box is what a sent or cleared
   * prompt looks like from here.
   */
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  useEffect(() => {
    if (draft === '') setAttachedImage(null);
  }, [draft]);
  /**
   * WHICH OF THE TOOLS ROW'S POPOVERS IS OPEN -- provider, model or mode --
   * and `null` for none. ONE NAME, NOT THREE BOOLEANS, and that is the fix for
   * a defect the operator reported rather than a tidy-up.
   *
   * Reported: "when I open the auto/manual mode picker, clicking outside or
   * clicking over to the model picker does not close it, so the popovers end
   * up overlapping each other."
   *
   * TWO ROUTES WERE REPORTED AND SIX WERE MEASURED, in Chromium against the
   * shipped bundle before anything here changed. Each popover held its own
   * `useState` boolean and no toggle knew the other two existed, so every
   * ordered pair stacked -- and `provider -> mode` with the model already
   * stuck open put all THREE on screen at once. Patching the reported
   * direction would have left four.
   *
   * SO THE STATE IS THE RULE. "Two of these are open" is no longer a state
   * that exists to be reached: a name can only hold one value, and opening one
   * IS closing the others. Nothing is subscribed to anything, and there is no
   * ordering between three setters to get wrong.
   *
   * Component state, same register as `dismissed`/`pick` below for the bang
   * and slash lists -- a second `DetailPanel` (a split pane, A15.1) gets its
   * own copy, which matters because this is about THIS pane's composer and not
   * a fact about the provider, the model or the mode. In particular it is NOT
   * a copy of the mode: the mode lives in the draft, which is the text that
   * actually gets recorded.
   */
  /**
   * `'phone-overflow'` JOINED THE THREE FOR THE SAME REASON A FOURTH NEVER
   * DID BEFORE IT: it is one more name this one slot can hold, not a second
   * kind of state. The phone composer diet (operator: "model/mode pickers
   * leave the phone composer, reachable from an overflow") pulled the
   * provider/model/mode TOGGLE buttons out of the tools row on phone (see
   * `!phone &&` around each, below) but left their popovers -- the actual
   * listboxes -- exactly where they were, unconditional on `phone`. The "+"
   * button opens this sheet; a row inside it (`data-composer-overflow-model`
   * etc.) opens one of the other three by calling `setOpenPopover` directly,
   * which is a DRILL-DOWN for free: the single-slot rule above already closes
   * whichever popover was open the moment another one is asked for, so
   * tapping "Model" inside the sheet closes the sheet and opens the model
   * listbox in the same breath, with no extra state and no extra dismissal
   * wiring -- the existing outside-pointerdown effect and `dismissPopoverOnEscape`
   * already key off `openPopover` and know nothing else changed.
   */
  type ToolsPopover = 'provider' | 'model' | 'mode' | 'phone-overflow';
  const [openPopover, setOpenPopover] = useState<ToolsPopover | null>(null);
  /** A toggle in one place: the same click that opens closes, as it always did. */
  const togglePopover = (name: ToolsPopover) =>
    setOpenPopover((open) => (open === name ? null : name));
  const providerPickerOpen = openPopover === 'provider';
  const modePickerOpen = openPopover === 'mode';
  const modelPickerOpen = openPopover === 'model';
  const phoneOverflowOpen = openPopover === 'phone-overflow';
  /**
   * AND A POINTER LANDING ANYWHERE ELSE CLOSES IT -- the other half of the
   * report, and the half that had no code at all: nothing anywhere listened
   * for a click outside, so a popover opened by a pointer could be dismissed
   * only by picking a row or by hitting its own toggle again.
   *
   * ON `pointerdown` AND NOT `click`, because the two answer different
   * questions. `click` fires after the button is released and only where press
   * and release landed on the same element, so a press that begins a text
   * selection in the transcript would leave the popover up over the drag. The
   * popover should be gone the moment a pointer goes down somewhere else,
   * which is when the operator has visibly aimed elsewhere.
   *
   * IN THE CAPTURE PHASE, so a handler that stops propagation on its own way
   * up cannot keep this from running -- the transcript's links and the
   * keystroke strip both stop events, and a dismissal that works everywhere
   * except over those would be the same defect in a smaller box.
   *
   * THE BOUNDARY IS THE OPEN POPOVER'S OWN ROOT, marked `data-popover-root`:
   * the wrapper that holds a toggle and its layer. Inside it -- the toggle,
   * the listbox, the free-text field -- nothing is dismissed here (the
   * toggle's own click still closes it, and typing in the field must not).
   * Outside it, including on a PEER's toggle, the layer goes: the peer's own
   * click then opens its own, which is the reported route, arriving closed.
   *
   * Only while something is open: no listener sits on the document at rest.
   */
  useEffect(() => {
    if (openPopover === null) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(`[data-popover-root="${openPopover}"]`) !== null
      ) {
        return;
      }
      setOpenPopover(null);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [openPopover]);
  /**
   * WHICH OF THE THREE FACES THE MODEL CONTROL WEARS for the focused session.
   * `model-command.ts` carries the table and the argument; this reads it
   * off the same three facts the rest of the composer reads: the source's
   * `deliverPrompt` (`delivers`), its `terminal` capability, and whether vam
   * started this session (`vamControlled` -- the two halves of `canCycleMode`).
   */
  const modelControl = modelControlState({
    delivers,
    terminal,
    /**
     * THE TWO CLAIMS `vamControlled` USED TO BE ONE BOOLEAN FOR, and this is
     * the site that wanted the FIRST of them.
     *
     * "vam started this session and holds its pane" is what drives the CLI's
     * own `/model` menu; "vam can reach this session" is a different fact, and
     * it lives in `delivers` above. The two were the same for as long as vam
     * had one source, because Claude Code's pane IS its channel -- so nothing
     * ever forced them apart. Codex is the case that does: vam did not start
     * the thread and can still queue for it, so this is false while `delivers`
     * is true, and the control lands on `disabled` with the model still shown
     * beside it.
     */
    vamControlled: entry?.session.vamControlled,
  });
  /**
   * THE MODEL THE ROW'S OWN SOURCE RECORDED, for the disabled control below.
   *
   * ABSENT IS NOT NULL HERE EITHER: a source that keeps no such fact leaves
   * the field off entirely and the control wears the word it has always worn.
   * See `Session.model`.
   */
  const recordedModel = entry?.session.model ?? null;
  /**
   * The mode ON SCREEN, read back out of the draft on every render. A draft
   * carrying some other word on its `mode:` line reads as the default: only
   * these three can be picked here, and an icon has no way to draw a fourth.
   */
  const currentMode: Mode = MODES.find((mode) => mode === readModeRequest(draft)) ?? DEFAULT_MODE;
  const currentProvider = resolveProvider(defaultProvider);
  const pickImage = async () => {
    if (pickImageAttachment === undefined || entry === null) return;
    let path: string | null;
    try {
      path = await pickImageAttachment(entry.session.id);
    } catch (error) {
      // Refused BEFORE anything was sent: outside the session's own
      // directory, or content that is not really an image
      // (`main/dialog/attach-image.ts`). Nothing here changes the draft.
      setAttachError(describeFailure(error));
      return;
    }
    if (path === null) return; // Cancelled -- one of two normal answers.
    setAttachError(null);
    setAttachedImage(path);
    onDraftChange(appendImagePath(draft, path));
  };

  // Grow with the text instead of scrolling a one-line slot. Measured from the
  // content each time: shrinking needs the reset to `auto` first, or the box
  // only ever gets taller. The cap lives in the class list, not here.
  //
  // THIS IS ALSO THE PHONE COMPOSER'S OWN GROWTH NOW, and it did not used to
  // be: phone wore `field-sizing: content` (`data-prompt-box`'s own comment
  // used to explain it), which -- per spec -- has the UA size the box off its
  // OWN intrinsic content, ignoring an author-set `height` such as the one
  // this effect writes; the two mechanisms were both running, and only the
  // native one was ever visible. Verified by hand, in real Chromium:
  // `field-sizing: content` computes an EMPTY, single-row textarea's own
  // intrinsic content height at ~60px (three lines' worth at the phone's
  // forced 16px/20px font/line-height) regardless of `rows` or removing the
  // attribute entirely, while `field-sizing: fixed` (the property's own
  // default -- what phone is left with now) with the identical `rows={1}`
  // measures 44px, the `vam-tap` floor, for the same box
  // (`e2e/phone-question-shots.mjs` holds the real-browser figures). The
  // 16-19px this closed was that property's own sizing algorithm for an
  // EMPTY box, not padding, a control, or a border this file could still
  // trim -- and closing it needed exactly the JS resize handler this effect
  // already was, not a second one kept in step with it.
  useEffect(() => {
    const box = inputRef.current;
    if (box === null) return;
    box.style.height = 'auto';
    // An empty box returns to its `rows` height, not to one line's worth:
    // `auto` on a textarea is the placeholder's two lines (desktop) or one
    // (phone), `scrollHeight` is the content's, and with no content those
    // are not the same number.
    if (draft !== '') {
      box.style.height = `${box.scrollHeight}px`;
    }
  }, [draft]);

  /**
   * THE DOCUMENT IS THE SESSION NOW, not the turn.
   *
   * This key used to carry the focused turn's id as well, because the pane
   * drew one turn at a time and moving between them genuinely was moving
   * between documents. The column draws them all, so a different turn is a
   * different PLACE in one document -- and keeping the id here would have
   * yanked the column back to its bottom every time a poll produced a new
   * newest turn, which is the very thing `focusNodeId` exists to prevent.
   * Where to scroll for a turn is `scrollToTurnRef`'s job, below.
   */
  const focusKey = entry?.session.id ?? '';
  const focusRef = useRef(focusKey);
  /**
   * The change SIGNAL for "the column grew", not something the effect reads.
   * Two halves: the newest turn's answer (a streaming session rewrites it
   * every second or so) and how many turns there are (a new turn appended).
   * Dropping either would leave a column that was resting at its bottom
   * showing the old bottom.
   */
  const newestTurn = entry?.session.decisions[0] ?? null;
  const output = newestTurn?.output ?? null;
  const turnCount = entry?.session.decisions.length ?? 0;
  /**
   * WHICH TURN IS THE LIVE ONE. `decisions` is newest first (model.ts), so the
   * newest is the turn a session is working on -- the only one a "what it is
   * doing now" caption can honestly describe. An id rather than a boolean now
   * that every turn is drawn: each block is told whether it is this one.
   * Declared here, above the two effects that read it, rather than beside the
   * rest of the turn derivations below.
   */
  const newestId = newestTurn?.id ?? null;
  /**
   * Whether the session is still working. The other half of "live" -- being
   * the newest turn -- is decided per block, against `newestId`.
   */
  const sessionRunning = entry?.session.status === 'running';
  /**
   * ESCAPE IN THE COMPOSER, WHICH NOW INTERRUPTS THE AGENT.
   *
   * Operator request, and Claude Code's own default: Escape cancels the
   * running prompt. Nothing new is being built to do it -- `pressPaneKey`
   * already presses a key into this session's pane for the mode row and for
   * every button of the phone keystroke strip, with one in-flight guard and
   * one refusal caption, and `{kind:'escape'}` is a key the strip already
   * sends (`TerminalTab`: "inside tmux, Escape should do what Escape does").
   *
   * THREE OUTCOMES, THREE SENTENCES, and that is the whole of the reasoning
   * here. "vam pressed Escape in the pane", "there is nothing running to
   * interrupt" and "vam has no keyboard into this session at all" are
   * different facts about different things, and folding any two of them into
   * one line is this pane's oldest defect (`sources/pull-requests.ts`: "'No
   * PRs' and 'vam could not ask' must never look the same"). NONE of them may
   * be silence: the operator pressed a key expecting an agent to stop.
   *
   * The two halves of `canCycleMode` are separated here rather than reported
   * together, because they send the operator to different places: a source
   * with no terminal has nothing to interrupt anywhere, and a session vam did
   * not start has a terminal that belongs to somebody else.
   */
  /**
   * A DIALOG TAKES ESCAPE BEFORE THE AGENT DOES -- Claude Code's own rule
   * ("Interrupt Claude, or close a dialog ... When a dialog is open, `Esc`
   * closes the dialog"), and the one this composer now has to keep in three
   * places rather than one.
   *
   * Returns whether it CLOSED something, so every caller can answer the same
   * question the same way. The two typeahead lists answer Escape earlier in
   * the box's own handler, where they already own the arrow keys; these three
   * popovers (provider, mode, model) are opened by a POINTER, which leaves the
   * keyboard on a button rather than in the textarea, so they need the answer
   * from there as well.
   *
   * Before this they closed only by picking a row or re-clicking their own
   * toggle. That was survivable while Escape merely left the box; it is not
   * now, because an Escape that reaches past an open popover stops an agent.
   *
   * ONE NAME MAKES THIS ONE LINE. It used to clear three booleans in a row,
   * which is three chances to add a fourth popover and forget one; `null` is
   * now the whole of "none of them".
   */
  const closeOpenPopover = (): boolean => {
    if (openPopover === null) return false;
    setOpenPopover(null);
    return true;
  };
  /**
   * Escape on a popover's own widgets -- its TOGGLE and its LISTBOX, which are
   * the two elements the keyboard can actually be on once a pointer opened it.
   *
   * On those two rather than on the wrapper around them, and that is an a11y
   * rule rather than a style: a `div` carrying a key handler and no role is a
   * control a screen reader cannot find (`noStaticElementInteractions`). Both
   * of these already ARE controls -- a `button` and a `role="listbox"`.
   *
   * `stopPropagation` so the shell's own Escape does not peel a second layer
   * on the same keystroke: one Escape, one dismissal, which is the rule
   * `Canvas`'s `cancel` case states for every other overlay in the app.
   */
  const dismissPopoverOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    if (!closeOpenPopover()) return;
    event.preventDefault();
    event.stopPropagation();
  };
  /**
   * WHY AN INTERRUPT WOULD BE REFUSED, or `null` when it would not.
   *
   * The three refusals were inline in `interruptRun` until the right-click
   * menu needed them BEFORE the click: a menu item can say "vam did not start
   * this session" while it is still disabled, which is the one thing a
   * keystroke cannot do. Derived here so both routes read the same three
   * conditions in the same order -- two copies of this would be two answers to
   * "can vam stop it", and the pane's oldest defect is two different facts
   * that look the same.
   */
  const interruptRefusal: string | null =
    terminal === false
      ? 'not sent — this source has no session terminal to interrupt'
      : entry === null || entry.session.vamControlled !== true
        ? 'not sent — vam did not start this session, so it has no keyboard into it'
        : !sessionRunning
          ? 'nothing running to interrupt — this session is not working'
          : null;

  const interruptRun = () => {
    if (interruptRefusal !== null) {
      setCycleNote({ kind: 'refused', text: interruptRefusal });
      return;
    }
    // SENT, NOT CANCELLED. vam presses the key and never reads back what the
    // agent did with it, exactly as the mode cycle never reads the mode back;
    // claiming the run stopped would be a claim nothing checked.
    void pressPaneKey(
      { kind: 'escape' },
      'Esc sent — vam does not read back what it interrupted',
      'Esc · sending…',
    );
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: stick again on new output
  useEffect(() => {
    const box = outRef.current;
    const focusChanged = focusRef.current !== focusKey;
    focusRef.current = focusKey;
    if (box === null) return;
    if (!shouldStick({ stuck: stuckRef.current, focusChanged })) {
      syncJumps(box);
      return;
    }
    box.scrollTop = box.scrollHeight;
    stuckRef.current = true;
    syncJumps(box);
  }, [focusKey, output, turnCount]);

  /**
   * KEEP THE BOTTOM WHEN THE PANE'S OWN FURNITURE MOVES.
   *
   * MEASURED ON THIS HEAD, and the reason this exists: opening `factory-sse-1`
   * in the demo left the column resting at scrollTop 431 of 520 -- 89px short
   * of its own end -- every single time. The effect above does stick it, and
   * correctly; what happens next is that the pane's PROMPT POLL resolves, a
   * question card appears below the column and the composer withdraws, and the
   * column's own height drops by 89px. Its content did not change, so nothing
   * in the dependency list above changed, and the scroller was simply left 89px
   * up a transcript it had just been told to show the end of. The single-turn
   * pane had the same hole and it did not show: one turn rarely overflowed.
   *
   * A ResizeObserver ON THE SCROLLER, because the fact that changed is the
   * scroller's own size -- not its content, which the effect above already
   * watches. Together they cover both halves of "stuck": the content grew, and
   * the window onto it shrank. Guarded on `stuck`, so it can only ever act for
   * a reader who was at the bottom already; a reader who scrolled up is left
   * exactly where they were, which is the whole rule this pane keeps.
   *
   * Re-attached when the column comes and goes -- another tab, an empty
   * session -- because that is when the element behind `outRef` changes.
   * `typeof` guarded for happy-dom, where the unit suite runs.
   */
  const columnMounted = current === 'Response' && turnCount > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `syncJumps` is a fresh closure every render, so listing it would tear down and re-attach the observer on every keystroke in the composer -- it only ever calls `setJumps`, which is stable
  useEffect(() => {
    const box = outRef.current;
    if (box === null || !columnMounted) return;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!stuckRef.current) {
        syncJumps(box);
        return;
      }
      box.scrollTop = box.scrollHeight;
      syncJumps(box);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [columnMounted]);

  /**
   * TAKE THE COLUMN TO A PICKED TURN — the one-shot instruction
   * `scrollToTurnRef` carries, consumed here.
   *
   * A LAYOUT effect, not a passive one: the turn is scrolled to in the same
   * frame it was picked in, so nothing paints at the old offset first.
   *
   * NO DEPENDENCY ARRAY on purpose. The instruction is set during render (a
   * canvas navigation) and from an event handler (a pick), and both are
   * followed by a render; a dependency list would have to name every path
   * that can set a ref, which is the list that goes stale. The body reads one
   * ref and returns, so running it after every render costs nothing.
   *
   * MEASURED AGAINST THE COLUMN, not `scrollIntoView`: that would scroll every
   * scrollable ancestor, including the page, to bring a turn into view inside
   * a pane that was already showing. The delta between the two boxes moves
   * exactly one scroller, which is the one this is about.
   */
  useLayoutEffect(() => {
    const want = scrollToTurnRef.current;
    if (want === null) return;
    scrollToTurnRef.current = null;
    const box = outRef.current;
    if (box === null) return;
    /**
     * THE NEWEST TURN IS THE BOTTOM, and asking for it means asking for the
     * end of the transcript.
     *
     * MEASURED, not anticipated: the canvas's default pick is `decisions[0]`,
     * so opening a session emits a navigation to the NEWEST turn one render
     * after the session key changed. Aligning that turn's top edge undid the
     * stick-to-bottom that had just run -- the column opened at scrollTop 431
     * of 520, showing the newest prompt with its own answer cut off below the
     * fold, on every single open. Its top edge is not where anyone wants to
     * be for the turn that is still being written; its end is.
     */
    if (want === newestId) {
      box.scrollTop = box.scrollHeight;
      stuckRef.current = true;
      syncJumps(box);
      return;
    }
    const target = [...box.querySelectorAll('[data-column-turn]')].find(
      (el) => el.getAttribute('data-column-turn') === want,
    );
    // A turn that is not mounted is not an error here: `selectedTurnMissing`
    // is what says so on screen, and silently scrolling somewhere else would
    // be the substitution that whole mechanism refuses.
    if (target === undefined) return;
    box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top;
    // Landing anywhere but the bottom is letting go of it -- done here rather
    // than left to the scroll event, because new output arriving before that
    // event lands would otherwise find `stuck` still true and yank the column
    // straight back down over the turn just asked for.
    stuckRef.current = isAtBottom(box);
    syncJumps(box);
  });

  // THE WHOLE COLUMN, not the focused turn -- see `commandsInColumn` for why
  // the narrower source made the feature look absent.
  const commands = commandsInColumn(decision, mergedColumn);
  const slashCommands = entry?.session.slashCommands ?? [];
  /**
   * The typeaheads' shared state. `caret` is read off the box on every
   * change rather than mirrored from the draft. `!` and `/` share `pick` and
   * `dismissed` rather than each carrying their own -- only one list can be
   * open at a time (`slashCommandQuery`'s comment says why).
   */
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [pick, setPick] = useState(0);
  const query = composing ? bangQuery(draft, caret) : null;
  const allMatches = query === null ? [] : matchCommands(commands, query);
  // CROPPED FOR THE BOX, COUNTED ON IT. `bangHidden` is what the popover says
  // out loud; a list cut to fit with no sign of the cut would teach the
  // operator that what they can see is all the session proposed.
  const matches = allMatches.slice(0, MAX_BANG_ROWS);
  const bangHidden = allMatches.length - matches.length;
  // Closed when nothing matches. A list that stayed to say "no matches" is a
  // stale box over the composer; its absence already says it.
  const suggesting = !dismissed && matches.length > 0;
  const picked = Math.min(pick, matches.length - 1);
  const acceptSuggestion = (command: Command) => {
    const next = applyBang(draft, caret, command.command);
    onDraftChange(next.text);
    setCaret(next.caret);
    setDismissed(true);
  };
  const slashQuery = composing ? slashCommandQuery(draft, caret) : null;
  const allSlashMatches = slashQuery === null ? [] : matchSlashCommands(slashCommands, slashQuery);
  // Capped and counted, for `bangHidden`'s reason -- and this list needs it
  // more: the provider's own is fifty-odd commands long.
  const slashMatches = allSlashMatches.slice(0, MAX_BANG_ROWS);
  const slashHidden = allSlashMatches.length - slashMatches.length;
  const slashSuggesting = !dismissed && slashMatches.length > 0;
  const slashPicked = Math.min(pick, slashMatches.length - 1);
  /**
   * WHY THE `/` LIST IS SHORT OF THE PROVIDER'S OWN, when the source knows.
   *
   * THE TWO UNKNOWNS, AND THIS IS WHERE THEY ARE KEPT APART. `slashCommands`
   * has tiers that fail differently (`model.ts`): the ones made of files are
   * silent because a directory that is not there means the operator wrote no
   * commands, but the BUILT-INS are asked of the installed CLI and that
   * question can genuinely fail. A list fifty entries short with nothing said
   * about it is "vam could not read the commands" wearing "no commands match"'s
   * clothes -- `pull-requests.ts` states the rule this serves.
   *
   * DRAWN WHENEVER THE `/` LIST IS BEING ASKED FOR, whether or not anything
   * matched, and it is the second case that decides the shape: a query that
   * finds nothing closes the list, so a note attached only to the list would
   * vanish exactly when the operator most needs to know that the list they are
   * typing into is not the whole one.
   */
  const slashGapNote =
    !dismissed && slashQuery !== null ? (entry?.session.slashCommandGap ?? null) : null;
  const acceptSlashSuggestion = (command: SlashCommand) => {
    const next = applySlashCommand(draft, caret, command.name);
    onDraftChange(next.text);
    setCaret(next.caret);
    setDismissed(true);
  };
  /**
   * HOW TALL A LAYER FLOATING ABOVE THE COMPOSER IS ALLOWED TO BE, measured
   * rather than assumed -- see `SUGGEST_BOX`'s own comment for why it is
   * applied to each BOX and not to the layer itself.
   *
   * ONE MEASUREMENT FOR EVERY COMPOSER POPOVER, not one per popover. It used
   * to be taken off `suggestLayerRef`'s own `.bottom` -- correct only because
   * `bottom-full` pins that layer's bottom edge to `data-composer-bar`'s top,
   * so the two numbers were always equal and `composerBarRef.top` says the
   * same thing without requiring the SUGGEST layer to be the one open. That
   * substitution is what let `provider`/`model`/`mode` join this cap: three
   * `absolute bottom-full` popovers that used to anchor to their OWN small
   * toggle -- a wrapper sitting in `data-prompt-tools`, directly under the
   * textarea with only a `gap-2.5` between them -- and grew upward into
   * exactly the box they hang off (`src/shared/providers.ts`'s own
   * measurement: "99x34 overlapping the textarea by 28px"). Un-anchoring
   * their wrapper's own `position: relative` (search `data-popover-root`
   * below) lets their `absolute` resolve against `data-composer-bar`
   * instead, the same ancestor `SUGGEST_LAYER` already floats against.
   *
   * `null` while nothing is open, which draws no `style` at all and costs the
   * common case (no popover) nothing.
   */
  const composerBarRef = useRef<HTMLDivElement>(null);
  const [suggestMaxHeight, setSuggestMaxHeight] = useState<number | null>(null);
  const suggestOpen = suggesting || slashSuggesting || slashGapNote !== null;
  const composerPopoverOpen =
    suggestOpen || providerPickerOpen || modelPickerOpen || modePickerOpen;
  useLayoutEffect(() => {
    if (!composerPopoverOpen) {
      setSuggestMaxHeight(null);
      return;
    }
    const bar = composerBarRef.current;
    if (bar === null) return;
    const measure = () => {
      // The composer bar's own TOP, not a floating layer's bottom: every
      // popover this cap serves is pinned there by `bottom-full`, whether or
      // not the suggest layer itself is the one currently open.
      const top = bar.getBoundingClientRect().top;
      const next = Math.max(0, top - SUGGEST_EDGE_GUTTER);
      // Only a real move, for `proseAdvance`'s own reason above: the initial
      // call and a resize handler can both land on the same number, and an
      // identical value written back is a render for nothing.
      setSuggestMaxHeight((previous) => (previous === next ? previous : next));
    };
    measure();
    globalThis.addEventListener('resize', measure);
    return () => globalThis.removeEventListener('resize', measure);
  }, [composerPopoverOpen]);
  /**
   * The question the card draws: the newest OPEN one, and only if there is
   * none, the newest answered one -- what is still being asked outranks what
   * was already settled, and an absent list (a source with no such surface)
   * reads exactly like an empty one, which is no card at all.
   */
  const questions = entry?.session.questions ?? [];
  /**
   * WHAT THE SESSION ITSELF SAYS IT IS BLOCKED ON, which is a different fact
   * from `questions` and mostly a disjoint one: a tool-approval prompt writes
   * no transcript record, so the surface that names it is the session's own
   * per-process file and there is never a question to go with it. ABSENT --
   * not null -- is "nothing says anyone is waiting"; see `model.ts`.
   */
  const waitingFor =
    entry === null || !('waitingFor' in entry.session)
      ? undefined
      : (entry.session.waitingFor ?? null);
  /**
   * The cause COLLAPSED TO WORDS OR NOTHING, for the one place that prints it.
   *
   * The three states above are what the model owes a reader; a line of text
   * can only draw one of them. Absent and null both come out as nothing here,
   * and deliberately the same nothing: "no surface reports a wait" and
   * "waiting, cause unnamed" differ in what vam KNOWS, not in anything it
   * could honestly write on that row. Inventing a word for the second -- a
   * "waiting" or an "unknown" -- would put a cause on screen that no session
   * ever reported, which is the one failure this field cannot afford.
   */
  const waitingCause = typeof waitingFor === 'string' && waitingFor !== '' ? waitingFor : null;
  /**
   * THE SET, not the question. One `AskUserQuestion` call can carry several,
   * and drawing the newest open one put question TWO of a two-question call on
   * screen with question one nowhere (`panels/question-set.ts`).
   */
  const recorded = newestSet(questions);
  /**
   * THE PROMPT ON THE PANE, for the shapes that leave no record.
   *
   * READ ONLY FOR A SESSION VAM STARTED, and `=== true` rather than truthy
   * because `vamControlled` is three-state: absent means control could not be
   * established, which is not permission. So for every other row nothing is
   * read at all -- vam does not look into a pane it may not act in -- and the
   * waiting note above stays the whole of what is offered.
   */
  const readable =
    prompt !== undefined &&
    entry !== null &&
    waitingFor !== undefined &&
    recorded.length === 0 &&
    entry.session.vamControlled === true;
  const [paneAsk, setPaneAsk] = useState<PanePrompt | null>(null);
  const projectId = entry?.project.id ?? '';
  const rowId = entry?.session.id ?? '';
  /** Bumped on every call and in the reset effect's own cleanup, below --
   *  `useSourceModel`'s own `issued`/`seq` idiom, replacing the per-effect
   *  `live` closure a hook-managed poll can no longer hold onto: only the
   *  most recently ISSUED read may write, which matters once
   *  `useVisibilityInterval` can release a burst of queued ticks on return
   *  from a hidden window. */
  const promptGeneration = useRef(0);
  /** True while THIS effect's own previous run was already polling --
   *  see this ref's twin (`wasModelReadable`) below for why an "already
   *  polling, just a different row" transition needs its own immediate
   *  ask instead of `useVisibilityInterval`'s. */
  const wasPromptReadable = useRef(false);
  const lookPrompt = useCallback(async () => {
    if (!readable || prompt === undefined) return;
    promptGeneration.current += 1;
    const mine = promptGeneration.current;
    const view = await prompt(projectId, rowId);
    if (mine !== promptGeneration.current) return;
    // ONLY A PROMPT IS DRAWN. Every other answer -- no picker, an
    // unreadable pane, a pairing vam refused -- leaves the card absent and
    // the waiting note standing, which already names the reach state. A
    // card built out of a refusal would be a control that cannot act.
    setPaneAsk(view.kind === 'prompt' ? view.prompt : null);
  }, [readable, prompt, projectId, rowId]);
  useEffect(() => {
    if (!readable || prompt === undefined) {
      setPaneAsk(null);
      wasPromptReadable.current = false;
      return;
    }
    // NEW ROW, NEW SCREEN: asked once right away, same as before this was
    // split out of one effect -- the cadence below is the RECURRING half.
    // SKIPPED on the very first tick this becomes readable at all:
    // `useVisibilityInterval`'s own OFF -> ON immediate call already covers
    // that edge, and asking twice would be a second, needless read of the
    // same pane. `wasPromptReadable` is what tells the two edges apart.
    if (wasPromptReadable.current) void lookPrompt();
    wasPromptReadable.current = true;
    return () => {
      promptGeneration.current += 1;
    };
    // `projectId`/`rowId` are not read directly here -- `lookPrompt` already
    // carries them, and its own identity is what re-runs this effect.
  }, [readable, prompt, lookPrompt]);
  // The prompt is a SCREEN, not a record: it appears and disappears without
  // anything telling vam, so it is re-read while the row is waiting --
  // paused outright while the window is hidden (`hidden: 'pause'`), since
  // nothing downstream of this card depends on it the way
  // `notify/waiting.ts` depends on `useSourceModel`; resumed with one
  // immediate tick, same as `TerminalTab`'s own refresh.
  useVisibilityInterval(
    readable && prompt !== undefined,
    PROMPT_POLL_MS,
    'pause',
    () => void lookPrompt(),
  );
  /**
   * WHICH MODEL THIS SESSION IS RUNNING -- the name the CLI paints on its own
   * status line, read back out of the pane, or `null` for "vam cannot tell".
   *
   * THE FACT IS READ, NEVER REMEMBERED, and that is the whole design. vam
   * drives the CLI's own `/model` menu and reads no answer line afterwards:
   * the operator can type their own `/model` there, a resumed session was set
   * by somebody else, and the CLI can refuse. So the button below shows what
   * the pane SAYS, and the two things it must never show are a name from a
   * switch vam asked for and a name read from another row.
   *
   * ASKED ONLY WHERE THE PICKER IS DRAWN, which is `delivers` and a pane vam
   * owns (`modelControlState`). On every other row vam does not look into a
   * pane it may not act in -- the same rule the prompt read above keeps -- and
   * the disabled button keeps its old word.
   *
   * READ ON THE ROW, ON AN INTERVAL, AND ON DEMAND. The row because a new
   * session is a new pane; the interval because the operator can switch the
   * model in their own terminal and because the status line is hidden behind
   * every open question, so a single read would leave the button unlabelled
   * until the row changed; on demand because a `/model` line vam has just
   * typed is the one moment the answer is known to be about to change.
   *
   * THE ON-DEMAND ROUTE IS A REF AND NOT A DEPENDENCY, which is `TerminalTab`'s
   * own arrangement (`readNow`): the poll publishes its reader while it is
   * running and takes it back when it stops, so nothing outside can ask a read
   * of a row that is no longer being polled -- and the effect keeps the
   * dependencies it actually reads.
   */
  const [running, setRunning] = useState<RunningModel | null>(null);
  /** Published only while the poll below is live; see `sendModel`. */
  const lookForModel = useRef<(() => void) | null>(null);
  const modelReadable = modelControl === 'picker' && model !== undefined;
  /** True while THIS effect's own previous run was already polling -- see
   *  its use below for why an "already polling, just a different row"
   *  transition needs its own immediate ask instead of
   *  `useVisibilityInterval`'s (which only fires on OFF -> ON). */
  const wasModelReadable = useRef(false);
  /**
   * WHICH READ'S ANSWER IS STILL WANTED. Bumped on every call, so two reads
   * in flight at once -- a hidden window's throttled interval releases a
   * burst when it comes back -- can never have an older one answering last
   * paint a model the session had seconds ago. `TerminalTab`'s own poll
   * makes exactly this argument; only the most recently ISSUED read may
   * write. Also bumped by the reset effect's own cleanup below, so a read
   * left over from the PREVIOUS row cannot land under this one's title
   * either -- the `live` closure this replaces covered both cases at once;
   * a hook-managed poll can no longer hold one open across ticks.
   */
  const modelGeneration = useRef(0);
  const lookModel = useCallback(async () => {
    if (!modelReadable || model === undefined) return;
    modelGeneration.current += 1;
    const mine = modelGeneration.current;
    const view = await model(projectId, rowId);
    if (mine !== modelGeneration.current) return;
    // `unknown` IS THE FALLBACK AND NOT A HOLD. Every reason vam could not
    // tell -- a question over the status line, a cut pane, a pairing it
    // refused, AND a transcript with no answered turn in it -- lands on the
    // word the button wore before, because the one thing worse than an
    // unlabelled button is a label that has quietly stopped being true.
    //
    // AND THE ARM IS KEPT, not flattened to the name. `model` came off the
    // CLI's painted footer and `last-turn` out of the session's transcript;
    // both put the same word on the button, and only one of them can be
    // called "running" in the words around it (`modelRunningClause`).
    setRunning(view.kind === 'unknown' ? null : view);
  }, [modelReadable, model, projectId, rowId]);
  useEffect(() => {
    if (!modelReadable || model === undefined) {
      // A row change lands here first, and this line is what stops the last
      // session's model being drawn under this one's title for one frame.
      setRunning(null);
      lookForModel.current = null;
      wasModelReadable.current = false;
      return;
    }
    lookForModel.current = () => void lookModel();
    // SKIPPED on the very first tick this becomes readable at all --
    // `useVisibilityInterval`'s own OFF -> ON immediate call already covers
    // that edge; asking twice would be a second, needless tmux read.
    if (wasModelReadable.current) void lookModel();
    wasModelReadable.current = true;
    return () => {
      lookForModel.current = null;
      modelGeneration.current += 1;
    };
    // `projectId`/`rowId` are not read directly here -- `lookModel` already
    // carries them, and its own identity is what re-runs this effect.
  }, [modelReadable, model, lookModel]);
  // READ ON THE ROW, ON THE INTERVAL, AND ON DEMAND -- see this control's own
  // header above. Paused outright while the window is hidden (`hidden:
  // 'pause'`): nothing downstream of this button depends on it the way
  // `notify/waiting.ts` depends on `useSourceModel`, and it resumes with one
  // immediate tick the moment the window is visible again.
  useVisibilityInterval(modelReadable, MODEL_POLL_MS, 'pause', () => void lookModel());
  /**
   * The rows the answer marks; two when the name cannot separate them.
   *
   * BY NAME, AND THEREFORE THE SAME FOR BOTH SOURCES. A transcript-sourced
   * name arrives already in the footer's own shape (`displayModelName`), so
   * the tick is the same machinery on either -- and a tick that disagreed with
   * the label beside it would be worse than a tick that lags with it. What the
   * lag means is carried in the words, where it can be said.
   */
  const runningRows = runningModelRows(running?.name ?? null);
  /**
   * THE RECORD WINS. A transcript question carries the tool's own
   * `multiSelect`, its descriptions and its previews; a screen carries none of
   * those. The pane read is the fallback for the shapes that have no record,
   * never a second opinion about one that does.
   */
  const newestQuestions: readonly AgentQuestion[] =
    recorded.length > 0 || paneAsk === null
      ? recorded
      : [
          {
            // Keyed by the row and the title so a NEW prompt remounts the
            // card: an option marked on the last one must not survive into
            // the next, which is a different decision entirely.
            id: `pane:${rowId}:${paneAsk.title}`,
            header: null,
            question: paneAsk.title,
            // Single-select, because that is what the CLI draws for these and
            // vam may not infer otherwise: a wrong multiSelect would tick a
            // row where it meant to answer.
            multiSelect: false,
            options: paneAsk.options.map((label) => ({ label, description: null })),
            answer: null,
          },
        ];
  const newestQuestion = newestQuestions[0] ?? null;
  /* FOUR THINGS HAVE TO BE TRUE before a Submit is drawn: the source really
     delivers prompts, the shell really has the bridge (there is none in the
     browser build), there is a row to aim at, and VAM STARTED THAT ROW'S
     SESSION. The fourth is the same test the mode row makes (`canCycleMode`)
     and for the same reason: vam can press a key only in a pane it started,
     because no process may take over another's controlling TTY. A focused
     row is not an aimable pane, so `entry !== null` was drawing an enabled
     Submit over the operator's own terminal that could only ever come back
     refused. Any of the four missing draws no button rather than one that
     would refuse -- see `QuestionCard`. */
  const questionOnAnswer =
    delivers === true &&
    answer !== undefined &&
    entry !== null &&
    entry.session.vamControlled === true
      ? (request: AnswerRequest) => answer(entry.project.id, request, entry.session.id)
      : null;
  /** The card is keyed by the CALL, so walking its steps does not remount it. */
  const setId = newestQuestion === null ? '' : toolUseOf(newestQuestion.id);
  /**
   * While a question is open the options are the interaction, so the composer
   * stands down: an operator was reading a list of choices above a box that
   * cannot answer them. "Chat about this" is the way back, per question — the
   * id is the reset, so the next question opens as a picker again rather than
   * inheriting the last one's answer.
   *
   * Nothing is stranded by the absence. `i` already prefers the first option
   * over the box when a question is open, `I` + Enter sets `composing`, which
   * lands in the same place, and Esc still does the one thing it did.
   */
  const openQuestion = newestQuestions.some((one) => one.answer === null);
  /** How many of the newest call's steps are still open -- what the phone's
   *  "jump to question" pill counts (below). `QuestionCard`'s own `pending`
   *  is the SAME filter, scoped inside that component where its Submit copy
   *  reads it; this is the one outside reader. */
  const openStepCount = newestQuestions.filter((one) => one.answer === null).length;
  /**
   * DEVIATION, approved (docs/design/phone-core-loop.md §3.2, §3.7 PR4). The
   * inline question reintroduces the classic chat-app problem the FIXED card
   * never had: it can scroll out of view while the operator reads older
   * history above it. `questionInlineRef` (declared with `outRef`, above)
   * marks the mounted card; `outRef` is the scroller it can leave. `true`
   * (visible) at rest, so a phone with no open question never renders the
   * pill this drives -- this effect only runs while there is a card to
   * watch.
   */
  useEffect(() => {
    const root = outRef.current;
    const target = questionInlineRef.current;
    if (!phone || !openQuestion || root === null || target === null) {
      setQuestionInViewport(true);
      return;
    }
    // A fresh observer per (root, target) pair rather than one long-lived
    // instance re-pointed at a new target: `IntersectionObserver.observe`
    // does not forget a PREVIOUS target on a second call, so re-observing
    // would accumulate one stale callback per question the operator has
    // answered this session.
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry !== undefined) setQuestionInViewport(entry.isIntersecting);
      },
      // `root`: the SCROLLER, not the viewport -- the default target for a
      // plain `IntersectionObserver` is the browser viewport, which this
      // element never leaves (it is `position: sticky` inside a pane that
      // itself never scrolls the WINDOW). What it leaves is `outRef`'s own
      // scrolled content, so that is what has to be the root.
      { root, threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [phone, openQuestion]);
  // See `onQuestionOpenChange`'s own doc: this is the one route a re-hosting
  // shell (`PhoneShell`) has to this fact, which is derived here and nowhere
  // else. Fires on every value change, including a session switch (`entry`
  // changing changes `newestQuestions`, which changes this).
  useEffect(() => {
    onQuestionOpenChange?.(openQuestion);
  }, [openQuestion, onQuestionOpenChange]);
  const [chattingAbout, setChattingAbout] = useState<string | null>(null);
  /** What `QuestionCard` says the open step would answer with -- see `onSuggest`. */
  const [suggestion, setSuggestion] = useState<string | null>(null);
  /**
   * THE OFFER STANDING IN THE PROMPT BOX, and the whole condition under which
   * the box takes `Tab` at all.
   *
   * Operator request: the prompt input should follow the suggestion, and Tab
   * should accept it -- the shell's inline completion, one key for a routine
   * reply. Two things decide the shape of it:
   *
   *  - AN EMPTY DRAFT ONLY. A ghost over text the operator typed would either
   *    hide it or fight it, and a Tab that overwrote a half-written reply is a
   *    worse trade than the key it saves.
   *  - `Tab` IS HOW A KEYBOARD LEAVES A TEXTAREA (see the box's own key
   *    handler). Taking it unconditionally makes this box a trap for anyone
   *    navigating without a mouse, so it is taken ONLY while this is non-null
   *    -- which also makes the binding self-explaining: Tab does something
   *    extra exactly when the placeholder says there is something to accept.
   *
   * Accepting writes the DRAFT and delivers nothing. Whether that draft is
   * recorded or sent is the existing button's business, and the card goes on
   * saying that a pick is only a mark.
   */
  const promptSuggestion =
    suggestion !== null && suggestion !== '' && draft === '' ? suggestion : null;
  // `records === false` is a source that has no route to record a prompt at
  // all -- a read-only server, where `/api/record-prompt` is not registered
  // and 404s. The box is then not DRAWN, rather than drawn and refused on tap:
  // a control that takes text it cannot deliver is worse than no control, and
  // the source's own sentence for the refusal is carried in `declines`.
  /**
   * NO SESSION, NO COMPOSER (audit F8). Since PR 268 `zv` MOVES the active
   * tab, so an empty pane is an ordinary state rather than a cold-start one —
   * and it was drawing a full composer over nothing: a `readOnly` textarea,
   * attach, the provider picker, the model field, and an ENABLED record
   * button whose click did nothing and did not even change the status bar.
   * Six controls that cannot act, against this file's own first rule:
   * absent, not dimmed. The withdrawal path already existed for `records ===
   * false`; the no-session case is the same fact — there is no route from
   * this box to a session — and now takes the same road.
   */
  const composerHidden =
    entry === null ||
    records === false ||
    // A PANE WITH NOTHING IN IT HAS NO ONE TO PROMPT. Text sent to it would
    // run as a shell command, and a prompt box promises an answer that no
    // agent is there to give. The start screen (`StartSession` below) is the
    // whole Response view for this status; the Terminal view is the other
    // way in.
    entry.session.status === 'unstarted' ||
    // A `terminal` ROW HAS NO AGENT EITHER -- the whole of what tells it
    // apart from `unstarted` is that vam knows WHICH conversation last held
    // this pane, not that one is running now. Text typed here would land on
    // the shell prompt exactly as it would for `unstarted`, so the getting-
    // started screen (`TerminalOnlyStart` below) takes the same composer-free
    // treatment.
    entry.session.status === 'terminal' ||
    (openQuestion && chattingAbout !== setId);
  /**
   * Is the corner overlay on screen?
   *
   * It had a second reader: the identity line at the top of the column, which
   * reserved the corner this is about to paint on (audit F1). That line is
   * gone at the operator's ask, and the reservation with it, so the only
   * thing left that must not run under the pill is the prompt bubble -- kept
   * clear by its own padding, and measured as OCCLUSION rather than as a
   * class by `e2e/narrow-pane-overlay-shots.mjs`. Kept named rather than
   * inlined because it is also, still, the answer to "is this pane the
   * focused one" as far as anything painted is concerned.
   */
  const cornerOverlay = !phone && paneFocused;
  /**
   * HOW WIDE THE CORNER PILL IS, from the one thing that decides it: how many
   * view icons are on it. Every reader of this used to restate `6rem`, and
   * that constant was only ever right for THREE.
   *
   * MEASURED, both ends: a focused demo pane draws Response/PRs/Agents and
   * the pill is 90px -- 30px per icon, exactly the `6rem` (96px) the old
   * constant reserved, gap included. A pane whose source has a terminal draws
   * four, and one with the file bridge draws five: 146px measured, already
   * 50px past that reservation. The four-icon case was live on the
   * integration branch before this tab existed and no guard saw it, because
   * every web guard runs against `?demo=1` -- no terminal, no file bridge,
   * three icons, the only case the constant fitted. Adding `Files` puts a
   * fifth icon on every desktop pane, which is what turned a silent overlap
   * into the visibly clipped Save button in this tab's own header row.
   *
   * DERIVED AT RENDER TIME, NOT MEASURED FROM THE DOM, and that is a
   * correction rather than a preference: measuring the pill in a layout
   * effect and re-rendering with the result changes the height of every turn
   * in the column AFTER the column has already scrolled to its end, which
   * unpins the newest turn's bubble. `narrow-pane-overlay-shots.mjs` caught
   * exactly that -- it found the pill no longer reaching the bubble at all
   * and refused the run as vacuous rather than passing it. `tabs` is known
   * before paint, so nothing reflows.
   *
   * WHAT THIS STILL DOES NOT COVER, said plainly because the old constant did
   * not either: `data-view-note`, which adds up to 160px to the LEFT of the
   * icons while it is drawn. It is transient, it truncates itself, and no
   * reservation has ever accounted for it.
   */
  const PILL_PER_ICON = 30;
  const cornerReserve = cornerOverlay ? tabs.length * PILL_PER_ICON + 6 : 0;
  /**
   * THE SAME PILL, DOWNWARDS -- how far it reaches in from the TOP of the
   * block below, which is the half no reader needed until the Files tab put a
   * COLUMN in the corner. A column at the right-hand edge is not moved by
   * right-hand padding, so a horizontal reservation cannot clear it; what
   * clears it is the height of the row above it, and that height has to be
   * stated rather than inherited from whatever a font made the row.
   *
   * DERIVED FROM THE PILL'S OWN GEOMETRY, in the one file that draws it, and
   * spelled as the arithmetic rather than as a total so each term can be
   * checked against the element it comes from:
   *   `top-2` on `data-view-overlay`                         ->   8px
   *   the nav: 1px border + `py-1` + `h-6` + `py-1` + 1px    ->  34px
   *   `py-3` on the block these tabs are mounted in          -> -12px
   *   one gap, so the clearance is not exactly zero          ->   4px
   * Unlike the width, none of these moves with the icon count -- the pill
   * grows sideways, never downwards -- so this is a sum where `cornerReserve`
   * is a product. DERIVED AT RENDER TIME, NOT MEASURED FROM THE DOM, for the
   * reason `cornerReserve` gives above; the result is asserted as a RECTANGLE
   * rather than as a click in `e2e/files-tab-keyboard-shots.mjs`.
   */
  const cornerReserveHeight = cornerOverlay ? 8 + 34 - 12 + 4 : 0;
  /**
   * The same pill, for a block whose right edge is NOT the pane's. The prompt
   * bubble sits a variable distance inside it -- 44px at a 253px pane, 54px
   * at a wide one (the jump gutter, a scrollbar) -- so it only has to clear
   * the part of the pill that actually overhangs it, and reserving the pill's
   * whole width takes ~60px out of the first line for nothing. Measured, that
   * overhang is the pill's width less 34px..44px; less 28 lands inside the
   * 0-48px window `narrow-pane-overlay-shots.mjs` allows at BOTH pane widths.
   */
  const cornerOverhang = cornerOverlay ? Math.max(0, tabs.length * PILL_PER_ICON - 28) : 0;
  /**
   * Is the failed-session banner drawn above the column? Two readers, which
   * is why it is named: the banner itself, and the column, which hands its
   * top padding to the sticky ground and must NOT when something is sitting
   * in that padding already.
   */
  const failedBanner = current === 'Response' && entry?.session.status === 'failed';
  /** The caller's verdict on the last send here, or null. See the prop. */
  const sendFailure = props.sendFailure ?? null;
  /**
   * The phone keystroke strip's own gate -- structurally the SAME boolean
   * `canCycleMode` already is, shared rather than re-derived, AND the card
   * must not be live: `newestQuestion === null || !openQuestion` is
   * `WaitingNote`'s own "no card, or the card has nothing open" test
   * (below), reused rather than re-derived a second time. `composerHidden`
   * ALONE is not this test -- `chattingAbout` un-hides the composer the
   * moment "Chat about this" is tapped, while `QuestionCard` keeps drawing
   * the very card that press was about, which would put a structured pick
   * and a raw keypress live over the one question at once. `phone` is
   * checked separately at the render site.
   */
  const canSendKeys = canCycleMode && (newestQuestion === null || !openQuestion);
  const startChat = () => {
    if (newestQuestion !== null) setChattingAbout(setId);
    onCompose();
  };
  useEffect(() => {
    if (chattingAbout !== null) inputRef.current?.focus();
  }, [chattingAbout]);
  /**
   * The one detail clause vam can source for the running caption.
   *
   * `Session.age` is how long ago the session last did anything, already
   * compact (model.ts). It is NOT this turn's elapsed time and is not labelled
   * as one. The reference caption this line is modelled on also carries a
   * token count and an effort level; vam has neither per session -- the only
   * token figure in the model is `CanvasBudget`, the factory's whole-canvas
   * total, which would be a lie about one session -- so those clauses are not
   * printed rather than printed as zeros.
   */
  const liveAge = sessionRunning ? (entry?.session.age ?? null) : null;
  /**
   * HOW MANY TURNS VAM READ -- not how many the session has had. The source's
   * transcript reader only ever opens the newest `TAIL_BYTES` of the file
   * (`source.ts`), so on a session whose transcript has grown past that, an
   * older turn may sit outside the window vam looked at and `decisions` never
   * carried it in the first place. That is a fact about what was READ, not
   * about what happened, so this cannot be worded as the session's total --
   * see the label below, which says "read" rather than a bare count for
   * exactly this reason.
   *
   * OVER THE WHOLE COLUMN, which is what makes the word "read" keep its
   * meaning now that the column can grow: a turn walked back into it was READ,
   * by the same source, out of the same file, and leaving it out of the count
   * would make the number smaller than the list directly below it.
   */
  const turnsRead = mergedColumn.length;
  /**
   * CONCISE MODE, off the store rather than down a prop.
   *
   * `Canvas.tsx` owns the prefs state and mounts one `DetailPanel` per split
   * leaf (`PhoneShell` mounts another), so a prop would have to be threaded
   * through every one of them. `out`'s font size takes the same route for the
   * same reason and lands on the document as a custom property; this one
   * decides which elements EXIST, so it has to reach React -- a subscription,
   * the shape `ErrorLogPanel` already reads its events by.
   *
   * The third argument is the server snapshot: this bundle is also built for
   * the browser, where a hydration mismatch would be a column that renders one
   * set of lines and then another. The same getter, because the mode is a
   * module value with no request behind it.
   */
  const focusView = useSyncExternalStore(subscribeFocusView, activeFocusView, activeFocusView);
  /**
   * WHETHER THIS PANE'S VIEWS ARE CAPPED AT A READABLE LINE LENGTH.
   *
   * Read through the same seam `focusView` above it uses, and for the same
   * reason: it is global, `Canvas.tsx` mounts one of these per split leaf and
   * `PhoneShell` mounts another, and there is no dialogue in which a pane
   * opened by a keystroke could be asked. `prefs/view-width.ts` carries the
   * argument for the number and for which views it reaches.
   */
  const narrowViews = useSyncExternalStore(
    subscribeNarrowViews,
    activeNarrowViews,
    activeNarrowViews,
  );
  /**
   * WHETHER THE TERMINAL TAB STREAMS, or still polls -- `prefs/streaming-
   * terminal.ts`'s own store, read the same way `narrowViews` above is: this
   * component mounts once per split leaf with no prefs object drilled down
   * to it, and a beta flag opened by a keystroke has no dialogue to be
   * passed through.
   */
  const streamingTerminal = useSyncExternalStore(
    subscribeStreamingTerminal,
    activeStreamingTerminal,
    activeStreamingTerminal,
  );
  /**
   * HOW WIDE ONE CHARACTER OF THIS PANE'S PROSE REALLY IS, in pixels — or
   * `null` until something has been laid out.
   *
   * THIS IS A MEASUREMENT AND IT USED TO BE A CONSTANT. The constant was
   * `6.0079`, taken on one macOS machine, and the first Linux CI run measured
   * 83.95 characters across the column it produced: the shipped font stack
   * names Geist and does not bundle it, so what paints is the platform's own
   * face and its advance is not ours to know. `prefs/view-width.ts` carries the
   * whole argument; what belongs here is the mechanism, which is
   * `terminal-size.ts`'s: render real glyphs, divide the rectangle the engine
   * gives back.
   *
   * THE OBSERVER IS ON THE RULER, NOT ON THE PANE, and that is the one
   * non-obvious line of this block. `TerminalTab.tsx` observes its own box
   * because that is what its column count divides — and its own header records
   * the cost of that choice: a font change does NOT move the box, so nothing
   * fires and the effect has to re-run on the size instead. A ruler has the
   * opposite property. Its width IS the thing that changes when the face
   * resolves, when the operator steps `out` text, when the page is zoomed and
   * when a webfont finally swaps in — so observing it turns all four of those
   * into the one event this needs, and none of them is a prop or a dependency
   * anything here could have listed.
   */
  const proseRulerRef = useRef<HTMLElement | null>(null);
  const [proseAdvance, setProseAdvance] = useState<number | null>(null);
  useLayoutEffect(() => {
    const ruler = proseRulerRef.current;
    if (ruler === null) return;
    const measure = () => {
      const width = ruler.getBoundingClientRect().width;
      const characters = (ruler.textContent ?? '').length;
      if (!(width > 0) || characters === 0) return;
      // Only a real move, for `useSyncExternalStore`'s reason one screen up:
      // an identical number written back every frame is a render per frame.
      setProseAdvance((previous) =>
        previous === width / characters ? previous : width / characters,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(ruler);
    return () => observer.disconnect();
  }, []);
  /**
   * The cap itself, or `undefined` while the flag is off, while the current
   * view caps itself, or before the ruler has been measured. One expression,
   * because the body, the question card and the composer are ONE COLUMN --
   * see the body's own comment for the operator's decision behind that.
   */
  const proseMaxWidth = narrowViews ? narrowProseMaxWidth(proseAdvance) : undefined;
  /**
   * The body's own, which is the same cap minus the three views that are not
   * in it: the Terminal caps itself in `ch` (`narrowsAsProse`), `FilesTab` is
   * a CHILD of the body, so a cap left on for it would narrow a tree the
   * operator drags the width of themselves, and the Agents navigator is two
   * panes that need the whole width. The composer needs no such test — it is
   * drawn on Response only (`drawsComposer`). The question card DOES: it is
   * drawn on Agents too, so it takes this value rather than `proseMaxWidth`,
   * or a full-width navigator would sit over a capped card — the "column on
   * top of chrome" mismatch the operator rejected on the first cut, inverted.
   */
  const bodyMaxWidth = narrowsAsProse(current) ? proseMaxWidth : undefined;
  /**
   * THE TURNS THE OPERATOR HAS ASKED BACK, and why this is React state rather
   * than a stored field.
   *
   * "Folded activity stays one click away" is a READING GESTURE about one
   * turn -- show me this one, now -- not a preference. Persisting it would
   * answer a question nobody asked twice and accumulate turn ids for sessions
   * the store has since pruned, which is the shape `dismissedSessions` was
   * retired for. Keyed by `Decision.id` rather than by index: the column pages
   * earlier turns IN at its top, so an index is a different turn one scroll
   * later.
   */
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * LEAVING FOCUS VIEW FORGETS THEM, and that is the gesture keeping its own
   * meaning rather than a cleanup. Each entry says "this folded turn, open" --
   * with nothing folded there is no such turn, so carrying the set across
   * would leave the column holding answers to a question that stopped being
   * asked. Coming back in, every turn is folded again, which is what the
   * operator just asked for by coming back in.
   */
  const wasFocusView = useRef(focusView);
  if (wasFocusView.current !== focusView) {
    wasFocusView.current = focusView;
    if (unfolded.size > 0) setUnfolded(new Set());
  }
  /**
   * THE IN BUBBLE'S RIGHT-CLICK MENU -- which turn, and where the pointer was.
   *
   * Held by turn ID rather than by the turn object: the column re-reads the
   * transcript on every poll, so a held object would go stale while the menu
   * is open, and the two items are resolved against the live list at draw
   * time instead.
   */
  const [promptMenu, setPromptMenu] = useState<{
    /** Which block was right-clicked: the prompt, or the answer under it. */
    readonly kind: 'prompt' | 'answer';
    readonly id: string;
    readonly at: { readonly x: number; readonly y: number };
  } | null>(null);
  const openPromptMenu = useCallback((id: string, at: { x: number; y: number }) => {
    setPromptMenu({ kind: 'prompt', id, at });
  }, []);
  const openAnswerMenu = useCallback((id: string, at: { x: number; y: number }) => {
    setPromptMenu({ kind: 'answer', id, at });
  }, []);

  const unfold = useCallback((id: string) => {
    setUnfolded((open) => {
      const next = new Set(open);
      next.add(id);
      return next;
    });
  }, []);
  /**
   * WHICH KEY SENDS THE DRAFT, read the same way and for the same reason: the
   * canvas mounts one of these per split leaf and the phone mounts another, so
   * a prop would have to be threaded through every one of them. Not a paint
   * either -- it decides what a keystroke DOES -- so CSS could not carry it
   * the way `--vam-out-font-size` carries the out text size.
   */
  const submitKey = useSyncExternalStore(
    subscribePromptSubmitKey,
    activePromptSubmitKey,
    activePromptSubmitKey,
  );
  /**
   * WHAT THE BOUNDARY BLOCK OFFERS AT THE TOP OF THE COLUMN, or `null` when it
   * offers nothing. Decided in `transcript-history.ts` so that the four answers
   * are folded in ONE place rather than in a JSX conditional that a later
   * branch can quietly disagree with.
   */
  const columnMore = moreState(pagerNow, readHistory);
  // Oldest first: the column is newest first. That
  // ordering is what makes "the last line" and "the newest turn" the same
  // line, so the ones kept are taken off the end.
  const orderedTurns = [...mergedColumn].reverse();
  /**
   * How many tool calls failed across the turns ON SCREEN, or `null` when no
   * turn read carries the field at all.
   *
   * NULL AND ZERO ARE DIFFERENT and the difference is the point. `null` is
   * "no turn here can report failures" -- a source with no such surface, which
   * must draw nothing, because a confident "0 failed" over data nobody looked
   * at is the same lie as a false badge. Zero is a reading: vam looked across
   * every turn in view and found none.
   *
   * OVER THE SAME WINDOW as the count it sits beside, which is what lets the
   * two share a line honestly: both are facts about the turns that were READ.
   */
  const failedRead = orderedTurns.reduce<number | null>(
    (sum, d) => (d.errorCount === undefined ? sum : (sum ?? 0) + d.errorCount),
    null,
  );
  /**
   * The mark for one turn, and the only place these glyphs are chosen -- the
   * `<select>` and the expanded list drew the same conditional twice, which is
   * how they would come to disagree about what a turn is.
   *
   * FAILURE OUTRANKS PROGRESS. `◌` says "not finished" and `✓` says
   * "finished", and both are true of a turn whose tools blew up -- which is
   * exactly how the fold came to cost the operator the alarm while keeping the
   * detail. `!` means SOMETHING INSIDE THIS TURN FAILED, which is a narrower
   * claim than "this turn failed": the count beside the line says how many,
   * and the turn may well have recovered. It is still the thing worth seeing
   * from a collapsed row.
   *
   * MOVED TO MODULE SCOPE with the column: `TurnBlock` draws the same mark on
   * each turn's own line, and a third copy of the conditional is exactly what
   * this comment was already written against.
   */
  /**
   * WHICH TURN THE COLUMN IS MARKING, or `null` when the pick has fallen out
   * of the window entirely -- `selectedTurnMissing`'s case, where the column
   * still draws every turn it HAS and says separately that the one asked for
   * is not among them. Marking a substitute would be exactly the swap that
   * mechanism exists to refuse.
   */
  const markedId = selectedTurnMissing ? null : (decision?.id ?? null);
  /**
   * PICK A TURN: mark it, and take the column to it.
   *
   * `selectedId` used to decide which turn was DRAWN. In a column that is the
   * wrong verb -- picking must not hide six turns to show one -- so the state
   * survives with a smaller job (which turn is marked, and which turn the `!`
   * typeahead reads its proposed commands from) and the MOVEMENT is the
   * scroll, applied by the layout effect above.
   *
   * ONE CALLER LEFT, and it is deliberate that there is one rather than none.
   * The turn list and the `<select>` that drove this both went with the
   * column's bar -- the column draws every turn, so a jump-to-turn control was
   * a second way to do what the scrollbar does. What still picks a turn is
   * "Back to the current turn" below, and the CANVAS, which sets the same
   * state through `followCanvas` during render. The consequence, named rather
   * than left to be discovered: nothing in this pane can now mark a turn the
   * canvas cannot reach. Scrolling to one still works, and marking one was
   * only ever about which turn the `!` typeahead reads -- but it IS a reach
   * this pane used to have and no longer does.
   */
  const pickTurn = (id: string) => {
    setSelectedId(id);
    scrollToTurnRef.current = id;
  };

  /**
   * What the composer's button claims, in the words the SOURCE earns.
   *
   * The Claude Code source TYPES the prompt into the pane it owns -- a real
   * channel into the running session, so `record` understates it and the
   * operator has to know when a message is going out. But it is a keystroke
   * with no echo that the turn landed, so the wording stops at "typed into the
   * terminal" and does not promise a delivery or an answer (`Canvas.tsx`, and
   * `sources/claude-code/reply.ts`). The factory source still genuinely only
   * appends to a log, so this is per-source and not a rename: one wording for
   * both would be wrong for one of them.
   */
  const composerClaim = sending
    ? // The in-flight wording keeps the delivers/records distinction. Losing it
      // here would make the pane's one honest sentence wrong for exactly as
      // long as the write takes, which is the window the operator is actually
      // watching.
      delivers === true
      ? {
          Glyph: ArrowUp,
          label: 'sending prompt…',
          title: 'typing the prompt into this session’s terminal — this can take a while',
        }
      : {
          Glyph: NotepadText,
          label: 'recording prompt…',
          title: 'appending the prompt to this session\u2019s log',
        }
    : delivers === true
      ? {
          Glyph: ArrowUp,
          label: 'send prompt',
          // Typed into the pane vam owns, not delivered-and-confirmed: there is
          // no echo that the turn landed (`sources/claude-code/reply.ts`), so
          // this claims the keystroke, not the answer.
          title:
            'types the prompt into this session’s terminal — it shows once the session records it',
        }
      : {
          Glyph: NotepadText,
          label: 'record prompt',
          title:
            'appends the prompt to this session\u2019s log — vam cannot hand it to a running agent',
        };
  /**
   * THE `word` IS GONE FROM THIS CLAIM, with the label it painted.
   *
   * Operator: "drop the Send label from the button, the icon is enough." Every
   * `word` used to be a prefix of its own `label` because WCAG 2.5.3 asks that
   * an accessible name contain the VISIBLE one -- and that criterion applies
   * only where a visible label exists. With none, 1.1.1 takes over and the
   * `label` is the whole of the name.
   *
   * The field is deleted rather than left unread: a claim carrying a word
   * nothing paints is the same defect as a preference nothing reads, which
   * this repo already has a test for. What still says which outcome this
   * button produces is the GLYPH (two of them), the `label`, and the `title`
   * that `Note` opens on focus -- all three asserted in
   * `test/panels/DetailPanel.test.tsx` and on the painted control in
   * `e2e/composer-bar-shots.mjs`.
   */
  const ComposerGlyph = composerClaim.Glyph;
  /*
   * GONE WITH THE ROW IT FED: `sendVerb`, the send/record verb the key caption
   * used. It carried the same `delivers` distinction the submit button's own
   * name and glyphs carry, so nothing is lost by deleting it rather than
   * leaving it computed for no reader -- which is the rule `composerClaim`'s
   * own `word` field was already deleted under.
   */
  // THE PANE ITSELF, held as a value rather than returned directly, and that
  // is about the DIFF rather than about the code: wrapping this JSX in the
  // provider below pushes eleven hundred lines of unrelated markup one level
  // deeper, the formatter rewrites every one of them, and the change ends up
  // buried in its own reindentation. A wrapper should cost a wrapper.
  const pane = (
    <aside
      data-action-pane={active ? 'active' : 'idle'}
      /* THE SCOPE OF THE READING SIZE, and the only thing this attribute does.
         `styles.css`'s `[data-reading-pane]` rule re-declares the type scale's
         BODY and CONTROL steps in terms of `--vam-out-font-size`, so every
         `text-body` and `text-control` inside this pane follows the size the
         operator set for the answers. Operator report: "out để fontsize 15 khá
         to nhưng phần prompt choice option hiện rất bé" -- at `out` 15 the
         answers read comfortably and the prompt's choice options are tiny.
         A HOOK RATHER THAN A CLASS because the declaration is a SCOPE, not a
         style: nothing about this element paints differently, and every call
         site inside keeps the role it already picked.
         ITS OWN NAME, AND ON THIS ELEMENT, because `Canvas.tsx` already wraps
         the desktop pane in `[data-detail-pane]` (the width holder) and
         `PhoneShell` mounts this panel with no such wrapper: a scope keyed to
         the Canvas attribute would have covered the desktop by accident and
         the phone not at all. This element is under both. */
      data-reading-pane=""
      style={width === undefined ? undefined : { width }}
      className={[
        // THE PANE'S OWN TOKEN, at the operator's ask ("split the pane's
        // colour setting from the sidebar"). It was `bg-sidebar` -- the
        // mockup's `width:408px` column of artboards 1a/1b paints the pane and
        // the sidebar the same value, so the token was right and the SETTING
        // was one swatch for two surfaces. `--vam-pane` starts on that same
        // measured value in both themes (styles.css), so nothing moved; what
        // changed is that either can move alone now.
        'relative flex h-full min-w-0 flex-col border-line border-l bg-pane',
        // No width given means nobody is sizing this pane -- the phone shell's
        // case -- so it fills its host instead of refusing to shrink.
        width === undefined ? 'w-full' : 'shrink-0',
      ].join(' ')}
    >
      {/*
        THE PANE DRAWS NOTHING FOR HOLDING THE KEYBOARD.

        It used to say so twice, then once, then not at all. First the left
        border grew to `border-l-2` in a colour -- `waiting`, the amber that
        means "a session is waiting on your answer" everywhere else, then
        `focus-edge` -- and the operator called the border wrong. Then the
        line along the top edge was the whole signal, until the operator asked
        for that off too ("remove the running-line animation at the top of the
        pane when focused"), the same way the sidebar's copy had already gone.
        Being the last mount, it took the whole feature with it: component,
        class, keyframe hook and the token pair only it read.

        What still answers "where do my keys go": the status bar prints the
        mode as a word, the focused row or card inside the mode draws its own
        ring, and the view-icon overlay is drawn in the FOCUSED pane alone --
        so with two panes open, only one wears it. `data-action-pane` still
        carries `active`/`idle` for tests and for whatever draws next; it is
        simply not painted here.
      */}
      {resizeHandle}
      {/*
        A12.2: THE HEADER IS GONE. It used to carry five facts — the status
        dot, the session's name, its project, its epic ("branch"), how many
        agents are running, and which turn is focused — in a block that cost
        real height on every render whether or not any of it had changed
        since the operator last looked. None of the five is dropped, each
        moved to where it is actually read:
          - the session's NAME is the tab it already sits in (A11/A12.1) —
            drawing it again one row down was the same word twice;
          - STATUS is the sidebar row's own dot, which was already the same
            four-colour map (`PANE_STATUS_DOT` used to duplicate it exactly)
            — a second copy of an unchanged fact bought nothing; the `out`
            rule below still shows the one status fact that is actually about
            the turn on screen, whether IT is still being worked;
          - PROJECT and EPIC move into the `in` block's identity line, below
            — still always on screen while there is a turn to read, just
            inside the column instead of above it;
          - AGENT COUNT is the badge on the Agents icon, immediately below —
            the same "a real source, omitted at zero" rule this pane already
            uses everywhere else, not a new one invented for this;
          - the focused TURN's label moves into the `in` rule's own meta
            slot, beside "you" — see the `in` block below.
        A15.5: what used to be that row is now a CORNER OVERLAY instead — the
        icons cost no space of their own any more, floating over the top-right
        corner of the scrolling column below rather than pushing it down.

        Three properties an overlay owes that a reserved row got for free:
        - IT MUST NOT STEAL INPUT FROM WHAT IT FLOATS OVER. `pointer-events-
          none` on this wrapper, opted back into on the `<nav>` itself
          (`ViewIcons`), means only the pixels the icons actually paint can
          catch a click or a hover — the wrapper's own empty area is inert,
          so it never shadows a click meant for the content underneath.
        - IT MUST NOT BALLOON AT A NARROW WIDTH. Sized to its own content
          (no `inset-x-0`/`w-full`) and capped by `max-w-` against the pane's
          own width. The refusal note is capped and truncated the same way,
          so a long one grows the ellipsis, never the overlay.

          THIS USED TO SAY the overlay "can only ever cover the few pixels
          its glyphs occupy — never the whole line of text beneath it". That
          was true of the WRAPPER, which is `pointer-events-none` and
          transparent, and false of the filled pill inside it, which is
          opaque: measured at a 253px pane, the nav ran x 924–1014 over an
          identity line running to x 1010, so its last 86px — project and
          epic, the two facts the removed header relocated there — were laid
          out, measured as visible by `truncate`, and then painted over
          (audit F1). An overlay owes a FOURTH property, and it cannot be
          discharged from here: WHAT IT FLOATS OVER MUST STAY CLEAR OF ITS
          CORNER. The identity line discharged it by reserving 7rem, and the
          operator has since had that line removed altogether; what the pill
          floats over now is the prompt bubble, kept clear by the bubble's own
          padding -- a paint choice, so it is measured rather than trusted.
          `e2e/narrow-pane-overlay-shots.mjs` asks which element is on top of
          each painted glyph, which is the only way to see occlusion.

          A comment asserting a property the code does not have is worse than
          no comment: it is how this defect passed review.
        - IT MUST NOT TRAP FOCUS. `position` is a paint property; a browser's
          default Tab order follows DOM order, not screen position, so
          moving the icons out of the flow cannot create the kind of focus
          loop a modal's own trap would. Nothing here listens for `Tab` at
          all, which is A5.3's contract (decline what you do not own) kept
          by simply not touching it.

        `z-20` outranks the `in` block's own `sticky z-10` header (below):
        both sit in the same stacking context once the sticky element is
        actually stuck, and without an explicit order the later one in DOM
        order — the sticky header — would paint over these buttons the
        moment the reader scrolls, defeating the one thing an "always
        reachable" shortcut promises.
      */}
      {/* FOCUSED PANE ONLY -- see `paneFocused`. */}
      {cornerOverlay && (
        <div
          data-view-overlay
          className="pointer-events-none absolute top-2 right-2.5 z-20 flex max-w-[calc(100%-1.25rem)] items-center justify-end gap-1.5"
        >
          {/* `Alt+<digit>`'s own refusal, said aloud (A2.5: "refuses aloud
              when the source has none") — `role="status"` so a screen reader
              announces it without the operator having to go looking. Capped
              and truncated rather than growing the overlay past its own
              corner, and sits on the LEFT of the icons: they are always
              reachable, the refusal is not always there. */}
          {viewNote !== null && (
            <span
              data-view-note
              role="status"
              className="min-w-0 max-w-[160px] truncate rounded-[7px] border border-line-strong bg-pane px-1.5 py-0.5 text-right font-mono text-meta text-waiting"
            >
              {viewNote}
            </span>
          )}
          <ViewIcons
            tabs={tabs}
            runningAgents={entry?.session.runningAgents ?? 0}
            current={current}
            onSelect={pickTab}
          />
        </div>
      )}
      {/* Not drawn at all on a phone -- the same `!phone` gate the icon row
          above wears. Operator instruction: the phone's session screen is the
          prompt screen, and a full-width strip of words between the app bar
          and the output is chrome it cannot afford. The same views are icon
          buttons in the app bar there; `phone/PhoneShell.tsx` draws them and
          drives this pane's view through `tabRequest`. */}

      {/*
        `in`, `progress` and `out` are now ONE continuous scrollable column
        (A12.2), shaped like the Claude Code VSCode plugin's own turn view:
        everything inline, one scrollbar, not three fixed-height panes each
        competing for the pane's total height and each fighting its own
        scrollbar. `in` stays pinned to the top of THIS column via
        `position: sticky` (below) rather than a fixed height budget, so the
        prompt that produced a long answer never scrolls out of view while
        you read it. `min-h-0` on every level is still what makes a flex
        child able to shrink and scroll rather than growing its parent.
      */}
      {/* THE BODY EVERY VIEW BUT ONE IS DRAWN INSIDE, and where the operator's
          width choice lands (`prefs/view-width.ts`).

          A MAXIMUM AND NOTHING ELSE. `narrowsAsProse` decides which views it
          reaches: the Terminal caps itself in `ch` because eighty of its
          characters is a COLUMN COUNT, `FilesTab` — a child of this very
          element, always mounted and merely `hidden` — is not in the ask and
          is the one view a second opinion about width would harm, and the
          Agents navigator is two panes side by side that the operator asked
          to have the whole width. The cap is therefore keyed to the CURRENT
          view rather than put on unconditionally: leaving it on while Files
          is up would narrow a tree the operator drags the width of
          themselves.

          `mx-auto` CENTRES IT, which is a choice and not a default. The cap
          exists to shorten the eye's return sweep; pinning the column against
          one edge of a 1600px pane leaves a thousand pixels of void the eye
          still has to cross to get back. The chrome that frames this body —
          the view pill in the corner, the composer below — keeps the pane's
          own width either way, so the column reads as a column and not as a
          panel that failed to fill.

          `w-full` is what makes `mx-auto` mean anything: a flex child sized by
          its content has no spare inline space for auto margins to share.

          AND THE COMPOSER AND THE QUESTION CARD COME WITH IT -- the operator's
          own decision, made on a screenshot of the first cut, where this body
          was a narrow column of prose sitting on top of full-width chrome:
          "narrow the composer and the question card too, so the whole block is
          one column". The first cut argued the other way (they named four
          VIEWS, and a wide box is better to type into); what that argument
          missed is that the transcript and the box you answer it in are ONE
          conversation, and a seam down the middle of it is what the eye
          actually reads. The same `proseMaxWidth` is spent in all three
          places, so there is one column and not three that happen to agree. */}
      <div
        data-detail-body
        className={`flex min-h-0 w-full flex-1 select-text flex-col gap-2.5 px-3.5 py-3 ${
          bodyMaxWidth === undefined ? '' : 'mx-auto'
        }`}
        style={bodyMaxWidth === undefined ? undefined : { maxWidth: bodyMaxWidth }}
      >
        {/* THE RULER, and it is the whole of how the cap knows what a character
            is. Real glyphs, in this pane's own face, at the smaller of the two
            prose sizes a response pane draws (`PROSE_RULER_FONT_SIZE`) --
            measured by the engine rather than assumed by us, which is the
            correction a frozen macOS advance earned on its first Linux CI run.

            INSIDE THIS ELEMENT so it inherits the face the prose is set in, and
            `absolute` so its own width is its content's and never this
            container's -- there is no feedback loop between the cap and the
            thing the cap is computed from.

            `select-none` IS LOAD-BEARING HERE, unlike on the terminal's ten-M
            ruler:
            this body is `select-text`, and three hundred invisible characters
            inside it would otherwise land in the operator's clipboard every
            time they selected a turn. */}
        {/* CLIPPED BY A ZERO-SIZED BOX, and that box is not decoration.
            `absolute` takes the ruler out of FLOW but not out of its
            ancestor's SCROLLABLE OVERFLOW: three hundred `whitespace-pre`
            characters measure ~1750px, and on a 1280px window that put the
            document's `scrollWidth` at 2015 and drew a horizontal scrollbar
            across the whole app with an empty band at the right. Measured,
            after it shipped.

            A wrapper of `h-0 w-0 overflow-hidden` ends the overflow without
            touching the measurement: clipping is visual, so the ruler's own
            border box -- the thing `getBoundingClientRect` reports and the
            cap divides -- is still its full natural width. Shrinking the
            ruler instead would have been measuring a different string. */}
        <span aria-hidden="true" className="absolute top-0 left-0 h-0 w-0 overflow-hidden">
          <span
            ref={proseRulerRef}
            data-prose-ruler
            className={`${PROSE_RULER_CLASS} pointer-events-none block w-max select-none whitespace-pre opacity-0`}
          >
            {PROSE_RULER_TEXT}
          </span>
        </span>
        {/* A failed session says so here, not only in the dot's colour.
            Measured against the real CLI: a failed row carries `cwd, id,
            kind, name, sessionId, startedAt, state` and NOTHING about why --
            no error, no message, no exit code. The job's own `state.json`
            reports `working` for a session the CLI calls failed, so it is not
            a second opinion worth showing. Naming the gap is the whole of
            what can honestly be said. */}
        {failedBanner && (
          <p
            data-session-failed
            className={[
              'flex flex-none items-center gap-1.5 rounded-[9px] border border-failed bg-card py-2 pl-3 text-control text-failed',
              /* THE CORNER, RESERVED -- the same obligation the prompt bubble
                 and the column's boundary block already carry, and the banner
                 is the third element that lands in it: on a failed session
                 this `<p>` is the FIRST child of the column, so the view-icon
                 pill floats over its right end, which is exactly where the
                 "why?" control sits. Measured at a 253px pane before this
                 line: 9 of 45 sampled glyph pixels under the pill, and
                 `elementFromPoint` at the control's own centre returned the
                 Agents view button -- a click meant to ask why the session
                 died switched tab instead.

                 `6rem` is the width the boundary block above already reserves
                 for the same pill, and only while the pill is drawn: an
                 unfocused pane paints none, and 96px taken out of a narrow
                 pane for nothing is the over-reservation the identity line's
                 own `7rem` was deleted for. `e2e/narrow-pane-overlay-shots.mjs`
                 measures both halves. */
              cornerOverlay ? '' : 'pr-3',
            ].join(' ')}
            style={cornerOverlay ? { paddingRight: cornerReserve } : undefined}
          >
            <span role="img" aria-label="failed" className="flex">
              <CircleSlash size={13} strokeWidth={1.6} />
            </span>
            <span className="min-w-0 flex-1">This session failed.</span>
            <Note text="the source reports no reason for the failure — a failed row carries no error, message or exit code">
              {/* A BUTTON, because it was a `<span>` and a `Note` on a span is
                  the `title` this app deleted: measured in a real browser,
                  `tabIndex` -1 and 300 Tab presses never reached it, while
                  `Note.tsx`'s own first line promises "A note that a keyboard
                  can read." It is the explanation for why a session died, so
                  the keyboard-first tool was hiding its most important
                  sentence from the keyboard.

                  Not `tabIndex={0}` on the span, which is what the status
                  bar's two notes do: those are readouts that happen to carry
                  a note, and each needs a biome suppression to say so. This
                  one is a control whose whole purpose is to open the note, so
                  it is the element that means that -- Enter and Space work,
                  it is announced as a control, and no suppression is needed.

                  The name is not "why?": a screen reader reading a lone "why"
                  out of the banner's flow has been told nothing. */}
              <button
                type="button"
                aria-label="why this session failed"
                className={`flex-none cursor-help rounded-[4px] font-mono text-control text-ink-faint underline decoration-dotted hover:text-ink ${FOCUS_RING}`}
              >
                why?
              </button>
            </Note>
          </p>
        )}
        {current === 'Terminal' ? (
          /* Mounted by this branch and by nothing else, which is the whole of
             the tab's laziness: while another tab is showing, the component
             does not exist, so no timer runs and no `capture-pane` is spawned.
             `window.api` exists only in the Electron shell (App.tsx); in the
             browser build the tab says so instead of asking.

             `streamingTerminal` PICKS BETWEEN TWO TABS, not a mode inside one:
             the beta is xterm.js over a persistent `tmux -C` connection
             (`docs/design/terminal-streaming.md`), and `TerminalTab`'s props
             below must stay byte-for-byte what they were -- this flag is an
             opt-in a later operator can turn off without touching the tab it
             was reading before. */
          streamingTerminal ? (
            <Suspense fallback={null}>
              <LazyTerminalStreamTab
                projectId={entry?.project.id ?? null}
                rowId={entry?.session.id}
                branch={entry?.session.branch ?? null}
              />
            </Suspense>
          ) : (
            <TerminalTab
              projectId={entry?.project.id ?? null}
              rowId={entry?.session.id}
              read={globalThis.window?.api?.terminal?.read}
              /* The pane fits because tmux is TOLD the size: `capture-pane`
                 returns a screen tmux already composed at the session's own
                 size, which no style on this side can re-wrap. */
              resize={globalThis.window?.api?.terminal?.resize}
              /* Typing. Passed here beside the other two rather than reached
                 for inside the tab, so all three halves of the bridge this
                 tab uses are visible at the one call site: a member wired
                 invisibly is one refactor away from being dropped with
                 nothing to notice. `undefined` in the browser build, where
                 the tab says so instead of taking keys it cannot deliver. */
              send={globalThis.window?.api?.terminal?.send}
              /* THE BRANCH, for the rule under the screen. Passed from here
                 rather than read inside the tab for the reason the three
                 members above are: this panel is where the session is in
                 scope, and a fact reached for invisibly is a fact a later
                 edit drops with nothing to notice. `null` when there is no
                 session and when the source cannot say -- `TerminalTab`
                 draws nothing for either, and its `branch` prop says why
                 that is not a dash. */
              branch={entry?.session.branch ?? null}
            />
          )
        ) : current === 'Agents' ? (
          <AgentsTab agents={entry?.session.agents} sessionId={entry?.session.id ?? ''} />
        ) : current === 'PRs' ? (
          <PullRequestsTab
            pullRequests={entry?.session.pullRequests}
            repo={
              prRepo === undefined
                ? undefined
                : { ...prRepo, projectName: prRepo.projectName ?? entry?.project.name }
            }
            /* WHOSE pull requests, for the action channel. Main turns this into
               the directory to act in, so the renderer never names a path --
               see `src/main/pr/ipc.ts`. */
            sessionId={entry?.session.id ?? null}
            /* The desktop bridge, read at the CALL SITE like the Terminal and
               Files tabs' bridges directly below, so all of what this tab can
               reach is visible in one place. `undefined` in the browser build
               and on the phone, where the list still draws and the controls
               simply do not. */
            bridge={globalThis.window?.api?.prs}
            /* The floating view pill's downward reach, so the first row's
               status rail is not painted over by it -- see the `<ul>` inside
               the tab. Threaded like `FilesTab`'s below, and for the same
               reason it is: a column at the pane's right edge cannot be
               cleared by right-hand padding. */
            reserveCornerHeight={cornerReserveHeight}
          />
        ) : current === 'Files' ? // Drawn by the ALWAYS-MOUNTED `FilesTab` sibling below instead --
        // see its own comment for why. This slot contributes nothing so the
        // Response-column branches below it never run for a tab that is not
        // Response.
        null : entry !== null && entry.session.status === 'unstarted' ? (
          <StartSession
            paneName={entry.session.pane ?? entry.session.title}
            defaultProvider={defaultProvider}
            onStart={onStartSession}
            startingPane={startingPane}
            onShowTerminal={onShowTerminal}
          />
        ) : entry !== null && entry.session.status === 'terminal' ? (
          <TerminalOnlyStart
            title={entry.session.title}
            paneName={entry.session.pane ?? entry.session.title}
            source={entry.session.source ?? entry.project.source ?? 'unknown'}
            defaultProvider={defaultProvider}
            onStart={onStartSession}
            resumeCommand={entry.session.resumeCommand}
            onResumeInPane={entry.session.resumeCommand === undefined ? undefined : onResumeInPane}
            startingPane={startingPane}
            onShowTerminal={onShowTerminal}
          />
        ) : entry === null && gettingStarted !== undefined ? (
          // THE APP HAS NO SESSION TO SHOW ANYWHERE -- `Canvas.tsx`'s own
          // signal, not a fact this panel could derive from `entry` alone
          // (see `gettingStarted`'s own comment). Takes priority over the
          // plain "no session"/"no sessions open" text right below: that
          // text is the honest fallback for a pane with nothing in it while
          // OTHER sessions exist elsewhere; this screen is what replaces it
          // the one time there is truly nothing in the whole app to point at.
          <GettingStarted {...gettingStarted} />
        ) : orderedTurns.length === 0 &&
          // NOT while phone has an inline question to draw (§3.2-3.3): a
          // fresh session whose only "step" so far IS the question (nothing
          // else has been read into `orderedTurns` yet, or the transcript's
          // tail simply has not caught up) must not let "no steps yet"
          // swallow the one thing on this screen the operator can act on.
          // Falling through to the column branch below with an empty
          // `orderedTurns` draws a scroller holding nothing BUT the inline
          // question, which is still one scrollable region per AC-1.
          !(phone && current === 'Response' && newestQuestion !== null) ? (
          entry === null && !phone ? // SAID ONCE (audit F9). A desktop pane always has a tab strip
          // above it, and an empty strip already says "no sessions open —
          // pick one from the sidebar". This line said the same thing in
          // different words 40px below it, in otherwise empty space. The
          // PHONE has no strip, so there it is the only sentence there is and
          // it stays.
          null : (
            <p className="text-control text-ink-faint">
              {/* Two different absences. "This session has no steps yet" named a
                session that did not exist whenever nothing was focused. */}
              {entry === null
                ? 'No session selected — pick one in the sidebar.'
                : entry.session.status === 'failed'
                  ? // Final, not pending. A failed background session has no
                    // transcript at all -- the CLI lists it while
                    // `~/.claude/projects/` holds no `.jsonl` for its id -- and
                    // "no steps yet" promises steps that are never coming.
                    'This session failed with nothing recorded.'
                  : 'This session has no steps yet.'}
            </p>
          )
        ) : (
          // THE WHOLE SESSION, AS ONE COLUMN. One scrollable region holding
          // every turn `entry.session.decisions` carries, oldest at the top,
          // newest at the bottom, each turn's `in` pinned to the top of the
          // column while you are inside it — the operator's ask, and the shape
          // the Claude Code plugin for VSCode has.
          //
          // The ref and the scroll handler live HERE because this is the
          // region that scrolls; `stuckRef`/`isAtBottom` never cared which
          // element they were reading metrics off, only whether it was resting
          // at its own bottom.
          //
          // WRAPPED, and the wrapper is the whole of what the floating jumps
          // need. `position: absolute` inside a scroller is resolved against
          // its SCROLLED content, so a jump placed on the column itself would
          // ride the transcript out of the frame; placed on a non-scrolling
          // box of exactly the same size, it stays at the column's edge at
          // every offset. The full-bleed pull (`-mx-3.5`, see below) moves up
          // here with it so the wrapper's box IS the column's box -- an
          // overlay measured against a box 14px narrower on each side would
          // sit 14px inside the edge it is meant to hug.
          <div
            className={`relative -mx-3.5 flex min-h-0 flex-1 flex-col ${
              failedBanner ? '' : '-mt-3'
            }`}
          >
            <div
              ref={outRef}
              data-detail-column
              onScroll={(event) => {
                stuckRef.current = isAtBottom(event.currentTarget);
                syncJumps(event.currentTarget);
                askIfNearTop(event.currentTarget);
              }}
              /* FULL-BLEED, so the sticky ground inside can be. The pane body
                 puts `px-3.5 py-3` around everything; a scroll column inside
                 that padding can only paint as wide as the padding box, which
                 left a 14px gutter down each side of the pinned prompt with
                 the transcript scrolling past in it, in full view. So the
                 padding comes OFF the body (`-mx-3.5`, on the wrapper above)
                 and back on here: every child lays out where it did, and the
                 ones that ask for it -- every turn's sticky ground, and the
                 boundary block -- reach the pane's own edges with a negative
                 margin of their own.

                 THE RIGHT SIDE IS 44, NOT 14, AND THAT IS THE JUMPS' RENT.
                 They float over this column, and MEASURED over the demo
                 session at five widths and fifteen offsets each, the answer
                 text runs to the column's content edge at every one of them
                 (rightmost run x=1107 of 1135, 790 of 835, 538 of 555, 421 of
                 435, 375 of 389 -- always the padding box, exactly). So there
                 is no corner a control can float in without covering
                 somebody's sentence, and the only honest way to float one is
                 to reserve the strip it lands in. Reserved UNCONDITIONALLY,
                 not while a jump happens to be drawn: a reservation that came
                 and went with the scroll offset would re-wrap every paragraph
                 in the pane under the reader's eye, which is the same
                 objection `TurnBlock`'s corner reserve already answers. 44 is
                 the touch floor the buttons have to meet anyway (WCAG 2.2 SC
                 2.5.5, `PhoneShell.tsx`), so the strip is exactly one hit box
                 wide and not a pixel more.

                 The TOP is the same move without the give-back: `-mt-3` (on
                 the wrapper) hands the body's top padding to the column, which
                 re-spends it on the boundary block below. Not when the failed
                 banner is drawn -- there IS something above the column then,
                 and pulling up would slide the column under it.

                 `container-type:size` IS LOad-BEARING, not decoration: it
                 makes this element the size container the `45cqh` cap on every
                 turn's sticky prompt resolves against. Without it that cap
                 resolves to nothing inside the per-turn wrapper and the pinned
                 prompt can cover the answer again (audit F2). `TurnBlock`'s
                 own comment carries the measurement. */
              className="vam-no-scrollbar flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pl-3.5 pr-11 [container-type:size]"
            >
              {/*
              WHAT THE TOP OF THE COLUMN IS — said, not left to be inferred.

              THE REPO'S DOMINANT DEFECT FAMILY, at the one place it bites
              hardest. `sources/claude-code/pull-requests.ts` states the rule:
              "'No PRs' and 'vam could not ask' must never look the same." A
              column that simply stops at its oldest loaded turn claims the
              session started there. It did not: the transcript reader only
              ever opens the newest `TAIL_BYTES` of the file (`source.ts`).

              MEASURED, over the 73 transcripts on this machine that vam
              actually opens -- interactive sessions only; the other 863
              `.jsonl` files on disk are subagent SIDECHAINS, which vam never
              reads, and counting them would have made every figure here wrong
              by an order of magnitude. The distribution is bimodal, and both
              ends argue for this block:
                - 41% of sessions fit ENTIRELY inside the window. For four in
                  ten, the oldest turn drawn really is the session's first --
                  and vam still cannot say so, which is why `session-start` is
                  defined below and not drawn;
                - the other end is where the operator's long-running work
                  lives, and there the window is a sliver: 157.3 MB over 63
                  turns shows ONE, 138.4 MB over 261 turns shows two, 122.1 MB
                  over 89 shows one. p50 254 KB, p75 5 MB, p90 45 MB.
              A column that ended silently would be at its most misleading
              exactly there.

              TWO STATES, AND BOTH ARE ASSERTABLE NOW — the seam this block was
              written against has been joined:
                - `read-limit` — "this is as far back as vam has read". True
                  whenever the window is what ended the list.
                - `session-start` — "the session begins here". Drawn only on
                  `TranscriptPage.reachedStart`, which is a POSITIVE fact read
                  off a window that began at byte 0 and is never inferred from
                  an empty page. A boundary that guessed would be the same lie
                  in the other direction, so nothing else may set it.

              AND A CONTROL, BECAUSE THERE IS NOW SOMETHING BEHIND ONE. What
              this comment used to say — a button with nothing behind it is
              worse than a sentence — has not changed; what changed is that
              `source.history` exists (`sources/port.ts`), so the button acts.
              The rule it kept is kept: ABSENT, NOT DIMMED. The control is
              simply not in the DOM for a source that cannot page, while a walk
              is in flight, or once the start is proven — see `moreState` in
              `transcript-history.ts`, which is the one place those states are
              decided.

              FOUR ANSWERS AND THEY STAY FOUR ON SCREEN, because they are four
              different things for an operator to do about:
                - turns arrived        → they are simply above; nothing is said.
                - the start was proven → `session-start`, and no control.
                - vam read further back and found no whole turn (the ORDINARY
                  answer on a large session, ~2.5 MB of transcript per turn)
                  → still `read-limit`, still offering to go on. Never an end.
                - vam could not read   → `unavailable`, in the SOURCE's own
                  words, plus a retry, because the cursor did not move.
            */}
              {/* THE RESERVED CORNER, audit F1's obligation, inherited by
                whatever sits at the top of the column: at scrollTop 0 that is
                this block, and the view-icon pill is opaque. The prompt
                bubbles discharge it with a float (only their first line meets
                the pill); this is two short lines that all meet it, so it is
                padding. 6rem is the measured pill plus 24px, the same figure
                and the same reason as the float. Only while the overlay is
                drawn -- an unfocused pane paints no pill, and reserving for
                one would notch every pane the operator is not in. */}
              <div
                data-column-start={pagerNow.phase === 'start' ? 'session-start' : 'read-limit'}
                /* 11.5px, NOT the 10.5px of the turn lines this block's facts
                 came off. The operator has twice asked for small type to come
                 up a pixel, and a repo-wide bump is its own task (198 literals,
                 18 files, no type scale to change in one place) -- so a NEW
                 call site takes the size it would have AFTER that bump rather
                 than adding one more literal below the floor. The turn lines
                 and the bar below keep 10.5 because they are the existing
                 progress line, moved, not new type. */
                /* Full-bleed to BOTH pane edges, which now means two different
                 numbers: `-ml-3.5` gives back the column's left padding and
                 `-mr-11` gives back the jump gutter, so this block's own
                 padding puts its text exactly where the column's content box
                 is. One `-mx-3.5` would leave it 30px short of the right edge
                 -- invisible here, since this block paints no ground, and a
                 trap for whoever gives it one. */
                className={`-ml-3.5 -mr-11 flex flex-none flex-col gap-0.5 pt-3 pb-1 pl-3.5 font-mono text-meta text-ink-faint ${
                  cornerOverlay ? '' : 'pr-11'
                }`}
                style={cornerOverlay ? { paddingRight: cornerReserve } : undefined}
              >
                {/* PHONE: the three lines below (count, the "as far back"
                  caveat, and the read-more control) collapse to ONE compact
                  row -- the operator's own report, "costs ~3 lines above
                  every conversation" on the screen with the least of them to
                  spare. SAME BEHAVIOUR (`readOlder`, unchanged) and SAME
                  ACCESSIBILITY-NAME SEMANTICS: the full sentence every state
                  below prints moves into `aria-label`, the same trade this
                  file already makes for the Send button (a glyph plus a
                  `Note` carries what a visible word used to) -- nothing here
                  reads worse to a screen reader for reading shorter to an
                  eye. Desktop is untouched: the `<>...</>` branch below is
                  byte-identical to what stood here before this shipped. */}
                {phone ? (
                  (() => {
                    const failedNote =
                      failedRead !== null && failedRead > 0
                        ? ` · ${failedRead} failed`
                        : focusView && failedRead === null
                          ? ' · failures not reported by this source'
                          : '';
                    const stateNote =
                      pagerNow.phase === 'start'
                        ? 'The session begins here — vam read back to its first turn.'
                        : 'This is as far back as vam has read — not necessarily where the session began.';
                    const compactBase = `${turnsRead} turns read${failedNote}. ${stateNote}`;
                    if (columnMore === 'available' || columnMore === 'unavailable') {
                      const errorNote =
                        columnMore === 'unavailable' && pagerNow.error !== null
                          ? ` vam could not read further back — ${pagerNow.error.code}: ${pagerNow.error.message}.`
                          : '';
                      return (
                        <button
                          type="button"
                          data-column-start-compact
                          data-column-more={columnMore}
                          onClick={readOlder}
                          aria-label={`${compactBase}${errorNote} ${
                            columnMore === 'unavailable' ? 'Try again.' : 'Read earlier turns.'
                          }`}
                          className="vam-tap flex w-full cursor-pointer items-center gap-1 py-0.5 text-left font-mono text-meta text-ink-faint hover:text-ink-dim"
                        >
                          {columnMore === 'unavailable'
                            ? 'Earlier turns — try again ↑'
                            : 'Earlier turns ↑'}
                        </button>
                      );
                    }
                    return (
                      <p
                        data-column-start-compact
                        data-column-more={columnMore ?? undefined}
                        // `role="status"` for all three (not only "reading"):
                        // the bare `<p>`'s implicit paragraph role supports no
                        // accessible name at all, so `aria-label` below would
                        // be silently dropped -- `status` is the one role
                        // already in use on this line for the live case, and
                        // it names the other two honestly enough (a fact
                        // about the pager, read once on arrival) to reuse
                        // rather than adding a second role for the same shape.
                        role="status"
                        aria-label={
                          columnMore === 'reading'
                            ? `${compactBase} Reading further back…`
                            : columnMore === 'unsupported'
                              ? `${compactBase} This source cannot read further back than its own window.`
                              : compactBase
                        }
                        className="py-0.5 font-mono text-meta text-ink-faint"
                      >
                        {columnMore === 'reading'
                          ? 'Reading earlier turns…'
                          : columnMore === 'unsupported'
                            ? "Earlier turns — can't read further back"
                            : 'Session start ↑'}
                      </p>
                    );
                  })()
                ) : (
                  <>
                    {/* WRAPPING, since the qualifier below can be a PHRASE where
                  this row has only ever held tokens.

                  IT IS NOT WHAT STOPS THE OVERFLOW, and saying so would be the
                  kind of comment this file is written against: a flex item of
                  text shrinks and wraps inside itself, so the sentence stays
                  on the pane either way -- MEASURED, at the 320px pane floor,
                  by deleting this class and watching the guard stay green.

                  WHAT IT SAVES IS THE COUNT. Without it, at that floor, "N
                  turns read" is squeezed to 49px and breaks across two lines
                  beside a three-line caveat -- two ragged columns where there
                  should be a count and a note. With it the count keeps its one
                  line and the caveat takes the next. Both figures are measured
                  in `e2e/transcript-column-shots.mjs`, which fails if either
                  the count breaks or the caveat leaves the pane.

                  `gap-y-0.5`, matching the 2px this block already puts between
                  its own two children, so a wrapped caveat sits at the block's
                  rhythm rather than flush against the line above it. The
                  horizontal 6px is unchanged. */}
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      {/* "read", not a bare count: only the newest `TAIL_BYTES` is
                    ever opened, so on a session bigger than that window this
                    is what vam FOUND, not a provable total for the session's
                    whole life. Trailing, not leading: "read 7 turns" is an
                    imperative -- a command this line does not carry out --
                    while "7 turns read" is what it actually is, a count with
                    its qualifier attached. */}
                      <span data-progress-count>{turnsRead} turns read</span>
                      {/* THE FOLD MAY COST DETAIL, NEVER ALARM. Every turn carries
                    its own `· N failed` on its own line below; this is the
                    total across the window, beside the count of that same
                    window, which is what lets the two share a line honestly.
                    `null` is "no turn read can report failures at all" and
                    draws nothing -- a confident "0 failed" over data nobody
                    looked at is the same lie as a false badge. */}
                      {failedRead !== null && failedRead > 0 && (
                        <span data-column-failed className="text-failed">
                          · {failedRead} failed
                        </span>
                      )}
                      {/* WHAT COLLAPSING PROMISES, AND WHERE THE PROMISE IS EMPTY.
                    While every turn draws its line, the line claims nothing
                    about failure -- it says which turn it is. Collapsed, the
                    ABSENCE of a line is the claim: nothing here was worth
                    stopping for. Over a source with no failure surface at all
                    that claim is unearned, and the operator has no way to tell
                    it from a window vam read and found clean.

                    SO IT IS SAID ONCE, HERE, and not per turn: this is a fact
                    about the WINDOW -- the same window `turns read` and the
                    total beside it qualify -- and a caveat repeated on every
                    turn would be the noise the operator asked to be rid of.
                    `failedRead === null` is exactly "no turn read carries the
                    field at all", which is where the two unknowns part: zero
                    is a reading and says nothing, absent is a source that
                    cannot look and says so.

                    NO EMPTY-WINDOW CASE TO GUARD, and it is worth saying why
                    rather than guarding it twice: zero turns read would be vam
                    having read nothing, which is not a source that cannot
                    report -- but this whole block sits inside the branch that
                    runs only when `orderedTurns.length > 0` (the empty column
                    is a sentence instead, above). A `turnsRead > 0` here read
                    as caution and was unreachable, which is worse than absent:
                    it is a condition no test can ever falsify.

                    `ink-dim`, not `failed`: this is a caveat about what vam
                    could not see, not a report that something went wrong.
                    Painting it as an alarm would make every source without the
                    surface look like a source on fire. */}
                      {focusView && failedRead === null && (
                        <span data-column-unreadable className="text-ink-dim">
                          · failures not reported by this source
                        </span>
                      )}
                    </div>
                    {/* THE SENTENCE IS THE STATE, and there are exactly two of them
                  because there are exactly two things vam can honestly say
                  about the top of a column. The attribute above and this line
                  are read off the SAME fact, so a screen that says one thing to
                  a test and another to a person is not expressible here. */}
                    <p data-column-start-note className="text-ink-faint leading-[1.5]">
                      {pagerNow.phase === 'start'
                        ? 'The session begins here — vam read back to its first turn.'
                        : 'This is as far back as vam has read — not necessarily where the session began.'}
                    </p>
                    {/* WHAT VAM CAN DO ABOUT THAT, or why it cannot. Absent
                  entirely once the start is proven: there is nothing left to
                  ask for, so there is nothing to ask with. */}
                    {columnMore !== null && (
                      <p
                        data-column-more={columnMore}
                        className="flex flex-wrap items-baseline gap-x-1.5 leading-[1.5]"
                      >
                        {columnMore === 'unsupported' ? (
                          // A STATED REFUSAL, NOT A DEAD CONTROL. `history` absent
                          // from the port is "this source has no way to page", which
                          // is a different sentence from "there is nothing older" --
                          // `pull-requests.ts`'s rule, at the one place in this pane
                          // it can still be got wrong.
                          <span data-column-more-note>
                            This source cannot read further back than its own window.
                          </span>
                        ) : columnMore === 'reading' ? (
                          // A STATUS, NEVER A DIMMED BUTTON: mid-flight a control is
                          // either painted and inert or half-painted and live, and
                          // both are states this pane must not have. It says what is
                          // happening and claims nothing about what will be found --
                          // no count, no progress bar, because vam does not know how
                          // much is there.
                          <span data-column-more-note role="status">
                            Reading further back…
                          </span>
                        ) : (
                          <>
                            {columnMore === 'unavailable' && pagerNow.error !== null && (
                              // THE SOURCE'S OWN WORDS, `code: message`, the same
                              // shape every other refusal in this pane renders --
                              // and the reason `SourceError` travels the bridge
                              // verbatim (`sources/port.ts`'s `describeFailure`).
                              <span data-column-more-error className="text-failed">
                                vam could not read further back — {pagerNow.error.code}:{' '}
                                {pagerNow.error.message}
                              </span>
                            )}
                            <button
                              type="button"
                              data-column-more-ask
                              onClick={readOlder}
                              /* `vam-tap` FOR THE PHONE'S FLOOR, and it is opt-in
                             by design (`styles.css`): the stylesheet sizes a
                             tap target, the component decides what one is.
                             Measured without it at 390px this link was
                             119.2x16.5 -- half a touch target, and the only
                             way to reach anything older than the last page. */
                              className="vam-tap cursor-pointer text-ink-dim underline decoration-dotted hover:text-ink"
                            >
                              {columnMore === 'unavailable' ? 'Try again' : 'Read earlier turns'}
                            </button>
                          </>
                        )}
                      </p>
                    )}
                  </>
                )}
                {/* THE PICK IS GONE, BUT NOT THE ANSWER TO IT. A turn can fall
                  out of the window between one poll and the next; falling
                  through to some other turn would look identical to the
                  operator to having actually read the one they asked for.
                  Said here, at the boundary that explains WHY it is gone,
                  rather than in place of the column: the rest of the session
                  is still there to read, and hiding it to print one sentence
                  was the old single-turn pane's constraint, not a rule. */}
                {selectedTurnMissing && (
                  /* No size of its own: it inherits the block's, which is the
                   right size for it and one literal fewer to keep in step. */
                  <p data-progress-turn-missing className="text-ink-faint leading-[1.5]">
                    The turn you were reading has scrolled out of what vam can see.{' '}
                    <button
                      type="button"
                      data-progress-turn-return
                      onClick={() => {
                        if (canvasDecisionId === null) setSelectedId(null);
                        else pickTurn(canvasDecisionId);
                      }}
                      className="cursor-pointer text-ink-dim underline decoration-dotted hover:text-ink"
                    >
                      Back to the current turn
                    </button>
                  </p>
                )}
              </div>

              {/* EVERY TURN, OLDEST FIRST. `decisions` arrives newest first
                (model.ts); reversed here so the newest lands at the bottom,
                where a conversation's newest line belongs and where the column
                opens. Keyed by the turn's own content-derived id
                (`transcript.ts`), so a poll that appends a turn does not
                remount the ones already on screen -- which at 3,276 turns is
                the difference between a scroll and a freeze. */}
              {orderedTurns.map((d) => (
                <TurnBlock
                  key={d.id}
                  decision={d}
                  marked={d.id === markedId}
                  newest={d.id === newestId}
                  live={d.id === newestId && sessionRunning}
                  /* `session.activity` and `waitingFor` describe the present, so
                   they are handed to the newest turn and to no other -- on an
                   older turn they described the present while the operator
                   read the past. Passed as `null` elsewhere rather than gated
                   at the call site so the block has one rule to follow. */
                  activity={d.id === newestId ? (entry?.session.activity ?? null) : null}
                  waitingCause={d.id === newestId ? waitingCause : null}
                  age={d.id === newestId ? liveAge : null}
                  status={entry?.session.status ?? null}
                  reserveCorner={cornerOverhang}
                  focusView={focusView}
                  unfolded={unfolded.has(d.id)}
                  onUnfold={unfold}
                  onPromptMenu={openPromptMenu}
                  onAnswerMenu={openAnswerMenu}
                />
              ))}
              {/* PHONE, RESPONSE VIEW ONLY (docs/design/phone-core-loop.md
                §3.2-3.3): the pending question, drawn as the NEWEST item in
                THIS SAME scroller instead of `DetailPanel`'s fixed footer
                block below (`data-question-bar`, `!phone` there). AC-1: one
                scrollable container holds both a prior turn's text and
                `[data-question-option]`. `sticky bottom-0` (not `flex-none`,
                per AC-2) so it reads as "the thing demanding attention" at
                the bottom of the scroll content without being pinned
                outside it -- scrolling UP into history lets it scroll out
                of view like any other message, which is what the jump-to-
                question pill (§3.2 deviation) answers. `QuestionCard`'s own
                internals are UNCHANGED -- `phone` only swaps its root
                classes; see that prop's own doc. */}
              {phone && current === 'Response' && newestQuestion !== null && (
                <div
                  ref={questionInlineRef}
                  data-question-bar-inline
                  {...insertScopeMark}
                  className="sticky bottom-0 flex flex-col bg-pane pt-1.5"
                >
                  <QuestionCard
                    key={setId}
                    questions={newestQuestions}
                    firstOptionRef={firstOptionRef}
                    onChat={startChat}
                    onAnswer={questionOnAnswer}
                    onSuggest={setSuggestion}
                    phone
                  />
                </div>
              )}
            </div>
            {/* THE JUMPS, FLOATING OVER THE COLUMN — what is left of the bar
                that used to hold them, and of two more controls that went with
                it (the turn-list chevron, and the `<select>` that jumped to a
                turn; the column draws every turn, so both were a second way to
                do what the scrollbar does).

                THE OPERATOR'S REPORT WAS THE STRIP, not the buttons: a
                `bg-ground` band across the pane's full width, drawn on every
                session whether or not either glyph in it was, eating a row of
                the transcript to say nothing. Gone. What is left is the two
                controls, at the two edges they take you to.

                WHY THEY CAN LIVE HERE AT ALL. The bar was sticky at the BOTTOM
                and argued for it: an operator scrolled far up must not have to
                scroll back down to find the control that scrolls them back
                down -- a circle. That argument survives its bar and is what
                `absolute` discharges now: each jump is pinned to the column's
                own edge at every offset, so neither can ever be scrolled away
                from. What does NOT survive is the rest of it -- the top being
                "spoken for by the pinned prompt" was true of a band that would
                have covered it; a 28px chip in a reserved 44px gutter covers
                no part of it (see the column's `pr-11`).

                DRAWN ONLY WHILE IT WOULD MOVE THE COLUMN, the rule the bar
                already got right and the reason this is not two permanent
                chips: `hasContentAbove`/`hasContentBelow` (`stick-to-bottom.ts`)
                share their slack with the stick rule, so the pane never offers
                a jump to where it already is. That rule is also the whole of
                "appear when scrolling": at rest at the bottom -- where a
                session opens -- there is nothing above, so nothing is drawn,
                and the first scroll is what brings them.

                AND NO IDLE FADE. Fading a control out after a moment reads
                well and cannot be built honestly here: mid-transition a button
                is either half-painted and still clickable or fully painted and
                already inert, and both are the state this pane must never
                have. It is also the circle again -- a reader who stops to read
                loses the control that takes them back. So a jump is either
                there, at full opacity and hit-testable, or it is not in the
                DOM.

                `pointer-events-none` on the layer, restored on each button:
                the layer spans the column's whole height, and a transparent
                sheet over a transcript would swallow the selection the pane
                exists to allow (`select-text` on the body). */}
            <div
              data-column-jumps
              className="pointer-events-none absolute inset-y-0 right-0 z-30 w-11"
            >
              {/* BELOW THE RESERVED CORNER (audit F1), not beside it. The
                  view-icon pill is opaque and floats at the pane's top right;
                  measured at five widths it occupies the column's own y 8-42,
                  x width-100 to width-10 -- so a jump at the column's top right
                  would sit under it. `top-12` starts this one 48px down, 6px
                  clear of the pill's bottom edge, and it is a CONSTANT: the
                  pill is drawn only on a focused pane, and a control that moved
                  when the operator clicked a different pane would be a control
                  they had to look for. */}
              {jumps.above && (
                <button
                  type="button"
                  data-out-to-top
                  aria-label="scroll to the oldest turn read"
                  onClick={() => jumpTo('top')}
                  /* THE HIT IS 44, THE PAINT IS 28 -- `PhoneShell.tsx`'s own
                     bargain, for the same reason and on the same screen: the
                     44 box is WCAG 2.2 SC 2.5.5 and this pane is the phone's
                     session screen, while a ground painted on all 44 of it
                     would put a slab over the transcript. */
                  className="pointer-events-auto absolute top-12 right-0 flex h-11 w-11 cursor-pointer items-center justify-center"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-card text-ink-dim shadow-sm hover:bg-line-strong hover:text-ink">
                    <ChevronsUp size={14} strokeWidth={1.8} />
                  </span>
                </button>
              )}
              {/* At the bottom edge, where the newest turn is. `bottom-1`
                  rather than flush, so the chip is not cut by the pane's own
                  seam with the composer below it.

                  PHONE, WITH AN OPEN QUESTION SCROLLED OUT OF VIEW: this
                  slot draws the "jump to question" pill instead of the bare
                  chevron -- DEVIATION, approved (docs/design/
                  phone-core-loop.md §3.2, §3.7 PR4). Same corner, same
                  `jumpTo('bottom')` (the question is always the newest item
                  in the scroller, so scrolling to bottom IS scrolling to it
                  -- no second scroll mechanism), a more specific label
                  instead of a bare chevron: an operator who has scrolled up
                  to read history should be told WHY jumping back down
                  matters, not just that something is there. Never BOTH
                  controls at once in one corner. */}
              {phone && openQuestion && !questionInViewport && current === 'Response' ? (
                <button
                  type="button"
                  data-jump-to-question
                  aria-label={`${openStepCount} question${openStepCount === 1 ? '' : 's'} pending — jump to it`}
                  onClick={() => jumpTo('bottom')}
                  className="vam-tap pointer-events-auto absolute right-0 bottom-1 flex h-11 items-center justify-center"
                >
                  <span className="flex h-7 items-center gap-1 rounded-full border border-waiting bg-card px-2 text-control text-waiting shadow-sm">
                    <ChevronsDown size={14} strokeWidth={1.8} aria-hidden="true" />
                    {openStepCount}
                  </span>
                </button>
              ) : (
                jumps.below && (
                  <button
                    type="button"
                    data-out-to-bottom
                    aria-label="scroll to the newest turn"
                    onClick={() => jumpTo('bottom')}
                    className="pointer-events-auto absolute right-0 bottom-1 flex h-11 w-11 cursor-pointer items-center justify-center"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-card text-ink-dim shadow-sm hover:bg-line-strong hover:text-ink">
                      <ChevronsDown size={14} strokeWidth={1.8} />
                    </span>
                  </button>
                )
              )}
            </div>
          </div>
        )}
        {/* THE LAST SEND THAT FAILED, at the foot of the out area -- directly
            above the composer the words came from, and drawn whether or not
            this session has a transcript yet.

            Operator instruction: a send that errors must say so in the out
            area, not only in the status bar. OUTSIDE the scrolling column on
            purpose, because the column is not always there: a session created
            a moment ago has no turns, so `orderedTurns.length === 0` draws
            "This session has no steps yet" instead -- and a brand new session
            is exactly where the first send fails. A note living inside the
            column would have been invisible in the one case it was reported
            for.

            NOT THE `data-session-failed` BANNER, which sits above the column
            and says something else: that one is a standing fact about the
            session, this is the verdict on one act, and it goes away when the
            operator tries again.

            `role="status"` rather than `alert`: it appears right after the key
            the operator pressed and the same words reach the status bar, so
            assertive would interrupt a screen reader to repeat something. */}
        {current === 'Response' && sendFailure !== null && (
          <p
            data-send-failed
            role="status"
            className="flex flex-none items-start gap-1.5 rounded-[9px] border border-failed bg-card px-3 py-2 text-control text-failed"
          >
            <span role="img" aria-label="failed" className="flex pt-[2px]">
              <CircleSlash size={13} strokeWidth={1.6} />
            </span>
            <span className="min-w-0 flex-1">{sendFailure}</span>
          </p>
        )}
        {/* ALWAYS MOUNTED WHILE THIS BUILD HAS THE BRIDGE -- deliberately NOT
            gated behind `current === 'Files'` the way `TerminalTab` is gated
            behind `current === 'Terminal'`. `TerminalTab`'s own header says
            what it costs to unmount-and-remount: nothing, because there is a
            poll to stop. An open file's UNSAVED TEXT is not nothing -- "the
            worst outcome this feature can have, worse than not shipping it"
            was the exact instruction this tab was built against -- so
            `FilesTab` stays mounted for as long as this panel shows ANY tab,
            keeping every open buffer's dirty text in memory across a switch
            to Response/PRs/Terminal/Agents and back. `hidden` (`display:
            none`) removes it from layout and from the Tab order without
            unmounting it, which is the one property this choice needs: React
            state survives, nothing currently on screen shows it, and it costs
            no timer and no IPC while hidden -- `FilesTab` itself polls
            nothing, unlike Terminal's `capture-pane`. */}
        {/* `Suspense` with a `null` fallback: `FilesTab` is its own lazy
            chunk now (see `LazyFilesTab`'s declaration above). Its own
            `hidden` prop already renders NOTHING visible whenever
            `current !== 'Files'` -- the common case, since a fresh
            session opens on Response -- so the fallback is indistinguishable
            from the resolved, hidden component in that case. The one case
            it is not free is a session that opens straight onto the Files
            tab, where the chunk (already cached after the first open in the
            app's life) resolves a render tick or two after mount rather
            than painting synchronously. */}
        {files === true && (
          <Suspense fallback={null}>
            <LazyFilesTab
              hidden={current !== 'Files'}
              // The same claim `Alt+<digit>` is gated on, passed one layer
              // further down: this tab answers `Mod-p` on the WINDOW, so every
              // mounted instance hears every keystroke and only the pane holding
              // the keyboard may act on one. See `FilesTab`'s own prop comment.
              paneFocused={paneFocused}
              sessionId={entry?.session.id ?? null}
              list={globalThis.window?.api?.files?.list}
              read={globalThis.window?.api?.files?.read}
              write={globalThis.window?.api?.files?.write}
              // The quit guard's half of the same bridge. `beforeunload` (armed
              // inside `FilesTab`, off the SAME derivation) covers the window
              // closing; this covers Cmd-Q, which reaches `app.on('before-quit')`
              // in main and never reaches the page at all. Absent in the browser
              // build, which has no application to quit. See
              // `src/main/quit/guard.ts`.
              reportUnsaved={globalThis.window?.api?.files?.reportUnsaved}
              // The view-icon corner overlay (`data-view-overlay`, further down
              // this file) floats ABOVE this tab's own content at `top-2
              // right-2.5`, real clicks and all -- measured directly: the Save
              // button sat under the Agents icon until this was threaded
              // through -- and `6rem` was not enough once this tab's own icon
              // widened the pill, so it is the MEASURED `cornerReserve` rather
              // than a constant. See its own comment above.
              reserveCorner={cornerReserve}
              // And the pill's VERTICAL footprint, which this tab needs now
              // that its right-hand column IS the corner. See
              // `cornerReserveHeight`'s own comment above.
              reserveCornerHeight={cornerReserveHeight}
              // The dragged tree width and the way to store a new one. Both
              // come from the shell that owns `prefs`; `undefined` here draws
              // the share and no handle, which is what the browser build and
              // every test that has not wired a store get. See the two props'
              // own comments above.
              filesTreeWidth={props.filesTreeWidth ?? null}
              onFilesTreeWidth={props.onFilesTreeWidth}
              onFilesMarkdownView={props.onFilesMarkdownView}
              // "Open this file, at this line" -- from a `path:line` control in
              // an agent's own answer, already resolved and authorised in main.
              // See `outActions.openFileRef` above and `FileOpenRequest`.
              openRequest={fileOpenRequest}
            />
          </Suspense>
        )}
      </div>

      {/* The question's own block, drawn only when there IS one: it was split
        off the composer's so the composer could stand down while a question is
        open, and a block that outlived its contents would be a doubled seam
        and 25px of dead height in the pane's most common state. */}
      {/* Drawn for a QUESTION and nothing else now. It used to open on
        `waitingFor` too, for the notice above the prompt input the operator
        asked to remove; keeping that disjunct would draw a bordered empty
        block on every waiting session -- a seam with nothing behind it. */}
      {/* NOT ON `Files` EITHER, same reasoning as Terminal: a full-pane
        surface with its own keyboard (the editor's own insert scope) has no
        room for a question card floating over it, and the question this
        card answers is the AGENT's, unrelated to a file the operator opened
        to read or edit by hand. */}
      {/* NOT ON PHONE'S RESPONSE VIEW (docs/design/phone-core-loop.md
        §3.2-3.3): the fixed block this comment describes is exactly what the
        spec moves there -- `QuestionCard` mounts INLINE, as the newest item
        inside the transcript's own scroller, instead of here. See
        `data-question-bar-inline` below. Every OTHER view (Agents, on
        phone -- PRs is already cut from phone by `visibleTabs`) keeps this
        fixed block: it has no transcript scroller of its own to inline
        into, and the operator's brief is about the reply loop, not about
        withdrawing the card from a roster view that never had one to
        replace. Desktop is unchanged either way. */}
      {(!phone || current !== 'Response') &&
        current !== 'Terminal' &&
        current !== 'Files' &&
        newestQuestion !== null && (
          <div
            data-question-bar
            // AN INSERT SCOPE (`keyboard/focus-scope.ts`): while anything in
            // here holds the keyboard, the app IS in Insert. That is the whole
            // definition of the mode now, which is why there is no flag left
            // that could disagree with it. The card's options are also the
            // LANDING `I` aims at, by being the first stop in document order.
            {...insertScopeMark}
            /* NARROWED WITH THE TRANSCRIPT, on the operator's own instruction --
             see the body's comment. The SEAM is what makes this more than
             symmetry: `border-t` above draws the rule between the answer and
             the question, and a rule spanning the whole pane under a 470px
             column is a line pointing at nothing. Capped here, it is the
             column's own seam.

             THE BODY'S CAP, NOT THE FLAG'S. This card is also drawn on the
             Agents view, which the flag does not cap (`narrowsAsProse`), and
             the seam argument runs the other way there: a 890px card under a
             1336px navigator is the same line pointing at nothing. */
            className={`flex flex-none flex-col gap-2.5 border-line border-t bg-pane px-3.5 py-3 ${
              bodyMaxWidth === undefined ? '' : 'mx-auto w-full'
            }`}
            style={bodyMaxWidth === undefined ? undefined : { maxWidth: bodyMaxWidth }}
          >
            {/* The factory's governance queue — findings awaiting a waiver, and
            lesson candidates — used to stand here. The operator asked for it
            to go, and it is gone from `buildActions` too: it went on
            contributing keyboard stops and a live `Enter` to this pane long
            after the rows themselves stopped being drawn. */}
            {/* The `!` typeahead, above the box it completes into -- where the
            standing command strip used to be, and only while it is being
            asked for. The strip drew every proposed command on every turn
            that mentioned one; this draws the same list, from the same
            extraction, at the moment the operator types the glyph it belongs
            to. */}
            {/* The question the session is asking, where the placeholder picker
            used to stand -- the newest one, because a card per question would
            turn a pane into a queue. It answers nothing; see `QuestionCard`.
            A session that asked none, or asked outside the tail vam reads
            (`TAIL_BYTES`), draws nothing here rather than an empty box. */}
            {newestQuestion !== null && (
              <QuestionCard
                key={setId}
                questions={newestQuestions}
                firstOptionRef={firstOptionRef}
                onChat={startChat}
                onAnswer={questionOnAnswer}
                onSuggest={setSuggestion}
              />
            )}
          </div>
        )}
      {/* The composer, in its own block so that it can stand down while a
        question is open without the card standing down with it. Its top border
        is the seam between the two, and belongs to whichever of them is
        drawn first.

        `bg-pane`, NOT `bg-header`. Both this block and the question block
        above it painted `header`, a darker rung than the pane around them,
        which is the other half of the operator's report -- "black background
        areas below the prompt input". The SEAM is the border and always was;
        the fill step
        was a second separator saying the same thing in a darker colour, and it
        is the darker colour they were looking at. Nothing else in the app
        wears `header` now; the token stays defined, unworn, rather than being
        deleted out from under a theme that still names it. */}
      {/* WHICH VIEWS GET ONE IS `drawsComposer`'s (`tabs.ts`), not a chain of
        `!==` here. It used to be exactly that chain, and the cost was that a
        new tab inherited an answer instead of being given one: the operator
        found the box drawn under the PRs list, a view where nothing typed is
        addressed to anything -- and then, a day later and in the same words,
        under the Agents ROSTER. The reasons -- Terminal and Files own their
        own keyboards, PRs and Agents are lists a typed sentence cannot act on
        -- are written beside the names they are about, and
        `DetailPanel.composer-tabs.test.tsx` derives its whole expectation from
        that one predicate. Response is the only view left that draws a box,
        and that is the OUTCOME of four separate answers rather than a rule
        about transcripts: a sixth tab still has to be classified by name.

        `composerHidden` is the orthogonal half and stays here: it is about
        this SESSION (none selected, a source that cannot record, a question
        open), not about which view is on. */}
      {drawsComposer(current) && !composerHidden && (
        <div
          data-composer-bar
          ref={composerBarRef}
          // The other insert scope, and the common one: with no question open
          // this block is the whole of Insert. See the question bar above.
          {...insertScopeMark}
          className={[
            // `relative` is the anchor for `SUGGEST_LAYER`, which floats the
            // typeaheads OVER the transcript instead of pushing this block
            // down the pane. See that constant for the measurement behind it.
            'relative flex flex-none flex-col bg-pane px-3.5',
            // PHONE: the bar's own chrome shrinks from `gap-2.5 py-3` (10/24px)
            // to `gap-1.5 pt-1 pb-2` (6/4/8px) -- half of AC-7's height budget
            // (docs/design/phone-core-loop.md §3.4/§4.1/§4.7). Desktop keeps
            // the original figures untouched. TOP AND BOTTOM SPLIT, not
            // `py-*`: the bottom edge is already floored to 12px by the
            // safe-area rule below (`max(12px, env(safe-area-inset-bottom))`,
            // `styles.css`) regardless of what this class asks for, so `pb-2`
            // here is inert paint-time filler for the one frame before that
            // rule resolves -- the TOP edge is the only one this class still
            // controls, and it is what closed AC-7's ≤76px stretch target
            // once the textarea itself stopped over-measuring (§4.7's own
            // postmortem, followed up).
            phone ? 'gap-1.5 pt-1 pb-2' : 'gap-2.5 py-3',
            newestQuestion === null ? 'border-line border-t' : '',
            // NARROWED WITH THE TRANSCRIPT, on the operator's own instruction
            // -- see the body's comment for the decision and the seam argument
            // on the question bar above for why the rule has to move with it.
            proseMaxWidth === undefined ? '' : 'mx-auto w-full',
          ].join(' ')}
          style={proseMaxWidth === undefined ? undefined : { maxWidth: proseMaxWidth }}
        >
          {/* First child, so it inherits `composerHidden` for free: a
              `QuestionCard` open and unanswered withdraws the whole composer
              block, this strip included -- one surface answering one prompt,
              rather than two competing ones. Gated on `phone` too: this file
              is shared with the desktop detail column, and un-gating this
              would put the strip there the moment `canSendKeys` held, which
              nothing asked for. */}
          {phone && canSendKeys && (
            <nav
              aria-label="press a key in the session"
              data-key-strip
              className="flex flex-none items-center gap-1.5"
            >
              {KEY_STRIP.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-key-strip-key={item.id}
                  aria-label={item.ariaLabel}
                  onClick={() => void sendKey(item)}
                  className="vam-tap flex flex-none items-center justify-center"
                >
                  <span
                    data-tap-skin
                    // `data-tap-pill` (`styles.css`): the shared
                    // `.vam-phone .vam-tap > [data-tap-skin]` rule pins every
                    // skin to a 30x30 SQUARE, which is correct for the icon
                    // skins it was written for and wrong for a skin holding
                    // TEXT -- "Esc → agent" measured 72px wide and, clamped to
                    // 30, spilled into the next chip on a real render (caught
                    // only by a screenshot; `getBoundingClientRect()` on the
                    // 44px hit box stays green regardless). This opts out of
                    // the square into a width-to-content pill, hit still 44,
                    // paint still 30 tall.
                    data-tap-pill
                    className="flex h-[30px] min-w-[30px] shrink-0 items-center justify-center whitespace-nowrap rounded-[8px] border border-line-strong bg-card px-1.5 font-mono text-control text-ink-quiet active:bg-line-strong"
                  >
                    <ChordGlyphs chord={item.chord} />
                    {item.suffix}
                  </span>
                </button>
              ))}
            </nav>
          )}
          {suggestOpen && (
            <div data-suggest-layer className={SUGGEST_LAYER}>
              {suggesting && (
                <div
                  data-bang-suggest
                  className={SUGGEST_BOX}
                  style={suggestMaxHeight === null ? undefined : { maxHeight: suggestMaxHeight }}
                >
                  <p className="px-1.5 pb-0.5 text-control text-ink-faint">
                    the agent proposed these — vam does not run them; Enter picks one, Esc keeps
                    what you typed
                  </p>
                  {matches.map((command, index) => (
                    <button
                      // KEYED ON THE COMMAND TEXT, not on `id`: the list spans
                      // turns now and two turns number their commands from `c1`
                      // independently, so ids collide across the column while the
                      // text cannot -- `commandsInColumn` deduplicates on it.
                      key={command.command}
                      type="button"
                      data-bang-suggestion
                      data-selected={index === picked ? 'true' : undefined}
                      onClick={() => acceptSuggestion(command)}
                      className={[
                        'flex cursor-pointer flex-col items-start gap-0.5 rounded-[6px] px-1.5 py-1 text-left',
                        index === picked ? 'bg-line-strong' : 'hover:bg-line-strong',
                      ].join(' ')}
                    >
                      <span className="max-w-full truncate text-control text-ink">
                        {command.label}
                      </span>
                      <span
                        data-bang-command
                        className="max-w-full truncate font-mono text-meta text-ink-dim"
                      >
                        {command.command}
                      </span>
                    </button>
                  ))}
                  {bangHidden > 0 && (
                    <p data-bang-more className="px-1.5 pt-0.5 text-meta text-ink-faint">
                      {bangHidden} more from earlier turns — keep typing to narrow
                    </p>
                  )}
                </div>
              )}
              {slashSuggesting && (
                <div
                  data-slash-suggest
                  className={SUGGEST_BOX}
                  style={suggestMaxHeight === null ? undefined : { maxHeight: suggestMaxHeight }}
                >
                  <p className="px-1.5 pb-0.5 text-control text-ink-faint">
                    the provider's own commands — Enter picks one, Esc keeps what you typed
                  </p>
                  {slashMatches.map((command, index) => (
                    <button
                      key={command.id}
                      type="button"
                      data-slash-suggestion
                      data-selected={index === slashPicked ? 'true' : undefined}
                      onClick={() => acceptSlashSuggestion(command)}
                      className={[
                        'flex cursor-pointer flex-col items-start gap-0.5 rounded-[6px] px-1.5 py-1 text-left',
                        index === slashPicked ? 'bg-line-strong' : 'hover:bg-line-strong',
                      ].join(' ')}
                    >
                      <span
                        data-slash-command
                        className="max-w-full truncate font-mono text-control text-ink"
                      >
                        /{command.name}
                      </span>
                      {command.description !== null && (
                        <span className="max-w-full truncate text-meta text-ink-dim">
                          {command.description}
                        </span>
                      )}
                    </button>
                  ))}
                  {slashHidden > 0 && (
                    <p data-slash-more className="px-1.5 pt-0.5 text-meta text-ink-faint">
                      {slashHidden} more — keep typing to narrow
                    </p>
                  )}
                </div>
              )}
              {/* WHAT VAM COULD NOT READ, said in the source's own words, and
              ABSENT rather than dimmed the rest of the time. It stands whether
              or not the list above it drew: a query that matches nothing
              closes that list, and that is exactly the moment the operator
              needs to know they are typing against a partial list rather than
              a complete one that has nothing for them. */}
              {slashGapNote !== null && (
                <div
                  data-slash-gap
                  className="rounded-[10px] border border-line-strong bg-card px-2.5 py-1.5"
                >
                  <p className="text-control text-ink-dim">
                    vam could not read all of Claude Code's commands, so this list is short of the
                    CLI's own: {slashGapNote.message}
                  </p>
                </div>
              )}
            </div>
          )}
          {/* THE ROW IS THE INSERT LANDING, AND THE BOX INSIDE IT IS NOT.
              `I` moves the keyboard into the pane and `i` puts the caret in
              the prose box; they were the same gesture in the flag's day,
              because the flag could not tell them apart. Landing on the ROW
              is what keeps them two: this element takes the focus, Insert's
              own `j`/`k` still reach the window listener from it (a focused
              TEXTAREA would be swallowed by that listener's typing guard, and
              the refusal this pane owes for a one-stop cursor would vanish),
              and `Enter` here is what opens the box for typing.

              `data-action-id="prompt"` is the action list's name for the same
              row; the two are deliberately not merged. One says WHICH action
              the pane cursor is on, the other says the keyboard can be sent
              here — a stop with no action and an action with no stop are both
              possible, and a shared attribute would hide the day one appears. */}
          <div
            data-prompt-box
            data-action-id="prompt"
            {...insertStopMark}
            tabIndex={-1}
            className={[
              'flex rounded-[10px] border bg-card outline-none',
              // PHONE: ONE row, not two (docs/design/phone-core-loop.md §3.4
              // PR 1's own follow-up, §4.1's postmortem). `flex-row flex-wrap
              // items-end` turns this box into the merged control row's own
              // flex context -- the textarea's wrapper and `data-prompt-tools`
              // both go `display: contents` below so their children (the "+",
              // the box, mic, Send) become direct items of THIS row instead of
              // two stacked ones. `items-end` anchors the fixed-size controls
              // to the textarea's OWN baseline as it grows upward, the same
              // shape iMessage/Claude's own composer draws. Desktop keeps the
              // original two-row `flex-col`, untouched.
              phone
                ? 'flex-row flex-wrap items-end gap-x-2 gap-y-1.5 px-2.5 py-1.5'
                : 'flex-col gap-2.5 px-3 py-2.5',
              active && actionIndex === 0 ? 'border-waiting' : 'border-line-loud',
            ].join(' ')}
          >
            {/* Multiline, because a prompt is prose and a one-line slot hides
            everything but the tail of it. The mockup's own composer is a
            104px-tall block of 12.5px/1.55 text, not an input. PHONE: this
            wrapper contributes no box of its own (`display: contents`) so its
            one child -- the textarea -- becomes a direct item of the merged
            row `data-prompt-box` now lays out; see that div's own comment. */}
            <div className={phone ? 'contents' : 'flex items-start gap-2'}>
              <textarea
                ref={inputRef}
                rows={phone ? 1 : 2}
                value={draft}
                readOnly={!composing}
                onFocus={onCompose}
                onChange={(event) => {
                  setCaret(event.target.selectionStart ?? event.target.value.length);
                  // Typing is how a dismissed list comes back, and how the
                  // highlight returns to the top of a freshly filtered one.
                  setDismissed(false);
                  setPick(0);
                  onDraftChange(event.target.value);
                }}
                onPaste={(event) => {
                  // A paste event carries its own `DataTransfer`, so this needs
                  // no permission and no trip through main -- unlike
                  // `navigator.clipboard`, which Electron's deny-all policy
                  // breaks (`src/main/clipboard/ipc.ts` exists for that).
                  const data = event.clipboardData;
                  const outcome = readPastedImages(data, images.length + 1);
                  if (outcome.kind === 'text') return;
                  event.preventDefault();
                  const box = event.currentTarget;
                  onDraftChange(
                    spliceDraft(draft, box.selectionStart, box.selectionEnd, outcome.text),
                  );
                  setImages([...images, ...outcome.images]);
                }}
                onKeyDown={(event) => {
                  // AN ENTER THAT ONLY COMMITS AN IME CANDIDATE IS NOT A SEND,
                  // and this is the first thing the box asks because EVERY
                  // Enter branch below would otherwise answer it -- the send,
                  // and both typeahead accepts.
                  //
                  // MEASURED in Chromium, the engine vam ships on, by driving
                  // a real composition through CDP `Input.imeSetComposition`:
                  // the commit key arrives as `{ key: 'Enter', keyCode: 13,
                  // isComposing: true }`, which no handler reading `key` alone
                  // can tell from a send. The operator types Vietnamese; every
                  // accented syllable ends in that keystroke, and each one was
                  // filing a half-typed prompt into a running agent.
                  //
                  // `event.nativeEvent.isComposing`, NOT `event.isComposing`.
                  // React's synthetic keyboard event does not carry the
                  // property at all -- its `KeyboardEventInterface` lists key,
                  // code, location, the four modifiers, repeat, locale,
                  // getModifierState, charCode, keyCode, which -- and
                  // `@types/react` omits it, so the plain spelling is
                  // `undefined` at runtime and the guard would be dead while
                  // looking exactly like a live one.
                  //
                  // RETURN, NOT `preventDefault`: the composition is mid-flight
                  // and this keystroke is what commits it. Claiming the event
                  // would leave the operator unable to finish the syllable.
                  // Scoped to Enter, so Escape and Tab still work for someone
                  // typing a non-Latin script.
                  if (event.key === 'Enter' && event.nativeEvent.isComposing) return;
                  // THE ENTER COLLISION, decided here. With the suggestion list
                  // open Enter ACCEPTS and sends nothing; only a closed list
                  // lets Enter through to `onSubmit`. Since the reply PR a send
                  // really delivers — into a tmux pane for a session vam
                  // started, with a CLI fallback — so an Enter that completed
                  // the word and shipped it as well would put a half-typed
                  // command into a running agent. Escape closes the list and NOT the composer,
                  // and leaves the typed `!` where it is: the operator may be
                  // writing a command of their own, and a second Escape still
                  // hands the keyboard back to the sidebar.
                  const suggestion = suggesting ? matches[picked] : undefined;
                  if (suggestion !== undefined) {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      const delta = event.key === 'ArrowDown' ? 1 : -1;
                      // Clamped, not wrapped, like every other cursor in this app.
                      setPick(Math.min(Math.max(0, picked + delta), matches.length - 1));
                      return;
                    }
                    // ENTER, IN BOTH MODES, AND DELIBERATELY NOT `submitsPrompt`.
                    // The send key is the operator's to swap (`prefs/submit-key.ts`);
                    // this is not the send. Accepting a completion does not
                    // deliver anything, Enter-accepts is the idiom every
                    // typeahead an operator has ever used follows, and a list
                    // that followed the pref would have NO accept key at all in
                    // `shift-enter` mode -- Shift+Enter would be the send there.
                    // `test/panels/DetailPanel.submit-key.test.tsx` holds this.
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      acceptSuggestion(suggestion);
                      return;
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setDismissed(true);
                      return;
                    }
                  }
                  // Same collision, same three keys, for the `/` list -- see the
                  // comment above `slashCommandQuery` for why this can never be
                  // open at the same time as the `!` block above.
                  const slashSuggestion = slashSuggesting ? slashMatches[slashPicked] : undefined;
                  if (slashSuggestion !== undefined) {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault();
                      const delta = event.key === 'ArrowDown' ? 1 : -1;
                      setPick(Math.min(Math.max(0, slashPicked + delta), slashMatches.length - 1));
                      return;
                    }
                    // Enter accepts here in both modes too, for the three
                    // reasons spelled out over the `!` branch above.
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      acceptSlashSuggestion(slashSuggestion);
                      return;
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setDismissed(true);
                      return;
                    }
                  }
                  // The window listener ignores keys typed in a textarea, so this
                  // box binds the ones it needs itself. WHICH of Enter and
                  // Shift+Enter sends is the operator's (`prefs/submit-key.ts`);
                  // whichever one does not is left alone, because it is the
                  // newline the box became multiline to allow.
                  //
                  // Shift+Tab is bound HERE, and deliberately not in the chord
                  // tables (`keyboard/chords.ts`), for two reasons that both
                  // decide it: that listener never sees a key typed in this
                  // box, which is where this one is pressed — the same place a
                  // person presses it in the session's own terminal — and
                  // `normalizeKey` gives Shift no token, so a table entry for
                  // `Tab` would answer a PLAIN Tab as well. Plain Tab is left
                  // alone: it is how a keyboard gets out of a textarea.
                  // THE OFFER, ACCEPTED -- and only while there is one, which
                  // is what keeps plain Tab the exit the rest of the time.
                  // See `promptSuggestion` for the whole rule.
                  if (event.key === 'Tab' && !event.shiftKey && promptSuggestion !== null) {
                    event.preventDefault();
                    onDraftChange(promptSuggestion);
                    return;
                  }
                  if (event.key === 'Tab' && event.shiftKey && canCycleMode) {
                    event.preventDefault();
                    void cycleMode();
                  } else if (submitsPrompt(submitKey, event)) {
                    event.preventDefault();
                    onSubmit();
                    // NOTE WHAT HAS NO BRANCH: the Enter that does NOT send.
                    // It has to fall out of this chain untouched so the
                    // textarea inserts the newline itself -- a
                    // `preventDefault()` on that path would hand the operator a
                    // box with no send AND no newline.
                  } else if (event.key === 'Escape') {
                    // THE INTERRUPT. With both typeahead lists closed (they
                    // answered Escape above and still do), Escape goes into the
                    // agent rather than out of the box -- Claude Code's own
                    // default, at the operator's request. `preventDefault` is
                    // what keeps `Canvas`'s `cancel` comment true: "an Escape
                    // typed INSIDE the composer never reaches here".
                    //
                    // The draft is NOT cleared and the keyboard is NOT moved.
                    // Claude does neither, and an interrupt that also cost the
                    // operator their half-typed prompt would be a worse trade
                    // than pressing nothing at all.
                    event.preventDefault();
                    // A popover opened from the tools row can still be up while
                    // the keyboard is in the box. It is a dialog, so it takes
                    // this Escape and the agent does not.
                    if (closeOpenPopover()) return;
                    interruptRun();
                  } else if (normalizeKey(event) === 'Mod-[') {
                    // AND THE WAY OUT, which Escape used to be. `Ctrl-[` IS
                    // Escape in vim and in a terminal, and `Mod` folds Ctrl and
                    // Cmd (`chords.ts`), so this is `Cmd+[` on the keyboard the
                    // operator has. Bound HERE rather than in the chord tables,
                    // for the reason Shift+Tab above is and for one more:
                    // `focusList` already holds `MAX_BINDINGS` chords
                    // (`Mod-Shift-h`, `Mod-0`), and a third would be invisible in the shortcut
                    // editor -- which draws exactly `MAX_BINDINGS` slots -- and
                    // destroyed by the first rebind of either. It is in
                    // `RESERVED_KEYS` instead, so nothing else can take it.
                    //
                    // BLUR, not just `composing = false`. Clearing the flag only
                    // makes this box read-only; while it still holds DOM focus
                    // the window key listener returns early on every keystroke
                    // (it ignores keys aimed at an INPUT or a TEXTAREA), so
                    // `j`/`k` land here and vanish and the sidebar is
                    // unreachable without a mouse. Releasing focus is what hands
                    // the keyboard back.
                    event.preventDefault();
                    inputRef.current?.blur();
                    onStopComposing();
                  }
                }}
                // The ghost, in the placeholder's own faint ink: unmistakably
                // not a draft yet, and naming the key that would make it one.
                //
                // NOT ON A PHONE, AND THE CAPTION IS ONLY HALF THE REASON. A
                // touchscreen has no Tab, so `— Tab to use` named a key that is
                // not there; worse, a placeholder holds ONE string, so printing
                // the ghost cost the sentence that says what the box is for at
                // the exact moment a phone operator has just opened it. Both
                // halves are fixed in one place: the phone keeps the sentence,
                // and the offer moves to `data-prompt-suggestion-use` in the
                // tools row below -- a control a finger can take, in a row that
                // is already 44px tall, so it costs no height at all. The
                // attribute stays on both, because it is what says an offer is
                // standing at all.
                data-prompt-suggestion={promptSuggestion ?? undefined}
                placeholder={
                  entry === null
                    ? 'Pick a session first'
                    : promptSuggestion !== null && !phone
                      ? `${promptSuggestion} — Tab to use`
                      : 'Reply to agent, answer with a number, or paste a plan…'
                }
                /* `vam-tap` IS THE TOUCH FLOOR, and the box you type in is a
                   touch target like any other: measured at 390px it came back
                   335x40, four pixels under the AAA figure the rest of this
                   shell keeps -- and it is the one control on the screen that
                   exists to be tapped. The class is `.vam-phone`-scoped
                   (`styles.css`), so the desktop box is untouched, and
                   `max-h-[120px]` still caps the grown height.

                   PHONE ONLY: no more `[field-sizing:content]` -- grown by
                   the SAME `scrollHeight` effect the desktop box already
                   used (below `pickImage`), which this property used to
                   override/ignore per spec; see that effect's own comment
                   for the real-browser measurement this closes. `rows={1}`
                   (not 2) and `max-h-[132px]` (not 120) are the two figures
                   that still differ from desktop. */
                className={[
                  'vam-no-scrollbar vam-tap min-w-0 flex-1 resize-none overflow-y-auto bg-transparent text-body text-ink outline-none placeholder:text-ink-faint',
                  phone ? 'max-h-[132px]' : 'max-h-[120px]',
                ].join(' ')}
                aria-label="prompt to session"
              />
            </div>

            {/* PHONE: `basis-full` on each of these three -- and on the chips
              and the mode caption further down -- so a rare message forces
              its OWN line in the merged row's `flex-wrap` rather than
              cramming in beside the textarea; see `data-prompt-box`'s own
              comment for the row these now belong to. Desktop is untouched,
              still `flex-col`, where a bare block already took its own line
              for free. */}
            {images.length > 0 && (
              <p
                data-pasted-images
                className={
                  phone ? 'basis-full text-control text-ink-dim' : 'text-control text-ink-dim'
                }
              >
                {images.length === 1 ? '1 image' : `${images.length} images`} pasted and kept here —
                vam writes text to a session, so only the {'`[image #N]`'} placeholder is sent, not
                the image.
              </p>
            )}

            {attachError !== null && (
              <p
                data-attach-error
                className={
                  phone ? 'basis-full text-control text-waiting' : 'text-control text-waiting'
                }
              >
                {attachError}
              </p>
            )}

            {/* ITS OWN LINE, NOT THE ATTACHMENT'S. Both are "the composer could
              not do the thing you asked", and they are still different acts
              with different fixes -- a hook named `attach-error` carrying a
              microphone permission refusal is the kind of reuse that reads
              fine until somebody greps for it. */}
            {dictateError !== null && (
              <p
                data-dictate-error
                className={
                  phone ? 'basis-full text-control text-waiting' : 'text-control text-waiting'
                }
              >
                {dictateError}
              </p>
            )}

            {/* The tools row: attach, provider, model, mode — everything the
              prompt carries besides its text, on one line under the box.
              PHONE: this contributes no box of its own either (`display:
              contents`) -- its children (the "+", the mic, Send, and the rare
              chip/caption rows) become direct items of the SAME merged row
              the textarea now sits in, ordered by `data-composer-overflow`'s
              own `order-first` and the rare rows' own `order-10 basis-full`
              below. The hook is what lets a test say "beside the model field"
              without a layout engine, on desktop, where this is still a real
              flex row of its own. */}
            <div data-prompt-tools className={phone ? 'contents' : 'flex items-center gap-2'}>
              {/* THE OFFER, AS A CONTROL, because on a phone `Tab` is not one.
                See the placeholder above for the whole rule. Three things
                decide the shape:

                  - IT IS THE PHONE'S ONLY ROUTE to `promptSuggestion`, so it
                    is drawn exactly where the key is missing and nowhere else.
                    The desktop keeps the caption and the key; a second control
                    there would be a second way to do a thing that already has
                    one.
                  - IT SAYS WHAT IT WOULD WRITE. A pill rather than a glyph:
                    "Use" alone is a control whose object is invisible once the
                    ghost has left the placeholder. `data-tap-pill` is the
                    existing opt-out of the 30x30 square for a skin holding
                    TEXT (`styles.css`).
                  - AND IT IS THE ROW'S FLEXIBLE ITEM, which is the part that
                    was measured rather than reasoned. Every other control
                    here is fixed at 44 or 65 and none of them will give way,
                    so a pill sized to its own content pushes the LAST one --
                    Record -- off the screen: driven at 390px with a
                    multi-select's three marks joined, the row overflowed its
                    335px and Record's right edge landed at 397. So this one
                    shrinks and clips with an ellipsis, down to the 44px floor
                    `vam-tap` gives it, and the whole label is the accessible
                    name, which is the channel that cannot be clipped. `max-w`
                    is the other end: an offer does not get to own half a row
                    it is only suggesting something into.
                  - IT IS WITHDRAWN THE MOMENT IT IS TAKEN, because
                    `promptSuggestion` is null over a non-empty draft: the same
                    trade the Tab binding already refuses -- an accept that
                    could only overwrite what the operator has written. */}
              {phone && promptSuggestion !== null && (
                <button
                  type="button"
                  data-prompt-suggestion-use
                  aria-label={`use the suggested reply: ${promptSuggestion}`}
                  onClick={() => onDraftChange(promptSuggestion)}
                  // `order-10 basis-full`: this offer is rare enough (a
                  // draft-less focus) that it earns its own line below the
                  // merged [+, textarea, mic, Send] row rather than crowding
                  // it -- see `data-prompt-box`'s own comment.
                  className="vam-tap order-10 flex min-w-0 shrink basis-full cursor-pointer items-center justify-start"
                >
                  <span
                    aria-hidden="true"
                    data-tap-skin
                    data-tap-pill
                    className="flex h-[30px] min-w-0 max-w-[132px] items-center gap-1 rounded-[8px] border border-line-strong bg-card px-1.5 text-control text-ink-quiet active:bg-line-strong"
                  >
                    {/* THE `truncate` IS ON THIS INNER SPAN AND NOT ON THE
                      SKIN, and the difference is visible rather than
                      pedantic: `text-overflow: ellipsis` does nothing on a
                      FLEX container -- the text becomes an anonymous flex
                      item and is clipped with no mark at all. Caught on a
                      screenshot, not by a guard: the chip read `Server-sent
                      eve`, which is not a shortened label, it is a wrong one.
                      `data-model-label` two controls over already does it
                      this way for the same reason. */}
                    <span data-prompt-suggestion-label className="truncate">
                      {promptSuggestion}
                    </span>
                  </span>
                </button>
              )}
              {/* PHONE COMPOSER DIET (docs/design/phone-core-loop.md §3.4):
                  one "+" replaces FIVE resident icons (attach, attach-image,
                  provider, model, mode) with ONE, leaving the phone row at
                  textarea + "+" + mic + Send -- 4 controls, not 6..9. Nothing
                  each row does is new: every action below is the SAME
                  handler/state the desktop's own resident control already
                  calls (`fileRef.current?.click()`, `pickImage()`,
                  `setOpenPopover('provider' | 'model' | 'mode')`), reached
                  through one extra tap instead of a resident icon. Desktop is
                  untouched -- this whole block is `phone &&`.

                  `order-first` (docs/design/phone-core-loop.md §4.1's
                  follow-up): the merged row's ONE reorder -- everything else
                  keeps its natural DOM order, which already reads textarea,
                  mic, Send, so only the "+" needs pulling to the front of the
                  row it used to open alone. */}
              {phone && (
                <div data-popover-root="phone-overflow" className="order-first flex-none">
                  <button
                    type="button"
                    data-composer-overflow
                    onKeyDown={dismissPopoverOnEscape}
                    aria-haspopup="menu"
                    aria-expanded={phoneOverflowOpen}
                    aria-label="more composer tools — attach, model, mode"
                    onClick={() => togglePopover('phone-overflow')}
                    className="vam-tap flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-ink-dim hover:text-ink"
                  >
                    <span
                      aria-hidden="true"
                      data-tap-skin
                      className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-line-strong bg-card hover:bg-line-strong"
                    >
                      <Plus size={12} strokeWidth={1.7} />
                    </span>
                  </button>
                  {phoneOverflowOpen && (
                    <div
                      data-composer-overflow-menu
                      role="menu"
                      aria-label="composer tools"
                      onKeyDown={dismissPopoverOnEscape}
                      className={COMPOSER_POPOVER_MENU}
                      style={
                        suggestMaxHeight === null ? undefined : { maxHeight: suggestMaxHeight }
                      }
                    >
                      <button
                        type="button"
                        data-composer-overflow-attach
                        role="menuitem"
                        onClick={() => {
                          setOpenPopover(null);
                          fileRef.current?.click();
                        }}
                        className="vam-tap flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 py-1 text-left text-control text-ink-dim hover:bg-line-strong hover:text-ink"
                      >
                        <Paperclip size={12} strokeWidth={1.7} aria-hidden="true" />
                        Attach file
                      </button>
                      {pickImageAttachment !== undefined && entry !== null && (
                        <button
                          type="button"
                          data-composer-overflow-attach-image
                          role="menuitem"
                          onClick={() => {
                            setOpenPopover(null);
                            void pickImage();
                          }}
                          className="vam-tap flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 py-1 text-left text-control text-ink-dim hover:bg-line-strong hover:text-ink"
                        >
                          <ImageIcon size={12} strokeWidth={1.7} aria-hidden="true" />
                          Attach image
                        </button>
                      )}
                      {CAN_CHOOSE_PROVIDER && onSetDefaultProvider !== undefined && (
                        <button
                          type="button"
                          data-composer-overflow-provider
                          role="menuitem"
                          aria-haspopup="listbox"
                          onClick={() => setOpenPopover('provider')}
                          className="vam-tap flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 py-1 text-left text-control text-ink-dim hover:bg-line-strong hover:text-ink"
                        >
                          Provider: {currentProvider.label}
                        </button>
                      )}
                      {modelControl === 'picker' && (
                        <button
                          type="button"
                          data-composer-overflow-model
                          role="menuitem"
                          aria-haspopup="listbox"
                          onClick={() => setOpenPopover('model')}
                          className="vam-tap flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 py-1 text-left text-control text-ink-dim hover:bg-line-strong hover:text-ink"
                        >
                          Model: {modelButtonLabel(running?.name ?? null)}
                        </button>
                      )}
                      {/* DISABLED, NOT ABSENT -- same rule the desktop's own
                          disabled model row states at length above: a model is
                          a fact about the session whether or not vam can reach
                          it. No listbox to open, so this row is informational
                          only, same as its desktop twin. */}
                      {modelControl === 'disabled' && (
                        <div data-composer-overflow-model className="px-2 py-1">
                          <p className="text-control text-ink-faint">
                            Model: {recordedModel ?? 'model'}
                          </p>
                          <p className="text-meta text-ink-faint">vam cannot switch models here.</p>
                        </div>
                      )}
                      {modelControl === 'request' && (
                        <div
                          data-composer-overflow-model-request
                          className="flex items-center gap-1.5 px-2 py-1"
                        >
                          <label
                            htmlFor="phone-model-request"
                            className="text-control text-ink-dim"
                          >
                            Model
                          </label>
                          <input
                            id="phone-model-request"
                            data-model-request
                            value={readModelRequest(draft)}
                            onChange={(event) =>
                              onDraftChange(setModelRequest(draft, event.target.value))
                            }
                            placeholder="model"
                            aria-label="model requested in this prompt"
                            className={`vam-tap min-w-0 flex-1 rounded-[6px] border border-line-strong bg-transparent px-1.5 font-mono text-control text-ink placeholder:text-ink-quiet ${FOCUS_RING}`}
                          />
                        </div>
                      )}
                      {canCycleMode && (
                        <button
                          type="button"
                          data-composer-overflow-mode
                          role="menuitem"
                          aria-haspopup="listbox"
                          onClick={() => setOpenPopover('mode')}
                          className="vam-tap flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 py-1 text-left text-control text-ink-dim hover:bg-line-strong hover:text-ink"
                        >
                          Mode: {currentMode}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {/* The attachment button, doing the only honest thing there is to
              do here: vam's write is a string, so the file is read in the
              renderer and its text becomes part of the prompt that gets
              recorded. Nothing is uploaded, and nothing on screen says it
              is. See `attachIntoDraft` for the limit and the refusals. */}
              <input
                ref={fileRef}
                type="file"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => void takeFile(event.currentTarget)}
                className="hidden"
              />
              {/* PHONE: this trigger moves into the "+" overflow
                  (`data-composer-overflow`) below -- see its own comment.
                  Desktop keeps the resident icon, unchanged. */}
              {!phone && (
                <Note text="puts the file’s text into the prompt text — vam uploads nothing">
                  <button
                    type="button"
                    data-attach
                    aria-label="attach a text file to this prompt"
                    onClick={() => fileRef.current?.click()}
                    className="vam-tap flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-ink-dim hover:text-ink"
                  >
                    {/* HIT ON THE ELEMENT, PAINT ON THE SKIN -- the same shape
                    the phone's other class-A controls take, and the last one
                    still painting its border on the 44 box. The button keeps its
                    box and centres; the border, the ground and the radius move
                    inward, where the phone rule can shrink them to 30 without
                    touching the touch target (`styles.css`). */}
                    <span
                      aria-hidden="true"
                      data-tap-skin
                      className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-line-strong bg-card hover:bg-line-strong"
                    >
                      <Paperclip size={12} strokeWidth={1.7} />
                    </span>
                  </button>
                </Note>
              )}
              {attachedName !== null && (
                <span
                  data-attach-chip
                  // `line-strong`, not `raised`: this chip sits inside
                  // `data-prompt-box`, which is `bg-card` -- the same
                  // inversion the answer options wore. See `OPTION_FILL`.
                  // PHONE: `order-10 basis-full`, the same rare-row treatment
                  // as the suggestion offer above -- see `data-prompt-box`.
                  className={[
                    'flex h-6 min-w-0 items-center gap-1 rounded-[6px] border border-line-strong bg-line-strong px-1.5 font-mono text-meta text-ink-dim',
                    phone ? 'order-10 basis-full' : '',
                  ].join(' ')}
                >
                  <span className="truncate">{attachedName}</span>
                  <button
                    type="button"
                    data-attach-remove
                    aria-label={`remove ${attachedName}`}
                    onClick={() => {
                      setAttachError(null);
                      onDraftChange(detachFromDraft(draft));
                    }}
                    className="flex flex-none cursor-pointer items-center text-ink-faint hover:text-ink"
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </span>
              )}
              {/* ABSENT, NOT DISABLED: drawn only when this shell can actually
              open a native dialog and validate the answer against the
              session's own directory (`pickImageAttachment`). A path is put
              on its own line in the prompt text -- Claude Code reads the
              bytes itself off that path; vam still uploads nothing. See
              `state/artifacts/vam-image-attach/findings.md`. */}
              {/* PHONE: this trigger moves into the "+" overflow too -- same
                  note as the text-attach button above. */}
              {!phone && pickImageAttachment !== undefined && entry !== null && (
                <Note text="puts an image’s path into the prompt — it must sit inside this session’s own directory; vam uploads nothing">
                  <button
                    type="button"
                    data-attach-image
                    aria-label="attach an image to this prompt"
                    onClick={() => void pickImage()}
                    className="vam-tap flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-ink-dim hover:text-ink"
                  >
                    <span
                      aria-hidden="true"
                      data-tap-skin
                      className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-line-strong bg-card hover:bg-line-strong"
                    >
                      <ImageIcon size={12} strokeWidth={1.7} />
                    </span>
                  </button>
                </Note>
              )}
              {attachedImage !== null && (
                <span
                  data-attach-image-chip
                  // The same card, the same inversion -- see `data-attach-chip`.
                  // PHONE: same rare-row treatment as that chip -- see
                  // `data-prompt-box`.
                  className={[
                    'flex h-6 min-w-0 items-center gap-1 rounded-[6px] border border-line-strong bg-line-strong px-1.5 font-mono text-meta text-ink-dim',
                    phone ? 'order-10 basis-full' : '',
                  ].join(' ')}
                >
                  <span className="truncate">{attachedImage}</span>
                  <button
                    type="button"
                    data-attach-image-remove
                    aria-label={`remove ${attachedImage}`}
                    onClick={() => {
                      onDraftChange(removeImagePath(draft, attachedImage));
                      setAttachedImage(null);
                    }}
                    className="flex flex-none cursor-pointer items-center text-ink-faint hover:text-ink"
                  >
                    <X size={11} strokeWidth={2} />
                  </button>
                </span>
              )}
              {/* A15.4: the provider CHOICE, beside the model field it used to
              be merely NAMED next to — Settings (`prefs.defaultProvider`,
              `SettingsOverlay.tsx`) still owns the full picker; this is a
              second, faster door onto the same preference, not a new one.

              GLOBAL DEFAULT, NOT THIS SESSION'S PROVIDER — see the prop's
              own doc for why: there is no channel that lets an existing
              session's next reply run through a different agent, so a
              control that implied otherwise would be exactly the kind of
              lie the model field's own comment above refuses. Picking here
              changes what the NEXT session created starts with.

              ABSENT, NOT DISABLED: drawn only when the caller can actually
              persist a change (`onSetDefaultProvider`), the same rule
              `pickImageAttachment` follows two blocks up.

              AND ONLY WHEN THERE IS A CHOICE, which is the same rule one step
              further out and the one this control was not obeying.
              `CAN_CHOOSE_PROVIDER` (`src/shared/providers.ts`) is `false`
              while the table has one row, and over one row this popover is a
              list with a single already-selected item in it: pressing it can
              only re-choose what is chosen. `SettingsOverlay` has withdrawn
              its own copy on that condition all along; the derivation moved
              beside the table so both surfaces read one answer.

              WHAT IT COST WHILE IT WAS DRAWN, measured at 390px: 44px of a
              335px tool row plus its 8px gap, for "the default provider for
              NEW sessions" on a screen whose whole job is replying to a
              session that already exists -- and the popover opened INSIDE the
              prompt box, 99x34 at y=739 against a textarea spanning 727-767.
              Withdrawing it retires that overlap with it. */}
              {CAN_CHOOSE_PROVIDER && onSetDefaultProvider !== undefined && (
                /* `data-popover-root` IS THE DISMISSAL BOUNDARY, not decoration
                   and not a test hook: the document-level `pointerdown` handler
                   above asks whether the press landed inside the OPEN popover's
                   own root, and a press anywhere else closes it. On the WRAPPER
                   because the wrapper holds both halves -- the toggle and the
                   layer that floats out of it -- and a boundary drawn round
                   only one of them would dismiss on a press inside the very
                   thing being pressed. */
                <div data-popover-root="provider" className="flex-none">
                  {/* PHONE: the toggle moves into the "+" overflow's "Provider"
                      row, which opens this SAME listbox by setting the shared
                      `openPopover` state directly -- see `data-composer-overflow`
                      below. This wrapper and the listbox stay unconditional so
                      that row has something to open. */}
                  {!phone && (
                    <Note text="the agent NEW sessions start with — not this one, which is already running">
                      <button
                        type="button"
                        data-provider-picker-toggle
                        onKeyDown={dismissPopoverOnEscape}
                        aria-haspopup="listbox"
                        aria-expanded={providerPickerOpen}
                        aria-label={`default provider for new sessions: ${currentProvider.label} — change`}
                        onClick={() => togglePopover('provider')}
                        className="vam-tap flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-ink-dim hover:text-ink"
                      >
                        <span
                          aria-hidden="true"
                          data-tap-skin
                          className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-line-strong bg-card hover:bg-line-strong"
                        >
                          {(() => {
                            const mark = PROVIDER_MARKS[currentProvider.id];
                            return mark === undefined ? (
                              <Box size={12} strokeWidth={1.7} />
                            ) : (
                              <mark.Glyph size={12} />
                            );
                          })()}
                        </span>
                      </button>
                    </Note>
                  )}
                  {providerPickerOpen && (
                    <div
                      data-provider-picker
                      role="listbox"
                      onKeyDown={dismissPopoverOnEscape}
                      aria-label="default provider for new sessions"
                      className={COMPOSER_POPOVER_MENU}
                      style={
                        suggestMaxHeight === null ? undefined : { maxHeight: suggestMaxHeight }
                      }
                    >
                      {PROVIDERS.map((provider) => {
                        const selected = provider.id === currentProvider.id;
                        return (
                          <button
                            key={provider.id}
                            type="button"
                            data-provider-option={provider.id}
                            role="option"
                            aria-selected={selected}
                            onClick={() => {
                              onSetDefaultProvider(provider.id);
                              setOpenPopover(null);
                            }}
                            /* `vam-tap`: a popover row is a touch target too,
                               and this one measured 89x24 at 390px the first
                               time a census ever opened the popover it lives
                               in. Dormant while `PROVIDERS` has one row and
                               this whole control is withdrawn -- and that is
                               the point of putting it here now rather than
                               with the row that brings it back. */
                            className={[
                              'vam-tap flex cursor-pointer items-center whitespace-nowrap rounded-[6px] px-2 py-1 text-left text-control',
                              selected
                                ? 'bg-line-strong text-ink'
                                : 'text-ink-dim hover:bg-line-strong hover:text-ink',
                            ].join(' ')}
                          >
                            {provider.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {/* THE MODEL CONTROL, IN THREE STATES -- `modelControlState`
              (`model-command.ts`) carries the table and the measurements
              behind it; this is what each row draws.

                delivers   terminal    vamControlled   drawn
                not true   any         any             the free-text request
                                                       line, unchanged
                true       !== false   true            a picker that drives
                                                       the CLI's /model menu
                true       false       any             the picker, DISABLED
                true       !== false   not true        the picker, DISABLED

              WHY THE FIRST ROW SURVIVES. The field was written for a source
              that only RECORDS: the prompt is filed, the factory picks the
              model, and one leading `model: <x>` line is the request in the
              words a reader of the log will read (`setModelRequest`). That
              is still true there and it is kept there, note and all.

              WHY THE OTHER ROWS ARE NOT THAT FIELD. On a source that DELIVERS
              (`deliverPrompt`: Claude Code since PR 383), the draft is typed
              into the session's tmux pane, so a `model:` line lands in the
              CLI's prompt as words the agent reads -- it switches nothing.
              What does switch it, measured on Claude Code 2.1.274, is
              `/model <alias>` + Enter typed at the REPL -- and the CLI ALSO
              saves that as the operator's default for new sessions, which is
              why the picker no longer types it. It asks main to drive the
              CLI's own menu (`sendModel`), and NEVER touches the draft.

              DISABLED, NOT ABSENT, WHERE VAM CANNOT TYPE -- and this is the
              one place the control differs from the mode chip beside it,
              which is ABSENT where no mode can be chosen. The operator asked
              for disabled, and the two controls are about different things:
              a mode is a property of vam's own prompt (the draft carries the
              line), so where vam cannot set one there is nothing to show; a
              model is a property of the SESSION, which has one whether or not
              vam can reach it, and a greyed button says exactly that -- there
              is a model here, and vam has no keyboard into this session to
              change it. The note carries the remedy.

              THE NOTE ON A DISABLED BUTTON HANGS ON A WRAPPER, and that is
              not decoration: a disabled `<button>` takes no focus in any
              browser, so a `Note` on the button itself would open on hover
              and on nothing else -- the `title` this app deleted, unreadable
              from the keyboard. The wrapper takes the tab stop (the
              `StatusCell` precedent, suppression and all). HOVER NEEDS NO
              HELP, and that is measured rather than assumed: the first draft
              put `pointer-events-none` on the button on the belief that
              Chromium delivers no pointer events over a disabled control, and
              removing it reddened nothing -- on Chromium 153 (Playwright) the
              hover reaches the wrapper's handlers and the note opens. Electron
              44 carries a Chromium of the same generation. A rule the guard
              cannot falsify is a rule nobody chose, so it is not here.
              `e2e/model-picker-shots.mjs` measures that the note really
              opens both ways, and what the dimmed label paints. */}
              {/* PHONE: a record-only source's free-text `model:` line has no
                  popover to reopen from an overflow row -- it IS the control
                  -- so it moves into the "+" sheet whole, as
                  `data-composer-overflow-model-request` below, rather than
                  splitting a toggle from a menu the way the picker/mode
                  controls do. */}
              {!phone && modelControl === 'request' && (
                <Note text="vam cannot switch models here — the factory chooses; this writes your request into the prompt">
                  <input
                    data-model-request
                    value={readModelRequest(draft)}
                    onChange={(event) => onDraftChange(setModelRequest(draft, event.target.value))}
                    placeholder="model"
                    aria-label="model requested in this prompt"
                    /* `outline-none` is GONE, and `focus:text-ink` was never a
                       substitute for it: recolouring TYPED TEXT says nothing on
                       an empty field, which is the state this control is in
                       every time it is first reached. Nothing else drew one
                       either -- the phone stylesheet's replacement ring applies
                       to `.vam-tap:has(> [data-tap-skin])` and this field has no
                       inner skin -- so focusing it put a caret on screen and
                       nothing more.

                       `FOCUS_RING` is the app's own, in `ink`: measured on the
                       painted node it is 13.4:1 in dark and 17.7:1 in light
                       against the card behind it, well past the 3:1 WCAG 1.4.11
                       asks, and it is a different colour from the composer box's
                       armed border (`waiting`) so the two signals cannot be read
                       as each other. */
                    className={`vam-tap h-6 w-[84px] min-w-0 shrink rounded-[6px] border border-line-strong bg-transparent px-1.5 font-mono text-control text-ink-dim placeholder:text-ink-quiet focus:text-ink ${FOCUS_RING}`}
                  />
                </Note>
              )}
              {modelControl === 'picker' && (
                <div
                  data-popover-root="model"
                  /* `min-w-0 shrink` AND NOT `flex-none`, AND `flex` -- three
                     classes that only work together, each of which was put
                     here by a measurement at 520px (the button's own comment
                     carries the first one).

                     `flex-none` MEANT THE BUTTON NEVER GOT THE CHANCE to give
                     way: the row still overflowed by 8px with the button
                     already willing to shrink. `min-w-0` is the second half --
                     a flex item's floor is its content width unless it is told
                     otherwise, and an ellipsis is precisely the case that needs
                     telling.

                     AND `flex` IS THE THIRD, which the first draft did not
                     have and which cost the fix its point: a `relative` BLOCK
                     wrapper shrank to 93px while the button inside it stayed
                     101px and simply painted over the mode chip beside it. The
                     row measured clean -- no overflow, every direct child
                     inside -- while the control was visibly on top of its
                     neighbour. A flex wrapper makes the button an item that
                     shrinks WITH it, and the guard now measures the button
                     against its wrapper rather than trusting the row.

                     NOT `relative` ANY MORE: it was this wrapper's own
                     positioning context for `[data-model-picker-menu]`'s
                     `absolute bottom-full`, which is what grew the popover
                     upward into the textarea (`COMPOSER_POPOVER_MENU`'s own
                     comment). Removing it does not touch the shrink fix
                     above -- `position` plays no part in that measurement --
                     and lets the popover resolve against `data-composer-bar`
                     instead. */
                  className="flex min-w-0 shrink"
                >
                  {/* THE NOTE SAYS WHAT THE ONE ROUTE COSTS, which is nothing
                      beyond this session. An ALIAS is walked onto the CLI's own
                      `/model` menu and committed with `s`, which the CLI
                      answers "...for this session only" -- measured, with
                      `~/.claude/settings.json` byte-identical afterwards.

                      IT NAMED TWO ROUTES UNTIL NOW, AND ONE BAD ONE BEFORE
                      THAT. vam typed `/model <choice>` + Return for all six
                      rows, which the CLI answers "...and saved as your default
                      for new sessions", so the note disclosed a settings
                      rewrite on every pick. `main/terminal/model-switch.ts`
                      made that false for the five aliases and left the
                      disclosure true of the free-text row alone; the operator
                      then chose refusal over that last fallback. The row is
                      gone, no input reaches the argument form, and a note
                      still mentioning a default would promise a write vam
                      declines to make.

                      AND IT LEADS WITH THE MODEL WHEN THERE IS ONE, which is
                      not decoration: the label beside it may be CLIPPED at a
                      narrow pane (the button's own comment carries that
                      measurement), and this is where an eye gets the whole
                      name back. A screen reader already had it in the
                      accessible name; the mode chip next door made exactly
                      this correction, for exactly this reason. It says
                      "running", never "chosen": the name came off the
                      session's status line, and vam does not know which alias
                      put it there.

                      AND IT SAYS WHICH TURN IT IS ABOUT when the name came out
                      of the transcript instead -- the only source there is on
                      a machine whose operator has replaced the CLI's status
                      line. `modelRunningClause` holds the two sentences and
                      the argument for keeping them apart; the short of it is
                      that "running" is a claim only the footer supports. */}
                  {/* PHONE: the toggle moves into the "+" overflow's "Model"
                      row, which opens this SAME listbox (`modelPickerOpen`,
                      below) by setting the shared `openPopover` state
                      directly. This `Note`+`button` is desktop-only; the
                      wrapper and the listbox stay unconditional. */}
                  {!phone && (
                    <Note
                      text={
                        running === null
                          ? MODEL_PICKER_NOTE
                          : `${modelRunningClause(running)} · ${MODEL_PICKER_NOTE}`
                      }
                    >
                      <button
                        type="button"
                        data-model-picker
                        data-model-picker-state="picker"
                        onKeyDown={dismissPopoverOnEscape}
                        aria-haspopup="listbox"
                        aria-expanded={modelPickerOpen}
                        /* LABELLED WITH THE MODEL THE PANE REPORTS, and with the
                         old word when there is none.

                         WHAT CHANGED. This said "model" and nothing else,
                         under a comment reading "vam does not read the
                         session's model back ... a button wearing 'Opus' would
                         be a claim nothing checked". The claim is checked now:
                         the CLI paints the model on a PERSISTENT status line
                         in this very pane, and vam reads it back every few
                         seconds (`main/terminal/model.ts`). What the operator
                         reads here is therefore the session's own screen, not
                         the last thing vam typed -- which is the distinction
                         that comment was protecting, and it still holds: the
                         moment the pane stops saying, so does this.

                         AND THE FOOTER IS NOT THE ONLY PANE FACT ANY MORE. An
                         operator may replace the CLI's status line with a
                         script of their own, and then there is no footer to
                         read for the life of every session on that machine --
                         which is exactly the defect this control had. The name
                         then comes out of the session's own transcript
                         (`main/sources/claude-code/transcript-model.ts`), and
                         the sentence around it changes with the source rather
                         than the label doing so.

                         THE NAME LEADS THE ACCESSIBLE LABEL, the way the mode
                         chip's does, so a screen reader is told the fact the
                         eye is told rather than only what the control does --
                         and it carries the qualifier too, because a screen
                         reader has no tooltip to hover for the rest of it. */
                        aria-label={modelButtonName(running)}
                        onClick={() => togglePopover('model')}
                        /* IT MAY SHRINK NOW, AND IT IS THE ONLY THING IN THE ROW
                         THAT CAN -- because it is the only thing in the row
                         whose width is not vam's to choose. Everything else
                         here is a 24px glyph; this wears whatever the CLI
                         calls the model.

                         MEASURED, AND THE MEASUREMENT IS WHY THIS IS NOT
                         `shrink-0` ANY MORE. At 520px -- `SIDEBAR_MIN +
                         DETAIL_MIN`, the narrowest window vam still draws two
                         columns in -- the tools row is 265px and the word
                         `model` fitted it with a few pixels to spare. A TEN
                         character label did not: `e2e/model-picker-shots.mjs`
                         measured 16px of overflow and the SEND BUTTON pushed
                         outside the row's own box. Ten characters is not a
                         hypothetical -- `Sonnet 4.5` is what the status line
                         reads on a session started on a full model id, and
                         `Sonnet 5` is what it reads on the CLI's default.
                         So the label gives way instead of the row bursting:
                         it clips with an ellipsis, the way the CLI's own
                         status line does when its pane is narrow, and the
                         whole name stays one hover or one Tab away in the
                         accessible name above and the note around it. */
                        className="vam-tap flex h-6 min-w-0 shrink cursor-pointer items-center text-ink-dim hover:text-ink"
                      >
                        <span
                          aria-hidden="true"
                          data-tap-skin
                          className="flex h-6 min-w-0 items-center gap-1 rounded-[6px] border border-line-strong bg-card px-1.5 font-mono text-control hover:bg-line-strong"
                        >
                          <span data-model-label className="truncate">
                            {modelButtonLabel(running?.name ?? null)}
                          </span>
                          {/* The chevron never gives way: a picker with no
                            affordance left on it is a label. */}
                          <ChevronDown size={11} strokeWidth={2} className="flex-none" />
                        </span>
                      </button>
                    </Note>
                  )}
                  {modelPickerOpen && (
                    <div
                      data-model-picker-menu
                      className={COMPOSER_POPOVER_MENU}
                      style={
                        suggestMaxHeight === null ? undefined : { maxHeight: suggestMaxHeight }
                      }
                    >
                      {/* THE FIVE, as a listbox of their own rather than the
                          popover being one. That began as a necessity -- a
                          free-text `<input>` sat below them, and an input is
                          not an option, so a `role="listbox"` around both
                          would have been a listbox with a child no screen
                          reader can place. The input is gone and the nesting
                          stays, because the popover is a positioned layer with
                          its own border, padding and shadow: collapsing the
                          two would make the listbox the thing that paints the
                          card, and every guard that asks "are the options
                          inside the listbox" would then be asking nothing. */}
                      <div
                        role="listbox"
                        onKeyDown={dismissPopoverOnEscape}
                        aria-label="model for this session"
                        className="flex flex-col gap-0.5"
                      >
                        {MODEL_CHOICES.map((choice) => (
                          <button
                            key={choice.id}
                            type="button"
                            data-model-option={choice.id}
                            role="option"
                            /* STILL NOT `aria-selected`, AND THAT IS THE POINT
                               RATHER THAN AN OMISSION. Selection is the CLI's
                               own menu cursor -- which alias was chosen -- and
                               that is precisely the fact the status line does
                               NOT carry: `/model default` and `/model sonnet`
                               leave the same line (`runningModelRows`). What
                               vam can see is which row's MODEL is running, and
                               that is what the tick says. `aria-selected` on a
                               row would be a claim about the menu, and on the
                               Sonnet 5 pair it would be a coin toss; the mark
                               is carried in the row's own words instead, where
                               it can say what it actually means. */
                            aria-selected={false}
                            onClick={() => {
                              setOpenPopover(null);
                              void sendModel(choice.id);
                            }}
                            className="flex cursor-pointer items-center gap-3 whitespace-nowrap rounded-[6px] px-2 py-1 text-left text-control text-ink-dim hover:bg-line-strong hover:text-ink"
                          >
                            <span data-model-name>{choice.label}</span>
                            {/* THE TICK ON THE MODEL THIS SESSION IS RUNNING,
                                at the operator's ask -- and in the CLI's own
                                glyph, which its `/model` menu already shows
                                this operator (`❯ 2. Sonnet ✔`).

                                IT IS THE ONLY THING THAT MARKS THE ROW, which
                                is WCAG 1.4.1 taken seriously: a shape rather
                                than a colour, so the row is not distinguished
                                by ink at all and there is nothing to fail for
                                a reader who cannot separate two hues. The row
                                keeps its own ink and its own hover exactly as
                                the other four do.

                                AND IT IS SAID IN WORDS TOO. The glyph is
                                `aria-hidden` and an `sr-only` clause carries
                                the same fact into the row's accessible name --
                                this file's rule for every icon that means
                                something (`ViewIcons`), and the reason
                                `aria-selected` is not the vehicle is directly
                                above.

                                IT IS DRAWN ONLY WHERE IT IS TRUE, AND NOTHING
                                MOVES WHEN IT APPEARS -- measured, not reasoned,
                                and the measurement CHANGED SIDES when the
                                free-text row was removed.

                                THE SLOT IS RESERVED, AND IT WAS NOT. PR 407's
                                first draft reserved a `w-3` box on every row so
                                that a mark coming and going could not shift
                                anything; it was cut as a rule nothing could
                                falsify, because the popover's width was set by
                                the free-text row's own `w-[148px]` and the five
                                rows had slack inside it whatever was ticked.
                                That input is gone with the full-id route, so
                                the WIDEST ROW sets the width now -- and the
                                measurement came back 132x138 unticked against
                                155x138 with Default and Sonnet both ticked.
                                Twenty-three pixels, which is the glyph plus its
                                gap: the popover really did grow, the rows under
                                the pointer really did move, and `running` is
                                POLLED while the picker is open, so a read that
                                comes back `unknown` for one beat narrows the
                                box under somebody's hand.

                                So the reservation is back, on the falsification
                                that was missing the first time. The slot is
                                always drawn and always `w-3`; the glyph goes
                                inside it or does not. `aria-hidden` sits on the
                                slot rather than the glyph -- same effect, one
                                element -- and the `sr-only` clause below still
                                carries the fact in words, being `position:
                                absolute` and so no part of this row's width.
                                `model-picker-shots.mjs` holds the OUTCOME
                                rather than a number off this machine: the box
                                is the same box with no tick, one tick and two.
                                */}
                            <span
                              data-model-tick-slot
                              aria-hidden="true"
                              className="flex w-3 flex-none items-center justify-center"
                            >
                              {runningRows.includes(choice.id) && (
                                <Check data-model-current size={11} strokeWidth={2.5} />
                              )}
                            </span>
                            {runningRows.includes(choice.id) && (
                              <span className="sr-only">
                                {runningRows.length > 1
                                  ? // BOTH ROWS OF THE PAIR SAY THE SAME
                                    // TRUE THING, and neither claims to be the
                                    // one that was chosen: Default IS Sonnet 5
                                    // today, so a session on Sonnet 5 is
                                    // running both rows' model and the pane
                                    // cannot say which alias set it.
                                    ' — this session is running this model; the pane cannot say whether it was set as Default or by name'
                                  : ' — this session is running this model'}
                              </span>
                            )}
                            {/* THE VERSION, ON THE RIGHT, at the operator's
                                ask — and in the CLI's own layout: its menu
                                prints the number in a second column beside the
                                alias, so vam's picker reads the way the thing
                                it types into does.

                                `ml-auto` AND NOT A GRID: the rows are a
                                `flex-col`, whose default `align-items:
                                stretch` already gives every button the width
                                of the widest, so one auto margin per row
                                lands the five numbers in one lane. A grid
                                would be a second opinion about a width the
                                column already has.

                                NO COLOUR OF ITS OWN, deliberately. The CLI
                                pairs each version with a sentence ("Best for
                                everyday, complex tasks"); those are 40-55
                                characters and this popover floats inside a
                                pane whose floor is 320px (`DETAIL_MIN`), so
                                carrying them would either wrap the rows or
                                push the popover past its own pane. The number
                                is the part the operator asked for and the part
                                that fits. It is subordinate text, so it takes
                                `text-meta` — the scale's floor, the size the
                                question card's own option numbers take — and
                                INHERITS the row's ink rather than dimming
                                itself: `ink-quiet` measures 3.718:1 on this
                                card, under the 4.5:1 WCAG 1.4.3 asks of text
                                that says something, and this says which model
                                you are about to switch to. Inheriting also
                                means it brightens with the label on hover
                                instead of being the one word that does not.

                                `font-mono` because it is a version number,
                                which is the same reason the model id field
                                below it is monospaced. */}
                            <span data-model-version className="ml-auto font-mono text-meta">
                              {choice.version}
                            </span>
                          </button>
                        ))}
                      </div>
                      {/* A FREE-TEXT ROW FOR A FULL MODEL ID STOOD HERE, and
                          it is gone rather than disabled.

                          `claude --help` really does take "an alias for the
                          latest model ... or a model's full name", so the row
                          was not a mistake -- but the CLI's own `/model` menu
                          carries the five aliases and nothing else, and the
                          menu is the only route that keeps a switch to ONE
                          session. A full id could go in only as `/model <id>`
                          + Return, which the CLI answers "...and saved as your
                          default for new sessions": a write to
                          `~/.claude/settings.json` from a control reached for
                          to change one session. Offered that fallback with the
                          cost disclosed, or an outright refusal, the operator
                          chose refusal (`main/terminal/model-switch.ts`).

                          SO THE ROW'S ONLY POSSIBLE OUTCOME BECAME A REFUSAL,
                          and a control that can only say no is worse than no
                          control: it invites the ask and spends the attention
                          before answering. An operator who still wants a full
                          id can type the line themselves in the Terminal tab,
                          knowing what it costs -- which is what the
                          `not-in-menu` caption tells them. */}
                    </div>
                  )}
                </div>
              )}
              {/* PHONE: moves into the "+" overflow as a plain (still
                  disabled) row -- `data-composer-overflow-model` below,
                  same recordedModel/note text, no separate popover to
                  reopen since this state has never had one. */}
              {!phone && modelControl === 'disabled' && (
                /* THE NAME WHEN THE SOURCE KEEPS ONE, AND THE OLD WORD WHEN
                   IT DOES NOT.

                   `Session.model` is a fact the SOURCE holds -- Codex records
                   it on the thread row (`threads.model`), so vam knows which
                   model without reading anything off a screen. Absent on every
                   Claude Code row and every fixture, where the only route to
                   the name is the pane read above, which this branch is
                   precisely the case of not having.

                   AND IT IS STILL DISABLED, which is the honest pair: a model
                   is a property of the SESSION, which has one whether or not
                   vam can reach it, so the control is there-but-greyed rather
                   than absent (`model-command.ts` carries that argument). The
                   note is where the two halves are said in one sentence --
                   here is the model, and here is why this button cannot
                   change it. */
                <Note
                  text={
                    recordedModel === null
                      ? 'vam owns no terminal here — open the session in a vam terminal to send /model'
                      : `${recordedModel} — what this session's own record says it is on; vam did not start this session and has no keyboard into it, so it cannot change the model from here`
                  }
                >
                  <span
                    data-model-picker-shell
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: the tab stop IS the feature -- see `StatusCell`, and the block comment above.
                    tabIndex={0}
                    className={`inline-flex flex-none rounded-[6px] ${FOCUS_RING}`}
                  >
                    <button
                      type="button"
                      data-model-picker
                      data-model-picker-state="disabled"
                      disabled
                      aria-disabled="true"
                      aria-label={
                        recordedModel === null
                          ? 'model — vam cannot choose one for this session'
                          : `model: ${recordedModel} — vam cannot choose one for this session`
                      }
                      /* `text-ink-faint` is the disabled ink `SettingsOverlay`'s
                         stepper buttons take (`disabled:text-ink-faint`), and it
                         is measured against this card in
                         `e2e/model-picker-shots.mjs`: the label must still
                         clear 3:1, because a greyed control an operator cannot
                         read is a control that is not there. */
                      /* `vam-tap` LIKE ITS ENABLED TWIN twenty rows up, and
                         for a reason the word "disabled" hides: this control
                         is the one the PHONE draws. Over the remote server
                         `terminal` is UNSERVED, so `modelControlState` lands
                         on this row every time -- and it measured 65x24 at
                         390px while the picker beside it measured 44,
                         because only the picker wore the class. A tab stop
                         with a tooltip is still something a finger aims at.
                         `.vam-phone`-scoped, so the desktop keeps its 24. */
                      className="vam-tap flex h-6 min-w-0 shrink items-center gap-1 rounded-[6px] border border-line-strong bg-card px-1.5 font-mono text-control text-ink-faint"
                    >
                      {/* `truncate` and `shrink` for the same measured reason
                          the enabled twin carries them: this label is the only
                          thing in the row whose width is not vam's to choose,
                          and a model id a source recorded can be longer than
                          the word it replaces. The whole name is one hover or
                          one Tab away, in the note and the accessible name. */}
                      <span data-model-label className="truncate">
                        {recordedModel ?? 'model'}
                      </span>
                      <ChevronDown size={11} strokeWidth={2} className="flex-none" />
                    </button>
                  </span>
                </Note>
              )}
              {/* The mode, beside the model field the operator asked to put it
              next to, as ONE icon showing only the mode that is current —
              the three pills below the input are gone with the row they sat
              in.

              STILL ABSENT, NOT DIMMED, where no mode can be chosen
              (`canCycleMode`): a switcher over a session vam did not start
              is a control that lies, which is why the row was gated this way
              in the first place and why shrinking it does not get to spend
              that.

              ICON-ONLY DOES NOT MEAN UNLABELLED — `ViewIcons` states this
              file's rule and refuses a bare `title`: the accessible name
              carries the mode's NAME and the chord, so the one thing the
              glyph says to an eye is said to a screen reader too.

              AND THE TOOLTIP NAMES THE MODE TOO, at the operator's ask. The
              accessible name has led with `mode: <name>` since this became an
              icon, while the `Note` beside it explained what the CONTROL DOES
              and never said which mode was current — so a screen reader was
              told and an eye was not, which is this file's own rule running
              backwards. It leads with the same words the label does, and then
              says what that mode MEANS, because the hue this glyph is painted
              in has no other legend anywhere in the app.

              WHAT IT DID NOT DROP TO MAKE ROOM: the two mechanisms. This
              control writes a line into the draft and ⇧Tab presses the
              session's own chord, and an operator who does not know both is
              left believing one of them is broken.

              The draft stays the single source of truth: read back out of it
              on every render, never mirrored in state, because a mirror is a
              thing that can disagree with the text actually recorded. */}
              {canCycleMode && (
                <div data-popover-root="mode" className="flex-none">
                  {/* PHONE: the toggle moves into the "+" overflow's "Mode"
                      row, which opens this SAME listbox by setting the shared
                      `openPopover` state directly -- see the model toggle's
                      own comment above for the identical pattern. */}
                  {!phone && (
                    <Note
                      text={`mode: ${currentMode} — ${MODE_SKIN[currentMode].means}. Your pick goes into the prompt; ${chordSymbols('Shift-Tab')} cycles the session’s own.`}
                    >
                      <button
                        type="button"
                        data-mode-toggle
                        onKeyDown={dismissPopoverOnEscape}
                        aria-haspopup="listbox"
                        aria-expanded={modePickerOpen}
                        aria-label={`mode: ${currentMode} — change, or ${chordSymbols('Shift-Tab')} to cycle the session's own`}
                        onClick={() => togglePopover('mode')}
                        className="vam-tap flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center"
                      >
                        {/* The glyph carries the ink now (`MODE_SKIN`), so the
                            button no longer sets one: `text-ink-dim
                            hover:text-ink` here would have been a second opinion
                            about the same pixels, settled by source order rather
                            than by intent. The hover affordance stays on the
                            chip, which is where it was already drawn. */}
                        <span
                          aria-hidden="true"
                          data-tap-skin
                          className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-line-strong bg-card hover:bg-line-strong"
                        >
                          <ModeGlyph mode={currentMode} />
                        </span>
                      </button>
                    </Note>
                  )}
                  {modePickerOpen && (
                    <div
                      data-mode-picker
                      role="listbox"
                      onKeyDown={dismissPopoverOnEscape}
                      aria-label="mode for this prompt"
                      className={COMPOSER_POPOVER_MENU}
                      style={
                        suggestMaxHeight === null ? undefined : { maxHeight: suggestMaxHeight }
                      }
                    >
                      {MODES.map((mode) => {
                        const selected = mode === currentMode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            data-mode-option={mode.toLowerCase()}
                            role="option"
                            aria-selected={selected}
                            onClick={() => {
                              onDraftChange(setModeRequest(draft, mode));
                              setOpenPopover(null);
                            }}
                            className={[
                              'flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 py-1 text-left text-control',
                              selected
                                ? 'bg-line-strong text-ink'
                                : 'text-ink-dim hover:bg-line-strong hover:text-ink',
                            ].join(' ')}
                          >
                            {/* Coloured here too: the picker is the one place
                                all three modes appear at once, so it is the
                                only legend the hues have. */}
                            <ModeGlyph mode={mode} />
                            {mode}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {/* WHAT THE ⇧Tab PRESS DID, and the only channel that says so:
              sent, still out, or refused by tmux. It kept a home when the row
              around it was deleted, because a refusal shown as silence is
              this pane's oldest defect, not a tidy-up — the operator would be
              left believing a mode moved that did not.

              Drawn only when there is something to say (the resting caption
              moved into the icon's accessible name), so it costs no width at
              rest and the row does not reflow for a caption nobody reads. */}
              {cycleNote !== null && (
                <span
                  data-mode-cycle
                  data-mode-cycle-state={cycleNote.kind}
                  data-mode-refusal={cycleNote.kind === 'refused' ? 'true' : undefined}
                  // PHONE: same rare-row treatment as the chips/suggestion
                  // above -- `order-10 basis-full` earns its own line rather
                  // than fighting the merged row's own `min-w-0 flex-1`
                  // textarea for space. Desktop keeps `flex-1`, which is what
                  // pushes it against the spacer beside the plain `<span>`
                  // below.
                  className={[
                    'truncate whitespace-nowrap font-mono text-meta',
                    phone ? 'order-10 basis-full' : 'min-w-0 flex-1',
                    cycleNote.kind === 'refused' ? 'text-waiting' : 'text-ink-dim',
                  ].join(' ')}
                  /*
                    TRUNCATION MAY NOT BE THE END OF A SENTENCE. This line
                    clips at the composer's width -- about forty characters --
                    and some of these captions carry a remedy, a question's own
                    words, or a model id that runs past it. The model button
                    beside it already holds this rule ("it gives way by
                    clipping itself instead ... and the whole name is still
                    there for a reader, and one hover away for an eye"); the
                    caption is the surface where clipping costs the most,
                    because what it hides is usually what to DO.
                  */
                  title={cycleNote.text}
                >
                  {cycleNote.text}
                </span>
              )}
              {/* PHONE: hidden, not merely unstyled. The merged row has one
                  `flex-1` already -- the textarea itself -- and a second one
                  here would split the row's remaining space between the two,
                  starving the textarea by half. Desktop keeps it: it is what
                  pushes the mic/Send pair to the tools row's own right edge,
                  the row this spacer was written for and still lives in. */}
              <span className={phone ? 'hidden' : 'min-w-0 flex-1'} />
              {/* THE MICROPHONE, next to Send because that is where the
              operator asked for it and because it belongs to the same act:
              these two are what a finished prompt is handed to.

              DRAWN ONLY WHERE IT CAN LISTEN, which is not the same as where a
              recogniser exists -- and the difference is the packaged app.
              Chromium has `webkitSpeechRecognition` there, and vam's own main
              process denies every permission it could ask for, so the button
              shipped able to do nothing but apologise. `dictationAvailable`
              answers both questions now (`dictation.ts`), is read once at
              mount, and where it is false there is no button at all: this
              file's own rule for the directory picker and the attachment
              input -- a control that cannot act is not drawn dimmed, it is not
              drawn.

              `aria-pressed` rather than a second icon: this is one control in
              two states, and a screen reader is told which by the state rather
              than by the picture. The label changes with it, because the
              button paints no word. */}
              {canDictate && (
                <Note
                  text={
                    listening
                      ? 'listening — press again to stop; speech goes into the prompt'
                      : 'dictates into the prompt — on-device speech recognition; vam records and uploads nothing'
                  }
                >
                  <button
                    type="button"
                    data-prompt-dictate
                    data-prompt-dictate-on={listening ? 'true' : undefined}
                    aria-pressed={listening}
                    aria-label={listening ? 'stop dictating' : 'dictate the prompt'}
                    onClick={toggleDictation}
                    className="vam-tap flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-ink-dim hover:text-ink"
                  >
                    <span
                      aria-hidden="true"
                      data-tap-skin
                      className={[
                        'flex h-6 w-6 items-center justify-center rounded-[6px] border',
                        listening
                          ? 'border-running bg-running/15 text-running'
                          : 'border-line-strong bg-card hover:bg-line-strong',
                      ].join(' ')}
                    >
                      <Mic size={12} strokeWidth={1.7} className={listening ? 'vam-breathe' : ''} />
                    </span>
                  </button>
                </Note>
              )}
              {/* TWO OUTCOMES, TWO FACES. The mockup draws a send arrow here
              and this drew one for both of them -- for a source that types the
              prompt into the running session's pane and for a source that
              appends it to a log and nothing reads it back out. Those are
              different things to have done, and the whole distinction lived in
              an `aria-label` and a native `title`: invisible to anyone looking
              at the screen, and a `title` opens on hover and on nothing else,
              so on a keyboard-first tool it was invisible to the primary input
              device as well.

              So the outcome is PAINTED -- the word and the glyph both -- and
              the sentence moves into `Note`, which opens on focus. The comment
              that used to stand here said the button "says RECORD"; it had not
              done that since the wording became per-source, which is the same
              defect as the `title`, in prose. */}
              <Note text={composerClaim.title}>
                <button
                  type="button"
                  data-prompt-record
                  /* Which outcome this button is for, as a fact a guard can
                     read: the word is copy and may be rewritten, this is the
                     claim. */
                  data-prompt-delivers={delivers === true ? 'true' : undefined}
                  onClick={onSubmit}
                  disabled={sending}
                  aria-busy={sending}
                  aria-label={composerClaim.label}
                  className={[
                    `flex h-7 w-7 flex-none items-center justify-center rounded-[7px] bg-line-strong text-control text-ink ${FOCUS_RING}`,
                    sending ? 'cursor-progress opacity-60' : 'cursor-pointer hover:bg-line-loud',
                  ].join(' ')}
                >
                  {/* THE GLYPH ALONE. Operator: "drop the Send label from the
                      button, the icon is enough."

                      WHAT THE WORD WAS CARRYING has to go somewhere, and it
                      does: the delivers/records distinction is two different
                      GLYPHS (`ArrowUp` against `NotepadText`), the
                      `aria-label` above says which act in words, and `Note`
                      carries the whole sentence on focus and hover. WCAG 2.5.3
                      (label in name) stops applying the moment there is no
                      visible label; 1.1.1 takes over, and the name is what
                      satisfies it.

                      The claim's `word` went with the label: see
                      `composerClaim` above for why a field nothing paints is
                      deleted rather than left computed. */}
                  <ComposerGlyph
                    size={14}
                    strokeWidth={1.7}
                    aria-hidden="true"
                    className={sending ? 'vam-breathe' : ''}
                  />
                </button>
              </Note>
            </div>
            {/* THE KEY ROW IS GONE, AND THIS IS THE END OF A SEQUENCE RATHER
            THAN A DELETION. The operator narrowed it four times, each time
            after living with the last one, and the reasoning is kept here
            because the next reader's first instinct will be to put a hint
            back:

              1. It began as three captions: `Esc → sidebar`, `Mod-[ → leave`,
                 and the send key, on a row of their own under the input
                 (three do not fit beside the attach/provider/model/mode
                 controls in a 408px pane, and a caption that truncates hides
                 whichever is last).
              2. `Esc → sidebar` went the day Escape in this box became the
                 agent's INTERRUPT: a hint that outlives the behaviour it
                 describes is worse than no hint, since an operator would press
                 it expecting to leave and stop their agent instead.
              3. Then `Mod-[ → leave`, on a second look: "drop the leave
                 shortcut from under the prompt box."
              4. Then the send hint narrowed to the DEVIATION only -- silence
                 on `Enter`, a caption on `Shift-Enter` -- which left a row
                 that on a desktop, on the shipped key, drew nothing at all.
              5. And now: "remove the 'Esc to interrupt' shortcut under the
                 prompt input. Nothing is ever displayed down there." The whole
                 row goes, the send caption on it included, because the
                 operator's sentence is about the PLACE and not about one of
                 its captions.

            WHAT WENT IS CAPTIONS, NOT KEYS, and the distinction is the whole
            safety of this change. `Mod-[` is still bound in this box's own
            `onKeyDown` below and still reserved in `chords.ts` so nothing can
            take it; `Mod-0` and `Mod-Shift-h` still reach `focusList` from in
            here; Escape is still the interrupt; and the submit key still
            follows the preference. `test/panels/DetailPanel.test.tsx` asserts
            the three bindings against the real grammar so that removing a
            caption can never quietly remove one.

            WHAT IS NOW TAUGHT NOWHERE, said plainly rather than left to be
            discovered. The `?` sheet is generated from the chord TABLES, so it
            names `Mod-0` and `Mod-Shift-h` and it names neither `Mod-[` (bound
            here, not in a table) nor Escape (answered ahead of every table in
            `resolveChord`, which is why `keysheet.ts` gives `cancel` no row).
            `Mod-[` already went untaught two steps ago; Escape-as-interrupt
            goes untaught now, and this row was its only caption anywhere. The
            ACT keeps two real controls -- the In bubble's right-click "Cancel
            this turn", and the phone keystroke strip's `Esc → agent` button --
            so what is lost is the keystroke's discoverability, not the
            interrupt. That is a cost, it was asked for with the place named,
            and it is recorded here rather than dressed up as a tidy-up.

            SO THE TOOLS ROW ABOVE IS THE LAST THING IN THIS BOX. There is no
            element under the input at all now -- not an empty one, not a
            reserved band -- which is what the describe in `DetailPanel.test.
            tsx` asserts structurally rather than by one absent selector. */}
          </div>
        </div>
      )}

      {/* THE IN BUBBLE'S MENU. Drawn once for the pane, `position: fixed`, so
          the column's own `overflow` cannot clip it and the sticky band it was
          opened on cannot trap it. */}
      {promptMenu !== null &&
        (() => {
          const turn = orderedTurns.find((candidate) => candidate.id === promptMenu.id);
          if (turn === undefined) {
            // The poll dropped the turn out from under an open menu. Drawing a
            // menu for a turn that is gone would be two wrongs: acting on the
            // wrong turn, or acting on nothing while looking live.
            return null;
          }
          // READ BACK, never assumed: in the packaged app every Chromium
          // permission is denied and the renderer's own `navigator.clipboard`
          // refuses, so a caller that prints "copied" without looking is
          // telling the operator a lie. One closure for both menus.
          const copy = (what: string, name: string) => () => {
            void copyText(what).then((landed) => {
              setCycleNote({
                kind: landed ? 'sent' : 'refused',
                text: landed
                  ? `${name} copied to the clipboard`
                  : 'not copied — the clipboard refused the write',
              });
            });
          };
          return (
            <ContextMenu
              label={promptMenu.kind === 'prompt' ? 'prompt actions' : 'answer actions'}
              at={promptMenu.at}
              onClose={() => setPromptMenu(null)}
              items={
                promptMenu.kind === 'prompt'
                  ? promptMenuItems(turn, {
                      live: turn.id === newestId,
                      interruptRefusal,
                      onCopy: copy(turn.input, 'prompt'),
                      onCancel: interruptRun,
                    })
                  : answerMenuItems(turn, { onCopy: copy(turn.output ?? '', 'answer') })
              }
            />
          );
        })()}
    </aside>
  );

  // THE PANE'S OWN ACTS, published to every control drawn inside an answer:
  // the transcript's markdown AND the Files tab's markdown preview, which
  // share one component map. See `out-actions.ts`.
  return <OutActionsProvider value={outActions}>{pane}</OutActionsProvider>;
}

/**
 * What a right-click on an In bubble offers.
 *
 * TWO ITEMS, BECAUSE THE OPERATOR SAID THEY ARE TWO THINGS: "In bubble, copy,
 * cancel are different functions." Copy acts on the turn under the pointer;
 * cancel acts on the SESSION, and only while the turn under the pointer is the
 * one it is still working on.
 *
 * THE REFUSALS ARE SHOWN BEFORE THE CLICK, which is the only thing this menu
 * adds that Escape-in-the-composer does not. `interruptRefusal` carries the
 * three the pane already knows -- no terminal, not vam's session, nothing
 * running -- and the fourth is about the TURN rather than the session: an
 * older turn has already finished, whatever the session is doing now.
 *
 * Module scope, so the whole item set can be asserted without a pane.
 */
/**
 * What a right-click on the ANSWER block offers.
 *
 * ONE ITEM, and the restraint is the design. Copy is the only thing vam can
 * honestly do to an answer: cancelling belongs to the prompt -- it stops the
 * turn that is producing this answer, so offering it here would be the same
 * act named twice -- and there is no third capability to expose. A menu padded
 * out to match the bubble's length would be inventing items.
 */
export function answerMenuItems(
  turn: Decision,
  how: { readonly onCopy: () => void },
): ContextMenuItem[] {
  return [
    {
      id: 'copy',
      label: 'Copy answer',
      // THE BLOCK DRAWS A SENTENCE WHERE THERE IS NO ANSWER ("this turn ended
      // without an answer", and three more in `noAnswerNote`). Copying that
      // would put vam's own prose on the clipboard as if the agent had
      // written it -- which is a forgery, not an empty copy.
      unavailable:
        turn.output === null || turn.output === '' ? 'this turn has no answer to copy' : null,
      onPick: how.onCopy,
    },
  ];
}

/**
 * How much older a turn's prompt is than its newest step, as a sentence -- or
 * `null` when there is nothing honest to say.
 *
 * ── WHY THE LINE EXISTS ───────────────────────────────────────────────────
 * The In bubble PINS the prompt to the top of the column while the activity
 * line under it stays live. On a long turn those two are hours apart, and
 * nothing said so, so an hours-old prompt read as the current question. Two
 * different things looking the same, which is this pane's oldest defect
 * (`sources/pull-requests.ts`: "'No PRs' and 'vam could not ask' must never
 * look the same").
 *
 * ── WHAT IT CLAIMS, AND THE THREE THINGS IT MUST NOT ──────────────────────
 * It claims exactly this: the prompt was recorded at one time, the newest step
 * under it at another, and here is the distance. Both halves are timestamps
 * vam READ off the transcript.
 *
 * It does NOT say the session is stalled -- the activity line beside it says
 * otherwise and would contradict it. It does NOT say the operator has been
 * quiet: messages sent mid-turn reach the agent's context and are never
 * written to the transcript, so vam draws what WAS written and cannot speak
 * for what was not. And it does NOT say anything is wrong, because nothing is:
 * measured over the corpus, the median turn takes 9.3 minutes, p75 28, p90 77.
 *
 * ── A GAP, NOT AN AGE ─────────────────────────────────────────────────────
 * Between the two RECORDED times, never against `now`. A "3h ago" would need a
 * third clock, would drift against a transcript that has stopped being
 * written, and would change while the operator looked at it. This does not
 * move once the turn's newest step has landed.
 *
 * ── THE THRESHOLD IS MEASURED ─────────────────────────────────────────────
 * 30 minutes sits just past p75 (28), so the line stays away from three turns
 * in four and speaks for the quarter long enough for the pin to mislead. A
 * line on every turn would be noise, and noise is how an operator learns to
 * stop reading a pane.
 */
export const PROMPT_AGE_FLOOR_MS = 30 * 60 * 1000;

export function promptAgeNote(turn: Decision): string | null {
  const asked = turn.promptedAt;
  const latest = turn.latestAt;
  // ABSENT IS ITS OWN ANSWER, not zero. `last-prompt` carries no timestamp at
  // all (0 of 25,259 measured), so a turn whose prompt line is above the top
  // of the read window has no recorded time -- and most sources carry neither
  // field. Saying nothing is the honest output; "0m older" would be a claim.
  if (typeof asked !== 'string' || typeof latest !== 'string') return null;
  const from = Date.parse(asked);
  const to = Date.parse(latest);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  const gap = to - from;
  if (gap <= PROMPT_AGE_FLOOR_MS) return null;
  return `this prompt is ${gapLabel(gap)} older than the newest step below it`;
}

/** Coarse on purpose: the gap is a scale, not a duration to be counted. */
function gapLabel(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export function promptMenuItems(
  turn: Decision,
  how: {
    readonly live: boolean;
    readonly interruptRefusal: string | null;
    readonly onCopy: () => void;
    readonly onCancel: () => void;
  },
): ContextMenuItem[] {
  return [
    { id: 'copy', label: 'Copy prompt', onPick: how.onCopy },
    {
      id: 'cancel',
      label: 'Cancel this turn',
      danger: true,
      // THE TURN'S OWN TEST FIRST. A finished turn cannot be interrupted even
      // in a session that is busy on a later one, and reporting the session's
      // reason there would answer a question nobody asked.
      unavailable: how.live
        ? how.interruptRefusal
        : 'this turn has already finished — only the newest can be interrupted',
      onPick: how.onCancel,
    },
  ];
}
