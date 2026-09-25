import { useCallback, useState } from 'react';
import type { Tab as DetailTab } from '../panels/DetailPanel.js';
import { type Prefs, setDetailTab } from '../prefs/prefs.js';

/**
 * Composer state, KEYED BY SESSION — the load-bearing change a tab shell
 * makes here, and the reason A15.1's split panes cost this file almost
 * nothing extra for the composer specifically. A draft typed in one tab
 * must survive switching to another and back rather than bleeding into it
 * or vanishing, and (A15.1) two SPLIT PANES showing two different
 * sessions must never share one either — both are the same requirement,
 * "keyed by session, not by whichever pane happens to be looking", and
 * this was already keyed that way before a second pane existed. One
 * `Record` per piece of state, read and written through the
 * `*For(sessionId, …)` helpers below. `buildDetailProps` (further down)
 * reads these directly per pane; `setComposing`/`actionIndex` are the two
 * zero-argument aliases still used by keyboard-only callers that only
 * ever mean "whichever session the keyboard is in right now" (the chord
 * switch, `beginComposing`) — see that declaration's own comment.
 */
export function useCanvasSessionUi(prefs: Prefs, savePrefs: (next: Prefs) => void) {
  const [draftsBySession, setDraftsBySession] = useState<Readonly<Record<string, string>>>({});
  const [composingBySession, setComposingBySession] = useState<Readonly<Record<string, boolean>>>(
    {},
  );
  /**
   * WHICH VIEW EACH SESSION IS ON — the same record shape as the drafts above,
   * and here for the same reason, arrived at three years late.
   *
   * Operator instruction: "when session 1 switches to the PRs view, the rest
   * of the sessions do not switch". `DetailPanel` used to hold ONE view in
   * local state and a pane reuses ONE instance for every session it shows, so
   * the view was a fact about the pane; `renderLeaf`'s own comment asserted
   * the isolation ("a leaf that stays mounted while its OWN `sessionId`
   * changes must still be a fresh component instance") while `key={leaf.id}`
   * remounted nothing, which is how a documented invariant names the bug.
   *
   * A session with no entry here opens on `viewSeed`, never on
   * `prefs.detailTab` read live — that distinction is the second half of the
   * same bleed. `prefs.detailTab` is what the NEXT RUN opens on, so re-reading
   * it as each session first appears would put the choice made for session 1
   * onto every session shown after it, just more slowly. The seed is taken
   * ONCE, when the shell mounts, and the preference is written past it.
   */
  const [viewBySession, setViewBySession] = useState<Readonly<Record<string, DetailTab>>>({});
  /**
   * THE LAST SEND THAT FAILED, per session -- the sentence, kept until the
   * operator does something about it.
   *
   * Operator instruction: a send that errors has to say so in the OUT area,
   * not only in the status bar. The status bar is a running commentary that
   * the next act overwrites, and a refused send already rolls its optimistic
   * turn back and returns the words to the composer -- so from the pane, an
   * act that failed and an act never attempted looked exactly the same. This
   * is the surface that stays put.
   *
   * KEYED BY SESSION for the reason every record here is: the pane showing
   * session 2 must not carry session 1's verdict. CLEARED WHEN THE NEXT
   * ATTEMPT BEGINS rather than on a timer or a dismissal -- a verdict about a
   * send that has been superseded is worse than no verdict, and the operator
   * pressing Enter again is the unambiguous signal that they have moved on.
   *
   * NOT A SECOND ERROR LOG. `noteFailure` still records the event and still
   * returns the status-bar sentence; this stores that same sentence. Three
   * surfaces, three jobs, one source of words.
   */
  const [sendFailureBySession, setSendFailureBySession] = useState<
    Readonly<Record<string, string>>
  >({});
  const setSendFailureFor = useCallback((sessionId: string, note: string | null) => {
    setSendFailureBySession((current) => {
      if ((current[sessionId] ?? null) === note) return current;
      const next = { ...current };
      if (note === null) delete next[sessionId];
      else next[sessionId] = note;
      return next;
    });
  }, []);
  /**
   * THE ONE WRITER, and it writes two places because there are two questions.
   * The record is what THIS SESSION is showing now; the preference is what the
   * NEXT RUN opens on. Both routes to a view -- the icon the operator clicks
   * and the `Alt+<digit>` they press -- come through here, so neither can
   * drift into answering only one of them, which is what happened the first
   * time the chord was wired past it.
   */
  const setViewFor = useCallback(
    (sessionId: string, view: DetailTab) => {
      setViewBySession((current) =>
        current[sessionId] === view ? current : { ...current, [sessionId]: view },
      );
      if (view !== prefs.detailTab) savePrefs(setDetailTab(prefs, view));
    },
    [prefs, savePrefs],
  );
  const setDraftFor = useCallback((sessionId: string, value: string) => {
    setDraftsBySession((current) => ({ ...current, [sessionId]: value }));
  }, []);
  const setComposingFor = useCallback((sessionId: string, value: boolean) => {
    setComposingBySession((current) => ({ ...current, [sessionId]: value }));
  }, []);
  /** Same per-session shape as the composer state above, and the same reason:
   *  which action `j`/`k` has landed on in the Insert pane is a fact about
   *  the tab you are reading, not a single global cursor. */
  const [actionIndexBySession, setActionIndexBySession] = useState<
    Readonly<Record<string, number>>
  >({});
  const setActionIndexFor = useCallback(
    (sessionId: string, updater: number | ((current: number) => number)) => {
      setActionIndexBySession((current) => ({
        ...current,
        [sessionId]: typeof updater === 'function' ? updater(current[sessionId] ?? 0) : updater,
      }));
    },
    [],
  );
  /** True while a write is in flight for THAT session — Enter must not fire
   *  twice, and a send in one tab must not gate Enter in another. */
  const [writingBySession, setWritingBySession] = useState<Readonly<Record<string, boolean>>>({});
  const setWritingFor = useCallback((sessionId: string, value: boolean) => {
    setWritingBySession((current) => ({ ...current, [sessionId]: value }));
  }, []);

  return {
    draftsBySession,
    setDraftsBySession,
    composingBySession,
    setComposingBySession,
    viewBySession,
    setViewBySession,
    sendFailureBySession,
    setSendFailureBySession,
    setSendFailureFor,
    setViewFor,
    setDraftFor,
    setComposingFor,
    actionIndexBySession,
    setActionIndexBySession,
    setActionIndexFor,
    writingBySession,
    setWritingBySession,
    setWritingFor,
  };
}
