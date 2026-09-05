/**
 * A render throw, contained and named, instead of a white screen.
 *
 * Before this file there was no boundary anywhere in the renderer: any throw
 * during render unmounted the whole React tree, and what the operator got was
 * a blank window with no message, no log and no route to one. On the phone
 * shell that is the entire product gone, because there is no second surface
 * there to infer the failure from.
 *
 * WHERE IT GOES, and what that costs. There are two placements in `App.tsx`
 * and they protect different things:
 *
 *   - Around the CANVAS, inside `SourceCanvas`. This is the throw that
 *     actually happens -- the canvas is where the model, the nodes and the
 *     panels are -- and putting the boundary here keeps the source-failure
 *     banner above it alive, which matters because that banner usually
 *     carries the sentence explaining WHY the model was malformed enough to
 *     throw. A boundary at the root would take that explanation down with
 *     the canvas.
 *   - Around the whole app, in `App`. It catches what the first one cannot:
 *     a throw in the routing itself (`BrowserCanvas`, `DesktopCanvas`) or in
 *     `UpdateNotice`, all of which sit outside the canvas boundary. Without
 *     it those still white-screen.
 *
 * WHAT NEITHER OF THEM CAN DO, stated rather than implied: this is not a
 * per-column boundary. The canvas' columns -- sidebar, canvas, detail panel
 * -- are assembled inside `canvas/Canvas.tsx`, so a throw in the detail
 * panel still takes the sidebar with it; the operator learns that the canvas
 * died, not which column. Making that finer means boundaries inside
 * `Canvas.tsx` at the column seams, which is a change to that file, not to
 * this one. The choice here is the coarsest placement that still keeps a
 * second surface alive.
 *
 * WHAT IT SHOWS. It names the surface and repeats the thrown message
 * verbatim, because "Something went wrong" is the white screen with one more
 * click in it. The only control is the report route the app already has
 * (`log.ts` -> `report.ts`): the throw is recorded as a failure event, and
 * the button composes a prefilled `issues/new` URL and copies it. NOTHING IS
 * POSTED -- there is no `fetch`, no `sendBeacon`, no navigation on this path,
 * and the test asserts those calls never happen.
 *
 * WHAT REACHES THE REPORT, exactly, because widening it is the live hazard:
 * `error.message` and nothing else. Not `error.stack`, not React's
 * `componentStack`, not props, not the children that were rendering. A
 * message thrown by this codebase is authored in this codebase, and it goes
 * through the same `scrub` pass on the assembled body as every other event,
 * so this adds a new CALLER to the report path and no new FIELD.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { copyText } from '../canvas/clipboard.js';
import { type LoggedEvent, recordFailure } from './log.js';
import { composeReport, type Report } from './report.js';

export type ErrorBoundaryProps = {
  /** The surface in the operator's words: `the canvas`, `vam`. */
  readonly surface: string;
  readonly children: ReactNode;
};

type State = {
  readonly failed: boolean;
  /** Set in `componentDidCatch`, which React runs before the browser paints. */
  readonly event: LoggedEvent | null;
  readonly report: Report | null;
  readonly copied: boolean | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { failed: false, event: null, report: null, copied: null };

  static getDerivedStateFromError(): Partial<State> {
    // Only the flag. Recording is a side effect and belongs in the commit
    // phase below, not in a method React may call more than once.
    return { failed: true };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    // `_info` carries the component stack. It is deliberately dropped: it
    // names files and component trees, and the report path has no field for
    // it. `recordFailure` takes the error itself and keeps `message` only.
    this.setState({ event: recordFailure(`render ${this.props.surface}`, error) });
  }

  private readonly makeReport = async (): Promise<void> => {
    const { event } = this.state;
    if (event === null) return;
    const report = composeReport(event);
    this.setState({ report });
    this.setState({ copied: await copyText(report.url) });
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const { event, report, copied } = this.state;

    // Sized for the narrow case first: `w-full` with a max, wrapping text and
    // its own scroll, so the card is a phone screen's worth of content at
    // 390px and a centred panel on a desktop -- rather than a desktop card
    // clipped by a phone viewport.
    return (
      <div
        data-testid="render-failure"
        role="alert"
        className="flex h-full min-h-0 w-full items-start justify-center overflow-y-auto p-4"
      >
        <div className="w-full max-w-[560px] rounded-md border border-danger bg-panel p-4">
          <h2 className="m-0 font-semibold text-danger text-sm">
            {this.props.surface} stopped rendering
          </h2>
          <p className="mt-2 mb-0 break-words font-mono text-[11px] text-ink">
            {event?.message ?? 'the thrown error carried no message'}
          </p>
          <p className="mt-2 mb-0 text-ink-faint text-xs">
            Nothing was sent anywhere. The button below composes an issue you submit yourself, after
            reading it.
          </p>
          <button
            type="button"
            onClick={() => void this.makeReport()}
            className="mt-3 rounded border border-line px-2 py-1 text-ink-dim text-xs"
          >
            Report
          </button>
          {report !== null && (
            <div className="mt-3 rounded border border-line bg-raised p-2">
              <p className="mt-0 mb-1 text-ink-dim text-xs">
                {copied === true
                  ? 'the prefilled issue URL is on your clipboard — paste it in your browser, read it, then submit'
                  : 'copy failed — the URL is below; vam has not sent anything'}
              </p>
              <pre
                data-testid="report-preview"
                className="m-0 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink-dim"
              >
                {report.body}
              </pre>
              <p className="mt-1 mb-0 break-all font-mono text-[10px] text-ink-faint">
                {report.url}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }
}
