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
 * The composer at the bottom is a prompt box, plus whatever bash commands the
 * session handed back for you to run by hand.
 *
 * There is no option chooser above the composer, and there should not be one.
 * A picker stood here briefly, drawn from the mockup and fed by a placeholder
 * declared in this file: a header reading "the agent is asking" and three
 * cards whose every word was a constant. Nothing vam reads records what a
 * session is asking or what its options are -- a census of the transcripts,
 * the CLI and `~/.claude/` found no such field -- and `statusOf`
 * (`main/sources/claude-code/agents.ts`) calls every non-busy session
 * `waiting`, so the cards were shown to merely idle sessions as well. What a
 * waiting session actually has is its last turn, and `out` below already
 * renders it. So the pane shows that and invents nothing above it.
 *
 * What the composer's button claims is now the SOURCE's to say. PR #70 gave
 * the Claude Code source a real channel into a running session, so for that
 * source a prompt is delivered and answered; black-smith still only appends to
 * a log. `delivers` carries the difference, and with nothing said the wording
 * stays at "record".
 *
 * ## The mockup's four tabs
 *
 * ADE puts Response / PRs / Terminal / Agents across the top. Only Response has
 * anything behind it: black-smith has no terminal to attach to, no PR index per
 * session, and its agent roster is a factory-wide count rather than a per-
 * session list. The other three are drawn as inert labels — see the todo.
 */

import {
  ArrowBigUp,
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
import { type ReactNode, useEffect, useRef, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Decision, SessionAgent, SessionStatus } from '../domain/model.js';
import type { SessionEntry } from '../domain/selectors.js';
import { Note } from './Note.js';
import type { ReviewQueueProps } from './ReviewQueue.js';
import { hasContentAbove, hasContentBelow, isAtBottom, shouldStick } from './stick-to-bottom.js';

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

export type DetailPanelProps = {
  readonly entry: SessionEntry | null;
  /** The step the canvas has focused — the newest one unless `h`/`l` moved. */
  readonly decision: Decision | null;
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmit: () => void;
  /** Copy ONE command -- what the per-row `copy` button does. */
  readonly onCopyCommand: (commandId: string) => void;
  /**
   * Copy every command, newline-joined -- what pressing `yy` does, and so the
   * only behaviour allowed to wear the `yy` glyph.
   */
  readonly onCopyAllCommands: () => void;
  /**
   * The command row whose `copy` control should take the keyboard -- what `i`
   * asks for when the cursor is on a command row. A command row has no reason
   * box, so this is its equivalent of `ReviewQueueProps.focusNoteFor`.
   */
  readonly focusCommandId?: string | null;
  /** Cleared once the focus has landed, so a second `i` on the same row asks again. */
  readonly onCommandFocused?: () => void;
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
   * What the factory is waiting on you to rule on. Absent when there is no live
   * source — a queue you cannot answer should not be drawn.
   */
  readonly review?: ReviewQueueProps;
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
  /** The current rendered width (task-1's `renderedWidth`), applied inline. */
  readonly width: number;
  /** `PaneResizer`, positioned by the caller — kept out of this file's own concerns. */
  readonly resizeHandle: ReactNode;
};

/**
 * The tab bar's four entries, and which of them have anything behind them.
 *
 * `Agents` joined `Response` when a source that actually reports a roster
 * arrived (`Session.agents`). `PRs` and `Terminal` still have no data source
 * at all in any source vam speaks to, so they stay exactly what they were:
 * labels marked `data-placeholder`, taking neither focus nor hover.
 */
const TABS = ['Response', 'PRs', 'Terminal', 'Agents'] as const;

type Tab = (typeof TABS)[number];

/** The tabs that select something. Everything else in `TABS` is a label. */
const LIVE_TABS: readonly Tab[] = ['Response', 'Agents'];

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
 * zero. PRs has none in black-smith's domain model, so it ships with no
 * badge rather than a fabricated or hardcoded count.
 *
 * TWO KINDS OF PILL, and the difference is whether the tab selects anything.
 * A live tab is a real <button> — Tab reaches it, Enter and Space activate it,
 * `role="tab"` and `aria-selected` say which one is showing — because it now
 * moves what the pane renders. The empty two are still plain labels, for the
 * reason they became labels: they were buttons wrapping a note explaining why
 * they were empty, the operator asked for the note to go, and a focus stop
 * that activates nothing and explains nothing is a keyboard trap with a hover
 * state. `data-placeholder` still says in the markup which ones are unbacked.
 */
function TabBar({
  runningAgents,
  current,
  onSelect,
}: {
  readonly runningAgents: number;
  readonly current: Tab;
  readonly onSelect: (tab: Tab) => void;
}) {
  return (
    <div
      role="tablist"
      className="mb-[11px] flex items-center gap-[3px] rounded-[9px] border border-line-loud bg-well p-[3px]"
    >
      {TABS.map((tab) => {
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
        return LIVE_TABS.includes(tab) ? (
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
        ) : (
          <span key={tab} data-placeholder={`tab-${tab.toLowerCase()}`} className={shape}>
            {label}
          </span>
        );
      })}
    </div>
  );
}

/**
 * The Agents tab's content: which subagents this session spawned.
 *
 * THREE STATES, AND TWO OF THEM ARE ABSENCES THAT MEAN DIFFERENT THINGS
 * (model.ts). Absent is a source with no agent surface at all — black-smith
 * reports a live count and nothing about which agents they are — and empty is
 * a source that looked and found none, which is the common case, since most
 * sessions never spawn a subagent. Each gets one plain sentence. Neither gets
 * a spinner or a placeholder row: this pane has spent several rounds having
 * invented content removed from it.
 *
 * A row survives an unreadable meta file. The agent's id and whether it is
 * running come from its own transcript, so they are facts whatever the meta
 * file says; the labels are what goes `unknown`, and the row still says who is
 * working. The roster is capped at the source (`agent-roster.ts`), so this
 * renders everything it is given and counts nothing.
 */
function AgentsTab({ agents }: { readonly agents: readonly SessionAgent[] | undefined }) {
  if (agents === undefined || agents.length === 0) {
    return (
      <p data-agents data-agents-empty className="text-[11px] text-ink-faint">
        {agents === undefined
          ? 'This source does not report which agents a session is running.'
          : 'This session has spawned no agents.'}
      </p>
    );
  }
  return (
    <ul
      data-agents
      className="vam-no-scrollbar flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
    >
      {agents.map((agent) => (
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
 * Direction is the whole meaning here, so the two that carry it are arrows and
 * they oppose: in arrives (down-left), out leaves (up-right). `aria-label`
 * carries the word that was removed, and `role="img"` is what makes that
 * label announced at all — a bare <span> has no implicit role and would drop
 * it silently, which this codebase has already shipped once.
 */
function Rule({
  label,
  meta,
  icon,
}: {
  readonly label: string;
  /** Usually a value; `progress` puts its expand control here instead. */
  readonly meta: ReactNode;
  readonly icon: ReactNode;
}) {
  return (
    <div className="flex items-center gap-[7px]">
      <span className="flex flex-none items-center gap-[5px] text-ink-faint">
        {icon}
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
const OUT_MARKDOWN: Components = {
  p: ({ children }) => <p className="text-[12px] text-ink-dim leading-[1.6]">{children}</p>,
  h1: ({ children }) => <h1 className="font-medium text-[13px] text-ink">{children}</h1>,
  h2: ({ children }) => <h2 className="font-medium text-[12.5px] text-ink">{children}</h2>,
  h3: ({ children }) => (
    <h3 className="font-medium text-[12px] text-ink tracking-[0.01em]">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="flex list-disc flex-col gap-1 pl-4 text-[12px] text-ink-dim leading-[1.6]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="flex list-decimal flex-col gap-1 pl-4 text-[12px] text-ink-dim leading-[1.6]">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="marker:text-ink-ghost">{children}</li>,
  strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
  em: ({ children }) => <em className="text-ink-dim italic">{children}</em>,
  del: ({ children }) => <del className="text-ink-faint">{children}</del>,
  hr: () => <hr className="border-line border-t" />,
  blockquote: ({ children }) => (
    <blockquote className="border-line-strong border-l-2 pl-2.5 text-[12px] text-ink-faint leading-[1.6]">
      {children}
    </blockquote>
  ),
  // Styled as an inline chip, and reset back to plain text inside a fence by
  // the `pre` rule below — react-markdown stopped telling a component which of
  // the two it is, and the parent knows without being told.
  code: ({ children }) => (
    <code className="rounded-[4px] bg-raised px-1 py-[1px] font-mono text-[11px] text-ink">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="vam-no-scrollbar overflow-x-auto rounded-[7px] border border-line bg-canvas px-2.5 py-2 font-mono text-[11px] text-ink-dim leading-[1.55] [&_code]:bg-transparent [&_code]:px-0 [&_code]:text-ink-dim">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="vam-no-scrollbar overflow-x-auto">
      <table className="w-max border-collapse text-[11.5px] text-ink-dim">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-line px-2 py-1 text-left font-medium text-ink">{children}</th>
  ),
  td: ({ children }) => <td className="border border-line px-2 py-1 align-top">{children}</td>,
  a: ({ href, children }) => (
    <span className="text-done">
      {children}
      {href !== undefined && (
        <span className="font-mono text-[10.5px] text-ink-faint"> ({href})</span>
      )}
    </span>
  ),
  img: ({ alt }) => (
    <span className="font-mono text-[10.5px] text-ink-faint">{alt === '' ? 'image' : alt}</span>
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
              <span data-out-head className="font-mono text-[11px] text-ink">
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

export function DetailPanel(props: DetailPanelProps) {
  const {
    entry,
    decision,
    draft,
    onDraftChange,
    onSubmit,
    onCopyCommand,
    onCopyAllCommands,
    focusCommandId = null,
    onCommandFocused,
    composing,
    onCompose,
    onStopComposing,
    active,
    actionIndex,
    review,
    delivers,
    sending = false,
    width,
    resizeHandle,
  } = props;

  const inputRef = useRef<HTMLTextAreaElement>(null);
  /**
   * The `copy` button of each command row, by command id, so `i` can hand one
   * of them the keyboard. A ref map rather than state: which element is which
   * is not something a render depends on.
   */
  const copyRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (focusCommandId === null) return;
    copyRefs.current.get(focusCommandId)?.focus();
    onCommandFocused?.();
  }, [focusCommandId, onCommandFocused]);
  /**
   * `progress` is context, not the thing you read, so it opens showing no turn
   * at all — the newest five are one keystroke away.
   * Component state rather than a prop: nothing outside this pane has an
   * opinion about it, and routing it through the canvas would put a
   * presentation toggle in the model every other pane has to carry.
   */
  const [progressOpen, setProgressOpen] = useState(false);
  /**
   * Which tab the pane is showing. Component state for the same reason
   * `progressOpen` is: nothing outside this pane has an opinion about it, and
   * it survives switching sessions on purpose — an operator who opened Agents
   * is looking at agents, not at whichever tab the last session left behind.
   */
  const [tab, setTab] = useState<Tab>('Response');
  /** Whether the step counter has been asked for the sentence it abbreviates. */

  useEffect(() => {
    if (composing) {
      inputRef.current?.focus();
    }
  }, [composing]);

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
        'relative flex h-full shrink-0 flex-col border-l bg-sidebar',
        // The pane says out loud when it holds the keyboard. Without it, `I` and
        // `H` become a mode you have to remember being in, which is the failure
        // every modal interface is judged on.
        active ? 'border-l-2 border-waiting' : 'border-line',
      ].join(' ')}
    >
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
          {active && (
            <span className="flex-none rounded-[6px] bg-waiting px-1.5 py-1 font-mono font-semibold text-[9px] text-canvas">
              ACTION
            </span>
          )}
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

        <TabBar runningAgents={entry?.session.runningAgents ?? 0} current={tab} onSelect={setTab} />
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
        {tab === 'Response' && entry?.session.status === 'failed' && (
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
        {tab === 'Agents' ? (
          <AgentsTab agents={entry?.session.agents} />
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
                icon={
                  <span role="img" aria-label="you" className="flex">
                    <User size={13} strokeWidth={1.6} />
                  </span>
                }
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
                icon={
                  <span role="img" aria-label="agent" className="flex">
                    <Bot size={14} strokeWidth={1.75} />
                  </span>
                }
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
                className="vam-no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
              >
                {decision.output === null || decision.output === '' ? (
                  /* While the session is working, this line is the only thing
                     in the pane that changes -- so it carries the work rather
                     than a sentence that reads the same on a session that has
                     quietly died. The idiom is a terminal's: a blinking block
                     caret trailing the words, because that is what a line still
                     being written looks like. It REPLACES the `vam-breathe`
                     pulse this line shipped with -- one motion story, not an
                     opacity ramp and a blink arguing -- and it stops under
                     `prefers-reduced-motion` (styles.css), where it parks on as
                     a solid block. It is withheld from every stopped status for
                     the reason recorded at PANE_STATUS_BREATHES. A null
                     `activity` is a source that cannot say (model.ts): the
                     sentence stays and no words are invented, and the caret is
                     still honest, because it asserts only that the session is
                     running, which it is. */
                  <p
                    data-out-empty
                    data-out-live={outIsLive ? 'true' : undefined}
                    className="text-[11.5px] text-ink-faint"
                  >
                    {liveActivity ?? noAnswerNote(decision.output, entry?.session.status ?? null)}
                    {/* Decorative: a screen reader should read the activity,
                        not a block character. */}
                    {outIsLive && (
                      <span aria-hidden="true" data-out-cursor className="vam-term-cursor" />
                    )}
                  </p>
                ) : (
                  <OutText output={decision.output} />
                )}

                {commands.length > 0 && (
                  <div className="mt-1 flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-[10.5px] text-ink-faint">
                      <span>the agent proposed these — vam does not run them</span>
                      {/* The keystroke's glyph goes on the keystroke's
                          behaviour: `yy` copies ALL of them, newline-joined
                          (`chords.ts` -> `copyAllCommands`). It sat on the row
                          button, which copies one, and with several commands
                          the two diverged silently at the clipboard. */}
                      <button
                        type="button"
                        data-commands-copy-all
                        onClick={onCopyAllCommands}
                        title={`copy all ${commands.length} commands`}
                        className="ml-auto cursor-pointer rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px] text-ink-faint hover:bg-raised hover:text-ink"
                      >
                        yy
                      </button>
                    </div>
                    {commands.map((command, i) => (
                      <div
                        key={command.id}
                        className={[
                          'rounded-[9px] border bg-canvas px-3 py-2.5',
                          active && actionIndex === i ? 'border-waiting' : 'border-line',
                        ].join(' ')}
                      >
                        <div className="flex items-center gap-2 pb-1.5">
                          <span className="font-mono text-[10px] text-ink-ghost">{i + 1}</span>
                          <span className="truncate text-[11px] text-ink">{command.label}</span>
                          {/* One copy affordance per row, saying what it
                              does. The `run` button beside it also only
                              copied -- contradicting the caption above it and
                              the rule in model.ts, and the honest status only
                              arrived after the click. */}
                          <button
                            type="button"
                            data-command-copy
                            ref={(element) => {
                              if (element === null) {
                                copyRefs.current.delete(command.id);
                              } else {
                                copyRefs.current.set(command.id, element);
                              }
                            }}
                            onClick={() => onCopyCommand(command.id)}
                            title={`copy: ${command.label}`}
                            className="ml-auto cursor-pointer rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px] text-ink-faint hover:bg-raised hover:text-ink"
                          >
                            copy
                          </button>
                        </div>
                        {/* Wrapped, not scrolled. A command you cannot see the end
                          of is one you cannot check before running. */}
                        <pre className="select-text whitespace-pre-wrap break-all font-mono text-[10.5px] text-ink-dim leading-[1.6]">
                          {command.command}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      <div className="flex flex-none flex-col gap-2.5 border-line border-t bg-header px-3.5 py-3">
        {/* black-smith's governance queue — findings awaiting a waiver, and
            lesson candidates — used to stand here. The operator asked for it
            to go. `ReviewQueue` and its tests are left in the tree rather than
            deleted: it is working code for a real black-smith surface, and no
            other source has governance to show anyway, so restoring it is one
            line here plus the prop. */}
        <div
          data-prompt-box
          className={[
            'flex flex-col gap-2.5 rounded-[10px] border bg-panel px-3 py-2.5',
            active && actionIndex === commands.length ? 'border-waiting' : 'border-line-loud',
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
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                // The window listener ignores keys typed in a textarea, so this
                // box binds the ones it needs itself. Shift+Enter is left alone
                // — it is the newline the box became multiline to allow.
                if (event.key === 'Enter' && !event.shiftKey) {
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

        {/* The mockup's mode row, in place of the slash tags that stood here.
            The pills are real buttons and the selection is real: it is written
            into the prompt as a leading `mode:` line, the same way the model
            request is, because that is the only thing vam can actually make
            happen. black-smith has no per-session mode to switch, so a control
            that only changed vam's own state would look like it worked and do
            nothing. Selecting Auto clears the line rather than writing
            "unchanged". The well's geometry is the mockup's: 2px on `raised`,
            24px pills at 11.5px, the current one filled with `segment-on`. */}
        <div data-mode-row className="flex items-center gap-2">
          {/* The note hangs off the MODE label, and the label is a <button> so
              that a keyboard can reach it. A span with a tabIndex reads as a
              control to a screen reader without behaving like one. */}
          <Note text="the mode is the factory's, not vam's — see the todo">
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
                    selected ? 'bg-segment-on font-medium text-ink' : 'text-ink-dim hover:text-ink',
                  ].join(' ')}
                >
                  {mode}
                </button>
              );
            })}
          </div>
          <span className="flex-1" />
          {/* The mockup's `Tab · cycle mode` tag, at the right-hand end of the
              same row, carrying the chord the operator asked for. */}
          <span
            data-mode-cycle
            className="flex flex-none items-center gap-1.5 font-mono text-[9.5px] text-ink-faint"
          >
            <span className="flex items-center gap-1 rounded-[4px] border border-line-strong px-1.5 py-0.5">
              {/* `role="img"` is what makes the label announced at all: on a
                  bare <span> aria-label is dropped in silence. */}
              <span role="img" aria-label="shift">
                <ArrowBigUp size={11} strokeWidth={1.7} />
              </span>
              Tab
            </span>
            cycle mode
          </span>
        </div>
      </div>
    </aside>
  );
}
