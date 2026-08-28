/**
 * The right panel: the focused step, in full, and the place you answer it.
 *
 * This is the half of the split the canvas exists to make possible. Once the
 * full text lives here, a canvas card can be a strict two-line summary without
 * losing anything — and a decision made from a truncated line is the failure
 * mode this panel removes. So `in` and `out` are shown whole, wrapped, scrollable
 * and selectable, in contrast with the rest of the app.
 *
 * `user-select` is turned back ON here, and only here. Everywhere else it is off
 * because a stray drag selecting half the canvas is noise; here the text is the
 * point and copying part of an output is a reasonable thing to want.
 *
 * The action strip at the bottom is a prompt box, plus whatever bash commands
 * the session handed back for you to run by hand. There is no option chooser and
 * there should not be one: a session decides for itself and stops only when it
 * wants something a person has to supply, and that something is words, not a
 * pick from a menu somebody had to invent. Nothing here sends —
 * §6 keeps epic 1 read-only, and the caller says so out loud rather than letting
 * a quiet no-op be mistaken for a delivered answer.
 */

import { useEffect, useRef } from 'react';
import type { Decision } from '../domain/model.js';
import type { SessionEntry } from '../domain/selectors.js';
import { ReviewQueue, type ReviewQueueProps } from './ReviewQueue.js';

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
};

export function DetailPanel({
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
}: DetailPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Imperative rather than `autoFocus`: focus is taken because `i` was pressed,
  // not because a component happened to mount.
  useEffect(() => {
    if (composing) {
      inputRef.current?.focus();
    }
  }, [composing]);

  // The session has stopped and the next move is yours. Keyed off the session,
  // not off an empty `output`: a session still writing its answer is busy, not
  // blocked, and banner-ing it would train you to ignore the banner.
  const needsYou = entry?.session.status === 'waiting';
  const commands = decision?.commands ?? [];

  return (
    <aside
      data-action-pane={active ? 'active' : 'idle'}
      className={[
        'flex h-full w-[380px] shrink-0 flex-col border-l bg-sunken',
        // The pane says out loud when it holds the keyboard. Without it, `I` and
        // `H` become a mode you have to remember being in, which is the failure
        // every modal interface is judged on.
        active ? 'border-running border-l-2' : 'border-line',
      ].join(' ')}
    >
      <header className="flex items-center gap-2 border-line border-b px-3 py-2">
        {active && (
          <span className="rounded-[var(--radius-sm)] bg-running px-1 font-mono font-semibold text-[9px] text-canvas">
            ACTION
          </span>
        )}
        {entry === null ? (
          <span className="text-[11px] text-ink-faint">chưa chọn session</span>
        ) : (
          <>
            <span className="truncate font-mono font-semibold text-[12px] text-ink">
              {entry.session.title}
            </span>
            <span className="truncate text-[11px] text-ink-faint">{entry.project.name}</span>
            {decision !== null && (
              <span data-detail-step className="ml-auto shrink-0 text-[11px] text-ink-dim">
                {decision.label}
              </span>
            )}
          </>
        )}
      </header>

      {/* The waiting banner. Loud on purpose: this panel is where the answer
          gets given, so the request has to be unmissable at the top of it. */}
      {needsYou && (
        <div className="vam-breathe flex items-center gap-2 border-waiting/40 border-b bg-waiting/10 px-3 py-1.5">
          <span className="text-[12px] text-waiting">⏸</span>
          <span className="font-semibold text-[11.5px] text-waiting">
            session đã dừng, đang chờ bạn
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 select-text overflow-y-auto px-3 py-2">
        {decision === null ? (
          <p className="text-[11px] text-ink-faint">session này chưa có step nào.</p>
        ) : (
          <>
            <Block label="in" tone="text-in" body={decision.input} />
            <Block
              label="out"
              tone="text-out"
              body={decision.output}
              placeholder="— session đang chạy, chưa trả lời xong —"
            />
          </>
        )}
      </div>

      {/* Above the commands, below the text: this is the thing the factory is
          actually asking, and it should be the last thing you read before you
          answer it. */}
      {review !== undefined && <ReviewQueue {...review} />}

      {commands.length > 0 && (
        <div className="border-line border-t px-3 py-2">
          <div className="pb-1.5 text-[10.5px] text-ink-faint">
            agent đề xuất chạy tay — vam không tự chạy
          </div>
          <ul className="flex flex-col gap-1.5">
            {commands.map((command, index) => (
              <li
                key={command.id}
                className={[
                  'rounded-[var(--radius-sm)] border bg-panel',
                  active && actionIndex === index ? 'border-running' : 'border-line',
                ].join(' ')}
              >
                <div className="flex items-center gap-2 px-2 pt-1.5">
                  <span className="font-mono text-[10px] text-waiting">{index + 1}</span>
                  <span className="truncate text-[11px] text-ink">{command.label}</span>
                  <button
                    type="button"
                    onClick={() => onCopyCommand(command.id)}
                    className="ml-auto rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[10px] text-ink-faint hover:bg-raised hover:text-ink"
                  >
                    yy
                  </button>
                  <button
                    type="button"
                    onClick={() => onPickCommand(command.id)}
                    className="rounded-[var(--radius-sm)] border border-line px-1.5 py-0.5 text-[10px] text-ink-dim hover:border-line-strong hover:text-ink"
                  >
                    chạy
                  </button>
                </div>
                {/* Wrapped, not scrolled. A command you cannot see the end of
                    is one you cannot check before running, and a horizontal
                    scrollbar in a dark panel is a bright bar across the thing
                    you are trying to read. `break-all` because the interesting
                    part of a long flag is usually its tail. */}
                <pre className="select-text whitespace-pre-wrap break-all px-2 pt-1 pb-1.5 font-mono text-[10.5px] text-ink-dim leading-relaxed">
                  {command.command}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="border-line border-t bg-panel px-3 py-2">
        {/*
          Three things competing for one line, and only one of them may be
          wrong: where your words are about to go. So the label is shrink-0
          (squeezed, it wrapped mid-word into "gửi"/"tới"), the target truncates
          rather than wrapping, and the hints are kept short enough that the
          target keeps its width — the action hint names only the two keys whose
          meaning is specific to this pane, since `j`/`k`/`h` mean the same here
          as everywhere else and the status bar already carries them.
        */}
        <div className="flex items-center gap-2 pb-1">
          <span className="shrink-0 text-[10.5px] text-ink-faint">gửi tới</span>
          <span
            data-prompt-target
            className="min-w-0 truncate font-mono font-semibold text-[11px] text-running"
          >
            {entry === null
              ? '— chưa chọn session —'
              : `${entry.project.name}/${entry.session.title}`}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-faint">
            {composing
              ? 'Enter gửi · Esc thoát'
              : active
                ? 'i lý do · Enter làm'
                : 'i gõ · I vào pane'}
          </span>
        </div>
        <div
          className={[
            'flex items-center gap-2 rounded-[var(--radius-sm)]',
            active && actionIndex === commands.length ? 'ring-1 ring-running' : '',
          ].join(' ')}
        >
          <span className="font-mono text-[12px] text-ink-faint">❯</span>
          <input
            ref={inputRef}
            value={draft}
            readOnly={!composing}
            onFocus={onCompose}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              // The window listener ignores keys typed in an input, so this box
              // binds the two it needs itself.
              if (event.key === 'Enter') {
                event.preventDefault();
                onSubmit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onStopComposing();
              }
            }}
            placeholder={entry === null ? 'chọn một session trước' : 'nhập prompt…'}
            className="flex-1 bg-transparent font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint"
            aria-label="prompt gửi tới session"
          />
        </div>
      </footer>
    </aside>
  );
}

function Block({
  label,
  tone,
  body,
  placeholder,
}: {
  readonly label: string;
  readonly tone: string;
  readonly body: string | null;
  readonly placeholder?: string;
}) {
  return (
    // Named so a test can assert on the full text HERE. The canvas card shows a
    // clamped copy of the same string, and a query that cannot tell them apart
    // would pass while the panel that exists to show it whole was empty.
    <section data-detail-block={label} className="pb-6">
      <div className={`pb-1 font-mono font-semibold text-[10.5px] uppercase ${tone}`}>{label}</div>
      {body === null ? (
        <p className="text-[11.5px] text-ink-faint">{placeholder}</p>
      ) : (
        // `whitespace-pre-wrap`: an agent's answer arrives with its own line
        // breaks, and collapsing them turns a list of findings into a paragraph.
        <p
          className={`whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed ${
            label === 'in' ? 'text-ink' : 'text-ink-dim'
          }`}
        >
          {body}
        </p>
      )}
    </section>
  );
}
