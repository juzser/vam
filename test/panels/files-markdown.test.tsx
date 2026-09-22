// @vitest-environment happy-dom
/**
 * THE FILES PREVIEW'S OWN COMPONENT MAP -- `FILES_MARKDOWN` -- structurally,
 * the way `test/panels/out-links.test.tsx` holds `OUT_MARKDOWN`'s safety
 * properties. PIXEL measurement (the size ladder, the border widths, the
 * table's real column widths) is the job of `e2e/files-markdown-shots.mjs`
 * against real Chromium, because happy-dom applies no stylesheet at all and
 * a `getComputedStyle` here would read nothing. What a unit test CAN hold:
 * which element each markdown construct becomes, which classes ask for the
 * right paint, and the two safety properties this map must not weaken —
 * "no anchor" and "no fetch" — which is why this file exists at all rather
 * than leaving the whole surface to a screenshot.
 *
 * A SEPARATE MAP FROM `OUT_MARKDOWN`, PINNED. `out-markdown.test.tsx`-shaped
 * coverage of the transcript itself lives in `out-links.test.tsx` and
 * `DetailPanel.files-tab.test.tsx`'s own "renders raw HTML..." /  "defuses a
 * link..." tests; this file never touches `OUT_MARKDOWN` and the last test
 * below asserts the two maps are genuinely two different objects, not one
 * renamed.
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FILES_MARKDOWN,
  FILES_MARKDOWN_URL_TRANSFORM,
} from '../../src/renderer/panels/files-markdown.js';
import { type OutActions, OutActionsProvider } from '../../src/renderer/panels/out-actions.js';
import { OUT_MARKDOWN } from '../../src/renderer/panels/out-markdown.js';

afterEach(cleanup);

function draw(markdown: string, actions?: Partial<OutActions>) {
  const openLink = vi.fn(async () => ({ ok: true }) as const);
  const openFileRef = vi.fn(async () => ({ ok: true }) as const);
  const value: OutActions = { openLink, openFileRef, ...actions };
  render(
    <OutActionsProvider value={value}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={FILES_MARKDOWN}
        urlTransform={FILES_MARKDOWN_URL_TRANSFORM}
      >
        {markdown}
      </Markdown>
    </OutActionsProvider>,
  );
  return { openLink, openFileRef };
}

describe('this map is genuinely its own, not `OUT_MARKDOWN` under a second name', () => {
  it('is a different object', () => {
    expect(FILES_MARKDOWN).not.toBe(OUT_MARKDOWN);
  });
});

describe('headings — GitHub’s own size ladder, with a rule under the top two', () => {
  it('renders h1 through h6 as their own elements, largest first', () => {
    draw(['# one', '## two', '### three', '#### four', '##### five', '###### six', ''].join('\n'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('one');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('two');
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('three');
    expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('four');
    expect(screen.getByRole('heading', { level: 5 }).textContent).toBe('five');
    expect(screen.getByRole('heading', { level: 6 }).textContent).toBe('six');
  });

  it('asks for a bottom border under h1 and h2 only', () => {
    draw(['# one', '## two', '### three', ''].join('\n'));
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('border-b');
    expect(screen.getByRole('heading', { level: 2 }).className).toContain('border-b');
    expect(screen.getByRole('heading', { level: 3 }).className).not.toContain('border-b');
  });

  it('sizes h1 at 32px (2em of a 16px root) and steps down from there', () => {
    draw(['# one', '## two', '### three', ''].join('\n'));
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('text-[32px]');
    expect(screen.getByRole('heading', { level: 2 }).className).toContain('text-[24px]');
    expect(screen.getByRole('heading', { level: 3 }).className).toContain('text-[20px]');
  });
});

describe('paragraphs and the body scale', () => {
  it('sets the 16px/1.5 body GitHub ships', () => {
    draw('Some prose.\n');
    const p = document.querySelector('p') as HTMLElement;
    expect(p.className).toContain('text-[16px]');
    expect(p.className).toContain('leading-[1.5]');
  });
});

describe('a blockquote — a 4px left bar and quiet ink', () => {
  it('renders a `blockquote` with a border and no bright ink', () => {
    draw('> a quotation\n');
    const quote = document.querySelector('blockquote') as HTMLElement;
    expect(quote).not.toBeNull();
    expect(quote.className).toContain('border-l-[4px]');
    expect(quote.textContent?.trim()).toBe('a quotation');
  });
});

describe('an hr', () => {
  it('renders a real `hr`', () => {
    draw(['above', '', '---', '', 'below', ''].join('\n'));
    expect(document.querySelector('hr')).not.toBeNull();
  });
});

describe('a fenced code block — a surface fill, 16px padding, and the existing highlighter', () => {
  it('keeps the coloured spans the highlighter already produces', () => {
    draw(['```ts', 'const a = 1', '```', ''].join('\n'));
    const pre = document.querySelector('pre') as HTMLElement;
    expect(pre).not.toBeNull();
    expect(pre.className).toContain('p-4');
    // The same token classes `out-markdown.tsx`'s `Fence` produces — reused,
    // not re-derived — so a keyword still reads as a keyword here.
    expect(pre.querySelector('code span')).not.toBeNull();
  });
});

describe('inline code — a tinted background', () => {
  it('renders a `code` chip outside a fence', () => {
    draw('some `inline` code\n');
    const code = document.querySelector('p code') as HTMLElement;
    expect(code).not.toBeNull();
    expect(code.textContent).toBe('inline');
    expect(code.className).toContain('bg-raised');
  });
});

describe('a table — borders and an alternating row background', () => {
  it('renders real table cells with a border class, and a zebra rule on the table', () => {
    draw(['| a | b |', '| - | - |', '| 1 | 2 |', '| 3 | 4 |', ''].join('\n'));
    const table = document.querySelector('table') as HTMLElement;
    expect(table).not.toBeNull();
    expect(table.className).toContain('nth-child(even)');
    const cell = document.querySelector('td') as HTMLElement;
    expect(cell.className).toContain('border');
  });
});

describe('a task list — a real, disabled checkbox', () => {
  it('renders `- [ ]` and `- [x]` as disabled checkbox inputs', () => {
    draw(['- [ ] todo', '- [x] done', ''].join('\n'));
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => box.disabled)).toBe(true);
    expect(boxes[0]?.checked).toBe(false);
    expect(boxes[1]?.checked).toBe(true);
  });
});

describe('a link — never a real anchor, underlined on hover, and still openable', () => {
  it('is a button, never an `a`, and asks main to open the address', async () => {
    const { openLink } = draw('See the [runbook](https://example.test/runbook) before deploying.');
    expect(document.querySelector('a')).toBeNull();
    const control = screen.getByRole('button', { name: /runbook/ });
    expect(control.className).toContain('hover:underline');
    await userEvent.click(control);
    expect(openLink).toHaveBeenCalledWith('https://example.test/runbook');
  });

  it('refuses a scheme it does not open, in words, without asking main', async () => {
    const { openLink } = draw('[bad](javascript:alert(1))');
    await userEvent.click(screen.getByRole('button', { name: /bad/ }));
    expect(openLink).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('javascript');
  });
});

describe('an image — declined, in words, GitHub-like', () => {
  it('never renders an `img`, and shows the alt text and the URL in a bordered placeholder', () => {
    draw('![architecture diagram](https://example.test/arch.png)\n');
    expect(document.querySelector('img')).toBeNull();
    const placeholder = document.querySelector('[data-files-markdown-image]') as HTMLElement;
    expect(placeholder).not.toBeNull();
    expect(placeholder.className).toContain('border');
    expect(placeholder.textContent).toContain('architecture diagram');
    expect(placeholder.textContent).toContain('https://example.test/arch.png');
  });

  it('still names the picture when there is no alt text', () => {
    draw('![](https://example.test/arch.png)\n');
    expect(document.querySelector('[data-files-markdown-image]')?.textContent).toContain('image');
  });
});

describe('raw HTML in the file — characters, never DOM, same wall as the transcript', () => {
  it('renders a `<script>` as text and never mounts one', () => {
    draw('<script>globalThis.__filesPwned = 1</script>\n');
    expect(document.querySelector('script')).toBeNull();
    expect(document.body.textContent).toContain('<script>');
    expect((globalThis as Record<string, unknown>).__filesPwned).toBeUndefined();
  });
});
