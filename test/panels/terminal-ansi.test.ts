/**
 * The ANSI parser, against bytes a real tmux produced.
 *
 * THE FIXTURES ARE MEASURED, NOT IMAGINED. Every escape below was captured
 * from `tmux capture-pane -p -e` on a private `-L` server whose pane had
 * printed the corresponding text -- which is how the exact shapes tmux emits
 * got into this file: it closes a foreground with `39` rather than `0`, it
 * splits `ESC[1;32m` into two sequences of its own, and it closes a
 * background with `49`. A parser tested only against sequences someone wrote
 * by hand is a parser tested against its own author.
 *
 * The threat model is the other half. These bytes are somebody else's agent's
 * output, so the tests that matter most are the ones where the input is
 * broken: a sequence cut in half by the capture boundary, a code this does
 * not model, an escape with no terminator. None may throw, and none may put
 * an escape character on the screen.
 *
 * The escape is SPELLED rather than pasted, so what these assert is legible
 * in a diff instead of being an invisible byte.
 */

import { describe, expect, it } from 'vitest';
import { type AnsiSpan, parseAnsi, spanClasses } from '../../src/renderer/panels/terminal-ansi.js';

const ESC = '\u001b';
const BEL = '\u0007';
/** Exactly what `capture-pane -p -e` returned for a line printing red text. */
const CAPTURED =
  ESC + '[31mred' + ESC + '[39m plain ' + ESC + '[1m' + ESC + '[32mbold green' + ESC + '[0m';

const flat = (text: string): AnsiSpan[] => parseAnsi(text).flat();
const texts = (text: string): string[] => flat(text).map((span) => span.text);

describe('the parser reads what tmux actually emits', () => {
  it('splits a captured line into runs and keeps every character of it', () => {
    const spans = flat(CAPTURED);
    expect(spans.map((span) => span.text).join('')).toBe('red plain bold green');
    expect(spans[0]).toMatchObject({ text: 'red', fg: 'red' });
    // tmux closes a colour with `39`, not with `0` -- the run after it is
    // plain, and the text either side of it survives.
    expect(spans[1]).toMatchObject({ text: ' plain ', fg: null });
    // And it splits bold from the colour into two sequences of its own.
    expect(spans[2]).toMatchObject({ text: 'bold green', fg: 'green', bold: true });
  });

  it('reads a background, and closes it with 49 as tmux does', () => {
    const spans = flat(ESC + '[34m' + ESC + '[47mblue on white' + ESC + '[39m' + ESC + '[49m tail');
    expect(spans[0]).toMatchObject({ text: 'blue on white', fg: 'blue', bg: 'white' });
    expect(spans[1]).toMatchObject({ text: ' tail', fg: null, bg: null });
  });

  it('reads the bright range as its own eight tones', () => {
    expect(flat(ESC + '[90mbright black')[0]).toMatchObject({ fg: 'bright-black' });
    expect(flat(ESC + '[101mon bright red')[0]).toMatchObject({ bg: 'bright-red' });
  });

  it('reads a combined parameter list, as `ESC[3;4;9m` arrives', () => {
    expect(flat(ESC + '[3;4;9mitalic under strike')[0]).toMatchObject({
      italic: true,
      underline: true,
      strike: true,
    });
  });

  it('keeps blank lines, because a blank line is part of the screen', () => {
    const lines = parseAnsi('one\n\nthree');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toEqual([]);
    expect(lines[2]?.[0]?.text).toBe('three');
  });

  it('carries a style across a line break, as a terminal does', () => {
    const lines = parseAnsi(ESC + '[31mfirst\nsecond');
    expect(lines[0]?.[0]).toMatchObject({ text: 'first', fg: 'red' });
    expect(lines[1]?.[0]).toMatchObject({ text: 'second', fg: 'red' });
  });
});

describe('the parser reduces the colours it has no token for', () => {
  it('maps the 256-colour cube onto the nearest of the sixteen', () => {
    // 208 is xterm's orange: there is no token for it, and dropping it to
    // grey would lose the distinction the operator is scanning for.
    expect(flat(ESC + '[38;5;208morange')[0]?.fg).toBe('bright-yellow');
    // The low sixteen are the sixteen, exactly.
    expect(flat(ESC + '[38;5;1mred')[0]?.fg).toBe('red');
    expect(flat(ESC + '[38;5;9mbright')[0]?.fg).toBe('bright-red');
    // The grey ramp sorts by luminance rather than by hue bits.
    expect(flat(ESC + '[38;5;236mdark grey')[0]?.fg).toBe('black');
    expect(flat(ESC + '[38;5;253mlight grey')[0]?.fg).toBe('bright-white');
  });

  it('maps a 24-bit colour the same way', () => {
    // A saturated green with a channel above three quarters takes the bright
    // tone -- the reduction keeps the hue and the sense of how loud it was.
    expect(flat(ESC + '[38;2;10;200;30mtruecolor')[0]?.fg).toBe('bright-green');
    // And a dark one keeps its hue rather than collapsing to black: this is
    // the dim chrome a TUI draws its boxes with.
    expect(flat(ESC + '[38;2;0;0;31mnavy')[0]?.fg).toBe('blue');
    expect(flat(ESC + '[48;2;250;250;250mon white')[0]?.bg).toBe('bright-white');
  });

  it('consumes the whole sub-list, so its numbers are never read as codes', () => {
    // `31` here is the BLUE channel of a 24-bit colour. Read as a code of its
    // own it would paint the rest of the line red, which is the classic way
    // to get this wrong.
    const spans = flat(ESC + '[38;2;0;0;31mnavy');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.text).toBe('navy');
    // Nothing in that sub-list painted a foreground of its own.
    expect(spans[0]?.fg).not.toBe('red');
  });

  it('resolves reverse video into real tones, so a selected row is visible', () => {
    expect(flat(ESC + '[7mselected')[0]).toMatchObject({ fg: 'black', bg: 'white' });
    expect(flat(ESC + '[31;47m' + ESC + '[7mswapped')[0]).toMatchObject({ fg: 'white', bg: 'red' });
  });
});

describe('the parser survives what an agent can print at it', () => {
  it('never puts an escape character on the screen', () => {
    for (const input of [
      CAPTURED,
      ESC + '[999mnonsense',
      ESC + ']0;a window title' + BEL + 'after',
      ESC + 'Pdevice control',
      ESC,
      ESC + '[',
      ESC + '[38;5;',
    ]) {
      const drawn = parseAnsi(input)
        .flat()
        .map((span) => span.text)
        .join('');
      expect(drawn).not.toContain(ESC);
    }
  });

  it('drops a sequence the capture boundary cut in half', () => {
    // A screenful ends where the screen ends. The half-sequence is dropped
    // and the text before it kept: drawing `ESC[31` would be garbage, and
    // guessing at the missing byte would be worse.
    expect(texts('done' + ESC + '[31')).toEqual(['done']);
    expect(texts('done' + ESC)).toEqual(['done']);
    expect(texts('done' + ESC + ']0;title')).toEqual(['done']);
  });

  it('ignores a code it does not model rather than resetting the line', () => {
    // Framed text, which this does not model. The red before it stays red.
    const spans = flat(ESC + '[31mred' + ESC + '[51mstill red');
    expect(spans.every((span) => span.fg === 'red')).toBe(true);
  });

  it('skips cursor motion and other CSI verbs without drawing them', () => {
    expect(texts('a' + ESC + '[2Jb' + ESC + '[10;5Hc')).toEqual(['abc']);
  });

  it('treats `ESC[m` as a reset, as a terminal does', () => {
    expect(flat(ESC + '[31mred' + ESC + '[mplain')[1]).toMatchObject({ text: 'plain', fg: null });
  });

  it('drops stray control bytes, which a captured screen cannot act on', () => {
    expect(texts('bell' + BEL + ' and on')).toEqual(['bell and on']);
  });

  it('answers with an empty screen for an empty capture, and does not throw', () => {
    expect(parseAnsi('')).toEqual([[]]);
  });
});

describe('the classes a span wears are tokens and nothing else', () => {
  const plain: AnsiSpan = {
    text: 'x',
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strike: false,
  };

  it('says nothing at all for a span that looks like the pane', () => {
    expect(spanClasses(plain)).toBe('');
  });

  it('names a token class per tone, never a value', () => {
    expect(spanClasses({ ...plain, fg: 'red' })).toBe('text-ansi-red');
    expect(spanClasses({ ...plain, bg: 'bright-blue' })).toBe('bg-ansi-bright-blue');
    // Nothing here spells a colour in either theme's terms: the class points
    // at a token, and `styles.css` decides what it is.
    expect(spanClasses({ ...plain, fg: 'green', bg: 'black' })).not.toMatch(/#|rgb/);
  });

  it('carries the attributes that are not colours', () => {
    expect(spanClasses({ ...plain, bold: true, italic: true })).toBe('font-bold italic');
    expect(spanClasses({ ...plain, dim: true })).toBe('opacity-60');
    expect(spanClasses({ ...plain, underline: true, strike: true })).toContain('line-through');
  });
});
