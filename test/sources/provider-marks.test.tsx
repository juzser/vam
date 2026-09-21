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
 *
 * THE BRAND MARKS CARRY A COLOUR NOW, and none of the sentence above changed.
 * The colour arrives as a TOKEN CLASS -- `text-brand-claude` -- which resolves
 * to a different hex under each theme, so `currentColor` and the no-hex rule
 * both hold exactly as written: what a mark carries is a NAME, and
 * `styles.css` decides what that name is worth per theme.
 * `test/renderer/token-contrast.test.ts` holds the two values to their floors,
 * and only `e2e/provider-mark-shots.mjs` can prove a class emitted a rule at
 * all -- a Tailwind v4 utility naming a token that does not exist emits none,
 * silently, and no unit environment can see that.
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

  /**
   * WHICH MARKS ARE COLOURED IS A DECISION, written down as a table rather
   * than left as whatever the code happens to do.
   *
   * The two sources an operator really has are coloured; the other three
   * marks are in the table for a source vam does not stamp yet and take no
   * tone, because a tone is not a hex somebody copied -- it is two measured
   * values, one per theme (`token-contrast.test.ts`). The day one of those
   * sources goes live, this row is what says the measurement is owed.
   */
  const TONES: Readonly<Record<string, string | null>> = {
    'claude-code': 'text-brand-claude',
    codex: 'text-brand-openai',
    'github-copilot': null,
    gemini: null,
    opencode: null,
  };

  it('gives each mark the tone it was measured for, and no other mark one', () => {
    expect(Object.keys(PROVIDER_MARKS).sort()).toEqual(Object.keys(TONES).sort());
    for (const [id, tone] of Object.entries(TONES)) {
      expect(PROVIDER_MARKS[id]?.ink ?? null, `${id}'s tone`).toBe(tone);
    }
  });

  it('paints a tone with a token class and never with a literal, on the drawn svg', () => {
    // The PAINTED element, not the wrapper: the wrapper belongs to whichever
    // surface drew the lane, and colouring that would have coloured the branch
    // glyph beside it in the sidebar. The class has to be a literal in the
    // module's source text too -- Tailwind scans source, so a class assembled
    // from a constant is one it never generates -- and that is what makes the
    // e2e paint check load-bearing rather than decorative.
    for (const [source, tone] of [
      ['claude-code', 'text-brand-claude'],
      ['codex', 'text-brand-openai'],
    ] as const) {
      const { container } = render(<SourceMark source={source} lane={12} />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('class'), `${source} paints no tone`).toBe(tone);
      expect(/#[0-9a-fA-F]{3,8}\b/.test(svg?.outerHTML ?? ''), `${source} bakes a hex`).toBe(false);
      cleanup();
    }
  });

  it('leaves vam’s own concepts and the unknown box on the row’s ink', () => {
    // `factory` and `bundled-sample` are vam's own ideas, not companies, and
    // an invented colour for them would be the decoration the module exists to
    // refuse. The neutral box claims nothing and is painted like it.
    for (const source of ['factory', 'bundled-sample', 'a-source-from-2027']) {
      const { container } = render(<SourceMark source={source} lane={12} />);
      const cls = container.querySelector('svg')?.getAttribute('class') ?? '';
      expect(cls, `${source} took a brand tone`).not.toMatch(/brand/);
      cleanup();
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

  it('draws OpenAI’s own mark for codex, which is what ran that session', () => {
    render(<Canvas model={modelFromSource('codex')} />);
    expect(glyph()?.getAttribute('data-source-mark')).toBe('brand');
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
 * raw.githubusercontent.com/simple-icons/simple-icons/<tag>/icons/<slug>.svg
 * and take the `d` of its single `<path>`. The slug for each key is in the
 * table; they are not the same strings as vam's source ids, which is exactly
 * why they are written down.
 *
 * TWO TAGS, AND THE SECOND ONE IS THE POINT OF WRITING THE TAG DOWN AT ALL.
 * Four marks come from 16.32.0. OpenAI's comes from 15.0.0, because Simple
 * Icons REMOVED `icons/openai.svg` in 16.0.0 -- verified on 2026-09-21: that
 * path is 200 at the 15.0.0 tag and 404 at 16.32.0. The module header carries
 * the whole argument for taking it anyway; what this file is for is that the
 * copy stays a copy, and a digest taken against the wrong tag would be a pin
 * to nothing.
 */
const SIMPLE_ICONS_PINS: Readonly<Record<string, { slug: string; tag: string; digest: string }>> = {
  'claude-code': { slug: 'claude', tag: '16.32.0', digest: '0442033dcc3824e5' },
  codex: { slug: 'openai', tag: '15.0.0', digest: '3fae9b38d571a5ab' },
  'github-copilot': { slug: 'githubcopilot', tag: '16.32.0', digest: '995f11748f4ada6b' },
  gemini: { slug: 'googlegemini', tag: '16.32.0', digest: 'a27790dcbe07c23d' },
  opencode: { slug: 'opencode', tag: '16.32.0', digest: 'f4f11e1603a4a49c' },
};

describe('the brand paths are still the ones that were copied', () => {
  it('pins every mark to the Simple Icons outline it was taken from, byte for byte', () => {
    // A table emptied out, or a key renamed, must not pass by having nothing
    // left to check.
    expect(Object.keys(PROVIDER_MARKS).sort()).toEqual(Object.keys(SIMPLE_ICONS_PINS).sort());
    for (const [id, { digest }] of Object.entries(SIMPLE_ICONS_PINS)) {
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
        `${id}'s outline is no longer the one copied from Simple Icons ${SIMPLE_ICONS_PINS[id]?.tag}. If that was deliberate, re-derive the digest from the URL above; if it was a hand edit to make the mark fit, undo it -- an adjusted logo is an invented one.`,
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
    // Codex: OpenAI's own product, drawn with OpenAI's own mark. The module
    // header carries the receipt and the argument for taking it from the
    // 15.0.0 tag.
    expect(markRegisterOf('codex')).toBe('brand');
    expect(markRegisterOf('orca')).toBe('neutral');
    expect(markRegisterOf('a-source-from-2027')).toBe('neutral');
    // The empty string is what `sourceKeyOf` writes for an entry that names
    // no source; it must resolve rather than throw.
    expect(markRegisterOf('')).toBe('neutral');
  });

  it('carries OpenAI’s mark for Codex, and it is the real one and not a lookalike', () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE, and the reversal is the record.
    // Simple Icons removed the OpenAI icon in 16.0.0 (PR 13944, issue 12739):
    // openai.com/brand grants a NON-TRANSFERABLE permission, so they -- a
    // redistributor relicensing everything they ship as CC0 -- could not carry
    // it. vam is not a redistributor of an icon set. It draws the mark to
    // identify OpenAI's own product beside its own name, on a session that
    // really came from it, which is the nominative use this file already
    // accepts for the Claude mark. The operator read the position and decided.
    //
    // What has NOT changed is the thing the removal makes riskiest: an
    // approximation. The path is taken verbatim from the 15.0.0 tag and pinned
    // by digest above, so "make it fit" fails rather than ships.
    expect(PROVIDER_MARKS.codex).not.toBeUndefined();
    expect(PROVIDER_MARKS.codex?.title).toBe('OpenAI');
  });

  it('draws three different shapes for the three registers', () => {
    const drawn = (source: string) => {
      const { container } = render(<SourceMark source={source} lane={12} />);
      const html = container.querySelector('svg')?.innerHTML ?? '';
      cleanup();
      return html;
    };
    const brand = drawn('claude-code');
    // `factory` rather than `codex`: Codex moved to the brand register, and
    // sampling it here would have compared two brand marks and called one of
    // them the native register.
    const native = drawn('factory');
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
    // Codex is a brand path now, so it pays the same pixel Claude does; the
    // lucide register is `factory`.
    expect(width('codex')).toBe('11');
    expect(width('factory')).toBe('12');
    expect(width('a-source-from-2027')).toBe('12');
  });
});
