/**
 * The Terminal tab: the screen of the tmux session vam started for this one.
 *
 * WHAT IS DRAWN, exactly. `tmux capture-pane -e` returns the ALREADY-COMPOSED
 * screen -- what the pane looks like right now, with every escape sequence
 * already applied by tmux -- and `-e` asks for the surviving SGR sequences
 * back with it, which `terminal-ansi.ts` turns into spans. So the agent's own
 * colours are drawn, and this is STILL NOT A TERMINAL EMULATOR AND NOT A
 * STREAM: a snapshot drawn honestly beats a stream drawn as garbage
 * (`sources/tmux/argv.ts`).
 *
 * THE CURSOR IS THE ONE THING THAT SENTENCE USED TO EXCLUDE, and the exclusion
 * was answered rather than argued with. It said "no cursor is placed", which
 * was true and cost the operator the thing a terminal exists to tell you --
 * their report was "I don't see the cursor in tmux". Nothing here composes or
 * moves one: tmux is ASKED where its cursor ended up, in the same invocation
 * that reads the screen, and `terminal-cursor.ts` marks that one cell. The
 * contract is unchanged in the part that matters -- vam draws what tmux
 * composed and invents nothing.
 *
 * IT DOES NOT BLINK, and the absence is the deliberate half. This screen is a
 * snapshot on a one-second poll, so the caret is up to a second old; an
 * animation is the one thing on a surface like this that a person reads as
 * "this is live", and there is no stream behind it to earn that. A steady
 * block says what is true -- here is where the cursor was when vam last
 * looked -- and it costs no compositor animation running under an idle tab.
 *
 * THREE ANSWERS DRAW NO CARET AT ALL, which is the same rule as everything
 * else here: `hidden` (the program in the pane turned the cursor off, and vam
 * honours that), `unreadable` (vam did not find out -- never to be drawn as a
 * position, least of all 0,0) and a row the capture does not have. On this
 * surface a caret in the wrong place is a false claim about where the
 * operator's next keystroke lands.
 *
 * WHAT IT COSTS WHEN CLOSED: nothing. The operator asked for a tab that loads
 * only when opened, so the whole of this component is mounted by the tab
 * switch and unmounted by it. No timer, no IPC and no tmux process exists
 * while the tab is shut -- the effect below is the only thing that ever asks,
 * and it does not exist until this component does.
 *
 * The `PaneView` answers are kept apart on purpose (`shared/terminal.ts`). One
 * blank pane meaning both "vam started nothing here" and "vam could not reach
 * tmux" is the exact conflation the provider was built to prevent -- and a
 * FOURTH thing this component distinguishes on its own: an `ok` screen whose
 * text is blank. That is not `not-vam` (no pane at all) or `unavailable` (vam
 * could not ask); it is a pane vam DID reach that has nothing drawn on it yet,
 * and it gets its own line rather than being folded into either.
 */

import {
  type CompositionEvent,
  type FocusEvent,
  Fragment,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PaneKey, PaneSendResult, PaneSize, PaneView } from '../../shared/terminal.js';
import { insertScopeMark, insertStopMark } from '../keyboard/focus-scope.js';
import { parseAnsi, spanClasses } from './terminal-ansi.js';
import { composedStrokes } from './terminal-compose.js';
import { placeCursor } from './terminal-cursor.js';
import { fitPane, sameSize } from './terminal-size.js';

/**
 * How often the open tab re-reads the pane.
 *
 * One second. Each refresh is a single short-lived `tmux capture-pane` that
 * prints a screenful and exits, so the cost is bounded by the screen, not by
 * how long the session has run; a second is fast enough that a working agent
 * reads as live to a person, and slow enough that vam is not spawning
 * processes at interaction rates. It runs ONLY while this component is
 * mounted and the window is visible, which is the constraint that actually
 * bounds the cost -- a closed tab refreshes at no rate at all.
 */
export const REFRESH_MS = 1_000;

/**
 * How soon after a keystroke actually lands the tab re-reads the pane, and
 * how often at most while the operator keeps typing.
 *
 * THE PROBLEM, and it is a measured one rather than a taste: a keystroke
 * reaches tmux in about 5ms (`terminal/ipc.ts` measured the send at 5.4ms on
 * an idle private server), but nothing asked for the screen again afterwards
 * -- so the character the operator just typed appeared on the NEXT tick of
 * the interval above. That is up to a full second, half a second on average,
 * between pressing a key and seeing it. The keystroke was never slow; the
 * only thing missing was asking what the screen looked like once it landed.
 *
 * A LEADING-EDGE THROTTLE, not a debounce. A debounce would show nothing at
 * all while the operator typed steadily and everything at once when they
 * stopped, which is the worse half of both behaviours. This reads
 * immediately on the first key after a pause and then at most once per
 * `ECHO_MS` for as long as typing continues.
 *
 * WHAT IT COSTS, said plainly because `REFRESH_MS`'s own note says vam is
 * "not spawning processes at interaction rates": while a person is actually
 * typing into a pane, this spawns up to ten short-lived `capture-pane`
 * reads a second instead of one. That is a real change to that rule, and it
 * is deliberately bounded to exactly the moment it buys something -- a human
 * typing at a keyboard, watching for their own characters. Idle costs
 * nothing extra: no key, no read.
 */
export const ECHO_MS = 100;

/**
 * The reader the tab is given: `window.api.terminal.read`, or nothing.
 *
 * It is asked by PROJECT ID, not by title. The pairing between a session and
 * the tmux session vam started for it is recorded on the tmux session at
 * creation and read back (`main/terminal/pane.ts`); a title reached the name
 * once, was slugged and truncated on the way, and matched nothing.
 */
export type ReadPane = (projectId: string, rowId?: string) => Promise<PaneView>;

/**
 * Telling tmux how big to draw: `window.api.terminal.resize`, or nothing.
 *
 * THE PANE FITS BECAUSE OF THIS AND NOT BECAUSE OF ANY STYLE. `capture-pane`
 * returns the screen tmux has ALREADY composed, at the size the session was
 * created with, so a line tmux wrapped at 80 columns is 80 columns of text by
 * the time it reaches this component. Wrapping, truncation and the column
 * count are decided in tmux; the only thing on this side that can change them
 * is saying what the size should be.
 *
 * It lands only on a session vam recorded as its own for this project
 * (`main/terminal/pane.ts`), which is the guard that matters: this is the one
 * thing the tab does that CHANGES a terminal rather than reading one.
 */
export type ResizePane = (
  projectId: string,
  columns: number,
  rows: number,
  rowId?: string,
) => Promise<boolean>;

/**
 * Typing into the pane: `window.api.terminal.send`, or nothing.
 *
 * ONE KEYSTROKE PER CALL, and it is the only thing vam does that writes into
 * a session somebody's agent is RUNNING in. It is aimed by the same recorded
 * pairing the read and the resize are (`main/terminal/pane.ts`), and main
 * refuses rather than guessing when that pairing names no single session --
 * a key sent to a wrongly-resolved pane is typed into someone else's work.
 * The boolean is that refusal, and it is drawn rather than dropped.
 */
export type SendKey = (projectId: string, key: PaneKey, rowId?: string) => Promise<PaneSendResult>;

/**
 * How long a wrapper has to stop moving before tmux is told about it.
 *
 * A resize per `ResizeObserver` callback would be a `tmux resize-window`
 * PROCESS PER ANIMATION FRAME while the pane resizer is dragged. The debounce
 * and the unchanged-size check are the two halves of not doing that: the
 * debounce collapses a drag into its last frame, and the check drops even that
 * one when the pixels moved without the cell count changing -- which is most
 * of them, since a cell is several pixels wide.
 */
export const RESIZE_DEBOUNCE_MS = 120;

/**
 * The measuring stick: real characters, in the pane's own font, rendered but
 * not shown.
 *
 * A MEASUREMENT AND NOT A RATIO. The advance width of a monospace face is a
 * property of the face, the size, the platform's hinting and the operator's
 * zoom -- Geist Mono at 10.5px measures 6.6015625px here, where the
 * plausible-looking 0.6 of the font size would have said 6.3 and lost a column
 * every seventeen. Ten characters rather than one because the browser rounds a
 * rectangle, and a tenth of that rounding is a tenth of the error.
 */
const RULER_TEXT = 'M'.repeat(10);

const px = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * The pane's content box, in cells -- or `null` while there is no layout to
 * measure, which is every render before the first paint and every render while
 * the tab is hidden.
 *
 * The padding is subtracted because it is the TEXT that has to fit: a column
 * counted across the padding is a column that wraps against it.
 */
function measurePane(pane: HTMLElement, ruler: HTMLElement): PaneSize | null {
  const advance = ruler.getBoundingClientRect();
  const style = globalThis.getComputedStyle(pane);
  const inset = (start: string, end: string): number =>
    px(style.getPropertyValue(start)) + px(style.getPropertyValue(end));
  return fitPane(
    {
      width: pane.clientWidth - inset('padding-left', 'padding-right'),
      height: pane.clientHeight - inset('padding-top', 'padding-bottom'),
    },
    { width: advance.width / RULER_TEXT.length, height: advance.height },
  );
}

/**
 * What is shown when there is no bridge -- the browser build has no main
 * process behind it. Not an empty pane: vam has not looked, so it may not say
 * there is nothing there.
 */
/**
 * The keystroke a key name becomes, or `null` when the pane does not want it.
 *
 * FOUR ANSWERS AND A REFUSAL, and the interesting one is Escape. It used to
 * be vam's way out of this surface; the operator asked for it back in the
 * words that settle it -- inside tmux, Escape should do what Escape does. It
 * cancels Claude Code's picker, leaves vim's insert mode and dismisses most
 * of what anyone runs in a terminal, so a surface that swallows it is not one
 * you can work in.
 *
 * WHAT LEAVES INSTEAD IS TAB, which is the browser's own meaning for a focus
 * stop and is `null` here on purpose. That is the trade, stated plainly: Tab
 * no longer reaches the shell for completion, because a surface that consumes
 * keys has to keep one key that lets go, and of the two only Escape is
 * load-bearing INSIDE the pane. The corner hint says so while the pane has
 * focus, so it is discoverable without reading this.
 *
 * `null` for every other named key -- the arrows, the Page keys, Home/End --
 * which is what leaves the browser scrolling a region whose scrollbar is
 * hidden, the reason this element takes focus at all.
 */
function strokeFor(key: string): PaneKey | null {
  if (key === 'Enter') return { kind: 'enter' };
  if (key === 'Escape') return { kind: 'escape' };
  // Correcting a typo is part of typing: a pane that takes characters and
  // cannot take them back strands the operator on a wrong line. It is a KEY,
  // not the word -- see `sendBackspaceArgv`.
  if (key === 'Backspace') return { kind: 'backspace' };
  // One character is what a printable key produces, composed by the layout,
  // so an accented character arrives already composed and a named key
  // (`ArrowUp`, `F5`) never matches.
  //
  // `key.length` IS A CODE-UNIT COUNT, AND THAT IS LEFT ALONE DELIBERATELY.
  // It rejects anything outside the BMP -- an emoji is two units -- which
  // sounds like a bug and is not reachable as one: no keyboard produces a
  // non-BMP `event.key`, because nothing is one keystroke there. An emoji
  // arrives from the picker, dictation or a paste, all of which are
  // INSERTIONS into the box below rather than keydowns, and never pass
  // through here at all. Widening this to count code points would change the
  // behaviour of exactly no input anyone has.
  return key.length === 1 ? { kind: 'text', text: key } : null;
}

/**
 * WHAT A FOCUSED TEXT CONTROL TAKES AWAY, AND THE PANE DOES FOR ITSELF.
 *
 * The pane is a scroll region with a hidden scrollbar, and the focus stop
 * exists so that the keyboard can read past the first screenful -- that is the
 * original reason this element takes focus at all. THE HIDDEN BOX BREAKS THAT
 * FOR FREE, because the browser gives these keys to whatever text control has
 * the keyboard before it gives them to a scroll container. Measured in
 * Chromium with an empty one-by-one `<textarea>` focused inside a scrolling
 * `<section>`: `PageDown`, `PageUp`, `Home` and `End` moved the pane not at
 * all, and `ArrowUp`/`ArrowDown` moved it only sometimes -- they fall through
 * to the container when the caret cannot move, which stops being true the
 * moment an input method puts a candidate in the box.
 *
 * So the pane scrolls itself, for all six, rather than leaving a surface whose
 * only reason to take focus has silently stopped working. The distance is
 * measured in the SCREEN'S own rows (the ruler, the same character the column
 * count is derived from), which is what a terminal scrolls in, and what the
 * browser's 40px guess was only ever approximating.
 *
 * Nothing is stopped from PROPAGATING: these keys still reach vam's own window
 * listener exactly as they did, where the pane's `data-insert-scope` stands the
 * canvas grammar down.
 */
type PaneScroll = 'up' | 'down' | 'page-up' | 'page-down' | 'top' | 'bottom';

const SCROLL_KEYS: Readonly<Record<string, PaneScroll>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  PageUp: 'page-up',
  PageDown: 'page-down',
  Home: 'top',
  End: 'bottom',
};

/**
 * Move `pane` the way the browser used to, in rows of `row` pixels.
 *
 * A page is a screenful LESS one row, which is how every pager overlaps its
 * screens: the line you were reading at the fold is the line you start the
 * next screen on, and a page of exactly `clientHeight` loses it.
 */
export function scrollPane(pane: HTMLElement, how: PaneScroll, row: number): void {
  const page = Math.max(pane.clientHeight - row, row);
  const from = pane.scrollTop;
  const to =
    how === 'top'
      ? 0
      : how === 'bottom'
        ? pane.scrollHeight
        : how === 'up'
          ? from - row
          : how === 'down'
            ? from + row
            : how === 'page-up'
              ? from - page
              : from + page;
  // Clamped at the top by hand because a negative `scrollTop` is not a
  // position; the bottom is clamped by the browser against the real content
  // height, which is the only thing that knows it.
  pane.scrollTop = Math.max(0, to);
}

/**
 * What the cursor's cell looks like: a solid block, the character in it drawn
 * in the pane's own background colour. Reverse video, which is what a terminal
 * cursor has always been.
 *
 * A STATIC STRING for the reason `spanClasses` is a table of them: Tailwind
 * extracts class names by scanning source text, so anything template-built
 * compiles to no CSS and the cursor silently never appears. That failure mode
 * has shipped in this project before, which is also why the e2e guard measures
 * the RESOLVED background rather than reading this attribute back.
 *
 * IT REPLACES THE CELL'S OWN COLOURS RATHER THAN JOINING THEM. A cursor span
 * carrying both `text-ansi-red` and `text-panel` would resolve by stylesheet
 * order, not by the order they are written here, so which one won would be an
 * accident. The character under a block cursor is not readable in its own
 * colour anyway -- that is what the block is.
 *
 * NO ANIMATION. See the note at the top of this file: the screen behind it is
 * a one-second snapshot, and a blink is a claim about liveness that nothing
 * here can honour.
 */
const CURSOR_CLASSES = 'bg-ink text-panel';

const NO_BRIDGE: PaneView = {
  kind: 'unavailable',
  error: {
    kind: 'unreachable',
    code: 'no-bridge',
    message: 'the terminal is only available in the vam desktop app',
  },
};

export function TerminalTab({
  projectId,
  rowId,
  read,
  resize,
  send,
}: {
  readonly projectId: string | null;
  /**
   * The ROW being shown, when there is one. It is what lets main answer with
   * the pane this SESSION published rather than the project's -- a project vam
   * started two sessions in has two panes, and the project alone can only say
   * `ambiguous` (`main/terminal/pane.ts`).
   */
  readonly rowId?: string | undefined;
  readonly read: ReadPane | undefined;
  readonly resize: ResizePane | undefined;
  /**
   * REQUIRED, exactly as `read` and `resize` are, and `undefined` only where
   * they are: the browser build, which has no main process behind it. It
   * briefly defaulted to reaching for `window.api` itself, which worked and
   * was worse -- the wiring was then invisible at the call site, where the
   * other two are plainly passed, and a member nobody can see being passed is
   * a member a later edit drops with nothing to notice. As a required prop
   * the compiler is what notices.
   */
  readonly send: SendKey | undefined;
}) {
  /**
   * `null` is "has not answered yet", and it is a state rather than an
   * optimistic guess for one reason: every other value here is a CLAIM about
   * the operator's tmux, and showing one of them before a read has returned
   * would flash "vam started no session for this" at a session that has one.
   */
  const [view, setView] = useState<PaneView | null>(read === undefined ? NO_BRIDGE : null);

  /**
   * WHICH PROJECT THE VALUE ABOVE IS ABOUT, and the reason it is a ref checked
   * during render rather than an effect. A `view` held across a change of
   * `projectId` is the PREVIOUS session's screen, drawn under this session's
   * tab and named as this session's -- and it survived until the next read
   * returned, which is bounded by tmux's 10s timeout, not by the 1s refresh.
   * Clearing it in an effect would still paint the stale frame once. This is
   * the exact case the `null` initial state exists for; it just was not being
   * applied when the prop changed.
   */
  const shownFor = useRef(projectId);
  /** The size tmux was last told, for the session it was told about. */
  const sent = useRef<PaneSize | null>(null);
  if (shownFor.current !== projectId) {
    shownFor.current = projectId;
    // The remembered size belongs to the session it was sent for. Keeping it
    // across a change of project would leave the next session unresized
    // whenever the two panes happen to be the same shape.
    sent.current = null;
    if (view !== null && read !== undefined) setView(null);
  }

  /**
   * The running effect's own `tick`, published so the SEND path can ask for a
   * read out of band. A ref rather than a second `poll` call site: `tick`
   * owns the `issued` sequence that decides which answer is still wanted
   * (see the effect below), and a read issued around it could repaint an
   * older screen over a newer one -- the exact race that sequence exists to
   * stop. `null` whenever nothing is polling: a hidden window, no bridge, no
   * project. Asking then is not deferred, it is declined.
   */
  const readNow = useRef<(() => void) | null>(null);
  const lastEcho = useRef(0);
  const echoTimer = useRef<number | undefined>(undefined);

  /** Ask for a read now, or at the end of the current `ECHO_MS` window. */
  const echo = useCallback(() => {
    const fire = () => {
      lastEcho.current = Date.now();
      echoTimer.current = undefined;
      readNow.current?.();
    };
    if (echoTimer.current !== undefined) return;
    const waited = Date.now() - lastEcho.current;
    if (waited >= ECHO_MS) {
      fire();
      return;
    }
    echoTimer.current = window.setTimeout(fire, ECHO_MS - waited);
  }, []);

  useEffect(
    () => () => {
      if (echoTimer.current !== undefined) window.clearTimeout(echoTimer.current);
    },
    [],
  );

  const poll = useCallback(
    (mine: () => boolean) => {
      if (read === undefined || projectId === null) return;
      read(projectId, rowId)
        .then((next) => {
          if (mine()) setView(next);
        })
        .catch((cause: unknown) => {
          // A rejected bridge call is vam not having asked. Reporting it as an
          // empty pane would be the one lie this tab exists to avoid.
          if (!mine()) return;
          setView({
            kind: 'unavailable',
            error: {
              kind: 'unreachable',
              code: 'bridge-failed',
              message: `vam could not read the session's screen: ${String(cause)}`,
            },
          });
        });
    },
    [read, projectId, rowId],
  );

  useEffect(() => {
    if (read === undefined || projectId === null) return;
    let cancelled = false;
    /**
     * Which request's answer is still wanted. `cancelled` alone covers only
     * unmount: two polls in flight both apply their result, so a slow one
     * answering after a newer one would repaint an older screen over a fresher
     * one -- reachable whenever background throttling releases a burst of
     * queued intervals. Only the most recently ISSUED read may write.
     */
    let issued = 0;
    let timer: number | undefined;

    const tick = () => {
      issued += 1;
      const seq = issued;
      poll(() => !cancelled && seq === issued);
    };
    const start = () => {
      if (timer !== undefined) return;
      // Published only while a poll is actually running, so `echo` cannot ask
      // a hidden window (or a tab with no bridge) for a screen nobody reads.
      readNow.current = tick;
      tick();
      timer = window.setInterval(tick, REFRESH_MS);
    };
    const stop = () => {
      if (timer === undefined) return;
      readNow.current = null;
      window.clearInterval(timer);
      timer = undefined;
    };
    // A hidden window is not being read by anyone, and the browser would
    // throttle the interval into bursts anyway. Stopping outright is both
    // cheaper and more honest than polling into a window nobody can see.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
      else start();
    };

    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [poll, read, projectId]);

  const paneRef = useRef<HTMLElement | null>(null);
  const rulerRef = useRef<HTMLElement | null>(null);
  /**
   * Only a pane that is actually being drawn is measured -- and a pane is
   * drawn only for a session vam RECORDED as its own for this project. Every
   * other answer (`not-vam`, `gone`, `ambiguous`, `unavailable`) draws a
   * sentence and no pane, so there is nothing to fit and nothing is observed.
   * That is not a nicety: a resize aimed at a session vam cannot prove would
   * reflow a terminal belonging to work vam has nothing to do with.
   */
  const showing = view !== null && view.kind === 'ok';

  /**
   * The screen, parsed once per screen rather than once per render. The tab
   * re-renders for focus, for a refusal and for every resize observation; the
   * text only changes when a read answers, which is once a second.
   */
  const lines = useMemo(
    () =>
      placeCursor(
        parseAnsi(view !== null && view.kind === 'ok' ? view.text : ''),
        // The cursor is taken from THE SAME `view` the text is, and never
        // held across a read: it is a position in that capture, and one
        // screen's caret drawn on the next screen is a claim about a cell
        // that has moved.
        view !== null && view.kind === 'ok' ? view.cursor : { kind: 'unreadable' },
      ),
    [view],
  );

  /**
   * Whether the pane has the keyboard -- ANYWHERE INSIDE IT, which since the
   * hidden box below is no longer the same question as whether this element is
   * `document.activeElement`. It draws exactly one thing -- the hint naming the
   * way out -- and it draws it only then, because Escape is the pane's now and
   * Tab is all that is left to leave with.
   */
  const [hasFocus, setHasFocus] = useState(false);

  /**
   * THE BOX AN INPUT METHOD CAN ACTUALLY COMPOSE INTO, and the reason this
   * component grew one at all.
   *
   * THE REPORT was "terminal đang không support utf-8 nên viết tiếng Việt bị
   * lỗi?" -- Vietnamese typed here comes out wrong -- and the guess was the
   * encoding. It is not: `capture-pane`'s stdout is decoded at Node's default
   * `utf8` and the send path hands `execFile` an argv ARRAY, which Node
   * encodes as UTF-8. Nothing on either wire is latin-1.
   *
   * IT IS COMPOSITION. Telex types `tieengs` to get `tiếng`: seven keydowns of
   * one printable character each, which `strokeFor` accepts, plus an Enter
   * that COMMITS the syllable and reads exactly like a send. So the pane typed
   * `tieengs` into the agent and pressed Return after it.
   *
   * A GUARD ALONE WOULD FIX HALF OF IT AND TYPE NOTHING. An input method needs
   * a focused EDITABLE element to compose into; a `<section>` is not one, so
   * on this surface there was never a composition to guard -- only its raw
   * keystrokes leaking through. The answer is the one every browser terminal
   * uses (xterm.js calls it the helper textarea): a visually hidden
   * `<textarea>` holds the keyboard while the pane does, receives the
   * composition, and hands over the committed string, which the pane then
   * sends as TEXT rather than as the keystrokes it was built from.
   *
   * IT IS A STAGING AREA AND NOT A VALUE. Nothing here is ever read except
   * `compositionend`'s own data; anything else that lands in it (a paste, a
   * drop, the emoji picker) is emptied and dropped, which is precisely what
   * happened to those before the box existed -- this surface types keystrokes,
   * and `MAX_KEY_TEXT` exists so that it can never become a paste into a
   * running agent.
   */
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  /**
   * Put the keyboard on the hidden box.
   *
   * `preventScroll` IS LOAD-BEARING, and it was measured: the box is
   * absolutely positioned inside a scrolling region, so focusing it scrolls
   * that region to wherever it sits -- the pane jumped to the bottom of the
   * screen on every click. A focus move must never move somebody's terminal.
   */
  const takeKeyboard = useCallback(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  /**
   * Whether a pointer gesture is in progress inside the pane, and the ONE
   * thing it is for: not stealing a selection.
   *
   * Measured in Chromium: a `mousedown` in the pane focuses it, and forwarding
   * that focus into a text control collapses the document selection -- so
   * dragging across the screen selected nothing at all and the operator lost
   * the only way there is to copy text out of this tab. While the pointer is
   * down the box does not take the keyboard; `onLostPointerCapture` gives it
   * over only when the gesture left no selection behind, and a keystroke
   * (below) is what ends a copy gesture that did.
   *
   * IT IS SET ONLY BEHIND A HELD POINTER CAPTURE, which is what makes a stuck
   * `true` unreachable rather than merely unlikely -- see `onPointerDown` for
   * the release-outside-the-pane defect that shape fixes, and for why the
   * capture is taken before the flag is set.
   */
  const pointerDown = useRef(false);

  /**
   * WHAT THE INPUT METHOD IS BUILDING, WHILE IT IS STILL BUILDING IT.
   *
   * A ref and a state, deliberately, because they answer at two different
   * times. The REF is read inside the box's own `input` handler, in the same
   * tick the event arrives, to tell an in-flight candidate (keep) from text
   * that arrived some other way (empty it and drop it) -- a React state read
   * there is the last render's snapshot, and the events of one composition
   * arrive faster than a render. The STATE is what gets drawn: the box is
   * invisible, so without it the operator types a syllable into a hole and
   * sees nothing until it commits.
   */
  const composingNow = useRef(false);
  const [composing, setComposing] = useState('');

  /** Why the last keystroke did NOT land, or `null`. Drawn, not swallowed. */
  const [refused, setRefused] = useState<PaneSendResult | null>(null);

  /**
   * The refusal belongs to the session it was raised for. `sent.current` and
   * `view` are already cleared when the tab changes what it is about, for the
   * same reason this must be: a sentence saying vam could not type into
   * session A, still on screen over session B's pane, is a claim about B that
   * nothing ever made. The row is part of the identity because two sessions
   * of one project are two different panes.
   */
  const shownAbout = `${projectId ?? ''}|${rowId ?? ''}`;
  const refusalFor = useRef(shownAbout);
  if (refusalFor.current !== shownAbout) {
    refusalFor.current = shownAbout;
    if (refused !== null) setRefused(null);
  }

  /**
   * THE ORDER KEYS ARE TYPED IS THE ORDER THEY MUST ARRIVE, and nothing about
   * two `execFile` spawns per keystroke guarantees that on its own. Each key
   * costs a `list-sessions` and a `send-keys`, both unordered with respect to
   * every other key's pair, so typing `n`, `o`, Return can finish in any
   * order at all -- and the one that matters is Return overtaking, which
   * SUBMITS a half-typed line to a live agent and leaves the rest of the
   * word landing on the next prompt.
   *
   * Measured elsewhere in this project, scheduling starvation has stretched
   * an 11ms operation past five seconds. Two spawns per keystroke is not a
   * narrow window.
   *
   * So the sends are a chain: each key waits for the previous one to answer
   * before it is sent. The cost is that fast typing is delivered at the rate
   * tmux can take it, which is the correct trade -- an ordered line typed
   * slightly late beats a scrambled one typed at once.
   */
  const chain = useRef<Promise<void>>(Promise.resolve());
  /**
   * Which run of the chain is still wanted. A send that fails abandons every
   * key QUEUED BEHIND IT rather than sending them into the gap it just left:
   * continuing would hand the agent a line with a hole in it, which is the
   * same class of harm as typing into the wrong pane -- damage that looks
   * like the operator's own text. Keys typed AFTER the refusal is on screen
   * are a new decision by a person who can see it, so they start a new run.
   */
  const run = useRef(0);

  /**
   * FOCUS ON ARRIVAL, ONCE. This component is mounted by the tab switch and by
   * nothing else, so the first pane it draws IS the operator arriving at the
   * terminal, and the tab they opened to type in should be ready to type in.
   *
   * THE LATCH IS THE WHOLE POINT and it was missing. `showing` is not a mount
   * signal: the `shownFor` block above sets `view` to `null` DURING RENDER
   * whenever the project changes, so `showing` goes true, false, true again
   * on every session switch -- and a bare `if (showing) focus()` therefore
   * took focus back every time. Escape let go and the next read grabbed on,
   * so `j` to move to the next session typed a `j` into that session's agent
   * instead, forever. A transient `unavailable` read did the same thing.
   * Latching means the way out stays out: once this component has given the
   * pane focus, only the operator decides where focus goes next.
   */
  const grabbed = useRef(false);
  useEffect(() => {
    if (!showing || grabbed.current) return;
    grabbed.current = true;
    // The BOX, not the pane. The keyboard has to arrive somewhere an input
    // method can compose into, and the pane is not that -- arriving on the
    // section and being forwarded a tick later would leave the very first
    // syllable of a session composed against nothing.
    takeKeyboard();
  }, [showing, takeKeyboard]);

  /**
   * SEND THESE, IN THIS ORDER, ON THE ONE CHAIN.
   *
   * Lifted out of the keystroke handler because a committed composition is now
   * a second caller, and a second queue would be the exact race `chain` exists
   * to prevent -- one syllable's pieces interleaved with the keys typed around
   * them. `run` is captured ONCE for the whole batch, so a refusal partway
   * through a syllable drops the rest of that syllable too: half a word
   * delivered into an agent reads as the operator's own typing.
   */
  const queue = useCallback(
    (strokes: readonly PaneKey[]) => {
      if (send === undefined || projectId === null) return;
      const mine = run.current;
      for (const stroke of strokes) {
        chain.current = chain.current.then(async () => {
          if (run.current !== mine) return;
          const landed = await send(projectId, stroke, rowId).catch(
            (): PaneSendResult => 'refused',
          );
          if (landed === 'sent') {
            // The key is IN the pane now; nothing had been asking what that
            // looked like until the next interval tick. See `ECHO_MS`.
            echo();
            return;
          }
          // Everything still queued was typed before the operator could know
          // this failed, so it is dropped rather than sent into the hole.
          run.current += 1;
          setRefused(landed);
        });
      }
    },
    [send, projectId, rowId, echo],
  );

  /**
   * WHO OWNS A KEY WHILE THE PANE HAS FOCUS. Three answers, and the middle one
   * is the one that was easy to get wrong.
   *
   * A Cmd/Ctrl/Alt chord is VAM'S, always. The shortcut that takes you
   * elsewhere must work from wherever you are, which is why the canvas
   * exempts chords from its own typing guard.
   *
   * ALT IS IN THAT LIST BECAUSE VAM BINDS IT: `normalizeKey` emits an `Alt-`
   * token (`keyboard/chords.ts`). Alt was missing here and the test for
   * "printable" was a one-character `event.key`, which `Alt+1` and `Alt+k`
   * both satisfy -- so those were stopped and typed into the agent while vam
   * never heard them.
   *
   * SHIFT IS DELIBERATELY NOT IN IT. Shift is how a capital and every symbol
   * on the number row is produced, so exempting it would leave a pane that
   * cannot type `K` or `!`. It is not a chord modifier; it is part of the
   * character.
   *
   * Nothing is sent and nothing is stopped for a chord, so it reaches the
   * window listener and does its one thing.
   *
   * WHICH MEANS CTRL+C DOES NOT INTERRUPT THE AGENT, and someone who can type
   * into this pane will eventually try it. It is vam's chord here like every
   * other, so it does whatever vam binds it to and never reaches tmux. That
   * is deliberate and not an oversight to fix by narrowing the exemption:
   * interrupting a running agent is a destructive action on someone's work,
   * and it needs an affordance that says so -- a visible control, or a chord
   * of its own that is captioned in the key sheet as interrupting THIS
   * session -- plus a `send-keys 'C-c'` builder that, per `tmux/argv.ts`,
   * must be its own named builder and never a key-name parameter. Widening
   * this branch instead would hand every chord to the pane, and the first
   * casualty would be the tab switch the operator uses to leave.
   *
   * A printable key, Return and Backspace are the PANE'S, and they are
   * stopped here. The
   * canvas reads a focused element as text entry only when it is an
   * `INPUT` or a `TEXTAREA`, and this is a `section`: without stopping the
   * event, typing `j` here would type a `j` into the agent AND move vam's
   * cursor.
   *
   * Everything else is the BROWSER'S -- the arrows, the Page keys, Home/End,
   * Tab. The first six are why this element takes focus at all (the pane is a
   * scroll region with a hidden scrollbar), and Tab is the second way out.
   * They are not forwarded to tmux, so scrolling the transcript is still
   * scrolling and not a keypress inside the agent.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      /**
       * A KEYSTROKE THAT BELONGS TO AN INPUT METHOD IS NOT THE PANE'S, and
       * this is the first thing asked because EVERY branch below would
       * otherwise answer it -- the printable keys a Telex syllable is built
       * from, and the Enter that commits it.
       *
       * MEASURED in Chromium, the engine vam ships on, by driving a real
       * composition through CDP `Input.imeSetComposition`: the commit key
       * arrives as `{ key: 'Enter', keyCode: 13, isComposing: true }`, which
       * no handler reading `key` alone can tell from a Return. The operator
       * types Vietnamese; every accented syllable ends in that keystroke.
       *
       * `event.nativeEvent.isComposing`, NOT `event.isComposing`. React's
       * synthetic keyboard event does not carry the property at all -- its
       * `KeyboardEventInterface` lists key, code, location, the four
       * modifiers, repeat, locale, getModifierState, charCode, keyCode, which
       * -- and `@types/react` omits it, so the plain spelling is `undefined`
       * at runtime and the guard would be dead while looking exactly like a
       * live one. `DetailPanel.tsx`'s composer records the same trap.
       *
       * RETURN, NOT `preventDefault`, AND FOR EVERY KEY RATHER THAN FOR ENTER
       * ALONE. The composer's own guard is scoped to Enter because its box
       * handles the rest correctly by default; this surface CONSUMES keys and
       * types them into somebody's agent, so while a candidate is in flight
       * every key is the input method's -- the letters that build the
       * syllable, the Escape that abandons it, the Page keys some methods
       * page their candidate list with. Claiming any of them would leave the
       * operator unable to finish the word.
       */
      if (event.nativeEvent.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // TYPING ENDS A COPY GESTURE. `onPointerUp` leaves the keyboard on the
      // pane rather than the box when a drag selected something, so that
      // Cmd-C still has a selection to copy; the moment an unmodified key is
      // pressed the operator is typing, not copying, and the box takes the
      // keyboard back so the next syllable has somewhere to compose. Deferred
      // so it cannot move focus out from under this event's own default.
      if (event.target !== inputRef.current) queueMicrotask(takeKeyboard);
      // The six keys a focused text control would eat -- see `SCROLL_KEYS`.
      // Cancelled, because the pane is doing the browser's job here; not
      // stopped, because they still belong to vam's own keyboard afterwards.
      const scroll = SCROLL_KEYS[event.key];
      if (scroll !== undefined) {
        const pane = paneRef.current;
        if (pane === null) return;
        event.preventDefault();
        scrollPane(pane, scroll, rulerRef.current?.getBoundingClientRect().height ?? 0);
        return;
      }
      const stroke = strokeFor(event.key);
      if (stroke === null) return;
      // THE GUARD COMES BEFORE THE CANCELLING, and it did not. A build with no
      // bridge behind it -- the browser one -- consumed every printable key,
      // Return and Backspace and delivered none of them, which left vam's own
      // keyboard dead for anyone whose focus had landed here until they found
      // Escape or Tab. A key vam cannot deliver is not vam's to eat: it goes
      // back to the window listener, where the chords still work.
      if (send === undefined || projectId === null) return;
      event.preventDefault();
      event.stopPropagation();
      // Return is NOT sent behind the text: each keystroke is one call, so
      // submitting is the operator pressing Return and never vam adding one.
      queue([stroke]);
    },
    [send, projectId, queue, takeKeyboard],
  );

  /**
   * THE COMMITTED SYLLABLE, AND THE ONLY THING THE HIDDEN BOX EVER DELIVERS.
   *
   * `compositionend`'s `data` is the string the input method settled on --
   * `tiếng` for the seven keystrokes that built it, which is what the agent
   * should receive and what no keydown could have described. It goes through
   * the same chain every keystroke does, so it cannot overtake the keys typed
   * around it, and through `composedStrokes` so that a commit longer than
   * `MAX_KEY_TEXT` is delivered in pieces rather than refused with a sentence
   * about pairing (`terminal-compose.ts`).
   *
   * AN EMPTY COMMIT IS A CANCELLED ONE -- Escape ends a composition with
   * `data: ''` -- and `composedStrokes` answers with no strokes at all, so
   * nothing is sent for a syllable the operator threw away.
   */
  const onCompositionEnd = useCallback(
    (event: CompositionEvent<HTMLTextAreaElement>) => {
      composingNow.current = false;
      setComposing('');
      // The box is a staging area, never a value: emptied here so the next
      // composition starts from nothing and `input` has nothing to re-fire.
      event.currentTarget.value = '';
      queue(composedStrokes(event.data));
    },
    [queue],
  );

  useEffect(() => {
    const pane = paneRef.current;
    const ruler = rulerRef.current;
    if (!showing || resize === undefined || projectId === null || pane === null || ruler === null) {
      return;
    }
    let timer: number | undefined;
    const apply = () => {
      const size = measurePane(pane, ruler);
      // `null` is "no layout yet", not "very small". Sending a size derived
      // from a zero box would resize the session to the clamp floor.
      if (size === null || sameSize(sent.current, size)) return;
      sent.current = size;
      // Fire and forget: the answer is whether tmux did it, and the next
      // capture shows that better than any message could. A rejected bridge
      // call must not become an unhandled rejection over a cosmetic ask.
      // The ROW travels with it, so the session resized is the session whose
      // screen is being drawn: a project vam started two sessions in has two
      // panes, and only the session itself knows which one it is in.
      void resize(projectId, size.columns, size.rows, rowId).catch(() => undefined);
    };
    // The observer, and not a window `resize` listener: the pane changes width
    // when the pane RESIZER is dragged and when a layout preset moves the
    // canvas strip, neither of which resizes the window. `observe` delivers the
    // element's initial size, so this is also the first measurement.
    const observer = new ResizeObserver(() => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(apply, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(pane);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [showing, resize, projectId, rowId]);

  // Nothing is focused, so there is no project to ask about and the effect
  // above never asks. Saying "reading the session's screen" here -- which is
  // what the pending state below says -- would be vam claiming to be looking
  // at something it had not asked a single question about, forever.
  if (projectId === null) {
    return (
      <p data-terminal data-terminal-empty className="text-control text-ink-faint">
        No session selected — pick one in the sidebar.
      </p>
    );
  }
  if (view === null) {
    return (
      <p data-terminal data-terminal-pending className="text-control text-ink-faint">
        Reading the session’s screen…
      </p>
    );
  }
  if (view.kind === 'unavailable') {
    return (
      <p
        data-terminal
        data-terminal-unavailable
        data-terminal-code={view.error.code}
        className="text-control text-ink-faint"
      >
        {/* vam could not ask. Not "there is no session". */}
        {view.error.message}
      </p>
    );
  }
  if (view.kind === 'mispaired') {
    return (
      <p
        data-terminal
        data-terminal-empty
        data-terminal-mispaired
        className="text-control text-ink-faint"
      >
        {/* NOT "vam did not start a session for this one", which is what stood
            here and was false in the way that costs an operator time: vam did
            start sessions for this project, it just cannot prove that any of
            them is THIS row's. The row published the pane it believes it is
            in, and vam is refusing to substitute a different live session for
            it -- so the name it published is the one useful thing to say. The
            same refusal is why nothing is typed here: there is no pane
            element on this branch at all, so the surface cannot take a key it
            could not deliver. */}
        {`vam cannot tell which screen is this session's: it reports that it is running in the tmux pane ${view.published}, which is not one vam started for this project. Rather than show another session's screen, it is showing none.`}
      </p>
    );
  }
  if (view.kind !== 'ok') {
    return (
      <p data-terminal data-terminal-empty className="text-control text-ink-faint">
        {view.kind === 'gone'
          ? 'The tmux session vam started for this one has ended.'
          : view.kind === 'ambiguous'
            ? // Neither screen, and both names. Drawing one of them would be a
              // coin toss the operator has no way of seeing was tossed.
              `vam started more than one tmux session for this project, so it will not guess which screen you meant: ${view.names.join(', ')}.`
            : // No offer to connect to anything: vam can show the sessions it
              // started and no others, because no process can take over
              // another's controlling TTY.
              'vam did not start a tmux session for this one, so there is no screen to show.'}
      </p>
    );
  }
  return (
    /* TWO LINES USED TO STAND HERE and the operator asked for the space back:
       the tmux session's name, and a caption saying where the keys go. On a
       tab whose whole content is a screenful of someone's terminal, two rows
       of chrome above it is two rows of their work not shown.
       
       NEITHER FACT IS LOST. The session's name is in the pane's accessible
       name, where a reader that cannot see the box still gets it. And the
       caption's real job -- never look typable while swallowing what is typed
       -- is behaviour, not text: a key vam cannot deliver is not cancelled,
       so it goes back to vam's own keyboard (see `onKeyDown`), and a refusal
       still draws its own line, which is not one of the two removed. */
    <div data-terminal className="relative flex min-h-0 flex-1 flex-col gap-1.5">
      {/* THE THIRD EMPTY CASE, and the one `not-vam`/`unavailable` do not
          cover: a pane vam DID reach, showing nothing. That is a real screen
          -- the session exists, tmux answered, and the pane below is live and
          will take focus and keys -- so it is drawn as usual and not folded
          into `not-vam`'s "no screen to show". Without this line an empty
          capture and a broken read look identical: a blank rectangle with
          nothing said about it, which is the exact silence this tab exists to
          replace. `trim` because tmux pads every row to the pane's width, so
          a screen of only spaces is the same fact as an empty string. */}
      {view.text.trim() === '' && (
        <p data-terminal-blank className="flex-none text-control text-ink-faint">
          {
            "This session's screen is empty right now — vam reached the pane, there is just nothing drawn on it yet."
          }
        </p>
      )}
      {/* WHERE THE KEYS GO, said on the surface. A box that takes focus and
          swallows what is typed is worse than one that will not take focus,
          and there are two ways for this one to swallow: a build with no
          bridge behind it, and a keystroke main refused because it could no
          longer name a single session for this project. Both are sentences
          here rather than silence. */}
      {refused !== null && (
        <p
          data-terminal-refused
          data-terminal-refusal={refused}
          className="flex-none text-control text-ink-faint"
        >
          {refused === 'unaimed'
            ? // vam declined to guess: no session of its own answers for this
              // project, or two do.
              'vam did not type that: it can no longer name one session of its own for this project.'
            : refused === 'unavailable'
              ? // vam could not ask tmux at all, so it has nothing to say
                // about pairings -- and saying one failed sends the operator
                // after a cause nothing here has evidence for.
                'vam did not type that: it could not ask tmux, so it never looked for the session.'
              : refused === 'mispaired'
                ? // vam named a session and refused the one it named: the
                  // pane this row published is not one vam can use here.
                  'vam did not type that: this row is in a pane vam cannot use for this project.'
                : // tmux would not deliver to a session vam DID name -- almost
                  // always one that ended between the listing and the send, which
                  // the next read draws as `gone`. Sending the operator after a
                  // pairing problem here would send them after nothing.
                  'vam did not type that: tmux would not deliver it, so the session may have just ended.'}
          {' Anything typed behind it was dropped rather than sent into the gap.'}
        </p>
      )}
      {/* A FOCUS STOP, AND NOW A TYPING SURFACE -- and the second is why the
          first can no longer be justified by the old reasoning. It began as a
          scroll region: `vam-no-scrollbar` hides the bar, so without a focus
          stop there was no way at all, mouse or key, to read past the first
          screenful. That is still true, and the arrows, Page keys and
          Home/End still scroll here because they are still not bound.
          What changed is that printable keys and Return are bound, and are
          typed into a running agent. So this is no longer "a focus stop that
          activates nothing": it activates something on someone else's
          machine. It is therefore focused deliberately on arrival, and left by
          TAB -- Escape is not an exit here, it is one of the keys sent into
          the agent, which is the point of the pane. Tab is the way out, and it
          is said on the surface while the pane holds focus, by the corner
          badge below rather than by a row of chrome above: a surface that eats
          every key with no way out is the trap the sentence that stood here
          promised this was not. */}
      {/* AN INSERT SCOPE, AND AN INSERT STOP (`keyboard/focus-scope.ts`).
          While this pane holds the keyboard, printable keys are typed into
          somebody's running agent — which is as literally Insert as this
          application gets, and the status bar used to read Select through the
          whole of it. Marking it makes the bar honest here, and gives the pane
          a keyboard exit it did not have: `Mod-0` releases whatever is in an
          insert scope, and the comment above could previously only offer Tab
          because Escape is one of the keys this pane SENDS. */}
      {/* THE PANE IS NO LONGER THE TAB STOP; THE BOX INSIDE IT IS, and the
          reason is a focus trap rather than a preference. A container with
          `tabIndex={0}` sits BEFORE its own children in the focus order, so
          Shift+Tab out of the box lands back on the container, which hands the
          keyboard straight back to the box -- measured in Chromium, and there
          is no way backwards out of it. `tabIndex={-1}` keeps the one thing
          that still needs the pane itself to be focusable, which is
          `focusInsertStop`'s blind `.focus()` on the first `data-insert-stop`
          in the pane; the mark stays HERE, on the pane, so that `I` keeps
          landing on the surface every comment in this file describes and not
          on a hidden box. Focus is forwarded from here to the box a microtask
          later -- see `onFocus` below for why the delay is not a detail. */}
      <section
        ref={paneRef}
        data-terminal-pane
        {...insertScopeMark}
        {...insertStopMark}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onPointerDown={(event: PointerEvent<HTMLElement>) => {
          /**
           * THE GESTURE IS CAPTURED, WHICH IS THE WHOLE OF WHY IT CANNOT GET
           * STUCK -- and it is `PaneResizer.tsx`'s idiom, not a new one: "the
           * drag is held entirely by `setPointerCapture`/
           * `releasePointerCapture`", for this same reason.
           *
           * THE DEFECT IT FIXES, which shipped in the first cut of this pane
           * and was found in review. The suppression below is a boolean, and
           * this one was cleared by an `onPointerUp` ON THIS ELEMENT -- so it
           * was cleared only when the pointer came up OVER the pane. Press
           * inside and release outside, which is the ORDINARY way a person
           * drags out to select the last line of a terminal, and the pane was
           * not on the event's path at all: the flag stayed set for the life
           * of the component, the forward below returned early every time,
           * the box never took the keyboard again, and Vietnamese went
           * straight back to leaking `tieengs` into a running agent. It
           * self-healed on the SECOND keystroke (see `onKeyDown`), which is
           * precisely what made it invisible by hand -- only the first
           * character of the next syllable was typed raw.
           *
           * Capture ends on release, on cancel, AND when the element is
           * removed, and it retargets the release to this element wherever it
           * physically lands. Measured in Chromium both ways: without it, a
           * release outside fired `window`'s `pointerup` and never this
           * element's; with it, this element gets the release in both cases,
           * and the drag-selection this suppression exists to protect is
           * character-for-character identical.
           *
           * THE ORDER OF THESE TWO LINES IS THE FAIL-SAFE. The flag is set
           * only once the capture is actually held, so an engine that refuses
           * the capture degrades to possibly losing a selection -- never to a
           * pane whose keyboard does not come back.
           */
          event.currentTarget.setPointerCapture(event.pointerId);
          pointerDown.current = true;
        }}
        onLostPointerCapture={() => {
          pointerDown.current = false;
          // A DRAG THAT SELECTED SOMETHING KEEPS THE KEYBOARD ON THE PANE.
          // Focusing a text control collapses the document selection, so
          // taking the keyboard here would delete the selection the operator
          // just made -- and mouse selection is the only way there is to copy
          // text out of this tab. A plain click leaves nothing selected and
          // does hand it over, which is what a click on a terminal means.
          //
          // HERE RATHER THAN IN `onPointerUp` so that there is ONE place a
          // gesture can end: a cancelled pointer hands the keyboard back on
          // the same line a completed one does, instead of being a second
          // path nobody wrote.
          if (globalThis.getSelection()?.isCollapsed === false) return;
          takeKeyboard();
        }}
        onFocus={(event: FocusEvent<HTMLElement>) => {
          setHasFocus(true);
          // Only focus that landed on the PANE is forwarded; focus that landed
          // on the box is already where it belongs.
          if (event.target !== paneRef.current || pointerDown.current) return;
          /**
           * A MICROTASK, AND IT IS LOAD-BEARING. `focusInsertStop` focuses
           * this element and then asks `document.activeElement === stop` --
           * that answer IS what `I` reports, and a `false` makes the canvas
           * refuse out loud with "nothing in this pane takes the keyboard".
           * Forwarding synchronously makes that check fail every time.
           * Measured both ways in Chromium: deferred by one microtask, the
           * check still sees this element and the box has the keyboard before
           * anything can be typed into it.
           */
          queueMicrotask(takeKeyboard);
        }}
        onBlur={(event: FocusEvent<HTMLElement>) => {
          // Focus moving between the pane and its own hidden box is not the
          // operator leaving: without this the corner hint would blink off
          // and on at every forward, and `hasFocus` would be false while the
          // keys were still going to this session.
          if (paneRef.current?.contains(event.relatedTarget) === true) return;
          setHasFocus(false);
        }}
        aria-label={`terminal of ${view.name}: typing goes to this session, press Tab to leave`}
        /* THE 10.5px AND THE 1.45 BELOW ARE THE ONE LITERAL SIZE LEFT IN THE
           RENDERER, and they are a measurement rather than a style choice.
           `terminal-size.ts` divides this box by the advance of one character
           rendered HERE -- "Geist Mono at 10.5px measures 6.6015625px per
           advance", its own header records -- to decide the columns and rows
           tmux is told to compose at. Moving this onto the type scale would
           re-flow the operator's live session, and tmux has already wrapped the
           screen by the time vam sees it, so no CSS here could undo the break.
           The chrome AROUND the screen is on the scale; the screen is not.
           `test/renderer/type-scale.test.ts` names this as the exception.

           The sizes are spelled in prose above rather than as classes on
           purpose: that guard scans this file as TEXT, so a class name written
           in a comment counts as a call site. Reddening on a comment would be
           noise, and teaching the scan to strip comments would mean teaching
           it to strip `//` out of a URL in a string as well. */
        /* THE RING FOLLOWS THE BOX NOW. `focus-visible` on this element would
           never match again: the keyboard is one element deeper, and a
           container has no focus of its own to make visible. `has-[...]` keeps
           the browser's own heuristic -- a ring after a keyboard entry and
           none after a click -- rather than trading it for `focus-within`,
           which would draw one every time somebody clicks the screen. The
           token is unchanged, and `SettingsOverlay.tsx` still names this file
           as the renderer's one `focus-visible`. */
        className="vam-no-scrollbar relative min-h-0 flex-1 overflow-auto rounded-[9px] border border-line bg-panel px-3 py-2 font-mono text-[10.5px] text-ink leading-[1.45] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-line-strong"
      >
        {/* WHERE AN INPUT METHOD COMPOSES. See `inputRef` above for the whole
            of why this exists; what matters HERE is its shape.

            `sr-only` AND NOT `display: none` OR `visibility: hidden`: either
            of those makes the box unfocusable, which makes it useless -- an
            input method composes into whatever has the keyboard, and nothing
            is what a hidden box has. `sr-only` is the renderer's own
            already-used idiom for "laid out, one pixel, clipped", so it takes
            no space in the pane and draws nothing over the screen.

            NO INSERT MARK. `focusInsertStop` takes the FIRST
            `data-insert-stop` in the pane in document order and focuses it
            blindly; a mark here would make this box that first match, and `I`
            would land on a box instead of on the pane. The mode is right
            anyway, because it is derived from the `data-insert-scope` on the
            pane this sits INSIDE (`keyboard/focus-scope.ts`).

            `tabIndex={0}` because the pane's accessible name promises "press
            Tab to leave" and something in here has to be the stop that Tab
            arrives at and departs from. It is not read as a text field
            worth filling: it carries its own name saying what it is for, and
            the spelling helpers are off because a terminal is not prose. */}
        <textarea
          ref={inputRef}
          data-terminal-input
          rows={1}
          tabIndex={0}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          aria-label={`type into ${view.name}`}
          onKeyDown={onKeyDown}
          onCompositionStart={() => {
            composingNow.current = true;
            setComposing('');
          }}
          onCompositionUpdate={(event: CompositionEvent<HTMLTextAreaElement>) =>
            setComposing(event.data)
          }
          onCompositionEnd={onCompositionEnd}
          onInput={(event) => {
            // TEXT THAT ARRIVED WITHOUT A COMPOSITION IS DROPPED, and the ref
            // rather than the state is what decides (see `composingNow`). A
            // paste, a drop, the emoji picker and an Option-chord's own
            // character all land here; none of them is a keystroke, this
            // channel is bounded at sixteen characters precisely so that it
            // cannot become a paste into a running agent, and every one of
            // them typed nothing before this box existed. Emptying it is what
            // keeps that true -- and keeps a hidden box from quietly
            // accumulating the operator's clipboard.
            if (composingNow.current) return;
            event.currentTarget.value = '';
          }}
          className="sr-only"
        />
        {/* The ruler. It is INSIDE the pane so that it inherits the exact font
            family, size and line height the text is drawn in -- measuring a
            character anywhere else would measure a different character. It is
            transparent and out of the flow rather than `display: none`,
            because a box that is not laid out has no size to read; it is
            hidden from assistive tech and from the pointer, so nothing but the
            measurement notices it. */}
        <span
          ref={rulerRef}
          data-terminal-ruler
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 whitespace-pre opacity-0"
        >
          {RULER_TEXT}
        </span>
        {/* THE SCREEN, WITH THE AGENT'S OWN COLOURS. `capture-pane -e` keeps
            the SGR sequences and `terminal-ansi.ts` turns them into spans
            whose classes are theme tokens -- so an error line is red in both
            themes without vam choosing a red twice, and a sequence vam does
            not model is dropped rather than drawn.

            The lines are joined by real newlines inside ONE `pre` rather than
            wrapped in a block each: the pane's width is measured in
            characters of this exact font (`measurePane`), and a per-line box
            would be a second layout for tmux's own line breaks to disagree
            with. An empty line stays an empty line for the same reason. */}
        <pre className="whitespace-pre">
          {lines.map((spans, index) => (
            // The index IS the identity here: this is a screen, not a list,
            // and line 3 is line 3 whatever it says this second.
            // biome-ignore lint/suspicious/noArrayIndexKey: a screen line's identity is its position
            <Fragment key={index}>
              {spans.map((span, position) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: as above -- a run's identity is where it sits on the line
                  key={position}
                  /* The cursor's own cell, and the ONLY span that carries this
                     -- `placeCursor` splits the run it fell inside so that the
                     mark is exactly one cell wide (`terminal-cursor.ts`). */
                  data-terminal-cursor={span.cursor ? '' : undefined}
                  className={span.cursor ? CURSOR_CLASSES : spanClasses(span)}
                >
                  {span.text}
                </span>
              ))}
              {index < lines.length - 1 ? '\n' : null}
            </Fragment>
          ))}
        </pre>
      </section>
      {/* WHOSE TERMINAL THIS IS, and the way out of it, in one badge that
          costs no row.

          THE NAME WAS INVISIBLE AND THAT WAS A DEFECT OF MINE. When the two
          lines above the pane came off, the session's name went into the
          pane's `aria-label` -- which is real for a screen reader and nothing
          at all for the person looking at the screen. The operator asked for
          the CHROME back off the top, not for the identity to go with it, and
          then reported exactly that: switching to this tab, they cannot see
          which session they are looking at.

          It is the tmux session's name rather than the row's title because
          that is the fact this tab alone can tell them: the panel above
          already names the session, and a project vam started twice has two
          panes that only this name tells apart -- it is also what they would
          read in `tmux ls`.

          OUTSIDE THE SCROLLING BOX, positioned against the wrapper. Inside,
          it would be laid out against the pane's content and would scroll up
          out of sight with the first screenful. The bottom-right corner is
          the emptiest part of a terminal -- the prompt sits bottom-LEFT --
          and `pointer-events-none` keeps it from eating a click meant for the
          text under it. The exit is appended only while the pane has focus,
          because that is the only moment "how do I get out of here" is a
          question anyone is asking. */}
      <span
        data-terminal-badge
        aria-hidden="true"
        className="pointer-events-none absolute right-1.5 bottom-1 max-w-[60%] truncate rounded-[5px] border border-line bg-panel px-1.5 py-0.5 font-mono text-meta text-ink-faint"
      >
        {/* WHAT THE INPUT METHOD IS BUILDING, because the box it is building it
            in cannot be seen. A native terminal draws the in-flight candidate
            under the cursor; vam's screen is a one-second capture of a pane
            the syllable has not reached yet, so there is nothing there to
            draw it on. Without this line the operator types `tieengs` and
            watches an unchanged screen until the syllable commits, which is
            the same "the keys do nothing" the bug itself looked like. It
            rides the badge because that corner is already reserved and costs
            no row, and it comes FIRST because it is the transient fact --
            the name is still there when it goes. */}
        {composing !== '' && (
          <span data-terminal-composing className="text-ink">
            {composing}
            {' · '}
          </span>
        )}
        {view.name}
        {hasFocus && (
          <span data-terminal-exit-hint className="text-ink-quiet">
            {' · Tab leaves'}
          </span>
        )}
      </span>
    </div>
  );
}
