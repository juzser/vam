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
import { Bot, CircleHelp, File, Play, User } from 'lucide-react';
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
    return <CircleHelp size={12} strokeWidth={1.6} aria-hidden="true" />;
  }
  if (kind === 'run') {
    return <Play size={12} strokeWidth={1.6} aria-hidden="true" />;
  }
  return <File size={12} strokeWidth={1.6} aria-hidden="true" />;
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
        // The glow says WHERE YOU ARE; the border says what this step needs.
        // Both can be true at once, so they stack rather than trade off: a
        // focused asking card wears the amber edge AND the cursor ring.
        focused ? 'vam-cursor-glow' : '',
        asking
          ? 'border border-waiting'
          : focused
            ? 'border border-line-loudest'
            : 'border border-line',
      ].join(' ')}
    >
      {entry.session.status === 'running' && entry.session.decisions[0]?.id === decision.id && (
        /* The mockup's travelling green hairline, on the CURRENT step only —
           `decisions[0]` is the newest, the same test `stepKind` uses. Without
           that clause every unanswered step in a running session would sweep.
           `aria-hidden`: it restates the kind word beside it. */
        <span className="vam-running-edge" aria-hidden="true" />
      )}
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
        <span
          role="img"
          aria-label="from you"
          className="flex w-[18px] flex-none justify-center pt-px text-ink-faint"
        >
          {/* The mockup draws these two rows with a person and a machine, not
              with direction arrows: the question the glance has to answer is
              WHO said it, and in/out only answers that by convention. The
              artboard's own glyphs are a head-and-shoulders and a robot head,
              which are lucide's `User` and `Bot`. */}
          <User size={11} strokeWidth={1.7} />
        </span>
        <span className="truncate text-[10.5px] text-ink-faint">{decision.input}</span>
      </div>
      <div className="flex gap-[7px]">
        <span
          role="img"
          aria-label="from the agent"
          className="flex w-[18px] flex-none justify-center pt-px text-ink-faint"
        >
          <Bot size={11} strokeWidth={1.7} />
        </span>
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
