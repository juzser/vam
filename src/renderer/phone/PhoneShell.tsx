/**
 * vam on a phone: two screens in a stack, and no canvas.
 *
 * Screen one is the session list, screen two is one session -- its output, its
 * open question and its composer. The panels are RE-HOSTED, not
 * rewritten: `SessionList` and `DetailPanel` are handed the same prop objects
 * `Canvas` assembles for the columns, with the width left off so each fills
 * the screen. Every `data-` hook they carry is therefore still where the
 * desktop's tests expect it.
 *
 * One cell of one 580x290 canvas card does not fit in 390px, so the canvas is
 * not drawn on this screen at all.
 *
 * WHAT SCREEN TWO IS FOR, AND WHAT THAT COST. It is the prompt screen: read
 * the newest output, reply. It is NOT for browsing a session. Two strips of
 * browsing chrome used to sit between the app bar and the output -- a step
 * rail built here, and the view tab bar `DetailPanel` draws -- above a bar
 * that was two rows deep. All three are gone, on the operator's instruction,
 * and the desktop keeps the tabs. MEASURED at 390x844 against the demo
 * fixture: the session's first line moves from y=209 to y=102, so 107px of an
 * 844px viewport came back. The price, so that the next reader does not
 * restore any of it as an obvious omission:
 *   - The views that remain are NOT lost: `Response / Agents` are icon buttons
 *     in the app bar below, driving the pane through its `tabRequest` seam.
 *     What is lost is the WORD on each one, which is why every icon carries an
 *     `aria-label` and the selected one is marked by a shape, not a hue.
 *   - `PRs` IS lost, and that one is a cut rather than a compression. The
 *     operator asked for it after a mobile audit: this screen exists to send a
 *     prompt and read the answer, the PRs list serves neither, and it was the
 *     only place a phone could merge a pull request or delete a remote branch
 *     -- both irreversible, both against a real repository, both one tap from
 *     a view switch on a 390px bar. The withdrawal is `visibleTabs`'
 *     (`panels/tabs.ts`), beside Terminal's and Files', and NOT a filter on
 *     this file's own list: the pane below re-hosts `DetailPanel`, which reads
 *     the same function, and a row that hid an icon over a pane that would
 *     still mount it is not a withdrawal.
 *   - There is no step navigation at all. The screen always shows the NEWEST
 *     step (`session.decisions[0]`, derived on every render), which is the
 *     step a waiting session is waiting in and the one a reply answers. Older
 *     steps are unreachable from a phone.
 *   - The bar's SECOND LINE is gone with it -- one row, as asked -- and the
 *     project and the epic went with that line. The session's name stays (a
 *     screen that cannot say which session you are in is not a prompt screen)
 *     and the agent count stays as the Agents icon's badge.
 * The `step` state that used to hold a chip selection was deleted with the
 * rail rather than left as a prop nobody writes: an unwritten selector would
 * have frozen the screen on whatever step it last held.
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

import {
  Bot,
  FileText,
  GitPullRequest,
  type LucideIcon,
  MessageSquare,
  SquareTerminal,
} from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react';
import type { Project, Session } from '../domain/model.js';
import { orderedInProject } from '../domain/selectors.js';
import { DetailPanel } from '../panels/DetailPanel.js';
import { SessionList } from '../panels/SessionList.js';
import { type Tab, visibleTabs } from '../panels/tabs.js';
import { ConfirmCloseSession } from './ConfirmCloseSession.js';
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
  /* `tally` and `declines` were props here and are gone with the two bands
     that read them -- the footer's `N running · N waiting · N done`, and the
     limits list, which is in the settings dialog now. Removed rather than left
     unread: a prop nothing draws is an invitation to draw it again. */
};

/**
 * One icon per view, from the set the settings screen already draws with. A
 * text glyph was tried first and read as punctuation at 16px -- `⎇` in
 * particular is a keyboard symbol, not a branch, in the fonts a phone has.
 */
const VIEW_ICON: Record<Tab, LucideIcon> = {
  Response: MessageSquare,
  // Never drawn on a phone either, and for a reason that is a DECISION rather
  // than a missing bridge: `visibleTabs` withdraws `PRs` from this shell on
  // the operator's instruction. Kept for the same mechanical reason `Files`
  // below is -- this is a `Record<Tab, _>`, and a map that cannot be built is
  // a compile error, not a smaller row.
  PRs: GitPullRequest,
  Terminal: SquareTerminal,
  Agents: Bot,
  // Never actually drawn on a phone -- `detail.files` is only ever true
  // behind a desktop bridge no browser build has, so `visibleTabs` withdraws
  // it here the same way it would withdraw Terminal for a source with none.
  // Present anyway because `VIEW_ICON` is a `Record<Tab, _>`, and `Tab` now
  // includes `Files` everywhere -- see `tabs.ts`.
  Files: FileText,
};

/**
 * The views, as icon buttons in the app bar.
 *
 * They are the same views `DetailPanel`'s word strip offers -- `visibleTabs`
 * is the one derivation, so a source with no terminal withdraws it here too --
 * and they drive the pane through `tabRequest`, the seam `Mod-<digit>` already
 * uses. The tab itself stays the pane's state; this is a request, which is why
 * asking twice for the same view is still an ask.
 *
 * SIZED TO THE PAINT, NOT THE HIT: the 44 box takes the tap, a 30x30 skin
 * takes the border, the ground and the 16px glyph. The reason is inside.
 *
 * A glyph alone is mystery meat, so each carries `aria-label`, and `Agents`
 * puts its count in the label as well as beside the glyph -- the strip's
 * `Agents 3` badge, kept. WHICH ONE IS ON is said three ways and only one of
 * them is colour: `aria-pressed` for a screen reader, a filled ground, and the
 * 2px mark below the glyph. Colour alone is a WCAG 1.4.1 Level A failure and
 * this codebase has shipped one before.
 *
 * The hook is `data-phone-view`, deliberately NOT `data-view-tabs`: a rule
 * written for the desktop bar must not be able to collect this row by
 * accident, which is how `.vam-phone-typing [role='tablist']` once hid the
 * control for choosing which question you were answering.
 */
function ViewIcons({
  tabs,
  current,
  runningAgents,
  onSelect,
}: {
  readonly tabs: readonly Tab[];
  readonly current: Tab;
  readonly runningAgents: number;
  readonly onSelect: (tab: Tab) => void;
}) {
  return (
    <nav aria-label="views" data-phone-views className="flex flex-none items-center">
      {tabs.map((tab) => {
        const on = tab === current;
        const count = tab === 'Agents' && runningAgents > 0 ? runningAgents : null;
        const Icon = VIEW_ICON[tab];
        return (
          <button
            key={tab}
            type="button"
            data-phone-view={tab.toLowerCase()}
            aria-label={count === null ? tab : `${tab}, ${count} running`}
            aria-pressed={on}
            onClick={() => onSelect(tab)}
            className={`${TOUCH} ${FOCUS_RING} relative flex-none`}
          >
            {/* THE HIT IS 44, THE PAINT IS 30. A border or a resting ground
                drawn ON the 44 box is what makes a phone control read as too
                big -- measured on the shipped screenshots, where the bordered
                44 buttons are the heaviest objects on the screen and the
                unpainted 44 beside them reads correctly sized (UI spec
                `vam-phone-controls`, 2.1). So the box stays 44 and centres
                only, and this skin carries everything visible. Not the
                desktop's `vam-hit-24` inversion: that hangs the hit area off a
                `::after`, and the phone guard reads `getBoundingClientRect()`
                on the element, which cannot see one. Adjacent icons then show
                14px between painted edges with a container gap of 0. */}
            <span
              data-tap-skin
              className={[
                'flex h-[30px] w-[30px] items-center justify-center rounded-[8px]',
                on ? 'bg-segment-on text-ink' : 'text-ink-dim active:bg-raised',
              ].join(' ')}
            >
              {/* 16 is the size orca's phone icons cluster hard at, and above
                  the 14 its own comment calls "read as decoration". */}
              <Icon size={16} aria-hidden="true" />
            </span>
            {count !== null && (
              <span className="absolute top-[7px] right-[4px] font-mono text-meta text-ink-dim">
                {count}
              </span>
            )}
            {on && (
              <span
                data-phone-view-mark
                className="-translate-x-1/2 absolute bottom-[5px] left-1/2 h-[2px] w-[16px] rounded-full bg-ink"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}

/** The status tokens, on a 6px dot -- never borrowed for decoration. */
const STATUS_DOT: Readonly<Record<Session['status'], string>> = {
  running: 'bg-running',
  waiting: 'bg-waiting',
  idle: 'bg-idle',
  // The neutral `idle` shares: an empty pane is the absence of news too.
  unstarted: 'bg-idle',
  // A pane and a known conversation, at rest -- same neutral hue as the two
  // above; `status-mark.tsx`'s glyph is what a 6px dot has no room to draw.
  terminal: 'bg-idle',
  done: 'bg-done',
  failed: 'bg-failed',
};

/**
 * Which session, in this project -- a different axis from `ViewIcons`, which
 * answers which facet of ONE session. Ordered by `orderedInProject`, the same
 * urgency-first rule the canvas itself uses, scoped to one project.
 *
 * ONE SESSION RENDERS NOTHING: a strip that can only ever show one tab,
 * permanently selected, teaches nothing and costs a full row on every
 * single-session project. Selection is said three ways, following
 * `ViewIcons`' own precedent: `aria-pressed`, a filled ground, and a 2px
 * mark -- never `role="tab"`, which would be a third orphaned tablist in a
 * codebase that already has two unpaired with any `tabpanel`.
 *
 * TABS, AND NOTHING PINNED BESIDE THEM. A `+` and a `‹` used to sit fixed
 * outside the scrollable region. They were 88px of a 390px row held out of the
 * scroller, which left the chips 266px: measured, the third chip was always off
 * screen and every name clipped at the 104px cap. Both duplicated the list
 * screen -- `+` called `sidebar.onAddInProject`, which is exactly the list's
 * own per-project add, and `‹` unwound to that same list, only pre-scrolled --
 * so the operator lost a whole session tab to reach two things one tap on the
 * back chevron already reaches. Cut on the operator's instruction; the room
 * goes to the tabs, which are the one thing here the list cannot do in place.
 */
function SessionTabStrip({
  project,
  sessions,
  currentSessionId,
  onPick,
}: {
  readonly project: Project;
  readonly sessions: readonly Session[];
  readonly currentSessionId: string;
  readonly onPick: (sessionId: string) => void;
}) {
  if (sessions.length < 2) return null;
  return (
    <nav
      aria-label={`sessions in ${project.name}`}
      data-phone-session-tabs
      className="flex flex-none items-center gap-1.5 border-line border-b bg-panel px-3"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {sessions.map((session) => {
          const on = session.id === currentSessionId;
          return (
            <button
              key={session.id}
              type="button"
              data-phone-session-tab={session.id}
              aria-pressed={on}
              aria-label={`${session.title}, ${session.status}`}
              onClick={() => onPick(session.id)}
              className={`${TOUCH} ${FOCUS_RING} relative flex-none`}
            >
              <span
                data-tap-skin
                className={[
                  'flex h-[30px] max-w-[104px] items-center gap-1 rounded-[8px] px-2',
                  on ? 'bg-segment-on text-ink' : 'text-ink-dim active:bg-raised',
                ].join(' ')}
              >
                <span
                  aria-hidden="true"
                  data-phone-session-status={session.status}
                  className={`h-[6px] w-[6px] flex-none rounded-full ${STATUS_DOT[session.status]}`}
                />
                {/* Colour alone repeats a WCAG 1.4.1 failure this codebase has
                    shipped before -- a glyph carries the one state that needs
                    a second channel, on a chip too narrow for a word. */}
                {session.status === 'waiting' && (
                  <span
                    aria-hidden="true"
                    data-phone-session-waiting-badge
                    className="flex-none font-mono text-meta text-waiting"
                  >
                    !
                  </span>
                )}
                <span className="truncate text-control">{session.title}</span>
              </span>
              {on && (
                <span
                  data-phone-session-mark
                  className="-translate-x-1/2 absolute bottom-[5px] left-1/2 h-[2px] w-[16px] rounded-full bg-ink"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* `RemoteLimits` used to be here, a 45px band above the transcript on every
   session screen. It is in the settings dialog now (`settings/RemoteLimits.tsx`,
   which carries the measurement and the argument): it is a fact about the
   CONNECTION, not about the session on screen, and it does not change while the
   operator works. `declines` is no longer a prop of this shell at all -- it goes
   straight from `Canvas` to the overlay that draws it, so there is no route by
   which this file could start drawing it again by accident. */

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
   * Is a question open on the session showing right now?
   *
   * `DetailPanel` derives this (`openQuestion`, its own state plus the
   * pane-read fallback for a tool-approval prompt with no transcript
   * record) and reports it up through `onQuestionOpenChange` -- see that
   * prop's own doc for why this shell cannot derive it independently. Used
   * below to collapse `SessionTabStrip` the same way `!typing` already does
   * (docs/design/phone-core-loop.md §3.2): the strip's 45px is exactly what
   * the operator's brief is about returning to the transcript the moment
   * there is a question to read.
   */
  const [questionOpen, setQuestionOpen] = useState(false);
  /**
   * Which view the icon row shows as on, and the request that puts the pane
   * there. Two pieces because they say different things: the pane owns its tab
   * and is ASKED to move (a fresh object per tap keeps a second ask an ask),
   * while the row has to draw a selection without reaching into the pane.
   * They start together because `initialTab` below is fixed at Response: a
   * remembered desktop tab would arrive in the pane and not in this row.
   */
  const [view, setView] = useState<Tab>('Response');
  const [viewRequest, setViewRequest] = useState<{ readonly tab: Tab } | null>(null);
  /* A `scrollToProjectId` used to live here, set by the session strip's `‹` so
     the list came back pre-scrolled to this project's heading. It went with the
     control that wrote it: a piece of state nothing writes is how a screen ends
     up frozen on a value nobody chose, and leaving it would have been the exact
     mistake the step rail's removal already avoided once in this file. */
  /**
   * The session the `×` is asking about, or `null` when it is asking about
   * none. The id AND the title, because the question has to name the thing it
   * would end and the entry it was raised from may have gone by the time it is
   * answered.
   */
  const [confirmClose, setConfirmClose] = useState<{
    readonly id: string;
    readonly title: string;
  } | null>(null);

  const entry = detail.entry;
  const session = entry?.session ?? null;
  /**
   * The step this screen shows: the newest, always.
   *
   * `decisions` is newest-first, so this is `[0]` and not a stored index. That
   * is the point -- with no rail there is no control to move it, and a piece of
   * state nothing writes is exactly how a screen ends up stuck on a step the
   * session left ten minutes ago.
   */
  const newest = session?.decisions[0] ?? null;
  // `detail.files` reads `false`/`undefined` on every real phone -- there is
  // no desktop bridge behind a browser build, ever -- so this withdraws
  // `Files` the same way `detail.terminal !== false` withdraws Terminal.
  //
  // THE THIRD ARGUMENT IS `true` AND THE LIST IS NOT FILTERED HERE. `PRs` is
  // off the phone on the operator's instruction, and the WHOLE of that
  // decision is in `tabs.ts` -- a `.filter()` on this line would be the third
  // instance of the bug that file's header records twice, because the pane
  // this shell re-hosts reads the same function and would go on believing the
  // view was offered. `true` is a statement about which shell is asking, which
  // is the only thing a caller is allowed to say.
  const views = visibleTabs(detail.terminal !== false, detail.files === true, true);

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
    // Every push opens on the newest step, because that is the only step this
    // screen has: arriving at a session is arriving at what it just did.
    setOpen(true);
    // AND ON THE NEWEST OUTPUT, for the same reason. `view` is state that
    // outlives the session it was chosen in, so Agents tapped on one session
    // used to greet the NEXT one -- "this source does not report which agents
    // a session is running", about a session that was waiting for an answer.
    // A remembered tab is cheap on a desktop, where every view is one click
    // away in a labelled strip; here they are unlabelled glyphs and the
    // recovery costs a tap on the screen whose whole budget is taps.
    //
    // Both halves, because they say different things (see `view` above): the
    // row draws its own selection, and the pane is ASKED to move -- a fresh
    // object per open, so a second ask stays an ask.
    setView('Response');
    setViewRequest({ tab: 'Response' });
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
      <div data-phone-shell="list" className="flex h-[100dvh] min-h-0 flex-col bg-ground">
        {/* NO DEDICATED BAR FOR THIS ANY MORE -- there used to be a second
            `<header>` here, above `SessionList`'s own, whose only content
            was this readout. For the healthy arm that is a LONE DOT (see
            `SourceReadout`'s own comment on why nothing else paints), so a
            48px, full-width, bordered bar existed to hold seven visible
            pixels -- the operator's own report, translated: "an empty gap
            and a blue dot" at the very top of the getting-started screen,
            measured at y:0 w:390 h:48 holding one 7x16 dot. `SessionList`
            now takes the readout as a prop and folds it into the row it
            already draws for the avatar and the theme toggle -- a row that
            exists whether or not there is anything to say here, so the
            readout stops needing a bar of its own to be seen in. */}
        <div className="flex min-h-0 flex-1 flex-col">
          <SessionList
            {...sidebar}
            width={undefined}
            resizeHandle={null}
            // This list IS the screen here: no canvas repeats a status beside
            // it, no detail pane answers a question, and no cursor has
            // anywhere to be. The row says so itself (UI spec D1).
            phone
            sourceReadout={sourceReadout}
            onPick={(id) => {
              sidebar.onPick(id);
              show();
            }}
          />
        </div>
        {/* WHAT THIS BAR NO LONGER SAYS. It opened with `2 running · 3 waiting
            · 1 done` -- a 44px band restating a view of itself, directly under
            the rows that are the tally. The desktop had the same cell removed
            for the same reason ("the bar was restating a view of itself"), and
            this one was worse: it counted three of the five statuses and
            dropped `failed` and `idle` silently, so a phone could read `2
            running · 0 waiting · 0 done` over a list with a failed session in
            it.

            SO THE BAR IS NOW ITS TWO REAL CELLS AND NOTHING ELSE, and when
            neither has anything it costs no band at all -- only the padding
            that keeps the last ROW clear of the home indicator, which is the
            one job something at the bottom of this screen always has
            (`styles.css`). The element stays in the tree either way: see the
            refusal cell's own comment below for why its PRESENCE must not be
            the signal.

            `bg-sidebar`, ON BOTH ARMS, WHICH IS NEW: neither used to set a
            background at all when this bar was empty, so `SessionList`'s
            own `bg-sidebar` pane ended one pixel above the footer's box and
            the SHELL's `bg-ground` -- darker, meant for the app's outer
            canvas, never for a surface an operator reads text against --
            showed through the safe-area padding instead. A second reviewer
            caught it on the regenerated screenshot: a dark band along the
            very bottom edge, the same family as the fix above but inside
            the shell's own paint rather than past its edge. The non-empty
            arm carried `bg-panel` for the same reason and the same bug, one
            shade off `bg-sidebar` rather than two -- less visible, not
            absent, so it moved too. */}
        <footer
          data-phone-status-bar
          className={
            statusCell === null && failureCount === 0
              ? 'flex flex-none items-center bg-sidebar'
              : 'flex min-h-[44px] flex-none items-center gap-3 border-line border-t bg-sidebar px-3 font-mono text-meta text-ink-dim'
          }
        >
          {/* Drawn always, empty and out of layout when there is nothing to
              say. Conditional PRESENCE made "vam has refused nothing" and
              "this screen has no refusal channel" the same observation to
              anything that looked -- including a test, which then waited for
              an element that only appears when something has gone wrong. The
              display is inline because a Tailwind display utility on the same
              element would outrank `[hidden]`. */}
          <span
            data-phone-status
            style={statusCell === null ? { display: 'none' } : undefined}
            className="min-w-0 flex-1 truncate"
          >
            {statusCell}
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
      className={`flex h-[100dvh] min-h-0 flex-col bg-ground ${typing ? 'vam-phone-typing' : ''}`}
    >
      <header className="flex h-12 flex-none select-none items-center gap-2 border-line border-b bg-panel px-2">
        <button
          type="button"
          aria-label="back to sessions"
          data-phone-back
          onClick={back}
          /* OFF THE TYPE SCALE, named as such in `test/renderer/type-scale.test.ts`:
             `‹` is a GLYPH used as an icon, not text, and it is sized against
             the 16px lucide icons in this same bar rather than against a text
             step. A chevron paints far smaller than its em box -- at the
             scale's 15px `heading` it would be the smallest mark in a 44px
             target. The `×` below is 16 for the same reason in the other
             direction: a multiplication sign fills its box where this does
             not. Two glyphs, two optical sizes, and neither is prose. */
          className={`${TOUCH} ${FOCUS_RING} flex-none rounded-[7px] text-[18px] text-ink-dim`}
        >
          ‹
        </button>
        {/* ONE ROW: back, the session's name, the views, close. This bar used
            to carry a second line (`project · epic · N agents`); the operator
            asked for the header block to go, so it did, and the project and
            the epic are not shown on a phone any more. The NAME stays and
            keeps `data-prompt-target` -- that hook's job is to name the
            session about to be written to, and one composer serving many
            sessions is the easiest way to send the right words to the wrong
            agent. The agent count is on the Agents icon beside it. */}
        <span data-prompt-target className="min-w-0 flex-1 truncate text-heading text-ink">
          {session?.title}
        </span>
        <ViewIcons
          tabs={views}
          current={view}
          runningAgents={session?.runningAgents ?? 0}
          onSelect={(tab) => {
            setView(tab);
            setViewRequest({ tab });
          }}
        />
        {/* Closing a session, drawn where it can be seen and read.
            The list row's own `x` is revealed by hover and a finger has no
            hover, so on a phone it is not a control at all (styles.css) -- and
            it sat over the row's primary tap, which is the worst place for one.
            Here it is visible, and it is at the other end of the bar from the
            back chevron.

            IT ASKS BEFORE IT ACTS, AND THIS COMMENT USED TO CLAIM IT ALREADY
            DID -- "it goes through the same confirm the `x` chord does". There
            was no such confirm on either path: `Canvas`'s `onSidebarClose`
            calls `closeSession` straight, and `ConfirmForceClose` is only
            offered AFTER a close has been refused. Driven at 390px against a
            source that can close, one tap sent the write and opened no dialog
            at all. What makes that an S2 rather than a nicety is the geometry
            beside it: the Agents icon ends 8px before this control starts, so
            a view switch and an unundoable stop are neighbours under one
            finger. See `ConfirmCloseSession` for why the question is the
            phone's and not the chord's. */}
        <button
          type="button"
          data-phone-close
          aria-label="close session"
          onClick={() => setConfirmClose({ id: entry.session.id, title: entry.session.title })}
          className={`${TOUCH} ${FOCUS_RING} flex-none rounded-[7px] text-[16px] text-ink-dim`}
        >
          ×
        </button>
      </header>

      {confirmClose !== null && (
        <ConfirmCloseSession
          title={confirmClose.title}
          onCancel={() => setConfirmClose(null)}
          onConfirm={() => {
            const target = confirmClose;
            setConfirmClose(null);
            sidebar.onClose(target.id);
          }}
        />
      )}

      {/* The same refusal channel the list screen has. A rename or a close
          that is declined says so here, rather than into a status bar that is
          not drawn at all on this device. */}
      <div
        data-phone-status
        style={statusCell === null ? { display: 'none' } : undefined}
        className="flex min-h-[24px] flex-none items-center border-line border-b bg-panel px-3 font-mono text-meta text-ink-dim"
      >
        {statusCell}
      </div>

      {/* Out of the way while the keyboard is up: chrome the operator is not
          reading while composing. This is the OTHER axis from `ViewIcons`
          above -- which session, not which facet of it -- and it sits in the
          step rail's old slot without being the step rail's return; see this
          file's header comment. The limits band that used to stand under it
          is gone from this screen entirely (see above `isTyping`). */}
      {!typing && !questionOpen && (
        <SessionTabStrip
          project={entry.project}
          sessions={orderedInProject(entry.project)}
          currentSessionId={entry.session.id}
          onPick={(sessionId) => sidebar.onPick(sessionId)}
        />
      )}

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
          phone
          // There is nothing else on screen to be active.
          active={true}
          decision={newest ?? detail.decision}
          // NAMED, so the icon row and the pane cannot disagree at all --
          // not merely start together. `detail.tab` is the DESKTOP's
          // per-session view and `detail.initialTab` its remembered opener;
          // neither is a fact this row can learn, and both would arrive in
          // the pane without arriving here. `viewRequest` is kept beside it
          // because the two say different things (see `view` above): the row
          // draws its own selection, the pane is ASKED to move.
          tab={view}
          initialTab="Response"
          tabRequest={viewRequest}
          records={records}
          onQuestionOpenChange={setQuestionOpen}
        />
      </div>
    </div>
  );
}
