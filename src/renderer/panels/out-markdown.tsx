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

import { isValidElement, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import {
  type DiffKind,
  diffLineKind,
  type HighlightLang,
  resolveLang,
  SYNTAX_CLASS,
  tokenizeCode,
} from './highlight.js';

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
 * this pane opened. A link would be a control that does nothing: the shell
 * denies `window.open` and every off-origin navigation (see src/main), which
 * is the correct policy. So the address is printed instead, in a region where
 * text is selectable, and opening it is a deliberate copy-and-paste.
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
  p: ({ children }) => <p className="text-[1em] text-ink-dim leading-[1.6]">{children}</p>,
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
  li: ({ children }) => <li>{children}</li>,
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
  code: ({ children }) => (
    <code className="rounded-[4px] bg-raised px-1 py-[1px] font-mono text-[0.917em] text-chip">
      {children}
    </code>
  ),
  pre: ({ children }) => {
    const fence = readFence(children);
    const lang = fence === null ? null : resolveLang(fence.lang);
    return (
      <pre className="vam-no-scrollbar overflow-x-auto rounded-[7px] border border-line bg-ground px-2.5 py-2 font-mono text-[0.917em] text-ink-dim leading-[1.55] [&_code]:bg-transparent [&_code]:px-0 [&_code]:text-ink-dim">
        {fence !== null && lang !== null ? <Fence code={fence.code} lang={lang} /> : children}
      </pre>
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
  td: ({ children }) => <td className="border border-line px-2 py-1 align-top">{children}</td>,
  a: ({ href, children }) => (
    <span className="text-done">
      {children}
      {href !== undefined && (
        <span className="font-mono text-[0.875em] text-ink-faint"> ({href})</span>
      )}
    </span>
  ),
  img: ({ alt }) => (
    <span className="font-mono text-[0.875em] text-ink-faint">{alt === '' ? 'image' : alt}</span>
  ),
};
