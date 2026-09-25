import { useCallback, useState } from 'react';
import type { Group, Project } from '../domain/model.js';

/**
 * The rename-draft state for `SessionList`'s group and project headings:
 * the four `useState` values and their four `useCallback` writers, moved
 * here as one self-contained cluster. Extracted from `SessionList` -- see
 * that file's history for the two clusters this cluster is entangled with
 * that stayed behind (collapse state, the row menu).
 */
export function useSessionListDrafts(
  onCreateGroup: ((name: string) => void) | undefined,
  onRenameGroup: ((group: Group, name: string) => void) | undefined,
  onRenameProject: ((project: Project, name: string) => void) | undefined,
) {
  /**
   * The one group name being typed, and what it is for: a group about to
   * exist, or one being renamed. ONE piece of state, because one editor is
   * open at a time and two would need a rule about which wins.
   *
   * The idiom is the session rename's, deliberately -- a row that turns into
   * a field, Enter commits, Escape cancels -- and NOT an overlay:
   * `ConfirmRemoveProject`'s header states vam's overlay idiom exists to make
   * a disclosure, and naming a group discloses nothing.
   */
  const [groupDraft, setGroupDraft] = useState<
    { readonly kind: 'new' } | { readonly kind: 'rename'; readonly group: Group } | null
  >(null);
  const [groupDraftName, setGroupDraftName] = useState('');

  /**
   * The project heading whose name is being edited, or null. Exactly
   * `groupDraft`'s `'rename'` case, one level down -- there is no `'new'`
   * case here, since a project heading is never created from this pane, only
   * derived from a live session's cwd.
   */
  const [projectDraft, setProjectDraft] = useState<Project | null>(null);
  const [projectDraftName, setProjectDraftName] = useState('');

  const cancelGroupDraft = useCallback(() => {
    setGroupDraft(null);
    setGroupDraftName('');
  }, []);

  /** An empty name creates nothing and renames nothing -- it just closes. */
  const commitGroupDraft = useCallback(() => {
    const name = groupDraftName.trim();
    if (groupDraft !== null && name !== '') {
      if (groupDraft.kind === 'new') {
        onCreateGroup?.(name);
      } else {
        onRenameGroup?.(groupDraft.group, name);
      }
    }
    setGroupDraft(null);
    setGroupDraftName('');
  }, [groupDraft, groupDraftName, onCreateGroup, onRenameGroup]);

  const cancelProjectDraft = useCallback(() => {
    setProjectDraft(null);
    setProjectDraftName('');
  }, []);

  /**
   * UNLIKE `commitGroupDraft`, an empty name still commits -- it is the undo,
   * not a no-op. A group has no name of its own to fall back to; a project
   * does, and `setProjectRename` already treats an empty title as "clear the
   * override", so the trimmed name is always handed onward.
   */
  const commitProjectDraft = useCallback(() => {
    if (projectDraft !== null) {
      onRenameProject?.(projectDraft, projectDraftName.trim());
    }
    setProjectDraft(null);
    setProjectDraftName('');
  }, [projectDraft, projectDraftName, onRenameProject]);

  return {
    groupDraft,
    setGroupDraft,
    groupDraftName,
    setGroupDraftName,
    projectDraft,
    setProjectDraft,
    projectDraftName,
    setProjectDraftName,
    cancelGroupDraft,
    commitGroupDraft,
    cancelProjectDraft,
    commitProjectDraft,
  };
}
