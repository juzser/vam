/**
 * A very small syntax tokenizer for the fences `out` actually receives.
 *
 * ## Why hand-rolled
 *
 * shiki/prism/highlight.js are each a grammar engine and a theme registry —
 * hundreds of kilobytes to colour the three languages an agent emits (shell,
 * TS/JS, JSON) and the diffs it emits far more often than any of them. The
 * benefit that survives at this size is comments, strings, numbers and
 * keywords; the rest is nuance nobody reads at 11px in a 408px column.
 *
 * ## Why it returns data
 *
 * `out` is untrusted text. `OUT_MARKDOWN` deliberately does not enable
 * `rehype-raw` and hands nothing to `innerHTML` — react-markdown parses to
 * React elements and DROPS embedded HTML, which is the property it was chosen
 * for. A highlighter that returned a string of `<span>`s would reopen exactly
 * that hole, so this module returns `{ text, kind }` records and lets the
 * caller build elements. Every tokenizer here is lossless: concatenating the
 * token texts reproduces the input byte for byte, so nothing can be smuggled
 * in by being dropped.
 *
 * A language this file does not know is not guessed at. It renders unstyled,
 * because a wrong colour asserts a structure that is not in the text.
 */

export type TokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword';

export type Token = {
  readonly text: string;
  readonly kind: TokenKind;
};

/** The languages with a tokenizer. `diff` is line-based and has its own path. */
export type HighlightLang = 'shell' | 'ts' | 'json' | 'diff';

/** What a scanned language is made of. */
type Grammar = {
  readonly lineComment: string | null;
  readonly blockComment: boolean;
  readonly quotes: readonly string[];
  /** Shell only: `#` opens a comment at a word boundary, not mid-token. */
  readonly commentNeedsBoundary: boolean;
  readonly keywords: ReadonlySet<string>;
};

const SHELL_KEYWORDS = [
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'in',
  'function',
  'return',
  'export',
  'local',
  'set',
  'source',
];

const TS_KEYWORDS = [
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'new',
  'class',
  'extends',
  'import',
  'export',
  'from',
  'as',
  'async',
  'await',
  'try',
  'catch',
  'finally',
  'throw',
  'typeof',
  'instanceof',
  'interface',
  'type',
  'enum',
  'implements',
  'readonly',
  'public',
  'private',
  'protected',
  'static',
  'this',
  'null',
  'undefined',
  'true',
  'false',
  'void',
  'yield',
  'delete',
  'in',
  'of',
];

const GRAMMARS: Record<Exclude<HighlightLang, 'diff'>, Grammar> = {
  shell: {
    lineComment: '#',
    blockComment: false,
    quotes: ['"', "'"],
    commentNeedsBoundary: true,
    keywords: new Set(SHELL_KEYWORDS),
  },
  ts: {
    lineComment: '//',
    blockComment: true,
    quotes: ['"', "'", '`'],
    commentNeedsBoundary: false,
    keywords: new Set(TS_KEYWORDS),
  },
  json: {
    lineComment: null,
    blockComment: false,
    quotes: ['"'],
    commentNeedsBoundary: false,
    keywords: new Set(['true', 'false', 'null']),
  },
};

/** The fence infostring an agent wrote, mapped to a tokenizer, or null. */
export function resolveLang(info: string | null): HighlightLang | null {
  if (info === null) return null;
  const lang =
    info
      .trim()
      .toLowerCase()
      .split(/[\s:,]/)[0] ?? '';
  switch (lang) {
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'shell':
    case 'console':
      return 'shell';
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'javascript':
    case 'typescript':
      return 'ts';
    case 'json':
    case 'jsonc':
      return 'json';
    case 'diff':
    case 'patch':
      return 'diff';
    default:
      return null;
  }
}

const WORD = /[A-Za-z_$]/;
const DIGIT = /[0-9]/;

/**
 * Scan `code` once, left to right, emitting a token per run.
 *
 * An unterminated string or block comment runs to the end of the input and
 * keeps its kind: that is what the editor the agent copied from shows, and
 * silently reclassifying it would hide the very typo worth seeing.
 */
export function tokenizeCode(code: string, lang: Exclude<HighlightLang, 'diff'>): readonly Token[] {
  const g = GRAMMARS[lang];
  const out: Token[] = [];
  let plain = '';
  const flush = () => {
    if (plain !== '') {
      out.push({ text: plain, kind: 'plain' });
      plain = '';
    }
  };
  const emit = (text: string, kind: TokenKind) => {
    flush();
    out.push({ text, kind });
  };

  let i = 0;
  while (i < code.length) {
    const ch = code[i] as string;
    const prev = i === 0 ? '' : (code[i - 1] as string);

    if (g.lineComment !== null && code.startsWith(g.lineComment, i)) {
      const boundary = !g.commentNeedsBoundary || i === 0 || /\s|[;|&(]/.test(prev);
      if (boundary) {
        const end = code.indexOf('\n', i);
        const stop = end === -1 ? code.length : end;
        emit(code.slice(i, stop), 'comment');
        i = stop;
        continue;
      }
    }

    if (g.blockComment && code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2);
      const stop = end === -1 ? code.length : end + 2;
      emit(code.slice(i, stop), 'comment');
      i = stop;
      continue;
    }

    if (g.quotes.includes(ch)) {
      let j = i + 1;
      while (j < code.length && code[j] !== ch) {
        // A backslash escapes the next character, including the closing quote.
        j += code[j] === '\\' ? 2 : 1;
      }
      const stop = j < code.length ? j + 1 : code.length;
      emit(code.slice(i, stop), 'string');
      i = stop;
      continue;
    }

    if (DIGIT.test(ch) && !WORD.test(prev) && !DIGIT.test(prev)) {
      let j = i;
      while (j < code.length && /[0-9._]/.test(code[j] as string)) j += 1;
      emit(code.slice(i, j), 'number');
      i = j;
      continue;
    }

    if (WORD.test(ch) && !WORD.test(prev) && !DIGIT.test(prev)) {
      let j = i;
      while (j < code.length && /[A-Za-z0-9_$]/.test(code[j] as string)) j += 1;
      const word = code.slice(i, j);
      if (g.keywords.has(word)) emit(word, 'keyword');
      else plain += word;
      i = j;
      continue;
    }

    plain += ch;
    i += 1;
  }
  flush();
  return out;
}

/** The four things a unified diff line can be, plus untouched context. */
export type DiffKind = 'add' | 'del' | 'hunk' | 'file' | 'plain';

/**
 * `---`/`+++` are tested BEFORE `-`/`+`: a file header is a `-` line by prefix
 * and a header by meaning, and painting it as a removal is the mistake that
 * makes every patch open with a phantom deleted line.
 */
export function diffLineKind(line: string): DiffKind {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('---') || line.startsWith('+++')) return 'file';
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'file';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'plain';
}
