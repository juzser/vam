/**
 * `Ctrl-K` (docs/design/canvas-layout.md §4).
 *
 * The design says "no real modes, a handful of vim chords plus a palette". The
 * palette is what keeps that promise affordable: everything reachable by a
 * chord has to be memorised, so anything that does not earn a chord lives here
 * and stays discoverable. cmdk is the same library orca uses for its own
 * QuickOpen and WorktreeJumpPalette (§4.1).
 *
 * It lists destinations, not just names: what is waiting on you sorts to the
 * top, because that is what the canvas is for.
 */

import { Command } from 'cmdk';
import type { SessionEntry } from '../domain/selectors.js';

export type PaletteProps = {
  readonly entries: readonly SessionEntry[];
  readonly onPick: (sessionId: string) => void;
  readonly onClose: () => void;
};

export function CommandPalette({ entries, onPick, onClose }: PaletteProps) {
  const waiting = entries.filter(({ session }) => session.status === 'waiting');
  const rest = entries.filter(({ session }) => session.status !== 'waiting');

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center pt-24">
      {/*
        The scrim is a real button, not a div with a click handler, because that
        is what it is: a control whose whole job is closing the palette. Written
        as a div it would be invisible to a screen reader and to the keyboard —
        exactly the users who most need the way out to be announced. The mouse
        path is a convenience over the real one, which is Escape.
      */}
      <button
        type="button"
        aria-label="close palette"
        className="absolute inset-0 cursor-default bg-canvas/70"
        onMouseDown={onClose}
      />
      <Command
        label="Command palette"
        className="relative w-[min(560px,90vw)] overflow-hidden rounded-md border border-line bg-surface"
        onKeyDown={(event) => {
          // The window listener ignores keys typed in an input, so Escape has
          // to be caught here or the overlay would have no keyboard way out —
          // which on a keyboard-first tool is a trap, not a rough edge.
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
        loop
      >
        <Command.Input
          autoFocus
          placeholder="go to session…"
          className="w-full border-line border-b bg-transparent px-3 py-2 text-ink outline-none placeholder:text-ink-faint"
        />
        <Command.List className="vam-no-scrollbar max-h-72 overflow-y-auto p-1">
          <Command.Empty className="px-3 py-4 text-ink-faint">No match</Command.Empty>

          {waiting.length > 0 && (
            <Command.Group heading="needs you" className="px-1 text-ink-faint text-xs">
              {waiting.map((entry) => (
                <PaletteRow key={entry.session.id} entry={entry} onPick={onPick} />
              ))}
            </Command.Group>
          )}

          <Command.Group heading="all sessions" className="px-1 text-ink-faint text-xs">
            {rest.map((entry) => (
              <PaletteRow key={entry.session.id} entry={entry} onPick={onPick} />
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}

function PaletteRow({
  entry,
  onPick,
}: {
  readonly entry: SessionEntry;
  readonly onPick: (sessionId: string) => void;
}) {
  const { project, session } = entry;
  return (
    <Command.Item
      // cmdk filters on this string, so it must carry everything a person might
      // type — the project name included, not just the session's own title.
      value={`${project.name} ${session.title} ${session.epic ?? ''} ${session.id}`}
      onSelect={() => onPick(session.id)}
      className="flex cursor-pointer items-baseline gap-2 rounded px-2 py-1 text-ink text-sm data-[selected=true]:bg-surface-raised"
    >
      <span className="text-ink-faint">{project.name}/</span>
      <span>{session.title}</span>
      {session.status === 'waiting' && <span className="text-waiting">⏸</span>}
      {session.runningAgents > 0 && (
        <span className="ml-auto text-running">●{session.runningAgents}</span>
      )}
    </Command.Item>
  );
}
