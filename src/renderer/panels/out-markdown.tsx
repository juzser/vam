/**
 * HOW AN AGENT'S MARKDOWN IS DRESSED, in vam's own tokens -- and the wall that
 * makes rendering somebody else's text safe.
 *
 * THIS LIVED IN `DetailPanel.tsx` and moved out when it got a SECOND caller.
 * `FilesTab.tsx` previews a `.md` the operator opened, and importing this from
 * `DetailPanel.tsx` -- which imports `FilesTab.tsx` -- would have been an
 * import cycle whose only defence is that nothing reads the binding at module
 * scope. The map is shared now because it really is shared; nothing about it
 * changed in the move, and `DetailPanel.tsx` re-exports `OUT_MARKDOWN` so the
 * guards that import it from there still reach it.
 *
 * ONE MAP FOR BOTH SURFACES, AND THAT IS THE POINT RATHER THAN A SAVING. The
 * transcript and the file preview render UNTRUSTED text -- an agent's answer
 * in one case, a file on disk in the other, which on this machine is usually
 * the same agent's output one step removed. A second component map for the
 * second surface would be a second set of decisions about `a`, `img` and raw
 * HTML, and the second set is the one nobody re-derives.
 *
 * NOTHING HERE ENABLES `rehype-raw` OR HANDS A STRING TO `innerHTML`, and that
 * is not an omission: react-markdown parses to React elements and DROPS
 * embedded HTML by default, which is the property this library was chosen for.
 * A `<script>` in the text reaches the DOM as the CHARACTERS of a `<script>`.
 * `highlight.ts` says the same thing from the other side -- it returns
 * `{ text, kind }` records rather than a string of spans precisely so this
 * hole cannot be reopened by a highlighter.
 */

import { Ban, ExternalLink } from 'lucide-react';
import {
  createContext,
  Fragment,
  isValidElement,
  type ReactNode,
  useContext,
  useState,
} from 'react';
import type { Components } from 'react-markdown';
import { type FileRef, parseFileRef, splitFileRefs } from '../../shared/file-ref.js';
import { checkLink } from '../../shared/link.js';
import {
  type DiffKind,
  diffLineKind,
  type HighlightLang,
  resolveLang,
  SYNTAX_CLASS,
  tokenizeCode,
} from './highlight.js';
import { linkParts, textIsAddress, textLooksLikeAddress } from './link-face.js';
import { Note } from './Note.js';
import { useOutActions } from './out-actions.js';

/**
 * How each markdown element is dressed, in vam's own tokens.
 *
 * Every colour here is a token from `styles.css`, which carries a dark and a
 * light value for each — so this follows the theme rather than pinning one
 * half of it. The body keeps the size and colour the flat rendering already
 * had (12px/1.6 in `ink-dim`, measured off the mockup's Response artboards);
 * everything else is built around that so a heading or a table reads as a
 * step up from the body rather than as a different app.
 *
 * Two elements get their own scroller: a fenced block and a table have no
 * width of their own and this pane is resizable and 408px by default, so
 * without it the widest line in an answer decides how wide the pane is.
 *
 * `a` and `img` are the two that do NOT render as themselves, and the reason
 * is the same for both: `out` is an AGENT's text, which vam cannot vouch for.
 * An image would be a remote fetch that tells whoever wrote the answer that
 * this pane opened -- so `img` is still only its alt text, unchanged.
 *
 * `a` USED TO BE THE SAME REFUSAL, and three quarters of that reasoning is
 * still standing. It read: "a link would be a control that does nothing: the
 * shell denies `window.open` and every off-origin navigation (see src/main),
 * which is the correct policy. So the address is printed instead, in a region
 * where text is selectable, and opening it is a deliberate copy-and-paste."
 *
 * The POLICY is correct and is untouched -- nothing here renders an `<a
 * href>`, because a real anchor in this window navigates THE WHOLE
 * APPLICATION away and the window IS the app. The destination is still
 * shown, because a link text can say one thing and go to another and the
 * operator has to be able to see where they are about to be sent. What was
 * wrong was only the CONCLUSION: "a control that does nothing" was treated
 * as the end of the argument rather than as a defect, and it left the
 * operator copy-and-pasting an address out of a panel by hand -- the same
 * complaint `src/main/issue/ipc.ts` was filed about.
 *
 * So the address is now a BUTTON that asks main to open it in the operator's
 * own browser (`CHANNELS.linkOpen`), and what pays for that is the scheme
 * allowlist in `src/shared/link.ts` -- enforced in MAIN, where the guarantee
 * lives, and run here too so a refused address can be refused in words
 * instead of in a round trip. `javascript:`, `data:`, `file:` and every app
 * scheme are refused; the refusal is drawn next to the control that was
 * pressed rather than swallowed, because a control which can only refuse says
 * so. The button is drawn as ONE PILL -- the text, then the host, then a
 * glyph -- and `OutLink` below says what of the old printed address went
 * where.
 *
 * AND ONE MORE THING BECAME A CONTROL: `src/foo/bar.ts:42`, the artifact
 * agents write constantly. It opens that file, at that line, in this pane's
 * own Files tab -- resolved and authorised in main against the session's own
 * working directory (`src/main/files/resolve-ipc.ts`). `src/shared/file-ref.ts`
 * owns what counts as one and why the rules are so narrow.
 */
const DIFF_CLASS: Record<DiffKind, string> = {
  plain: '',
  add: 'text-diff-add',
  del: 'text-diff-del',
  hunk: 'text-diff-hunk',
  file: 'text-diff-file',
};

/**
 * The `<code>` react-markdown puts inside a `<pre>`, read back as text plus
 * the fence's infostring.
 *
 * Returns null rather than guessing whenever the child is not the single plain
 * string a fence produces — a fence whose content is anything else is rendered
 * exactly as it was.
 */
function readFence(
  children: ReactNode,
): { readonly code: string; readonly lang: string | null } | null {
  const only = Array.isArray(children) && children.length === 1 ? children[0] : children;
  if (!isValidElement<{ className?: string; children?: ReactNode }>(only)) return null;
  const inner = only.props.children;
  const code =
    typeof inner === 'string'
      ? inner
      : Array.isArray(inner) && inner.every((k) => typeof k === 'string')
        ? inner.join('')
        : null;
  if (code === null) return null;
  return { code, lang: /language-([\w+#-]+)/.exec(only.props.className ?? '')?.[1] ?? null };
}

/**
 * A fence, coloured.
 *
 * Elements, never an HTML string: `out` is untrusted text and this is the wall
 * `OUT_MARKDOWN`'s note describes. A `<script>` an agent printed reaches the
 * DOM here as the characters of a `<script>`, as it did before there was any
 * colour at all.
 */
function Fence({ code, lang }: { readonly code: string; readonly lang: HighlightLang }) {
  // Keyed by BYTE OFFSET, not by list index: offsets are unique even when the
  // same line or the same token repeats, which in a patch they constantly do.
  let at = 0;
  const parts: { readonly key: string; readonly text: string; readonly cls: string }[] = [];
  if (lang === 'diff') {
    const lines = code.split('\n');
    for (const [i, line] of lines.entries()) {
      const text = i === lines.length - 1 ? line : `${line}\n`;
      parts.push({ key: `${at}`, text, cls: DIFF_CLASS[diffLineKind(line)] });
      at += text.length;
    }
  } else {
    for (const tok of tokenizeCode(code, lang)) {
      parts.push({ key: `${at}`, text: tok.text, cls: SYNTAX_CLASS[tok.kind] });
      at += tok.text.length;
    }
  }
  // Wrapped in a `<code>`, unclassed: the untouched path keeps react-markdown's
  // `<pre><code>`, so this one must too, or the fence's DOM shape would depend
  // on its infostring and the `<pre>`'s own `[&_code]` rules would reach only
  // half the fences. Unclassed because those rules are exactly what is left of
  // the chip styling once the `<pre>` has reset it.
  return (
    <code>
      {parts.map((part) => (
        <span key={part.key} className={part.cls}>
          {part.text}
        </span>
      ))}
    </code>
  );
}

/**
 * THE URL react-markdown HANDS `a:` -- UNTOUCHED, ON PURPOSE, AND THIS IS A
 * NARROWING RATHER THAN A WIDENING.
 *
 * react-markdown's `defaultUrlTransform` replaces the href of anything outside
 * `/^(https?|ircs?|mailto|xmpp)$/i` with the empty string. Left in place, vam
 * would have TWO scheme lists deciding one question -- theirs, invisible,
 * admitting four schemes vam does not; and `src/shared/link.ts`, which is the
 * one main enforces. The visible symptom was the refusal: a `javascript:` link
 * arrived here as `''`, so the control could only say "vam was given no
 * address", which tells the operator nothing about what it declined.
 *
 * So vam takes the href as written and answers for it itself. Nothing is
 * widened by that: `checkLink` admits `http:` and `https:` and nothing else,
 * which is strictly fewer than the list this replaces -- `mailto:` and `irc:`
 * are refused here and were allowed there -- and no raw href reaches the DOM
 * in any case, because `a` renders a BUTTON and `img` renders its alt text.
 * `test/panels/out-links.test.tsx` pins the `mailto:` case for exactly that
 * reason: it is the one that would go quiet if this were ever reverted.
 *
 * EXPORTED so the two `<Markdown>` call sites (`DetailPanel.tsx`'s transcript
 * and `FilesTab.tsx`'s preview) name one constant rather than two identical
 * inline functions that can drift apart.
 */
export const OUT_URL_TRANSFORM = (url: string): string => url;

/**
 * IS THIS `<code>` INSIDE A FENCE? The parent knows and the child cannot.
 *
 * react-markdown stopped telling a `code` component which of the two it is,
 * and the `pre` rule below already relied on "the parent knows without being
 * told" for the STYLING reset. Styling was a safe thing to decide that way;
 * whether to turn `src/a.ts:1` into a button is not. A fence is a QUOTATION --
 * a patch is nothing but paths and line numbers, and a wall of buttons is not
 * a diff any more.
 *
 * THE CASE THAT MADE THIS A CONTEXT RATHER THAN A COMMENT: `pre` renders its
 * own coloured `Fence` when it recognises the infostring, and falls back to
 * react-markdown's `<code>` -- the SAME component inline code uses -- when it
 * does not. So a fence tagged ```brainfuck would have gone down the inline
 * path with nothing to distinguish it. The provider is set on the WHOLE `pre`
 * rather than on the fallback alone, so the two paths cannot drift.
 */
const Fenced = createContext(false);

/**
 * What a refusal looks like when the operator presses something that cannot
 * act: one sentence, beside the control, in the tone the rest of the pane uses
 * for a decline.
 *
 * `role="status"` and not `alert`, the same choice `FilesTab.tsx`'s own note
 * makes: it appears immediately after the key or click the operator made, and
 * assertive would interrupt a screen reader to repeat something they just did.
 */
function Refusal({ text }: { readonly text: string }) {
  return (
    <span role="status" className="font-mono text-[0.875em] text-failed">
      {' '}
      {text}
    </span>
  );
}

/**
 * The plain text of a link's children, or null when markdown put an element
 * inside the brackets (`[**bold** name](…)`): only a plain text can BE the
 * address, and a label with markup in it is drawn as it came.
 */
function plainText(children: ReactNode): string | null {
  if (typeof children === 'string') return children;
  if (Array.isArray(children) && children.every((k) => typeof k === 'string')) {
    return children.join('');
  }
  return null;
}

/** What a link with no href at all is refused with -- `checkLink`'s own words. */
const NO_ADDRESS = 'vam was given no address to open.';

/**
 * A LINK AN AGENT WROTE, as a button and never as an anchor -- drawn as ONE
 * PILL: `[ name ↗ ]`.
 *
 * Operator: "the sources in an answer should be displayed compactly, as a tag
 * or pill with a hyperlink." The control this replaces printed the text and
 * then the whole parsed address after it, in mono, in brackets -- 262px for
 * `runbook (https://example.test/runbook)` at the shipped 13px, and when the
 * text WAS the address the eye read it twice.
 *
 * QUIETER AGAIN, at the operator's second reading: "the source pill should be
 * much smaller, no border, a dark background with opacity so the sources look
 * tidier; only the name and the icon, no shortened link; and the link colour
 * should be the normal one, not a different colour." So the pill is a NAME and
 * a glyph on a wash, and each of those three is a deliberate subtraction:
 *
 *   - NO BORDER, NO SECOND COLOUR. The words take the paragraph's own ink --
 *     no class at all, so they inherit whatever the prose around them is
 *     wearing -- and the ground is `--color-out-pill`, black at a low alpha
 *     (`styles.css` carries the measurement). A link in a paragraph is not a
 *     button on a toolbar; it should read as the sentence it is part of.
 *   - NO ADDRESS IN THE PILL. Not the path and not a folded version of it.
 *     `foldMiddle` and `linkWhere` are no longer called from here; they stay
 *     exported and tested in `link-face.ts`, which is the module that owns
 *     "how an address is made readable" whether or not this control asks.
 *   - SMALLER: no border to pay for, `px-1`, and a glyph at `0.8em`.
 *
 * WHAT MAKES IT READ AS A LINK, then, since neither colour nor a border does:
 * the GLYPH at its end, which is a shape rather than a hue and so is the
 * non-colour indicator WCAG 1.4.1 asks for, plus the wash the name sits on.
 * The web guard asserts the glyph on every pill for exactly that reason -- it
 * is now the whole of the affordance, and a pill that lost it would look like
 * a phrase with a grey background.
 *
 * WHERE THE ADDRESS WENT, because the property it carried must survive: "no
 * anchor" is also satisfied by drawing nothing, and what the operator needs is
 * to SEE where a control goes before pressing it. The full parsed address is
 * on the button as `data-out-address` (what the web guard reads), in the
 * `Note` that opens on hover and on keyboard focus (the house rule `Note.tsx`
 * states: a `title` opens on hover and on nothing else), and in a
 * screen-reader-only span. What changed is that it is no longer PAINTED in
 * the flow of the sentence; every way of asking for it still answers.
 *
 * WHAT IS DRAWN IS THE PARSED ADDRESS, not the typed one -- `checkLink`
 * answers `new URL(...).href`, so a unicode host arrives here already in
 * punycode and a homograph stops being invisible. An address vam cannot read
 * at all has nothing parsed to show, so its own text is printed instead,
 * folded: something unreadable is still better than nothing.
 *
 * A SELF-NAMED LINK -- `<https://github.com/juzser/vam/pull/383>`, the shape
 * a "Sources:" list is usually written in -- has no name of its own to print,
 * so its HOST is the name: `github.com`, not the path, which is the one thing
 * on this control that is still derived from the address. It is the part that
 * decides where a click lands and the part a reader would call the source by.
 * `link-face.ts` decides which case a link is in.
 *
 * A REFUSED ONE IS THE SAME PILL in the faint ink, with a `Ban` glyph in place
 * of the arrow -- a control that can only refuse says so before it is pressed.
 * It keeps a colour difference where the live pill gave one up, because
 * "this one is not like the others" is exactly what it has to say, and it
 * names the scheme it refused, a `javascript:` address having no host.
 *
 * PRESSING A REFUSED ONE IS NOT A NO-OP. The scheme check runs here first so
 * a refusal costs no round trip, and it is a CONVENIENCE: main runs the same
 * check on its own side of the boundary and would refuse the identical
 * address if this component sent it anyway (`src/main/link/ipc.ts`).
 *
 * SIZES ARE `em`, LIKE EVERYTHING ELSE IN THIS MAP, and not the `text-meta`
 * the sidebar's pills wear: `--text-meta` is a flat 11px, and a pixel inside
 * `out` is an element that ignores the reading-size setting for ever
 * (`out-font-size.test.tsx`). The host takes the old hint's 0.875em; a
 * self-named address takes the inline chip's 0.917em, because it IS a
 * machine string and reads as a peer of the `path:line` chip beside it.
 */
function OutLink({ href, children }: { readonly href?: string; readonly children: ReactNode }) {
  const { openLink } = useOutActions();
  const [note, setNote] = useState<string | null>(null);
  const checked = href === undefined ? null : checkLink(href);
  const ok = checked?.ok === true;
  const address = checked?.ok === true ? checked.url : href;
  const text = plainText(children);
  const self = text !== null && href !== undefined && textIsAddress(text, href);
  // The host + path layout, taken only when a self-named address HAS a host:
  // a self-named `javascript:` has nothing to split and is drawn as its text.
  const face = self && address !== undefined ? linkParts(address) : null;
  const split = face !== null && face.host !== '' ? face : null;
  // A TEXT THAT CLAIMS AN ADDRESS IT IS NOT. See `textLooksLikeAddress`: the
  // pill prints a name now, and this text is not one -- it is a destination,
  // and the wrong one. The real host is printed in its place. `split` already
  // covers the honest version of this (text IS the address), so this is only
  // reached when the two disagree.
  const lying = !self && text !== null && href !== undefined && textLooksLikeAddress(text);
  const realHost = lying && address !== undefined ? (linkParts(address)?.host ?? null) : null;
  const hint =
    checked?.ok === true ? `opens ${address} in the browser` : (checked?.reason ?? NO_ADDRESS);
  const Glyph = ok ? ExternalLink : Ban;
  return (
    <>
      <Note text={hint}>
        <button
          type="button"
          data-out-link
          // The refused ones are marked so a guard can find them in a real
          // browser, and so they can be drawn as what they are.
          data-out-link-refused={checked?.ok === false ? 'true' : undefined}
          data-out-address={address}
          className={[
            // `items-baseline`, not `items-center`: the name and the glyph
            // have to share the paragraph's baseline, or the pill's word sits
            // a pixel above the sentence it is in. `max-w-full` with
            // `truncate` on the name, because an inline-flex box cannot break
            // across lines and a long label would otherwise decide how wide
            // the pane is. `gap-0.5` and `px-1`: with the border gone there is
            // nothing to hold the words off an edge, so the padding is the
            // whole of the pill's size and it is as small as a chip can be
            // and still read as one.
            'inline-flex max-w-full cursor-pointer items-baseline gap-0.5 rounded-[5px] bg-out-pill px-1 align-baseline leading-[1.3]',
            // NO INK CLASS ON THE LIVE ONE, and that is the point: the name
            // inherits the paragraph's colour, so a link reads as part of the
            // sentence. `hover:brightness` rather than a second ground, so
            // the wash stays one token. The REFUSED one keeps its own ink --
            // see the header for why it is the exception.
            // THE REFUSED ONE IN THE INK OF ITS OWN REFUSAL. `text-ink-faint`
            // was 3.97:1 on the light wash -- measured, under 1.4.3's 4.5 --
            // and `ink-dim` is the prose's own ink, which would make the one
            // pill that must not read as a sentence read as one. `failed` is
            // the ink the `Refusal` this control produces is printed in, so
            // the two halves of one outcome say the same thing.
            ok ? 'hover:bg-out-pill-hover' : 'text-failed',
          ].join(' ')}
          onClick={() => {
            if (checked === null || !checked.ok) {
              setNote(checked?.reason ?? NO_ADDRESS);
              return;
            }
            setNote(null);
            void openLink(checked.url).then((outcome) => {
              if (!outcome.ok) setNote(outcome.reason);
            });
          }}
        >
          {/* ONE NAME, and nothing derived from the address beside it. A
              link the agent named prints that name; a self-named one has no
              name but its host, which is the only case `split` is consulted
              for now -- never its path. */}
          <span className="truncate" data-out-name>
            {split !== null || realHost !== null ? (
              <span data-out-host>{split?.host ?? realHost}</span>
            ) : (
              children
            )}
          </span>
          <Glyph
            aria-hidden
            // Sized in `em` for the same reason as the words; `self-center`
            // because an SVG has no baseline and would otherwise stand on it.
            // Smaller than the old 0.875 to match the smaller pill, and it
            // keeps the faint ink: it is the affordance, not a word.
            className="h-[0.8em] w-[0.8em] flex-none self-center text-ink-faint"
            strokeWidth={1.8}
          />
          <span className="sr-only">, {hint}</span>
        </button>
      </Note>
      {note !== null && <Refusal text={note} />}
    </>
  );
}

/**
 * `src/foo/bar.ts:42`, as a control that opens that file at that line.
 *
 * IT SENDS THE REFERENCE AS THE AGENT WROTE IT, never the path and line this
 * component already parsed apart. Main parses it again with the same function
 * (`src/shared/file-ref.ts`) and resolves it against the session's own working
 * directory, so the split this component made for its own label is not a fact
 * anything downstream depends on -- and a reference main cannot read is
 * refused there rather than assembled from two arguments it has to trust.
 */
function OutFileRef({ token, ref }: { readonly token: string; readonly ref: FileRef }) {
  const { openFileRef } = useOutActions();
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        data-out-file-ref
        data-out-file-ref-line={ref.line}
        className="cursor-pointer rounded-[4px] bg-raised px-1 py-[1px] font-mono text-[0.917em] text-chip underline decoration-dotted underline-offset-2"
        onClick={() => {
          setNote(null);
          void openFileRef(token).then((outcome) => {
            if (!outcome.ok) setNote(outcome.reason);
          });
        }}
      >
        {token}
      </button>
      {note !== null && <Refusal text={note} />}
    </>
  );
}

/**
 * Every `path:line` inside one run of an agent's prose, turned into controls
 * and the text between them.
 *
 * ONLY STRING CHILDREN ARE SCANNED. Anything react-markdown has already made
 * an element of -- a link, emphasis, inline code -- is passed through
 * untouched, because it has its own rule in the map below and a second pass
 * over it would be this file deciding twice about one node.
 *
 * KEYED BY OFFSET, not by list index, exactly as `Fence` is: the same path can
 * appear four times in one paragraph and an index key would make React reuse
 * the wrong control's state (its refusal note, in particular).
 */
function Prose({ children }: { readonly children: ReactNode }) {
  const parts = Array.isArray(children) ? children : [children];
  let at = 0;
  return (
    <>
      {parts.map((child) => {
        const base = at;
        if (typeof child !== 'string') {
          // A non-string child occupies one slot rather than a run of
          // characters, so it advances the offset by one: the keys only have
          // to be unique and stable within this run, not to be byte-accurate.
          at += 1;
          return <Fragment key={`n${base}`}>{child}</Fragment>;
        }
        at += child.length;
        const segments = splitFileRefs(child);
        if (segments.every((segment) => segment.kind === 'text')) return child;
        let within = base;
        return segments.map((segment) => {
          const key = `${within}`;
          within += segment.text.length;
          return segment.kind === 'ref' ? (
            <OutFileRef key={key} token={segment.text} ref={segment.ref} />
          ) : (
            <Fragment key={key}>{segment.text}</Fragment>
          );
        });
      })}
    </>
  );
}

/**
 * INLINE CODE -- the chip, and the one case where a whole chip IS a reference.
 *
 * `` `src/foo/bar.ts:42` `` is how an agent writes a file reference most of
 * the time, so the chip becomes the control rather than sitting beside one.
 * The WHOLE span has to parse: half a chip as a button and half as text would
 * be a control whose label is not what it opens.
 *
 * INSIDE A FENCE IT IS ONLY A CHIP, reset by the `pre` rule's own classes and
 * left as text by `Fenced`. See that context's comment for the fence whose
 * language vam cannot read, which is the case this guard is really for.
 */
function InlineCode({ children }: { readonly children: ReactNode }) {
  const fenced = useContext(Fenced);
  // TRIMMED BEFORE PARSING, and that is what makes `Fenced` above load-bearing
  // rather than decorative. A fence's code text always ends in a newline, so
  // without the trim a whole-fence reference could never parse and the marker
  // would be guarding a case that cannot happen -- a guard that cannot fail.
  // The trim earns its place on its own too: markdown keeps the padding in a
  // chip written `` ` src/a.ts:1 ` ``, and that is still one reference.
  const only = typeof children === 'string' ? children.trim() : null;
  const ref = fenced || only === null ? null : parseFileRef(only);
  if (ref !== null && only !== null) return <OutFileRef token={only} ref={ref} />;
  return (
    <code className="rounded-[4px] bg-raised px-1 py-[1px] font-mono text-[0.917em] text-chip">
      {children}
    </code>
  );
}

/**
 * `out`'s type scale, in `em` against the root the pane's container carries
 * (`OUT_FONT_SIZE_VAR`, a pref).
 *
 * These were pixels — 13 / 12.5 / 12 headings, 12 body, 11.5 tables, 11 code,
 * 10.5 hints — a designed hierarchy rather than arbitrary numbers, so the
 * setting had to move all of them at once without flattening them. Each is its
 * old pixel size over the 12px root `body` already gave the pane, to three
 * decimals: 1.083 = 13/12, 1.042 = 12.5/12, 0.958 = 11.5/12, 0.917 = 11/12,
 * and 0.875 = 10.5/12 exactly. Rounding costs at most 0.01px at the largest
 * size offered, under one device pixel, so the scale is the shipped one.
 *
 * `em` not `rem`: the multiplier composes down the tree, so inline code stays
 * 11/12 OF ITS PARAGRAPH — which is what kept it a chip, not a body size.
 */
export const OUT_MARKDOWN: Components = {
  // `Prose`, not `children`, in the three elements an agent's sentences
  // actually land in: a paragraph, a list item and a table cell. See its own
  // comment for why a heading and a blockquote are left alone -- a reference
  // is written in the body of an answer, and the narrower the scan the fewer
  // ways there are to be wrong about somebody else's text.
  p: ({ children }) => (
    <p className="text-[1em] text-ink-dim leading-[1.6]">
      <Prose>{children}</Prose>
    </p>
  ),
  h1: ({ children }) => <h1 className="font-medium text-[1.083em] text-ink">{children}</h1>,
  h2: ({ children }) => <h2 className="font-medium text-[1.042em] text-ink">{children}</h2>,
  h3: ({ children }) => (
    <h3 className="font-medium text-[1em] text-ink tracking-[0.01em]">{children}</h3>
  ),
  /*
   * THE MARKERS, DECIDED SEPARATELY, because a bullet and a number are not the
   * same kind of thing and one rule for both is what made them both too faint.
   *
   * Operator: "the bullets and numbers in the response lists are too faint".
   * Both were routed through `ink-ghost` by one rule on the shared `<li>`,
   * under a comment calling them "genuinely decorative" -- 1.79:1 on the pane,
   * beside body text at 7.21:1. That claim is defensible for one of them and
   * was never true of the other.
   *
   * (The token is named here and the utility class is not, deliberately:
   * `test/renderer/ink-ghost-sites.test.ts` greps `src/` for the class string
   * itself, so spelling it in prose would hand that guard a call site that is
   * a sentence and let the real one be deleted without it noticing.)
   *
   * A BULLET IS DECORATION and keeps that reasoning: `list-disc`, the indent
   * and the gap between items already carry the list's structure, and nobody
   * refers to "the third bullet" by its glyph. So it does not owe WCAG 1.4.3's
   * 4.5:1. What it does owe is 1.4.11's 3:1 -- it is a non-text mark a reader
   * uses to find where each item begins -- and `ink-ghost` never met that.
   * `ink-quiet` is the quietest ink in this palette that does (5.05:1 on the
   * pane); `styles.css` says at `--vam-ink-quiet` that there is no rung
   * between `ghost` and `quiet`, and inventing a third grey to land just over
   * the complaint would be answering it as quietly as possible. It stays one
   * weight under the `ink-dim` body text, so it marks without leading.
   *
   * A NUMBER IS CONTENT, and this is the half the old comment got wrong. "1."
   * "2." "3." is how a reader REFERS to an item: an agent's numbered steps are
   * exactly the thing an operator counts, and "step 3 failed" is a sentence
   * about the numeral. It owes 4.5:1 like any other text and takes `ink-dim`,
   * the same ink as the words it numbers -- which is also `::marker`'s own
   * initial value, `currentColor`. So the fix here is to STOP overriding it
   * rather than to pick a colour: a numeral quieter than its own sentence is
   * one the reader has to hunt for.
   *
   * `[&>li::marker]`, NOT Tailwind's `marker:` variant, and the difference is
   * load-bearing. `marker:` compiles to `&::marker, & *::marker`, so putting
   * it on a `<ul>` would also claim every marker in a list NESTED inside it --
   * an `<ol>` inside a `<ul>` would take its numbers from whichever of two
   * equal-specificity rules Tailwind happened to emit last. The direct-child
   * form reaches this list's own items and stops, so a nested list is coloured
   * by its own element. `test/renderer/token-contrast.test.ts` holds both
   * tokens to their floors and `e2e/pane-colour-shots.mjs` reads the colour a
   * real `li::marker` is PAINTED with, because a rule that matched nothing
   * would pass a scan of this file.
   */
  ul: ({ children }) => (
    <ul className="flex list-disc flex-col gap-1 pl-4 text-[1em] text-ink-dim leading-[1.6] [&>li::marker]:text-ink-quiet">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="flex list-decimal flex-col gap-1 pl-4 text-[1em] text-ink-dim leading-[1.6] [&>li::marker]:text-ink-dim">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li>
      <Prose>{children}</Prose>
    </li>
  ),
  strong: ({ children }) => <strong className="font-medium text-ink">{children}</strong>,
  em: ({ children }) => <em className="text-ink-dim italic">{children}</em>,
  del: ({ children }) => <del className="text-ink-faint">{children}</del>,
  hr: () => <hr className="border-line border-t" />,
  blockquote: ({ children }) => (
    <blockquote className="border-quote border-l-2 pl-2.5 text-[1em] text-quote leading-[1.6]">
      {children}
    </blockquote>
  ),
  // Styled as an inline chip, and reset back to plain text inside a fence by
  // the `pre` rule below — react-markdown stopped telling a component which of
  // the two it is, and the parent knows without being told.
  code: ({ children }) => <InlineCode>{children}</InlineCode>,
  pre: ({ children }) => {
    const fence = readFence(children);
    const lang = fence === null ? null : resolveLang(fence.lang);
    return (
      // EVERYTHING inside the `<pre>` is marked fenced, not just the fallback
      // branch: see `Fenced`'s own comment. A fence is a quotation, and the
      // `code` rule above must not make controls out of a diff.
      <Fenced.Provider value={true}>
        <pre className="vam-no-scrollbar overflow-x-auto rounded-[7px] border border-line bg-ground px-2.5 py-2 font-mono text-[0.917em] text-ink-dim leading-[1.55] [&_code]:bg-transparent [&_code]:px-0 [&_code]:text-ink-dim">
          {fence !== null && lang !== null ? <Fence code={fence.code} lang={lang} /> : children}
        </pre>
      </Fenced.Provider>
    );
  },
  table: ({ children }) => (
    <div className="vam-no-scrollbar overflow-x-auto">
      <table className="w-max border-collapse text-[0.958em] text-ink-dim">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-line bg-raised px-2 py-1 text-left font-medium text-chip">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-line px-2 py-1 align-top">
      <Prose>{children}</Prose>
    </td>
  ),
  a: ({ href, children }) => <OutLink href={href}>{children}</OutLink>,
  img: ({ alt }) => (
    // MARKED, so the type-scale test can find the smallest rung in out by
    // attribute rather than by a class it would have to restate. It used to
    // find that rung on the link pill's host caption; the pill has no caption
    // any more (`OutLink`), and this is the element that carries the size now.
    <span data-out-alt className="font-mono text-[0.875em] text-ink-faint">
      {alt === '' ? 'image' : alt}
    </span>
  ),
};
