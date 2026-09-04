// @vitest-environment happy-dom

/**
 * The provider marks: a brand glyph for a source vam recognises, and an honest
 * neutral glyph for one it does not.
 *
 * The rule this file exists to enforce is the one a logo set gets wrong: an
 * unknown provider must never borrow another provider's mark. A wrong logo is
 * worse than no logo, because it is a confident claim about who ran the
 * session. So the fallback is asserted as a POSITIVE outcome -- a neutral glyph
 * that is present and labelled -- not merely as the absence of a crash.
 *
 * The marks themselves are third-party brand shapes and must inherit
 * `currentColor`: vam has two themes, and a baked brand fill is invisible in
 * one of them. That is also a hard constraint of the repo (13.1 bans a literal
 * hex under src/), so it is checked here at the value level rather than left to
 * the file-scanning rule alone.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import { PROVIDER_MARKS } from '../../src/renderer/canvas/provider-marks.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';

function session(id: string): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

function modelFromSource(source: string): CanvasModel {
  return { projects: [{ id: 'p1', name: 'alpha', source, sessions: [session('s1')] }] };
}

const glyph = () => document.querySelector('[data-status-source]');

beforeAll(() => {
  // ReactFlow measures with APIs happy-dom does not implement.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

describe('the provider mark table', () => {
  it('carries a mark for claude-code, the one source vam stamps today', () => {
    expect(Object.keys(PROVIDER_MARKS)).toContain('claude-code');
  });

  it('every mark draws in currentColor and bakes in no literal hex', () => {
    const entries = Object.entries(PROVIDER_MARKS);
    // A table that emptied out would satisfy every assertion below vacuously.
    expect(entries.length).toBeGreaterThan(0);
    for (const [id, mark] of entries) {
      const { container } = render(<mark.Glyph size={11} />);
      const svg = container.querySelector('svg');
      expect(svg, `${id} renders no svg`).not.toBeNull();
      const paths = svg?.querySelectorAll('path') ?? [];
      expect(paths.length, `${id} draws no path`).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path.getAttribute('fill'), `${id} does not inherit currentColor`).toBe(
          'currentColor',
        );
      }
      expect(/#[0-9a-fA-F]{3,8}\b/.test(svg?.outerHTML ?? ''), `${id} bakes in a hex`).toBe(false);
      cleanup();
    }
  });

  it('names the brand each mark depicts, so attribution is not only a comment', () => {
    for (const [id, mark] of Object.entries(PROVIDER_MARKS)) {
      expect(mark.title.length, `${id} has no brand name`).toBeGreaterThan(0);
    }
  });
});

describe('the status bar glyph for a session source', () => {
  it('draws the brand mark for a source vam recognises', () => {
    render(<Canvas model={modelFromSource('claude-code')} />);
    const cell = glyph();
    expect(cell?.getAttribute('data-status-source')).toBe('claude-code');
    expect(cell?.getAttribute('data-source-mark')).toBe('brand');
    expect(cell?.getAttribute('aria-label')).toBe('source: claude-code');
  });

  it('draws a neutral glyph -- never another provider mark -- for an unknown source', () => {
    render(<Canvas model={modelFromSource('a-source-nobody-drew')} />);
    const cell = glyph();
    // Present and labelled: the honest answer is "I do not know this one", said
    // with a generic shape, not with silence and not with someone else's logo.
    expect(cell?.getAttribute('data-status-source')).toBe('a-source-nobody-drew');
    expect(cell?.getAttribute('data-source-mark')).toBe('neutral');
    expect(cell?.getAttribute('aria-label')).toBe('source: a-source-nobody-drew');
    expect(cell?.querySelector('svg')).not.toBeNull();
  });

  it('keeps the lucide glyph for vam-native sources, which are not brands', () => {
    render(<Canvas model={modelFromSource('black-smith')} />);
    expect(glyph()?.getAttribute('data-source-mark')).toBe('native');
  });

  it('does not borrow the Orca logo for the orca source', () => {
    render(<Canvas model={modelFromSource('orca')} />);
    // Orca's own mark is Lovecast's, and its MIT licence covers Orca's code,
    // not its brand. vam shows the neutral glyph and says the name in words.
    expect(glyph()?.getAttribute('data-source-mark')).toBe('neutral');
  });
});
