/**
 * What the factory is waiting on you to rule on, and the buttons that rule.
 *
 * This is the part of vam that writes something other than your own words. Two
 * queues, and both are answers that go on the permanent record: a granted
 * waiver accepts a defect, an approved lesson gets spliced into every future
 * dispatch. So the affordances are deliberately unhurried — no single-click
 * grant, no default answer, and a reason required before the more consequential
 * button will do anything.
 *
 * The reason box is not politeness. `waivers.ts` requires `operatorNote`, and a
 * waiver with no reason is the kind of record that reads as an accident a month
 * later, when the person asking why a defect was accepted is you.
 */

import { type KeyboardEvent, type RefObject, useEffect, useRef } from 'react';
import type { ApiFinding, ApiLesson } from '../adapter/api.js';

export type ReviewQueueProps = {
  readonly waivers: readonly ApiFinding[];
  readonly lessons: readonly ApiLesson[];
  readonly error: string | null;
  /**
   * Waivable findings this session has that the queue could not reach — see
   * `useReviewQueue`'s `hidden`. Rendered rather than swallowed: a short queue
   * that says nothing reads as "you are done".
   */
  readonly hidden: number;
  /** Id currently being written, so its row can say so and stop taking clicks. */
  readonly busyId: string | null;
  /**
   * The reason typed against each row, keyed by fingerprint or lesson id.
   *
   * Lifted out of the rows so the keyboard can reach it: `Enter` on a verdict
   * is handled by whoever owns the action list, and a note living inside a row
   * would be invisible to it. It also puts the "a waiver needs a reason" rule
   * in ONE place instead of one per input.
   */
  readonly notes: Readonly<Record<string, string>>;
  readonly onNoteChange: (rowId: string, note: string) => void;
  /**
   * Hand the keyboard back to the pane.
   *
   * The window listener ignores keys typed in an input — that is what stops the
   * grammar firing while you write — so a box with no handler of its own is a
   * box with no way out. The prompt box has always bound its own Escape; these
   * did not, and the caret simply stayed in them.
   */
  readonly onNoteDone: () => void;
  /** Which verdict button `j`/`k` has landed on, if the pane holds the keyboard. */
  readonly selectedActionId: string | null;
  /** The row whose note box should take focus — set by `i`. */
  readonly focusNoteFor: string | null;
  readonly onWaiver: (fingerprint: string, decision: 'granted' | 'denied', note: string) => void;
  readonly onLesson: (lessonId: string, to: 'approve' | 'reject', note: string) => void;
};

const SEVERITY_INK: Readonly<Record<string, string>> = {
  'S3-minor': 'text-waiting',
  'S4-nit': 'text-ink-dim',
};

export function ReviewQueue(props: ReviewQueueProps) {
  const {
    waivers,
    lessons,
    error,
    hidden,
    busyId,
    notes,
    onNoteChange,
    onNoteDone,
    selectedActionId,
    focusNoteFor,
    onWaiver,
    onLesson,
  } = props;

  if (error !== null) {
    // A failed read must not render as an empty queue: "nothing to answer" is
    // the opposite of what it means.
    return (
      <div className="border-line border-t px-3 py-2">
        <div className="text-[10.5px] text-failed">không đọc được hàng chờ approve — {error}</div>
      </div>
    );
  }

  if (waivers.length === 0 && lessons.length === 0 && hidden === 0) {
    return null;
  }

  return (
    <div data-review-queue className="border-line border-t px-3 py-2">
      <div className="flex items-center gap-2 pb-1.5">
        <span className="vam-breathe text-[11px] text-waiting">⏸</span>
        <span className="font-semibold text-[10.5px] text-waiting uppercase tracking-wide">
          waiting for your review
        </span>
        <span className="text-[10px] text-ink-faint">{waivers.length + lessons.length}</span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {waivers.map((finding) => (
          <WaiverRow
            key={finding.fingerprint}
            finding={finding}
            busy={busyId === finding.fingerprint}
            note={notes[finding.fingerprint] ?? ''}
            onNoteChange={onNoteChange}
            onNoteDone={onNoteDone}
            selectedActionId={selectedActionId}
            focused={focusNoteFor === finding.fingerprint}
            onAnswer={onWaiver}
          />
        ))}
        {hidden > 0 && <HiddenRow count={hidden} />}
        {lessons.map((lesson) => (
          <LessonRow
            key={lesson.lessonId}
            lesson={lesson}
            busy={busyId === lesson.lessonId}
            note={notes[lesson.lessonId] ?? ''}
            onNoteChange={onNoteChange}
            onNoteDone={onNoteDone}
            selectedActionId={selectedActionId}
            focused={focusNoteFor === lesson.lessonId}
            onAnswer={onLesson}
          />
        ))}
      </ul>
    </div>
  );
}

function WaiverRow({
  finding,
  busy,
  note,
  onNoteChange,
  onNoteDone,
  selectedActionId,
  focused,
  onAnswer,
}: {
  readonly finding: ApiFinding;
  readonly busy: boolean;
  readonly note: string;
  readonly onNoteChange: ReviewQueueProps['onNoteChange'];
  readonly onNoteDone: ReviewQueueProps['onNoteDone'];
  readonly selectedActionId: string | null;
  readonly focused: boolean;
  readonly onAnswer: ReviewQueueProps['onWaiver'];
}) {
  const noteRef = useNoteFocus(focused);
  // Required by waivers.ts, and enforced here so the refusal arrives before you
  // have committed to an answer rather than after.
  const ready = note.trim() !== '' && !busy;
  const selected = (verdict: string) =>
    selectedActionId === `waiver:${finding.fingerprint}:${verdict}`;

  return (
    <li
      data-waiver={finding.fingerprint}
      className="rounded-[var(--radius-sm)] border border-line bg-panel px-2 py-1.5"
    >
      <div className="flex items-baseline gap-2">
        <span
          className={`font-mono text-[10px] ${SEVERITY_INK[finding.severity] ?? 'text-ink-dim'}`}
        >
          {finding.severity}
        </span>
        <span className="truncate text-[10px] text-ink-faint">{finding.taskId}</span>
        <span className="ml-auto shrink-0 text-[10px] text-ink-faint">{finding.foundBy}</span>
      </div>
      <p className="select-text whitespace-pre-wrap break-words pt-1 text-[11px] text-ink leading-relaxed">
        {finding.summary}
      </p>
      <div className="flex items-center gap-1.5 pt-1.5">
        <input
          ref={noteRef}
          value={note}
          onChange={(event) => onNoteChange(finding.fingerprint, event.target.value)}
          onKeyDown={(event) => leaveOnKey(event, noteRef, onNoteDone)}
          placeholder="reason (required)…"
          aria-label={`reason for ${finding.fingerprint}`}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] bg-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          type="button"
          disabled={!ready}
          onClick={() => onAnswer(finding.fingerprint, 'denied', note)}
          className={`rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[10px] text-ink-dim enabled:hover:border-line-strong enabled:hover:text-ink disabled:opacity-40 ${
            selected('denied') ? 'border-running ring-1 ring-running' : 'border-line'
          }`}
        >
          fix
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => onAnswer(finding.fingerprint, 'granted', note)}
          className={`rounded-[var(--radius-sm)] border border-waiting/50 px-1.5 py-0.5 text-[10px] text-waiting enabled:hover:bg-waiting/10 disabled:opacity-40 ${
            selected('granted') ? 'ring-1 ring-running' : ''
          }`}
        >
          waive
        </button>
      </div>
    </li>
  );
}

/**
 * What this queue knows it cannot show you.
 *
 * It is deliberately not a row you can answer: vam has no way to fetch these
 * findings, so offering a button would be offering an answer to a question it
 * cannot read. What it can do is stop the queue from looking finished, and say
 * where to go instead.
 */
function HiddenRow({ count }: { readonly count: number }) {
  return (
    <li
      data-hidden-findings={count}
      className="rounded-[var(--radius-sm)] border border-waiting/40 border-dashed px-2 py-1.5"
    >
      <p className="text-[11px] text-waiting leading-relaxed">
        còn {count} finding chờ approve mà vam không đọc được
      </p>
      <p className="pt-1 text-[10.5px] text-ink-faint leading-relaxed">
        vam tìm finding qua task board của session này; finding gắn vào task do session khác tạo thì
        không có đường tới. Xem bằng{' '}
        <span className="select-text font-mono text-ink-dim">smith stats overview</span>.
      </p>
    </li>
  );
}

function LessonRow({
  lesson,
  busy,
  note,
  onNoteChange,
  onNoteDone,
  selectedActionId,
  focused,
  onAnswer,
}: {
  readonly lesson: ApiLesson;
  readonly busy: boolean;
  readonly note: string;
  readonly onNoteChange: ReviewQueueProps['onNoteChange'];
  readonly onNoteDone: ReviewQueueProps['onNoteDone'];
  readonly selectedActionId: string | null;
  readonly focused: boolean;
  readonly onAnswer: ReviewQueueProps['onLesson'];
}) {
  const noteRef = useNoteFocus(focused);
  const selected = (verdict: string) => selectedActionId === `lesson:${lesson.lessonId}:${verdict}`;

  return (
    <li
      data-lesson={lesson.lessonId}
      className="rounded-[var(--radius-sm)] border border-line bg-panel px-2 py-1.5"
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] text-in">lesson</span>
        <span className="truncate text-[10px] text-ink-faint">
          {lesson.lessonType} · {lesson.lessonScope}
        </span>
      </div>
      <p className="select-text whitespace-pre-wrap break-words pt-1 text-[11px] text-ink leading-relaxed">
        {lesson.statement}
      </p>
      <div className="flex items-center gap-1.5 pt-1.5">
        <input
          ref={noteRef}
          value={note}
          onChange={(event) => onNoteChange(lesson.lessonId, event.target.value)}
          onKeyDown={(event) => leaveOnKey(event, noteRef, onNoteDone)}
          placeholder="note (optional)…"
          aria-label={`note for ${lesson.lessonId}`}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] bg-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(lesson.lessonId, 'reject', note)}
          className={`rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[10px] text-ink-dim enabled:hover:border-line-strong enabled:hover:text-ink disabled:opacity-40 ${
            selected('reject') ? 'border-running ring-1 ring-running' : 'border-line'
          }`}
        >
          reject
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(lesson.lessonId, 'approve', note)}
          className={`rounded-[var(--radius-sm)] border border-done/50 px-1.5 py-0.5 text-[10px] text-done enabled:hover:bg-done/10 disabled:opacity-40 ${
            selected('approve') ? 'ring-1 ring-running' : ''
          }`}
        >
          approve
        </button>
      </div>
    </li>
  );
}

/**
 * Take focus when `i` asks for it, and only then.
 *
 * Imperative rather than `autoFocus`, for the reason the sidebar's boxes are:
 * focus is taken because a key was pressed, not because a component happened to
 * mount. A queue that grabbed the caret every time it re-rendered would fight
 * the person typing in it.
 */
function useNoteFocus(focused: boolean) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focused) {
      ref.current?.focus();
    }
  }, [focused]);
  return ref;
}

/**
 * Escape or Enter gives the pane its keyboard back.
 *
 * Both, and both meaning the same thing. The note is controlled, so it is
 * already saved by the time either lands — there is nothing for Enter to commit
 * and nothing for Escape to discard, and making them differ would invent a
 * distinction the box does not have. What they do is end typing, which is the
 * only thing you can want from a one-line field you have finished filling.
 *
 * Enter deliberately does NOT answer the verdict. The cursor is still sitting
 * on whichever button `j` last reached, and firing it from inside the text box
 * would grant a waiver as the last keystroke of writing its excuse.
 */
function leaveOnKey(
  event: KeyboardEvent<HTMLInputElement>,
  ref: RefObject<HTMLInputElement | null>,
  done: () => void,
) {
  if (event.key === 'Escape' || event.key === 'Enter') {
    event.preventDefault();
    ref.current?.blur();
    done();
  }
}
