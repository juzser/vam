/**
 * `react-markdown` + `remark-gfm`, alone in their own module so they can be
 * a lazy chunk -- the same split `EmojiGrid.tsx` already does for the emoji
 * dataset, for the same reason.
 *
 * Measured (electron-vite build, sourcemap-attributed): react-markdown,
 * remark-gfm and their mdast/micromark/unist/hast/vfile dependency graph
 * cost the eager entry chunk ~143 KB, on top of the two component maps
 * that only ever accompany them (`out-markdown.tsx`'s `OUT_MARKDOWN`,
 * `files-markdown.tsx`'s `FILES_MARKDOWN`) -- and a session with no
 * transcript open, or a Files tab that never previews a `.md`, never reads
 * either. `DetailPanel.tsx` and `FilesTab.tsx` are both mounted as soon as
 * the canvas has one pane, so a plain top-level `import Markdown from
 * 'react-markdown'` in either file put the whole stack in the entry
 * regardless of whether a markdown render ever actually ran.
 *
 * THIS BOUNDARY, NOT `out-markdown.tsx`/`files-markdown.tsx` THEMSELVES,
 * because those two already avoid a runtime import of `react-markdown` --
 * they only need its `Components` TYPE, which is erased at build time (see
 * their own header comments). Only `DetailPanel.tsx` and `FilesTab.tsx`
 * import the `Markdown` component itself, at their one respective call
 * site each; this module exists so that import can be a dynamic one there,
 * with the two component maps and every one of their shared dependencies
 * (`Fence`, `readFence`, `Fenced`, `highlight.ts`) following the same
 * dynamic edge rather than staying reachable from the entry through a
 * static one.
 *
 * ONE WRAPPER FOR BOTH CALLERS because the two callers differ only in
 * WHICH map and url-transform they pass -- `OUT_MARKDOWN`/`OUT_URL_TRANSFORM`
 * for the transcript, `FILES_MARKDOWN`/`FILES_MARKDOWN_URL_TRANSFORM` for
 * the Files preview -- never in how `react-markdown` itself is invoked.
 * Two near-identical lazy modules would still put `react-markdown` and
 * `remark-gfm` in two chunks unless Rollup happened to dedupe them; a
 * single shared chunk is the more legible way to get the same shared
 * bytes.
 */

import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type LazyMarkdownProps = {
  readonly components: Components;
  readonly urlTransform?: (url: string) => string;
  readonly children: string;
};

export default function LazyMarkdown({ components, urlTransform, children }: LazyMarkdownProps) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
      {children}
    </Markdown>
  );
}
