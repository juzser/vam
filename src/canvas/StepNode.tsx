/**
 * One step in a session's chain — a strict summary, nothing more.
 *
 * It shows what kind of step it was, one line of `IN` and two clamped lines of
 * `OUT`. That is a deliberate ceiling, not a limitation to be lifted later: the
 * detail panel shows the focused step in full, so anything this card grew would
 * be a second, worse copy of that. The canvas answers "where is this session up
 * to"; the panel answers "what exactly did it say".
 *
 * ## Why `IN` and `OUT` lost their colours
 *
 * They used to be tinted apart, cyan and violet. The ADE mockup labels both in
 * the same faint mono and spends its colour on the one thing that can cost you
 * something — a step that has stopped and is waiting on your answer. That is
 * the better trade: across twenty cards, "which of these needs me" is a
 * question worth a hue, and "whose words are these" is answered by the label
 * sitting right next to them.
 */

import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { Decision } from '../domain/model.js';
import type { SessionEntry } from '../domain/selectors.js';

export type StepNodeData = {
  readonly entry: SessionEntry;
  readonly decision: Decision;
  readonly focused: boolean;
  readonly jumpLabel: string | null;
};

/**
 * What the icon says this step was.
 *
 * The mockup types every step — `READ · 6 FILES`, `EDIT · BOARDCOLUMN.TSX`,
 * `RUN · PYTEST -K LEDGER`, `ASK · APPROVAL`. black-smith does not hand that
 * over: a timeline entry carries a label and an answer, not a verb. So this
 * derives the three states vam can actually KNOW, and no more:
 *
 *  - `ask`  — stopped, and the newest turn of a session waiting on you.
 *  - `run`  — no answer yet, so still working.
 *  - `done` — answered.
 *
 * Inventing `READ`/`EDIT` from the label text was the alternative, and it is
 * worse than having none: a card that says `EDIT` because the label happened to
 * contain the word is a card that lies on the day it guesses wrong. Typed steps
 * need an event kind out of black-smith — see the todo.
 */
export type StepKind = 'ask' | 'run' | 'done';

export function stepKind(entry: SessionEntry, decision: Decision): StepKind {
  const newest = entry.session.decisions[0]?.id === decision.id;
  if (entry.session.status === 'waiting' && newest) {
    return 'ask';
  }
  return decision.output === null ? 'run' : 'done';
}

const KIND_WORD: Readonly<Record<StepKind, string>> = {
  ask: 'ASK',
  run: 'RUN',
  done: 'STEP',
};

function KindIcon({ kind }: { readonly kind: StepKind }) {
  if (kind === 'ask') {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M6.3 6.3a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.3" />
        <path d="M8 11.8h.01" />
      </svg>
    );
  }
  if (kind === 'run') {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4.6 3.4l7.6 4.6-7.6 4.6z" />
      </svg>
    );
  }
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.4 2H4.6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6.8a1 1 0 0 0 1-1V5.2z" />
      <path d="M9.4 2v3.2h3.2" />
    </svg>
  );
}

export function StepNode({ data }: NodeProps & { data: StepNodeData }) {
  const { entry, decision, focused, jumpLabel } = data;
  const kind = stepKind(entry, decision);
  const asking = kind === 'ask';

  return (
    <div
      data-step-kind={kind}
      className={[
        'relative flex h-full w-full flex-col gap-1.5 overflow-hidden rounded-[var(--radius-md)]',
        'bg-panel px-2.5 py-2 shadow-[var(--shadow-node)]',
        // The asking card carries the halo instead of a border, exactly as the
        // mockup does: a border is a boundary, a halo is a call.
        asking ? 'vam-call' : 'border border-line',
        focused && !asking ? 'border-ink-dim' : '',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />

      {jumpLabel !== null && (
        <span className="-top-2 -left-2 absolute z-10 rounded-[var(--radius-sm)] bg-waiting px-1.5 font-bold font-mono text-[11px] text-canvas">
          {jumpLabel}
        </span>
      )}

      <div className="flex items-center gap-[7px]">
        <span
          className={[
            'flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px]',
            asking ? 'bg-waiting-tint text-waiting' : 'bg-line text-ink-dim',
          ].join(' ')}
        >
          <KindIcon kind={kind} />
        </span>
        <span
          className={[
            'truncate font-mono text-[9.5px] tracking-[0.07em]',
            asking ? 'text-waiting' : 'text-ink-dim',
          ].join(' ')}
        >
          {KIND_WORD[kind]} · {decision.label.toUpperCase()}
        </span>
        <span className="flex-1" />
        {/* The mockup shows a per-step duration here. black-smith times a
            session, not a step, so the slot stays and says it has nothing — an
            em dash the eye skips, rather than a number nobody measured. */}
        <span
          data-step-duration
          className={`flex-none font-mono text-[9.5px] ${asking ? 'text-waiting' : 'text-ink-ghost'}`}
        >
          {asking ? 'waiting' : '—'}
        </span>
      </div>

      <div className="flex gap-[7px]">
        <span className="w-[18px] flex-none pt-px font-mono text-[8.5px] text-ink-faint">IN</span>
        <span className="truncate text-[10.5px] text-ink-faint">{decision.input}</span>
      </div>
      <div className="flex gap-[7px]">
        <span className="w-[18px] flex-none pt-px font-mono text-[8.5px] text-ink-faint">OUT</span>
        <span className={`vam-clamp-2 text-[10.5px] ${asking ? 'text-ink' : 'text-ink-dim'}`}>
          {decision.output === null ? (
            <span className="text-ink-faint">— running —</span>
          ) : (
            decision.output
          )}
        </span>
      </div>

      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}
