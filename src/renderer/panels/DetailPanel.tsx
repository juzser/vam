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
 * This doc used to say there was no option chooser and there should not be
 * one, on the grounds that what a stopped session wants is words rather than a
 * pick from a menu somebody invented. The mockup has one, and the operator
 * asked for its layout; the objection survives intact as the reason
 * `ApprovalBox` is fed by a DECLARED PLACEHOLDER rather than by a field added
 * to the model. Nothing here invents a question a source did not ask, and a
 * pick writes its line into the prompt box rather than answering anything.
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
  CircleHelp,
  CircleSlash,
  GitCommitVertical,
  Paperclip,
  User,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Decision, SessionStatus } from '../domain/model.js';
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
 * One option in the picker the mockup draws above the composer.
 *
 * ## THIS IS A PLACEHOLDER SHAPE, NOT A DOMAIN TYPE — read this before using it
 *
 * Nothing in `domain/model.ts` expresses "the agent asked a question with
 * numbered options". A `Decision` has an `input` (what the operator typed), an
 * `output` (the session's final response) and a list of `commands` the agent
 * handed back for a person to run — and that is the whole surface. Neither
 * adapter produces anything else: `to-canvas.ts` builds decisions out of
 * black-smith events, and the Claude Code source builds them out of a
 * transcript. No source vam reads returns a numbered question.
 *
 * So this type describes the MOCKUP, not the data, and it deliberately lives
 * in this file rather than in the model. Adding an `options` field to
 * `Session` or `Decision` would be inventing a fact no adapter can supply, and
 * every fixture would then carry a field nothing fills. When a source really
 * does return a question with options, the honest move is to add it to the
 * model THEN and hand it to `DetailPanel` as a prop — at which point
 * `PLACEHOLDER_APPROVAL` below is deleted and nothing else here changes.
 */
export type ApprovalOption = {
  readonly id: string;
  /** The one line the option is chosen by; it is what a pick writes. */
  readonly title: string;
  readonly body: string;
  /** The one the agent leans towards — the mockup's amber card. */
  readonly suggested: boolean;
};

export type ApprovalRequest = {
  /** Rendered in letter-spaced capitals, the mockup's own idiom for state. */
  readonly label: string;
  readonly options: readonly ApprovalOption[];
};

/**
 * The layout's stand-in content, and it says so in every line of itself.
 *
 * The alternative was three plausible-looking migration choices copied out of
 * the mockup, which would have put words on screen that read exactly like an
 * agent's own and are not. Nothing here can be mistaken for a session's answer:
 * the header says placeholder, the DOM node says `data-placeholder`, and each
 * card describes the slot it occupies instead of filling it.
 */
export const PLACEHOLDER_APPROVAL: ApprovalRequest = {
  label: 'option picker · placeholder layout',
  options: [
    {
      id: 'suggested',
      suggested: true,
      title: 'The option the agent leans towards',
      body: 'Wears the amber card. No source vam reads returns a question with numbered options today, so this text describes the slot rather than filling it.',
    },
    {
      id: 'second',
      suggested: false,
      title: 'A second way to go',
      body: 'A plain card. Choosing one writes its title into the prompt box below — the only thing vam can honestly do with a choice it was never handed.',
    },
    {
      id: 'third',
      suggested: false,
      title: 'A third way to go',
      body: "Three is the mockup's own count, and the hint under the list counts with it rather than promising a fixed three.",
    },
  ],
};

/**
 * The option picker: the mockup's block at `docs/design/mockup/ADE Session
 * Canvas.dc.html` lines 1515-1554, value for value.
 *
 * Those lines are in artboard **2b** ("Agent offers three options instead of an
 * approval gate", opening at dc:812), not 1a — 1a is the approval-gate board
 * and only starts at dc:1576, after this block ends. The difference matters
 * beyond a citation: 1a has a light twin, 1b at dc:2336, and **2b has none**.
 * The mockup draws this component in dark only. So every dark value below is
 * measured and every light value it reaches through a token is DERIVED — read
 * off the nearest surface the light artboard does draw at the same weight.
 * `styles.css` says so at `--vam-lifted`; it is true of the whole block.
 *
 * Where each measurement came from, and the token it mapped to. The mockup's
 * own hex values are deliberately NOT repeated here: `topology-constraints`
 * §13.1 bans a literal hex anywhere under `src/`, comments included, and it is
 * right to — a hex written in prose is a second copy of a colour that no
 * longer changes when the token does. The `dc:` line numbers are the citation;
 * open the file to see the value.
 *
 *  - header label (dc:1518) mono 9.5px / 0.1em      -> `text-waiting`
 *  - header right (dc:1520) mono 9.5px              -> `text-ink-faint`
 *  - header icon  (dc:1517) 18px, r5                -> `bg-waiting-tint` on `text-waiting`
 *  - column gap   (dc:1521) 7px
 *  - suggested card (dc:1524) r9, 1px, 10px 11px    -> `border-waiting` / `bg-waiting-wash`
 *  - plain card   (dc:1533) 1px                     -> `border-line-loud` / `bg-lifted` (minted)
 *  - badge        (dc:1525) 20x20, r6, mono 10.5px  -> `bg-waiting-tint` / `text-waiting`
 *  - plain badge  (dc:1534)                         -> `bg-line-strong` / `text-ink-dim`
 *  - title        (dc:1527) 12px / 500 / 1.35       -> `text-ink`
 *  - body         (dc:1528) 11px / 1.45 / pretty    -> `text-ink-dim`
 *  - SUGGESTED    (dc:1530) mono 9px / 0.08em, r999, 2px 6px
 *                                                   -> `text-waiting` / `border-waiting-tint`
 *  - enter glyph  (dc:1537) mono 9.5px              -> `text-ink-faint`
 *  - footer field (dc:1552) h30, r8, 1px, 11.5px    -> `border-line-loud` / `bg-lifted`
 *  - footer hint  (dc:1553) mono 9.5px              -> `text-ink-faint`
 *
 * The plain card's surface was minted as `--vam-lifted`. What that token buys
 * is exactly one value: the dark one, which the mockup measures directly at
 * dc:1533 and which no existing token holds. It is NOT far from its
 * neighbours — dark `raised` is four steps of 255 below it — and in light it
 * is an exact duplicate of both `--vam-panel` and `--vam-canvas`, so in that
 * theme it carries no information at all. It exists so the one measured dark
 * value is written once, under a name, instead of being approximated by
 * `raised` or copied as a hex.
 *
 * SUGGESTED is a fact about the agent's opinion. FOCUSED is a fact about where
 * your cursor is, and they collide on the first card. So focus is not painted
 * from state at all: the ring is a `focus-visible` outline, which cannot exist
 * without the browser's own focus BY CONSTRUCTION. It therefore cannot be worn
 * at rest by the suggested card, cannot be moved by a mouse click, and cannot
 * drift out of step with where the keyboard actually is. Suggested stays the
 * amber card and the amber pill; sharing a treatment would make moving the
 * cursor look like changing the recommendation.
 *
 * ## Keyboard
 *
 * Every option is a real `<button>`, so Tab reaches it and Enter and Space
 * activate it with no new binding at all. On top of that a digit typed while
 * the picker holds focus picks that card, which is the mockup's own `1-3 to
 * pick`. Digits are free in `keyboard/chords.ts`: `SINGLE` binds none of them
 * and `0` is only ever read after the `z` prefix, so nothing was taken.
 *
 * The handler sits on the GROUP, not on each card, so the hint holds anywhere
 * inside the picker — including the "type your own" button — rather than only
 * once a card already has DOM focus. And because one keypress carries one
 * digit, only nine options are reachable: the hint stops at nine and a badge
 * past nine prints no number, so nothing on screen promises a key that does
 * not exist. The placeholder has three; a real adapter may not.
 *
 * The digit binding is scoped to this component rather than added to the chord
 * table because the global table's actions are dispatched from `Canvas.tsx`,
 * which this task must not edit. What the follow-up would be, exactly: add
 * `{ kind: 'pickOption', index: number }` to `KeyAction`, map `'1'`-`'9'` in
 * `SINGLE`, and have `Canvas.tsx` route it to the same `onChoose` this
 * component already calls.
 */
/** The header label, so the group can point an accessible name at it. */
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

const APPROVAL_LABEL_ID = 'vam-approval-label';

export function ApprovalBox({
  request,
  age,
  onChoose,
  onCompose,
}: {
  readonly request: ApprovalRequest;
  /** The session's own age — the only real value in this block. */
  readonly age: string;
  readonly onChoose: (option: ApprovalOption) => void;
  readonly onCompose: () => void;
}) {
  const { options } = request;
  const pickDigit = (key: string) => {
    if (!/^[1-9]$/.test(key)) return false;
    const option = options[Number(key) - 1];
    // A digit past the end does nothing, rather than wrapping onto a card the
    // operator was not looking at.
    if (option === undefined) return false;
    onChoose(option);
    return true;
  };

  return (
    // A <fieldset>, which IS a group, rather than a div wearing `role="group"`:
    // one grouped question with a set of answers is what the element is for,
    // and it carries the role without an attribute. The name comes from
    // `aria-labelledby` rather than a <legend> because the label is the third
    // thing in the header row, after the icon, not a heading above it.
    // `tabIndex={-1}` so the digit handler catches from any descendant without
    // adding a second Tab stop in front of the cards themselves.
    <fieldset
      data-approval
      data-placeholder="approval-options"
      aria-labelledby={APPROVAL_LABEL_ID}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (pickDigit(event.key)) event.preventDefault();
      }}
      className="flex flex-col gap-[11px]"
    >
      <div className="flex items-center gap-[7px]">
        <span
          role="img"
          aria-label="the agent is asking"
          className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] bg-waiting-tint text-waiting"
        >
          <CircleHelp size={12} strokeWidth={1.7} />
        </span>
        {/* The gap this block stands in, named where a keyboard can read it:
            `docs/ade-redesign.md` asks a placeholder to say what it is, and a
            `title` says it to a mouse only. The trigger is a real <button>
            for the same reason the MODE label below is one. */}
        <Note text="no source vam reads returns a question with numbered options, so these three cards are a drawn layout, not a real request">
          <button
            type="button"
            id={APPROVAL_LABEL_ID}
            className="min-w-0 cursor-default truncate font-mono text-[9.5px] tracking-[0.1em] text-waiting uppercase"
          >
            {request.label}
          </button>
        </Note>
        <span className="flex-1" />
        <span className="flex-none font-mono text-[9.5px] text-ink-faint">waiting {age}</span>
      </div>

      <div className="flex flex-col gap-[7px]">
        {options.map((option, i) => (
          <button
            key={option.id}
            type="button"
            data-approval-option={option.id}
            data-suggested={option.suggested ? 'true' : undefined}
            aria-current={option.suggested ? 'true' : undefined}
            onClick={() => onChoose(option)}
            className={[
              // Dashed, the app's own vocabulary for "nothing real here" — the
              // same one the canvas draws a step that has not happened in. It
              // reads in both themes, which small amber capitals do not.
              'flex cursor-pointer items-start gap-[10px] rounded-[9px] border border-dashed px-[11px] py-[10px] text-left',
              option.suggested ? 'border-waiting bg-waiting-wash' : 'border-line-loud bg-lifted',
              'focus-visible:outline-2 focus-visible:outline-line-loudest focus-visible:outline-offset-1',
            ].join(' ')}
          >
            <span
              data-approval-number
              className={[
                'flex h-5 w-5 flex-none items-center justify-center rounded-[6px] font-mono text-[10.5px]',
                option.suggested ? 'bg-waiting-tint text-waiting' : 'bg-line-strong text-ink-dim',
              ].join(' ')}
            >
              {/* A tenth card has no key to print: one keypress is one digit,
                  so a badge past nine would name a shortcut that does not
                  exist. It says it has none instead. */}
              {i < 9 ? i + 1 : '—'}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span data-approval-title className="font-medium text-[12px] text-ink leading-[1.35]">
                {option.title}
              </span>
              {/* `text-wrap: pretty` is the mockup's own (dc:1528): it is what
                  keeps a two-line description off a one-word last line. */}
              <span className="text-[11px] text-ink-dim leading-[1.45] [text-wrap:pretty]">
                {option.body}
              </span>
            </span>
            {option.suggested ? (
              <span className="flex-none rounded-full border border-waiting-tint px-1.5 py-[2px] font-mono text-[9px] tracking-[0.08em] text-waiting">
                SUGGESTED
              </span>
            ) : (
              <span
                data-approval-enter
                aria-hidden="true"
                className="flex-none font-mono text-[9.5px] text-ink-faint"
              >
                ↵
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        {/* The mockup draws this as an inert `<span>` that looks like a field.
            A second thing that looks like a prompt box, two lines above the
            real one, is a trap — so it is a real button and it does the one
            useful thing available: it hands the keyboard to the composer. */}
        <button
          type="button"
          data-approval-own
          onClick={onCompose}
          className="flex h-[30px] min-w-0 flex-1 cursor-pointer items-center rounded-[8px] border border-line-loud bg-lifted px-[11px] text-left text-[11.5px] text-ink-faint hover:text-ink-dim"
        >
          …or type your own instruction
        </button>
        <span className="flex-none font-mono text-[9.5px] text-ink-faint">
          1–{Math.min(options.length, 9)} to pick
        </span>
      </div>
    </fieldset>
  );
}

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
 * The tab bar's four entries. Presentation only — the labels, order and which
 * tabs actually hold content are unchanged; this restyles a segmented control,
 * it does not decide information architecture.
 */
const TABS = ['Response', 'PRs', 'Terminal', 'Agents'] as const;

/**
 * The mockup's mode segments, and which one it draws as current. Presentation
 * only: black-smith exposes no per-session mode, so these are drawn and
 * labelled as placeholders in the same way the tab bar's three empty tabs are.
 */
const MODES = ['Auto', 'Manual', 'Plan'] as const;

/**
 * The mockup's segmented control: one filled pill on a sunken well, not
 * underlined labels. `Response` is the only tab with real content — see the
 * module doc — so it is also the only one that is ever "current" here.
 *
 * The Agents badge has a real source (`runningAgents`) and is omitted at
 * zero. PRs has none in black-smith's domain model, so it ships with no
 * badge rather than a fabricated or hardcoded count.
 *
 * The three empty tabs are labels, not controls: nothing behind them can be
 * activated, so nothing here takes focus or hover.
 */
function TabBar({ runningAgents }: { readonly runningAgents: number }) {
  return (
    <div className="mb-[11px] flex items-center gap-[3px] rounded-[9px] border border-line-loud bg-well p-[3px]">
      {TABS.map((tab) => {
        const current = tab === 'Response';
        const badge = tab === 'Agents' && runningAgents > 0 ? runningAgents : null;
        const pill = (
          <span
            key={tab}
            data-placeholder={current ? undefined : `tab-${tab.toLowerCase()}`}
            className={[
              'flex h-[26px] flex-1 items-center justify-center gap-[5px] rounded-[7px] text-[12px]',
              current ? 'bg-line-strong font-medium text-ink' : 'text-ink-dim',
            ].join(' ')}
          >
            {tab}
            {badge !== null && (
              <span
                className={[
                  'font-mono text-[9.5px]',
                  current ? 'text-ink-dim' : 'text-ink-faint',
                ].join(' ')}
              >
                {badge}
              </span>
            )}
          </span>
        );
        // The three empty tabs were buttons wrapping a note that said why they
        // were empty. The operator asked for the tab notes to go, and with the
        // note gone the button had nothing left to be: it activated nothing and
        // existed only to be a focus stop for an explanation that no longer
        // opens. So they are plain labels now, and `data-placeholder` still
        // says in the markup which ones are unbacked.
        return pill;
      })}
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
   * `progress` is context, not the thing you read, so it opens showing no turn
   * at all — the newest five are one keystroke away.
   * Component state rather than a prop: nothing outside this pane has an
   * opinion about it, and routing it through the canvas would put a
   * presentation toggle in the model every other pane has to carry.
   */
  const [progressOpen, setProgressOpen] = useState(false);
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

  const needsYou = entry?.session.status === 'waiting';
  /**
   * While the picker is asking, the prompt box is not drawn.
   *
   * The picker already answers the question, and it carries its own way into
   * free text — "…or type your own instruction" — so a second, empty box
   * underneath is height that does the picker's job worse. It is REVEALED, not
   * removed: that button and `i` both turn `composing` on, and the box is
   * drawn whenever it holds the keyboard, so the control still does something
   * you can see rather than handing focus to an element that is not there.
   *
   * `draft !== ''` is the other half, and it is the important half. Picking an
   * option WRITES the option's line into the draft. A box that could hide over
   * a non-empty draft would put the operator's own words nowhere on screen and
   * still record them — including after the Esc that hands the keyboard back
   * to the sidebar. So the box hides only when it is empty and holds nothing.
   */
  const showPromptBox = !needsYou || composing || draft !== '';
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

  /**
   * What picking an option can honestly do: write its line into the draft.
   *
   * Not a submit and not a new write path — vam has neither an options API nor
   * a source that asked the question. The pick fills the prompt box the
   * operator was going to type into anyway, and they still record or send it
   * themselves. Appended rather than substituted, so a half-typed reply is
   * never silently thrown away by a keystroke meant to add to it.
   */
  const chooseOption = (option: ApprovalOption) => {
    onDraftChange(draft === '' ? option.title : `${draft}\n${option.title}`);
    onCompose();
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

        <TabBar runningAgents={entry?.session.runningAgents ?? 0} />
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
        {entry?.session.status === 'failed' && (
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
        {decision === null ? (
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
                     quietly died. `vam-breathe` is the header dot's own idiom
                     (and stops under `prefers-reduced-motion`, styles.css), and
                     it is withheld from every stopped status for the reason
                     recorded at PANE_STATUS_BREATHES. A null `activity` is a
                     source that cannot say (model.ts): the sentence stays,
                     because motion is honest here only about the fact that the
                     session is running, which it still is. */
                  <p
                    data-out-empty
                    data-out-live={outIsLive ? 'true' : undefined}
                    className={[
                      'text-[11.5px] text-ink-faint',
                      outIsLive ? 'vam-breathe' : '',
                    ].join(' ')}
                  >
                    {liveActivity ??
                      noAnswerNote(decision.output, entry?.session.status ?? null)}
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

        {/* The mockup puts the picker here: the last thing you read before you
            answer, above the box you answer in. Drawn only while the session is
            the one waiting on you, because a question nobody asked is not
            layout worth the height. See `ApprovalBox` for what is placeholder
            here and what is not. */}
        {needsYou && (
          <ApprovalBox
            request={PLACEHOLDER_APPROVAL}
            age={entry?.session.age ?? '—'}
            onChoose={chooseOption}
            onCompose={onCompose}
          />
        )}

        {showPromptBox && (
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
        )}

        {/* The mode row stays while the box is hidden: it is a setting the
            prompt carries, not part of the box, and it is where the operator
            sets it before asking for one. */}
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
