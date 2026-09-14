/**
 * Where a vam issue is filed, and how a title and a body become that address.
 *
 * SHARED BECAUSE TWO PROCESSES MUST AGREE ABOUT IT, and only one of them may
 * decide it. `src/renderer/errors/report.ts` composes the text and shows the
 * operator the URL it will open; `src/main/issue/ipc.ts` is the only thing
 * that can actually open one, and it builds the address from THIS constant
 * rather than from anything the renderer sends. Two copies of the same string
 * in two processes is a pair that can drift, and the drift would be silent --
 * the panel showing one destination while the browser opened another.
 *
 * The renderer names no destination anywhere in this file's use: it passes a
 * title and a body, both text, and main decides where they go. See
 * `CHANNELS.issueOpen`.
 */

/** The public repository this app belongs to. */
export const NEW_ISSUE_URL = 'https://github.com/juzser/vam/issues/new';

/** The prefilled `issues/new` address for one report. Opens nothing. */
export function issueUrl(title: string, body: string): string {
  return `${NEW_ISSUE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
