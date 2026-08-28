/**
 * One step in a session's chain — a strict summary, nothing more.
 *
 * It shows the label and two clamped lines each of `in` and `out`. That is a
 * deliberate ceiling, not a limitation to be lifted later: the detail panel to
 * the right of the canvas shows the focused step in full, so anything this card
 * grew would be a second, worse copy of that. The canvas answers "where is this
 * session up to"; the panel answers "what exactly did it say".
 *
 * `in` and `out` are tinted apart (cyan / violet) because they answer different
 * questions — whose words are these, mine or the session's — and at a glance
 * across a row of cards that distinction is the one doing the work.
 *
 * `in` is the louder of the two, in both hue and ink. Scanning a column of these
 * cards, the question you are answering is "which session was I asking what" —
 * and the session's reply is already open in full in the panel to the right, so
 * the card does not need to compete with it.
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

export function StepNode({ data }: NodeProps & { data: StepNodeData }) {
  const { entry, decision, focused, jumpLabel } = data;
  // No answer yet means the session is working, which asks nothing of you.
  const working = decision.output === null;
  // What asks something of you is the newest turn of a session that has stopped.
  const needsYou =
    entry.session.status === 'waiting' && entry.session.decisions[0]?.id === decision.id;

  return (
    <div
      className={[
        'relative flex h-full w-full flex-col overflow-hidden rounded-[var(--radius-md)]',
        'border bg-panel px-2 py-1.5 shadow-[var(--shadow-node)]',
        focused ? 'border-running' : 'border-line',
        needsYou ? 'vam-call' : '',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0" />

      {jumpLabel !== null && (
        <span className="-top-2 -left-2 absolute z-10 rounded-[var(--radius-sm)] bg-waiting px-1.5 font-bold font-mono text-[11px] text-canvas">
          {jumpLabel}
        </span>
      )}

      <div className="flex h-[16px] items-baseline gap-1.5">
        <span className="truncate font-semibold text-[11.5px] text-ink">{decision.label}</span>
        {needsYou && <span className="vam-breathe ml-auto text-[11px] text-waiting">⏸</span>}
        {working && !needsYou && (
          <span className="vam-spin ml-auto text-[11px] text-running">◐</span>
        )}
      </div>

      <div className="vam-clamp-2 mt-1 font-mono text-[11px] text-ink">
        <span className="font-semibold text-in">in </span>
        {decision.input}
      </div>
      {/* A real gap, not a line break. Two clamped blocks butted together read as
          one four-line paragraph, which is the one thing they must not — the
          whole point is that the first half is yours and the second is not. */}
      <div className="vam-clamp-2 mt-2.5 font-mono text-[11px] text-ink-dim">
        <span className="font-semibold text-out">out </span>
        {decision.output === null ? (
          // The session is mid-answer. Saying so is not the same as saying it
          // needs you — the halo and the ⏸ are reserved for when it does.
          <span className="text-ink-faint">— đang chạy —</span>
        ) : (
          decision.output
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}
