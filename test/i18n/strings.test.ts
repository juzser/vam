/**
 * THE STRING CATALOGUE, and the three properties that make a second language
 * possible rather than merely imaginable.
 *
 * Operator: "push the text out into i18n so later we can do a language
 * switch." The switch is not built here -- there is one locale and no picker --
 * and that is the point: what this has to get right is the SEAM, so that
 * adding `vi` is a file and not a refactor. A catalogue nobody can add a
 * locale to without editing call sites has moved the strings without moving
 * the problem.
 *
 * THE THREE PROPERTIES:
 *
 *  1. A KEY THAT DOES NOT EXIST IS A TYPE ERROR, not a runtime fallback that
 *     paints the key. `t()` takes the union of the catalogue's own keys, so a
 *     typo cannot reach a screen -- `tsc` is the guard, and the test below only
 *     records that the union is real.
 *  2. AN INCOMPLETE LOCALE DOES NOT COMPILE. Every locale is typed as a total
 *     record over those keys, so the day `vi` arrives, a string nobody
 *     translated is a build failure rather than an English sentence in a
 *     Vietnamese dialog.
 *  3. INTERPOLATION IS NAMED, NOT POSITIONAL. `{theme}` rather than `{0}`,
 *     because a translator reordering a sentence is the normal case and a
 *     positional slot makes that a bug.
 *
 * WHAT IS DELIBERATELY NOT HERE: a library. `i18next` and its relatives carry
 * plural rules, locale negotiation, lazy namespaces and a runtime -- for a
 * catalogue and a `replace`. vam has one locale, one process and no server to
 * negotiate with; the day plurals are needed, they can be argued then, on the
 * evidence of a sentence that needs them.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES, STRINGS, t } from '../../src/renderer/i18n/strings.js';

describe('the catalogue', () => {
  it('holds a real corpus, so every claim below is about something', () => {
    // Four guards in this repo have gone green having examined zero of
    // anything. The settings surface alone is more than twenty strings.
    expect(Object.keys(STRINGS.en).length).toBeGreaterThan(20);
    expect(LOCALES).toContain('en');
  });

  it('gives every key a non-empty string in every locale it ships', () => {
    const empty: string[] = [];
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(STRINGS[locale])) {
        if (typeof value !== 'string' || value.trim() === '') empty.push(`${locale}: ${key}`);
      }
    }
    expect(empty).toEqual([]);
  });

  it('gives every locale exactly the keys English has, no more and no fewer', () => {
    // The type system already refuses a locale with a missing key; this is the
    // same claim at runtime, and it catches the other direction too -- a key a
    // translator added that no call site reads is a string nobody will ever
    // see, and it will rot.
    const english = Object.keys(STRINGS.en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(STRINGS[locale]).sort(), locale).toEqual(english);
    }
  });

  it('returns the string for a key', () => {
    expect(t('settings.title')).toBe(STRINGS.en['settings.title']);
  });
});

describe('interpolation', () => {
  it('fills a named slot', () => {
    expect(t('settings.appearance.templates.hint', { theme: 'dark' })).toContain('dark');
    expect(t('settings.appearance.templates.hint', { theme: 'light' })).toContain('light');
  });

  it('leaves a slot nobody filled visible rather than blank', () => {
    // A MISSING VALUE MUST NOT LOOK LIKE PROSE. Replacing it with '' would
    // give "a whole  palette in one press" -- a sentence that reads as
    // finished and is wrong. Left as `{theme}`, it is obviously a bug and
    // names the slot that was missed.
    expect(t('settings.appearance.templates.hint', {})).toContain('{theme}');
  });

  it('never treats a value as a pattern', () => {
    // `String.replace` reads `$&` and friends in the REPLACEMENT, so a value
    // containing one would splice the match back into the sentence. Values
    // come from the app, not from a network, but a theme name is still not a
    // regular expression and must never be read as one.
    expect(t('settings.appearance.templates.hint', { theme: '$& $` $$' })).toContain('$& $` $$');
  });

  it('fills every occurrence of a slot, not only the first', () => {
    expect(t('test.repeat', { word: 'x' })).toBe('x and x');
  });
});

describe('the keys themselves', () => {
  it('are namespaced by where they are read, so a surface can be found', () => {
    // `settings.appearance.theme.hint` rather than `themeHint`: with one flat
    // list of forty names, nobody can tell which screen a string is on, and a
    // translator working on Settings has no way to take the Settings strings.
    const stray = Object.keys(STRINGS.en).filter(
      (key) => !/^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9-]*)+$/.test(key),
    );
    expect(stray).toEqual([]);
  });
});

describe('the settings surface reads the catalogue rather than its own literals', () => {
  const SOURCE = readFileSync(
    resolve(process.cwd(), 'src/renderer/settings/SettingsOverlay.tsx'),
    'utf8',
  );

  it('routes its copy through `t`, in quantity', () => {
    // THE CORPUS, FIRST. A scan for "no leftover literals" over a file that
    // had been emptied would pass forever, and so would one over a file that
    // never adopted the catalogue at all.
    const calls = [...SOURCE.matchAll(/\bt\(\s*'[a-z]/g)];
    expect(calls.length).toBeGreaterThanOrEqual(15);
  });

  it('leaves no prose behind in a label, a hint or a placeholder', () => {
    // A NEGATIVE SCAN, WHICH IS THE ONLY SAFE KIND OVER SOURCE. An earlier
    // guard in this repo asked that a class string be PRESENT and was
    // satisfied by finding it inside a comment -- prose passed it while
    // nothing painted. The inverse cannot fail that way: prose containing a
    // forbidden pattern makes this REDDER, never greener.
    //
    // Scoped to the three attributes that carry VISIBLE copy. The lookbehind
    // is what keeps `aria-label` out, and that exclusion is a debt rather than
    // a principle: an accessible name is copy too, and a Vietnamese screen
    // reader will want "close settings" in Vietnamese. It is out of THIS
    // commit because the operator scoped the work to "the sentences and the
    // long content", and every `aria-label` on this surface is two or three
    // words. Named here so the next reader finds a note, not a gap.
    const stray = [...SOURCE.matchAll(/(?<![-\w])(label|hint|placeholder)="([^"]{12,})"/g)].map(
      (m) => `${m[1]}="${m[2]}"`,
    );
    expect(stray).toEqual([]);
  });
});
