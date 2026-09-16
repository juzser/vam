// @vitest-environment happy-dom

/**
 * THE TREE'S ICONS AND ITS COLOURS — and the reason they are two derivations
 * rather than one.
 *
 * The operator asked, as a question: "can the file tree distinguish file types
 * and folders by colour? And an icon before the folder name." The answer this
 * module gives is yes to both, with a line drawn between two DIFFERENT kinds
 * of claim, and these tests are where that line is held:
 *
 *   SHAPE is a guess, and a cheap one. `.yaml` gets the config glyph because
 *   it looks like config; if that guess is wrong the cost is a 12px picture
 *   that was slightly off. Nothing downstream reads it.
 *
 *   COLOUR is an assertion, and an expensive one. A hue here says "vam has an
 *   opinion about this file" — it can colour it, format it, or preview it —
 *   and it is derived from `highlightLangFor`, the module that actually makes
 *   that decision, rather than from a second list that could disagree with it.
 *
 * WHAT WAS REJECTED, recorded here because a rejection nobody wrote down is a
 * rejection somebody re-litigates: a hue per extension, the way a
 * file-explorer icon theme does it. Forty rows of a `src/` directory in five
 * saturated colours is a christmas tree, not a tree — the thing an operator is
 * doing in this column is reading NAMES, and every hue added competes with
 * them. Shape carries the family (seven of them), colour carries the one fact
 * that is vam's to state, and the majority of any real repository stays grey.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { editorFileKind } from '../../src/renderer/panels/files-editor-text.js';
import { highlightLangFor } from '../../src/renderer/panels/files-highlight.js';
import {
  FILE_ICON_SHAPES,
  FILE_ROW_INKS,
  type FileIconShape,
  FileRowIcon,
  fileIconShape,
  fileRowInk,
} from '../../src/renderer/panels/files-icons.js';

afterEach(cleanup);

describe('the shape — a family guess, and it is allowed to be one', () => {
  it('names a directory before it looks at anything else', () => {
    // A directory called `notes.md` is a directory. The `isDirectory` flag is
    // the tree's own answer from `files-tree.ts`, and it outranks the name.
    expect(fileIconShape('/w/src', true)).toBe('directory');
    expect(fileIconShape('/w/notes.md', true)).toBe('directory');
  });

  it('sorts the families a repository actually holds', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['/w/package.json', 'json'],
      ['/w/tsconfig.jsonc', 'json'],
      ['/w/a.json5', 'json'],
      ['/w/.env', 'config'],
      ['/w/.env.production', 'config'],
      ['/w/dev.env', 'config'],
      ['/w/app.ini', 'config'],
      ['/w/pyproject.toml', 'config'],
      ['/w/compose.yaml', 'config'],
      ['/w/ci.yml', 'config'],
      ['/w/src/index.ts', 'code'],
      ['/w/src/App.tsx', 'code'],
      ['/w/run.sh', 'code'],
      ['/w/main.py', 'code'],
      ['/w/style.css', 'code'],
      ['/w/page.vue', 'code'],
      ['/w/logo.svg', 'image'],
      ['/w/shot.PNG', 'image'],
      ['/w/photo.jpeg', 'image'],
      ['/w/README.md', 'doc'],
      ['/w/NOTES.markdown', 'doc'],
      ['/w/LICENSE.txt', 'doc'],
      ['/w/LICENSE', 'plain'],
      ['/w/Makefile', 'plain'],
      ['/w/.gitignore', 'plain'],
      ['/w/binary.bin', 'plain'],
    ];
    // A guard that examined nothing is the failure mode this repo has shipped
    // four times. The corpus size is part of the expectation.
    expect(cases.length).toBeGreaterThan(20);
    expect(cases.map(([path]) => `${path} ${fileIconShape(path, false)}`)).toEqual(
      cases.map(([path, want]) => `${path} ${want}`),
    );
  });

  it('answers only shapes it declares, for anything at all', () => {
    for (const path of ['/w/x', '/w/.', '/w/..', '/w/a.', '/w/.a.b.c', '/w/ ', '/w/中文.md']) {
      expect(FILE_ICON_SHAPES, path).toContain(fileIconShape(path, false));
    }
  });
});

describe('the colour — an assertion, and it is derived from the module that makes it', () => {
  /**
   * THE LOAD-BEARING TEST. A second list of "which files are special" is
   * exactly how the tree comes to paint a `.md` as understood on the same day
   * the editor stops colouring one. There is no second list: the hue is a
   * function of `highlightLangFor`, so the two cannot disagree by
   * construction, and this is what says so rather than the comment.
   */
  it('gives a hue to exactly the files the highlighter has an opinion about', () => {
    const grey = fileRowInk('/w/src/index.ts', false);
    for (const path of [
      '/w/package.json',
      '/w/.env',
      '/w/.env.local',
      '/w/dev.env',
      '/w/app.ini',
      '/w/README.md',
      '/w/NOTES.markdown',
    ]) {
      expect(highlightLangFor(path), path).not.toBeNull();
      expect(fileRowInk(path, false), path).not.toBe(grey);
    }
    for (const path of [
      '/w/src/index.ts',
      '/w/run.sh',
      '/w/a.yaml',
      '/w/a.toml',
      '/w/a.jsonc',
      '/w/logo.svg',
      '/w/Makefile',
    ]) {
      expect(highlightLangFor(path), path).toBeNull();
      expect(fileRowInk(path, false), path).toBe(grey);
    }
  });

  /**
   * THE HONEST HALF OF THE SHAPE/COLOUR SPLIT, asserted so it cannot be
   * quietly "fixed" into a lie: a `.yaml` and a `.ini` wear the SAME glyph,
   * because they are the same kind of thing to a human, and DIFFERENT inks,
   * because vam understands one of them and not the other.
   */
  it('lets the glyph say "config" while the ink says "and vam has nothing for it"', () => {
    expect(fileIconShape('/w/a.yaml', false)).toBe(fileIconShape('/w/a.ini', false));
    expect(fileRowInk('/w/a.yaml', false)).not.toBe(fileRowInk('/w/a.ini', false));
    expect(fileRowInk('/w/a.yaml', false)).toBe(fileRowInk('/w/src/index.ts', false));
    // And the formatter's own list is a third question again, which is why
    // `.jsonc` looks like JSON, is coloured like nothing, and is refused by
    // name when the operator presses Format on it.
    expect(fileIconShape('/w/a.jsonc', false)).toBe('json');
    expect(editorFileKind('/w/a.jsonc')).toBeNull();
  });

  it('gives a directory an ink of its own — the thing a tree is FOR', () => {
    const dir = fileRowInk('/w/src', true);
    expect(dir).not.toBe(fileRowInk('/w/src/index.ts', false));
    expect(dir).not.toBe(fileRowInk('/w/README.md', false));
  });

  /**
   * NO INVENTED RUNG, AND NO STATUS COLOUR.
   *
   * `styles.css` is a ladder, and every ink here has to be one of its rungs —
   * a literal hex or an arbitrary `text-[#...]` would be a colour nothing
   * measures, in either theme. The four status hues are excluded separately
   * and for a different reason: green, amber, blue and red mean "running",
   * "waiting", "done" and "failed" everywhere else in this application, and
   * spending one on "this is a JSON file" makes both readings weaker.
   * `test/renderer/token-contrast.test.ts` is where these same tokens are held
   * to 1.4.11's 3:1 on all three fills a tree row can have.
   */
  it('paints only declared tokens — never a literal, never a status colour', () => {
    const paths = [
      '/w/src',
      '/w/package.json',
      '/w/.env',
      '/w/app.ini',
      '/w/README.md',
      '/w/src/index.ts',
      '/w/logo.svg',
      '/w/Makefile',
    ];
    for (const path of paths) {
      for (const isDirectory of [true, false]) {
        expect(FILE_ROW_INKS, `${path} ${isDirectory}`).toContain(fileRowInk(path, isDirectory));
      }
    }
    for (const ink of FILE_ROW_INKS) {
      expect(ink).toMatch(/^text-[a-z-]+$/);
      expect([
        'text-running',
        'text-waiting',
        'text-done',
        'text-failed',
        'text-idle',
      ]).not.toContain(ink);
    }
    // Five inks: one per hue plus the grey the majority of a repository takes.
    expect(FILE_ROW_INKS).toHaveLength(5);
  });
});

/** One path per shape, so the render tests cover every family rather than the
 *  two somebody happened to type. Keyed by `FileIconShape` rather than by
 *  `string`, so a family added without a sample here fails to compile. */
const SAMPLE: Record<FileIconShape, string> = {
  directory: '/w/src',
  json: '/w/package.json',
  config: '/w/.env',
  code: '/w/src/index.ts',
  image: '/w/logo.svg',
  doc: '/w/README.md',
  plain: '/w/Makefile',
};

describe('the glyph that is actually drawn', () => {
  const draw = (path: string, isDirectory: boolean, open = false) => {
    render(<FileRowIcon path={path} isDirectory={isDirectory} open={open} />);
    return document.querySelector('[data-file-icon]');
  };

  it('draws a folder before a directory’s name, and opens it when the row is open', () => {
    expect(draw('/w/src', true, false)?.getAttribute('data-file-icon')).toBe('directory');
    cleanup();
    expect(draw('/w/src', true, true)?.getAttribute('data-file-icon')).toBe('directory-open');
  });

  /**
   * MUTATION TARGET: point two shapes at the same lucide component and this
   * reddens. Without it, "seven families" could quietly become five drawing
   * the same picture, and every other test in this file would still pass —
   * they all check the STRING, and the string is not the glyph.
   */
  it('draws a different picture for every shape it declares', () => {
    const drawn = new Set<string>();
    for (const shape of FILE_ICON_SHAPES) {
      const path = SAMPLE[shape];
      cleanup();
      const icon = draw(path, shape === 'directory');
      expect(icon, shape).not.toBeNull();
      expect(icon?.getAttribute('data-file-icon'), shape).toBe(shape);
      // THE WHOLE GEOMETRY, not the first path element. Every `File*` glyph in
      // lucide opens with the same page outline and differs only in what is
      // drawn inside it — a probe that read one path would have reported three
      // distinct pictures for seven families and been wrong about four of them.
      drawn.add(icon?.innerHTML ?? shape);
    }
    expect(drawn.size).toBe(FILE_ICON_SHAPES.length);
  });

  it('wears its row’s ink and nothing brighter', () => {
    for (const shape of FILE_ICON_SHAPES) {
      const path = SAMPLE[shape];
      cleanup();
      const icon = draw(path, shape === 'directory');
      expect(icon?.getAttribute('class'), shape).toContain(fileRowInk(path, shape === 'directory'));
    }
  });

  it('is hidden from a screen reader — the row’s own name is the name', () => {
    expect(draw('/w/README.md', false)?.getAttribute('aria-hidden')).toBe('true');
  });
});
