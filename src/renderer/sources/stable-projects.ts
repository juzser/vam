/**
 * A stable comparison key for `useSourceModel`'s unchanged-streak backoff.
 *
 * `JSON.stringify(projects)` alone never reads as "unchanged": main stamps
 * `Session.cacheSourceNowMs` with the current poll time on every load that
 * has cache activity (`main/sources/claude-code/source.ts`), and
 * `Session.age` is a display string recomputed from that same clock every
 * poll. Both change on every single load even when nothing else does, so
 * the backoff this key feeds could never engage for an idle session. This
 * function strips exactly those two fields before serialising -- nothing
 * else -- so the key reads two loads as equal exactly when nothing a person
 * would call "changed" changed.
 *
 * A pure function of `projects`: the model handed to `setModel` for display
 * is the full, untouched array `source.load()` returned.
 */

import type { Project, Session } from '../domain/model.js';

function sessionWithoutObservationClocks(session: Session): Omit<Session, 'age' | 'cacheSourceNowMs'> {
  const { age: _age, cacheSourceNowMs: _cacheSourceNowMs, ...rest } = session;
  return rest;
}

export function stableProjectsKey(projects: readonly Project[]): string {
  return JSON.stringify(
    projects.map((project) => ({
      ...project,
      sessions: project.sessions.map(sessionWithoutObservationClocks),
    })),
  );
}
