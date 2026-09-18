/**
 * HOW MUCH TYPED TEXT IS ABOUT TO BE THROWN AWAY, as main understands it --
 * and the words it says about that before it throws it away.
 *
 * ── WHY MAIN HOLDS A COPY AT ALL ──────────────────────────────────────────
 * The Files tab keeps unsaved edits in renderer memory and nowhere else: there
 * is no draft on disk, by design (`renderer/panels/FilesTab.tsx`'s own
 * header). `beforeunload` covers the page going away. It does NOT cover Cmd-Q
 * -- `app.on('before-quit')` is a main-process veto, and main cannot read a
 * renderer's React state -- so the fact has to cross, and this is the shape it
 * crosses in.
 *
 * IT IS PUSHED, NOT PULLED, and that is the load-bearing decision. The obvious
 * design is for `before-quit` to ASK the renderer and wait for an answer. That
 * was rejected: a quit handler that waits on the renderer is a quit handler
 * that a wedged renderer can hang, and an app that cannot be quit is a WORSE
 * bug than the one this exists to fix -- it has to be force-killed, which
 * loses the same text plus every other session's state. So the renderer
 * reports its own state whenever that state changes (`CHANNELS.filesUnsaved`),
 * main keeps the last report, and `before-quit` reads a local variable. There
 * is no wait, so there is nothing to time out.
 *
 * WHAT THAT COSTS, NAMED: main's copy can be one IPC hop stale. Two cases,
 * both bounded. A renderer that goes quiet mid-edit leaves main holding the
 * last thing it said -- which is the SAFE direction, the operator gets asked.
 * A renderer that is reloading has not reported yet, and main may still hold
 * the report from before the reload, which shows a prompt about text that a
 * reload already discarded -- a false prompt, one keypress to dismiss, and the
 * fresh renderer corrects it on mount (it reports unconditionally, including
 * zero). Neither direction can silently lose text, which is the only property
 * that matters here.
 *
 * ── NO PATHS CROSS, ONLY LABELS ───────────────────────────────────────────
 * `names` are the same relative labels the tab itself draws (`relativeLabel`),
 * not absolute paths, and never file CONTENT. `src/main/files/ipc.ts`'s header
 * makes the content argument for refusals; it holds here for the same reason
 * and by the same means -- there is no code path that could put a byte of a
 * file into this message, because the renderer never sends one.
 *
 * ── NOTHING IN THIS FILE IMPORTS ANYTHING ─────────────────────────────────
 * Deliberate, and it is a constraint rather than an accident: `src/preload/
 * api.ts` imports `UnsavedReport` from here for the bridge member's signature,
 * and `src/renderer/App.tsx` imports that, so this module is dragged into
 * `tsconfig.web.json`'s program -- which carries no `node` types at all. The
 * same trap `src/main/files/types.ts`'s own header documents.
 */

/** What the renderer says it is holding: how many files, and which. */
export type UnsavedReport = {
  readonly count: number;
  readonly names: readonly string[];
};

/** The resting state, and the answer to every payload main cannot read. */
export const NOTHING_UNSAVED: UnsavedReport = { count: 0, names: [] };

/**
 * How many names are carried at all. The operator would have to have opened
 * and dirtied sixty-five files in one session for this to bite; the bound is
 * not about them, it is about a compromised renderer parking an unbounded
 * array on main's single event loop -- the same reasoning as
 * `ipc/handlers.ts`'s own `MAX_TEXT_LENGTH`, which states it in full.
 */
const MAX_NAMES = 64;
/** And how long one of them may be. A path this app can open is far shorter. */
const MAX_NAME_LENGTH = 256;
/**
 * And the ceiling on the count itself. Four digits, so the sentence built
 * below stays a sentence: the number is drawn in a modal the operator has to
 * read, and a renderer that claims a billion unsaved files must not be able to
 * choose how wide that modal is.
 */
const MAX_COUNT = 9_999;

/**
 * Whatever the renderer sent, as an `UnsavedReport`.
 *
 * TOTAL, AND IT FORGETS RATHER THAN INVENTS -- the same direction
 * `setPrRepoOverrides` chose for the same reason, sharpened by what is on the
 * other side of this one. A payload main cannot read becomes `NOTHING_UNSAVED`,
 * which means "do not stand in the way of the quit". The opposite default
 * would let one malformed message make vam refuse to close, with a dialog that
 * could say nothing true about why -- and vam's rule is that a prompt says
 * something true and specific or is not drawn.
 *
 * The cost of that direction is real and is not hidden: a renderer bug that
 * garbles this report silently retires the guard. It is mitigated by the
 * payload being as simple as a payload gets (a number and a list of strings)
 * and by the renderer's own end of it being asserted in
 * `test/panels/DetailPanel.files-tab.test.tsx` against the real component,
 * not against a mock of it.
 */
export function readUnsavedReport(raw: unknown): UnsavedReport {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return NOTHING_UNSAVED;
  const { count, names } = raw as { count?: unknown; names?: unknown };
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) return NOTHING_UNSAVED;
  const clean = Array.isArray(names)
    ? names
        .filter((name): name is string => typeof name === 'string' && name !== '')
        .slice(0, MAX_NAMES)
        .map((name) =>
          name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH)}…` : name,
        )
    : [];
  return { count: Math.min(count, MAX_COUNT), names: clean };
}

/** How many files the modal lists by name before it starts counting instead. */
const NAMES_SHOWN = 5;

/**
 * Exactly the fields handed to `dialog.showMessageBoxSync`, and no more.
 *
 * Its own type rather than electron's `MessageBoxSyncOptions` so this module
 * imports nothing (see the header). It is structurally assignable at the one
 * call site, which is where the compiler checks it.
 */
export type QuitPrompt = {
  readonly type: 'warning';
  readonly message: string;
  readonly detail: string;
  /** Mutable on purpose: electron's own option type takes a `string[]`. */
  readonly buttons: string[];
  readonly defaultId: number;
  readonly cancelId: number;
};

/**
 * THE WORDS. "You have unsaved changes" is the sentence this deliberately is
 * not: it is true of every unsaved-changes dialog ever drawn and tells the
 * operator nothing they can act on. This one says how many files and names
 * them, because the next thing the operator has to do is go and find them.
 *
 * ── THERE IS NO "SAVE ALL", AND THAT IS A DECISION, NOT AN OMISSION ───────
 * A save here can be REFUSED by main, and four of its refusals are ordinary
 * rather than exotic: `changed-on-disk` (an agent wrote the file while the
 * operator was editing it -- on this machine, with agents running, the common
 * case), `too-large`, `not-authorized` (the session whose directory authorised
 * the path has since exited) and `unreadable`. A "Save all" button therefore
 * has a real, likely outcome where it saves three files of four and then
 * quits, having promised in a button label that it saved them all. That is
 * strictly worse than not offering it: the operator would have no reason left
 * to check. Cancel and the file list are the honest pair -- vam says which
 * files, and the operator saves them where the refusals can actually be shown
 * and answered, which is the Files tab.
 *
 * ── AND CANCEL IS THE DEFAULT ─────────────────────────────────────────────
 * `defaultId` and `cancelId` are both the Cancel button, so Return and Escape
 * agree and the reflex answer is the one that loses nothing. The operator who
 * means it presses the other button.
 */
export function unsavedQuitPrompt(report: UnsavedReport): QuitPrompt {
  const shown = report.names.slice(0, NAMES_SHOWN);
  const unnamed = report.count - shown.length;
  const listed = unnamed > 0 ? [...shown, `…and ${unnamed} more`] : shown;
  return {
    type: 'warning',
    message:
      report.count === 1
        ? '1 file has unsaved changes.'
        : `${report.count} files have unsaved changes.`,
    detail:
      `${listed.join('\n')}\n\n` +
      'vam keeps no draft on disk, so quitting now discards this text. ' +
      'Cancel, save what you want to keep, then quit again.',
    buttons: ['Cancel', 'Quit anyway'],
    defaultId: 0,
    cancelId: 0,
  };
}
