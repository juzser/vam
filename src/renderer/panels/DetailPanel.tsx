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
 * source a prompt is delivered and answered; black-smith still only appends to
 * a log. `delivers` carries the difference, and with nothing said the wording
 * stays at "record".
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
 * that reports the thing it draws, and black-smith still reports none of the
 * three. So the tabs are real and their emptiness is source-specific, rather
 * than the tabs being labels.
 */

import {
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  CircleSlash,
  GitCommitVertical,
  Paperclip,
  User,
  X,
} from 'lucide-react';
import {
  isValidElement,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AnswerRequest, AnswerResult } from '../../shared/answer.js';
import type { PaneSendResult } from '../../shared/terminal.js';
import type {
  AgentQuestion,
  Command,
  Decision,
  PullRequest,
  PullRequestList,
  SessionAgent,
  SessionStatus,
} from '../domain/model.js';
import type { SessionEntry } from '../domain/selectors.js';
import { type ComposerImage, readPastedImages, spliceDraft } from './composer-paste.js';
import { FocusEdge } from './FocusEdge.js';
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
export function attachIntoDraft(draft: string, file: AttachedFile): AttachResult {
  const already = readAttachedName(draft);
  if (already !== null) {
    return { ok: false, message: `one file at a time — take ${already} off first` };
  }
  if (file.size > ATTACH_LIMIT_BYTES) {
    return {
      ok: false,
      message: `${file.name} is larger than 64 KB — vam inlines the file's own text, so it refuses rather than sending half of it`,
    };
  }
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
 * vam has no model API and must not invent one: black-smith picks the model,
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
 * Exactly the reasoning behind `setModelRequest`: black-smith has no
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
 * The header dot, per status.
 *
 * This was `needsYou ? waiting : running`, which is two values for four
 * states plus an empty one: a `done` session, a `failed` session and NO
 * SESSION AT ALL were all painted as running, the last of those putting a
 * live-looking dot beside the words "No session selected". The sidebar has
 * carried a four-way map since it was written; this is the same map, and the
 * same tokens, so the two panes cannot disagree about what a status looks
 * like.
 *
 * `null` -- no session -- gets `bg-line-strong`: present, so the header's
 * layout does not shift, and colourless, because there is no status to
 * report.
 */
const PANE_STATUS_DOT: Readonly<Record<SessionStatus, string>> = {
  waiting: 'bg-waiting',
  running: 'bg-running',
  done: 'bg-done',
  failed: 'bg-failed',
};

/**
 * Which statuses breathe: the ones still in motion. `waiting` is asking for
 * something and `running` is working; `done` and `failed` have stopped, and a
 * pulse on a stopped session reads as activity that is not there.
 */
const PANE_STATUS_BREATHES: Readonly<Record<SessionStatus, boolean>> = {
  waiting: true,
  running: true,
  done: false,
  failed: false,
};

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

export type DetailPanelProps = {
  readonly entry: SessionEntry | null;
  /** The step the canvas has focused — the newest one unless `h`/`l` moved. */
  readonly decision: Decision | null;
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
   * The tab a previous run left showing, as an OPAQUE STRING, and the way to
   * report a change back.
   *
   * A string rather than a `Tab` because the store it comes from must not know
   * what the tabs are called: `TABS` lives here, beside the bar that draws it,
   * and a `prefs.ts` that imported it would pull this whole component into a
   * module whose job is `localStorage`. So the dependency runs the other way --
   * the store keeps whatever it was handed, and the validating happens HERE,
   * where the list is. Anything that is not a current tab name is the default,
   * which makes renaming or withdrawing a tab cost one default tab rather than
   * a migration.
   *
   * Both optional, and the pane works with neither: without them the tab is
   * component state that starts at the default, exactly as it was.
   */
  readonly initialTab?: string | null;
  readonly onTabChange?: (tab: string) => void;
  /** The current rendered width (task-1's `renderedWidth`), applied inline. */
  readonly width: number;
  /** `PaneResizer`, positioned by the caller — kept out of this file's own concerns. */
  readonly resizeHandle: ReactNode;
};

/**
 * The tab bar's four entries. All four now select something.
 *
 * `Agents` joined `Response` when a source that actually reports a roster
 * arrived (`Session.agents`), `PRs` joined them when one learned to ask `gh`,
 * and `Terminal` was the last placeholder: it had no data source because vam
 * held no PTY, and the tmux provider is that source. Nothing in `TABS` is a
 * label any more, so the `data-placeholder` branch that drew the inert ones is
 * gone with it.
 */
/** The tab bar, in order. Exported because `Mod-<digit>` counts POSITIONS in
 *  it and the count has to come from the bar itself: a handler with its own
 *  idea of how many tabs there are is a fifth digit that opens nothing. */
export const TABS = ['Response', 'PRs', 'Terminal', 'Agents'] as const;

/** Exported for the chord table alone, which names the tab its digit opens.
 *  A type-only import there, so nothing of this file reaches the grammar. */
export type Tab = (typeof TABS)[number];

/**
 * The mockup's mode segments, and which one it draws as current. Presentation
 * only: black-smith exposes no per-session mode, so these are drawn and
 * labelled as placeholders in the same way the tab bar's three empty tabs are.
 */
const MODES = ['Auto', 'Manual', 'Plan'] as const;

/**
 * The mockup's segmented control: one filled pill on a sunken well, not
 * underlined labels.
 *
 * The Agents badge has a real source (`runningAgents`) and is omitted at
 * zero. PRs still ships with NO badge, even now that it has data: a count
 * there would have to read as zero both for a branch with no pull request and
 * for a session vam could not ask about, which is the one conflation this
 * pane exists to avoid.
 *
 * EVERY PILL IS A REAL <button> NOW — Tab reaches it, Enter and Space activate
 * it, `role="tab"` and `aria-selected` say which one is showing. The three
 * that were plain labels became buttons as each got something behind it; the
 * rule that made them labels stands unchanged for any future one, because a
 * focus stop that activates nothing and explains nothing is a keyboard trap
 * with a hover state.
 */
function TabBar({
  tabs,
  runningAgents,
  current,
  onSelect,
}: {
  /** The tabs this source offers -- `TABS` minus the ones it has said it lacks. */
  readonly tabs: readonly Tab[];
  readonly runningAgents: number;
  readonly current: Tab;
  readonly onSelect: (tab: Tab) => void;
}) {
  return (
    <div
      role="tablist"
      className="mb-[11px] flex items-center gap-[3px] rounded-[9px] border border-line-loud bg-well p-[3px]"
    >
      {tabs.map((tab) => {
        const selected = tab === current;
        const badge = tab === 'Agents' && runningAgents > 0 ? runningAgents : null;
        const shape = [
          'flex h-[26px] flex-1 items-center justify-center gap-[5px] rounded-[7px] text-[12px]',
          selected ? 'bg-line-strong font-medium text-ink' : 'text-ink-dim',
        ].join(' ');
        const label = (
          <>
            {tab}
            {badge !== null && (
              <span
                className={[
                  'font-mono text-[9.5px]',
                  selected ? 'text-ink-dim' : 'text-ink-faint',
                ].join(' ')}
              >
                {badge}
              </span>
            )}
          </>
        );
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            data-tab={tab.toLowerCase()}
            aria-selected={selected}
            onClick={() => onSelect(tab)}
            className={`${shape} cursor-pointer ${selected ? '' : 'hover:bg-raised hover:text-ink'}`}
          >
            {label}
          </button>
        );
      })}
    </div>
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
      <p data-prs data-prs-absent className="text-[11px] text-ink-faint">
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
        className="text-[11px] text-ink-faint"
      >
        {/* vam could not ask. Not "there are none". */}
        {pullRequests.message}
      </p>
    );
  }
  if (pullRequests.prs.length === 0) {
    return (
      <p data-prs data-prs-empty className="text-[11px] text-ink-faint">
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
            <span data-pr-title className="block truncate text-[11.5px] text-ink">
              {pr.title}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px]">
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
 * (model.ts). Absent is a source with no agent surface at all — black-smith
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
      <p data-agents data-agents-empty className="text-[11px] text-ink-faint">
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
        className="flex-none cursor-pointer self-start rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10.5px] text-ink-faint hover:bg-raised hover:text-ink"
      >
        {showIdle ? `hide ${idleCount} idle` : `show ${idleCount} idle`}
      </button>
    );
  return (
    <div data-agents className="flex min-h-0 flex-1 flex-col gap-1.5">
      {shown.length === 0 ? (
        <p data-agents-empty className="text-[11px] text-ink-faint">
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
                <span data-agent-type className="block truncate text-[11.5px] text-ink">
                  {/* No type means no readable meta file beside the transcript, so
                  the id is the only name this agent has. */}
                  {agent.type ?? `${agent.id} (type unknown)`}
                </span>
                <span
                  data-agent-description
                  className="mt-0.5 block truncate text-[10.5px] text-ink-faint"
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

/** A section rule: `IN ────────── you · 12m`. The mockup's own divider. */
/**
 * A section rule: an icon, a hairline, and the section's own metadata.
 *
 * The icon replaced the words IN / OUT / PROGRESS. The mockup has no such
 * block at all — input and output are vam's own construct, because a
 * black-smith decision has both and the ADE design never modelled one — so
 * this follows the mockup's IDIOM rather than copying a specific glyph: it
 * labels small repeated things with an icon, not a word, and reserves letter-
 * spaced capitals for state (NEEDS YOU, RUNNING, DONE).
 *
 * The three glyphs are a head-and-shoulders, a commit line and a bot, measured
 * off the Response artboards in #53 — which replaced the opposing arrows vam
 * started with, so the paragraph here that still described arrows was wrong
 * and is gone. `aria-label` carries the word that was removed, and
 * `role="img"` is what makes that label announced at all — a bare <span> has
 * no implicit role and would drop it silently, which this codebase has already
 * shipped once.
 *
 * `tone` colours the ICON only, and only the icon. Three faint-grey headings
 * were indistinguishable at a glance, which is what the operator reported; the
 * label stays `text-ink-faint` because letter-spaced capitals are this
 * design's idiom for STATE (NEEDS YOU, RUNNING, DONE) and three coloured ones
 * would make a region heading read as a session status. The hairline and the
 * meta stay grey too: the hairline is the structure all three share and
 * colouring it would triple the pane's colour weight while adding no
 * distinction, and the meta carries VALUES (`you`, `12 turns`, the activity),
 * which are data, not a label. Colour is added to the glyph and the announced
 * label, never substituted for either — a colour-only distinction is no
 * distinction to a colour-blind operator.
 */
function Rule({
  label,
  meta,
  icon,
  iconLabel,
  tone,
}: {
  readonly label: string;
  /** Usually a value; `progress` puts its expand control here instead. */
  readonly meta: ReactNode;
  readonly icon: ReactNode;
  /**
   * What a screen reader says for the glyph — `you`, not `in`. It is a
   * separate prop, and required, so that adding a section cannot ship a
   * silent icon: `progress` had exactly that gap, drawing its glyph outside
   * any `role="img"` and announcing nothing.
   */
  readonly iconLabel: string;
  /** The section's own colour token, worn by the icon and nothing else. */
  readonly tone: string;
}) {
  return (
    <div className="flex items-center gap-[7px]">
      <span className="flex flex-none items-center gap-[5px] text-ink-faint">
        <span role="img" aria-label={iconLabel} className={`flex ${tone}`}>
          {icon}
        </span>
        <span className="font-mono text-[9.5px] tracking-[0.12em] uppercase">{label}</span>
      </span>
      <span className="h-px flex-1 bg-line" />
      <span data-rule-meta className="font-mono text-[9.5px] text-ink-faint">
        {meta}
      </span>
    </div>
  );
}

/**
 * How tall two lines of `in` are, in pixels.
 *
 * The operator asked for two lines of `in`, with the height it gives up going
 * to `out`. A percentage of the pane would be a promise about the window
 * instead of a promise about the text, so this is derived from the type it
 * caps: two lines of the 12px/1.55 body, plus the box's own 10px padding top
 * and bottom and its 1px border.
 */
const IN_BODY_PX = 12;
const IN_LEADING = 1.55;
const IN_LINES = 2;
const IN_MAX_HEIGHT = Math.round(IN_BODY_PX * IN_LEADING * IN_LINES) + 22;

/**
 * How many turns `progress` shows once opened — the five most recent.
 *
 * Collapsed it shows NONE: it is context, and the operator asked for the whole
 * region to cost only its own header until it is asked for. Five is what opens
 * behind the toggle, and the list scrolls past that rather than growing.
 */
const PROGRESS_LINES = 5;

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
      <pre className="vam-no-scrollbar overflow-x-auto rounded-[7px] border border-line bg-canvas px-2.5 py-2 font-mono text-[0.917em] text-ink-dim leading-[1.55] [&_code]:bg-transparent [&_code]:px-0 [&_code]:text-ink-dim">
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

function QuestionCard({
  questions,
  firstOptionRef,
  onChat,
  onAnswer,
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
}) {
  /** Which step is showing, and what has been marked on EACH of them. */
  const [showing, setShowing] = useState(0);
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
  const picked = question === undefined ? [] : (marks[question.id] ?? []);
  /** What is left to send: every open step the picker has not already taken. */
  const pending = openSteps.slice(taken.length);
  /** The pending steps still waiting for a mark -- what Submit is short of. */
  const unmarked = pending.filter((one) => (marks[one.id] ?? []).length === 0);
  const takenIds = new Set(openSteps.slice(0, taken.length).map((one) => one.id));

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
  const [landing, setLanding] = useState<number | null>(null);
  const stepTabRef = useRef<HTMLButtonElement>(null);
  const walk = (by: number) => {
    const next = Math.min(Math.max(showing + by, 0), questions.length - 1);
    if (next === showing) return;
    setShowing(next);
    setLanding(next);
  };

  /**
   * The cursor lands on the new step's first option -- or on its tab, for a
   * step already answered, which has no options list to land in. Only after a
   * WALK: arriving at the card is `active`'s business one screen down, and
   * stealing focus on every render would take it off whatever the operator
   * clicked.
   */
  useEffect(() => {
    if (landing === null) return;
    setLanding(null);
    (firstOptionRef.current ?? stepTabRef.current)?.focus();
  }, [landing, firstOptionRef]);

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

  const toggle = (label: string) =>
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
    if (event.key === 'c') {
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
    if (
      event.key === 'h' ||
      event.key === 'l' ||
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight'
    ) {
      event.preventDefault();
      walk(event.key === 'l' || event.key === 'ArrowRight' ? 1 : -1);
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
    const down = event.key === 'ArrowDown' || event.key === 'j';
    const up = event.key === 'ArrowUp' || event.key === 'k';
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
      className="flex flex-col gap-1.5 rounded-[10px] border border-line-strong bg-panel px-2.5 py-2"
    >
      {/* The strip, and ONLY when there is more than one question: a step
          counter over a single question is furniture that says nothing. It
          names each step by its own header where the tool gave one, marks the
          ones already settled and the ones already marked, and says where in
          the sequence the operator is -- because a card that shows one
          question at a time and does not say so is the hole this replaces
          wearing a different shape. */}
      {questions.length > 1 && (
        <div
          // A TABLIST, which is what it is: one question of the call showing at
          // a time, walked with the horizontal keys. The role is also what
          // makes the handler legitimate on this element rather than a
          // keystroke bolted to a plain box.
          role="tablist"
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
              role="tab"
              aria-selected={index === showing}
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
                'cursor-pointer rounded-[5px] border px-1.5 py-0.5 text-[10px]',
                index === showing ? 'border-running text-ink' : 'border-line text-ink-faint',
              ].join(' ')}
            >
              {one.header ?? `${index + 1}`}
              {one.answer !== null || (marks[one.id] ?? []).length > 0 ? ' ✓' : ''}
            </button>
          ))}
          <span data-question-position className="ml-auto text-[10px] text-ink-faint">
            step {showing + 1} of {questions.length}
          </span>
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        {question.header !== null && (
          <span data-question-header className="text-[10px] text-ink-faint uppercase tracking-wide">
            {question.header}
          </span>
        )}
        <span data-question-text className="text-[11.5px] text-ink">
          {question.question}
        </span>
      </div>
      {question.answer !== null ? (
        // THIS step is settled while others may not be. It shows what was
        // answered and offers nothing to mark; the set's Submit below is for
        // whatever is still open.
        <span data-question-answer className="text-[10.5px] text-ink-dim">
          resolved — {question.answer}
        </span>
      ) : (
        <>
          {/* A listbox, not a form control: nothing here is submitted, and
              `aria-multiselectable` is the one honest way to say that several
              may be marked. */}
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
                onClick={() => toggle(option.label)}
                className={[
                  'flex cursor-pointer flex-col items-start gap-0.5 rounded-[6px] border px-1.5 py-1 text-left',
                  picked.includes(option.label)
                    ? 'border-running bg-raised'
                    : 'border-line hover:bg-raised',
                ].join(' ')}
              >
                <span className="flex max-w-full items-baseline gap-1.5 text-[11px] text-ink">
                  {NUMBERED_OPTIONS[index] !== undefined && (
                    <span className="text-[10px] text-ink-faint tabular-nums">
                      {NUMBERED_OPTIONS[index]}
                    </span>
                  )}
                  <span className="min-w-0">{option.label}</span>
                </span>
                {option.description !== null && (
                  <span data-question-description className="max-w-full text-[10.5px] text-ink-dim">
                    {option.description}
                  </span>
                )}
              </button>
            ))}
          </div>
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
            className="flex cursor-pointer items-baseline gap-1.5 rounded-[6px] border border-line border-dashed px-1.5 py-1 text-left hover:bg-raised"
          >
            <span className="text-[10px] text-ink-faint tabular-nums">c</span>
            <span className="min-w-0 text-[11px] text-ink">Chat about this</span>
            <span className="min-w-0 text-[10.5px] text-ink-faint">
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
              'rounded-[6px] border px-1.5 py-1 text-[11px]',
              unmarked.length > 0 || sending
                ? 'cursor-default border-line text-ink-faint'
                : 'cursor-pointer border-running text-ink hover:bg-raised',
            ].join(' ')}
          >
            {sending ? 'Submitting…' : 'Submit'}
          </button>
          {questions.length > 1 && (
            <span data-question-progress className="text-[10px] text-ink-faint">
              {pending.length - unmarked.length} of {pending.length} marked
            </span>
          )}
        </div>
      )}
      {outcome !== null && (
        <p data-question-outcome data-outcome={outcome.kind} className="text-[10px] text-ink-dim">
          {outcomeWording(outcome)}
        </p>
      )}
      {open && (
        <p data-question-note className="text-[10px] text-ink-faint">
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

export function DetailPanel(props: DetailPanelProps) {
  const {
    entry,
    decision,
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
    terminal,
    sending = false,
    width,
    resizeHandle,
  } = props;

  const inputRef = useRef<HTMLTextAreaElement>(null);
  /**
   * Why the last Shift-Tab did not reach the pane, or `null` when it did.
   *
   * Component state because it is about ONE keypress in this pane and nothing
   * outside has an opinion about it -- the same reason the tab and the
   * progress region are held here.
   */
  const [cycleRefusal, setCycleRefusal] = useState<string | null>(null);
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
   * Press the session's own Shift-Tab, OVER THE ONE CHANNEL THAT ALREADY
   * TYPES INTO A PANE: `terminal.send` resolves the pane in main and refuses
   * every answer but a single session it can prove is this row's, so a second
   * path would be a second chance to get that wrong -- into somebody's
   * running agent. `window.api` exists only in the Electron shell, and its
   * absence is reported rather than made into a no-op.
   */
  const cycleMode = async () => {
    const send = globalThis.window?.api?.terminal?.send;
    if (entry === null) return;
    if (send === undefined) {
      setCycleRefusal('not sent — this build has no keyboard into a session’s pane');
      return;
    }
    const landed = await send(entry.project.id, { kind: 'back-tab' }, entry.session.id).catch(
      (): PaneSendResult => 'refused',
    );
    setCycleRefusal(cycleWording(landed));
  };
  /** The first option of the open question, when one is being asked. */
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  /**
   * `progress` is context, not the thing you read, so it opens showing no turn
   * at all — the newest five are one keystroke away.
   * Component state rather than a prop: nothing outside this pane has an
   * opinion about it, and routing it through the canvas would put a
   * presentation toggle in the model every other pane has to carry.
   */
  const [progressOpen, setProgressOpen] = useState(false);
  /**
   * Which tab the pane is showing. Still component state, and still nobody
   * else's opinion: it survives switching sessions on purpose -- an operator
   * who opened Agents is looking at agents, not at whichever tab the last
   * session left behind -- and it now survives a QUIT for the same reason,
   * seeded from what the caller remembered rather than owned by it.
   *
   * The seed is validated against `TABS` here because this is where `TABS` is.
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
   */
  useEffect(() => {
    onTabChange?.(tab);
  }, [tab, onTabChange]);
  const tabRequest = props.tabRequest ?? null;
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
  const tabs = TABS.filter((name) => name !== 'Terminal' || terminal !== false);
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
    const result = attachIntoDraft(draft, {
      name: file.name,
      size: file.size,
      text: await file.text(),
    });
    setAttachError(result.ok ? null : result.message);
    if (result.ok) onDraftChange(result.draft);
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

  // The session has stopped and the next move is yours. Keyed off the session,
  // not off an empty `output`: a session still writing its answer is busy, not
  // blocked, and banner-ing it would train you to ignore the banner.
  // A different session or a different step is a different document, and the
  // previous one's scroll position would open it half-read.
  const focusKey = `${entry?.session.id ?? ''}/${decision?.id ?? ''}`;
  const focusRef = useRef(focusKey);
  const output = decision?.output ?? null;
  // `output` is a change SIGNAL, not something this effect reads: new text
  // arriving is exactly the moment the region has to stick again, and dropping it
  // from the list would leave the pane showing the old bottom.
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
  }, [focusKey, output]);

  const commands = decision?.commands ?? [];
  /**
   * The `!` typeahead's three pieces of state. `caret` is read off the box on
   * every change rather than mirrored from the draft: which token is being
   * typed is a property of where the caret is, and a draft alone cannot say.
   * `dismissed` is what Escape sets, and any further typing clears -- Escape
   * puts the list away without touching the text, so the operator can go on
   * writing their own command.
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
  /**
   * Whether the decision on screen is the one the session is working on.
   * `decisions` is newest first (model.ts), so the newest is the live turn --
   * the only one a "what it is doing now" caption can honestly describe.
   */
  const isNewestTurn =
    decision !== null && entry !== null && entry.session.decisions[0]?.id === decision.id;
  /**
   * Whether the empty `out` describes work still happening. Both halves are
   * required: only a `running` session is still working, and only the newest
   * turn is the one it is working on.
   */
  const outIsLive = isNewestTurn && entry?.session.status === 'running';
  /** The words themselves — `null` when there is no live turn, or when the
   * source cannot say what it is doing. */
  const liveActivity = outIsLive ? entry.session.activity : null;
  /**
   * The question the card draws: the newest OPEN one, and only if there is
   * none, the newest answered one -- what is still being asked outranks what
   * was already settled, and an absent list (a source with no such surface)
   * reads exactly like an empty one, which is no card at all.
   */
  const questions = entry?.session.questions ?? [];
  /**
   * THE SET, not the question. One `AskUserQuestion` call can carry several,
   * and drawing the newest open one put question TWO of a two-question call on
   * screen with question one nowhere (`panels/question-set.ts`).
   */
  const newestQuestions = newestSet(questions);
  const newestQuestion = newestQuestions[0] ?? null;
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
  const composerHidden = openQuestion && chattingAbout !== setId;
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
  const liveAge = outIsLive ? entry.session.age : null;
  const total = entry?.session.decisions.length ?? 0;
  // Oldest first: `decisions` arrives newest first. That
  // ordering is what makes "the last line" and "the newest turn" the same
  // line, so the ones kept are taken off the end.
  const orderedTurns = [...(entry?.session.decisions ?? [])].reverse();
  // Nothing while closed — not a shorter list, no list at all.
  const visibleTurns = progressOpen ? orderedTurns.slice(-PROGRESS_LINES) : [];

  /**
   * What the composer's button claims, in the words the SOURCE earns.
   *
   * PR #70 gave the Claude Code source a real channel into a running session,
   * so for that source a prompt is handed over and answered — `record` now
   * understates it, and an operator has to know when a message is going out.
   * black-smith still genuinely only appends to a log, so this is per-source
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
      style={{ width }}
      className={[
        // `bg-sidebar` is the mockup's own pane fill. Measured off the
        // `width:408px` column of artboards 1a/1b, both values are exactly what
        // this token already holds, so no new colour was invented for it.
        'relative flex h-full shrink-0 flex-col border-line border-l bg-sidebar',
      ].join(' ')}
    >
      {/*
        The pane says out loud when it holds the keyboard, and says it ONCE.

        It used to say it twice: this border grew to `border-l-2` in a colour
        as well, first `waiting` -- the amber that means "a session is waiting
        on your answer" everywhere else -- and then `focus-edge`. The operator
        called the border wrong, and two indicators for one fact is how they
        come to disagree. So the border is gone in both states and the pane
        keeps the ordinary 1px `line` every other column draws; the line along
        the top edge is the whole signal, the same one the sidebar wears, which
        is what was asked for.
      */}
      {active && <FocusEdge />}
      {resizeHandle}
      <div className="flex flex-col gap-2.5 border-line border-b px-3.5 pt-3">
        <div className="flex items-start gap-2">
          <span
            data-pane-status={entry?.session.status ?? 'none'}
            className={[
              'mt-1.5 h-1.5 w-1.5 flex-none rounded-full',
              entry === null ? 'bg-line-strong' : PANE_STATUS_DOT[entry.session.status],
              entry !== null && PANE_STATUS_BREATHES[entry.session.status] ? 'vam-breathe' : '',
            ].join(' ')}
          />
          <div className="min-w-0 flex-1">
            {/* `data-prompt-target` lives here now, not beside the composer.
                The operator asked for the branch line under the input to go;
                the guarantee it carried must not go with it. One input serving
                many sessions is the easiest possible way to send the right
                words to the wrong agent, so SOMETHING on screen has to say
                which session is about to be written to — and the pane header
                already did, two lines up from where the chip was. The tests
                that covered the chip now assert against this. */}
            <div
              data-prompt-target
              className="truncate font-medium text-[14px] text-ink leading-[1.35]"
            >
              {entry === null ? 'No session selected' : entry.session.title}
            </div>
            <div className="mt-1 flex items-center gap-[5px] font-mono text-[10px] text-ink-faint">
              <span data-prompt-project className="truncate text-ink-dim">
                {entry?.project.name ?? '—'}
              </span>
              <span>·</span>
              <span className="truncate">{entry?.session.epic ?? '—'}</span>
              <span>·</span>
              <span className="flex-none">
                {entry === null || entry.session.runningAgents === 0
                  ? 'no agent'
                  : `${entry.session.runningAgents} agents`}
              </span>
            </div>
          </div>
          {/* Which step the panel is expanding. The mockup puts it at the far
              right of the title row, where the eye lands last — it names the
              thing you are reading, not the thing you are choosing. */}
          {decision !== null && (
            <span data-detail-step className="flex-none font-mono text-[10px] text-ink-dim">
              {decision.label}
            </span>
          )}
        </div>

        {/* The row that stood here carried the `x/y` step counter, its
            expandable note, and the session age. The operator found it did no
            work and asked for it to go, following the tick strip that stood
            here before it. Nothing it showed is only here: the focused step is
            named at the right of the title row above, how many turns exist is
            the `progress` section's own counter, and the age is on the session
            card in the sidebar and on the canvas. */}

        <TabBar
          tabs={tabs}
          runningAgents={entry?.session.runningAgents ?? 0}
          current={current}
          onSelect={setTab}
        />
      </div>

      {/*
        Three regions, three scrollbars, one decision.
        Before this the whole pane scrolled as one column, so reading a long
        answer pushed the request that prompted it off the top — and the two
        things you compare to decide were never on screen together. Now `in`
        and `progress` are capped short (they are context) and `out` takes the
        remaining height (it is the thing you read), each scrolling on its own.
        `min-h-0` on every level is what makes a flex child actually able to
        shrink and scroll rather than growing its parent.
      */}
      <div className="flex min-h-0 flex-1 select-text flex-col gap-2.5 px-3.5 py-3">
        {/* A failed session says so here, not only in the dot's colour.
            Measured against the real CLI: a failed row carries `cwd, id,
            kind, name, sessionId, startedAt, state` and NOTHING about why --
            no error, no message, no exit code. The job's own `state.json`
            reports `working` for a session the CLI calls failed, so it is not
            a second opinion worth showing. Naming the gap is the whole of
            what can honestly be said. */}
        {current === 'Response' && entry?.session.status === 'failed' && (
          <p
            data-session-failed
            className="flex flex-none items-center gap-1.5 rounded-[9px] border border-failed bg-panel px-3 py-2 text-[11px] text-failed leading-[1.45]"
          >
            <span role="img" aria-label="failed" className="flex">
              <CircleSlash size={13} strokeWidth={1.6} />
            </span>
            <span className="min-w-0 flex-1">This session failed.</span>
            <Note text="the source reports no reason for the failure — a failed row carries no error, message or exit code">
              <span className="flex-none cursor-help font-mono text-[9.5px] text-ink-faint underline decoration-dotted">
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
        ) : decision === null ? (
          <p className="text-[11px] text-ink-faint">
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
        ) : (
          <>
            <section data-detail-block="in" className="flex flex-none flex-col gap-1.5">
              <Rule
                label="in"
                // `you`, and no time. `Decision` carries no timestamp, so
                // nothing here can say when this turn happened -- and
                // `session.age` is the session's LAST ACTIVITY, usually the
                // agent's most recent write rather than when you typed this.
                // Walk back a turn with `h` and the old caption went on
                // describing the present. The session's age is on its sidebar
                // row, where it is true.
                meta="you"
                iconLabel="you"
                tone="text-rule-in"
                icon={<User size={13} strokeWidth={1.6} />}
              />
              <div
                data-detail-scroll="in"
                style={{ maxHeight: IN_MAX_HEIGHT }}
                className="vam-no-scrollbar min-h-0 overflow-y-auto rounded-[9px] border border-line bg-panel px-3 py-2.5"
              >
                <p className="whitespace-pre-wrap break-words text-[12px] text-ink-dim leading-[1.55]">
                  {decision.input}
                </p>
              </div>
            </section>

            {/* The mockup lists the actions inside one step. black-smith's unit
                is the turn, so this lists the session's turns — the same shape
                answering the same question, off data that exists. */}
            {/* Closed, this is a rule and a toggle and nothing else. The three
                regions compete for one pane's height and a turn list is the
                least of the three to read, so it costs its own header until it
                is asked for — and then it costs the newest five lines, scrolled.
                A real <button>, not a new key: Enter and Space already activate
                one, it is reachable by Tab from the composer, and the modal
                keymap loses nothing to it. */}
            <section
              data-detail-block="progress"
              className={[
                'flex flex-none flex-col',
                progressOpen ? 'max-h-[22%] min-h-[56px] gap-1.5' : '',
              ].join(' ')}
            >
              <Rule
                label="progress"
                meta={
                  <button
                    type="button"
                    data-progress-toggle
                    aria-expanded={progressOpen}
                    onClick={() => setProgressOpen((open) => !open)}
                    className="flex cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] px-1 py-0.5 text-ink-faint hover:bg-raised hover:text-ink"
                  >
                    {total} turns
                    {progressOpen ? (
                      <ChevronDown size={11} strokeWidth={1.7} />
                    ) : (
                      <ChevronRight size={11} strokeWidth={1.7} />
                    )}
                  </button>
                }
                // `turns`, not `progress`: the visible label already says
                // progress, and a glyph that only repeats it is a word said
                // twice. The commit line means the session's turns.
                iconLabel="turns"
                tone="text-rule-progress"
                icon={<GitCommitVertical size={12} strokeWidth={1.7} />}
              />
              {progressOpen && (
                <ul className="vam-no-scrollbar flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pl-0.5 font-mono text-[10px] text-ink-faint">
                  {visibleTurns.map((d) => (
                    <li key={d.id} data-progress-turn className="flex items-center gap-2">
                      <span className={d.output === null ? 'text-waiting' : 'text-ink-ghost'}>
                        {d.output === null ? '◌' : '✓'}
                      </span>
                      <span className={`truncate ${d.id === decision.id ? 'text-ink-dim' : ''}`}>
                        {d.label}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section data-detail-block="out" className="flex min-h-0 flex-1 flex-col gap-1.5">
              <Rule
                label="out"
                meta={
                  <span className="flex items-center gap-1.5">
                    {/* `session.activity` is what the session is doing RIGHT
                        NOW, so it belongs to the turn currently being worked
                        and to no other. On an older turn it described the
                        present while the operator read the past. The newest
                        decision is the one in progress (`decisions` is newest
                        first, per model.ts). */}
                    {isNewestTurn ? (entry?.session.activity ?? '—') : '—'}
                    {jumps.above && (
                      <button
                        type="button"
                        data-out-to-top
                        aria-label="scroll out to the top"
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
                        aria-label="scroll out to the bottom"
                        onClick={() => jumpTo('bottom')}
                        className="flex cursor-pointer items-center rounded-[var(--radius-sm)] px-0.5 py-0.5 hover:bg-raised hover:text-ink"
                      >
                        <ChevronsDown size={12} strokeWidth={1.8} />
                      </button>
                    )}
                  </span>
                }
                iconLabel="agent"
                tone="text-rule-out"
                icon={<Bot size={14} strokeWidth={1.75} />}
              />
              {/* The one region that grows. Everything the operator reads to
                  decide lives in here, so it gets the height and its own
                  scroll rather than pushing `in` off the top of the pane. */}
              <div
                ref={outRef}
                data-detail-scroll="out"
                onScroll={(event) => {
                  stuckRef.current = isAtBottom(event.currentTarget);
                  syncJumps(event.currentTarget);
                }}
                className="vam-no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto text-[length:var(--vam-out-font-size,12px)]"
              >
                {decision.output !== null && decision.output !== '' && (
                  <OutText output={decision.output} />
                )}
                {(decision.output === null || decision.output === '' || outIsLive) && (
                  /* The live line and the answer are not alternatives, and
                     treating them as one is what made this line unreachable in
                     practice: it used to render only when `output` was empty,
                     but `transcript.ts` writes `turns[last].output` on every
                     assistant text, so a running session has an answer within
                     seconds and the operator never saw the line again. It is
                     rendered whenever the turn is live, and BELOW the answer:
                     here is what the session has said, here is what it is
                     doing now. When there is no answer it is the only thing in
                     the region, so the empty-turn sentence prints once, in
                     this same element, rather than in a second one.

                     While the session is working, this line is the only thing
                     in the pane that changes -- so it carries the work rather
                     than a sentence that reads the same on a session that has
                     quietly died. The idiom is the agent's own running caption:
                     a star, the word for what it is doing, and an ellipsis that
                     animates. The WORD is `activity` -- the newest tool call the
                     source reported (transcript.ts) -- so it cycles as the work
                     does, off data vam has, rather than off a rotating list of
                     invented gerunds. It REPLACES the blinking block caret this
                     line shipped with (and the `vam-breathe` pulse before that)
                     -- one motion story, not three -- and under
                     `prefers-reduced-motion` the dots park on at full opacity
                     (styles.css), which still reads as "still going". It is
                     withheld from every stopped status for the reason recorded
                     at PANE_STATUS_BREATHES. A null `activity` is a source that
                     cannot say (model.ts): the sentence stays as the word and no
                     words are invented, because it asserts only that the session
                     is running, which it is. */
                  <p
                    data-out-empty={
                      decision.output === null || decision.output === '' ? true : undefined
                    }
                    data-out-live={outIsLive ? 'true' : undefined}
                    className="text-[11.5px] text-ink-faint"
                  >
                    {outIsLive ? (
                      /* Star and word share one accent, the app's own `running`
                         token; the detail is dim. Decorative marks are hidden
                         from assistive tech, which should read the activity and
                         not a star and three dots. */
                      <span data-out-running className="text-running">
                        <span aria-hidden="true" data-out-running-star className="vam-running-star">
                          {'\u2733'}
                        </span>{' '}
                        <span data-out-running-word className="vam-running-word">
                          {liveActivity ??
                            noAnswerNote(decision.output, entry?.session.status ?? null)}
                        </span>
                        <span aria-hidden="true" data-out-ellipsis className="vam-ellipsis">
                          <span>.</span>
                          <span>.</span>
                          <span>.</span>
                        </span>
                        {liveAge !== null && (
                          <span data-out-running-detail className="text-ink-faint">
                            {' '}
                            (last active {liveAge} ago)
                          </span>
                        )}
                      </span>
                    ) : (
                      noAnswerNote(decision.output, entry?.session.status ?? null)
                    )}
                  </p>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {/* The question's own block, drawn only when there IS one: it was split
        off the composer's so the composer could stand down while a question is
        open, and a block that outlived its contents would be a doubled seam
        and 25px of dead height in the pane's most common state. */}
      {current !== 'Terminal' && newestQuestion !== null && (
        <div
          data-question-bar
          className="flex flex-none flex-col gap-2.5 border-line border-t bg-header px-3.5 py-3"
        >
          {/* black-smith's governance queue — findings awaiting a waiver, and
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
              /* FOUR THINGS HAVE TO BE TRUE before a Submit is drawn: the
                 source really delivers prompts, the shell really has the
                 bridge (there is none in the browser build), there is a row to
                 aim at, and VAM STARTED THAT ROW'S SESSION. The fourth is the
                 same test the mode row makes (`canCycleMode`) and for the same
                 reason: vam can press a key only in a pane it started, because
                 no process may take over another's controlling TTY. A focused
                 row is not an aimable pane, so `entry !== null` was drawing an
                 enabled Submit over the operator's own terminal that could
                 only ever come back refused. Any of the four missing draws no
                 button rather than one that would refuse -- see
                 `QuestionCard`. */
              onAnswer={
                delivers === true &&
                answer !== undefined &&
                entry !== null &&
                entry.session.vamControlled === true
                  ? (request) => answer(entry.project.id, request, entry.session.id)
                  : null
              }
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
          {suggesting && (
            <div
              data-bang-suggest
              className="flex flex-col gap-0.5 rounded-[10px] border border-line-strong bg-panel px-1.5 py-1.5"
            >
              <p className="px-1.5 pb-0.5 text-[10px] text-ink-faint">
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
                  <span className="max-w-full truncate text-[11px] text-ink">{command.label}</span>
                  <span
                    data-bang-command
                    className="max-w-full truncate font-mono text-[10.5px] text-ink-dim"
                  >
                    {command.command}
                  </span>
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
                placeholder={
                  entry === null
                    ? 'Pick a session first'
                    : 'Reply to agent, answer with a number, or paste a plan…'
                }
                className="vam-no-scrollbar max-h-[120px] min-w-0 flex-1 resize-none bg-transparent text-[12.5px] text-ink leading-[1.55] outline-none placeholder:text-ink-faint"
                aria-label="prompt to session"
              />
            </div>

            {images.length > 0 && (
              <p data-pasted-images className="text-[10.5px] text-ink-dim leading-[1.45]">
                {images.length === 1 ? '1 image' : `${images.length} images`} pasted and kept here —
                vam writes text to a session, so only the {'`[image #N]`'} placeholder is sent, not
                the image.
              </p>
            )}

            {attachError !== null && (
              <p data-attach-error className="text-[10.5px] text-waiting leading-[1.45]">
                {attachError}
              </p>
            )}

            <div className="flex items-center gap-2">
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
                  className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border border-line-strong text-ink-dim hover:bg-raised hover:text-ink"
                >
                  <Paperclip size={12} strokeWidth={1.7} />
                </button>
              </Note>
              {attachedName !== null && (
                <span
                  data-attach-chip
                  className="flex h-6 min-w-0 items-center gap-1 rounded-[6px] border border-line-strong bg-raised px-1.5 font-mono text-[10px] text-ink-dim"
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
              {/* The model field. Not a menu of names vam made up — vam has no
              model API and black-smith does the choosing — but not an inert
              chip either: what is typed here becomes the prompt's first
              line, in the recorded text a person reads. */}
              <Note text="vam cannot switch models — the factory chooses; this writes your request into the prompt text that gets recorded">
                <input
                  data-model-request
                  value={readModelRequest(draft)}
                  onChange={(event) => onDraftChange(setModelRequest(draft, event.target.value))}
                  placeholder="model"
                  aria-label="model requested in this prompt"
                  className="h-6 w-[84px] min-w-0 shrink rounded-[6px] border border-line-strong bg-transparent px-1.5 font-mono text-[10px] text-ink-dim outline-none placeholder:text-ink-ghost focus:text-ink"
                />
              </Note>
              {/* The way OUT, shown only while you are in — the moment it is the
              thing you need, and no width the rest of the time. It replaces
              the `i` / `I` notes the operator asked to lose: those advertised
              the way in, which you have already found by the time you can
              read them. */}
              {composing && (
                <span
                  data-prompt-escape
                  className="flex-none whitespace-nowrap font-mono text-[9.5px] text-ink-faint"
                >
                  Esc → sidebar
                </span>
              )}
              <span className="min-w-0 flex-1" />
              {/* The mockup draws a send arrow here. This one says RECORD, in
              the label and in the tooltip, because black-smith has no channel
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

          {/* The mockup's mode row — drawn ONLY where a mode can actually be
            chosen (`canCycleMode`), and gone entirely otherwise, which is the
            operator's own request: a switcher for a session whose model the
            factory picked and vam cannot touch is a control that lies, and
            dimming it would still say a choice lives here.

            The pills write the choice into the prompt as a leading `mode:`
            line, so what was selected is in the recorded text; Shift+Tab
            presses the session's OWN chord in the pane vam started, which is
            what makes the row more than a highlight. Selecting Auto clears
            the line. The well's geometry is the mockup's: 2px on `raised`,
            24px pills at 11.5px, the current one filled with `segment-on`. */}
          {canCycleMode && (
            <div data-mode-row className="flex items-center gap-2">
              {/* The note hangs off the MODE label, and the label is a <button> so
              that a keyboard can reach it. A span with a tabIndex reads as a
              control to a screen reader without behaving like one. */}
              <Note text="the mode belongs to the session — Shift+Tab presses its own chord in the pane vam started, and the pills write the choice into the prompt text that gets recorded">
                <button
                  type="button"
                  className="flex-none cursor-default font-mono text-[9.5px] tracking-[0.1em] text-ink-faint"
                >
                  MODE
                </button>
              </Note>
              <div className="flex items-center gap-0.5 rounded-[8px] border border-line-strong bg-raised p-0.5">
                {MODES.map((mode) => {
                  // Derived from the draft, never a second copy of it: a mirror
                  // in component state is a thing that can disagree with the text
                  // actually being recorded.
                  const selected = mode === (readModeRequest(draft) || DEFAULT_MODE);
                  return (
                    <button
                      key={mode}
                      type="button"
                      data-mode-pill={mode.toLowerCase()}
                      aria-pressed={selected}
                      onClick={() => onDraftChange(setModeRequest(draft, mode))}
                      className={[
                        'flex h-6 cursor-pointer items-center rounded-[6px] px-2.5 text-[11.5px]',
                        selected
                          ? 'bg-segment-on font-medium text-ink'
                          : 'text-ink-dim hover:text-ink',
                      ].join(' ')}
                    >
                      {mode}
                    </button>
                  );
                })}
              </div>
              {/* The tip, at the right-hand end as the mockup draws it, with the
                refusal in its place when the last press did not land. It names
                a chord the prompt box really binds, and it exists only where
                that binding does — this caption was deleted once for naming a
                key no table answered to, on the stated terms that a real
                binding may bring it back and the caption alone may not. */}
              <span
                data-mode-cycle
                data-mode-refusal={cycleRefusal === null ? undefined : 'true'}
                className={[
                  'ml-auto flex-none whitespace-nowrap font-mono text-[9.5px]',
                  cycleRefusal === null ? 'text-ink-faint' : 'text-waiting',
                ].join(' ')}
              >
                {cycleRefusal ?? '⇧Tab · cycle mode'}
              </span>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
