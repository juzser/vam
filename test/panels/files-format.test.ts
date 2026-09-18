/**
 * THE FORMATTER, AND THE LINE IT REFUSES TO CROSS.
 *
 * A formatter that mangles a file is worse than no formatter at all, because
 * nothing on screen says so: the operator finds out when the service will not
 * boot. `.env` is the named use case for this whole tab, and a `.env` is a
 * file whose meaning is in its exact bytes.
 *
 * So `files-format.ts` formats only where it can PROVE it changed nothing but
 * whitespace, and refuses aloud, by name, everywhere else. These tests are
 * both halves of that: what it does, and -- at least as importantly -- the
 * files it declines to touch and the rewrites it catches itself about to make.
 */

import { describe, expect, it } from 'vitest';
import { formatFile } from '../../src/renderer/panels/files-format.js';

const JSON_PATH = '/work/atlas/tsconfig.json';
const ENV_PATH = '/work/atlas/.env';

/** The value, or a thrown assertion naming what came back instead. */
function formatted(path: string, content: string, indent = 2): string {
  const result = formatFile(path, content, indent);
  if (result.kind !== 'formatted') {
    throw new Error(`expected a format, got ${result.kind}: ${JSON.stringify(result)}`);
  }
  return result.value;
}

function refusal(path: string, content: string, indent = 2): string {
  const result = formatFile(path, content, indent);
  if (result.kind !== 'refused') {
    throw new Error(`expected a refusal, got ${result.kind}: ${JSON.stringify(result)}`);
  }
  return result.message;
}

describe('JSON — the one format vam can prove it round-trips', () => {
  it('indents a compact object at the width the operator chose', () => {
    expect(formatted(JSON_PATH, '{"a":1,"b":[2,3]}', 2)).toBe(
      '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}\n',
    );
    expect(formatted(JSON_PATH, '{"a":1}', 4)).toBe('{\n    "a": 1\n}\n');
  });

  it('ends the file with exactly one newline', () => {
    expect(formatted(JSON_PATH, '{"a":1}')).toMatch(/[^\n]\n$/);
    expect(formatted(JSON_PATH, '{"a":1}\n\n\n')).toMatch(/[^\n]\n$/);
  });

  it('says nothing changed rather than claiming a format it did not make', () => {
    const tidy = formatted(JSON_PATH, '{"a":1,"b":[2,3]}');
    expect(formatFile(JSON_PATH, tidy, 2)).toEqual({ kind: 'unchanged' });
  });

  /**
   * THE ROUND-TRIP GUARD, stated as the property rather than as an example.
   * MUTATION TARGET: make `formatJson` drop a key (`delete parsed.b`) or
   * reorder one, and every row here reddens.
   */
  it('round-trips: what comes back parses to exactly what went in, keys and order', () => {
    const corpus = [
      '{"a":1,"b":2}',
      '{"b":2,"a":1}',
      '[1,2,3]',
      '{"nested":{"deep":{"deeper":[1,{"x":null}]}}}',
      '{"unicode":"héllo — em dash","empty":{},"list":[]}',
      '{"t":true,"f":false,"n":null}',
      '"a bare string"',
      '42',
      '[]',
      '{}',
      '{"escaped":"a \\" quote and a \\\\ backslash and a \\n newline"}',
      '{"a":{"b":[{"c":1},{"c":2}]}}',
    ];
    // The corpus is the assertion's own subject: a sweep over an empty list
    // is green and proves nothing.
    expect(corpus.length).toBeGreaterThan(10);
    for (const source of corpus) {
      const out = formatted(JSON_PATH, source);
      expect(JSON.parse(out), source).toEqual(JSON.parse(source));
      // Order too, which a deep-equal does not check: `JSON.stringify` of the
      // two must agree character for character.
      expect(JSON.stringify(JSON.parse(out)), source).toBe(JSON.stringify(JSON.parse(source)));
      // And the text itself differs from the source only by whitespace.
      expect(out.replace(/\s/g, ''), source).toBe(source.replace(/\s/g, ''));
    }
  });

  it('refuses invalid JSON with the parser’s own position, rather than throwing', () => {
    const message = refusal(JSON_PATH, '{"a":1,}');
    expect(message).toMatch(/position \d+/);
    expect(message).toContain('tsconfig.json');
    // And it is a refusal, not an exception: the caller has a note to draw.
    expect(() => formatFile(JSON_PATH, '{oh no', 2)).not.toThrow();
    expect(formatFile(JSON_PATH, '', 2).kind).toBe('refused');
  });
});

/**
 * THE GUARD THAT MAKES THE ROUND-TRIP A PROOF RATHER THAN A HOPE.
 *
 * `JSON.parse` then `JSON.stringify` is lossless for the VALUE and lossy for
 * the TEXT, in five ways that all reach real files. Each one is a silent
 * rewrite of bytes the operator wrote, so each one is refused rather than
 * applied -- and named in the refusal, because "vam did nothing" is the answer
 * this whole file exists to avoid.
 */
describe('JSON — the rewrites vam catches itself about to make', () => {
  const cases: readonly (readonly [string, string, RegExp])[] = [
    // A duplicate key: `JSON.parse` keeps the last and the first is gone.
    ['a duplicate key', '{"a":1,"a":2}', /more than whitespace/],
    // An integer-like key: a JS object puts "1" before "b" whatever the file
    // said, so stringify REORDERS the document.
    ['an integer-like key', '{"b":1,"1":2}', /more than whitespace/],
    // 64-bit ids do not survive a double. This one is the reason the guard is
    // a text comparison and not a `toEqual` on the parsed values: both parse
    // to the SAME (wrong) number, so a value-only guard is blind to it.
    ['an id past 2^53', '{"id":12345678901234567890}', /more than whitespace/],
    // `1.0` is the same number and different bytes.
    ['a re-spelled number', '{"version":1.0}', /more than whitespace/],
    // `1e3` becomes `1000`. (`1e-7` does NOT — V8's shortest repr of that
    // double IS `1e-7` — and the guard lets that one through, which is the
    // point: it refuses a REWRITE, not an exponent.)
    ['an exponent', '{"port":1e3}', /more than whitespace/],
    // A `\u` escape decodes, and stringify emits the character.
    ['a unicode escape', '{"a":"\\u0041"}', /more than whitespace/],
  ];

  it('refuses each of them by name instead of quietly rewriting the file', () => {
    expect(cases.length).toBeGreaterThan(5);
    for (const [name, source, matcher] of cases) {
      const result = formatFile(JSON_PATH, source, 2);
      expect(result.kind, `${name}: ${source}`).toBe('refused');
      if (result.kind !== 'refused') continue;
      expect(result.message, name).toMatch(matcher);
    }
  });

  it('names the two spellings in the refusal, so the operator can see the swap', () => {
    // A message that only says "something would change" leaves the operator
    // with a button that never works and no way to find out why.
    expect(refusal(JSON_PATH, '{"version":1.0}')).toContain('1.0');
    expect(refusal(JSON_PATH, '{"a":"\\u0041"}')).toContain('\\u0041');
  });

  it('lets an exponent through when the bytes really do survive it', () => {
    // The guard's job is to catch a REWRITE, not to fear a shape: `1e-7` is
    // already the shortest spelling of that double, so it comes back
    // untouched and the file formats.
    expect(formatted(JSON_PATH, '{"tiny":1e-7}')).toBe('{\n  "tiny": 1e-7\n}\n');
  });

  it('still formats the ordinary file the guard is protecting', () => {
    // The guard must not be so strict that nothing passes it: a real
    // `package.json` is exactly the file this feature is for.
    const pkg = '{"name":"vam","version":"0.1.0","private":true,"scripts":{"dev":"vite"}}';
    expect(formatted(JSON_PATH, pkg)).toBe(
      '{\n  "name": "vam",\n  "version": "0.1.0",\n  "private": true,\n  "scripts": {\n    "dev": "vite"\n  }\n}\n',
    );
  });
});

/**
 * `.env` AND `.ini` -- THE SUBSET THAT IS SAFE, AND WHY IT IS ONLY A SUBSET.
 *
 * Trailing whitespace on an ASSIGNMENT line is NOT provably insignificant.
 * `A=1 ` and `A="1 "` are not the same value, and what an unquoted trailing
 * space means is a question the readers answer differently -- a shell's own
 * word splitting drops it, a reader that takes the rest of the line verbatim
 * keeps it. vam does not know which program will read this file, so it does
 * not touch a line that carries data. It touches only lines no reader reads:
 * blank ones, and comments.
 */
describe('.env and .ini — only the lines no reader reads', () => {
  it('leaves every assignment line byte for byte, whitespace and quoting included', () => {
    // The trailing blank run is what makes this file untidy, so the formatter
    // really runs — and every line it walks past has to come out unchanged.
    const source = `${['A=1   ', 'B = 2', "C='  padded  '", 'D="x"   ', 'export E=5'].join(
      '\n',
    )}\n\n\n\n`;
    const out = formatted(ENV_PATH, source);
    for (const line of ['A=1   ', 'B = 2', "C='  padded  '", 'D="x"   ', 'export E=5']) {
      expect(out.split('\n'), line).toContain(line);
    }
  });

  it('collapses a run of blank lines to one and drops the blanks at either end', () => {
    expect(formatted(ENV_PATH, '\n\n\nA=1\n\n\n\nB=2\n\n\n')).toBe('A=1\n\nB=2\n');
  });

  it('empties a line that is only whitespace — a reader sees a blank line either way', () => {
    expect(formatted(ENV_PATH, 'A=1\n   \nB=2\n')).toBe('A=1\n\nB=2\n');
  });

  it('trims a comment’s trailing whitespace, and nothing else about it', () => {
    expect(formatted(ENV_PATH, '# the api   \nA=1\n')).toBe('# the api\nA=1\n');
    // Leading whitespace is left alone: an indented comment is a shape the
    // operator chose, and moving it is not tidying.
    expect(formatted(ENV_PATH, '    # indented   \nA=1\n')).toBe('    # indented\nA=1\n');
  });

  it('does NOT read a `#` after a value as a comment — the readers disagree about that', () => {
    // python-dotenv strips an inline comment from an unquoted value; a reader
    // that takes the rest of the line verbatim keeps it. Trimming here would
    // pick a side, so the line is left exactly as written.
    expect(formatted(ENV_PATH, 'A=1 # not a comment   \n\n\nB=2\n')).toContain(
      'A=1 # not a comment   \n',
    );
  });

  it('guarantees one final newline', () => {
    expect(formatted(ENV_PATH, 'A=1')).toBe('A=1\n');
  });

  it('says nothing changed for a file that is already tidy', () => {
    expect(formatFile(ENV_PATH, 'A=1\n\n# note\nB=2\n', 2)).toEqual({ kind: 'unchanged' });
    expect(formatFile(ENV_PATH, '', 2)).toEqual({ kind: 'unchanged' });
  });

  it('takes `.env.local`, `.env.production` and `.ini`, and an ini’s `;` comments', () => {
    expect(formatFile('/w/.env.local', 'A=1', 2).kind).toBe('formatted');
    expect(formatFile('/w/.env.production', 'A=1', 2).kind).toBe('formatted');
    expect(formatFile('/w/dev.env', 'A=1', 2).kind).toBe('formatted');
    expect(formatted('/w/app.ini', '[core]\n; a note   \nkey = value   \n')).toBe(
      '[core]\n; a note\nkey = value   \n',
    );
  });

  /**
   * MUTATION TARGET: make the env formatter trim every line rather than only
   * blank and comment lines, and this reddens -- it is the whole argument of
   * this section, stated as a sweep.
   */
  it('never changes a byte on any line that is not blank and not a comment', () => {
    const sources = [
      'A=1   \n\n\n\nB=2\t\n',
      'KEY="value with trailing space "   \n# c   \n',
      'A=\nB=   \n\n\n',
      '  indented=yes  \n',
      '[section]   \nk=v   \n',
    ];
    expect(sources.length).toBeGreaterThan(4);
    let touched = 0;
    for (const source of sources) {
      const result = formatFile('/w/app.ini', source, 2);
      const out = result.kind === 'formatted' ? result.value : source;
      if (result.kind === 'formatted') touched += 1;
      const kept = (line: string) => line.trim() !== '' && !/^\s*[#;]/.test(line);
      expect(out.split('\n').filter(kept), source).toEqual(source.split('\n').filter(kept));
    }
    // And the sweep really did exercise the formatter rather than the
    // fall-through: a sweep where nothing was ever formatted proves nothing.
    expect(touched).toBeGreaterThan(0);
  });
});

describe('the refusals — by name, aloud, never a silent no-op', () => {
  it('refuses a file type it has no proof for, naming the extension', () => {
    expect(refusal('/w/src/index.ts', 'const a = 1\n')).toContain('.ts');
    expect(refusal('/w/src/App.tsx', 'x')).toContain('.tsx');
    expect(refusal('/w/run.sh', 'echo hi\n')).toContain('.sh');
    expect(refusal('/w/README.md', '# hi\n')).toContain('.md');
    expect(refusal('/w/a.yaml', 'a: 1\n')).toContain('.yaml');
  });

  it('refuses a file with no extension by its own name', () => {
    expect(refusal('/w/Makefile', 'all:\n')).toContain('Makefile');
  });

  it('refuses .jsonc and .json5 for the reason that makes them not JSON', () => {
    // `JSON.parse` does not read them, and the round-trip that makes .json
    // safe would delete every comment in the file.
    expect(refusal('/w/tsconfig.jsonc', '{"a":1} // note')).toMatch(/comment/i);
    expect(refusal('/w/a.json5', '{a:1}')).toContain('.json5');
  });

  it('refuses a file with Windows line endings rather than rewriting every line', () => {
    expect(refusal(JSON_PATH, '{"a":\r\n1}')).toMatch(/CRLF|Windows/);
    expect(refusal(ENV_PATH, 'A=1\r\nB=2\r\n')).toMatch(/CRLF|Windows/);
  });

  it('says what it WILL format in every refusal, so the button is never a mystery', () => {
    for (const path of ['/w/src/index.ts', '/w/Makefile', '/w/a.json5', '/w/a.yaml']) {
      const message = refusal(path, 'x');
      expect(message, path).toMatch(/\.json/);
      expect(message, path).toMatch(/\.env/);
    }
  });

  it('never answers with silence: every path is formatted, unchanged or refused', () => {
    const paths = ['/w/a.json', '/w/.env', '/w/a.ini', '/w/a.ts', '/w/Makefile', '/w/a.md'];
    for (const path of paths) {
      const result = formatFile(path, 'A=1\n', 2);
      expect(['formatted', 'unchanged', 'refused'], path).toContain(result.kind);
      if (result.kind === 'refused') expect(result.message.length, path).toBeGreaterThan(20);
    }
  });
});
