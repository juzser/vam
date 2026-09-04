/**
 * The one route from a recorded event to anything that leaves the machine.
 *
 * vam is a PUBLIC repository, and its failure messages are assembled out of
 * the operator's own machine: absolute home paths, project directory names,
 * branch names, tmux session names, session ids, pids. An issue body pasted
 * from one of those verbatim publishes all of it, permanently, to a tracker
 * anyone can read. That is the entire risk of the report feature, so the
 * scrubber is a pure function with no I/O, no clock and no dependency on the
 * app -- everything a test can pin exhaustively -- and `report.ts` is the
 * only caller, which makes it the only door.
 *
 * WHAT IS REMOVED, and why each one is here rather than merely plausible:
 *
 *   1. Email addresses. `git`/`gh` errors name committers.
 *   2. Session ids: UUIDs and long hex runs. They identify a conversation and
 *      are useless to a maintainer who cannot open it.
 *   3. Quoted names -- `"..."`, `'...'`, `` `...` ``. Every operator-supplied
 *      string in vam's failure vocabulary arrives quoted: session titles,
 *      tmux session names, branch names, shell remedies. Redacting the quote
 *      rather than guessing at the vocabulary is what makes this rule hold
 *      for a message nobody has written yet.
 *   4. Home paths, whole. `~` alone would keep `code/sonnet-lane`, which
 *      names the operator's project and often their client; the tail goes too.
 *   5. The username, standalone, wherever it appears outside a path -- taken
 *      from the home directory and from any `/Users/<name>` in the text, so
 *      the browser build (which has no `homedir`) is covered by shape alone.
 *   6. Pids. A number that means nothing off the machine it was taken on.
 *
 * WHAT IS KEPT: the failure code, the surrounding prose, and plain counts --
 * "pairing refused, 3 live sessions share this cwd, 1 vam pane" survives
 * whole, because that sentence is the report. Keeping it is not a compromise
 * with the redaction; it is the reason redaction is worth doing rather than
 * simply refusing to report.
 *
 * PROMPT AND TRANSCRIPT TEXT is not on either list. It never enters an event
 * (see `log.ts` -- the type has nowhere to put it), so there is nothing here
 * to strip.
 */

/** The single placeholder, exported so a caller can assert on it. */
export const REDACTED = '<redacted>';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
const LONG_HEX = /\b[0-9a-fA-F]{12,}\b/g;
const DOUBLE_QUOTED = /"[^"]*"/g;
/** The leading group keeps an apostrophe in prose (`don't`) from opening a quote. */
const SINGLE_QUOTED = /(^|[\s([:=])'[^']+'/g;
const BACKTICKED = /`[^`]*`/g;
const HOME_PATH = /(?:\/Users|\/home)\/([A-Za-z0-9._-]+)(\/[^\s"'`,;)\]]*)?/g;
const PID = /\bpid[\s=:]+\d+/gi;

/** Regex-escape, so a username with a `.` in it cannot become a wildcard. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scrub one line of failure text.
 *
 * `homeDir` is optional on purpose: the renderer does not always know it (the
 * browser build at 127.0.0.1:5275 has no `os`), and the rules must not
 * degrade to nothing when it is absent. Passing it only adds the username of
 * a home directory that never appears as a path in the text.
 */
export function scrub(text: string, homeDir?: string): string {
  const names = new Set<string>();
  const fromHome = homeDir?.split('/').filter(Boolean).at(-1);
  if (fromHome !== undefined && fromHome.length > 0) names.add(fromHome);
  for (const match of text.matchAll(HOME_PATH)) {
    if (match[1] !== undefined) names.add(match[1]);
  }

  let out = text
    .replace(EMAIL, REDACTED)
    .replace(UUID, REDACTED)
    .replace(LONG_HEX, REDACTED)
    .replace(DOUBLE_QUOTED, `"${REDACTED}"`)
    .replace(SINGLE_QUOTED, `$1'${REDACTED}'`)
    .replace(BACKTICKED, `\`${REDACTED}\``)
    .replace(HOME_PATH, (_match, _user, tail: string | undefined) =>
      tail === undefined || tail === '' ? '~' : `~/${REDACTED}`,
    )
    .replace(PID, `pid ${REDACTED}`);

  for (const name of names) {
    out = out.replace(new RegExp(`\\b${literal(name)}\\b`, 'g'), REDACTED);
  }
  return out;
}
