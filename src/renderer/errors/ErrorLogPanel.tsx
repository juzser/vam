/**
 * Somewhere to READ the failures that used to flash in the status bar.
 *
 * WHY THIS IS NOT A FIFTH SETTINGS SECTION. `sections.ts` states what the
 * overlay's four sections are for: one list read by both the nav and the
 * panels, so a section cannot exist in one and not the other -- a set of
 * CHOICES the operator makes, which persist in prefs and change how the app
 * looks and behaves. An error log is none of that. It is not a preference,
 * nothing in it is chosen, it does not persist, and it is read at the moment
 * something breaks -- which is the exact moment an operator should not have
 * to open Settings and navigate a nav to find out what. By the same reasoning
 * that keeps the four sections coherent, this belongs beside the failure it
 * explains: an overlay opened from the status bar cell where the failure
 * appeared. It sits with `KeySheet` and `CommandPalette`, whose idiom it
 * copies exactly rather than inventing a second one.
 *
 * The report control is offered on failures only. A refusal vam intended is
 * not a bug and must not become an issue.
 */

import { useState, useSyncExternalStore } from 'react';
import { copyText } from '../canvas/clipboard.js';
import { clearEvents, type LoggedEvent, loggedEvents, subscribeEvents } from './log.js';
import { composeReport, type Report } from './report.js';

export type ErrorLogPanelProps = {
  readonly onClose: () => void;
};

export function ErrorLogPanel({ onClose }: ErrorLogPanelProps) {
  const events = useSyncExternalStore(subscribeEvents, loggedEvents, loggedEvents);
  const [report, setReport] = useState<Report | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);

  async function makeReport(event: LoggedEvent): Promise<void> {
    // Composed, shown, and copied. NOT sent: pressing submit on github.com is
    // the operator's decision and their last chance to read the body.
    const composed = composeReport(event);
    setReport(composed);
    setCopied(await copyText(composed.url));
  }

  return (
    <div
      data-error-log
      data-overlay-host
      role="dialog"
      aria-label="error log"
      aria-modal="true"
      className="absolute inset-0 z-50 flex items-start justify-center pt-16"
    >
      <button
        type="button"
        aria-label="close the error log"
        className="absolute inset-0 cursor-default bg-canvas/70"
        onMouseDown={onClose}
      />
      <div className="relative flex max-h-[80vh] w-[min(760px,92vw)] flex-col overflow-y-auto rounded-md border border-line bg-panel p-4">
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="font-semibold text-ink text-sm">error log</h2>
          <span className="text-ink-faint text-xs">
            this session only — nothing here is written to disk
          </span>
          <button
            type="button"
            onClick={() => {
              setReport(null);
              clearEvents();
            }}
            className="ml-auto rounded border border-line px-2 py-0.5 text-ink-dim text-xs"
          >
            Clear
          </button>
        </div>

        {events.length === 0 ? (
          <p data-testid="error-log-empty" className="py-6 text-center text-ink-faint text-xs">
            nothing has failed yet
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex items-baseline gap-2 border-line border-b py-1 font-mono text-[11px] last:border-b-0"
              >
                <span className="text-ink-faint">{event.at.slice(11, 19)}</span>
                <span
                  data-testid="event-kind"
                  className={event.kind === 'failure' ? 'text-failed' : 'text-ink-dim'}
                >
                  {event.kind}
                </span>
                <span data-testid="event-code" className="font-semibold text-ink">
                  {event.code}
                </span>
                <span className="text-ink-dim">{event.action}</span>
                <span className="min-w-0 flex-1 truncate text-ink-dim">{event.message}</span>
                {event.kind === 'failure' && (
                  <button
                    type="button"
                    onClick={() => void makeReport(event)}
                    className="flex-none rounded border border-line px-2 py-0.5 text-ink-dim"
                  >
                    Report
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {report !== null && (
          <div className="mt-3 rounded border border-line bg-raised p-2">
            <p className="mb-1 text-ink-dim text-xs">
              {copied === true
                ? 'the prefilled issue URL is on your clipboard — paste it in your browser, read this, then submit'
                : 'copy failed — the URL is below; vam has not sent anything'}
            </p>
            <pre
              data-testid="report-preview"
              className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink-dim"
            >
              {report.body}
            </pre>
            <p className="mt-1 break-all font-mono text-[10px] text-ink-faint">{report.url}</p>
          </div>
        )}
      </div>
    </div>
  );
}
