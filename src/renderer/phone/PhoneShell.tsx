/**
 * vam on a phone: two screens in a stack, and no canvas.
 *
 * Screen one is the session list, screen two is one session -- its steps, its
 * output, its open question and its composer. The panels are RE-HOSTED, not
 * rewritten: `SessionList` and `DetailPanel` are handed the same prop objects
 * `Canvas` assembles for the columns, with the width left off so each fills
 * the screen. Every `data-` hook they carry is therefore still where the
 * desktop's tests expect it.
 *
 * One cell of one 580x290 canvas card does not fit in 390px, so the graph is
 * not drawn at all; the step rail below carries the decision chain the canvas
 * carried, and carries all of it rather than the three a grid cell holds.
 */

import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react';
import type { Decision } from '../domain/model.js';
import { DetailPanel } from '../panels/DetailPanel.js';
import { SessionList } from '../panels/SessionList.js';
import type { SourceDeclines } from '../sources/port.js';
import { closeSession, isSessionEntry, openSession } from './history.js';

/** 44x44 is WCAG 2.2 SC 2.5.5 (AAA) and Apple's HIG figure, not a taste. */
const TOUCH = 'flex min-h-[44px] min-w-[44px] items-center justify-center';
const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

export type PhoneShellProps = {
  /** The same object the sidebar column is built from. `width` is dropped. */
  readonly sidebar: ComponentProps<typeof SessionList>;
  /** The same object the detail column is built from. `width` is dropped. */
  readonly detail: ComponentProps<typeof DetailPanel>;
  /**
   * The `data-source` readout, lifted out of the canvas top bar -- which is
   * not drawn here. Mandatory: over a tunnel, a dropped connection and an idle
   * factory look identical without it.
   */
  readonly sourceReadout: ReactNode;
  readonly failureCount: number;
  readonly onOpenErrorLog: () => void;
  readonly tally: {
    readonly running: number;
    readonly waiting: number;
    readonly done: number;
    readonly failed: number;
  };
  /** The source's own words for every capability it lacks. Never this file's. */
  readonly declines: SourceDeclines;
};

/**
 * The step rail: the canvas's information, on one axis.
 *
 * Chips are drawn oldest-first so the numbers read 1..N, which is the order
 * `STEP n/N` has always counted in. The amber cursor ring is deliberately NOT
 * used for the waiting mark -- it measures 2.15:1 on the light canvas, which
 * fails even the 3:1 non-text threshold, and on a 36px chip it would be the
 * only channel.
 */
function StepRail({
  steps,
  selected,
  waiting,
  onSelect,
}: {
  readonly steps: readonly Decision[];
  readonly selected: number;
  readonly waiting: boolean;
  readonly onSelect: (index: number) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rail.current?.querySelector('[data-step-chip][aria-selected="true"]')?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
    });
  }, []);
  if (steps.length === 0) return null;
  return (
    <div
      ref={rail}
      data-step-rail
      className="flex h-[44px] flex-none select-none items-center gap-2 overflow-x-auto border-line border-b bg-panel px-2 vam-no-scrollbar"
    >
      {steps.map((step, index) => {
        // The newest step is the one a waiting session is waiting in: it is
        // the one `focusedDecision` opens on, and the only one still running.
        const needsYou = waiting && index === steps.length - 1;
        const on = index === selected;
        return (
          <button
            key={step.id}
            type="button"
            data-step-chip
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(index)}
            className={[
              'flex h-[36px] min-h-[44px] flex-none items-center gap-1.5 whitespace-nowrap rounded-[7px] border px-3 text-[12px]',
              on ? 'border-line bg-segment-on text-ink' : 'border-line text-ink-dim',
              needsYou ? 'border-waiting' : '',
              FOCUS_RING,
            ].join(' ')}
          >
            <span className="font-mono text-[11px]">{index + 1}</span>
            {step.label}
            {needsYou && <span className="text-waiting">needs you</span>}
          </button>
        );
      })}
      <span className="flex-none px-2 font-mono text-[11px] text-ink-dim">
        STEP {selected + 1}/{steps.length}
      </span>
    </div>
  );
}

/**
 * What this connection cannot do, in the source's own words.
 *
 * Generated from `declines`, never written here: a sentence hard-coded in the
 * phone shell would go stale the first time a source gains a capability. It is
 * a standing fact about the connection, so it lives somewhere you can go and
 * read it rather than in a toast.
 */
function RemoteLimits({ declines }: { readonly declines: SourceDeclines }) {
  const entries = Object.entries(declines).filter(([, why]) => why !== undefined && why !== '');
  if (entries.length === 0) return null;
  return (
    <details data-remote-limits className="flex-none border-line border-b bg-panel px-3">
      <summary className="flex min-h-[44px] cursor-pointer items-center text-[12px] text-ink-dim">
        What this connection cannot do
      </summary>
      <ul className="pb-2">
        {entries.map(([name, why]) => (
          <li key={name} data-remote-limit={name} className="py-1 text-[12px] text-ink-dim">
            {why}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function PhoneShell({
  sidebar,
  detail,
  sourceReadout,
  failureCount,
  onOpenErrorLog,
  tally,
  declines,
}: PhoneShellProps) {
  /**
   * Which screen is on top. Derived from a tap, and NOT persisted: restoring
   * it would open vam on a session that may have ended since.
   */
  const [open, setOpen] = useState(false);
  const pushed = useRef(false);
  /**
   * Is the soft keyboard up? Read off focus rather than `visualViewport`,
   * which is a known source of jitter and double-resize loops -- the shell is
   * sized in `100dvh` and needs no listener to sit above the keyboard.
   */
  const [typing, setTyping] = useState(false);
  const [step, setStep] = useState(0);

  const entry = detail.entry;
  const session = entry?.session ?? null;
  // Oldest first, so the numbers on the chips are the numbers `STEP n/N`
  // counts in. ALL of them: the canvas's three-card cap is a property of a
  // 580x290 grid cell and this rail has no cell.
  const steps: readonly Decision[] = session === null ? [] : [...session.decisions].reverse();
  const at = Math.min(step, Math.max(steps.length - 1, 0));

  // The step rail resets with the session: a chip index is a position in one
  // session's chain and means nothing in the next one's.
  const sessionId = session?.id ?? null;
  const lastSession = useRef(sessionId);
  useEffect(() => {
    if (lastSession.current !== sessionId) {
      lastSession.current = sessionId;
      setStep(Math.max((session?.decisions.length ?? 1) - 1, 0));
    }
  }, [sessionId, session]);

  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      // Our own entry has just been consumed by the gesture, so there is
      // nothing left to unwind -- `closeSession` must not go back again.
      if (!isSessionEntry(event.state)) {
        pushed.current = false;
        setOpen(false);
      }
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  const show = () => {
    openSession(window.history);
    pushed.current = true;
    setOpen(true);
  };
  const back = () => {
    // The chevron unwinds the entry it pushed rather than setting state
    // directly, so the two routes out of this screen leave the same history.
    if (pushed.current) {
      closeSession(window.history, true);
      pushed.current = false;
    }
    setOpen(false);
  };

  if (!open || entry === null) {
    return (
      <div data-phone-shell="list" className="flex h-[100dvh] min-h-0 flex-col bg-canvas">
        <header className="flex h-12 flex-none select-none items-center gap-2 border-line border-b bg-panel px-3">
          {sourceReadout}
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          <SessionList
            {...sidebar}
            width={undefined}
            resizeHandle={null}
            keyboardHere={false}
            onPick={(id) => {
              sidebar.onPick(id);
              show();
            }}
          />
        </div>
        <footer
          data-phone-status-bar
          className="flex h-[44px] flex-none items-center gap-3 border-line border-t bg-panel px-3 font-mono text-[12px] text-ink-dim"
        >
          <span>
            {tally.running} running · {tally.waiting} waiting · {tally.done} done
          </span>
          <span className="flex-1" />
          {/* The only route into the error log on a device with no keyboard,
              and the surface most wanted at the worst moment. */}
          {failureCount > 0 && (
            <button
              type="button"
              data-error-log-button
              onClick={onOpenErrorLog}
              className={`${TOUCH} ${FOCUS_RING} rounded-[4px] border border-line-strong px-2 text-failed`}
            >
              {failureCount} {failureCount === 1 ? 'failure' : 'failures'}
            </button>
          )}
        </footer>
      </div>
    );
  }

  return (
    <div
      data-phone-shell="session"
      data-phone-keyboard={typing ? 'open' : 'closed'}
      className={`flex h-[100dvh] min-h-0 flex-col bg-canvas ${typing ? 'vam-phone-typing' : ''}`}
    >
      <header className="flex h-12 flex-none select-none items-center gap-2 border-line border-b bg-panel px-2">
        <button
          type="button"
          aria-label="back to sessions"
          data-phone-back
          onClick={back}
          className={`${TOUCH} ${FOCUS_RING} flex-none rounded-[7px] text-[18px] text-ink-dim`}
        >
          ‹
        </button>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] text-ink">{session?.title}</span>
          <span className="truncate text-[12px] text-ink-dim">{entry.project.name}</span>
        </span>
      </header>

      {/* Out of the way while the keyboard is up: 44px of navigation the
          operator has already used, out of the ~400px the keyboard leaves. */}
      {!typing && (
        <StepRail
          steps={steps}
          selected={at}
          waiting={session?.status === 'waiting'}
          onSelect={setStep}
        />
      )}
      {!typing && <RemoteLimits declines={declines} />}

      {/* The output takes every pixel the bands above and the composer below do
          not, and it is the only region that shrinks when the keyboard opens.
          Focus here is NOT a focus change: `shouldStick` reads `focusChanged`,
          and opening a keyboard is not a different document -- treating it as
          one is exactly how the naive version drags a scrolled-back operator
          to the bottom every time they tap the box. */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLTextAreaElement) setTyping(true);
        }}
        onBlurCapture={(event) => {
          if (event.target instanceof HTMLTextAreaElement) setTyping(false);
        }}
      >
        <DetailPanel
          {...detail}
          width={undefined}
          resizeHandle={null}
          // There is nothing else on screen to be active.
          active={true}
          decision={steps[at] ?? detail.decision}
        />
      </div>
    </div>
  );
}
