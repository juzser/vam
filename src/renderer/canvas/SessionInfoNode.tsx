/**
 * The head of a session's chain: who this session is, and whether it needs you.
 *
 * Two signals sit on the card's edge and they answer different questions. The
 * amber border says `waiting` — every other state is a report, this one is a
 * request, and a request that reads like a report is one that sits unanswered.
 * The achromatic halo (`vam-cursor-glow`) says nothing about the session at
 * all: it is where the keyboard is. They stack rather than compete, so a
 * focused needs-you card keeps its amber edge and gains the ring.
 *
 * A `running` session also gets the mockup's travelling hairline along its top
 * edge — motion for the one state that is still changing while you look at it.
 *
 * ## What is real here and what is a slot
 *
 * The ADE mockup's card carries six facts. black-smith can answer four of them
 * (status, title, repo, step count) and cannot answer two: which worktree the
 * session is running in, and what it has spent. Those keep their line and say
 * `—`, because a card that silently drops a row it cannot fill teaches you the
 * row does not exist. Both are in the todo.
 */

import { Handle, type NodeProps, Position } from '@xyflow/react';
import { GitBranch } from 'lucide-react';
import type { Session, SessionStatus } from '../domain/model.js';
import type { SessionEntry } from '../domain/selectors.js';

const STATUS_INK: Readonly<Record<SessionStatus, string>> = {
  running: 'text-running',
  waiting: 'text-waiting',
  done: 'text-done',
  failed: 'text-failed',
};

const STATUS_DOT: Readonly<Record<SessionStatus, string>> = {
  running: 'bg-running',
  waiting: 'bg-waiting',
  done: 'bg-done',
  failed: 'bg-failed',
};

/** The mockup's own words, and its own emphasis: only one of these shouts. */
const STATUS_WORD: Readonly<Record<SessionStatus, string>> = {
  running: 'RUNNING',
  waiting: 'NEEDS YOU',
  done: 'DONE',
  failed: 'FAILED',
};

const STATUS_FILL: Readonly<Record<SessionStatus, string>> = {
  running: 'bg-running',
  waiting: 'bg-waiting',
  done: 'bg-done',
  failed: 'bg-failed',
};

export type SessionInfoNodeData = {
  readonly entry: SessionEntry;
  readonly focused: boolean;
  readonly jumpLabel: string | null;
};

/**
 * How far along the bar reads.
 *
 * A finished session is full and a queued one is empty; everything between is
 * the share of its turns that have an answer. That is a real ratio off real
 * data — not a guess dressed as one — and it is the only progress black-smith
 * can support, since nothing declares how many steps a session will take.
 */
export function progressOf(session: Session): number {
  if (session.status === 'done') {
    return 1;
  }
  if (session.decisions.length === 0) {
    return 0;
  }
  const answered = session.decisions.filter((d) => d.output !== null).length;
  return answered / session.decisions.length;
}

export function SessionInfoNode({ data }: NodeProps & { data: SessionInfoNodeData }) {
  const { entry, focused, jumpLabel } = data;
  const session: Session = entry.session;
  const waiting = session.status === 'waiting';
  const pct = Math.round(progressOf(session) * 100);

  return (
    <div
      data-session-card={session.id}
      className={[
        'relative flex h-full w-full flex-col gap-2 overflow-hidden rounded-[var(--radius-lg)]',
        'bg-panel p-3 shadow-[var(--shadow-node)]',
        // The glow says WHERE YOU ARE; the border says what this session needs.
        // They stack, so a focused needs-you card keeps its amber edge and
        // gains the ring, rather than trading one signal for the other.
        focused ? 'vam-cursor-glow' : '',
        // One border for every card, whatever its status. The amber halo is
        // the only thing that marks a card out now, and it marks exactly one:
        // the cursor. A second coloured edge would compete with it for the
        // same glance.
        'border border-line',
      ].join(' ')}
    >
      {session.status === 'running' && (
        /* The mockup's travelling green hairline, flush with the top edge.
           `aria-hidden`: it restates the status word two rows below. */
        <span className="vam-running-edge" aria-hidden="true" />
      )}
      {jumpLabel !== null && (
        <span className="-top-2 -left-2 absolute z-10 rounded-[var(--radius-sm)] bg-waiting px-1.5 font-bold font-mono text-[11px] text-canvas">
          {jumpLabel}
        </span>
      )}

      <div className="flex items-center gap-1.5">
        <span
          className={[
            'h-1.5 w-1.5 flex-none rounded-full',
            STATUS_DOT[session.status],
            waiting ? 'vam-breathe' : '',
          ].join(' ')}
        />
        <span className={`font-mono text-[9px] tracking-[0.11em] ${STATUS_INK[session.status]}`}>
          {STATUS_WORD[session.status]}
        </span>
        <span className="flex-1" />
        {focused && (
          /* An indicator, not a label — it gives the title back the width the
             FOCUSED tag was using.

             `role="img"` is load-bearing, not decoration: a bare <span> has no
             implicit role, and `aria-label` on a roleless element is IGNORED,
             so the first version of this silently dropped the word for screen
             readers while looking correct. biome's
             `useAriaPropsSupportedByRole` caught it. With the role, the label
             is announced and the word survives the change. */
          <span
            data-focus-indicator
            role="img"
            aria-label="focused"
            className="vam-focus-glow h-[7px] w-[7px] flex-none rounded-full bg-running"
          />
        )}
      </div>

      <div className="flex items-start gap-1.5">
        {session.icon !== null && <span className="text-[13px] leading-tight">{session.icon}</span>}
        <span className="vam-clamp-2 font-medium text-[13.5px] text-ink leading-[1.32]">
          {session.title}
        </span>
      </div>

      <div className="flex flex-col gap-1 font-mono text-[10px] text-ink-faint">
        <span className="truncate text-ink-dim">{entry.project.name}</span>
        <span className="flex items-center gap-1.5">
          <GitBranch size={11} strokeWidth={1.6} aria-hidden="true" />
          {/* black-smith does not report a worktree per session. */}
          <span data-session-worktree className="truncate text-ink-ghost">
            {session.epic ?? '—'}
          </span>
        </span>
        <span className="truncate">
          {session.runningAgents > 0 ? `${session.runningAgents} agents` : 'no agent running'}
        </span>
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-1.5">
        <div className="h-0.5 overflow-hidden rounded-sm bg-line-strong">
          <div className={`h-full ${STATUS_FILL[session.status]}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="flex min-w-0 gap-2 font-mono text-[9.5px] text-ink-faint">
          <span className="flex-none">{session.decisions.length} steps</span>
          <span className="flex-1" />
          {/* Tokens and spend per session are not in black-smith's overview, so
              this cell carries `activity` -- the newest tool call, which is
              text an agent wrote and therefore has no length vam controls. It
              broke the node's width until it was made to give way: `min-w-0`
              on the row is what lets a flex child shrink below its content at
              all, and `truncate` is what makes it ellipsis instead of pushing.
              The step count is `flex-none` because it is short, bounded, and
              the half of this line worth keeping whole. */}
          <span data-session-spend className="min-w-0 truncate text-ink-ghost">
            {session.activity ?? '—'}
          </span>
        </div>
      </div>

      {/* The chain leaves rightwards. No target handle: nothing points at a
          session head, it is where a row starts. */}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}
