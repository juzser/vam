/**
 * Which folder ONE project belongs to -- the keyboard route's picker, `gm`.
 *
 * `ProjectPicker` is the inverse: it fills one group with many projects, and
 * is reached by clicking that group's own `+`. This is reached from the
 * project itself, with no group in view yet, so it lists every folder and
 * asks "which one" -- at most one, the same rule `addProjectToGroup` already
 * enforces in `prefs.ts`. "New folder…" is here too, because a project can be
 * the reason a folder gets made at all.
 *
 * Rendered as an overlay from `Canvas`, the way `ProjectPicker` and
 * `IconPicker` are, for the same reason: wider than the sidebar.
 */

import { Check, Folder } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type GroupPickerChoice = {
  readonly id: string;
  readonly name: string;
  /** Is the project already in this one? At most one choice can say yes. */
  readonly current: boolean;
};

export type GroupPickerProps = {
  /** The project being moved -- named, so you cannot move the wrong one. */
  readonly projectName: string;
  readonly choices: readonly GroupPickerChoice[];
  readonly onPick: (groupId: string) => void;
  /** "No folder" -- only ever offered when a choice is already current. */
  readonly onRemove: () => void;
  readonly onCreate: (name: string) => void;
  readonly onClose: () => void;
};

export function GroupPicker({
  projectName,
  choices,
  onPick,
  onRemove,
  onCreate,
  onClose,
}: GroupPickerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const grouped = choices.some((choice) => choice.current);

  // Escape from inside the panel, the same idiom `ProjectPicker`/`IconPicker`
  // use: the window listener ignores anything that can hold a cursor.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }
    const shell = shellRef.current;
    shell?.addEventListener('keydown', onKeyDown);
    return () => shell?.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const commitCreate = () => {
    const name = draftName.trim();
    if (name !== '') {
      onCreate(name);
    }
    setCreating(false);
    setDraftName('');
  };

  return (
    <div
      data-overlay-host
      className="absolute inset-0 z-30 flex items-start justify-center pt-[12vh]"
    >
      <button
        type="button"
        aria-label="close the folder list"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ground/70"
      />
      <div
        ref={shellRef}
        data-group-picker
        className="relative z-10 flex max-h-[380px] w-[280px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-panel shadow-[var(--shadow-node)]"
      >
        <div className="flex items-center gap-2 border-line border-b px-3 py-2">
          <span className="text-[11px] text-ink-faint">move</span>
          <span className="truncate font-mono font-semibold text-[12px] text-ink">
            {projectName}
          </span>
        </div>
        <ul className="flex flex-col gap-0.5 overflow-y-auto p-1">
          {grouped && (
            <li>
              <button
                type="button"
                data-group-choice="none"
                onClick={onRemove}
                className="flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-ink-dim hover:bg-raised hover:text-ink"
              >
                <span className="flex h-[13px] w-[13px] flex-none items-center justify-center text-ink-faint">
                  <Folder size={11} strokeWidth={1.7} />
                </span>
                <span className="truncate">no folder — top level</span>
              </button>
            </li>
          )}
          {choices.map((choice) => (
            <li key={choice.id}>
              <button
                type="button"
                data-group-choice={choice.id}
                aria-pressed={choice.current}
                onClick={() => onPick(choice.id)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-ink-dim hover:bg-raised hover:text-ink"
              >
                <span className="flex h-[13px] w-[13px] flex-none items-center justify-center text-ink-faint">
                  {choice.current ? (
                    <Check size={12} strokeWidth={2} />
                  ) : (
                    <Folder size={11} strokeWidth={1.7} />
                  )}
                </span>
                <span className="truncate">{choice.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="border-line border-t p-1">
          {creating ? (
            <input
              data-group-picker-draft
              value={draftName}
              placeholder="folder name"
              aria-label="new folder name"
              ref={(node) => {
                if (node !== null && document.activeElement !== node) {
                  node.focus();
                }
              }}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                  commitCreate();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setCreating(false);
                  setDraftName('');
                }
              }}
              onBlur={commitCreate}
              className="w-full rounded-[5px] border border-line-strong bg-panel px-1.5 py-1 font-mono text-[10.5px] text-ink outline-none"
            />
          ) : (
            <button
              type="button"
              data-new-folder
              onClick={() => setCreating(true)}
              className="w-full cursor-pointer rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-ink-quiet hover:bg-raised hover:text-ink"
            >
              + new folder…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
