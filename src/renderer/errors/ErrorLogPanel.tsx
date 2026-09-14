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
 *
 * GETTING THE TEXT OUT, which this panel had no way to do at all. Reported
 * from use -- "the error log cannot copy text and cannot create an issue" --
 * and measured afterwards as four closed doors rather than one:
 *
 *   1. `body { user-select: none }` is global (`styles.css`, and it is right
 *      for a keyboard tool), and exactly one subtree opted back in:
 *      `DetailPanel`. This panel is a sibling overlay, so nothing in it could
 *      be dragged over -- not a message, and not the fallback URL it printed
 *      when a copy was refused. It carries `select-text` now.
 *   2. The `yy` that stylesheet comment points at cannot fire here:
 *      `Canvas.tsx`'s keydown returns on every key but Escape while an
 *      overlay is open, and `yy` copies a DECISION's commands in any case.
 *   3. There was no copy control. The only button on a row was `Report`,
 *      which copies a github.com URL rather than the message. There is a
 *      Copy now, and it copies the event as text.
 *   4. The message cell was `truncate` -- one clipped line, no title, no
 *      expansion -- so at a phone width it collapsed to nothing at all. The
 *      message wraps on its own line now.
 *
 * And `Open in browser` is the route to github.com that never existed: main
 * owns `shell.openExternal` and takes a TITLE and a BODY, never a URL, so the
 * policy that denies this renderer every off-origin navigation is kept exactly
 * as written. It opens the prefilled FORM; submitting is still the operator's
 * own act, on their own machine, after reading the body.
 */

import { useState, useSyncExternalStore } from 'react';
import { copyText } from '../panels/clipboard.js';
import { clearEvents, type LoggedEvent, loggedEvents, subscribeEvents } from './log.js';
import { composeReport, type Report } from './report.js';

export type ErrorLogPanelProps = {
  readonly onClose: () => void;
};

/**
 * One event as the operator would retype it -- the whole row, in order, in
 * the words already on screen. Scrubbed by nothing: this goes to the
 * operator's own clipboard on their own machine, and `scrub` is for the text
 * that leaves it. `composeReport` is the scrubbed path, and it is the one
 * wired to github.
 */
function eventText(event: LoggedEvent): string {
  return `${event.at} ${event.kind} ${event.code} (${event.action}): ${event.message}`;
}

export function ErrorLogPanel({ onClose }: ErrorLogPanelProps) {
  const events = useSyncExternalStore(subscribeEvents, loggedEvents, loggedEvents);
  const [report, setReport] = useState<Report | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  /** What the last act on this panel did, said out loud. Null at rest. */
  const [note, setNote] = useState<string | null>(null);
  /** Whether a browser can be opened at all -- absent in the browser build. */
  const openIssue = globalThis.window?.api?.issue?.open;

  async function makeReport(event: LoggedEvent): Promise<void> {
    // Composed, shown, and copied. NOT sent: pressing submit on github.com is
    // the operator's decision and their last chance to read the body.
    const composed = composeReport(event);
    setReport(composed);
    setNote(null);
    setCopied(await copyText(composed.url));
  }

  async function copyEvent(event: LoggedEvent): Promise<void> {
    // The honest answer, not a floating promise and a cheerful word:
    // `copyText` returns whether the write landed (`panels/clipboard.ts`).
    setNote(
      (await copyText(eventText(event)))
        ? 'copied to the clipboard'
        : 'the clipboard refused — select the text and copy it',
    );
  }

  async function openReport(composed: Report): Promise<void> {
    if (openIssue === undefined) return;
    setNote(
      (await openIssue(composed.title, composed.body))
        ? 'the prefilled form is open in your browser — read it, then submit'
        : 'no browser opened — the URL is below',
    );
  }

  return (
    <div
      data-error-log
      data-overlay-host
      role="dialog"
      aria-label="error log"
      aria-modal="true"
      /* `select-text`, and it is the whole of defect 1 above: `styles.css`
         turns selection off for the app and this is the opt-in. On the HOST,
         so the fallback URL and every message are covered by one rule rather
         than by a class somebody has to remember to repeat. */
      className="absolute inset-0 z-50 flex select-text items-start justify-center pt-16"
    >
      <button
        type="button"
        aria-label="close the error log"
        className="absolute inset-0 cursor-default bg-ground/70"
        onMouseDown={onClose}
      />
      <div className="relative flex max-h-[80vh] w-[min(760px,92vw)] flex-col overflow-y-auto rounded-md border border-line bg-panel p-4">
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="font-semibold text-ink text-heading">error log</h2>
          <span className="text-ink-faint text-meta">
            this session only — nothing here is written to disk
          </span>
          <button
            type="button"
            onClick={() => {
              setReport(null);
              clearEvents();
            }}
            className="ml-auto rounded border border-line px-2 py-0.5 text-ink-dim text-control"
          >
            Clear
          </button>
        </div>

        {/* WHAT THE LAST ACT DID, said out loud and in one place.
            `role="status"` because it appears after a press, in a panel
            nothing re-focuses -- and polite rather than assertive, since the
            operator is looking straight at the control they just pressed.
            Drawn only when there is something to say: an empty line reserved
            for a note would be a row of dead height in the panel's usual
            state. */}
        {note !== null && (
          <p role="status" className="mb-2 text-ink-dim text-control">
            {note}
          </p>
        )}

        {events.length === 0 ? (
          <p data-testid="error-log-empty" className="py-6 text-center text-ink-faint text-control">
            nothing has failed yet
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {events.map((event) => (
              /* TWO LINES, NOT ONE CLIPPED ONE. The message used to share the
                 row with four other cells under `truncate`, so it was the
                 cell that gave way: measured at 390px it collapsed to zero
                 width and the row showed the time, the kind and the code and
                 nothing about what happened. The identity of the event fits
                 on one line; the sentence gets its own and wraps. */
              <li
                key={event.id}
                className="flex flex-col gap-0.5 border-line border-b py-1.5 font-mono text-control last:border-b-0"
              >
                <div className="flex items-baseline gap-2">
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
                  <span className="min-w-0 flex-1 truncate text-ink-dim">{event.action}</span>
                  {/* COPY IS OFFERED ON EVERY EVENT, report only on failures.
                      A refusal vam meant to say is not a bug and must not
                      become an issue -- but it is still text the operator may
                      need to paste somewhere, which is a different question
                      and was answered "no" for both. */}
                  <button
                    type="button"
                    aria-label={`copy this ${event.kind}`}
                    onClick={() => void copyEvent(event)}
                    className="flex-none cursor-pointer rounded border border-line px-2 py-0.5 text-ink-dim hover:text-ink"
                  >
                    Copy
                  </button>
                  {event.kind === 'failure' && (
                    <button
                      type="button"
                      onClick={() => void makeReport(event)}
                      className="flex-none cursor-pointer rounded border border-line px-2 py-0.5 text-ink-dim hover:text-ink"
                    >
                      Report
                    </button>
                  )}
                </div>
                {/* `title` as well as wrapping: the row wraps, and a pane
                    narrow enough to wrap a long path five times is still
                    easier to read out of a tooltip. */}
                <span title={event.message} className="break-words text-ink-dim">
                  {event.message}
                </span>
              </li>
            ))}
          </ul>
        )}

        {report !== null && (
          <div className="mt-3 rounded border border-line bg-raised p-2">
            <p className="mb-1 text-ink-dim text-control">
              {copied === true
                ? 'the prefilled issue URL is on your clipboard — read this, then open it'
                : 'the clipboard refused — open it below, or select the URL and copy it'}
            </p>
            <pre
              data-testid="report-preview"
              className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-meta text-ink-dim"
            >
              {report.body}
            </pre>
            <p className="mt-1 break-all font-mono text-meta text-ink-faint">{report.url}</p>
            {/* THE ROUTE TO GITHUB, and the reason it is a button rather than
                an anchor: this renderer may not navigate off-origin at all
                (`src/main/csp.ts`), so an `<a href>` would be a dead control.
                Main opens it, from a title and a body -- never from this URL
                -- which is `CHANNELS.issueOpen`'s whole shape.

                ABSENT, NOT DISABLED, in the browser build: there is no bridge
                there, and a control that cannot act must not be drawn. The URL
                above is selectable, which is the browser build's answer. */}
            {openIssue !== undefined && (
              <button
                type="button"
                onClick={() => void openReport(report)}
                className="mt-2 cursor-pointer rounded border border-line px-2 py-0.5 text-control text-ink-dim hover:text-ink"
              >
                Open in browser
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
