/**
 * A markdown `href` that names a FILE in the session's own project
 * (`docs/roadmap.md`, `./a.ts#L42`). It only classifies: `../x.md` PARSES,
 * because whether it escapes the project, crosses a symlink or names nothing
 * is decided in MAIN, where the result is sent as a `path:line` reference
 * (`mdFileLinkRef`) to `filesResolve`. A file link is never handed to
 * `checkLink`, `openLink` or the shell, and no `file:` URL is built from it.
 *
 * NULL means "not a file link, do what you did before": a scheme, `//host/x`,
 * a bare `#section`, an empty string, a leading `/`, a backslash, or a name
 * that decodes to a NUL, colon or backslash. `README.md:12` has the shape of
 * a scheme, so a trailing `:digits` is read as a line first.
 */
/** A file the link names, and the 1-based line it points at. */
export type MdFileLink = { readonly path: string; readonly line: number };

/** The same bound `parseFileRef` applies, so a ref this builds is never refused for length alone. */
const MAX_HREF_LENGTH = 1_024;

const TRAILING_LINE = /:(\d{1,7})$/;
/** GitHub's own anchor: `#L42`, or the first of `#L42-L50`. */
const LINE_ANCHOR = /^L(\d{1,7})(?:-L?\d{1,7})?$/;

export function parseMdFileLink(href: unknown): MdFileLink | null {
  if (typeof href !== 'string' || href === '' || href.length > MAX_HREF_LENGTH) return null;
  if (href.startsWith('/') || href.includes('\\')) return null;

  let rest = href;
  let line = 1;
  const hash = rest.indexOf('#');
  if (hash !== -1) {
    const anchor = LINE_ANCHOR.exec(rest.slice(hash + 1));
    if (anchor !== null) line = Number(anchor[1]);
    rest = rest.slice(0, hash);
  }
  const query = rest.indexOf('?');
  if (query !== -1) rest = rest.slice(0, query);

  const colonLine = TRAILING_LINE.exec(rest);
  if (colonLine !== null) {
    line = Number(colonLine[1]);
    rest = rest.slice(0, colonLine.index);
  }
  // Anything with a colon left is a scheme (`https://x`, `mailto:a@b.c`).
  if (rest.includes(':')) return null;

  let path: string;
  try {
    path = decodeURIComponent(rest);
  } catch {
    return null;
  }
  // Decoding can mint what the raw string did not have.
  if (/[\0:\\]/.test(path) || path.startsWith('/')) return null;
  while (path.startsWith('./')) path = path.slice(2);
  if (path === '') return null;
  return { path, line: line < 1 ? 1 : line };
}

/**
 * The `path:line` reference `filesResolve` takes, with the path optionally
 * placed under `dir` (a directory relative to the session root, `''` for the
 * root itself). Nothing is normalised: `..` stays for main to refuse.
 */
export function mdFileLinkRef(link: MdFileLink, dir = ''): string {
  const base = dir === '' ? '' : `${dir.replace(/\/+$/, '')}/`;
  return `${base}${link.path}:${link.line}`;
}

/** The hover/focus hint of a file link: `opens docs/roadmap.md in Files`, plus the line when one was asked for. */
export function mdFileLinkHint(link: MdFileLink): string {
  return `opens ${link.path} in Files${link.line > 1 ? ` at line ${link.line}` : ''}`;
}
