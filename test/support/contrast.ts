/**
 * WCAG 2.x relative-luminance contrast, for tests that measure `styles.css`
 * rather than quoting it. Shared by the token guard and by the node-glow test,
 * which asserts one specific ratio in the middle of a larger story.
 *
 * `deltaE` is here for the one question the ratio cannot answer, and it was
 * added because that question arrived as an operator complaint. The WCAG ratio
 * is LUMINANCE ONLY: two surfaces of the same lightness in different hues
 * measure 1.00:1 and are obviously different to look at, and -- the case that
 * forced this -- the light theme's pane already sits at 86% luminance, so
 * NOTHING lighter than it can measure past 1.16:1 however saturated it is.
 * Judging a surface pair on the ratio alone would have made the light theme
 * look unfixable while the dark theme looked solved. Both numbers get floors.
 */

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function rgb(hex: string): readonly [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a six-digit hex colour: ${hex}`);
  const n = Number.parseInt(m[1] as string, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** CIE L*a*b* under D65, from linearised sRGB. */
function lab(hex: string): readonly [number, number, number] {
  const [r, g, b] = rgb(hex).map(channel) as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/**
 * CIE76 ΔE*ab between two six-digit hex colours: how far apart they LOOK, hue
 * included. ~2.3 is the just-noticeable difference; the light theme's own card
 * step (white on the pane) is 6.2, which is the number this repo reaches for
 * when it wants to say "at least as distinct as a card".
 */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/**
 * The CIE L* of a six-digit hex colour: 0 is black, 100 is white, and a
 * difference of ~2.3 is the point at which a person reliably sees one.
 *
 * Exported for the question relative luminance answers badly at the dark end.
 * "Is this surface visibly lighter than the one it replaced" is about
 * PERCEIVED lightness, and luminance is not that: #0a0a0a and #131313 differ
 * by 0.002 in Y and by 3.1 in L*. `dark-lift.test.ts` holds the dark palette's
 * step to a number in these units for exactly that reason.
 */
export function lightness(hex: string): number {
  return lab(hex)[0] as number;
}

/**
 * CIE C*ab: how much COLOUR a value carries, independently of how light it is.
 *
 * The question the other two units cannot ask between them. "Lean it towards
 * grey" is a request about this number and nothing else -- the In bubble's
 * drain is 16.65 -> 7.07 at a lightness that moved 0.07 -- and a guard holding
 * only ΔE would have reported it as a colour change indistinguishable from a
 * hue rotation, which is a different decision with different consequences.
 */
export function chroma(hex: string): number {
  const [, a, b] = lab(hex);
  return Math.hypot(a as number, b as number);
}

/** The relative luminance of a six-digit hex colour, 0 to 1. */
export function relativeLuminance(hex: string): number {
  return luminance(hex);
}

/** The ratio between two six-digit hex colours, 1 to 21, order-independent. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}
