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
import { type OutActions, OutActionsProvider } from '../../src/renderer/panels/out-actions.js';

afterEach(cleanup);

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
  });

  it('draws a unicode host in the punycode a browser would resolve', () => {
    draw('[site](https://exämple.test/x)');
    expect(document.body.textContent).toContain('xn--');
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
