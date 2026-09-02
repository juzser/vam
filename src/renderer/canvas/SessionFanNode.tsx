/**
 * The fan — the connector between a session card and its three step slots.
 *
 * epic.md §5.2 chose this as ONE scenery node over a custom ReactFlow edge
 * type: the reason the edge existed (dragged nodes needing live coordinates)
 * was removed when drag was dropped (§5.8), and a single node that draws the
 * mockup's single `<svg>` is the literal transcription of §3.3 rather than a
 * reconstruction of it from three overlapping edges.
 *
 * This component reads nothing but its props: no domain model, no layout, no
 * ReactFlow graph. `Canvas.tsx` (task-6) computes `sessionStatus`,
 * `branchStatuses` and `totalSteps` and hands them over.
 */

/** The four statuses a colour exists for on the canvas. */
export type SessionFanStatus = 'waiting' | 'running' | 'done' | 'failed';

/**
 * A branch's colour comes from its own step, not the session's — §3.4 fact 2.
 * `'empty'` covers a slot with no step drawn in it yet: still a branch (the
 * fan always has three, §3.5), just uncoloured by any status.
 */
export type SessionFanBranchStatus = SessionFanStatus | 'empty';

export type SessionFanNodeData = {
  readonly sessionStatus: SessionFanStatus;
  readonly branchStatuses: readonly [
    SessionFanBranchStatus,
    SessionFanBranchStatus,
    SessionFanBranchStatus,
  ];
  /** `session.decisions.length` — NOT the number of branches or cards drawn. */
  readonly totalSteps: number;
};

/**
 * Trunk/spine/branch colour, per the operator's canvas colour rule (epic.md
 * §13.4): colour is reserved for what needs a person. `waiting` and `failed`
 * carry their status colour because both need a person; `running` and `done`
 * carry neutral line tones — `running` the new `--color-line-loudest`,
 * `done` the existing `--color-line-loud` (accepted with its measured
 * five-unit light drift rather than minting a second near-identical neutral).
 */
const TRUNK_COLOR: Readonly<Record<SessionFanStatus, string>> = {
  waiting: 'var(--color-waiting)',
  running: 'var(--color-line-loudest)',
  done: 'var(--color-line-loud)',
  failed: 'var(--color-failed)',
};

/**
 * Pill number colour. Same rule as the trunk: `waiting`/`failed` carry their
 * status colour, `running`/`done` fall to the neutral `--color-ink-dim`.
 */
const NUMBER_COLOR: Readonly<Record<SessionFanStatus, string>> = {
  waiting: 'var(--color-waiting)',
  running: 'var(--color-ink-dim)',
  done: 'var(--color-ink-dim)',
  failed: 'var(--color-failed)',
};

const EMPTY_BRANCH_COLOR = 'var(--color-line-strong)';

function branchColor(status: SessionFanBranchStatus): string {
  return status === 'empty' ? EMPTY_BRANCH_COLOR : TRUNK_COLOR[status];
}

export type SessionFanNodeProps = {
  readonly id: string;
  readonly data: SessionFanNodeData;
};

/**
 * Registered under `Canvas.tsx`'s `nodeTypes` (task-6). Its prop shape is
 * kept to what this scenery node actually reads — `id` and `data` — rather
 * than ReactFlow's full `NodeProps`, whose `selected`/`dragging`/`zIndex`
 * fields this node has no use for and never reads.
 */
export function SessionFanNode({ data }: SessionFanNodeProps) {
  const trunkColor = TRUNK_COLOR[data.sessionStatus];
  const numberColor = NUMBER_COLOR[data.sessionStatus];

  return (
    <div style={{ position: 'relative', width: '110px', height: '290px' }}>
      <svg
        viewBox="0 0 110 290"
        width="110"
        height="290"
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
        aria-hidden="true"
      >
        <path d="M0 145 H45" stroke={trunkColor} strokeWidth="1.25" opacity="0.7" fill="none" />
        <path d="M45 45 V245" stroke={trunkColor} strokeWidth="1.25" opacity="0.45" fill="none" />
        <path
          d="M45 45 H110"
          stroke={branchColor(data.branchStatuses[0])}
          strokeWidth="1.25"
          fill="none"
        />
        <path
          d="M45 145 H110"
          stroke={branchColor(data.branchStatuses[1])}
          strokeWidth="1.25"
          fill="none"
        />
        <path
          d="M45 245 H110"
          stroke={branchColor(data.branchStatuses[2])}
          strokeWidth="1.25"
          fill="none"
        />
      </svg>
      <div
        data-fan-pill
        style={{
          position: 'absolute',
          left: '16px',
          top: '135px',
          width: '58px',
          height: '20px',
          borderRadius: '999px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-canvas)',
          font: 'inherit',
        }}
      >
        {/* Two-tone per the mockup: the number carries the session's status
            colour (per the canvas colour rule, not necessarily the trunk's —
            `running`/`done` dim to --color-ink-dim on the number while the
            trunk reads a line tone), the word `steps` stays the fixed
            neutral it is in all twelve mockup pills. */}
        <span style={{ color: numberColor }}>{data.totalSteps}</span>
        <span style={{ color: 'var(--color-ink-faint)' }}> steps</span>
      </div>
    </div>
  );
}
