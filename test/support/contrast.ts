/**
 * WCAG 2.x relative-luminance contrast, for tests that measure `styles.css`
 * rather than quoting it. Shared by the token guard and by the node-glow test,
 * which asserts one specific ratio in the middle of a larger story.
 */

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a six-digit hex colour: ${hex}`);
  const n = Number.parseInt(m[1] as string, 16);
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

/** The ratio between two six-digit hex colours, 1 to 21, order-independent. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}
