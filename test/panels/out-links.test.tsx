// @vitest-environment happy-dom
/**
 * WHAT AN AGENT'S LINK AND AN AGENT'S `path:line` REACH THE DOM AS.
 *
 * THE PROPERTY THIS FILE EXISTS FOR IS STILL "NO ANCHOR". `OUT_MARKDOWN`'s
 * `a:` override was written because a real `<a href>` in an Electron window
 * navigates THE WHOLE APPLICATION away -- the window is the app, there is no
 * back button and nothing on screen would say what happened -- and because
 * `window.open` and every off-origin navigation are denied by policy. None of
 * that changed: what changed is that the address is now a BUTTON which asks
 * main to open it in the operator's own browser, and the test below asserts
 * the absence of an anchor just as hard as it asserts the button.
 *
 * AND THE DESTINATION IS STILL READABLE. `DetailPanel.files-tab.test.tsx`
 * makes the same point about the old rendering: "no anchor" alone is
 * satisfied by drawing nothing, which would be a worse page than the bug.
 * The address stays on screen, in the PARSED form -- a unicode host reaches
 * the panel as punycode, because the whole promise of a visible destination
 * is that it is the one that will actually resolve.
 *
 * WHERE IT STAYS CHANGED WHEN THE LINK BECAME A PILL. The old control printed
 * the whole address after the text; the pill prints the HOST inside the
 * control and keeps the full address on `data-out-address`, in the `Note`
 * that opens on hover and focus, and in a screen-reader span -- so
 * `textContent` still contains it (which is what `DetailPanel.test.tsx` and
 * the files-tab preview test read) while the PRINTED text does not. The
 * second describe below tells those two apart with `printed()`, because a
 * test that only read `textContent` would pass on the old rendering and on
 * the new one alike and could not tell whether the URL was drawn twice.
 *
 * THE REFUSALS ARE THE POINT OF THE REST. A `javascript:` link, a `data:`
 * URL, a reference climbing out of the project: each is drawn as a control
 * that SAYS what it refused when pressed, because a control that silently
 * does nothing is indistinguishable from a frozen application -- the house
 * rule `FilesTab.tsx`'s `note` is held to.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OUT_MARKDOWN, OUT_URL_TRANSFORM } from '../../src/renderer/panels/DetailPanel.js';
import { FOLD_LIMIT } from '../../src/renderer/panels/link-face.js';
import { type OutActions, OutActionsProvider } from '../../src/renderer/panels/out-actions.js';

afterEach(cleanup);

/**
 * The text a sighted reader gets: every text node under `el` that is not
 * inside an `sr-only` span. happy-dom lays nothing out, so "visible" here is
 * the class the stylesheet clips to one pixel, and the real paint is the web
 * guard's question (`e2e/out-links-shots.mjs`).
 */
function printed(el: Element): string {
  let out = '';
  const walk = (node: Node): void => {
    if (node instanceof Element && node.classList.contains('sr-only')) return;
    if (node.nodeType === 3) out += node.textContent ?? '';
    for (const child of node.childNodes) walk(child);
  };
  walk(el);
  return out;
}

function draw(markdown: string, actions?: Partial<OutActions>) {
  const openLink = vi.fn(async () => ({ ok: true }) as const);
  const openFileRef = vi.fn(async () => ({ ok: true }) as const);
  const value: OutActions = { openLink, openFileRef, ...actions };
  render(
    <OutActionsProvider value={value}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={OUT_MARKDOWN}
        urlTransform={OUT_URL_TRANSFORM}
      >
        {markdown}
      </Markdown>
    </OutActionsProvider>,
  );
  return { openLink, openFileRef };
}

describe('a link in an agent answer', () => {
  it('is a button and never an anchor, with the address still readable', async () => {
    draw('See the [runbook](https://example.test/runbook) before deploying.');
    const control = screen.getByRole('button', { name: /runbook/ });
    expect(control.tagName).toBe('BUTTON');
    expect(document.querySelector('a')).toBeNull();
    expect(document.body.textContent).toContain('https://example.test/runbook');
    expect(control.getAttribute('data-out-address')).toBe('https://example.test/runbook');
  });

  it('asks main to open the address when pressed', async () => {
    const { openLink } = draw('[runbook](https://example.test/runbook)');
    await userEvent.click(screen.getByRole('button', { name: /runbook/ }));
    expect(openLink).toHaveBeenCalledWith('https://example.test/runbook');
  });

  /**
   * A LINK TEXT THAT LIES IS WHY THE ADDRESS IS PRINTED AT ALL.
   * `[https://github.com](https://evil.test)` is one line of markdown.
   */
  it('shows the real destination even when the link text claims another', () => {
    draw('[https://github.com/juzser/vam](https://evil.test/phish)');
    expect(document.body.textContent).toContain('https://evil.test/phish');
    // And the pill's own printed host is the REAL one: a text that is an
    // address is not treated as self-named unless it is THIS address.
    const pill = screen.getByRole('button', { name: /github\.com/ });
    expect(pill.querySelector('[data-out-host]')?.textContent).toBe('evil.test');
    expect(pill.getAttribute('data-out-address')).toBe('https://evil.test/phish');
  });

  it('draws a unicode host in the punycode a browser would resolve', () => {
    draw('[site](https://exämple.test/x)');
    expect(document.body.textContent).toContain('xn--');
    const pill = screen.getByRole('button', { name: /site/ });
    expect(pill.querySelector('[data-out-host]')?.textContent).toBe('xn--exmple-cua.test');
    expect(printed(pill)).not.toContain('ä');
  });

  it('refuses javascript:, says so, and asks main nothing', async () => {
    const { openLink } = draw('[click me](javascript:alert(1))');
    const control = screen.getByRole('button', { name: /click me/ });
    await userEvent.click(control);
    expect((await screen.findByRole('status')).textContent).toMatch(/javascript/);
    expect(openLink).not.toHaveBeenCalled();
  });

  it('refuses a data: URL the same way', async () => {
    const { openLink } = draw('[report](data:text/html;base64,PHNjcmlwdD4=)');
    await userEvent.click(screen.getByRole('button', { name: /report/ }));
    expect((await screen.findByRole('status')).textContent).toMatch(/vam opens http/);
    expect(openLink).not.toHaveBeenCalled();
  });

  /**
   * THE REFUSAL MAIN SENDS BACK IS DRAWN TOO, not just the one the renderer
   * decided. This is the path a build with no bridge takes, and the path a
   * shell that has no browser takes.
   */
  it('draws the refusal main answered with', async () => {
    draw('[runbook](https://example.test/runbook)', {
      openLink: async () => ({ ok: false, reason: 'vam could not get a browser to open it.' }),
    });
    await userEvent.click(screen.getByRole('button', { name: /runbook/ }));
    expect((await screen.findByRole('status')).textContent).toMatch(/could not get a browser/);
  });

  /**
   * THE TEST THAT WOULD GO QUIET IF `OUT_URL_TRANSFORM` WERE REVERTED.
   * react-markdown's own default admits `mailto:` (and `irc:`, `ircs:`,
   * `xmpp:`) and blanks everything else -- two lists deciding one question.
   * vam's list is strictly narrower, and this is the scheme that proves it:
   * allowed by the transform this replaced, refused here.
   */
  it("refuses mailto:, which react-markdown's own default would have allowed", async () => {
    const { openLink } = draw('[write to us](mailto:someone@example.test)');
    await userEvent.click(screen.getByRole('button', { name: /write to us/ }));
    expect((await screen.findByRole('status')).textContent).toMatch(/mailto/);
    expect(openLink).not.toHaveBeenCalled();
  });

  it('still refuses to fetch an image, which is the other half of the wall', () => {
    draw('![architecture diagram](https://example.test/arch.png)');
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('architecture diagram');
  });
});

describe('a link in an agent answer is one pill', () => {
  it('prints the text and the host inside one control, and the whole address nowhere as prose', () => {
    draw('See the [runbook](https://example.test/runbook) before deploying.');
    const pill = screen.getByRole('button', { name: /runbook/ });
    expect(pill.className).toContain('inline-flex');
    expect(pill.className).toContain('rounded-full');
    // The host is INSIDE the button, not beside it, and is the parsed host.
    const host = pill.querySelector('[data-out-host]');
    expect(host).not.toBeNull();
    expect(host?.textContent).toBe('example.test');
    expect(printed(pill)).toBe('runbookexample.test');
    // The full address is not printed anywhere on the page...
    expect(printed(document.body)).not.toContain('https://');
    expect(printed(document.body)).not.toContain('(');
    // ...and is readable three other ways before the button is pressed.
    expect(pill.getAttribute('data-out-address')).toBe('https://example.test/runbook');
    expect(pill.getAttribute('data-note')).toBe(
      'opens https://example.test/runbook in the browser',
    );
    expect(pill.querySelector('.sr-only')?.textContent).toContain(
      'opens https://example.test/runbook in the browser',
    );
    // With a glyph that says "leaves the app", hidden from the name.
    expect(pill.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  /**
   * THE DOUBLE READING THE OPERATOR ASKED TO LOSE. `<https://github.com/…>`
   * is how an agent writes a source most of the time; "text · host" would
   * print `github.com` twice, so the self-named pill prints host + path.
   */
  it('prints host + path when the text IS the address, and not the host twice', () => {
    draw('See <https://github.com/juzser/vam/pull/383> for the fix.');
    const pill = screen.getByRole('button', { name: /github\.com/ });
    expect(printed(pill)).toBe('github.com/juzser/vam/pull/383');
    expect(pill.querySelectorAll('[data-out-host]')).toHaveLength(1);
    expect(pill.querySelector('[data-out-host]')?.textContent).toBe('github.com');
    expect(pill.querySelector('[data-out-path]')?.textContent).toBe('/juzser/vam/pull/383');
    expect(pill.getAttribute('data-out-address')).toBe('https://github.com/juzser/vam/pull/383');
  });

  it('folds a long self-named path in the middle, keeping its tail', () => {
    draw('<https://example.test/a/very/long/path/that/goes/on/and/on?with=query>');
    const path = document.querySelector('[data-out-path]')?.textContent ?? '';
    expect([...path]).toHaveLength(FOLD_LIMIT);
    expect(path).toContain('…');
    expect(path.endsWith('with=query')).toBe(true);
    // The whole address is still on the control.
    expect(document.querySelector('[data-out-link]')?.getAttribute('data-out-address')).toBe(
      'https://example.test/a/very/long/path/that/goes/on/and/on?with=query',
    );
  });

  it('prints a bare self-named host with no path and no slash', () => {
    draw('[https://github.com](https://github.com)');
    const pill = screen.getByRole('button', { name: /github\.com/ });
    expect(printed(pill)).toBe('github.com');
    expect(pill.querySelector('[data-out-path]')).toBeNull();
  });

  it('is the same pill for a refused link, dotted and faint, naming the scheme it refused', () => {
    draw('[poison](javascript:alert(1))');
    const pill = screen.getByRole('button', { name: /poison/ });
    expect(pill.getAttribute('data-out-link-refused')).toBe('true');
    expect(pill.className).toContain('inline-flex');
    expect(pill.className).toContain('rounded-full');
    expect(pill.className).toContain('border-dotted');
    expect(pill.className).toContain('text-ink-faint');
    expect(pill.className).not.toContain('text-done');
    expect(pill.querySelector('[data-out-host]')?.textContent).toBe('javascript:');
    expect(printed(pill)).toBe('poisonjavascript:');
    // The raw address is not painted, and is still on the control.
    expect(pill.getAttribute('data-out-address')).toBe('javascript:alert(1)');
    expect(pill.getAttribute('data-note')).toMatch(/javascript/);
  });

  it('draws an href it cannot parse as a refused pill quoting the text, and refuses in words', async () => {
    const { openLink } = draw('[the thing](<not a url>)');
    const pill = screen.getByRole('button', { name: /the thing/ });
    expect(pill.getAttribute('data-out-link-refused')).toBe('true');
    // Percent-encoded, because that is what remark hands `a:` for a
    // destination with spaces in it -- and the raw href, not a prettier
    // decoding of it, is what main would be asked to open.
    expect(pill.querySelector('[data-out-host]')?.textContent).toBe('not%20a%20url');
    expect(pill.getAttribute('data-out-address')).toBe('not%20a%20url');
    await userEvent.click(pill);
    expect((await screen.findByRole('status')).textContent).toMatch(/not an address vam can read/);
    expect(openLink).not.toHaveBeenCalled();
  });

  it('draws a link with no href at all as a refused pill with no host', async () => {
    draw('[nowhere]()');
    const pill = screen.getByRole('button', { name: /nowhere/ });
    expect(pill.getAttribute('data-out-link-refused')).toBe('true');
    expect(pill.querySelector('[data-out-host]')).toBeNull();
    expect(printed(pill)).toBe('nowhere');
    await userEvent.click(pill);
    expect((await screen.findByRole('status')).textContent).toMatch(/no address to open/);
  });

  it('draws a Sources list of three as three pills, one per item', () => {
    draw(
      [
        'Sources:',
        '',
        '- [runbook](https://example.test/runbook)',
        '- [the PR](https://github.com/juzser/vam/pull/383)',
        '- <https://docs.example.test/retries>',
      ].join('\n'),
    );
    const pills = document.querySelectorAll('li [data-out-link]');
    expect(pills).toHaveLength(3);
    expect([...pills].map((pill) => pill.querySelector('[data-out-host]')?.textContent)).toEqual([
      'example.test',
      'github.com',
      'docs.example.test',
    ]);
    expect(printed(document.body)).not.toContain('https://');
  });
});

describe('a path:line reference in an agent answer', () => {
  it('becomes a control in the middle of a sentence', () => {
    draw('The bug is in src/foo/bar.ts:42 and nowhere else.');
    const control = screen.getByRole('button', { name: 'src/foo/bar.ts:42' });
    expect(control.tagName).toBe('BUTTON');
    expect(document.body.textContent).toContain('The bug is in');
    expect(document.body.textContent).toContain('and nowhere else.');
  });

  it('asks main to resolve it when pressed, sending the reference as written', async () => {
    const { openFileRef } = draw('Look at src/foo/bar.ts:42.');
    await userEvent.click(screen.getByRole('button', { name: 'src/foo/bar.ts:42' }));
    expect(openFileRef).toHaveBeenCalledWith('src/foo/bar.ts:42');
  });

  it('works inside inline code, which is how agents usually write one', async () => {
    const { openFileRef } = draw('Look at ` src/foo/bar.ts:42 ` for the cause.');
    await userEvent.click(screen.getByRole('button', { name: 'src/foo/bar.ts:42' }));
    expect(openFileRef).toHaveBeenCalledWith('src/foo/bar.ts:42');
  });

  it('works inside a list item and a table cell', () => {
    draw(['- see src/a.ts:1', '', '| where |', '| --- |', '| src/b.ts:2 |', ''].join('\n'));
    expect(screen.getByRole('button', { name: 'src/a.ts:1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'src/b.ts:2' })).toBeTruthy();
  });

  /**
   * A FENCE IS A QUOTATION, NOT A SET OF CONTROLS. A patch is full of paths
   * and line numbers; turning them into buttons would make a wall of them.
   *
   * THE UNKNOWN LANGUAGE IS THE CASE THAT BITES: `pre` renders its own
   * coloured `Fence` when it recognises the infostring and falls back to
   * react-markdown's `<code>` -- the SAME component inline code uses -- when
   * it does not. A guard that only covered the coloured path would leave
   * exactly this one open.
   */
  it('finds nothing inside a fence, including one whose language it cannot read', () => {
    draw(
      [
        '```ts',
        'import x from "src/a.ts:1";',
        '```',
        '',
        // NO INFOSTRING AT ALL, and a body that is EXACTLY a reference: this
        // is the fence that goes down the same `code` component inline code
        // uses, and the one an agent writes when it means "here is the
        // location". Without `Fenced` it becomes a button; the mutation that
        // proves it is `Fenced.Provider value={false}`.
        '```',
        'src/b.ts:2',
        '```',
      ].join('\n'),
    );
    expect(screen.queryByRole('button', { name: 'src/a.ts:1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'src/b.ts:2' })).toBeNull();
  });

  it('leaves a clock time, a heading and a URL alone', () => {
    draw('At 10:30, see Note:42 and https://example.test:443/src/a.ts:9');
    expect(screen.queryAllByRole('button')).toHaveLength(1); // the URL, as a link
    expect(document.body.textContent).toContain('10:30');
    expect(document.body.textContent).toContain('Note:42');
  });

  it('draws the refusal for a reference that escapes the project', async () => {
    draw('It is in ../../etc/passwd:1 apparently.', {
      openFileRef: async () => ({
        ok: false,
        reason: "../../etc/passwd is not inside this session's own project directory",
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: '../../etc/passwd:1' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/not inside this session/);
  });

  it('draws the refusal for a reference to a file that is not there', async () => {
    draw('See src/ghost.ts:4.', {
      openFileRef: async () => ({
        ok: false,
        reason: "src/ghost.ts is not a file in this session's project",
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'src/ghost.ts:4' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/not a file/);
  });

  /**
   * NO PROVIDER AT ALL is the browser build and every existing test fixture.
   * The control must still say something rather than swallowing the press.
   */
  it('says so when there is no bridge behind it', async () => {
    render(
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={OUT_MARKDOWN}
        urlTransform={OUT_URL_TRANSFORM}
      >
        {'See src/a.ts:1 and [the runbook](https://example.test/x).'}
      </Markdown>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'src/a.ts:1' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toMatch(/desktop app/);
  });
});
