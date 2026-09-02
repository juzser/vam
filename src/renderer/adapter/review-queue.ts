/**
 * What the factory is actually waiting on a person for.
 *
 * This is the other half of "a decision waiting for a person" (§2), and the
 * half black-smith already accepts writes for. A prompt is you starting
 * something; these are the factory stopping and asking. Two kinds:
 *
 *  - **waivers** — an S3/S4 finding nobody has answered. Grant it and the
 *    defect is accepted on the record with your reason; deny it and it goes
 *    back to be fixed.
 *  - **lesson candidates** — a statement the scribe distilled, waiting to be
 *    approved into the corpus that gets spliced into every future dispatch.
 *
 * The picking rules live here, pure, because both are easy to get subtly wrong
 * in ways that are invisible until someone waives the wrong thing.
 */

import type { ApiFinding, ApiLesson } from './api.js';

/**
 * The severities an operator is allowed to waive.
 *
 * S1 and S2 are not on this list and must never be: `waivers.ts` refuses the
 * whole batch if a `granted` covers one, so offering the button would produce
 * a UI that lets you answer and then throws the answer away.
 */
const WAIVABLE = new Set(['S3-minor', 'S4-nit']);

/**
 * A finding is still open while nobody has ruled on it.
 *
 * `fix-pending` and `fix-landed` are deliberately absent: those are findings
 * already on their way to being fixed, and asking you to waive one is asking
 * you to undo work in flight.
 */
const UNANSWERED = new Set(['raised', 'confirmed']);

/**
 * Every finding that still wants an answer — one entry per FINDING.
 *
 * Split out from `waiverQueue` so the two can be counted against each other.
 * black-smith's own `alerts.pendingWaivers` applies exactly this predicate to
 * the findings table, so this is the number that is comparable with it;
 * `waiverQueue`'s is not, because it has already collapsed a repeated defect
 * into one row. Comparing the wrong two numbers would raise a false alarm
 * every time a defect occurred twice.
 */
export function waiverCandidates(findings: readonly ApiFinding[]): ApiFinding[] {
  return findings.filter(
    (finding) =>
      finding.waiverId === null &&
      WAIVABLE.has(finding.severity) &&
      UNANSWERED.has(finding.findingStatus),
  );
}

/**
 * The findings this session is asking you to rule on, newest-severity first.
 *
 * Deduplicated by FINGERPRINT, not by finding id, because that is the unit the
 * factory answers in: one decision covers every occurrence of the same defect,
 * and listing five rows that resolve together would let you grant one and
 * believe the other four were still open.
 */
export function waiverQueue(findings: readonly ApiFinding[]): ApiFinding[] {
  const seen = new Set<string>();
  const queue: ApiFinding[] = [];
  for (const finding of waiverCandidates(findings)) {
    if (seen.has(finding.fingerprint)) {
      continue;
    }
    seen.add(finding.fingerprint);
    queue.push(finding);
  }
  // S3 before S4: the more serious answer is the one worth reading first, and
  // a queue that mixed them would make a nit look like a defect.
  return queue.sort((a, b) => a.severity.localeCompare(b.severity));
}

/**
 * The lesson candidates this session is asking you to rule on.
 *
 * The server already buckets them — `pending` is the queue — so this is a
 * scope check rather than a filter: `/api/lessons` can be asked session-wide,
 * and a candidate raised by another session is not this session's question.
 */
export function lessonQueue(
  pending: readonly ApiLesson[],
  sessionId: string,
): readonly ApiLesson[] {
  return pending.filter((lesson) => lesson.sessionId === sessionId);
}
