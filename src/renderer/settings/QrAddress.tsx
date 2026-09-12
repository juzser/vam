/**
 * The phone-access address, drawn for a camera.
 *
 * Operator: "put a QR on the desktop so the remote link opens straight from
 * the phone." The address `tailscale serve` prints is a MagicDNS name -- up to
 * a hundred characters of hostname, on a screen, next to a person holding the
 * phone that has to reach it. Typing it is the failure this removes, and a
 * mistyped hostname does not read as a typo: it reads as "vam's phone access
 * does not work".
 *
 * SVG, not a canvas: it is a grid of squares, it has to stay crisp at whatever
 * size the panel gives it, and a canvas would need a device-pixel-ratio dance
 * to avoid the blur that stops a symbol scanning.
 *
 * DARK ON WHITE, IGNORING THE THEME, and that is the one visual decision here
 * worth defending. Every other surface in this app takes its colours from the
 * palette, which the operator can repaint from Settings with one press. A QR is
 * not chrome -- it is a machine-readable object, and the machine reading it
 * wants dark modules on a light field with a light quiet zone around them.
 * Painted in vam's dark theme it would be the photographic negative of that.
 */

import { encodeQr } from './qr.js';

/**
 * Light modules around the symbol, in modules.
 *
 * Four is what ISO 18004 asks for and what every "my QR will not scan" report
 * turns out to be missing. It costs 8 modules of width in a box that is
 * already only as big as the panel allows.
 */
const QUIET = 4;

export function QrAddress({ url, size = 148 }: { readonly url: string; readonly size?: number }) {
  const symbol = encodeQr(url);
  // NO PLACEHOLDER for an address too long to encode (over 122 bytes, version
  // 7 at level M). A blank square where a symbol should be is worse than no
  // square at all, and the address is drawn in text beside this either way.
  if (symbol === null) return null;
  const side = symbol.size + QUIET * 2;
  const rects: React.ReactElement[] = [];
  for (let y = 0; y < symbol.size; y += 1) {
    for (let x = 0; x < symbol.size; x += 1) {
      if (!symbol.modules[y]?.[x]) continue;
      rects.push(
        <rect key={`${y}-${x}`} x={x + QUIET} y={y + QUIET} width={1} height={1} fill="#000000" />,
      );
    }
  }
  return (
    <svg
      data-testid="pairing-qr"
      role="img"
      /* The address itself, not "QR code": this is the one thing on the panel
         a screen reader cannot read by reading, and the useful sentence is
         which address it carries. */
      aria-label={`QR code for ${url}`}
      viewBox={`0 0 ${side} ${side}`}
      width={size}
      height={size}
      /* Whole modules, no antialiased edges: a blurred module boundary is how
         a symbol at this size stops scanning. */
      shapeRendering="crispEdges"
      className="flex-none rounded-[4px]"
    >
      <rect x={0} y={0} width={side} height={side} fill="#ffffff" />
      {rects}
    </svg>
  );
}
