/**
 * The channel that actually gets an issue filed.
 *
 * THE DEFECT IT CLOSES. `report.ts` composed a prefilled `issues/new` URL and
 * the panel copied it to the clipboard, because `window.open` and every
 * off-origin navigation are denied by policy (`src/main/csp.ts`) -- so the
 * only route to github.com was the operator pasting a 4KB URL into a browser
 * by hand. The operator's report was "the error log cannot create an issue",
 * and that is what they meant: there was no route, only a string.
 *
 * THE RENDERER STILL NAMES NO DESTINATION, which is the constraint the fix had
 * to be built inside rather than around. `remoteOpenLink`'s comment states the
 * rule: a channel that took a URL from the renderer would be the
 * navigate-anywhere capability the policy exists to refuse. So this one takes
 * a TITLE and a BODY -- text, not a location -- and main builds the URL from
 * its own constant. There is no argument shape that can reach any other host.
 *
 * WHAT IT DOES NOT DO IS POST. `report.ts`'s header is still true: pressing
 * submit on github.com is the operator's decision and their last chance to
 * read the body before it becomes public. This opens the prefilled FORM in
 * their own browser; the human review is exactly where it was.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../../src/main/ipc/channels.js';
import { MAX_ISSUE_FIELD, registerIssueIpc } from '../../../src/main/issue/ipc.js';
import { NEW_ISSUE_URL } from '../../../src/shared/issue.js';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function harness(openExternal: (url: string) => Promise<void> = async () => {}) {
  const opened: string[] = [];
  const handlers = new Map<string, Handler>();
  registerIssueIpc({ handle: (channel, listener) => void handlers.set(channel, listener) }, (url) =>
    openExternal(url).then(() => void opened.push(url)),
  );
  const handler = handlers.get(CHANNELS.issueOpen);
  if (handler === undefined) throw new Error('the issue channel was never registered');
  return { invoke: (...args: unknown[]) => handler({}, ...args), opened };
}

describe('the channel that opens a prefilled issue', () => {
  it('opens the vam issues form with the title and body prefilled', async () => {
    const { invoke, opened } = harness();
    expect(await invoke('cli-failed while attempting: send prompt', 'it broke')).toBe(true);
    expect(opened).toHaveLength(1);
    const url = new URL(opened[0] as string);
    expect(`${url.origin}${url.pathname}`).toBe(NEW_ISSUE_URL);
    expect(url.searchParams.get('title')).toBe('cli-failed while attempting: send prompt');
    expect(url.searchParams.get('body')).toBe('it broke');
  });

  /**
   * THE POINT OF THE WHOLE SHAPE. A renderer that could name a destination is
   * a renderer that could exfiltrate to one, so the test is not "it rejects a
   * bad URL" -- it is that a URL in either field lands in a QUERY PARAMETER of
   * main's own constant and nowhere else.
   */
  it('cannot be talked into opening anything but the vam issues form', async () => {
    const { invoke, opened } = harness();
    await invoke('https://evil.example/steal', 'https://evil.example/steal');
    const url = new URL(opened[0] as string);
    expect(url.host).toBe('github.com');
    expect(`${url.origin}${url.pathname}`).toBe(NEW_ISSUE_URL);
    // And the attempt survives as text, so a maintainer sees what was sent.
    expect(url.searchParams.get('title')).toBe('https://evil.example/steal');
  });

  it('refuses anything that is not two strings', async () => {
    const { invoke, opened } = harness();
    expect(await invoke()).toBe(false);
    expect(await invoke('only a title')).toBe(false);
    expect(await invoke(1, 2)).toBe(false);
    expect(await invoke('title', 'body', 'and a third')).toBe(false);
    expect(opened).toEqual([]);
  });

  it('refuses an empty title, which would open a form with nothing in it', async () => {
    const { invoke, opened } = harness();
    expect(await invoke('', 'a body')).toBe(false);
    expect(opened).toEqual([]);
  });

  /**
   * The bound is not a guess about GitHub: it is about main's own event loop
   * and about a URL a browser will accept at all. The renderer is the least
   * trusted process here, and this is the same reasoning `MAX_CLIPBOARD_LENGTH`
   * already carries one directory over.
   */
  it('refuses a field past the bound rather than opening a truncated report', async () => {
    const { invoke, opened } = harness();
    expect(await invoke('t', 'x'.repeat(MAX_ISSUE_FIELD + 1))).toBe(false);
    expect(await invoke('t'.repeat(MAX_ISSUE_FIELD + 1), 'b')).toBe(false);
    expect(opened).toEqual([]);
    // The bound itself is allowed: an off-by-one here silently costs reports.
    expect(await invoke('t', 'x'.repeat(MAX_ISSUE_FIELD))).toBe(true);
  });

  it('answers false when no browser opened, rather than claiming one did', async () => {
    const { invoke } = harness(async () => {
      throw new Error('no handler for https');
    });
    expect(await invoke('cli-failed', 'it broke')).toBe(false);
  });
});
