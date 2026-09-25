// @vitest-environment happy-dom
/**
 * The extracted rename-draft hook, asserted through its own return value --
 * not through `SessionList`'s DOM. The cancel-does-not-commit case is the
 * differential one: it fails loudly if the two paths get merged during the
 * move that put this hook in its own module.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Group, Project } from '../../src/renderer/domain/model.js';
import { useSessionListDrafts } from '../../src/renderer/panels/session-list-drafts.js';

const project: Project = { id: 'atlas', name: 'Atlas', sessions: [] };
const group: Group = { id: 'g1', name: 'Group One', projects: [] };

function setup() {
  const onCreateGroup = vi.fn();
  const onRenameGroup = vi.fn();
  const onRenameProject = vi.fn();
  const { result } = renderHook(() =>
    useSessionListDrafts(onCreateGroup, onRenameGroup, onRenameProject),
  );
  return { result, onCreateGroup, onRenameGroup, onRenameProject };
}

describe('useSessionListDrafts', () => {
  it('starting a group rename seeds groupDraftName from the current name', () => {
    const { result } = setup();

    act(() => {
      result.current.setGroupDraftName(group.name);
      result.current.setGroupDraft({ kind: 'rename', group });
    });

    expect(result.current.groupDraftName).toBe(group.name);
    expect(result.current.groupDraft).toEqual({ kind: 'rename', group });
  });

  it('cancelGroupDraft clears the draft without invoking the commit callback', () => {
    const { result, onCreateGroup, onRenameGroup } = setup();

    act(() => {
      result.current.setGroupDraftName('New Name');
      result.current.setGroupDraft({ kind: 'new' });
    });
    act(() => result.current.cancelGroupDraft());

    expect(result.current.groupDraft).toBe(null);
    expect(result.current.groupDraftName).toBe('');
    expect(onCreateGroup).not.toHaveBeenCalled();
    expect(onRenameGroup).not.toHaveBeenCalled();
  });

  it('commitGroupDraft invokes the callback once with the trimmed name and then clears', () => {
    const { result, onCreateGroup } = setup();

    act(() => {
      result.current.setGroupDraftName('  New Group  ');
      result.current.setGroupDraft({ kind: 'new' });
    });
    act(() => result.current.commitGroupDraft());

    expect(onCreateGroup).toHaveBeenCalledTimes(1);
    expect(onCreateGroup).toHaveBeenCalledWith('New Group');
    expect(result.current.groupDraft).toBe(null);
    expect(result.current.groupDraftName).toBe('');
  });

  it('committing a group rename draft invokes onRenameGroup, not onCreateGroup', () => {
    const { result, onCreateGroup, onRenameGroup } = setup();

    act(() => {
      result.current.setGroupDraftName('  Renamed Group  ');
      result.current.setGroupDraft({ kind: 'rename', group });
    });
    act(() => result.current.commitGroupDraft());

    expect(onRenameGroup).toHaveBeenCalledTimes(1);
    expect(onRenameGroup).toHaveBeenCalledWith(group, 'Renamed Group');
    expect(onCreateGroup).not.toHaveBeenCalled();
    expect(result.current.groupDraft).toBe(null);
    expect(result.current.groupDraftName).toBe('');
  });

  it('committing an empty or whitespace-only group name creates nothing and renames nothing', () => {
    const { result, onCreateGroup, onRenameGroup } = setup();

    act(() => {
      result.current.setGroupDraftName('   ');
      result.current.setGroupDraft({ kind: 'new' });
    });
    act(() => result.current.commitGroupDraft());

    expect(onCreateGroup).not.toHaveBeenCalled();
    expect(onRenameGroup).not.toHaveBeenCalled();
    expect(result.current.groupDraft).toBe(null);
    expect(result.current.groupDraftName).toBe('');
  });

  it('starting a project rename seeds projectDraftName from the current name', () => {
    const { result } = setup();

    act(() => {
      result.current.setProjectDraftName(project.name);
      result.current.setProjectDraft(project);
    });

    expect(result.current.projectDraftName).toBe(project.name);
    expect(result.current.projectDraft).toBe(project);
  });

  it('cancelProjectDraft clears the draft without invoking the commit callback', () => {
    const { result, onRenameProject } = setup();

    act(() => {
      result.current.setProjectDraftName('New Project Name');
      result.current.setProjectDraft(project);
    });
    act(() => result.current.cancelProjectDraft());

    expect(result.current.projectDraft).toBe(null);
    expect(result.current.projectDraftName).toBe('');
    expect(onRenameProject).not.toHaveBeenCalled();
  });

  it('commitProjectDraft invokes the callback once with the trimmed name and then clears', () => {
    const { result, onRenameProject } = setup();

    act(() => {
      result.current.setProjectDraftName('  Renamed  ');
      result.current.setProjectDraft(project);
    });
    act(() => result.current.commitProjectDraft());

    expect(onRenameProject).toHaveBeenCalledTimes(1);
    expect(onRenameProject).toHaveBeenCalledWith(project, 'Renamed');
    expect(result.current.projectDraft).toBe(null);
    expect(result.current.projectDraftName).toBe('');
  });

  it('committing an empty project name still commits, unlike the group draft', () => {
    const { result, onRenameProject } = setup();

    act(() => {
      result.current.setProjectDraftName('   ');
      result.current.setProjectDraft(project);
    });
    act(() => result.current.commitProjectDraft());

    expect(onRenameProject).toHaveBeenCalledTimes(1);
    expect(onRenameProject).toHaveBeenCalledWith(project, '');
    expect(result.current.projectDraft).toBe(null);
    expect(result.current.projectDraftName).toBe('');
  });

  it('commitProjectDraft with no open draft is a no-op', () => {
    const { result, onRenameProject } = setup();

    act(() => result.current.commitProjectDraft());

    expect(onRenameProject).not.toHaveBeenCalled();
    expect(result.current.projectDraft).toBe(null);
    expect(result.current.projectDraftName).toBe('');
  });

  it('commitGroupDraft with no open draft is a no-op', () => {
    const { result, onCreateGroup, onRenameGroup } = setup();

    act(() => result.current.commitGroupDraft());

    expect(onCreateGroup).not.toHaveBeenCalled();
    expect(onRenameGroup).not.toHaveBeenCalled();
    expect(result.current.groupDraft).toBe(null);
    expect(result.current.groupDraftName).toBe('');
  });
});
