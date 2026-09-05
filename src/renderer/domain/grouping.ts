/**
 * Resolving the stored group layer against the live model.
 *
 * The one place that turns `Prefs.groups` -- member IDS, written by a person,
 * outliving every session -- into `CanvasModel.groups`, which carries the
 * `Project` objects the current poll actually produced. Pure: no React, no
 * storage, no fetching, and it never edits what it was handed.
 *
 * WHY IT LIVES BESIDE THE MODEL AND READS A PREFS TYPE. `StoredGroup` is the
 * shape already on the operator's disk and there must be exactly one
 * definition of it; `prefs.ts` imports `model.ts` and not this file, so
 * reading it here adds no cycle. See the vocabulary table in `model.ts`
 * before renaming anything: the code's `Group` is the UI's "project".
 */

import type { StoredGroup } from '../prefs/prefs.js';
import type { CanvasModel, Group, Project } from './model.js';

/** `Prefs.groups`: source id → the groups the operator made in that source. */
export type StoredGroupsBySource = Readonly<Record<string, readonly StoredGroup[]>>;

/** Which source a group is stored under, or `null` for an id nothing holds. */
export function groupSource(stored: StoredGroupsBySource, groupId: string): string | null {
  for (const [source, groups] of Object.entries(stored)) {
    if (groups.some((group) => group.id === groupId)) {
      return source;
    }
  }
  return null;
}

/**
 * The model with its groups resolved: `projects` narrowed to the ones in no
 * group, `groups` carrying the members that are live right now.
 *
 * WITH NOTHING STORED IT RETURNS THE VERY SAME OBJECT, and that identity is
 * the property the whole layer is allowed to ship on: every store in
 * existence has no groups, so an operator who has made none is handed the
 * model they would have been handed before this file existed -- the same
 * reference, so the layout memo downstream does not even recompute.
 *
 * A stored member id matching no live project is SKIPPED, never dropped: the
 * store is a decision a person made, and a project whose last session ended
 * rejoins its group the next time one starts there. Membership is matched
 * within the group's own source, because a project id is unique only there.
 */
export function composeGroups(model: CanvasModel, stored: StoredGroupsBySource): CanvasModel {
  const records: { readonly source: string; readonly group: StoredGroup }[] = [];
  for (const [source, groups] of Object.entries(stored)) {
    for (const group of groups) {
      records.push({ source, group });
    }
  }
  if (records.length === 0) {
    return model;
  }

  const claimed = new Set<Project>();
  const groups: Group[] = records.map(({ source, group }) => {
    const members: Project[] = [];
    for (const memberId of group.projects) {
      const project = model.projects.find(
        (candidate) => candidate.id === memberId && candidate.source === source,
      );
      if (project !== undefined && !claimed.has(project)) {
        claimed.add(project);
        members.push(project);
      }
    }
    return { id: group.id, name: group.name, icon: group.icon ?? null, projects: members };
  });

  return {
    ...model,
    projects: model.projects.filter((project) => !claimed.has(project)),
    groups,
  };
}
