// @vitest-environment happy-dom

/**
 * THE TEMPLATE ROW, DRIVEN.
 *
 * `test/prefs/palette-templates.test.ts` measures the COLOURS; this measures
 * that the operator can reach them. The two questions are separate and the
 * second one is the one a palette table cannot answer: a template that is
 * perfectly derived and wired to nothing changes no screen.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE: what the discs PAINT. happy-dom lays
 * nothing out, so a colour read back off a rendered disc is the inline style
 * string this file just put there -- a tautology. The painted answer is
 * `e2e/pane-colour-shots.mjs`, which drives a template button in a real browser
 * and re-measures the pane.
 *
 * THE ONE EXCEPTION IS THE `default` CHIP, and only because its bug lives
 * upstream of paint: it has no colours of its own, so it has to ask the
 * cascade -- and the cascade, by then, is the operator's overrides. happy-dom
 * does resolve custom properties through a real `<style>` rule (probed, not
 * assumed), which is exactly enough to tell "asked the stylesheet" from "asked
 * the document" without claiming anything about pixels.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPaletteTemplate,
  PALETTE_TEMPLATES,
  templatePalette,
} from '../../src/renderer/prefs/palette-templates.js';
import { EMPTY_PREFS, type Prefs } from '../../src/renderer/prefs/prefs.js';
import { SettingsOverlay } from '../../src/renderer/settings/SettingsOverlay.js';

// Every sibling settings test does this: without it `screen` queries a body
// that still holds the previous test's overlay, and `getByRole` finds two.
afterEach(cleanup);

/** The document `applyPalette` would have left behind: a stylesheet saying one
 *  thing and an operator's override on the root saying another. */
function cascade(stylesheet: Record<string, string>, overrides: Record<string, string> = {}) {
  const style = document.createElement('style');
  style.textContent = `:root { ${Object.entries(stylesheet)
    .map(([token, value]) => `${token}: ${value};`)
    .join(' ')} }`;
  document.head.appendChild(style);
  for (const [token, value] of Object.entries(overrides)) {
    document.documentElement.style.setProperty(token, value);
  }
  return () => {
    style.remove();
    for (const token of Object.keys(overrides)) {
      document.documentElement.style.removeProperty(token);
    }
  };
}

function discColours(label: string): (string | undefined)[] {
  const button = screen.getByRole('button', {
    name: `apply the ${label} colour template to dark`,
  });
  return [...button.querySelectorAll('[data-template-disc]')].map(
    (disc) => (disc as HTMLElement).style.backgroundColor,
  );
}

function open(prefs: Prefs = EMPTY_PREFS, theme: 'dark' | 'light' = 'dark') {
  const onChange = vi.fn();
  render(<SettingsOverlay prefs={prefs} theme={theme} onChange={onChange} onClose={() => {}} />);
  return { onChange };
}

describe('the colour template row', () => {
  it('offers every shipped template, by name, with an accessible name that says which theme', () => {
    open();
    // The corpus first: a row that rendered nothing would pass a "no wrong
    // buttons" check forever.
    expect(PALETTE_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    for (const template of PALETTE_TEMPLATES) {
      const button = screen.getByRole('button', {
        name: `apply the ${template.label} colour template to dark`,
      });
      expect(button).toBeTruthy();
      expect(button.getAttribute('data-palette-template')).toBe(template.id);
    }
  });

  it('says which theme it will write, because that is the whole ambiguity', () => {
    // The same button in the other theme has to name the other theme, or the
    // operator cannot tell which palette a press is about to replace.
    open(EMPTY_PREFS, 'light');
    const first = PALETTE_TEMPLATES[0];
    expect(
      screen.getByRole('button', {
        name: `apply the ${first?.label} colour template to light`,
      }),
    ).toBeTruthy();
  });

  it('writes the whole template into the theme on screen when pressed', () => {
    const { onChange } = open();
    const template = PALETTE_TEMPLATES[1];
    fireEvent.click(
      screen.getByRole('button', {
        name: `apply the ${template?.label} colour template to dark`,
      }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as Prefs;
    expect(next.palette.dark).toEqual(templatePalette(template?.id as never, 'dark'));
    // And the theme nobody is looking at is untouched -- the same rule the
    // reset button follows.
    expect(next.palette.light).toEqual({});
  });

  it('previews each template with the three surfaces the operator has reported on', () => {
    open();
    const template = PALETTE_TEMPLATES[0];
    const button = screen.getByRole('button', {
      name: `apply the ${template?.label} colour template to dark`,
    });
    const discs = button.querySelectorAll('[data-template-disc]');
    expect([...discs].map((d) => d.getAttribute('data-template-disc'))).toEqual([
      '--vam-pane',
      '--vam-card',
      '--vam-in-bubble',
    ]);
    // A colour is not a label: the discs must stay out of the accessible name,
    // which the assertion above already depends on -- `getByRole` found this
    // button by a name that contains no colour at all.
    for (const disc of discs) {
      expect(disc.getAttribute('aria-hidden')).toBe(null);
    }
    expect(button.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('presses back to the stylesheet rather than to a frozen copy of it', () => {
    // The `default` entry CLEARS. Writing vam's current hexes into the bucket
    // would look identical on screen today and would freeze that palette
    // against every later stylesheet -- an operator who pressed "default"
    // would stop receiving the theme's own changes, and nothing would say so.
    const painted = applyPaletteTemplate(EMPTY_PREFS, 'dark', 'slate');
    const { onChange } = open(painted);
    fireEvent.click(
      screen.getByRole('button', { name: 'apply the default colour template to dark' }),
    );
    const next = onChange.mock.calls[0]?.[0] as Prefs;
    expect(next.palette.dark).toEqual({});
  });

  it('previews the default with the stylesheet, not with the palette it is offering to leave', () => {
    // THE BUG THIS EXISTS FOR. The overrides live on the root's inline style
    // and custom properties inherit, so the obvious read hands the chip the
    // operator's current palette -- and the chip promises vam's while
    // previewing `ember`'s. Stylesheet says one thing, root says another;
    // the discs must show the first.
    const restore = cascade(
      { '--vam-pane': '#272727', '--vam-card': '#2e2e2e', '--vam-in-bubble': '#354646' },
      { '--vam-pane': '#3b1d1d', '--vam-card': '#4a2525', '--vam-in-bubble': '#5c2f2f' },
    );
    try {
      open();
      expect(discColours('default')).toEqual(['#272727', '#2e2e2e', '#354646']);
      // And the override is still in force on the document afterwards: the
      // read borrows the property, it does not spend it.
      expect(document.documentElement.style.getPropertyValue('--vam-pane')).toBe('#3b1d1d');
    } finally {
      restore();
    }
  });

  it('still previews a tinted template with its own colours, not with the cascade', () => {
    // The other half of the same branch. A read that went to the stylesheet
    // for EVERY chip would make all five previews identical, which is the
    // failure that looks most like working software.
    const restore = cascade({ '--vam-pane': '#272727' });
    try {
      open();
      expect(discColours('slate')[0]).toBe(templatePalette('slate', 'dark')['--vam-pane']);
      expect(discColours('slate')[0]).not.toBe('#272727');
    } finally {
      restore();
    }
  });
});
