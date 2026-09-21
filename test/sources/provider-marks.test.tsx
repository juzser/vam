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

import { createHash } from 'node:crypto';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import {
  markRegisterOf,
  PROVIDER_MARKS,
  SourceMark,
} from '../../src/renderer/sources/provider-marks.js';

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
  // The rendered session panes measure with APIs happy-dom does not implement.
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
    render(<Canvas model={modelFromSource('factory')} />);
    expect(glyph()?.getAttribute('data-source-mark')).toBe('native');
  });

  it('does not borrow the Orca logo for the orca source', () => {
    render(<Canvas model={modelFromSource('orca')} />);
    // Orca's own mark is Lovecast's, and its MIT licence covers Orca's code,
    // not its brand. vam shows the neutral glyph and says the name in words.
    expect(glyph()?.getAttribute('data-source-mark')).toBe('neutral');
  });

  it('draws vam’s own glyph for codex, not a borrowed OpenAI one', () => {
    render(<Canvas model={modelFromSource('codex')} />);
    expect(glyph()?.getAttribute('data-source-mark')).toBe('native');
    expect(glyph()?.getAttribute('aria-label')).toBe('source: codex');
  });
});

/**
 * THE BRAND PATHS ARE COPIES, and a copy is only worth anything while it is
 * still identical to what it was copied from.
 *
 * The digest below is `sha256` of the `d` attribute, first 16 hex characters.
 * It is not a checksum for its own sake: the one failure mode that turns a
 * verbatim, CC0-licensed outline into an invented approximation of somebody's
 * trademark is a well-meaning hand edit -- a nudge to make a mark sit better
 * in its lane, a path "simplified". That edit is invisible in review, and this
 * is what makes it loud.
 *
 * TO RE-DERIVE, or to update one on purpose: fetch
 * raw.githubusercontent.com/simple-icons/simple-icons/16.32.0/icons/<slug>.svg
 * and take the `d` of its single `<path>`. The slug for each key is in the
 * table; they are not the same strings as vam's source ids, which is exactly
 * why they are written down.
 */
const SIMPLE_ICONS_16_32_0: Readonly<Record<string, { slug: string; digest: string }>> = {
  'claude-code': { slug: 'claude', digest: '0442033dcc3824e5' },
  'github-copilot': { slug: 'githubcopilot', digest: '995f11748f4ada6b' },
  gemini: { slug: 'googlegemini', digest: 'a27790dcbe07c23d' },
  opencode: { slug: 'opencode', digest: 'f4f11e1603a4a49c' },
};

describe('the brand paths are still the ones that were copied', () => {
  it('pins every mark to its Simple Icons 16.32.0 outline, byte for byte', () => {
    // A table emptied out, or a key renamed, must not pass by having nothing
    // left to check.
    expect(Object.keys(PROVIDER_MARKS).sort()).toEqual(Object.keys(SIMPLE_ICONS_16_32_0).sort());
    for (const [id, { digest }] of Object.entries(SIMPLE_ICONS_16_32_0)) {
      const mark = PROVIDER_MARKS[id];
      expect(mark, `${id} is gone from the table`).not.toBeUndefined();
      // The `expect` above is the failure; this is the NARROWING, which
      // `toBeUndefined` does not do -- and `vitest run` does not typecheck, so
      // without it only `typecheck:test` in CI would have said so.
      if (mark === undefined) continue;
      const { container } = render(<mark.Glyph size={11} />);
      const d = container.querySelector('path')?.getAttribute('d') ?? '';
      expect(d.length, `${id} draws an empty path`).toBeGreaterThan(0);
      expect(
        createHash('sha256').update(d).digest('hex').slice(0, 16),
        `${id}'s outline is no longer the one copied from Simple Icons 16.32.0. If that was deliberate, re-derive the digest from the URL above; if it was a hand edit to make the mark fit, undo it -- an adjusted logo is an invented one.`,
      ).toBe(digest);
      cleanup();
    }
  });
});

describe('the three registers, as one answer every surface reads', () => {
  it('puts each source in the register its licence and its nature allow', () => {
    expect(markRegisterOf('claude-code')).toBe('brand');
    // vam's own concepts: no brand to borrow and none wanted.
    expect(markRegisterOf('factory')).toBe('native');
    expect(markRegisterOf('bundled-sample')).toBe('native');
    // Codex: a real product whose mark vam may not carry. See the module
    // header for the receipt.
    expect(markRegisterOf('codex')).toBe('native');
    expect(markRegisterOf('orca')).toBe('neutral');
    expect(markRegisterOf('a-source-from-2027')).toBe('neutral');
    // The empty string is what `sourceKeyOf` writes for an entry that names
    // no source; it must resolve rather than throw.
    expect(markRegisterOf('')).toBe('neutral');
  });

  it('carries no OpenAI mark, because it is not vam’s to redistribute', () => {
    // Simple Icons REMOVED the OpenAI icon in 16.0.0 (PR 13944): the usage
    // terms at openai.com/brand grant a non-transferable permission, so they
    // could not ship it under CC0. Lifting it out of the 15.x tag would be
    // redistributing what its custodians concluded they may not, and drawing
    // something similar would be worse. If permission is ever obtained this
    // line is the one to change, deliberately, having read why it was here.
    expect(PROVIDER_MARKS.codex).toBeUndefined();
  });

  it('draws three different shapes for the three registers', () => {
    const drawn = (source: string) => {
      const { container } = render(<SourceMark source={source} lane={12} />);
      const html = container.querySelector('svg')?.innerHTML ?? '';
      cleanup();
      return html;
    };
    const brand = drawn('claude-code');
    const native = drawn('codex');
    const neutral = drawn('a-source-from-2027');
    // Non-empty first: three equal empty strings would satisfy "all three
    // differ" for exactly the wrong reason.
    for (const [name, html] of [
      ['brand', brand],
      ['native', native],
      ['neutral', neutral],
    ] as const) {
      expect(html.length, `the ${name} register drew nothing`).toBeGreaterThan(0);
    }
    expect(new Set([brand, native, neutral]).size).toBe(3);
  });

  it('takes a pixel off a brand path so the two registers paint the same ink', () => {
    // A Simple Icons outline fills its 24-unit viewBox; a lucide glyph keeps
    // about two units of margin inside its own. Handed one number the brand
    // mark is the bigger and heavier of the two, which is the inversion
    // `HEADING_GLYPH_PX` records having shipped once already. The box is
    // therefore not the same for the two registers, on purpose.
    const width = (source: string) => {
      const { container } = render(<SourceMark source={source} lane={12} />);
      const value = container.querySelector('svg')?.getAttribute('width');
      cleanup();
      return value;
    };
    expect(width('claude-code')).toBe('11');
    expect(width('codex')).toBe('12');
    expect(width('a-source-from-2027')).toBe('12');
  });
});
