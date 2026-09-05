/**
 * Which repos belong to a project -- the list a group's `+` opens.
 *
 * NOT A DIRECTORY PICKER, deliberately, and `repo.ts` supplies the reason in
 * its own words: listing what vam already knows is refused for CREATING a
 * project because "the only list vam could offer is the directories it
 * already has sessions in, which is exactly the set for which 'new project'
 * is the wrong control". For GROUPING that set is precisely the right one --
 * you can only group what exists -- so there is no directory dialog here, no
 * `.git` validation, and no IPC of any kind. It is prefs, and a list.
 *
 * Rendered as an overlay from `Canvas`, the way `IconPicker` is, and for the
 * same reason: it is wider than the sidebar it belongs to.
 */

import { Check, Folder } from 'lucide-react';
import { useEffect, useRef } from 'react';

/** One row: a project vam knows, and where it stands relative to this group. */
export type ProjectChoice = {
  readonly id: string;
  readonly name: string;
  /** Already in the group this picker is for. */
  readonly member: boolean;
  /**
   * The group it is in TODAY, or `null` for the top level -- including when
   * that group is this one, where `member` is the field that says so.
   *
   * Drawn, because a project belongs to at most one group and adding it here
   * MOVES it. Saying which group it is leaving before the click is the
   * difference between a move and a disappearance.
   */
  readonly groupName: string | null;
};

export type ProjectPickerProps = {
  /** The group being filled -- named, so you cannot pick for the wrong one. */
  readonly groupName: string;
  readonly choices: readonly ProjectChoice[];
  /** `member` is what the row will BECOME, not what it is. */
  readonly onToggle: (projectId: string, member: boolean) => void;
  readonly onClose: () => void;
};

export function ProjectPicker({ groupName, choices, onToggle, onClose }: ProjectPickerProps) {
  const shellRef = useRef<HTMLDivElement>(null);

  // Escape from inside the panel, which the window listener ignores along
  // with everything else that can hold a cursor. `IconPicker`'s pattern.
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

  // Members first -- what is in the group is what the panel is about -- then
  // the free ones, then the ones a click would take from somewhere else.
  const ordered = [
    ...choices.filter((choice) => choice.member),
    ...choices.filter((choice) => !choice.member && choice.groupName === null),
    ...choices.filter((choice) => !choice.member && choice.groupName !== null),
  ];

  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center pt-[12vh]">
      <button
        type="button"
        aria-label="close the repo list"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-canvas/70"
      />
      <div
        ref={shellRef}
        data-project-picker
        className="relative z-10 flex max-h-[380px] w-[340px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-panel shadow-[var(--shadow-node)]"
      >
        <div className="flex items-center gap-2 border-line border-b px-3 py-2">
          <span className="text-[11px] text-ink-faint">repos in</span>
          <span className="font-mono font-semibold text-[12px] text-ink">{groupName}</span>
        </div>
        {ordered.length === 0 ? (
          /* vam has no project to offer, and says which fact that is: there is
             nothing here because no session is running anywhere it can see,
             not because the list failed to load. */
          <p className="px-3 py-4 text-[11px] text-ink-faint">
            No repo to add — vam knows a repo by the sessions running in it.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5 overflow-y-auto p-1">
            {ordered.map((choice) => (
              <li key={choice.id}>
                <button
                  type="button"
                  data-project-choice={choice.id}
                  aria-pressed={choice.member}
                  onClick={() => onToggle(choice.id, !choice.member)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[11.5px] text-ink-dim hover:bg-raised hover:text-ink"
                >
                  <span className="flex h-[13px] w-[13px] flex-none items-center justify-center text-ink-faint">
                    {choice.member ? (
                      <Check size={12} strokeWidth={2} />
                    ) : (
                      <Folder size={11} strokeWidth={1.7} />
                    )}
                  </span>
                  <span className="truncate">{choice.name}</span>
                  {!choice.member && choice.groupName !== null && (
                    <span className="ml-auto truncate font-mono text-[9.5px] text-ink-faint">
                      in {choice.groupName}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
