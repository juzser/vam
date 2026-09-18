/**
 * WHAT A LINK PILL PRINTS -- the host, the text, and how a long path folds --
 * as pure functions over two strings, so `out-markdown.tsx`'s `OutLink` only
 * has to draw.
 *
 * THE COMPLAINT THIS ANSWERS. Operator: "the sources in an answer should be
 * displayed compactly, as a tag or pill with a hyperlink." The old control
 * printed the link's text and then the WHOLE parsed address after it, in mono,
 * in brackets: `runbook (https://example.test/runbook)`, 262px wide at the
 * shipped 13px (measured in Chromium before this file existed; the pill it
 * became is measured in `e2e/out-links-shots.mjs`). A "Sources:" list of three
 * was three such lines, and when an agent writes the URL as its own text --
 * `<https://github.com/juzser/vam/pull/383>` -- the reading eye got the same
 * address twice.
 *
 * WHAT THE PILL KEEPS from that rendering is the property it existed for: the
 * operator can SEE where a control goes before pressing it, because a link
 * text can say one thing and go to another. The pill prints the HOST beside
 * the text -- `runbook · example.test` -- and the full parsed address stays
 * in the DOM on `data-out-address`, in a screen-reader span, and in the
 * `Note` that opens on hover and on focus. The host is the part of an address
 * that decides where a click goes; the path is detail the tooltip carries.
 *
 * WHY THE SELF-NAMED CASE PRINTS HOST + PATH RATHER THAN HOST TWICE. When the
 * text IS the address, "text · host" would be `github.com/juzser/vam/pull/383
 * · github.com`, which is the double reading this replaces. So that case
 * prints the host once, loud, and the path after it, quiet, folded in the
 * MIDDLE past `FOLD_LIMIT` characters. Middle rather than tail because the
 * tail is where `/pull/383` and `?tab=readme` live -- a tail-ellipsis keeps
 * the part every link to one host shares and drops the part that tells them
 * apart.
 *
 * EVERYTHING HERE READS THE PARSED FORM (`new URL`), never the typed one, for
 * the reason `src/shared/link.ts` gives: a unicode host arrives as punycode,
 * so a homograph stops being invisible exactly where the operator is being
 * asked to trust what they read. And, as there, nothing throws: these are
 * functions over a model's own text and every shape they do not recognise is
 * answered with `null` or the text itself.
 */

/**
 * How many characters of a path the self-named pill shows before folding.
 * Twenty-four holds `/juzser/vam/pull/383` (20) whole -- the shape a PR link
 * has -- and folds a tracking-laden `/a/very/long/path?utm_source=…` to one
 * line of the 408px default pane beside its host.
 */
export const FOLD_LIMIT = 24;

/**
 * `text`, shortened to at most `max` characters with one `…` in the middle.
 *
 * Counts CODE POINTS (`[...text]`), not UTF-16 units: a parsed URL's path is
 * percent-encoded ASCII, but this also folds a link text a model wrote, and
 * slicing a string by index can cut an astral character into two halves that
 * render as replacement marks.
 */
export function foldMiddle(text: string, max = FOLD_LIMIT): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  if (max <= 1) return '…';
  // The head gets the odd character: `/a/very/long` reads as a start and
  // `with=query` as an end, and when they cannot be equal the start is the
  // one the eye reaches first.
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`;
}

/**
 * The host of a parsed address and everything after it, or null for text
 * `new URL` cannot read.
 *
 * `host`, not `hostname`: a non-default port is part of where a click goes.
 * The lone `/` `new URL` adds to a bare `https://github.com` is dropped from
 * `rest`, because the operator wrote a host and should read one.
 */
export function linkParts(
  address: string,
): { readonly host: string; readonly rest: string } | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const rest = `${url.pathname}${url.search}${url.hash}`;
  return { host: url.host, rest: rest === '/' ? '' : rest };
}

/** An address with its scheme, its trailing slash and its edges taken off. */
const bare = (text: string): string =>
  text
    .trim()
    .replace(/^[a-z][a-z\d+.-]*:\/\//i, '')
    .replace(/\/$/, '');

/**
 * Is `text` nothing but its own `address`?
 *
 * Compared with the scheme and trailing slash removed from both, because the
 * same address is spelled twice on the way here: a gfm autolink literal's text
 * is `www.example.com` while remark's href is `http://www.example.com`, and
 * `[https://github.com](https://github.com)` reaches this as a text without
 * the slash `new URL` will put on the parsed form. The comparison is EXACT
 * past that: `[https://github.com/a](https://github.com/b)` is a named link
 * whose name is a lie, and `[https://github.com/x](https://evil.test/phish)`
 * is the homograph the address hint exists to expose -- neither may print its
 * text as if it were the destination.
 */
export function textIsAddress(text: string, address: string): boolean {
  const t = bare(text);
  if (t === '') return false;
  if (t === bare(address)) return true;
  const parts = linkParts(address);
  return parts !== null && t === bare(`${parts.host}${parts.rest}`);
}

/**
 * The quiet half of a NAMED link: where it goes, in the fewest characters
 * that still say so.
 *
 * The host when the address has one; the scheme when it has none -- which is
 * every refused `javascript:`, `data:` and `mailto:`, and naming the scheme
 * is naming what was refused; the raw text, folded, when nothing parsed at
 * all; and nothing for an empty href, which `checkLink` already refuses as
 * "no address to open".
 */
export function linkWhere(href: string): string | null {
  if (href.trim() === '') return null;
  const parts = linkParts(href);
  if (parts === null) return foldMiddle(href);
  if (parts.host !== '') return parts.host;
  return new URL(href).protocol;
}

/**
 * Whether a link's TEXT is itself address-shaped -- `https://…`, or a bare
 * `host/path` an agent wrote without a scheme.
 *
 * WHY THIS EXISTS, AND IT IS THE ONE THING THE QUIET PILL STILL DERIVES FROM
 * THE ADDRESS. `[https://github.com/juzser/vam](https://evil.test/phish)` is
 * one line of markdown, and the pill prints a NAME (`OutLink`): print that
 * text and the control paints a destination it does not have. The old pill
 * could not be fooled -- it printed the real host beside the name -- and the
 * operator has since asked for the caption to go. So the caption goes and
 * this takes its place, for the narrow case that needed it: a text that LOOKS
 * like an address but is not THIS address is not a name, and the pill prints
 * the real host instead. A text that is not address-shaped at all ("runbook",
 * "the PR") is a name and is printed untouched, which is every ordinary link.
 *
 * DELIBERATELY GENEROUS ABOUT WHAT COUNTS AS ADDRESS-SHAPED. A false positive
 * costs a link named `example.test` its name and shows the same host instead;
 * a false negative paints a lie. The two errors are not the same size.
 */
export function textLooksLikeAddress(text: string): boolean {
  const t = text.trim();
  if (t === '' || /\s/.test(t)) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(t)) return true;
  // A bare `host.tld` or `host.tld/path`: a dot inside a leading label that is
  // not a sentence. `foo.ts:42` is handled before this ever runs (`FileRef`),
  // and a trailing full stop is punctuation, not a domain.
  return /^[a-z\d-]+(\.[a-z\d-]+)+(\/|$)/i.test(t);
}
