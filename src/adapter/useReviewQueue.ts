/**
 * The focused session's review queue, loaded on demand.
 *
 * Scoped to ONE session on purpose. The waiver half costs `1 + N` requests —
 * a kanban call to find the session's tasks, then one per task for its findings
 * — and doing that for every row on every poll would turn a four-second tick
 * into a small stampede. You can only answer the session you are looking at, so
 * that is the only one this fetches.
 *
 * It is also the reason this is separate from `useCanvas`: the canvas has to
 * keep ticking for every session, and the queue has to reload the instant the
 * focus moves or an answer lands. Two different rhythms, two hooks.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiFinding, ApiLesson } from './api.js';
import type { SmithClient } from './client.js';
import { lessonQueue, waiverCandidates, waiverQueue } from './review-queue.js';

export type ReviewQueue = {
  readonly waivers: readonly ApiFinding[];
  readonly lessons: readonly ApiLesson[];
  /**
   * How many waivable findings this session has that the queue could not show.
   *
   * The queue reaches findings only through tasks — kanban for the session's
   * task ids, then one call per task — so a finding whose task has no row on
   * this session's board is invisible to it. That happens for real: an epic
   * split across sessions raises findings in the new session against tasks
   * added by the old one, which is a documented way to run black-smith, not an
   * edge case.
   *
   * black-smith's own `alerts.pendingWaivers` counts the same predicate
   * straight off the findings table, so the difference is exactly what is
   * hidden. A queue that is short and says nothing reads as "you are done",
   * which is the one wrong thing it could say.
   *
   * Zero when the counts agree, and never negative — vam can also see MORE
   * than the session's own count, because `/api/tasks/:id` returns a task's
   * findings whatever session raised them.
   */
  readonly hidden: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly reload: () => void;
};

const NONE: ReviewQueue = {
  waivers: [],
  lessons: [],
  hidden: 0,
  loading: false,
  error: null,
  reload: () => {},
};

export function useReviewQueue(client: SmithClient | null, sessionId: string | null): ReviewQueue {
  const [waivers, setWaivers] = useState<readonly ApiFinding[]>([]);
  const [lessons, setLessons] = useState<readonly ApiLesson[]>([]);
  const [hidden, setHidden] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (client === null || sessionId === null) {
      setWaivers([]);
      setLessons([]);
      return;
    }
    const mine = ++generation.current;
    setLoading(true);
    try {
      const [taskIds, lessonsResult, scoped] = await Promise.all([
        client.taskIds(sessionId),
        client.lessons(sessionId),
        client.overview(sessionId),
      ]);
      const details = await Promise.all(taskIds.map((taskId) => client.taskDetail(taskId)));
      if (mine !== generation.current) {
        return;
      }
      const found = details.flatMap((detail) => detail.findings);
      setWaivers(waiverQueue(found));
      setLessons(lessonQueue(lessonsResult.pending, sessionId));
      // Counted against the findings, not the queue: the queue has already
      // collapsed a repeated defect into one row, and pendingWaivers has not.
      setHidden(Math.max(0, scoped.alerts.pendingWaivers - waiverCandidates(found).length));
      setError(null);
    } catch (cause) {
      if (mine !== generation.current) {
        return;
      }
      // The queue failing must not blank the queue: an empty list reads as
      // "nothing to answer", which is the opposite of what a failed read means.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mine === generation.current) {
        setLoading(false);
      }
    }
  }, [client, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return client === null || sessionId === null
    ? NONE
    : { waivers, lessons, hidden, loading, error, reload };
}
