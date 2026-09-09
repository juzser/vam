/**
 * The right panel: the focused step, in full, and the place you answer it.
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
 * ## The mockup's four tabs
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
 * The `LIVE_TABS` list below is the honest part: a tab is live for a SOURCE
 * that reports the thing it draws, and the factory source still reports none
 * of the three. So the tabs are real and their emptiness is source-specific, rather
 * than the tabs being labels.
 */

import {
  ArrowUp,
  Box,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  CircleSlash,
  GitPullRequest,
  Hand,
  Image as ImageIcon,
  ListChecks,
  MessageSquare,
  Paperclip,
  Sparkles,
  SquareTerminal,
  Users,
  X,
} from 'lucide-react';
import {
  isValidElement,
  type KeyboardEvent,
  memo,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AnswerRequest, AnswerResult, PanePrompt, PromptView } from '../../shared/answer.js';
import { PROVIDERS, type ProviderId, resolveProvider } from '../../shared/providers.js';
import type { PaneKey, PaneSendResult } from '../../shared/terminal.js';
import type {
  AgentQuestion,
  Command,
  Decision,
  PullRequest,
  PullRequestList,
  SessionAgent,
  SessionStatus,
  SlashCommand,
} from '../domain/model.js';
import type { SessionEntry } from '../domain/selectors.js';
import { questionKeys } from '../keyboard/question-keys.js';
import { ShortcutTip } from '../keyboard/ShortcutTip.js';
import { describeFailure } from '../sources/port.js';
import { PROVIDER_MARKS } from '../sources/provider-marks.js';
import { appendImagePath, removeImagePath } from './attach-image-path.js';
import { type ComposerImage, readPastedImages, spliceDraft } from './composer-paste.js';
import {
  type DiffKind,
  diffLineKind,
  type HighlightLang,
  resolveLang,
  type TokenKind,
  tokenizeCode,
} from './highlight.js';
import { Note } from './Note.js';
import { newestSet, toolUseOf } from './question-set.js';
import { hasContentAbove, hasContentBelow, isAtBottom, shouldStick } from './stick-to-bottom.js';

import { TerminalTab } from './TerminalTab.js';
import { TABS, type Tab, visibleTabs } from './tabs.js';

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
   * the actions below instead of the sessions, and `Esc`/`H` hands control back.
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
   * `claude --resume` is a subprocess with a 120-second timeout
   * (`deliver.ts`'s `DELIVER_TIMEOUT_MS`), so this is not a flicker: Enter can
   * start something that runs for two minutes. `Canvas` has had the flag since
   * the composer was written -- it guards against a double submit -- and it
   * never reached the pane, so the operator saw nothing happen and every
   * further Enter was swallowed without a word.
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
  readonly phone?: boolean;
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
   * `sources/preload-factory.ts`); every reply to a session already running
   * goes through `claude --resume` (`main/sources/claude-code/deliver.ts`),
   * which never consults it. A control drawn beside THIS session's composer
   * that claimed to change how ITS next reply is handled would be exactly
   * the lie `setModelRequest`'s own comment refuses elsewhere in this file —
   * there is no channel that would make it true. So the choice made here
   * changes what the NEXT session created starts with, wherever it is
   * started from; it is the same preference Settings writes, reachable from
   * where the operator is already looking.
   */
  readonly onSetDefaultProvider?: (id: ProviderId) => void;
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
 * One glyph per mode, chosen for what the mode MEANS and not for decoration —
 * the icon is the only thing on screen that says which mode is current, so two
 * that read alike would make the control unreadable at a glance.
 *
 * Auto: the agent decides its own next step. Manual: a hand on each one. Plan:
 * it writes the list before it touches anything.
 */
const MODE_ICON: Readonly<Record<Mode, typeof Sparkles>> = {
  Auto: Sparkles,
  Manual: Hand,
  Plan: ListChecks,
};

/** One glyph per view — chosen for what each shows, not decoration. */
const VIEW_ICON: Readonly<Record<Tab, typeof MessageSquare>> = {
  Response: MessageSquare,
  PRs: GitPullRequest,
  Terminal: SquareTerminal,
  Agents: Users,
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
         not merely see-through. The pill fill (`bg-sidebar`, matching the
         pane) plus a hairline border is what keeps the glyphs legible over
         whatever scrolls beneath rather than letting icon and letterform
         overlap into noise. */
      className="pointer-events-auto flex flex-none items-center gap-1 rounded-[9px] border border-line-strong bg-sidebar px-1 py-1 shadow-sm"
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
                  : 'text-ink-dim hover:bg-raised hover:text-ink',
              ].join(' ')}
            >
              <Icon size={13} strokeWidth={1.7} aria-hidden="true" />
              {badge !== null && (
                <span
                  data-view-badge
                  aria-hidden="true"
                  className="absolute -top-[3px] -right-[3px] flex h-[13px] min-w-[13px] items-center justify-center rounded-full bg-waiting px-[3px] font-mono text-[9px] text-ink leading-none"
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
 * How a pull request's checks are drawn: one token per verdict, and `none`
 * deliberately quiet.
 *
 * `none` uses the same dim ink as unknown text rather than a colour, because
 * a repository with no checks configured has nothing to report -- painting it
 * green would be the pane inventing a passing build.
 */
const CHECK_MARK: Record<PullRequest['checks'], { readonly dot: string; readonly label: string }> =
  {
    passing: { dot: 'bg-running', label: 'checks pass' },
    failing: { dot: 'bg-failed', label: 'checks fail' },
    pending: { dot: 'bg-waiting', label: 'checks running' },
    none: { dot: 'bg-line-strong', label: 'no checks' },
  };

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
function PullRequestsTab({ pullRequests }: { readonly pullRequests: PullRequestList | undefined }) {
  if (pullRequests === undefined) {
    return (
      <p data-prs data-prs-absent className="text-[12px] text-ink-faint">
        This source does not report pull requests for a session.
      </p>
    );
  }
  if (pullRequests.kind === 'unavailable') {
    return (
      <p
        data-prs
        data-prs-unavailable
        data-prs-code={pullRequests.code}
        className="text-[12px] text-ink-faint"
      >
        {/* vam could not ask. Not "there are none". */}
        {pullRequests.message}
      </p>
    );
  }
  if (pullRequests.prs.length === 0) {
    return (
      <p data-prs data-prs-empty className="text-[12px] text-ink-faint">
        This branch has no pull request on GitHub.
      </p>
    );
  }
  return (
    <ul data-prs className="vam-no-scrollbar flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
      {pullRequests.prs.map((pr) => (
        <li
          key={pr.number}
          data-pr-row
          data-pr-state={pr.state}
          data-pr-checks={pr.checks}
          className="flex items-center gap-2 rounded-[9px] border border-line bg-panel px-3 py-2"
        >
          <span
            data-pr-checks-mark
            title={CHECK_MARK[pr.checks].label}
            className={`h-1.5 w-1.5 flex-none rounded-full ${CHECK_MARK[pr.checks].dot}`}
          />
          <span className="min-w-0 flex-1">
            {/* Truncated, not shortened: the pane is a narrow column, and the
                whole title stays in the DOM for anything that reads it. */}
            <span data-pr-title className="block truncate text-[12.5px] text-ink">
              {pr.title}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px]">
              <span data-pr-number className="font-mono text-ink-faint">
                {`#${pr.number}`}
              </span>
              <span data-pr-state-label className={PR_STATE_INK[pr.state]}>
                {pr.state}
              </span>
              <span className="truncate text-ink-faint">{CHECK_MARK[pr.checks].label}</span>
            </span>
          </span>
        </li>
      ))}
    </ul>
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
function AgentsTab({ agents }: { readonly agents: readonly SessionAgent[] | undefined }) {
  const [showIdle, setShowIdle] = useState(false);
  if (agents === undefined || agents.length === 0) {
    return (
      <p data-agents data-agents-empty className="text-[12px] text-ink-faint">
        {agents === undefined
          ? 'This source does not report which agents a session is running.'
          : 'This session has spawned no agents.'}
      </p>
    );
  }
  const idleCount = agents.filter((agent) => !agent.running).length;
  const shown = showIdle ? agents : agents.filter((agent) => agent.running);
  const toggle =
    idleCount === 0 ? null : (
      <button
        type="button"
        data-agents-toggle
        aria-pressed={showIdle}
        onClick={() => setShowIdle((open) => !open)}
        className="flex-none cursor-pointer self-start rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11.5px] text-ink-faint hover:bg-raised hover:text-ink"
      >
        {showIdle ? `hide ${idleCount} idle` : `show ${idleCount} idle`}
      </button>
    );
  return (
    <div data-agents className="flex min-h-0 flex-1 flex-col gap-1.5">
      {shown.length === 0 ? (
        <p data-agents-empty className="text-[12px] text-ink-faint">
          {agents.length === 1
            ? 'This session’s one agent is not running right now.'
            : `None of this session’s ${agents.length} agents is running right now.`}
        </p>
      ) : (
        <ul className="vam-no-scrollbar flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {shown.map((agent) => (
            <li
              key={agent.id}
              data-agent-row
              data-agent-running={agent.running ? 'true' : 'false'}
              className="flex items-center gap-2 rounded-[9px] border border-line bg-panel px-3 py-2"
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
                <span data-agent-type className="block truncate text-[12.5px] text-ink">
                  {/* No type means no readable meta file beside the transcript, so
                  the id is the only name this agent has. */}
                  {agent.type ?? `${agent.id} (type unknown)`}
                </span>
                <span
                  data-agent-description
                  className="mt-0.5 block truncate text-[11.5px] text-ink-faint"
                >
                  {/* Truncated, not wrapped: the pane is 408px and a spawn
                  description is a sentence. The whole roster stays scannable. */}
                  {agent.description ?? 'no description recorded'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {toggle}
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
 */
function noAnswerNote(output: string | null, status: SessionStatus | null): string {
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
 * How each markdown element is dressed, in vam's own tokens.
 *
 * Every colour here is a token from `styles.css`, which carries a dark and a
 * light value for each — so this follows the theme rather than pinning one
 * half of it. The body keeps the size and colour the flat rendering already
 * had (12px/1.6 in `ink-dim`, measured off the mockup's Response artboards);
 * everything else is built around that so a heading or a table reads as a
 * step up from the body rather than as a different app.
 *
 * Two elements get their own scroller: a fenced block and a table have no
 * width of their own and this pane is resizable and 408px by default, so
 * without it the widest line in an answer decides how wide the pane is.
 *
 * `a` and `img` are the two that do NOT render as themselves, and the reason
 * is the same for both: `out` is an AGENT's text, which vam cannot vouch for.
 * An image would be a remote fetch that tells whoever wrote the answer that
 * this pane opened. A link would be a control that does nothing: the shell
 * denies `window.open` and every off-origin navigation (see src/main), which
 * is the correct policy. So the address is printed instead, in a region where
 * text is selectable, and opening it is a deliberate copy-and-paste.
 */
/**
 * The fence palette: which token kind wears which colour.
 *
 * Every class here is a TOKEN utility, never a literal colour (13.1), and none
 * of them is one of the four status colours — see the note beside them in
 * styles.css for why an added line must not be `running` green.
 */
const SYNTAX_CLASS: Record<TokenKind, string> = {
  plain: '',
  comment: 'text-syn-comment',
  string: 'text-syn-string',
  number: 'text-syn-number',
  keyword: 'text-syn-keyword',
};

const DIFF_CLASS: Record<DiffKind, string> = {
  plain: '',
  add: 'text-diff-add',
  del: 'text-diff-del',
  hunk: 'text-diff-hunk',
  file: 'text-diff-file',
};

/**
 * The `<code>` react-markdown puts inside a `<pre>`, read back as text plus
 * the fence's infostring.
 *
 * Returns null rather than guessing whenever the child is not the single plain
 * string a fence produces — a fence whose content is anything else is rendered
 * exactly as it was.
 */
function readFence(
  children: ReactNode,
): { readonly code: string; readonly lang: string | null } | null {
  const only = Array.isArray(children) && children.length === 1 ? children[0] : children;
  if (!isValidElement<{ className?: string; children?: ReactNode }>(only)) return null;
  const inner = only.props.children;
  const code =
    typeof inner === 'string'
      ? inner
      : Array.isArray(inner) && inner.every((k) => typeof k === 'string')
        ? inner.join('')
        : null;
  if (code === null) return null;
  return { code, lang: /language-([\w+#-]+)/.exec(only.props.className ?? '')?.[1] ?? null };
}

/**
 * A fence, coloured.
 *
 * Elements, never an HTML string: `out` is untrusted text and this is the wall
 * `OUT_MARKDOWN`'s note describes. A `<script>` an agent printed reaches the
 * DOM here as the characters of a `<script>`, as it did before there was any
 * colour at all.
 */
function Fence({ code, lang }: { readonly code: string; readonly lang: HighlightLang }) {
  // Keyed by BYTE OFFSET, not by list index: offsets are unique even when the
  // same line or the same token repeats, which in a patch they constantly do.
  let at = 0;
  const parts: { readonly key: string; readonly text: string; readonly cls: string }[] = [];
  if (lang === 'diff') {
    const lines = code.split('\n');
    for (const [i, line] of lines.entries()) {
      const text = i === lines.length - 1 ? line : `${line}\n`;
      parts.push({ key: `${at}`, text, cls: DIFF_CLASS[diffLineKind(line)] });
      at += text.length;
    }
  } else {
    for (const tok of tokenizeCode(code, lang)) {
      parts.push({ key: `${at}`, text: tok.text, cls: SYNTAX_CLASS[tok.kind] });
      at += tok.text.length;
    }
  }
  // Wrapped in a `<code>`, unclassed: the untouched path keeps react-markdown's
  // `<pre><code>`, so this one must too, or the fence's DOM shape would depend
  // on its infostring and the `<pre>`'s own `[&_code]` rules would reach only
  // half the fences. Unclassed because those rules are exactly what is left of
  // the chip styling once the `<pre>` has reset it.
  return (
    <code>
      {parts.map((part) => (
        <span key={part.key} className={part.cls}>
          {part.text}
        </span>
      ))}
    </code>
  );
}

/**
 * `out`'s type scale, in `em` against the root the pane's container carries
 * (`OUT_FONT_SIZE_VAR`, a pref).
 *
 * These were pixels — 13 / 12.5 / 12 headings, 12 body, 11.5 tables, 11 code,
 * 10.5 hints — a designed hierarchy rather than arbitrary numbers, so the
 * setting had to move all of them at once without flattening them. Each is its
 * old pixel size over the 12px root `body` already gave the pane, to three
 * decimals: 1.083 = 13/12, 1.042 = 12.5/12, 0.958 = 11.5/12, 0.917 = 11/12,
 * and 0.875 = 10.5/12 exactly. Rounding costs at most 0.01px at the largest
 * size offered, under one device pixel, so the scale is the shipped one.
 *
 * `em` not `rem`: the multiplier composes down the tree, so inline code stays
 * 11/12 OF ITS PARAGRAPH — which is what kept it a chip, not a body size.
 */
export const OUT_MARKDOWN: Components = {
  p: ({ children }) => <p className="text-[1em] text-ink-dim leading-[1.6]">{children}</p>,
  h1: ({ children }) => <h1 className="font-medium text-[1.083em] text-ink">{children}</h1>,
  h2: ({ children }) => <h2 className="font-medium text-[1.042em] text-ink">{children}</h2>,
  h3: ({ children }) => (
    <h3 className="font-medium text-[1em] text-ink tracking-[0.01em]">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="flex list-disc flex-col gap-1 pl-4 text-[1em] text-ink-dim leading-[1.6]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="flex list-decimal flex-col gap-1 pl-4 text-[1em] text-ink-dim leading-[1.6]">
      {children}
    </ol>
  ),
  // The bullet, not the item: `list-disc` and the item spacing already carry
  // the list's structure, so a barely-visible marker loses nothing the
  // `text-ink-dim` item text and the semantic `<ul>` do not already say.
  // Genuinely decorative -- stays on `ink-ghost` (issue 201).
  li: ({ children }) => <li className="marker:text-ink-ghost">{children}</li>,
  strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
  em: ({ children }) => <em className="text-ink-dim italic">{children}</em>,
  del: ({ children }) => <del className="text-ink-faint">{children}</del>,
  hr: () => <hr className="border-line border-t" />,
  blockquote: ({ children }) => (
    <blockquote className="border-quote border-l-2 pl-2.5 text-[1em] text-quote leading-[1.6]">
      {children}
    </blockquote>
  ),
  // Styled as an inline chip, and reset back to plain text inside a fence by
  // the `pre` rule below — react-markdown stopped telling a component which of
  // the two it is, and the parent knows without being told.
  code: ({ children }) => (
    <code className="rounded-[4px] bg-raised px-1 py-[1px] font-mono text-[0.917em] text-chip">
      {children}
    </code>
  ),
  pre: ({ children }) => {
    const fence = readFence(children);
    const lang = fence === null ? null : resolveLang(fence.lang);
    return (
      <pre className="vam-no-scrollbar overflow-x-auto rounded-[7px] border border-line bg-ground px-2.5 py-2 font-mono text-[0.917em] text-ink-dim leading-[1.55] [&_code]:bg-transparent [&_code]:px-0 [&_code]:text-ink-dim">
        {fence !== null && lang !== null ? <Fence code={fence.code} lang={lang} /> : children}
      </pre>
    );
  },
  table: ({ children }) => (
    <div className="vam-no-scrollbar overflow-x-auto">
      <table className="w-max border-collapse text-[0.958em] text-ink-dim">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-line bg-raised px-2 py-1 text-left font-medium text-chip">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-line px-2 py-1 align-top">{children}</td>,
  a: ({ href, children }) => (
    <span className="text-done">
      {children}
      {href !== undefined && (
        <span className="font-mono text-[0.875em] text-ink-faint"> ({href})</span>
      )}
    </span>
  ),
  img: ({ alt }) => (
    <span className="font-mono text-[0.875em] text-ink-faint">{alt === '' ? 'image' : alt}</span>
  ),
};

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
              <Markdown remarkPlugins={[remarkGfm]} components={OUT_MARKDOWN}>
                {body}
              </Markdown>
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
 * The phone keystroke strip's five keys -- vam's real `PaneKey` shapes, not
 * orca's five: there is no `PaneKey` kind for a plain Tab (`terminal.ts`), so
 * it is refused outright rather than drawn as a button that always fails.
 * `id` is the strip's own attribute name, distinct from `PaneKey['kind']`
 * only for `space`, which is a `text` key rather than a kind of its own.
 *
 * Escape and Enter carry a visible caption naming a different destination
 * than their textarea siblings already claim (`Esc → sidebar`, the send
 * arrow) -- the one place this spec asks for exact wording rather than
 * leaving it to the coder.
 */
const KEY_STRIP: readonly {
  readonly id: string;
  readonly key: PaneKey;
  readonly caption: string;
  readonly ariaLabel: string;
}[] = [
  {
    id: 'escape',
    key: { kind: 'escape' },
    caption: 'Esc → agent',
    ariaLabel: 'press Escape in the session',
  },
  {
    id: 'enter',
    key: { kind: 'enter' },
    caption: '⏎ → agent',
    ariaLabel: 'press Enter in the session',
  },
  {
    id: 'backspace',
    key: { kind: 'backspace' },
    caption: '⌫',
    ariaLabel: 'press Backspace in the session',
  },
  {
    id: 'back-tab',
    key: { kind: 'back-tab' },
    caption: '⇧⇥',
    ariaLabel: 'press Shift-Tab in the session',
  },
  {
    id: 'space',
    key: { kind: 'text', text: ' ' },
    caption: '␣',
    ariaLabel: 'press Space in the session',
  },
];

function QuestionCard({
  questions,
  firstOptionRef,
  onChat,
  onAnswer,
  onSuggest,
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
}) {
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
  /** What the last Submit came back with, and whether one is in flight. */
  const [outcome, setOutcome] = useState<AnswerResult | null>(null);
  const [sending, setSending] = useState(false);
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
  const walk = (by: number) => {
    const next = Math.min(Math.max(showing + by, 0), questions.length - 1);
    if (next === showing) return;
    setShowing(next);
    setLanding(next);
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
  useEffect(() => {
    if (landing === null) return;
    setLanding(null);
    const target = showingTaken
      ? stepTabRef.current
      : (firstOptionRef.current ?? stepTabRef.current);
    target?.focus();
  }, [landing, showingTaken, firstOptionRef]);

  const send = async () => {
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
        .filter((label) => (marks[one.id] ?? []).includes(label)),
      multiSelect: one.multiSelect,
    }));
    if (onAnswer === null || sending || steps.length === 0) return;
    if (steps.some((one) => one.labels.length === 0)) return;
    setSending(true);
    const result = await onAnswer({ steps });
    setOutcome(result);
    // What the picker took in before it stopped is not offered again: those
    // questions are behind the CLI's own cursor now.
    const got = result.kind === 'sent' ? undefined : result.committed;
    if (got !== undefined) setTaken((already) => [...already, ...got]);
    setSending(false);
  };

  const toggle = (label: string, viaPointer = false) => {
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

  // The list walks with the arrows, and jumps with the numbers; every option is
  // a real button, so Enter and Space already mark one and Tab already leaves.
  //
  // The digits are BARE, and safely so because this listener is the listbox's:
  // it can only fire while the keyboard is already inside the options list,
  // which is where `i` puts it. The canvas grammar binds no bare digit at all,
  // and the bare letters that do mean something there (`j`, `k`, and the rest)
  // are letters. So a number here cannot be a keystroke meant for somewhere
  // else -- and with no question open there is no list to hold focus.
  const onKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    // A MODIFIED key is never one of ours. Scope is what makes the bare keys
    // below safe -- this listener only hears anything while the keyboard is
    // already in the options list -- but scope says nothing about modifiers,
    // and reading `event.key` alone made `Cmd+C` match the `c` branch (killing
    // the copy and opening the composer) and `Cmd+2` mark an option on its way
    // to the chord layer. A chord is not text and not a pick, so it belongs to
    // the grammar and this stands aside, which is the same rule the prompt box
    // already follows.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // `c` for chat, the way out of the picker and into prose. Scoped like the
    // digits: the listener is the listbox's, so it only hears a key while the
    // keyboard is already in the options list -- which is where `i` puts it.
    // The entry itself is a button outside the list, reached by Tab or mouse
    // and activated by Enter, Space or a click, like any other.
    if (keys.chat.includes(event.key)) {
      event.preventDefault();
      onChat();
      return;
    }
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-question-option]'),
    ];
    if (/^[1-9]$/.test(event.key)) {
      const at = Number(event.key) - 1;
      const option = question?.options[at];
      if (option === undefined) return;
      event.preventDefault();
      toggle(option.label);
      // The keyboard follows the mark, so the arrows walk on from where you
      // landed rather than from wherever you were.
      buttons[at]?.focus();
      return;
    }
    /**
     * `j`/`k` walk the options and `h`/`l` walk the STEPS — the Insert half of
     * the operator's table, with both axes meaning something now.
     *
     * The horizontal pair used to do nothing at all, deliberately: unhandled,
     * it falls through to the canvas grammar and walks the node graph under a
     * pane the operator is reading, which is the same "the keys work, they
     * just do the wrong thing" failure the mode naming exists to end. It is
     * still stopped from reaching the canvas; a set of questions simply gives
     * it the meaning the vertical pair always had, and it is the obvious one
     * -- down the options, across the questions. `H` — capital, a different key — is still the way
     * back to Select, and Escape still leaves.
     */
    if (keys.prev.includes(event.key) || keys.next.includes(event.key)) {
      event.preventDefault();
      walk(keys.next.includes(event.key) ? 1 : -1);
      return;
    }
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1 || buttons.length === 0) return;
    /**
     * ENTER SELECTS THE OPTION UNDER THE CURSOR, and it is handled here rather
     * than left to the button's native activation for a reason worth stating:
     * Enter also means something in this pane. The canvas grammar's `open`
     * fires on Enter while the keyboard is in the right pane and raises the
     * composer, and the pull request numbered one hundred and eleven is the
     * record of what happens when a cursor and an
     * Enter disagree about what they are pointing at. Handling it here and
     * calling `preventDefault` gives Enter ONE meaning while the keyboard is
     * in the list — mark this option — because the canvas listener stands
     * aside for a key that has already been answered.
     */
    if (event.key === 'Enter' || event.key === ' ') {
      const option = question?.options[at];
      if (option === undefined) return;
      event.preventDefault();
      toggle(option.label);
      return;
    }
    const down = keys.down.includes(event.key);
    const up = keys.up.includes(event.key);
    if (!down && !up) return;
    event.preventDefault();
    const step = down ? 1 : -1;
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  };

  if (question === undefined) return null;

  return (
    <div
      data-question
      data-question-open={open ? 'true' : undefined}
      data-question-select={question.multiSelect ? 'multi' : 'single'}
      data-question-waiting={waiting ? 'true' : undefined}
      className={[
        'flex flex-col gap-1.5 rounded-[10px] border bg-panel px-2.5 py-2',
        waiting ? 'border-waiting' : 'border-line-strong',
      ].join(' ')}
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
          onKeyDown={(event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const forward = event.key === 'l' || event.key === 'ArrowRight';
            if (!forward && event.key !== 'h' && event.key !== 'ArrowLeft') return;
            event.preventDefault();
            walk(forward ? 1 : -1);
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
                'vam-tap cursor-pointer rounded-[5px] border px-1.5 py-0.5 text-[11px]',
                index === showing ? 'border-running text-ink' : 'border-line text-ink-faint',
              ].join(' ')}
            >
              {one.header ?? `${index + 1}`}
              {one.answer !== null || (marks[one.id] ?? []).length > 0 ? ' ✓' : ''}
            </button>
          ))}
          <span data-question-position className="ml-auto text-[11px] text-ink-faint">
            step {showing + 1} of {questions.length}
          </span>
        </nav>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        {question.header !== null && (
          <span data-question-header className="text-[11px] text-ink-faint uppercase tracking-wide">
            {question.header}
          </span>
        )}
        <span data-question-text className="text-[12.5px] text-ink">
          {question.question}
        </span>
      </div>
      {question.answer !== null ? (
        // THIS step is settled while others may not be. It shows what was
        // answered and offers nothing to mark; the set's Submit below is for
        // whatever is still open.
        <span data-question-answer className="text-[11.5px] text-ink-dim">
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
              className="flex items-baseline gap-2 rounded-[6px] border border-running bg-raised px-1.5 py-1"
            >
              <span data-question-marked className="min-w-0 flex-1 text-[12px] text-ink">
                {picked.join(', ')}
                <span className="text-[11px] text-ink-faint"> — marked, not sent</span>
              </span>
              <button
                type="button"
                data-question-expand
                onClick={() => setFoldedStep(null)}
                className="vam-tap flex-none cursor-pointer rounded-[6px] px-1.5 py-0.5 text-[11px] text-ink-dim underline decoration-dotted hover:text-ink"
              >
                change
              </button>
            </div>
          ) : (
            /* A listbox, not a form control: nothing here is submitted, and
              `aria-multiselectable` is the one honest way to say that several
              may be marked. */
            <div
              role="listbox"
              aria-multiselectable={question.multiSelect}
              aria-label="the options this question offers"
              onKeyDown={onKeys}
              className="flex flex-col gap-1"
            >
              {question.options.map((option, index) => (
                <button
                  key={option.label}
                  ref={index === 0 ? firstOptionRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={picked.includes(option.label)}
                  data-question-option
                  data-question-number={NUMBERED_OPTIONS[index]}
                  data-picked={picked.includes(option.label) ? 'true' : undefined}
                  onClick={(event) => toggle(option.label, event.detail > 0)}
                  className={[
                    'vam-tap flex cursor-pointer flex-col items-start gap-0.5 rounded-[6px] border px-1.5 py-1 text-left',
                    picked.includes(option.label)
                      ? 'border-running bg-raised'
                      : 'border-line hover:bg-raised',
                  ].join(' ')}
                >
                  <span className="flex max-w-full items-baseline gap-1.5 text-[12px] text-ink">
                    {NUMBERED_OPTIONS[index] !== undefined && (
                      <span className="text-[11px] text-ink-faint tabular-nums">
                        {NUMBERED_OPTIONS[index]}
                      </span>
                    )}
                    <span className="min-w-0">{option.label}</span>
                  </span>
                  {option.description !== null && (
                    <span
                      data-question-description
                      className="max-w-full text-[11.5px] text-ink-dim"
                    >
                      {option.description}
                    </span>
                  )}
                  {/* WHAT PICKING IT WOULD PRODUCE, under the reason for picking
                  it and set in mono because that is usually what it is -- a
                  colour, a path, a line of the thing that would be written. It
                  was in the record all along and drawn nowhere. */}
                  {(option.preview ?? null) !== null && (
                    <span
                      data-question-preview
                      className="max-w-full truncate font-mono text-[11px] text-ink-faint"
                    >
                      {option.preview}
                    </span>
                  )}
                </button>
              ))}
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
            className="vam-tap flex cursor-pointer items-baseline gap-1.5 rounded-[6px] border border-line border-dashed px-1.5 py-1 text-left hover:bg-raised"
          >
            {/* THE HINT COMES OFF THE SAME TABLE THE HANDLER READS, and is
              not printed at all when the key is not held -- a caption naming a
              key that does nothing is the defect, not the absence of one. */}
            {keys.chat[0] !== undefined && (
              <span data-question-chat-key className="text-[11px] text-ink-faint tabular-nums">
                {keys.chat[0]}
              </span>
            )}
            <span className="min-w-0 text-[12px] text-ink">Chat about this</span>
            <span className="min-w-0 text-[11.5px] text-ink-faint">
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
            disabled={unmarked.length > 0 || sending}
            onClick={() => void send()}
            className={[
              'rounded-[6px] border px-1.5 py-1 text-[12px]',
              unmarked.length > 0 || sending
                ? 'cursor-default border-line text-ink-faint'
                : 'cursor-pointer border-running text-ink hover:bg-raised',
            ].join(' ')}
          >
            {sending ? 'Submitting…' : 'Submit'}
          </button>
          {questions.length > 1 && (
            <span data-question-progress className="text-[11px] text-ink-faint">
              {pending.length - unmarked.length} of {pending.length} marked
            </span>
          )}
        </div>
      )}
      {outcome !== null && (
        <p data-question-outcome data-outcome={outcome.kind} className="text-[11px] text-ink-dim">
          {outcomeWording(outcome)}
        </p>
      )}
      {open && (
        <p data-question-note className="text-[11px] text-ink-faint">
          {onAnswer === null
            ? // Still exactly true where there is no delivery: nothing here can
              // reach the tool call, and a control that implied otherwise would
              // be the lie this sentence was written against.
              'vam cannot answer this for you — a pick is only a mark, and nothing goes back to the session; type your choice in the box below.'
            : // And still true where there is: picking sends nothing. Submit is
              // the thing that sends, and it sends the whole set at once, the
              // way the call was asked.
              'a pick is only a mark until you press Submit — Submit walks the session own picker through every step and says what it read back.'}
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
  readonly reserveCorner: boolean;
}) {
  const failed = decision.errorCount ?? 0;
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
          you scroll"), with an opaque background so the answer scrolling
          underneath does not bleed through the prompt.

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
      <section
        data-detail-block="in"
        className="-mx-3.5 sticky top-0 z-10 flex max-h-[45cqh] min-h-0 flex-none flex-col gap-1 bg-ground px-3.5 pt-1.5 pb-1.5"
      >
        {/* The region's name, announced and not drawn. */}
        <span className="sr-only">in</span>
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
          className="min-h-0 min-w-0 overflow-y-auto rounded-[10px] bg-raised px-2.5 py-2"
        >
          <p className="whitespace-pre-wrap break-words text-[13px] text-ink-dim leading-[1.55]">
            {/* THE RESERVED CORNER, audit F1's obligation. A float rather than
                padding because only the FIRST LINE meets the pill: padding
                would indent all 300 lines of a long prompt to clear something
                34px tall. Sized off the measured pill (72px at any width, plus
                what the icon count adds); 6rem covers it with 24px to spare,
                and the bound is measured by
                `e2e/narrow-pane-overlay-shots.mjs`, which fails both if the
                reservation misses the pill and if it runs far past it.

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
            {reserveCorner && (
              <span
                data-detail-corner-reserve
                aria-hidden="true"
                className="float-right h-[22px] w-[6rem]"
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
          inside it failed. */}
      <section data-detail-block="progress" className="flex flex-none flex-col gap-1">
        {/* Announced, not drawn. */}
        <span className="sr-only">progress</span>
        <div
          data-progress-line
          className="flex items-center gap-1.5 font-mono text-[10.5px] text-ink-faint"
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
      </section>

      <section data-detail-block="out" className="flex flex-none flex-col gap-1.5">
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
              className="text-[12.5px] text-ink-faint"
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
                    {activity ?? noAnswerNote(decision.output, status)}
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
                noAnswerNote(decision.output, status)
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
    terminal,
    pickImageAttachment,
    sending = false,
    width,
    resizeHandle,
    records,
    phone = false,
    defaultProvider,
    onSetDefaultProvider,
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
  /**
   * Whether the condensed progress line is open into its list of turns.
   * Closed by default: the intermediate work is what an operator scrolls past
   * to read the answer, so it costs one line until it is asked for. Local to
   * the pane, and deliberately not reset when the turn changes -- an operator
   * walking history with the list open wants it to stay open.
   */
  const [progressOpen, setProgressOpen] = useState(false);
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
   * A PICK THE WINDOW NO LONGER CARRIES AT ALL -- not merely off the newest
   * slice, but genuinely absent from `entry.session.decisions`, the same gap
   * `source.ts` already documents for `questions` past `TAIL_BYTES`: vam
   * cannot tell "answered a while ago" from "never happened" for something
   * outside the window, so it must not pretend otherwise. Checked before
   * falling back to `canvasDecision`, which is what stops that fallback from
   * quietly relabelling a different turn as the one the operator picked.
   */
  const selectedTurnMissing =
    entry !== null &&
    selectedId !== null &&
    selectedId !== canvasDecisionId &&
    !entry.session.decisions.some((d) => d.id === selectedId);
  /**
   * RENDERED FROM THE PROP WHEN IT MATCHES, RATHER THAN RE-FOUND BY ID. While
   * this panel is following the canvas's own pick (the common case),
   * `canvasDecision` is already the freshest object this render has -- built
   * from this same `entry.session.decisions` -- so using it as given is what
   * keeps a streaming answer on the newest turn live. A re-lookup would still
   * find the same id, but there is no reason to add one. Only once the
   * operator has picked something else does this reach into
   * `entry.session.decisions` for it, which is the one place that turn's
   * current content actually lives -- and `null` when it is not there at
   * all, so `selectedTurnMissing`'s message draws instead of a substitute.
   */
  const decision: Decision | null = selectedTurnMissing
    ? null
    : selectedId === canvasDecisionId
      ? canvasDecision
      : (entry?.session.decisions.find((d) => d.id === selectedId) ?? canvasDecision);
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
   * ONE KEYSTROKE, into this session's pane, shared by the mode row's own
   * Shift-Tab AND every button of the phone keystroke strip -- they are the
   * SAME channel (`window.api.terminal.send`) into the SAME pane, so one
   * in-flight guard and one refusal caption serve both rather than each
   * growing its own copy. `cycleNote` is the shared note; `sentText`/
   * `busyText` are the one difference between a mode cycle and a keystroke.
   *
   * One press at a time, ACROSS BOTH CONTROLS: held down, a repeat here
   * queued a `back-tab` per repeat into a live agent with nothing on screen
   * counting them, and a phone tap repeated in a hurry is the same failure.
   * `window.api` exists only in the Electron shell, and its absence is
   * reported rather than made into a no-op.
   */
  const pressPaneKey = async (key: PaneKey, sentText: string, busyText: string) => {
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
    const landed = await send(entry.project.id, key, entry.session.id).catch(
      (): PaneSendResult => 'refused',
    );
    // Thirty seconds is long enough to move on, and an answer about the
    // session that was here then says nothing about the one that is here now.
    if (noteFor.current !== mine) return;
    const refusal = cycleWording(landed);
    setCycleNote(
      refusal === null ? { kind: 'sent', text: sentText } : { kind: 'refused', text: refusal },
    );
  };
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
    pressPaneKey(
      { kind: 'back-tab' },
      '⇧Tab sent — vam does not read the mode back',
      '⇧Tab · sending…',
    );
  /** One keystroke-strip button's press, over the shared bridge above. */
  const sendKey = (item: (typeof KEY_STRIP)[number]) =>
    pressPaneKey(item.key, `${item.caption} sent`, `${item.caption} · sending…`);
  /** The first option of the open question, when one is being asked. */
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  /**
   * Which tab the pane is showing. Still component state, and still nobody
   * else's opinion: it survives switching sessions on purpose -- an operator
   * who opened Agents is looking at agents, not at whichever tab the last
   * session left behind -- and it now survives a QUIT for the same reason,
   * seeded from what the caller remembered rather than owned by it.
   *
   * The seed is validated against `TABS` here because this is where the bar is.
   * A name that is not on the bar (an older vam's tab, a hand-edited store) is
   * simply not a seed, so it costs the default tab and nothing else.
   */
  const [tab, setTab] = useState<Tab>(() => {
    const remembered = props.initialTab;
    return TABS.find((name) => name === remembered) ?? 'Response';
  });
  const onTabChange = props.onTabChange;
  /**
   * Report the operator's CHOICE, never `current`. `current` falls back to
   * Response while a source withdraws the Terminal tab, and persisting that
   * would let walking past a session without a terminal erase a choice the
   * operator never changed.
   *
   * FROM THE FOCUSED PANE ONLY, and this one is not a preference: `prefs`
   * holds ONE remembered tab and `onTabChange` is a fresh closure every
   * render, so this effect fires on every render — with two panes showing
   * two different tabs, each write re-rendered the other pane, which wrote
   * back, forever. Measured on this head before the fix: clicking the PRs
   * icon in one pane of a split hangs the shell in a synchronous loop of
   * `savePrefs`. One writer, the pane holding the keyboard, is what makes
   * "the tab a previous run left showing" a single fact again; a background
   * pane's tab is not the operator's current choice anyway.
   */
  useEffect(() => {
    if (!paneFocused) return;
    onTabChange?.(tab);
  }, [tab, onTabChange, paneFocused]);
  const tabRequest = props.tabRequest ?? null;
  const viewNote = props.viewNote ?? null;
  // A withdrawn tab is not refused here: `current` below already falls back to
  // Response when the showing tab is not on offer, so asking for Terminal
  // where there is none lands exactly where clicking would have.
  useEffect(() => {
    if (tabRequest !== null) {
      setTab(tabRequest.tab);
    }
  }, [tabRequest]);
  // Which tabs this source actually has. A withdrawn tab cannot stay SHOWING:
  // the operator can be on Terminal when focus moves to a session from a
  // source without one, and a tab bar with nothing selected over a pane
  // drawing a tab that is no longer offered is the state this collapses.
  const tabs = visibleTabs(terminal !== false);
  const current = tabs.includes(tab) ? tab : 'Response';

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
   * ENTERING INSERT PUTS THE KEYBOARD ON THE FIRST OPTION, AND LEAVING TAKES
   * IT BACK — the wiring that makes "`hjkl` chooses an option in Insert" true.
   *
   * The option cursor is DOM focus, not a second index: the options are real
   * buttons, so focus is already the thing the browser, the screen reader and
   * the focus ring all agree on, and a parallel index in the canvas would be a
   * second notion of where the cursor is — the exact duplication the mode
   * naming exists to remove.
   *
   * Both directions are necessary. Without the first, `I` sets Insert while
   * focus is still on the body, so `j` reaches the canvas grammar and walks
   * the session list — the operator's original complaint. Without the second,
   * `H` returns to Select while focus is still inside the listbox, so the list
   * goes on eating `j` in a mode where it belongs to the sidebar. That is the
   * same defect mirrored, and it is the one a reader will not think of.
   */
  const wasActive = useRef(false);
  useEffect(() => {
    const leaving = wasActive.current && !active;
    wasActive.current = active;
    if (active) {
      firstOptionRef.current?.focus();
      return;
    }
    // ONLY ON THE WAY OUT, never on a first render. `i` focuses an option from
    // the effect above while `active` is still false — the composer path, which
    // does not touch the mode — so a blur that fired whenever `active` was
    // false would undo it on mount and leave the keyboard nowhere.
    if (!leaving) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.hasAttribute('data-question-option')) {
      focused.blur();
    }
  }, [active]);

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
   * A15.4: whether the default-provider picker is open. Component state,
   * same register as `dismissed`/`pick` below for the bang/slash lists — a
   * second `DetailPanel` instance (a split pane, A15.1) gets its own copy,
   * never a shared one, which matters because this popover's open/closed
   * state is about THIS pane's own composer, not a fact about the provider
   * itself.
   */
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  /**
   * The mode popover's open/closed state — per pane, for the same reason the
   * provider one above is, and NOT a copy of the mode itself: the mode lives
   * in the draft, which is the text that actually gets recorded.
   */
  const [modePickerOpen, setModePickerOpen] = useState(false);
  /**
   * The mode ON SCREEN, read back out of the draft on every render. A draft
   * carrying some other word on its `mode:` line reads as the default: only
   * these three can be picked here, and an icon has no way to draw a fourth.
   */
  const currentMode: Mode = MODES.find((mode) => mode === readModeRequest(draft)) ?? DEFAULT_MODE;
  const ModeGlyph = MODE_ICON[currentMode];
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
  useEffect(() => {
    const box = inputRef.current;
    if (box === null) return;
    box.style.height = 'auto';
    // An empty box returns to its `rows` height, not to one line's worth:
    // `auto` on a textarea is the placeholder's two lines, `scrollHeight` is
    // the content's, and with no content those are not the same number.
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

  const commands = decision?.commands ?? [];
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
  const matches = query === null ? [] : matchCommands(commands, query);
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
  const slashMatches = slashQuery === null ? [] : matchSlashCommands(slashCommands, slashQuery);
  const slashSuggesting = !dismissed && slashMatches.length > 0;
  const slashPicked = Math.min(pick, slashMatches.length - 1);
  const acceptSlashSuggestion = (command: SlashCommand) => {
    const next = applySlashCommand(draft, caret, command.name);
    onDraftChange(next.text);
    setCaret(next.caret);
    setDismissed(true);
  };
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
  useEffect(() => {
    if (!readable || prompt === undefined) {
      setPaneAsk(null);
      return;
    }
    let live = true;
    const look = async () => {
      const view = await prompt(projectId, rowId);
      // ONLY A PROMPT IS DRAWN. Every other answer -- no picker, an
      // unreadable pane, a pairing vam refused -- leaves the card absent and
      // the waiting note standing, which already names the reach state. A
      // card built out of a refusal would be a control that cannot act.
      if (live) setPaneAsk(view.kind === 'prompt' ? view.prompt : null);
    };
    void look();
    // The prompt is a SCREEN, not a record: it appears and disappears without
    // anything telling vam, so it is re-read while the row is waiting.
    const timer = setInterval(() => void look(), PROMPT_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [readable, prompt, projectId, rowId]);
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
    entry === null || records === false || (openQuestion && chattingAbout !== setId);
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
   * Is the failed-session banner drawn above the column? Two readers, which
   * is why it is named: the banner itself, and the column, which hands its
   * top padding to the sticky ground and must NOT when something is sitting
   * in that padding already.
   */
  const failedBanner = current === 'Response' && entry?.session.status === 'failed';
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
   */
  const turnsRead = entry?.session.decisions.length ?? 0;
  // Oldest first: `decisions` arrives newest first. That
  // ordering is what makes "the last line" and "the newest turn" the same
  // line, so the ones kept are taken off the end.
  const orderedTurns = [...(entry?.session.decisions ?? [])].reverse();
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
   */
  const pickTurn = (id: string) => {
    setSelectedId(id);
    scrollToTurnRef.current = id;
  };

  /**
   * What the composer's button claims, in the words the SOURCE earns.
   *
   * PR #70 gave the Claude Code source a real channel into a running session,
   * so for that source a prompt is handed over and answered — `record` now
   * understates it, and an operator has to know when a message is going out.
   * the factory source still genuinely only appends to a log, so this is per-source
   * and not a rename: one wording for both would be wrong for one of them.
   */
  const composerClaim = sending
    ? // The in-flight wording keeps the delivers/records distinction. Losing it
      // here would make the pane's one honest sentence wrong for exactly as
      // long as the write takes, which is the window the operator is actually
      // watching.
      delivers === true
      ? {
          label: 'sending prompt…',
          title: 'handing the prompt to the running agent session — this can take a while',
        }
      : {
          label: 'recording prompt…',
          title: 'appending the prompt to this session\u2019s log',
        }
    : delivers === true
      ? {
          label: 'send prompt',
          title: 'sends the prompt into the running agent session — it is delivered, not filed',
        }
      : {
          label: 'record prompt',
          title:
            'appends the prompt to this session\u2019s log — vam cannot hand it to a running agent',
        };
  return (
    <aside
      data-action-pane={active ? 'active' : 'idle'}
      style={width === undefined ? undefined : { width }}
      className={[
        // `bg-sidebar` is the mockup's own pane fill. Measured off the
        // `width:408px` column of artboards 1a/1b, both values are exactly what
        // this token already holds, so no new colour was invented for it.
        'relative flex h-full min-w-0 flex-col border-line border-l bg-sidebar',
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
              className="min-w-0 max-w-[160px] truncate rounded-[7px] border border-line-strong bg-sidebar px-1.5 py-0.5 text-right font-mono text-[10.5px] text-waiting"
            >
              {viewNote}
            </span>
          )}
          <ViewIcons
            tabs={tabs}
            runningAgents={entry?.session.runningAgents ?? 0}
            current={current}
            onSelect={setTab}
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
      <div className="flex min-h-0 flex-1 select-text flex-col gap-2.5 px-3.5 py-3">
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
            className="flex flex-none items-center gap-1.5 rounded-[9px] border border-failed bg-panel px-3 py-2 text-[12px] text-failed leading-[1.45]"
          >
            <span role="img" aria-label="failed" className="flex">
              <CircleSlash size={13} strokeWidth={1.6} />
            </span>
            <span className="min-w-0 flex-1">This session failed.</span>
            <Note text="the source reports no reason for the failure — a failed row carries no error, message or exit code">
              <span className="flex-none cursor-help font-mono text-[10.5px] text-ink-faint underline decoration-dotted">
                why?
              </span>
            </Note>
          </p>
        )}
        {current === 'Terminal' ? (
          /* Mounted by this branch and by nothing else, which is the whole of
             the tab's laziness: while another tab is showing, the component
             does not exist, so no timer runs and no `capture-pane` is spawned.
             `window.api` exists only in the Electron shell (App.tsx); in the
             browser build the tab says so instead of asking. */
          <TerminalTab
            projectId={entry?.project.id ?? null}
            rowId={entry?.session.id}
            read={globalThis.window?.api?.terminal?.read}
            /* The pane fits because tmux is TOLD the size: `capture-pane`
               returns a screen tmux already composed at the session's own
               size, which no style on this side can re-wrap. */
            resize={globalThis.window?.api?.terminal?.resize}
            /* Typing. Passed here beside the other two rather than reached for
               inside the tab, so all three halves of the bridge this tab uses
               are visible at the one call site: a member wired invisibly is
               one refactor away from being dropped with nothing to notice.
               `undefined` in the browser build, where the tab says so instead
               of taking keys it cannot deliver. */
            send={globalThis.window?.api?.terminal?.send}
          />
        ) : current === 'Agents' ? (
          <AgentsTab agents={entry?.session.agents} />
        ) : current === 'PRs' ? (
          <PullRequestsTab pullRequests={entry?.session.pullRequests} />
        ) : orderedTurns.length === 0 ? (
          entry === null && !phone ? // SAID ONCE (audit F9). A desktop pane always has a tab strip
          // above it, and an empty strip already says "no sessions open —
          // pick one from the sidebar". This line said the same thing in
          // different words 40px below it, in otherwise empty space. The
          // PHONE has no strip, so there it is the only sentence there is and
          // it stays.
          null : (
            <p className="text-[12px] text-ink-faint">
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
          <div
            ref={outRef}
            data-detail-column
            onScroll={(event) => {
              stuckRef.current = isAtBottom(event.currentTarget);
              syncJumps(event.currentTarget);
            }}
            /* FULL-BLEED, so the sticky ground inside can be. The pane body
               puts `px-3.5 py-3` around everything; a scroll column inside
               that padding can only paint as wide as the padding box, which
               left a 14px gutter down each side of the pinned prompt with
               the transcript scrolling past in it, in full view. So the
               column takes the padding OFF the body (`-mx-3.5`) and puts it
               back on itself (`px-3.5`): every child lays out exactly where
               it did, and the ones that ask for it -- every turn's sticky
               ground, and the navigation bar -- reach the pane's own edges
               with `-mx-3.5` of their own.

               The TOP is the same move without the give-back: `-mt-3` hands
               the body's top padding to the column, which re-spends it on the
               boundary block below. Not when the failed banner is drawn --
               there IS something above the column then, and pulling up would
               slide the column under it.

               `container-type:size` IS LOad-BEARING, not decoration: it makes
               this element the size container the `45cqh` cap on every turn's
               sticky prompt resolves against. Without it that cap resolves to
               nothing inside the per-turn wrapper and the pinned prompt can
               cover the answer again (audit F2). `TurnBlock`'s own comment
               carries the measurement. */
            className={`vam-no-scrollbar -mx-3.5 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-3.5 [container-type:size] ${
              failedBanner ? '' : '-mt-3'
            }`}
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

              TWO STATES, AND ONLY ONE OF THEM IS ASSERTABLE TODAY:
                - `read-limit` — "this is as far back as vam has read". True
                  whenever the window is what ended the list, which is always,
                  because no source can yet report reaching the file's start.
                - `session-start` — "the session begins here". NOT DRAWN, and
                  deliberately not stubbed: nothing vam reads can currently
                  prove it, and a boundary that guessed would be the same lie
                  in the other direction.

              AND NO CONTROL, because there is nothing behind one. Backward
              paging is being added to the source in parallel; until it lands,
              a "load more" button would be a control that cannot act and a
              spinner would be a fetch that does not exist — both worse than
              the sentence. THE SEAM: when the source can page, this block
              gains the `session-start` state and a real button beside it, and
              nothing else in the column has to change — the column already
              renders whatever `orderedTurns` holds, oldest first.
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
              data-column-start="read-limit"
              /* 11.5px, NOT the 10.5px of the turn lines this block's facts
                 came off. The operator has twice asked for small type to come
                 up a pixel, and a repo-wide bump is its own task (198 literals,
                 18 files, no type scale to change in one place) -- so a NEW
                 call site takes the size it would have AFTER that bump rather
                 than adding one more literal below the floor. The turn lines
                 and the bar below keep 10.5 because they are the existing
                 progress line, moved, not new type. */
              className={`-mx-3.5 flex flex-none flex-col gap-0.5 px-3.5 pt-3 pb-1 font-mono text-[11.5px] text-ink-faint ${
                cornerOverlay ? 'pr-[6rem]' : ''
              }`}
            >
              <div className="flex items-center gap-1.5">
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
              </div>
              <p data-column-start-note className="text-ink-faint leading-[1.5]">
                This is as far back as vam has read — not necessarily where the session began.
              </p>
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
                      setSelectedId(canvasDecisionId);
                      if (canvasDecisionId !== null) scrollToTurnRef.current = canvasDecisionId;
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
                reserveCorner={cornerOverlay}
              />
            ))}

            {/* THE COLUMN'S OWN BAR, pinned to its bottom.
                It is what is left of the single condensed progress line once
                the per-turn facts moved onto the turns and the window's facts
                moved to the boundary above: navigation, and nothing else.

                STICKY AT THE BOTTOM, not at the top, and not in the flow. The
                jumps and the picker are what an operator reaches for while
                scrolled far up -- having to scroll back down to find the
                control that scrolls you back down is a circle -- and the top
                is already spoken for by the pinned prompt, which is the whole
                feature. In flow at the end of the column, so at maximum scroll
                it sits BELOW the newest answer rather than over it. */}
            <div
              data-column-bar
              className="-mx-3.5 sticky bottom-0 z-20 flex flex-none flex-col gap-1 bg-ground px-3.5 pt-1 pb-3"
            >
              {/* At volume this costs one node per turn, the same as the
                  `<select>`'s options. The difference is that these are only
                  here while the operator asked for them.

                  CAPPED AGAINST THE COLUMN, not at a fixed 132px, which is what
                  it was while it sat inline in the flow and could only ever
                  push the turn down. It floats over the column now, so at a
                  short pane 132px WAS the column: measured at a 460px viewport,
                  the open list covered the pinned prompt entirely and the top
                  of the transcript painted a list row. `cqh` resolves against
                  the column (its `container-type: size`), so the list takes a
                  share of the height rather than a number of pixels the pane
                  may not have. */}
              {progressOpen && (
                <ul
                  data-progress-turns
                  className="vam-no-scrollbar max-h-[40cqh] min-h-0 overflow-y-auto"
                >
                  {orderedTurns.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        data-progress-turn
                        aria-current={d.id === markedId ? 'true' : undefined}
                        onClick={() => pickTurn(d.id)}
                        className={[
                          'flex w-full cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] px-1 py-0.5 text-left font-mono text-[10.5px] hover:bg-raised hover:text-ink',
                          d.id === markedId ? 'bg-raised text-ink' : 'text-ink-faint',
                        ].join(' ')}
                      >
                        {/* Answered, still open, or carrying a failure -- the
                            same marks the turn's own line draws, from the same
                            function. Decorative, so hidden: the label is what
                            a screen reader should read. */}
                        <span
                          aria-hidden="true"
                          className={(d.errorCount ?? 0) > 0 ? 'text-failed' : undefined}
                        >
                          {turnMark(d)}
                        </span>
                        <span className="min-w-0 truncate">{d.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-ink-faint">
                {orderedTurns.length > 1 && (
                  <button
                    type="button"
                    data-progress-expand
                    aria-expanded={progressOpen}
                    aria-label={progressOpen ? 'collapse the turn list' : 'expand the turn list'}
                    onClick={() => setProgressOpen((open) => !open)}
                    className="flex cursor-pointer items-center rounded-[var(--radius-sm)] px-0.5 py-0.5 hover:bg-raised hover:text-ink"
                  >
                    {progressOpen ? (
                      <ChevronDown size={12} strokeWidth={1.8} />
                    ) : (
                      <ChevronRight size={12} strokeWidth={1.8} />
                    )}
                  </button>
                )}
                {/* ONE PICKER AT A TIME. The `<select>` is the condensed form
                    and the list above is the open one; they drive the same
                    `pickTurn` off the same turns, and drawing both would be
                    two controls for one job -- which is how they come to
                    disagree.
                    `value` is the MARKED turn, and `''` when the pick has
                    fallen out of the window: a `<select>` handed a value no
                    option carries paints its first option instead, which would
                    put a turn's label on screen as the one being read while
                    the boundary above says that turn cannot be found. */}
                {!progressOpen && orderedTurns.length > 1 && (
                  <select
                    data-progress-jump
                    aria-label="jump to a turn"
                    value={markedId ?? ''}
                    onChange={(event) => pickTurn(event.target.value)}
                    className="max-w-[130px] cursor-pointer truncate rounded-[var(--radius-sm)] border border-line-strong bg-panel px-1 py-0.5 font-mono text-[10.5px] text-ink-faint outline-none hover:text-ink"
                  >
                    {/* Drawn only while the pick is missing, and never
                        selectable back into: it exists so the control can
                        represent the state the boundary above describes
                        instead of silently pointing at somebody else's turn. */}
                    {markedId === null && (
                      <option value="" disabled>
                        — turn not in view —
                      </option>
                    )}
                    {orderedTurns.map((d) => (
                      <option key={d.id} value={d.id}>
                        {turnMark(d)} {d.label}
                      </option>
                    ))}
                  </select>
                )}
                <span className="flex-1" />
                {/* The scroll-to-edge buttons. Each is drawn only while it
                    would actually move the column -- a control that scrolls
                    nowhere is worse than no control. "Top" now means the
                    oldest turn vam read, which is what the boundary block up
                    there says it is. */}
                {jumps.above && (
                  <button
                    type="button"
                    data-out-to-top
                    aria-label="scroll to the oldest turn read"
                    onClick={() => jumpTo('top')}
                    className="flex cursor-pointer items-center rounded-[var(--radius-sm)] px-0.5 py-0.5 hover:bg-raised hover:text-ink"
                  >
                    <ChevronsUp size={12} strokeWidth={1.8} />
                  </button>
                )}
                {jumps.below && (
                  <button
                    type="button"
                    data-out-to-bottom
                    aria-label="scroll to the newest turn"
                    onClick={() => jumpTo('bottom')}
                    className="flex cursor-pointer items-center rounded-[var(--radius-sm)] px-0.5 py-0.5 hover:bg-raised hover:text-ink"
                  >
                    <ChevronsDown size={12} strokeWidth={1.8} />
                  </button>
                )}
              </div>
            </div>
          </div>
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
      {current !== 'Terminal' && newestQuestion !== null && (
        <div
          data-question-bar
          className="flex flex-none flex-col gap-2.5 border-line border-t bg-header px-3.5 py-3"
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
        drawn first. */}
      {current !== 'Terminal' && !composerHidden && (
        <div
          data-composer-bar
          className={[
            'flex flex-none flex-col gap-2.5 bg-header px-3.5 py-3',
            newestQuestion === null ? 'border-line border-t' : '',
          ].join(' ')}
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
                    className="flex h-[30px] min-w-[30px] shrink-0 items-center justify-center whitespace-nowrap rounded-[8px] border border-line-strong bg-panel px-1.5 font-mono text-[12px] text-ink-quiet active:bg-raised"
                  >
                    {item.caption}
                  </span>
                </button>
              ))}
            </nav>
          )}
          {suggesting && (
            <div
              data-bang-suggest
              className="flex flex-col gap-0.5 rounded-[10px] border border-line-strong bg-panel px-1.5 py-1.5"
            >
              <p className="px-1.5 pb-0.5 text-[11px] text-ink-faint">
                the agent proposed these — vam does not run them; Enter picks one, Esc keeps what
                you typed
              </p>
              {matches.map((command, index) => (
                <button
                  key={command.id}
                  type="button"
                  data-bang-suggestion
                  data-selected={index === picked ? 'true' : undefined}
                  onClick={() => acceptSuggestion(command)}
                  className={[
                    'flex cursor-pointer flex-col items-start gap-0.5 rounded-[6px] px-1.5 py-1 text-left',
                    index === picked ? 'bg-raised' : 'hover:bg-raised',
                  ].join(' ')}
                >
                  <span className="max-w-full truncate text-[12px] text-ink">{command.label}</span>
                  <span
                    data-bang-command
                    className="max-w-full truncate font-mono text-[11.5px] text-ink-dim"
                  >
                    {command.command}
                  </span>
                </button>
              ))}
            </div>
          )}
          {slashSuggesting && (
            <div
              data-slash-suggest
              className="flex flex-col gap-0.5 rounded-[10px] border border-line-strong bg-panel px-1.5 py-1.5"
            >
              <p className="px-1.5 pb-0.5 text-[11px] text-ink-faint">
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
                    index === slashPicked ? 'bg-raised' : 'hover:bg-raised',
                  ].join(' ')}
                >
                  <span
                    data-slash-command
                    className="max-w-full truncate font-mono text-[12px] text-ink"
                  >
                    /{command.name}
                  </span>
                  {command.description !== null && (
                    <span className="max-w-full truncate text-[11.5px] text-ink-dim">
                      {command.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          <div
            data-prompt-box
            data-action-id="prompt"
            className={[
              'flex flex-col gap-2.5 rounded-[10px] border bg-panel px-3 py-2.5',
              active && actionIndex === 0 ? 'border-waiting' : 'border-line-loud',
            ].join(' ')}
          >
            {/* Multiline, because a prompt is prose and a one-line slot hides
            everything but the tail of it. The mockup's own composer is a
            104px-tall block of 12.5px/1.55 text, not an input. */}
            <div className="flex items-start gap-2">
              <textarea
                ref={inputRef}
                rows={2}
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
                  // box binds the ones it needs itself. Shift+Enter is left alone
                  // — it is the newline the box became multiline to allow.
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
                  } else if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    onSubmit();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    // BLUR, not just `composing = false`. Clearing the flag only
                    // makes this box read-only; while it still holds DOM focus
                    // the window key listener returns early on every keystroke
                    // (it ignores keys aimed at an INPUT or a TEXTAREA), so
                    // `j`/`k` land here and vanish and the sidebar is
                    // unreachable without a mouse. Releasing focus is what hands
                    // the keyboard back.
                    inputRef.current?.blur();
                    onStopComposing();
                  }
                }}
                // The ghost, in the placeholder's own faint ink: unmistakably
                // not a draft yet, and naming the key that would make it one.
                data-prompt-suggestion={promptSuggestion ?? undefined}
                placeholder={
                  entry === null
                    ? 'Pick a session first'
                    : promptSuggestion !== null
                      ? `${promptSuggestion} — Tab to use`
                      : 'Reply to agent, answer with a number, or paste a plan…'
                }
                className="vam-no-scrollbar max-h-[120px] min-w-0 flex-1 resize-none bg-transparent text-[13.5px] text-ink leading-[1.55] outline-none placeholder:text-ink-faint"
                aria-label="prompt to session"
              />
            </div>

            {images.length > 0 && (
              <p data-pasted-images className="text-[11.5px] text-ink-dim leading-[1.45]">
                {images.length === 1 ? '1 image' : `${images.length} images`} pasted and kept here —
                vam writes text to a session, so only the {'`[image #N]`'} placeholder is sent, not
                the image.
              </p>
            )}

            {attachError !== null && (
              <p data-attach-error className="text-[11.5px] text-waiting leading-[1.45]">
                {attachError}
              </p>
            )}

            {/* The tools row: attach, provider, model, mode — everything the
              prompt carries besides its text, on one line under the box. The
              hook is what lets a test say "beside the model field" without a
              layout engine. */}
            <div data-prompt-tools className="flex items-center gap-2">
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
              <Note text="reads the file here and puts its text into the prompt text that gets recorded — vam uploads nothing">
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
                    className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-line-strong bg-panel hover:bg-raised"
                  >
                    <Paperclip size={12} strokeWidth={1.7} />
                  </span>
                </button>
              </Note>
              {attachedName !== null && (
                <span
                  data-attach-chip
                  className="flex h-6 min-w-0 items-center gap-1 rounded-[6px] border border-line-strong bg-raised px-1.5 font-mono text-[11px] text-ink-dim"
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
              {pickImageAttachment !== undefined && entry !== null && (
                <Note text="opens a file picker, checks the file is really an image inside this session's own directory, and puts its path on its own line in the prompt text — vam uploads nothing">
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
                      className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-line-strong bg-panel hover:bg-raised"
                    >
                      <ImageIcon size={12} strokeWidth={1.7} />
                    </span>
                  </button>
                </Note>
              )}
              {attachedImage !== null && (
                <span
                  data-attach-image-chip
                  className="flex h-6 min-w-0 items-center gap-1 rounded-[6px] border border-line-strong bg-raised px-1.5 font-mono text-[11px] text-ink-dim"
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
              `pickImageAttachment` follows two blocks up. */}
              {onSetDefaultProvider !== undefined && (
                <div className="relative flex-none">
                  <Note text="which agent a NEW session starts with — vam's own Settings, reachable here; it does not change this session, which is already running">
                    <button
                      type="button"
                      data-provider-picker-toggle
                      aria-haspopup="listbox"
                      aria-expanded={providerPickerOpen}
                      aria-label={`default provider for new sessions: ${currentProvider.label} — change`}
                      onClick={() => setProviderPickerOpen((open) => !open)}
                      className="vam-tap flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-ink-dim hover:text-ink"
                    >
                      <span
                        aria-hidden="true"
                        data-tap-skin
                        className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-line-strong bg-panel hover:bg-raised"
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
                  {providerPickerOpen && (
                    <div
                      data-provider-picker
                      role="listbox"
                      aria-label="default provider for new sessions"
                      className="absolute bottom-full left-0 z-10 mb-1 flex flex-col gap-0.5 rounded-[10px] border border-line-strong bg-panel p-1 shadow-sm"
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
                              setProviderPickerOpen(false);
                            }}
                            className={[
                              'flex cursor-pointer items-center whitespace-nowrap rounded-[6px] px-2 py-1 text-left text-[12px]',
                              selected
                                ? 'bg-raised text-ink'
                                : 'text-ink-dim hover:bg-raised hover:text-ink',
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
              {/* The model field. Not a menu of names vam made up — vam has no
              model API and the factory does the choosing — but not an inert
              chip either: what is typed here becomes the prompt's first
              line, in the recorded text a person reads. */}
              <Note text="vam cannot switch models — the factory chooses; this writes your request into the prompt text that gets recorded">
                <input
                  data-model-request
                  value={readModelRequest(draft)}
                  onChange={(event) => onDraftChange(setModelRequest(draft, event.target.value))}
                  placeholder="model"
                  aria-label="model requested in this prompt"
                  className="vam-tap h-6 w-[84px] min-w-0 shrink rounded-[6px] border border-line-strong bg-transparent px-1.5 font-mono text-[11px] text-ink-dim outline-none placeholder:text-ink-quiet focus:text-ink"
                />
              </Note>
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

              The draft stays the single source of truth: read back out of it
              on every render, never mirrored in state, because a mirror is a
              thing that can disagree with the text actually recorded. */}
              {canCycleMode && (
                <div className="relative flex-none">
                  <Note text="the mode belongs to the session — this writes your choice into the prompt text that gets recorded, and Shift+Tab presses the session's own chord in the pane vam started">
                    <button
                      type="button"
                      data-mode-toggle
                      aria-haspopup="listbox"
                      aria-expanded={modePickerOpen}
                      aria-label={`mode: ${currentMode} — change, or ⇧Tab to cycle the session's own`}
                      onClick={() => setModePickerOpen((open) => !open)}
                      className="vam-tap flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-ink-dim hover:text-ink"
                    >
                      <span
                        aria-hidden="true"
                        data-tap-skin
                        className="flex h-6 w-6 items-center justify-center rounded-[6px] border border-line-strong bg-panel hover:bg-raised"
                      >
                        <ModeGlyph size={12} strokeWidth={1.7} />
                      </span>
                    </button>
                  </Note>
                  {modePickerOpen && (
                    <div
                      data-mode-picker
                      role="listbox"
                      aria-label="mode for this prompt"
                      className="absolute bottom-full left-0 z-10 mb-1 flex flex-col gap-0.5 rounded-[10px] border border-line-strong bg-panel p-1 shadow-sm"
                    >
                      {MODES.map((mode) => {
                        const selected = mode === currentMode;
                        const Glyph = MODE_ICON[mode];
                        return (
                          <button
                            key={mode}
                            type="button"
                            data-mode-option={mode.toLowerCase()}
                            role="option"
                            aria-selected={selected}
                            onClick={() => {
                              onDraftChange(setModeRequest(draft, mode));
                              setModePickerOpen(false);
                            }}
                            className={[
                              'flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 py-1 text-left text-[12px]',
                              selected
                                ? 'bg-raised text-ink'
                                : 'text-ink-dim hover:bg-raised hover:text-ink',
                            ].join(' ')}
                          >
                            <Glyph size={12} strokeWidth={1.7} />
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
                  className={[
                    'min-w-0 flex-1 truncate whitespace-nowrap font-mono text-[10.5px]',
                    cycleNote.kind === 'refused' ? 'text-waiting' : 'text-ink-dim',
                  ].join(' ')}
                >
                  {cycleNote.text}
                </span>
              )}
              {/* The way OUT, shown only while you are in — the moment it is the
              thing you need, and no width the rest of the time. It replaces
              the `i` / `I` notes the operator asked to lose: those advertised
              the way in, which you have already found by the time you can
              read them. */}
              {composing && (
                <span
                  data-prompt-escape
                  className="flex-none whitespace-nowrap font-mono text-[10.5px] text-ink-faint"
                >
                  Esc → sidebar
                </span>
              )}
              <span className="min-w-0 flex-1" />
              {/* The mockup draws a send arrow here. This one says RECORD, in
              the label and in the tooltip, because the factory has no channel
              into a running agent session — the click appends the prompt to
              the session's log and nothing reads it back out. A button that
              implied delivery would leave you waiting for an answer nobody is
              coming to give. */}
              <button
                type="button"
                data-prompt-record
                onClick={onSubmit}
                disabled={sending}
                aria-busy={sending}
                aria-label={composerClaim.label}
                title={composerClaim.title}
                className={[
                  'flex h-7 w-7 flex-none items-center justify-center rounded-[7px] bg-line-strong text-ink',
                  sending ? 'cursor-progress opacity-60' : 'cursor-pointer hover:bg-line-loud',
                ].join(' ')}
              >
                <ArrowUp size={14} strokeWidth={1.7} className={sending ? 'vam-breathe' : ''} />
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
