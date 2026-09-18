/**
 * WHICH ADDRESSES THE PRs TAB MAY HAND TO A BROWSER — a tighter bound than
 * `src/shared/link.ts`'s, for a narrower reason.
 *
 * `checkLink` next door governs an address a MODEL WROTE, in prose, and its
 * job is to let the operator follow any ordinary web link an agent mentioned:
 * http or https, to anywhere. This one governs an address vam's own PRs pane
 * puts behind a row, and the only thing that is ever meant to be behind that
 * row is a GitHub pull request. So the list of what it accepts is not "the
 * web" but one host, over one scheme.
 *
 * WHY NOT JUST REUSE `checkLink`. Because the input is not the same input.
 * `url` here is a field out of `gh pr list --json`, which is parsed CLI output
 * from a process vam spawned -- a value that arrives over a pipe and is
 * trusted no further than any other. `checkLink` would happily open
 * `https://anything.test/`, and the row it came from would still have read
 * "411 — fix the parser" on screen. The whole affordance of a clickable row
 * is that the operator knows where it goes without reading an address, so the
 * check has to be the thing that makes that true.
 *
 * SHARED BECAUSE TWO PROCESSES MUST AGREE ABOUT IT AND ONLY ONE OF THEM MAY
 * DECIDE IT -- `src/shared/link.ts`'s rule, verbatim, and it is load-bearing
 * in two directions here:
 *
 *  - MAIN runs it at the channel (`src/main/pr/ipc.ts`), on its own side of
 *    the process boundary, whatever the renderer believes. The renderer is the
 *    least trusted process in this app; deleting every other call to this
 *    function would change nothing about what can be opened.
 *  - The READER runs it while parsing (`sources/claude-code/pull-requests.ts`)
 *    so a row whose address vam would refuse draws no link at all, rather
 *    than a link that refuses when pressed. Absent, not dimmed.
 *
 * WHAT IT COSTS, SAID PLAINLY: a GitHub ENTERPRISE host is refused. `gh` can
 * be pointed at one, and its pull requests would list here perfectly well and
 * simply not be clickable. That is the operator's own bound -- "its host is
 * github.com" -- and widening it later is a decision about which hosts vam
 * trusts, not a bug fix, so it is written down rather than quietly generalised
 * into "any host gh happens to name".
 */

/** The one host. Not a suffix match: `github.com.evil.test` is not GitHub. */
export const PR_HOST = 'github.com';

/** The one scheme. `http:` is refused even to this host: it is downgradeable. */
export const PR_PROTOCOL = 'https:';

/**
 * The bound on an address, and `src/shared/link.ts`'s reasoning: the renderer
 * chooses this string, and a huge one would be parsed on main's single event
 * loop before anything else ran. A pull request address is about 50
 * characters.
 */
export const MAX_PR_LINK_LENGTH = 2_048;

/** What a check answers: the address to open, or the sentence to show. */
export type PrLinkOutcome =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Is this a pull request address vam will open, and if not, why not.
 *
 * Takes `unknown` on purpose, exactly as `checkLink` does: main calls it on an
 * argument the renderer chose, and the reader calls it on a field out of a
 * JSON payload, so "not a string at all" is one of the answers rather than a
 * type error somebody else was supposed to have caught.
 *
 * `new URL` is the parser, never a regular expression over the raw text. A
 * regex decides what a string LOOKS like; the only thing that matters is what
 * the URL parser -- and therefore the operating system -- will make of it.
 */
export function checkPrLink(raw: unknown): PrLinkOutcome {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, reason: 'vam was given no pull request address to open.' };
  }
  if (raw.length > MAX_PR_LINK_LENGTH) {
    return {
      ok: false,
      reason: `that address is ${raw.length} characters; vam opens addresses up to ${MAX_PR_LINK_LENGTH}.`,
    };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // No base is passed, deliberately: a relative reference has no host to
    // check, and resolving it against vam's own page would invent one.
    return { ok: false, reason: 'that is not an address vam can read.' };
  }
  if (url.protocol !== PR_PROTOCOL) {
    return {
      ok: false,
      reason: `vam opens pull requests over https only, and that one is ${url.protocol.slice(0, -1)}.`,
    };
  }
  // `hostname`, not `host`: a port is not part of the identity being checked
  // and `github.com:8443` is still not GitHub as vam knows it, so it is
  // refused by the equality below rather than passed with a port stripped.
  if (url.host !== PR_HOST) {
    return {
      ok: false,
      reason: `vam opens pull requests on ${PR_HOST} only, and that one is on ${url.host}.`,
    };
  }
  // Credentials in the authority are what `checkLink` refuses for the same
  // reason, and `url.host === PR_HOST` does NOT cover it: the username sits
  // before the host and is not part of it. It cannot redirect this address
  // anywhere else -- the host has already been pinned -- but it would send
  // the operator's browser to github.com carrying a login somebody else's
  // output chose, which is not a thing vam does on their behalf.
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'that address carries a username; vam will not open it.' };
  }
  // The PARSED form, never the typed one: it is what a browser would really
  // resolve. See `src/shared/link.ts`'s header on homographs.
  return { ok: true, url: url.href };
}
