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
 * session handed back for you to run by hand. There is no option chooser and
 * there should not be one: a session decides for itself and stops only when it
 * wants something a person has to supply, and that something is words, not a
 * pick from a menu somebody had to invent. Nothing here sends — the prompt is
 * RECORDED, and the caller says so out loud rather than letting a quiet no-op
 * be mistaken for a delivered answer.
 *
 * ## The mockup's four tabs
 *
 * ADE puts Response / PRs / Terminal / Agents across the top. Only Response has
 * anything behind it: black-smith has no terminal to attach to, no PR index per
 * session, and its agent roster is a factory-wide count rather than a per-
 * session list. The other three are drawn, disabled, and say why — see the todo.
 */

import {
  ArrowBigUp,
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  GitCommitVertical,
  User,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { Decision } from '../domain/model.js';
import type { SessionEntry } from '../domain/selectors.js';
import { ReviewQueue, type ReviewQueueProps } from './ReviewQueue.js';
import { isAtBottom, shouldStick } from './stick-to-bottom.js';

export type DetailPanelProps = {
  readonly entry: SessionEntry | null;
  /** The step the canvas has focused — the newest one unless `h`/`l` moved. */
  readonly decision: Decision | null;
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onPickCommand: (commandId: string) => void;
  readonly onCopyCommand: (commandId: string) => void;
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
const CURRENT_MODE = 'Auto';

/**
 * The mockup's segmented control: one filled pill on a sunken well, not
 * underlined labels. `Response` is the only tab with real content — see the
 * module doc — so it is also the only one that is ever "current" here.
 *
 * The Agents badge has a real source (`runningAgents`) and is omitted at
 * zero. PRs has none in black-smith's domain model, so it ships with no
 * badge rather than a fabricated or hardcoded count.
 */
function TabBar({ runningAgents }: { readonly runningAgents: number }) {
  return (
    <div className="mb-[11px] flex items-center gap-[3px] rounded-[9px] border border-line-loud bg-well p-[3px]">
      {TABS.map((tab) => {
        const current = tab === 'Response';
        const badge = tab === 'Agents' && runningAgents > 0 ? runningAgents : null;
        return (
          <span
            key={tab}
            data-placeholder={current ? undefined : `tab-${tab.toLowerCase()}`}
            title={current ? undefined : 'black-smith has no data behind this tab — see the todo'}
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
      <span className="font-mono text-[9.5px] text-ink-faint">{meta}</span>
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
 * The answer, formatted rather than poured out flat.
 *
 * `toDecisions` builds each answer as `eventType · taskId · detail` and joins
 * them with newlines, so the output is a LIST that was being rendered as one
 * paragraph — every answer running into the next. Splitting on the newline is
 * therefore not a formatting flourish, it restores a structure the adapter
 * already put there.
 *
 * The mockup's own out region is the model for how it is drawn: 12px/1.6 body
 * in `ink-dim` — whose two values ARE the ones measured off the Response
 * artboards, dark and light — 9px between blocks, with the machine-ish parts
 * lifted out in mono at 11px and the emphasised words in `ink`. That is the
 * operator asked for: the body colour already matched, what was missing was
 * the mockup's two-tone split between what a thing IS and what it SAYS.
 *
 * Deliberately not a markdown renderer: black-smith does not emit markdown
 * here, and guessing at one would dress arbitrary payload text as structure.
 */
function OutText({ output }: { readonly output: string }) {
  const lines = output.split('\n').filter((line) => line.trim() !== '');
  return (
    <div className="flex flex-col gap-[9px]">
      {lines.map((line, i) => {
        const cut = line.lastIndexOf(ANSWER_SEPARATOR);
        // Only a line the adapter actually built gets the two-tone treatment;
        // anything else is prose and is left whole.
        const head = cut === -1 ? null : line.slice(0, cut);
        const rest = cut === -1 ? line : line.slice(cut + ANSWER_SEPARATOR.length);
        return (
          <p
            // The lines have no ids of their own; their order in one answer is
            // stable and is the only thing distinguishing them.
            // biome-ignore lint/suspicious/noArrayIndexKey: no stabler id exists
            key={i}
            data-out-line
            className="whitespace-pre-wrap break-words text-[12px] text-ink-dim leading-[1.6]"
          >
            {head !== null && (
              <span data-out-head className="font-mono text-[11px] text-ink">
                {head}
              </span>
            )}
            {head !== null && ' — '}
            {rest}
          </p>
        );
      })}
    </div>
  );
}

/**
 * The step ribbon: one tick per turn, the focused one taller.
 *
 * Colour carries the same meaning it does everywhere else — green answered,
 * amber the one that stopped, grey not yet. It is the only place in vam that
 * shows the WHOLE chain at once; the canvas draws three.
 */
function StepRibbon({
  decisions,
  focusedId,
}: {
  readonly decisions: readonly Decision[];
  readonly focusedId: string | null;
}) {
  // Oldest first, so the ribbon runs the way the canvas and the eye do.
  const ordered = [...decisions].reverse();
  return (
    <div className="flex h-3.5 flex-1 items-center gap-0.5">
      {ordered.map((d) => {
        const here = d.id === focusedId;
        return (
          <span
            key={d.id}
            className={[
              'flex-1 rounded-sm',
              here ? 'h-2.5 bg-waiting' : 'h-[3px]',
              here ? '' : d.output === null ? 'bg-ink-ghost' : 'bg-running',
            ].join(' ')}
          />
        );
      })}
      {ordered.length === 0 && <span className="h-[3px] flex-1 rounded-sm bg-line" />}
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
    onPickCommand,
    onCopyCommand,
    composing,
    onCompose,
    onStopComposing,
    active,
    actionIndex,
    review,
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
  const [noteOpen, setNoteOpen] = useState(false);

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
    if (!shouldStick({ stuck: stuckRef.current, focusChanged })) return;
    box.scrollTop = box.scrollHeight;
    stuckRef.current = true;
  }, [focusKey, output]);

  const needsYou = entry?.session.status === 'waiting';
  const commands = decision?.commands ?? [];
  const total = entry?.session.decisions.length ?? 0;
  // Oldest first, like the ribbon: `decisions` arrives newest first. That
  // ordering is what makes "the last line" and "the newest turn" the same
  // line, so the ones kept are taken off the end.
  const orderedTurns = [...(entry?.session.decisions ?? [])].reverse();
  // Nothing while closed — not a shorter list, no list at all.
  const visibleTurns = progressOpen ? orderedTurns.slice(-PROGRESS_LINES) : [];
  const index = decision === null ? 0 : total - (entry?.session.decisions.indexOf(decision) ?? 0);
  const stepNote =
    decision === null
      ? `step ${index} of ${total}`
      : `step ${index} of ${total} · ${decision.label}`;

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
            className={[
              'mt-1.5 h-1.5 w-1.5 flex-none rounded-full',
              needsYou ? 'vam-breathe bg-waiting' : 'bg-running',
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
              <span className="truncate text-ink-dim">{entry?.project.name ?? '—'}</span>
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

        <div className="flex items-center gap-2 border-line border-t pt-[9px] pb-[3px]">
          {/* `x/y`, per the operator, with the sentence it replaced kept in
              reach rather than deleted. `title` is the hover tooltip and the
              same string is the aria-label — but a `title` does NOT appear on
              keyboard focus in any browser, and vam is driven from a keyboard,
              so the note is also a real <button> that prints it below the row.
              Nothing an operator must act on lives only in here: the counter is
              on screen and so is the step's label, at the right of the title
              row. This is the long form of what is already visible. */}
          <button
            type="button"
            data-step-counter
            aria-expanded={noteOpen}
            title={stepNote}
            aria-label={stepNote}
            onClick={() => setNoteOpen((open) => !open)}
            className="flex-none cursor-pointer rounded-[var(--radius-sm)] font-mono text-[9.5px] text-ink-faint hover:text-ink"
          >
            {index}/{total}
          </button>
          <StepRibbon decisions={entry?.session.decisions ?? []} focusedId={decision?.id ?? null} />
          <span className="flex-none font-mono text-[9.5px] text-ink-faint">
            {entry?.session.age ?? '—'}
          </span>
        </div>

        {noteOpen && (
          <div data-step-note className="-mt-1 font-mono text-[9.5px] text-ink-dim">
            {stepNote}
          </div>
        )}

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
        {decision === null ? (
          <p className="text-[11px] text-ink-faint">This session has no steps yet.</p>
        ) : (
          <>
            <section data-detail-block="in" className="flex flex-none flex-col gap-1.5">
              <Rule
                label="in"
                meta={`you · ${entry?.session.age ?? '—'}`}
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
                meta={entry?.session.activity ?? '—'}
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
                }}
                className="vam-no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
              >
                {decision.output === null ? (
                  <p className="text-[11.5px] text-ink-faint">
                    — the session is still running, no answer yet —
                  </p>
                ) : (
                  <OutText output={decision.output} />
                )}

                {commands.length > 0 && (
                  <div className="mt-1 flex flex-col gap-2">
                    <div className="text-[10.5px] text-ink-faint">
                      the agent proposed these — vam does not run them
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
                          <button
                            type="button"
                            onClick={() => onCopyCommand(command.id)}
                            className="ml-auto cursor-pointer rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px] text-ink-faint hover:bg-raised hover:text-ink"
                          >
                            yy
                          </button>
                          <button
                            type="button"
                            onClick={() => onPickCommand(command.id)}
                            className="cursor-pointer rounded-[var(--radius-sm)] border border-line-strong px-1.5 py-0.5 text-[10px] text-ink-dim hover:text-ink"
                          >
                            run
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
        {/* Above the composer, below the text: this is the thing the factory is
            actually asking, and it should be the last thing you read before you
            answer it. */}
        {review !== undefined && <ReviewQueue {...review} />}

        <div
          className={[
            'flex flex-col gap-2.5 rounded-[10px] border bg-panel px-3 py-2.5',
            active && actionIndex === commands.length ? 'border-waiting' : 'border-line-loud',
          ].join(' ')}
        >
          {/* Multiline, because a prompt is prose and a one-line slot hides
              everything but the tail of it. The mockup's own composer is a
              104px-tall block of 12.5px/1.55 text, not an input. */}
          <div className="flex items-start gap-2">
            <span className="mt-px flex-none font-mono text-[12px] text-ink-faint">❯</span>
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

          <div className="flex items-center gap-2">
            {/* Attachments and a model picker are ADE's; black-smith's prompt
                route takes a session id and a string. */}
            <span
              data-placeholder="attach"
              title="black-smith's prompt route takes text only — see the todo"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-line-strong text-ink-ghost"
            >
              +
            </span>
            <span
              data-placeholder="model-picker"
              title="the model is chosen by the factory, not by vam — see the todo"
              className="flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-line-strong px-2 font-mono text-[10px] text-ink-ghost"
            >
              factory picks
            </span>
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
              aria-label="record prompt"
              title="appends the prompt to this session’s log — vam cannot hand it to a running agent"
              className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-[7px] bg-line-strong text-ink hover:bg-line-loud"
            >
              <ArrowUp size={14} strokeWidth={1.7} />
            </button>
          </div>
        </div>

        {/* The mockup's mode row, in place of the slash tags that stood here.
            Both are placeholders — black-smith has no per-session mode any more
            than it has a command route — but the mockup's segmented well is the
            shape this row is meant to be, so it is the shape it takes: a 2px
            well on `raised`, 24px pills at 11.5px, the current one filled with
            `segment-on`. Values measured off artboards 1a/1b. */}
        <div data-mode-row className="flex items-center gap-2">
          <span className="flex-none font-mono text-[9.5px] tracking-[0.1em] text-ink-faint">
            MODE
          </span>
          <div
            title="the mode is the factory's, not vam's — see the todo"
            className="flex items-center gap-0.5 rounded-[8px] border border-line-strong bg-raised p-0.5"
          >
            {MODES.map((mode) => (
              <span
                key={mode}
                data-mode-pill={mode.toLowerCase()}
                data-placeholder={mode === CURRENT_MODE ? undefined : `mode-${mode.toLowerCase()}`}
                className={[
                  'flex h-6 items-center rounded-[6px] px-2.5 text-[11.5px]',
                  mode === CURRENT_MODE ? 'bg-segment-on font-medium text-ink' : 'text-ink-dim',
                ].join(' ')}
              >
                {mode}
              </span>
            ))}
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
