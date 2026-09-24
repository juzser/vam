import { type MutableRefObject, useEffect, useRef, useState } from 'react';
import type { SessionModel } from '../../shared/terminal.js';
import { type ModelControlState, type RunningModel, runningModelRows } from './model-command.js';

/**
 * How often the pane is re-read for the model the session is running.
 *
 * SLOWER THAN THE PROMPT ABOVE IT, because it is a slower fact: a model
 * changes when somebody types `/model`, where a prompt appears and vanishes on
 * its own. What it buys at all is that vam is not the only one who can type
 * that line -- the operator can switch the model in their own terminal, and
 * the status line is HIDDEN behind any open question, so a read that never
 * repeated would leave the button unlabelled until the row changed.
 *
 * IT IS ALSO THE BOUND ON HOW STALE THE LABEL CAN BE, which is why it is not
 * slower still: four seconds is the longest the button can name a model the
 * session has stopped running. A pick vam makes itself does not wait for it
 * (`sendModel` looks again at once).
 *
 * WHAT IT COSTS: two tmux invocations per tick per pane showing a composer for
 * a session vam started -- the listing that proves the pairing and the capture
 * -- measured at 5.7ms and 5.4ms on a private socket. It runs nowhere else:
 * the recording source and every session vam did not start ask for nothing.
 */
const MODEL_POLL_MS = 4_000;

export type DetailPanelModelRunProps = {
  readonly modelControl: ModelControlState;
  readonly model?: (projectId: string, rowId?: string) => Promise<SessionModel>;
  readonly projectId: string;
  readonly rowId: string;
};

export type DetailPanelModelRun = {
  readonly running: RunningModel | null;
  readonly lookForModel: MutableRefObject<(() => void) | null>;
  readonly runningRows: readonly string[];
};

/**
 * WHICH MODEL THIS SESSION IS RUNNING -- the name the CLI paints on its own
 * status line, read back out of the pane, or `null` for "vam cannot tell".
 *
 * THE FACT IS READ, NEVER REMEMBERED, and that is the whole design. vam
 * drives the CLI's own `/model` menu and reads no answer line afterwards:
 * the operator can type their own `/model` there, a resumed session was set
 * by somebody else, and the CLI can refuse. So the button below shows what
 * the pane SAYS, and the two things it must never show are a name from a
 * switch vam asked for and a name read from another row.
 *
 * ASKED ONLY WHERE THE PICKER IS DRAWN, which is `delivers` and a pane vam
 * owns (`modelControlState`). On every other row vam does not look into a
 * pane it may not act in -- the same rule the prompt read above keeps -- and
 * the disabled button keeps its old word.
 *
 * READ ON THE ROW, ON AN INTERVAL, AND ON DEMAND. The row because a new
 * session is a new pane; the interval because the operator can switch the
 * model in their own terminal and because the status line is hidden behind
 * every open question, so a single read would leave the button unlabelled
 * until the row changed; on demand because a `/model` line vam has just
 * typed is the one moment the answer is known to be about to change.
 *
 * THE ON-DEMAND ROUTE IS A REF AND NOT A DEPENDENCY, which is `TerminalTab`'s
 * own arrangement (`readNow`): the poll publishes its reader while it is
 * running and takes it back when it stops, so nothing outside can ask a read
 * of a row that is no longer being polled -- and the effect keeps the
 * dependencies it actually reads.
 */
export function useDetailPanelModelRun(props: DetailPanelModelRunProps): DetailPanelModelRun {
  const { modelControl, model, projectId, rowId } = props;
  const [running, setRunning] = useState<RunningModel | null>(null);
  /** Published only while the poll below is live; see `sendModel`. */
  const lookForModel = useRef<(() => void) | null>(null);
  const modelReadable = modelControl === 'picker' && model !== undefined;
  useEffect(() => {
    if (!modelReadable || model === undefined) {
      // A row change lands here first, and this line is what stops the last
      // session's model being drawn under this one's title for one frame.
      setRunning(null);
      return;
    }
    let live = true;
    /**
     * WHICH READ'S ANSWER IS STILL WANTED. `live` alone covers unmount, but
     * two reads can be in flight at once -- a hidden window's throttled
     * interval releases a burst when it comes back -- and an older one
     * answering last would paint a model the session had seconds ago.
     * `TerminalTab`'s own poll makes exactly this argument; only the most
     * recently ISSUED read may write.
     */
    let issued = 0;
    const look = async () => {
      issued += 1;
      const mine = issued;
      const view = await model(projectId, rowId);
      if (!live || mine !== issued) return;
      // `unknown` IS THE FALLBACK AND NOT A HOLD. Every reason vam could not
      // tell -- a question over the status line, a cut pane, a pairing it
      // refused, AND a transcript with no answered turn in it -- lands on the
      // word the button wore before, because the one thing worse than an
      // unlabelled button is a label that has quietly stopped being true.
      //
      // AND THE ARM IS KEPT, not flattened to the name. `model` came off the
      // CLI's painted footer and `last-turn` out of the session's transcript;
      // both put the same word on the button, and only one of them can be
      // called "running" in the words around it (`modelRunningClause`).
      setRunning(view.kind === 'unknown' ? null : view);
    };
    lookForModel.current = () => void look();
    void look();
    const timer = setInterval(() => void look(), MODEL_POLL_MS);
    return () => {
      live = false;
      lookForModel.current = null;
      clearInterval(timer);
    };
  }, [modelReadable, model, projectId, rowId]);
  /**
   * The rows the answer marks; two when the name cannot separate them.
   *
   * BY NAME, AND THEREFORE THE SAME FOR BOTH SOURCES. A transcript-sourced
   * name arrives already in the footer's own shape (`displayModelName`), so
   * the tick is the same machinery on either -- and a tick that disagreed with
   * the label beside it would be worse than a tick that lags with it. What the
   * lag means is carried in the words, where it can be said.
   */
  const runningRows = runningModelRows(running?.name ?? null);
  return { running, lookForModel, runningRows };
}
