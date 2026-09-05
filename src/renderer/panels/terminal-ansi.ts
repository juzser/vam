/**
 * Turning `capture-pane -e` into styled spans.
 *
 * WHAT THIS IS NOT. It is not a terminal emulator and it is not a step
 * towards one. tmux has already composed the screen: every line is where it
 * belongs, wrapped at the width vam asked for, and the only thing still
 * encoded is how each run of characters should LOOK. So this reads SGR --
 * "select graphic rendition", the `ESC [ ... m` sequences -- and deliberately
 * understands nothing else. Cursor motion, scroll regions, alternate screens
 * and window titles are consumed and dropped, because in a captured screen
 * they cannot mean anything: there is no cursor left to move.
 *
 * IT PARSES SOMEBODY ELSE'S AGENT'S OUTPUT, which is the whole of its threat
 * model. The bytes are whatever a program in that pane decided to print, so
 * this may not throw (a rejected read is drawn as vam being unable to look),
 * may not execute anything, and may not fall over a sequence cut in half by
 * the capture's own boundary -- a screenful ends where the screen ends, not
 * where an escape sequence happens to finish. It is a pure function over a
 * string, it builds only data, and every unrecognised or unfinished sequence
 * is skipped rather than emitted: an escape that reached the screen as text
 * would be visible garbage at best, and a lie about what the agent printed at
 * worst.
 *
 * COLOUR IS A TOKEN, NEVER A VALUE. Sixteen tones come out of here by NAME
 * and the theme decides what they are (`styles.css`). That is what lets the
 * light theme remap them instead of reproducing them -- ANSI "white" on a
 * white panel has to become a dark grey or it stops being text.
 */

/** The escape byte itself, spelled rather than typed. */
const ESC = '\u001b';

/** The sixteen names a colour can have here. Everything else is reduced. */
export type AnsiTone =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'bright-black'
  | 'bright-red'
  | 'bright-green'
  | 'bright-yellow'
  | 'bright-blue'
  | 'bright-magenta'
  | 'bright-cyan'
  | 'bright-white';

const BASE: readonly AnsiTone[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
];
const BRIGHT: readonly AnsiTone[] = [
  'bright-black',
  'bright-red',
  'bright-green',
  'bright-yellow',
  'bright-blue',
  'bright-magenta',
  'bright-cyan',
  'bright-white',
];

/** One run of characters that share a look. `null` is the pane's own colour. */
export type AnsiSpan = {
  readonly text: string;
  readonly fg: AnsiTone | null;
  readonly bg: AnsiTone | null;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
};

type Style = Omit<AnsiSpan, 'text'> & { readonly inverse: boolean };

const PLAIN: Style = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strike: false,
  inverse: false,
};

/**
 * The nearest of the sixteen to an arbitrary colour.
 *
 * 256-colour and 24-bit sequences are everywhere in TUIs and cannot each have
 * a token, so they are REDUCED rather than dropped: a channel counts as lit
 * above half, which gives the eight hues, and a bright channel takes the
 * bright tone. Near-greys are sorted by luminance instead, because the hue
 * bits of a grey are noise -- without that, a mid grey comes out blue-ish or
 * white depending on which side of the threshold it rounds to.
 *
 * It loses shades. It keeps the distinction the operator is reading for:
 * which of these lines is the error one.
 */
function nearestTone(r: number, g: number, b: number): AnsiTone {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // GREY IS RELATIVE, NOT ABSOLUTE, and an absolute threshold got this wrong
  // in the direction that matters: a dark navy (0,0,31) spreads only 31
  // counts, so a flat "< 32 is grey" rule called it black and a whole line of
  // a TUI's dim blue chrome went the colour of the background. A colour
  // counts as grey when its spread is small FOR ITS OWN brightness.
  if (max - min < Math.max(0x10, max >> 2)) {
    if (max < 0x40) return 'black';
    if (max < 0x90) return 'bright-black';
    return max < 0xd0 ? 'white' : 'bright-white';
  }
  // WHICH CHANNELS ARE LIT, judged against the colour's OWN maximum and not
  // against a fixed half. A fixed threshold has no answer for a dark hue: a
  // navy of (0,0,31) has no channel above 128, so every bit is zero and it
  // comes out black -- the hue is in the RATIO between the channels, which is
  // what survives being dimmed.
  const lit = (channel: number): boolean => channel * 2 >= max;
  const index = (lit(r) ? 1 : 0) | (lit(g) ? 2 : 0) | (lit(b) ? 4 : 0);
  // Bright is about how loud the colour is, which is the maximum itself.
  return (max > 0xbf ? BRIGHT : BASE)[index] ?? 'white';
}

/** The xterm 256-colour cube and its grey ramp, reduced to the sixteen. */
function toneFrom256(value: number): AnsiTone | null {
  if (!Number.isInteger(value) || value < 0 || value > 255) return null;
  if (value < 8) return BASE[value] ?? null;
  if (value < 16) return BRIGHT[value - 8] ?? null;
  if (value < 232) {
    const cube = value - 16;
    // Six levels per channel, at the steps xterm actually uses.
    const level = (step: number): number => (step === 0 ? 0 : 55 + step * 40);
    return nearestTone(
      level(Math.floor(cube / 36)),
      level(Math.floor(cube / 6) % 6),
      level(cube % 6),
    );
  }
  const grey = (value - 232) * 10 + 8;
  return nearestTone(grey, grey, grey);
}

/**
 * Apply one SGR parameter list to a style.
 *
 * An unknown code is IGNORED rather than treated as a reset: a sequence this
 * does not model should leave the colours alone, not blank the rest of a line
 * because vam has not heard of framed text.
 */
function applySgr(style: Style, params: readonly number[]): Style {
  let next = style;
  for (let i = 0; i < params.length; i += 1) {
    const code = params[i] ?? 0;
    if (code === 0) next = PLAIN;
    else if (code === 1) next = { ...next, bold: true };
    else if (code === 2) next = { ...next, dim: true };
    else if (code === 3) next = { ...next, italic: true };
    else if (code === 4) next = { ...next, underline: true };
    else if (code === 7) next = { ...next, inverse: true };
    else if (code === 9) next = { ...next, strike: true };
    else if (code === 22) next = { ...next, bold: false, dim: false };
    else if (code === 23) next = { ...next, italic: false };
    else if (code === 24) next = { ...next, underline: false };
    else if (code === 27) next = { ...next, inverse: false };
    else if (code === 29) next = { ...next, strike: false };
    else if (code >= 30 && code <= 37) next = { ...next, fg: BASE[code - 30] ?? null };
    else if (code === 39) next = { ...next, fg: null };
    else if (code >= 40 && code <= 47) next = { ...next, bg: BASE[code - 40] ?? null };
    else if (code === 49) next = { ...next, bg: null };
    else if (code >= 90 && code <= 97) next = { ...next, fg: BRIGHT[code - 90] ?? null };
    else if (code >= 100 && code <= 107) next = { ...next, bg: BRIGHT[code - 100] ?? null };
    else if (code === 38 || code === 48) {
      // `38;5;n` and `38;2;r;g;b`, and the same for a background. The whole
      // sub-list is consumed even when it is malformed, so its numbers can
      // never be read back as codes of their own: `38;2;31` must not paint
      // the rest of the line red.
      const kind = params[i + 1];
      const tone =
        kind === 5
          ? toneFrom256(params[i + 2] ?? -1)
          : kind === 2
            ? nearestTone(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0)
            : null;
      i += kind === 5 ? 2 : kind === 2 ? 4 : 1;
      if (tone !== null) next = code === 38 ? { ...next, fg: tone } : { ...next, bg: tone };
    }
  }
  return next;
}

/** What a span looks like once `inverse` has been resolved away. */
function resolve(style: Style, text: string): AnsiSpan {
  const { inverse, ...rest } = style;
  if (!inverse) return { ...rest, text };
  // Reverse video swaps the two, and a swapped DEFAULT has to become a real
  // tone or the swap would be invisible -- which is exactly how a selected
  // row in a TUI menu disappears.
  return { ...rest, text, fg: style.bg ?? 'black', bg: style.fg ?? 'white' };
}

/**
 * The screen, as lines of spans. Never throws.
 *
 * There is a line for every line of input, empty ones included, so the output
 * has the same shape as the screen tmux composed: a blank line in a
 * transcript is part of the transcript.
 */
export function parseAnsi(text: string): readonly (readonly AnsiSpan[])[] {
  const lines: AnsiSpan[][] = [];
  let spans: AnsiSpan[] = [];
  let style: Style = PLAIN;
  let buffer = '';

  const flush = () => {
    if (buffer === '') return;
    spans.push(resolve(style, buffer));
    buffer = '';
  };
  const finish = (): readonly (readonly AnsiSpan[])[] => {
    flush();
    lines.push(spans);
    return lines;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (char === '\n') {
      flush();
      lines.push(spans);
      spans = [];
      continue;
    }
    if (char !== ESC) {
      // A stray control byte is dropped rather than drawn: a captured screen
      // has no bell to ring.
      if (char >= ' ' || char === '\t') buffer += char;
      continue;
    }
    const next = text[i + 1];
    if (next === '[') {
      // CSI: parameter bytes, then one final byte in `@`..`~`.
      let end = i + 2;
      while (end < text.length) {
        const byte = text[end] as string;
        if (byte >= '@' && byte <= '~') break;
        end += 1;
      }
      // A sequence cut off by the capture boundary needs no branch of its
      // own, and it USED TO HAVE ONE: `end` has run to the end of the string,
      // so there is no final byte to match, nothing is applied, and `i = end`
      // below leaves the loop with the half-sequence consumed and undrawn --
      // which is exactly the wanted behaviour. The explicit early return was
      // found redundant by mutating it: removing it changed no test and no
      // outcome. A test asserts the behaviour instead of this comment claiming it.
      if (text[end] === 'm') {
        flush();
        const body = text.slice(i + 2, end);
        style = applySgr(
          style,
          // `;` is what tmux emits; `:` is what some emitters use for the
          // sub-parameters of `38`. An empty body is `ESC[m`, a reset.
          (body === '' ? '0' : body).split(/[;:]/).map((part) => Number.parseInt(part, 10) || 0),
        );
      }
      i = end;
      continue;
    }
    if (next === ']') {
      // OSC: a window title or a hyperlink, ended by BEL or by `ESC \`.
      let end = i + 2;
      while (end < text.length) {
        const byte = text[end] as string;
        if (byte === '\u0007') break;
        if (byte === ESC && text[end + 1] === '\\') {
          end += 1;
          break;
        }
        end += 1;
      }
      // Unterminated, like the CSI above: consumed to the end and drawn as
      // nothing, which is what an unfinished title is worth.
      i = end;
      continue;
    }
    // Any other two-byte escape, and a lone ESC at the very end of a capture.
    if (next === undefined) return finish();
    i += 1;
  }
  return finish();
}

/**
 * The utility classes for a span. STATIC STRINGS, and that is not a style
 * preference: Tailwind extracts class names by scanning source text, so a
 * template-built `text-ansi-${tone}` compiles to no CSS at all and the colour
 * silently never appears.
 */
const FG: Readonly<Record<AnsiTone, string>> = {
  black: 'text-ansi-black',
  red: 'text-ansi-red',
  green: 'text-ansi-green',
  yellow: 'text-ansi-yellow',
  blue: 'text-ansi-blue',
  magenta: 'text-ansi-magenta',
  cyan: 'text-ansi-cyan',
  white: 'text-ansi-white',
  'bright-black': 'text-ansi-bright-black',
  'bright-red': 'text-ansi-bright-red',
  'bright-green': 'text-ansi-bright-green',
  'bright-yellow': 'text-ansi-bright-yellow',
  'bright-blue': 'text-ansi-bright-blue',
  'bright-magenta': 'text-ansi-bright-magenta',
  'bright-cyan': 'text-ansi-bright-cyan',
  'bright-white': 'text-ansi-bright-white',
};

const BG: Readonly<Record<AnsiTone, string>> = {
  black: 'bg-ansi-black',
  red: 'bg-ansi-red',
  green: 'bg-ansi-green',
  yellow: 'bg-ansi-yellow',
  blue: 'bg-ansi-blue',
  magenta: 'bg-ansi-magenta',
  cyan: 'bg-ansi-cyan',
  white: 'bg-ansi-white',
  'bright-black': 'bg-ansi-bright-black',
  'bright-red': 'bg-ansi-bright-red',
  'bright-green': 'bg-ansi-bright-green',
  'bright-yellow': 'bg-ansi-bright-yellow',
  'bright-blue': 'bg-ansi-bright-blue',
  'bright-magenta': 'bg-ansi-bright-magenta',
  'bright-cyan': 'bg-ansi-bright-cyan',
  'bright-white': 'bg-ansi-bright-white',
};

/** The class list for one span, or `''` when it looks like the pane itself. */
export function spanClasses(span: AnsiSpan): string {
  const classes: string[] = [];
  if (span.fg !== null) classes.push(FG[span.fg]);
  if (span.bg !== null) classes.push(BG[span.bg]);
  if (span.bold) classes.push('font-bold');
  // `dim` is opacity and not a colour: a dimmed red is still red, and a
  // second token per tone would be sixteen more pairs for one attribute.
  if (span.dim) classes.push('opacity-60');
  if (span.italic) classes.push('italic');
  if (span.underline && span.strike) classes.push('[text-decoration:underline_line-through]');
  else if (span.underline) classes.push('underline');
  else if (span.strike) classes.push('line-through');
  return classes.join(' ');
}
