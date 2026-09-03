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
export type SessionFanBranchStatus = SessionFanStatus | 'empty' | 'idle';

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

/**
 * The mockup fades the one coloured branch to 0.7 exactly as it fades the
 * trunk, and draws the plain ones at full strength — the neutral tone is
 * already quiet enough that fading it would erase it.
 */
function branchOpacity(status: SessionFanBranchStatus): string {
  return status === 'empty' || status === 'idle' ? '1' : '0.7';
}

function branchColor(status: SessionFanBranchStatus): string {
  if (status === 'empty') {
    return EMPTY_BRANCH_COLOR;
  }
  // `idle` is a real step that simply is not the one in play. The mockup draws
  // those in a plain line tone and reserves colour for the single route to the
  // current step, so a glance answers "where is it" and not merely "what is
  // its status", which the card already says in words.
  if (status === 'idle') {
    return 'var(--color-line-strong)';
  }
  return TRUNK_COLOR[status];
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
          opacity={branchOpacity(data.branchStatuses[0])}
          fill="none"
        />
        <path
          d="M45 145 H110"
          stroke={branchColor(data.branchStatuses[1])}
          strokeWidth="1.25"
          opacity={branchOpacity(data.branchStatuses[1])}
          fill="none"
        />
        <path
          d="M45 245 H110"
          stroke={branchColor(data.branchStatuses[2])}
          strokeWidth="1.25"
          opacity={branchOpacity(data.branchStatuses[2])}
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
          // The mockup's pill is outlined, and the outline is what separates it
          // from the connector it sits on. `--color-waiting-tint` already
          // resolves to exactly the value artboard 1a uses, in both themes —
          // an existing token, not a new colour.
          // Longhand, not the `border` shorthand: a shorthand carrying a
          // `var()` is re-serialised wrongly by more than one DOM
          // implementation (happy-dom spreads the token across width, style
          // AND colour), and the three longhands survive everywhere.
          borderWidth: '1px',
          borderStyle: 'solid',
          borderColor: 'var(--color-waiting-tint)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-canvas)',
          // The mockup's own type scale for this pill. It previously inherited
          // the node's font, which made it far larger and heavier than the
          // connector it labels.
          fontFamily: 'var(--font-mono)',
          fontSize: '9.5px',
        }}
      >
        {/* Two-tone per the mockup: the number carries the session's status
            colour (per the canvas colour rule, not necessarily the trunk's —
            `running`/`done` dim to --color-ink-dim on the number while the
            trunk reads a line tone), the word `steps` stays the fixed
            neutral it is in all twelve mockup pills. */}
        {/* Both spans live inside ONE flex item on purpose. The space between
            them is a plain text node, and a flex container DISCARDS a
            whitespace-only text node between two items — which is why the
            space written here never rendered and the pill read `47steps`. The
            mockup solves the same problem with `gap:3px`; wrapping solves it
            without splitting `47 steps` into two unrelated strings, so the
            pill still reads as one phrase to a screen reader and to a test. */}
        <span>
          <span data-fan-pill-count style={{ color: numberColor }}>
            {data.totalSteps}
          </span>{' '}
          <span data-fan-pill-word style={{ color: 'var(--color-ink-faint)' }}>
            steps
          </span>
        </span>
      </div>
    </div>
  );
}
