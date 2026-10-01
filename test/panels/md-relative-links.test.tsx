// @vitest-environment happy-dom
/**
 * A RELATIVE LINK IN RENDERED MARKDOWN (`[roadmap](docs/roadmap.md)`), in both
 * contexts that render one: the Response view's `OutLink` and the Files
 * preview's `FilesLink`. Event #25: it used to be refused with "is not an
 * address vam can read", because `checkLink` has no base to resolve it
 * against. It is now asked of the contained `openFileRef` route as a
 * `path:line` reference, and never of `openLink`.
 *
 * The `OutActions` context is the seam: both spies are installed there, so
 * what each click asks for is exactly what is asserted. Containment itself is
 * main's (`test/main/files/resolve-ipc.test.ts`).
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Markdown from 'react-markdown';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FILES_MARKDOWN,
  FILES_MARKDOWN_URL_TRANSFORM,
  FilesMarkdownDir,
} from '../../src/renderer/panels/files-markdown.js';
import {
  type OutActionResult,
  type OutActions,
  OutActionsProvider,
} from '../../src/renderer/panels/out-actions.js';
import { OUT_MARKDOWN, OUT_URL_TRANSFORM } from '../../src/renderer/panels/out-markdown.js';

afterEach(cleanup);

const MISSING = "docs/missing.md is not a file in this session's project";

function actions(openFileRef: OutActions['openFileRef']) {
  const openLink = vi.fn(async (): Promise<OutActionResult> => ({ ok: true }));
  return { openLink, openFileRef } satisfies OutActions;
}

const ok = async (): Promise<OutActionResult> => ({ ok: true });

function drawOut(markdown: string, value: OutActions) {
  render(
    <OutActionsProvider value={value}>
      <Markdown components={OUT_MARKDOWN} urlTransform={OUT_URL_TRANSFORM}>
        {markdown}
      </Markdown>
    </OutActionsProvider>,
  );
}

function drawFiles(markdown: string, value: OutActions, dir: string) {
  render(
    <OutActionsProvider value={value}>
      <FilesMarkdownDir.Provider value={dir}>
        <Markdown components={FILES_MARKDOWN} urlTransform={FILES_MARKDOWN_URL_TRANSFORM}>
          {markdown}
        </Markdown>
      </FilesMarkdownDir.Provider>
    </OutActionsProvider>,
  );
}

const control = (name: string) => screen.getByRole('button', { name: new RegExp(name) });
const statusText = () => screen.queryAllByRole('status').map((el) => el.textContent ?? '');

describe('Response view: OutLink', () => {
  it('asks openFileRef for the path, never openLink, and draws no refusal', async () => {
    const value = actions(vi.fn(ok));
    drawOut('See [the roadmap](docs/roadmap.md).', value);
    await userEvent.click(control('the roadmap'));
    expect(value.openFileRef).toHaveBeenCalledExactlyOnceWith('docs/roadmap.md:1');
    expect(value.openLink).not.toHaveBeenCalled();
    expect(statusText()).toEqual([]);
  });

  it('carries a line anchor through', async () => {
    const value = actions(vi.fn(ok));
    drawOut('[code](src/a.ts#L42)', value);
    await userEvent.click(control('code'));
    expect(value.openFileRef).toHaveBeenCalledWith('src/a.ts:42');
  });

  it('draws it as a file link with its own hint, not as a refused address', () => {
    drawOut('[the roadmap](docs/roadmap.md)', actions(vi.fn(ok)));
    const button = control('the roadmap');
    expect(button.hasAttribute('data-out-link-refused')).toBe(false);
    expect(button.hasAttribute('data-out-file-link')).toBe(true);
    expect(button.textContent).toContain('opens docs/roadmap.md in Files');
    expect(button.className).not.toContain('text-failed');
  });

  it('shows the resolve channel’s own refusal for a missing target', async () => {
    const value = actions(vi.fn(async () => ({ ok: false, reason: MISSING }) as const));
    drawOut('[gone](docs/missing.md)', value);
    await userEvent.click(control('gone'));
    expect(statusText()).toEqual([` ${MISSING}`]);
    expect(document.body.textContent).not.toContain('is not an address vam can read');
  });

  it('builds no file: URL and no anchor for a relative link', () => {
    drawOut('[the roadmap](docs/roadmap.md)', actions(vi.fn(ok)));
    expect(document.querySelector('a')).toBeNull();
    expect(document.body.innerHTML).not.toContain('file:');
  });

  it('leaves an absolute path refused as before', async () => {
    const value = actions(vi.fn(ok));
    drawOut('[passwd](/etc/passwd)', value);
    await userEvent.click(control('passwd'));
    expect(value.openFileRef).not.toHaveBeenCalled();
    expect(value.openLink).not.toHaveBeenCalled();
    expect(statusText().join('')).toContain('is not an address vam can read');
  });
});

describe('Files preview: FilesLink, for a markdown file at docs/guide.md', () => {
  it('tries the markdown file’s own directory first', async () => {
    const value = actions(vi.fn(ok));
    drawFiles('[roadmap](docs/roadmap.md)', value, 'docs');
    await userEvent.click(control('roadmap'));
    expect(value.openFileRef).toHaveBeenCalledExactlyOnceWith('docs/docs/roadmap.md:1');
    expect(value.openLink).not.toHaveBeenCalled();
  });

  it('opens a sibling on the first try', async () => {
    const value = actions(vi.fn(ok));
    drawFiles('[roadmap](roadmap.md)', value, 'docs');
    await userEvent.click(control('roadmap'));
    expect(value.openFileRef).toHaveBeenCalledExactlyOnceWith('docs/roadmap.md:1');
  });

  it('falls back to the session root when the first is refused, and shows only the last refusal', async () => {
    const openFileRef = vi.fn(async (reference: string): Promise<OutActionResult> => {
      if (reference === 'docs/docs/roadmap.md:1') {
        return {
          ok: false,
          reason: 'docs/docs/roadmap.md is not a file in this session’s project',
        };
      }
      return { ok: true };
    });
    const value = actions(openFileRef);
    drawFiles('[roadmap](docs/roadmap.md)', value, 'docs');
    await userEvent.click(control('roadmap'));
    expect(openFileRef.mock.calls.map((c) => c[0])).toEqual([
      'docs/docs/roadmap.md:1',
      'docs/roadmap.md:1',
    ]);
    expect(statusText()).toEqual([]);
  });

  it('shows the root attempt’s refusal when both fail', async () => {
    const openFileRef = vi.fn(
      async (reference: string): Promise<OutActionResult> => ({
        ok: false,
        reason: `${reference.replace(/:\d+$/, '')} is not a file in this session's project`,
      }),
    );
    drawFiles('[gone](docs/missing.md)', actions(openFileRef), 'docs');
    await userEvent.click(control('gone'));
    await waitFor(() => expect(statusText()).toEqual([` ${MISSING}`]));
    expect(document.body.textContent).not.toContain('is not an address vam can read');
  });

  it('makes one attempt for a markdown file in the root', async () => {
    const value = actions(vi.fn(ok));
    drawFiles('[roadmap](docs/roadmap.md)', value, '');
    await userEvent.click(control('roadmap'));
    expect(value.openFileRef).toHaveBeenCalledExactlyOnceWith('docs/roadmap.md:1');
  });

  it('draws a file link with its hint, builds no anchor or file: URL', () => {
    drawFiles('[roadmap](docs/roadmap.md)', actions(vi.fn(ok)), 'docs');
    const button = control('roadmap');
    expect(button.hasAttribute('data-files-markdown-link-file')).toBe(true);
    expect(button.hasAttribute('data-files-markdown-link-refused')).toBe(false);
    expect(button.textContent).toContain('opens docs/roadmap.md in Files');
    expect(document.querySelector('a')).toBeNull();
    expect(document.body.innerHTML).not.toContain('file:');
  });

  it('keeps web links on openLink', async () => {
    const value = actions(vi.fn(ok));
    drawFiles('[site](https://example.test/)', value, 'docs');
    await userEvent.click(control('site'));
    expect(value.openLink).toHaveBeenCalledWith('https://example.test/');
    expect(value.openFileRef).not.toHaveBeenCalled();
  });
});
