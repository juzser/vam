// @vitest-environment happy-dom

/**
 * `out`'s palette. The operator's complaint was not layout — the markdown
 * structure was already there — it was that every part of it was the same
 * grey. These tests pin WHICH structures carry colour, and, just as hard,
 * that colouring them did not turn agent output into markup.
 */

import { cleanup, render } from '@testing-library/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { afterEach, describe, expect, it } from 'vitest';
import { OUT_MARKDOWN } from '../../src/renderer/panels/DetailPanel.js';

afterEach(cleanup);

function out(md: string): HTMLElement {
  const { container } = render(
    <Markdown remarkPlugins={[remarkGfm]} components={OUT_MARKDOWN}>
      {md}
    </Markdown>,
  );
  return container;
}

/** The class of the first span in a fence whose text starts with `prefix`. */
function lineClass(root: HTMLElement, prefix: string): string {
  const span = [...root.querySelectorAll('pre span')].find((s) =>
    (s.textContent ?? '').startsWith(prefix),
  );
  if (!span) throw new Error(`no fence line starting with ${JSON.stringify(prefix)}`);
  return span.className;
}

const DIFF = [
  '```diff',
  '--- a/x.ts',
  '+++ b/x.ts',
  '@@ -1,2 +1,2 @@',
  '-old',
  '+new',
  ' same',
  '```',
].join('\n');

describe('a fenced diff is four colours, not one grey', () => {
  it('paints +, - and @@ distinctly', () => {
    const root = out(DIFF);
    const add = lineClass(root, '+new');
    const del = lineClass(root, '-old');
    const hunk = lineClass(root, '@@');
    for (const c of [add, del, hunk]) expect(c).not.toBe('');
    expect(new Set([add, del, hunk]).size).toBe(3);
  });

  it('paints the file headers as headers, not as a removed and an added line', () => {
    const root = out(DIFF);
    expect(lineClass(root, '--- a/x.ts')).toBe(lineClass(root, '+++ b/x.ts'));
    expect(lineClass(root, '--- a/x.ts')).not.toBe(lineClass(root, '-old'));
    expect(lineClass(root, '+++ b/x.ts')).not.toBe(lineClass(root, '+new'));
  });

  it('loses no character of the patch', () => {
    expect(out(DIFF).querySelector('pre')?.textContent).toContain(
      '@@ -1,2 +1,2 @@\n-old\n+new\n same',
    );
  });
});

describe('a code fence gets syntax colour, in the languages agents emit', () => {
  it('separates comment, string and keyword', () => {
    const root = out(['```ts', 'const s = "hi"; // note', '```'].join('\n'));
    const classes = [...root.querySelectorAll('pre span')]
      .filter((s) => s.className !== '')
      .map((s) => s.className);
    expect(new Set(classes).size).toBeGreaterThanOrEqual(3);
    expect(root.querySelector('pre')?.textContent).toContain('const s = "hi"; // note');
  });

  it('leaves a fence in a language it does not handle exactly as it was', () => {
    for (const head of ['```rust', '```']) {
      const root = out([head, 'fn main() { let x = "1"; }', '```'].join('\n'));
      expect(root.querySelector('pre')?.textContent).toContain('fn main() { let x = "1"; }');
      const coloured = [...root.querySelectorAll('pre span')].filter((s) => s.className !== '');
      expect(coloured).toEqual([]);
    }
  });
});

describe('colour did not make agent output executable', () => {
  it('drops a script tag in prose', () => {
    const root = out('before <script>alert(1)</script> after');
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain('before');
  });

  it('renders markup inside a fence as text, in every language', () => {
    for (const head of ['```ts', '```json', '```bash', '```diff', '```rust']) {
      const root = out(
        [head, '<img src=x onerror="alert(1)"><script>alert(2)</script>', '```'].join('\n'),
      );
      expect(root.querySelector('img')).toBeNull();
      expect(root.querySelector('script')).toBeNull();
      expect(root.querySelector('pre')?.textContent).toContain('<img src=x onerror="alert(1)">');
    }
  });
});

describe('the rest of the structure carries colour too, and prose does not', () => {
  it('gives an inline code chip its own colour, away from the prose around it', () => {
    const root = out('run `pnpm build` now');
    const chip = root.querySelector('p code');
    const prose = root.querySelector('p');
    expect(chip?.className).not.toContain('text-ink ');
    expect(chip?.className).not.toBe(prose?.className);
    expect(chip?.className).toMatch(/text-(?!ink)/);
  });

  it('colours a blockquote and a table header', () => {
    const quote = out('> quoted').querySelector('blockquote');
    expect(quote?.className).not.toContain('text-ink-faint');
    expect(quote?.className).toMatch(/text-(?!ink)/);

    const table = out(['| a | b |', '| - | - |', '| 1 | 2 |'].join('\n'));
    const th = table.querySelector('th');
    expect(th?.className).toMatch(/text-(?!ink)/);
    expect(th?.className).not.toBe(table.querySelector('td')?.className);
  });

  it('leaves prose in ink-dim: colour marks structure, it does not decorate', () => {
    expect(out('plain words').querySelector('p')?.className).toContain('text-ink-dim');
  });
});
