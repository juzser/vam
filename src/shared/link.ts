/**
 * WHICH ADDRESSES VAM WILL HAND TO A BROWSER -- one decision, in one place,
 * for a string a model typed.
 *
 * SHARED BECAUSE TWO PROCESSES MUST AGREE ABOUT IT, AND ONLY ONE OF THEM MAY
 * DECIDE IT -- `src/shared/issue.ts`'s rule, and the reason is sharper here.
 * `src/main/link/ipc.ts` is the only thing that can open anything, and it runs
 * this check itself, on its own side of the process boundary, whatever the
 * renderer believes. The renderer runs the SAME function purely so it can
 * refuse without a round trip and draw a refused link differently; if that
 * call were deleted tomorrow nothing would become openable. Two copies of this
 * list in two processes is a pair that can drift, and the drift would be
 * silent in the worst direction: a renderer that thinks `javascript:` is
 * refused sitting in front of a main that opens it.
 *
 * IT PARSES SOMEBODY ELSE'S AGENT'S OUTPUT. `terminal-ansi.ts`'s header
 * states the model this inherits: the bytes are whatever a program decided to
 * print, so this is a pure function over a string, it builds only data, it
 * never throws, and every shape it does not positively recognise is refused
 * rather than passed along. `new URL` is the parser, never a regular
 * expression over the raw text -- a regex decides what a string LOOKS like,
 * and the only thing that matters is what the URL parser, and therefore the
 * operating system, will make of it.
 *
 * WHAT IT REFUSES AND WHY, each of which is a real thing a model emits:
 *
 *  * ANY SCHEME OFF `OPENABLE_PROTOCOLS`. `shell.openExternal` is the
 *    operating system's "open this", so the scheme is the choice of which
 *    program runs: `file:` opens a local path, `vscode:`/`slack:`/`zoommtg:`
 *    hand arguments to an installed app, and `javascript:`/`data:` are the
 *    two that would be a script if any of this ever reached a navigation.
 *    http and https are the only two that mean "show a person a page".
 *
 *  * CREDENTIALS IN THE AUTHORITY. `https://github.com@evil.test/login`
 *    resolves to `evil.test`; the part read first is the part that lies, and
 *    this whole feature is built on the operator being able to SEE where a
 *    link goes. An address that hides its host is refused rather than drawn.
 *
 * AND WHAT IT DELIBERATELY DOES NOT REFUSE: a unicode host. It is answered in
 * the punycode form `new URL` normalises it to, which is what a browser would
 * really resolve -- so `exämple.test` is drawn as `xn--exmple-cua.test` and a
 * homograph stops being invisible. Refusing it outright would also refuse
 * every legitimate internationalised domain, which is a policy about the
 * world rather than about safety.
 *
 * THE ANSWER IS ALWAYS A SENTENCE. A control that can only refuse says so
 * (the house rule `FilesTab.tsx`'s `note` is held to), so `reason` is written
 * to be drawn verbatim next to the thing the operator pressed.
 */

/**
 * The two schemes vam opens. A frozen list rather than a `Set` so it reads as
 * data in both processes and in the tests that derive their expectations from
 * it.
 */
export const OPENABLE_PROTOCOLS = ['http:', 'https:'] as const;

/**
 * The bound on an address, and the same reasoning `MAX_ISSUE_FIELD` carries:
 * the renderer is the least trusted process here, and a huge string would be
 * parsed and handed to the operating system on main's single event loop
 * before anything else ran. 4,096 is past every real link -- the longest URL
 * vam itself composes, a prefilled issue form, is about a quarter of it --
 * and below the limits browsers and servers stop honouring anyway.
 */
export const MAX_LINK_LENGTH = 4_096;

/**
 * What a check answers: the address to open, or the sentence to show. The
 * SAME shape main's channel answers with, so a refusal decided in the
 * renderer and one decided in main are drawn by one branch rather than two.
 */
export type LinkOutcome =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

/** How much of a model's own text a refusal is allowed to quote back. */
const QUOTE_LIMIT = 80;

/** The schemes, spelled the way a person says them: "http or https". */
const spelledSchemes = (): string =>
  OPENABLE_PROTOCOLS.map((protocol) => protocol.slice(0, -1)).join(' or ');

/**
 * A model's own text, quoted back at a length that stays a sentence.
 * Rendered as React text and never as markup (`out-markdown.tsx`'s wall), so
 * the clip is about the size of the message, not about escaping.
 */
const quote = (text: string): string =>
  text.length <= QUOTE_LIMIT ? text : `${text.slice(0, QUOTE_LIMIT)}…`;

/**
 * Is this an address vam will open, and if not, why not.
 *
 * Takes `unknown` on purpose: main calls it on an argument the renderer chose,
 * so "not a string at all" is one of the answers rather than a type error
 * somebody else was supposed to have caught.
 */
export function checkLink(raw: unknown): LinkOutcome {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, reason: 'vam was given no address to open.' };
  }
  if (raw.length > MAX_LINK_LENGTH) {
    return {
      ok: false,
      reason: `that address is ${raw.length} characters; vam opens addresses up to ${MAX_LINK_LENGTH}.`,
    };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // No base is passed, deliberately: a relative reference has no host to
    // check and resolving it against vam's own page would invent one.
    return { ok: false, reason: `"${quote(raw)}" is not an address vam can read.` };
  }
  if (!(OPENABLE_PROTOCOLS as readonly string[]).includes(url.protocol)) {
    return {
      ok: false,
      reason: `vam opens ${spelledSchemes()} links only, and that one is ${url.protocol.slice(0, -1)}.`,
    };
  }
  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      reason: `that address hides its host behind a username; it would go to ${quote(url.hostname)}.`,
    };
  }
  // The PARSED form, never the typed one: it is what a browser would resolve,
  // with a unicode host already in punycode. See this file's header.
  return { ok: true, url: url.href };
}
