/**
 * The dashed frame around one project's rows.
 *
 * Not selectable and not a navigation target: `hjkl` walks sessions and steps,
 * and a focusable frame would put a stop on every journey down the canvas that
 * nobody asked for. The layout keeps it out of the navigable set entirely, so
 * this is only the drawing.
 *
 * Shape follows nodeterm's `.group-node` (§1.1): a dashed frame at the larger
 * radius, with a floating label pill **straddling the top border** rather than a
 * header row inside the box. Dashed does real work here — it says "this is a
 * frame around things", not "this is a thing", which is exactly the distinction
 * between a project and the sessions in it.
 *
 * No fill, and that is the same argument carried one step further. A tinted
 * panel behind the rows is a surface, and a surface reads as a thing you are
 * looking AT rather than a line drawn AROUND things — it also puts a second
 * elevation under cards that already have one, which is what made the rows look
 * sunken into the frame. What is left is the border, generous padding, and a
 * label quiet enough to be read after the sessions rather than before them.
 */

import type { NodeProps } from '@xyflow/react';
import type { Project } from '../domain/model.js';

/** Where a project's data comes from. Two sources, two dots — no new palette. */
const SOURCE_DOT: Readonly<Record<Project['source'], string>> = {
  'black-smith': 'var(--color-running)',
  orca: 'var(--color-done)',
};

export type ProjectGroupNodeData = {
  readonly project: Project;
  /** How many of its sessions are waiting on a person. */
  readonly waiting: number;
};

export function ProjectGroupNode({ data }: NodeProps & { data: ProjectGroupNodeData }) {
  const { project, waiting } = data;
  const running = project.sessions.filter((s) => s.status === 'running').length;

  return (
    <div
      // One grey, always, and a hairline rather than 1.5px. The frame said
      // "someone in here needs you" by turning amber, which put the loudest
      // colour on the canvas around the largest shape on it — the call comes
      // from one card and the whole enclosure was answering. The cards keep
      // that job; the frame goes back to being scenery.
      className="h-full w-full rounded-[var(--radius-xl)] border border-dashed border-line"
    >
      <span className="vam-group-label">
        <span
          className="size-[7px] shrink-0 rounded-full"
          style={{ background: SOURCE_DOT[project.source] }}
        />
        <span className="font-mono text-[11px] text-ink-dim">{project.name}</span>
        <span className="text-[10px] text-ink-faint">
          {project.sessions.length} session{project.sessions.length === 1 ? '' : 's'}
        </span>
        {/* Only the count that asks for something is repeated on the frame. A
            frame that summarised every status would be a second dashboard
            competing with the cards inside it. */}
        {waiting > 0 && <span className="vam-breathe text-[10px] text-waiting">⏸ {waiting}</span>}
        {running > 0 && <span className="text-[10px] text-running">◐ {running}</span>}
      </span>
    </div>
  );
}
