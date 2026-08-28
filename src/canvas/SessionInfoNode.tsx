/**
 * The head of a session's chain: who this session is, and whether it needs you.
 *
 * It carries the repo name itself rather than sitting inside a project frame.
 * The sidebar is a flat list of sessions, so a group box would be a third place
 * saying the same thing and the first to drift out of step with the other two.
 *
 * `waiting` gets a treatment nothing else on the canvas gets — an outward halo
 * (`vam-call`) rather than one more status hue. Every other state is a report;
 * this one is a request, and a request that reads like a report is one that sits
 * unanswered.
 */

import { Handle, type NodeProps, Position } from '@xyflow/react';
import type { Session, SessionStatus } from '../domain/model.js';
import type { SessionEntry } from '../domain/selectors.js';

const STATUS_EDGE: Readonly<Record<SessionStatus, string>> = {
  running: 'var(--color-running)',
  waiting: 'var(--color-waiting)',
  done: 'var(--color-done)',
  failed: 'var(--color-failed)',
};

const STATUS_INK: Readonly<Record<SessionStatus, string>> = {
  running: 'text-running',
  waiting: 'text-waiting',
  done: 'text-done',
  failed: 'text-failed',
};

const STATUS_WORD: Readonly<Record<SessionStatus, string>> = {
  running: 'đang chạy',
  waiting: 'chờ bạn',
  done: 'xong',
  failed: 'hỏng',
};

const STATUS_GLYPH: Readonly<Record<SessionStatus, string>> = {
  running: '◐',
  waiting: '⏸',
  done: '✓',
  failed: '✕',
};

export type SessionInfoNodeData = {
  readonly entry: SessionEntry;
  readonly focused: boolean;
  readonly jumpLabel: string | null;
};

export function SessionInfoNode({ data }: NodeProps & { data: SessionInfoNodeData }) {
  const { entry, focused, jumpLabel } = data;
  const session: Session = entry.session;
  const waiting = session.status === 'waiting';

  return (
    <div
      className={[
        'relative flex h-full w-full flex-col overflow-hidden rounded-[var(--radius-lg)]',
        'border border-line bg-panel px-2.5 py-2 shadow-[var(--shadow-node)]',
        focused ? 'border-running' : '',
        waiting ? 'vam-call' : '',
      ].join(' ')}
      style={{
        borderTopWidth: 3,
        borderTopColor: focused ? 'var(--color-running)' : STATUS_EDGE[session.status],
      }}
    >
      {session.status === 'running' && <span className="vam-running-edge" />}

      {jumpLabel !== null && (
        <span className="-top-2 -left-2 absolute z-10 rounded-[var(--radius-sm)] bg-waiting px-1.5 font-bold font-mono text-[11px] text-canvas">
          {jumpLabel}
        </span>
      )}

      <div className="flex items-baseline gap-2">
        {session.icon !== null && <span className="text-[12px] leading-none">{session.icon}</span>}
        <span className="truncate font-mono font-semibold text-[13px] text-ink">
          {session.title}
        </span>
        {session.runningAgents > 0 && (
          <span className="ml-auto text-[11px] text-running">●{session.runningAgents}</span>
        )}
      </div>

      <div className="truncate text-[11px] text-ink-faint">{entry.project.name}</div>

      <div className="mt-auto flex items-center gap-1.5">
        <span
          className={[
            STATUS_INK[session.status],
            'text-[11px]',
            session.status === 'running' ? 'vam-spin' : '',
            waiting ? 'vam-breathe' : '',
          ].join(' ')}
        >
          {STATUS_GLYPH[session.status]}
        </span>
        <span className={`text-[11px] ${waiting ? 'font-semibold text-waiting' : 'text-ink-dim'}`}>
          {STATUS_WORD[session.status]}
        </span>
        {session.epic !== null && (
          <span className="ml-auto truncate text-[10px] text-ink-faint">{session.epic}</span>
        )}
      </div>

      {/* `null` means the source cannot say yet (§5 epic B) — render nothing
          rather than an empty spinner implying liveness. */}
      {session.activity !== null && (
        <div className="truncate pt-0.5 text-[10px] text-ink-faint">{session.activity}</div>
      )}

      {/* The chain leaves rightwards. No target handle: nothing points at a
          session head, it is where a row starts. */}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}
