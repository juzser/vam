/**
 * The one route from a recorded event to anything that leaves the machine.
 *
 * vam is a PUBLIC repository, and its failure messages are assembled out of
 * the operator's own machine: absolute home paths, project directory names,
 * branch names, tmux session names, session ids, pids. An issue body pasted
 * from one of those verbatim publishes all of it, permanently, to a tracker
 * anyone can read. That is the entire risk of the report feature, so the
 * scrubber is a pure function with no I/O, no clock and no dependency on the
 * app -- everything a test can cover exhaustively -- and `report.ts` is the
 * only caller, which makes it the only door.
 *
 * WHAT IS REMOVED, and why each one is here rather than merely plausible:
 *
 *   1. Email addresses. `git`/`gh` errors name committers.
 *   2. Session ids: UUIDs and hex runs of 12 or more, bounded by "not a hex
 *      digit" rather than by `\b` -- see NOT_HEX_BEFORE. They identify a
 *      conversation and are useless to a maintainer who cannot open it.
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
 *   7. tmux session names vam minted -- `vam-<project slug>-<tail>`. vam's
 *      own messages carry them UNQUOTED, so rule 3 never sees them, and the
 *      slug is the project label.
 *
 * WHAT IS NOT REMOVED, and the footer must not claim otherwise: an absolute
 * path outside `/Users` and `/home` (`/Volumes/clients/acme/payroll`, and the
 * `/var` socket paths a session record carries), and an unquoted project or
 * branch name arriving in free prose. Widening the path rule to every
 * absolute path was considered and refused: it would swallow the prose the
 * report exists to carry. The report is shown to the operator before they
 * submit it for exactly that reason.
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
/**
 * `\b` is the wrong boundary for an id: `_` is a word character, so a run of
 * hex abutting one gets no break and the whole id survives -- and the session
 * records vam reads carry exactly that shape (a short hex run, `_`, a long
 * one). The boundary that belongs here is "not another hex digit".
 */
const NOT_HEX_BEFORE = '(?<![0-9a-fA-F])';
const NOT_HEX_AFTER = '(?![0-9a-fA-F])';
const UUID = new RegExp(
  `${NOT_HEX_BEFORE}[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}${NOT_HEX_AFTER}`,
  'g',
);
const LONG_HEX = new RegExp(`${NOT_HEX_BEFORE}[0-9a-fA-F]{12,}${NOT_HEX_AFTER}`, 'g');
const DOUBLE_QUOTED = /"([^"]*)"/g;
/** The leading group keeps an apostrophe in prose (`don't`) from opening a quote. */
const SINGLE_QUOTED = /(^|[\s([:=])'([^']+)'/g;
const BACKTICKED = /`([^`]*)`/g;
/**
 * `:` IS IN THE TAIL'S EXCLUSION CLASS, and it was not.
 *
 * A unix error names a path and then explains itself with a colon --
 * "can't create session: /Users/x/code/acme: No such file or directory" -- and
 * without `:` here the colon is part of the path match and disappears with it,
 * leaving two clauses run together ("~/<redacted> No such file or directory")
 * that read as a truncated message rather than a redacted one. The colon
 * belongs to the sentence.
 *
 * It costs a path that really contains a colon its tail, which is legal on
 * every platform vam runs on and is vanishingly rarer than `path: reason`. The
 * PREFIX is redacted either way, which is the part that carries the username
 * and the project.
 */
const HOME_PATH = /(?:\/Users|\/home)\/([A-Za-z0-9._-]+)(\/[^\s"'`,;:)\]]*)?/g;
const PID = /\bpid[\s=:]+\d+/gi;
/**
 * A tmux session name vam created. `vam-<slug of the project label>-<tail>`
 * (`tmux/argv.ts`), and vam's OWN failure messages interpolate it bare --
 * `creating session vam-acme-corp-payroll-a1b2c3` -- so the quoted-name rule
 * never sees it and the project label went out whole. Redacting by prefix
 * needs no vocabulary, and it is deliberately generous rather than exact:
 * `vam-cli` written in prose goes too. Over-redacting a word a maintainer
 * could have guessed costs a sentence; under-redacting costs the project
 * label, permanently and in public.
 */
const VAM_SESSION = /\bvam-[A-Za-z0-9_-]+/g;

/**
 * VAM'S OWN VOCABULARY, which the quoted-name rules must not eat.
 *
 * The rules that redact anything in quotes or backticks are right about the
 * operator's data -- a session title, a branch, a tmux name -- and wrong about
 * vam's own words, which is how the one actionable fact in a message went
 * missing. `tmux/spawn.ts` writes "the `tmux` command was not found", and what
 * arrived named nothing at all; `deliver.ts` carries Claude Code's own remedy,
 * "Use 'claude attach' to attach to it", and the remedy was the part deleted.
 * `report.ts` learned this shape for the body it composes ("it would swallow
 * the failure code") and never checked the messages it composes the body OUT
 * OF. None of these words come from the machine: they are literals in this
 * repository and in the CLIs it drives.
 *
 * A CLOSED LIST, NOT A SHAPE TEST, and that is the whole safety argument. A
 * rule like "keep a quoted run that looks like a command" would keep a session
 * titled "claude fixes" the moment someone named one that; a run survives here
 * only if EVERY word in it is on this list or is a flag, so an unknown word
 * anywhere in the run redacts the whole run exactly as before. Adding a word
 * is a deliberate act, and the cost of NOT adding one is a redaction, which is
 * the safe direction to fail in.
 */
const OWN_WORDS: ReadonlySet<string> = new Set([
  // The binaries vam spawns, and the ones it names in its own failure text.
  'claude',
  'tmux',
  'gh',
  'git',
  'tailscale',
  // The subcommands those failures actually print.
  'attach',
  'stop',
  'resume',
  'init',
  'serve',
  'funnel',
  'has-session',
  'new-session',
  'send-keys',
  'kill-session',
  'list-sessions',
  'display-message',
  'set-option',
  'capture-pane',
  'rev-parse',
]);
/** A flag, which carries no name: `-p`, `--print`, `--dangerously-skip`. */
const FLAG = /^--?[a-z][a-z0-9-]*$/;

/**
 * Is this quoted run vam's own vocabulary rather than a name off the machine?
 *
 * Bounded at four words because every real one is one or two ("tmux",
 * "claude attach"), and a long run of allowlisted words is likelier to be
 * something else that happens to be made of them.
 */
function ownVocabulary(inner: string): boolean {
  const words = inner.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  return words.every((word) => OWN_WORDS.has(word) || FLAG.test(word));
}

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
    // Each quoting rule asks `ownVocabulary` about what it captured before
    // replacing it -- see that function. A run that is not vam's own words is
    // redacted exactly as it always was.
    .replace(DOUBLE_QUOTED, (match, inner: string) =>
      ownVocabulary(inner) ? match : `"${REDACTED}"`,
    )
    .replace(SINGLE_QUOTED, (match, lead: string, inner: string) =>
      ownVocabulary(inner) ? match : `${lead}'${REDACTED}'`,
    )
    .replace(BACKTICKED, (match, inner: string) =>
      ownVocabulary(inner) ? match : `\`${REDACTED}\``,
    )
    .replace(HOME_PATH, (_match, _user, tail: string | undefined) =>
      tail === undefined || tail === '' ? '~' : `~/${REDACTED}`,
    )
    .replace(PID, `pid ${REDACTED}`)
    .replace(VAM_SESSION, REDACTED);

  for (const name of names) {
    out = out.replace(new RegExp(`\\b${literal(name)}\\b`, 'g'), REDACTED);
  }
  return out;
}
