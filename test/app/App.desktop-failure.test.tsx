// @vitest-environment happy-dom

/**
 * WHERE THE DESKTOP SHELL PUTS ITS FAILURE SENTENCE.
 *
 * The document is `height: 100%` from `html` down to `#root` and nothing sets
 * `overflow: hidden`, so a paragraph added ABOVE a child that is already the
 * full height of the viewport does not shrink it -- it pushes it down. What
 * goes off the bottom is the status bar, which carries the `N failures`
 * button, the only route into the error log. The banner was scrolling away
 * the one control that answers it.
 *
 * happy-dom has no layout engine, so the fix is asserted as the structure
 * that produces it: a full-height flex column, a banner that does not grow,
 * and a canvas holder that may SHRINK (`min-h-0`, without which a flex child
 * refuses to go below its content height and the overflow comes straight
 * back).
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopSourceApi } from '../../src/preload/api.js';

vi.mock('../../src/renderer/canvas/Canvas.js', () => ({
  // The real canvas' own root, which is what the banner used to displace.
  Canvas: () => <div data-test-canvas className="h-full" />,
}));

const { DesktopCanvas } = await import('../../src/renderer/App.js');

afterEach(cleanup);

/** An api whose `describe()` rejects, which is what raises the banner. */
const brokenApi = {
  describe: () => Promise.reject(new Error('no route to a source')),
} as unknown as DesktopSourceApi;

describe('the desktop failure banner does not push the status bar off screen', () => {
  it('lays the banner and the canvas out as a full-height column', async () => {
    const { container } = render(<DesktopCanvas api={brokenApi} />);
    const said = await screen.findByTestId('source-failure');
    expect(said.textContent).toContain('no route to a source');

    const frame = container.firstElementChild as HTMLElement;
    expect(frame.className).toContain('h-full');
    expect(frame.className).toContain('flex');
    expect(frame.className).toContain('flex-col');

    // The banner keeps its own height and nothing more -- including no UA
    // paragraph margins, which are what made it ~43px rather than ~19px.
    expect(said.className).toContain('flex-none');
    expect(said.className).toContain('m-0');

    // And the canvas is in a holder that is allowed to shrink to fit.
    const canvas = container.querySelector('[data-test-canvas]');
    const holder = canvas?.parentElement as HTMLElement;
    expect(holder.className).toContain('flex-1');
    expect(holder.className).toContain('min-h-0');
    // The canvas is no longer a sibling of the banner at the root: its
    // `h-full` is now 100% of a box the banner has already been taken out of.
    expect(said.parentElement).toBe(frame);
    expect(holder.parentElement).toBe(frame);
    expect(canvas?.parentElement).not.toBe(said.parentElement?.parentElement);
  });

  it('draws no banner at all while nothing has failed', () => {
    const quietApi = { describe: () => new Promise(() => {}) } as unknown as DesktopSourceApi;
    const { container } = render(<DesktopCanvas api={quietApi} />);
    expect(container.querySelector('[data-testid="source-failure"]')).toBeNull();
    expect(container.querySelector('[data-test-canvas]')).not.toBeNull();
  });
});
