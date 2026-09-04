// @vitest-environment happy-dom

/** `out`'s type scale, once it became adjustable. Two things can go wrong
 *  with a hierarchy of pixels rewritten as `em` against one root: an element
 *  left behind in pixels, which stops scaling for ever, and a scale that stops
 *  being a hierarchy at some size. Both are asserted here off the real DOM. */

import { cleanup, render } from '@testing-library/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { afterEach, describe, expect, it } from 'vitest';
import { OUT_MARKDOWN } from '../../src/renderer/panels/DetailPanel.js';

afterEach(cleanup);

const MD = `# head one\n\n## head two\n\n### head three\n\npara with \`code\` in it.\n
- a bullet\n\n> a quote\n\n| a | b |\n| - | - |\n| 1 | 2 |\n
\`\`\`ts\nconst x = 1;\n\`\`\`\n\n[a link](https://example.test)`;

const out = (): HTMLElement =>
  render(
    <Markdown remarkPlugins={[remarkGfm]} components={OUT_MARKDOWN}>
      {MD}
    </Markdown>,
  ).container;

/** The `text-[...]` size an element declares, or null when it declares none. */
const sizeToken = (el: Element): string | null =>
  /(?:^|\s)text-\[([^\]]+)\]/.exec(el.className)?.[1] ?? null;

/** The rendered px size of `el`, resolved the way a browser resolves `em`:
 *  multiplied up the chain of declared sizes to the container. Not read off
 *  the element alone — `1em` inside a `0.9em` block is a different size. */
function px(el: Element, root: number, stop: Element): number {
  const token = sizeToken(el);
  const parent = el.parentElement;
  const inherited = el === stop || parent === null ? root : px(parent, root, stop);
  if (token === null) return inherited;
  const em = /^([\d.]+)em$/.exec(token);
  if (em === null) throw new Error(`<${el.tagName.toLowerCase()}> declares ${token}, not an em`);
  return inherited * Number(em[1]);
}

const find = (root: HTMLElement, sel: string): Element =>
  root.querySelector(sel) ??
  (() => {
    throw new Error(`no ${sel}`);
  })();

const HINT = 'p span span'; // the `(href)` hint, the smallest thing `out` draws

describe('every size inside out is relative, so one setting moves them all', () => {
  it('leaves no element behind in pixels', () => {
    // A single `text-[12px]` left in the map is an element that ignores the
    // setting for ever, and nothing else in the suite would notice.
    const stranded = [...out().querySelectorAll('*')]
      .filter((el) => /(?:^|\s)text-\[[\d.]+px\]/.test(el.className))
      .map((el) => `${el.tagName.toLowerCase()}: ${sizeToken(el)}`);
    expect(stranded).toEqual([]);
  });

  it('reproduces the shipped pixel scale exactly at the default 12px root', () => {
    const root = out();
    const at = (sel: string) => px(find(root, sel), 12, root);
    for (const [sel, want] of [
      ['h1', 13],
      ['h2', 12.5],
      ['h3', 12],
      ['p', 12],
      ['blockquote', 12],
      ['table', 11.5],
      ['pre', 11],
      ['p code', 11],
      [HINT, 10.5],
    ] as const) {
      expect(at(sel), sel).toBeCloseTo(want, 1);
    }
  });

  it('keeps heading > body > table > code > hint at every size in range', () => {
    const root = out();
    for (const size of [10, 12, 16, 20]) {
      const at = (sel: string) => px(find(root, sel), size, root);
      const ranked = ['h1', 'h2', 'p', 'table', 'pre', HINT];
      for (const [i, sel] of ranked.slice(1).entries()) {
        expect(at(sel), `size ${size}, ${sel}`).toBeLessThanOrEqual(at(ranked[i] as string));
      }
      // Strictly a hierarchy, not five things that happen to be equal.
      expect(at('h1'), `size ${size}`).toBeGreaterThan(at('p'));
      expect(at('p'), `size ${size}`).toBeGreaterThan(at('pre'));
      expect(at('pre'), `size ${size}`).toBeGreaterThan(at(HINT));
      // And every one of them is exactly proportional to the root.
      expect(at('h1') / size, `size ${size}`).toBeCloseTo(13 / 12, 2);
    }
  });
});
