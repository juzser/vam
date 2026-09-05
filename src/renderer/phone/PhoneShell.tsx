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
 * One cell of one 580x290 canvas card does not fit in 390px, so the graph is
 * not drawn at all.
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
 *   - The views are NOT lost: `Response / PRs / Agents` are icon buttons in
 *     the app bar below, driving the pane through its `tabRequest` seam. What
 *     is lost is the WORD on each one, which is why every icon carries an
 *     `aria-label` and the selected one is marked by a shape, not a hue.
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

import { Bot, GitPullRequest, type LucideIcon, MessageSquare, SquareTerminal } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react';
import { DetailPanel } from '../panels/DetailPanel.js';
import { SessionList } from '../panels/SessionList.js';
import { type Tab, visibleTabs } from '../panels/tabs.js';
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
 * One icon per view, from the set the settings screen already draws with. A
 * text glyph was tried first and read as punctuation at 16px -- `⎇` in
 * particular is a keyboard symbol, not a branch, in the fonts a phone has.
 */
const VIEW_ICON: Record<Tab, LucideIcon> = {
  Response: MessageSquare,
  PRs: GitPullRequest,
  Terminal: SquareTerminal,
  Agents: Bot,
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
              <span className="absolute top-[7px] right-[4px] font-mono text-[9.5px] text-ink-dim">
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
   * Which view the icon row shows as on, and the request that puts the pane
   * there. Two pieces because they say different things: the pane owns its tab
   * and is ASKED to move (a fresh object per tap keeps a second ask an ask),
   * while the row has to draw a selection without reaching into the pane.
   * They start together because `initialTab` below is fixed at Response: a
   * remembered desktop tab would arrive in the pane and not in this row.
   */
  const [view, setView] = useState<Tab>('Response');
  const [viewRequest, setViewRequest] = useState<{ readonly tab: Tab } | null>(null);

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
  const views = visibleTabs(detail.terminal !== false);

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
            // This list IS the screen here: no canvas repeats a status beside
            // it, no detail pane answers a question, and no cursor has
            // anywhere to be. The row says so itself (UI spec D1).
            phone
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
        {/* ONE ROW: back, the session's name, the views, close. This bar used
            to carry a second line (`project · epic · N agents`); the operator
            asked for the header block to go, so it did, and the project and
            the epic are not shown on a phone any more. The NAME stays and
            keeps `data-prompt-target` -- that hook's job is to name the
            session about to be written to, and one composer serving many
            sessions is the easiest way to send the right words to the wrong
            agent. The agent count is on the Agents icon beside it. */}
        <span data-prompt-target className="min-w-0 flex-1 truncate text-[15px] text-ink">
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
      <div
        data-phone-status
        style={statusCell === null ? { display: 'none' } : undefined}
        className="flex min-h-[24px] flex-none items-center border-line border-b bg-panel px-3 font-mono text-[12px] text-ink-dim"
      >
        {statusCell}
      </div>

      {/* Out of the way while the keyboard is up: chrome the operator is not
          reading, out of the ~400px the keyboard leaves. The step rail that
          stood here is gone entirely -- see the note at the top of this file
          for what that costs. */}
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
          phone
          // There is nothing else on screen to be active.
          active={true}
          decision={newest ?? detail.decision}
          // Fixed, so the icon row and the pane cannot start on different
          // views: `detail.initialTab` is a remembered DESKTOP choice, and the
          // row has no way to learn it.
          initialTab="Response"
          tabRequest={viewRequest}
          records={records}
        />
      </div>
    </div>
  );
}
