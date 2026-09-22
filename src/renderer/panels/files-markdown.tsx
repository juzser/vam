/**
 * HOW A `.md` FILE OPENED IN THE FILES TAB IS DRESSED -- GitHub's own reading
 * shape, in vam's tokens, and a component map of its OWN rather than a
 * restyle of `OUT_MARKDOWN`.
 *
 * Operator: ".md files need to be previewed GitHub-style, and there must be a
 * button to switch between preview mode and raw mode." The toggle already
 * existed (`FilesTab.tsx`); what it opened onto was the transcript's chat
 * styling, reused wholesale -- a small h1, no rule under a heading, an image
 * shown only as its alt text with nothing to say why, and a table sized to
 * its own content rather than the pane. None of that reads as "GitHub" and
 * it was never meant to: `OUT_MARKDOWN`'s own header explains it was built
 * for a narrow answer column, 12px body, everything sized in `em` off the
 * operator's adjustable OUT setting.
 *
 * A SECOND MAP, PINNED, RATHER THAN A RESTYLE. `OUT_MARKDOWN` dresses an
 * agent's turn in the transcript, and that surface's own type scale, its
 * pill links and its chat-width column are load-bearing FOR IT and unrelated
 * to what a `.md` FILE should look like read at something closer to its own
 * width. Restyling `OUT_MARKDOWN` in place would move the transcript too;
 * `test/panels/DetailPanel.transcript-flow.test.tsx` and its neighbours pin
 * that surface's own rendering, and this file changes none of it.
 *
 * WHAT IS SHARED ANYWAY, AND WHY THAT PART IS NOT A DUPLICATION. Three things
 * an agent's answer and a file on disk are equally UNTRUSTED TEXT about, and
 * `out-markdown.tsx`'s own wall is the one correct answer to each, so this
 * file imports rather than re-derives them:
 *
 *   - THE HIGHLIGHTER. `Fence`, `readFence` and `Fenced` are exported from
 *     `out-markdown.tsx` and reused verbatim here -- only the `<pre>` that
 *     WRAPS `Fence`'s spans is this file's own. Same tokenizer, same
 *     `highlight.ts`, a different card around it.
 *   - THE LINK SAFETY. A real `<a href>` in this Electron window navigates
 *     THE WHOLE APPLICATION away -- there is no back button, and the window
 *     IS the app. `FilesLink` below never renders one; it renders a BUTTON,
 *     exactly as `OutLink` does, and asks the SAME `useOutActions().openLink`
 *     the transcript's own controls ask (`DetailPanel.tsx` publishes one
 *     provider over the whole pane, transcript and Files tab alike). What
 *     changes is only the paint: GitHub's own convention is an inline link,
 *     coloured in its accent AT REST and underlined only on hover, not a
 *     pill with a host inside it -- the pill earns its shape from the
 *     transcript's narrower column and this preview does not inherit that
 *     argument. `text-chip` carries the resting colour: an EXISTING token
 *     ("a symbol or a path lifted out of prose... a label, not a sentence"),
 *     the same ink this file's own inline-code chip already wears, not a new
 *     colour invented for a link. The `ExternalLink`/`Ban` glyph is the one
 *     piece of `OutLink`'s own paint that DOES carry over unchanged -- a link
 *     that is only a colour is a WCAG 1.4.1 failure the transcript's own pill
 *     was built to avoid, and colour alone is no less a failure here.
 *   - THE REFUSAL WORDING. `Refusal` and `NO_ADDRESS` are the house rule
 *     ("a control that can only refuse says so") stated once.
 *
 * IMAGES ARE THE ONE PLACE THIS FILE RE-ARGUES A DECISION RATHER THAN REUSING
 * ONE, AND IT KEEPS THE SAME ANSWER. `out-markdown.tsx`'s header: "An image
 * would be a remote fetch that tells whoever wrote the answer that this pane
 * opened." A file in a session's working directory is very often an agent's
 * own output one step removed -- `FilesTab.tsx`'s own `MarkdownPreview`
 * comment says so -- so it earns the identical caution. `img` here still
 * never fetches; what is NEW is that the placeholder is drawn as GitHub draws
 * a broken image -- a bordered box carrying the alt text and the address --
 * rather than as bare alt text with nothing around it, which is the part of
 * "GitHub-style" that does not cost the refusal anything.
 *
 * NOTHING HERE ENABLES `rehype-raw`, for the identical reason `OUT_MARKDOWN`
 * does not: react-markdown drops embedded HTML by default, and a `<script>`
 * an agent wrote into a file reaches the DOM as the characters of a
 * `<script>`. `FilesTab.tsx` does not pass `rehype-raw` to this map's
 * `<Markdown>` call, and nothing in this file hands a string to `innerHTML`.
 *
 * COLOUR IS TOKENS ONLY, the same constraint `styles.css` states for the
 * whole app: every class below names a token (`ink`, `line`, `raised`,
 * `well`, `quote`, `chip`, `segment-on`) and no hex literal appears in this
 * file, checked the same way the rest of `src/` is.
 */

import { Ban, ExternalLink, ImageOff } from 'lucide-react';
import { type ReactNode, useContext, useState } from 'react';
import type { Components } from 'react-markdown';
import { checkLink } from '../../shared/link.js';
import type { HighlightLang } from './highlight.js';
import { resolveLang } from './highlight.js';
import { Note } from './Note.js';
import { useOutActions } from './out-actions.js';
import { Fence, Fenced, NO_ADDRESS, Refusal, readFence } from './out-markdown.js';

/**
 * THE URL react-markdown HANDS `a:`/`img:` -- untouched, exactly the reason
 * `OUT_URL_TRANSFORM` gives: the real gate is in the component overrides
 * below (`checkLink` for a link, a flat refusal for every image), not in
 * react-markdown's own scheme list, so a second list here would be a second
 * thing to keep in step with `src/shared/link.ts`. Named separately from
 * `OUT_URL_TRANSFORM` even though the two are identical functions, so the
 * two `<Markdown>` call sites each name a constant that is plainly THEIRS --
 * two call sites importing one binding from one another is exactly the
 * coupling this whole file exists to avoid.
 */
export const FILES_MARKDOWN_URL_TRANSFORM = (url: string): string => url;

/**
 * A LINK, DRAWN AS GITHUB DRAWS ONE -- inline, in the chip accent at rest,
 * underlined on hover, carrying the same glyph the transcript's own link
 * does -- and NEVER A REAL ANCHOR. See this file's header for why the button
 * is not optional and why `openLink` is the transcript's own act.
 */
function FilesLink({ href, children }: { readonly href?: string; readonly children: ReactNode }) {
  const { openLink } = useOutActions();
  const [note, setNote] = useState<string | null>(null);
  const checked = href === undefined ? null : checkLink(href);
  const ok = checked?.ok === true;
  const hint = ok ? `opens ${checked.url} in the browser` : (checked?.reason ?? NO_ADDRESS);
  // `Ban` for a refused address, exactly as `OutLink` draws it -- a control
  // that can only refuse still looks like a control, not like plain prose.
  const Glyph = ok ? ExternalLink : Ban;
  return (
    <>
      <Note text={hint}>
        <button
          type="button"
          data-files-markdown-link
          data-files-markdown-link-refused={checked?.ok === false ? 'true' : undefined}
          className={[
            // `items-baseline` + the glyph's own `self-center`: the same
            // pairing `OutLink` uses, and for the same reason -- the text
            // and the glyph have to share the paragraph's baseline, and an
            // SVG has no baseline of its own to stand on.
            'inline-flex cursor-pointer items-baseline gap-0.5 align-baseline underline-offset-2 hover:underline',
            // THE REFUSED ONE IN THE INK OF ITS OWN REFUSAL, exactly as
            // `OutLink`'s does -- "this one is not like the others" is what
            // it has to say, and the chip accent would say the opposite.
            ok ? 'text-chip' : 'text-failed',
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
          {children}
          <Glyph
            aria-hidden="true"
            className="h-[0.8em] w-[0.8em] flex-none self-center"
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
 * AN IMAGE, DECLINED -- GitHub's own broken-image shape (a bordered box in
 * place of the picture) standing in for a fetch this preview will not make.
 * See this file's header for why the refusal itself is unchanged from the
 * transcript's.
 */
function FilesImagePlaceholder({ alt, src }: { readonly alt?: string; readonly src?: string }) {
  const label = alt === undefined || alt === '' ? 'image' : alt;
  return (
    <span
      data-files-markdown-image
      className="inline-flex max-w-full items-center gap-1.5 rounded-[6px] border border-line bg-well px-2 py-1 align-middle text-[0.875em] text-ink-faint"
    >
      <ImageOff aria-hidden="true" size={14} strokeWidth={1.8} className="flex-none" />
      <span className="truncate">
        {label}
        {typeof src === 'string' && src !== '' ? ` — ${src}` : ''}
      </span>
    </span>
  );
}

/**
 * INLINE CODE, tinted -- reset back to a plain `<code>` inside a fence
 * exactly as `out-markdown.tsx`'s own `InlineCode` resets, using the SAME
 * `Fenced` signal so the two components cannot disagree about which case
 * they are in.
 */
function FilesInlineCode({ children }: { readonly children: ReactNode }) {
  const fenced = useContext(Fenced);
  if (fenced) return <code>{children}</code>;
  return (
    <code className="rounded-[4px] bg-raised px-[0.4em] py-[0.15em] font-mono text-[0.85em] text-ink">
      {children}
    </code>
  );
}

/**
 * A task-list item's own row: the checkbox and its text share a line and the
 * bullet a plain item would draw is dropped, GitHub's own shape for one.
 * `checked` is `undefined`/`null` for an ordinary item -- remark-gfm sets it
 * only on a real `- [ ]`/`- [x]` -- so an ordinary `<li>` is untouched.
 */
function FilesListItem({
  children,
  checked,
}: {
  readonly children?: ReactNode;
  readonly checked?: boolean | null;
}) {
  if (checked === undefined || checked === null) return <li>{children}</li>;
  return (
    <li className="flex list-none items-baseline gap-1.5 [&_input]:translate-y-[1px]">
      {children}
    </li>
  );
}

/**
 * GitHub's own size ladder (h1 2em, h2 1.5em, h3 1.25em, h4 1em, h5 0.875em,
 * h6 0.85em) -- `em`, resolved against `FilesTab.tsx`'s own
 * `[data-files-markdown-github]` wrapper, which is where the ROOT this ladder
 * scales off actually lives (see that component's own header for why it is
 * pinned to `--vam-out-font-size`, the Response view's own property, rather
 * than a literal 16px or vam's separate `text-body` chrome scale). `em`
 * rather than a literal pixel per rung is what makes "the same font size as
 * the Response view" survive the operator raising or lowering that setting,
 * not merely match it at one. h1 and h2 alone carry the bottom rule GitHub
 * draws under the top two levels only.
 */
const HEADING_SIZE: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6, string>> = {
  1: 'text-[2em]',
  2: 'text-[1.5em]',
  3: 'text-[1.25em]',
  4: 'text-[1em]',
  5: 'text-[0.875em]',
  6: 'text-[0.85em]',
};

function heading(level: 1 | 2 | 3 | 4 | 5 | 6) {
  const Tag = `h${level}` as const;
  const rule = level <= 2 ? 'border-line border-b pb-[0.3em] ' : '';
  return function Heading({ children }: { readonly children?: ReactNode }) {
    return (
      <Tag className={`${rule}mt-6 mb-4 font-semibold text-ink ${HEADING_SIZE[level]} first:mt-0`}>
        {children}
      </Tag>
    );
  };
}

export const FILES_MARKDOWN: Components = {
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),
  p: ({ children }) => <p className="mb-4 text-[1em] text-ink-dim leading-[1.5]">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-4 flex list-disc flex-col gap-1 pl-8 text-[1em] text-ink-dim leading-[1.5]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 flex list-decimal flex-col gap-1 pl-8 text-[1em] text-ink-dim leading-[1.5]">
      {children}
    </ol>
  ),
  li: FilesListItem,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-ink-faint line-through">{children}</del>,
  hr: () => <hr className="my-6 border-line border-t" />,
  blockquote: ({ children }) => (
    <blockquote className="mb-4 border-quote border-l-[4px] pl-4 text-[1em] text-quote leading-[1.5]">
      {children}
    </blockquote>
  ),
  code: ({ children }) => <FilesInlineCode>{children}</FilesInlineCode>,
  pre: ({ children }) => {
    const fence = readFence(children);
    const lang: HighlightLang | null = fence === null ? null : resolveLang(fence.lang);
    return (
      <Fenced.Provider value={true}>
        <pre className="vam-no-scrollbar mb-4 overflow-x-auto rounded-[8px] border border-line bg-raised p-4 font-mono text-[85%] text-ink-dim leading-[1.45] [&_code]:bg-transparent [&_code]:px-0 [&_code]:text-ink-dim">
          {fence !== null && lang !== null ? <Fence code={fence.code} lang={lang} /> : children}
        </pre>
      </Fenced.Provider>
    );
  },
  table: ({ children }) => (
    <div className="vam-no-scrollbar mb-4 overflow-x-auto">
      <table className="w-full border-collapse text-[0.875em] text-ink-dim [&_tbody_tr:nth-child(even)]:bg-well">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-line bg-raised px-3 py-2 text-left font-semibold text-ink">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-line px-3 py-2 align-top">{children}</td>,
  a: ({ href, children }) => <FilesLink href={href}>{children}</FilesLink>,
  img: ({ alt, src }) => (
    <FilesImagePlaceholder alt={alt} src={typeof src === 'string' ? src : undefined} />
  ),
};
