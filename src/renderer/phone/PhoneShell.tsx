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
 *
 * ONE RULE ANY SHELL RE-HOSTING THESE PANELS INHERITS, INCLUDING THE NEXT ONE.
 * The panels' buttons carry `ShortcutTip`, which prints the chord in force by
 * reading `activeBindings()` — a module singleton, not React state — when a
 * tip OPENS. A rebind therefore lands in the next open, and what makes that
 * safe is that the keyboard editor is MODAL: the settings overlay's scrim
 * covers the viewport, so no tip can be open while the keys are being edited.
 * This shell keeps that (the overlays are siblings of the shell, and the phone
 * rule only re-anchors the panel beneath them). A shell that ever shows the
 * editor and the chrome at once breaks it, and the fix then belongs in
 * `ShortcutTip.tsx` — a subscription — not in a note here.
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
  /**
   * Can this source record a prompt? `false` is a read-only server, whose
   * write routes are not registered at all, and the composer is then not drawn
   * -- the reason is in `declines`, in the source's words.
   */
  readonly records: boolean;
  readonly failureCount: number;
  readonly onOpenErrorLog: () => void;
  /**
   * The renderer's one refusal channel, drawn by `Canvas`'s `StatusCell`.
   *
   * Passed as a node rather than a string so it is the SAME cell the desktop
   * bar draws -- shortening, tooltip and all. Without it every refusal vam
   * writes ('pick a session first', 'this project has no source', the
   * source's own decline for a new session) landed in state and rendered
   * nowhere, which is the one thing this shell is careful not to do.
   */
  readonly statusCell: ReactNode;
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
  const rail = useRef<HTMLElement>(null);
  useEffect(() => {
    rail.current?.querySelector('[data-step-chip][aria-current="step"]')?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
    });
  }, []);
  if (steps.length === 0) return null;
  return (
    // A `nav`, which is what it is: the session screen's primary navigation,
    // and an element that can carry a name. A bare `div` cannot -- and the
    // `tablist` this used to claim to be needed a `tabpanel` it never had.
    <nav
      ref={rail}
      data-step-rail
      aria-label="steps"
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
            // NOT `role="tab"`. These chips were written as a tablist and are
            // not one: the region they change is `DetailPanel`'s body, which
            // is no `tabpanel` of theirs, and a tab without its panel fails
            // `aria-required-parent` (WCAG 1.3.1/4.1.2, Level A) on the one
            // platform where a screen reader is standard equipment. They are
            // buttons that move a position in a chain, and `aria-current`
            // says exactly that much and no more.
            aria-current={on ? 'step' : undefined}
            onClick={() => onSelect(index)}
            className={[
              'flex min-h-[44px] flex-none items-center gap-1.5 whitespace-nowrap rounded-[7px] border px-3 text-[12px]',
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
    </nav>
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

/** Is the soft keyboard up because THIS element took focus? */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && /^(INPUT|TEXTAREA)$/.test(target.tagName);
}

export function PhoneShell({
  sidebar,
  detail,
  sourceReadout,
  records,
  failureCount,
  onOpenErrorLog,
  statusCell,
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
  /**
   * Which step the rail is on, or `null` for "the newest".
   *
   * `null` rather than an index, because the reset is what was wrong: keying
   * it on the session id skips every re-open of the SAME session -- leaving
   * the screen does not move `focusedId` -- so opening a session, tapping
   * chip 1, going back and opening it again reopened on step 1. A sentinel
   * cannot go stale that way: the screen sets it on every push.
   */
  const [step, setStep] = useState<number | null>(null);

  const entry = detail.entry;
  const session = entry?.session ?? null;
  // Oldest first, so the numbers on the chips are the numbers `STEP n/N`
  // counts in. ALL of them: the canvas's three-card cap is a property of a
  // 580x290 grid cell and this rail has no cell.
  const steps: readonly Decision[] = session === null ? [] : [...session.decisions].reverse();
  const newest = Math.max(steps.length - 1, 0);
  const at = step === null ? newest : Math.min(step, newest);

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
    // Every push opens on the newest step: arriving at a session is arriving
    // at what it just did, whether or not it is the session you last read.
    setStep(null);
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
          <span className="flex-none">
            {tally.running} running · {tally.waiting} waiting · {tally.done} done
          </span>
          {statusCell !== null && (
            <span data-phone-status className="min-w-0 flex-1 truncate">
              {statusCell}
            </span>
          )}
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
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] text-ink">{session?.title}</span>
          <span className="truncate text-[12px] text-ink-dim">{entry.project.name}</span>
        </span>
        {/* Closing a session, drawn where it can be seen and read.
            The list row's own `x` is revealed by hover and a finger has no
            hover, so on a phone it is not a control at all (styles.css) -- and
            it sat over the row's primary tap, which is the worst place for one.
            Here it is visible, it is eight pixels clear of the back chevron at
            the other end of the bar, and it goes through the same confirm the
            `x` chord does. */}
        <button
          type="button"
          data-phone-close
          aria-label="close session"
          onClick={() => sidebar.onClose(entry.session.id)}
          className={`${TOUCH} ${FOCUS_RING} flex-none rounded-[7px] text-[16px] text-ink-dim`}
        >
          ×
        </button>
      </header>

      {/* The same refusal channel the list screen has. A rename or a close
          that is declined says so here, rather than into a status bar that is
          not drawn at all on this device. */}
      {statusCell !== null && (
        <div
          data-phone-status
          className="flex min-h-[24px] flex-none items-center border-line border-b bg-panel px-3 font-mono text-[12px] text-ink-dim"
        >
          {statusCell}
        </div>
      )}

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
        // By tag name, not `instanceof`: this has to be true for the composer
        // and for the rename box and false for everything else, and a tag name
        // is the same fact in every realm a renderer can be mounted in.
        onFocusCapture={(event) => {
          if (isTyping(event.target)) setTyping(true);
        }}
        onBlurCapture={(event) => {
          if (isTyping(event.target)) setTyping(false);
        }}
      >
        <DetailPanel
          {...detail}
          width={undefined}
          resizeHandle={null}
          // There is nothing else on screen to be active.
          active={true}
          decision={steps[at] ?? detail.decision}
          records={records}
        />
      </div>
    </div>
  );
}
