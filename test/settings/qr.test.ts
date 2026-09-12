/**
 * THE QR ENCODER, which exists because the alternative was worse.
 *
 * Operator: "put a QR on the desktop so the remote link opens straight from
 * the phone." The address is a `https://<machine>.<tailnet>.ts.net` MagicDNS
 * name -- 30 to 90 characters of hostname that nobody wants to type into a
 * phone keyboard, and mistyping it is the one failure that looks like "vam is
 * broken" rather than "I mistyped".
 *
 * ── WHY NOT A LIBRARY ─────────────────────────────────────────────────────
 * Two reasons, and the first one is not taste. There is no QR encoder
 * anywhere in this tree, so one would have to be installed -- and vam's
 * `node_modules` is a store shared by other checkouts, where an install is a
 * known way to prune the Electron binary out from under them. The second is
 * the same argument `i18n/strings.ts` makes about `i18next`: `qrcode` carries
 * PNG and canvas renderers, logo compositing, eight symbologies' worth of
 * options and a CLI, for ONE payload shape -- a short https URL, drawn once,
 * on a panel the operator opens to pair a phone.
 *
 * So: byte mode, error correction M, versions 1 to 7, and nothing else.
 *
 * ── WHY THAT CEILING IS NOT ARBITRARY ─────────────────────────────────────
 * Version 7 at level M holds 122 bytes. The ceiling was 6 -- 106 bytes -- on
 * the estimate that an address runs to "about 92 characters"; the decode
 * check counted the worst case instead and got 109, from `https://` plus a
 * 63-character machine name (the RFC cap) plus a 30-character tailnet, with
 * Tailscale's older MagicDNS suffixes longer again. Version 7 carries an
 * 18-bit version block, so that is written; version 8 is where the data
 * blocks stop being equal sized, and that is the line this stops at.
 * `encodeQr` returns `null` above the ceiling rather than drawing a symbol
 * that would not scan, and the panel keeps the address in text either way.
 *
 * ── HOW THIS IS KNOWN TO WORK ─────────────────────────────────────────────
 * The tests below are structural: they can prove the finder patterns are
 * where the spec puts them and that the capacity table matches the published
 * byte capacities, but no unit test can prove a CAMERA reads it. That is what
 * `e2e/qr-decode-check.mjs` is for: it renders the real component and hands
 * the PNG to macOS's own Vision barcode detector, which is the same class of
 * decoder a phone points at the screen. Run it after touching this file.
 */

import { describe, expect, it } from 'vitest';
import { encodeQr, QR_MAX_BYTES } from '../../src/renderer/settings/qr.js';

const URL_TYPICAL = 'https://ser-mac.tail1e1526.ts.net';

/** The three finder corners, as the spec places them. */
const FINDERS: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, -7],
  [-7, 0],
];

function at(m: readonly (readonly boolean[])[], y: number, x: number): boolean {
  const size = m.length;
  return m[(y + size) % size]?.[(x + size) % size] ?? false;
}

describe('the encoder', () => {
  it('returns a square matrix whose size is a legal QR version', () => {
    const qr = encodeQr(URL_TYPICAL);
    expect(qr).not.toBeNull();
    // 21, 25, 29, 33, 37, 41 -- versions 1 to 6 and nothing between them.
    expect([21, 25, 29, 33, 37, 41, 45]).toContain(qr?.size);
    expect(qr?.modules.length).toBe(qr?.size);
    for (const row of qr?.modules ?? []) expect(row.length).toBe(qr?.size);
  });

  it('picks the smallest version the payload fits in', () => {
    // The capacities are the published ones for level M, and this is where a
    // table typo shows up: 14 / 26 / 42 / 62 / 84 / 106 bytes.
    const sizeFor = (n: number) => encodeQr('a'.repeat(n))?.size;
    expect(sizeFor(14)).toBe(21);
    expect(sizeFor(15)).toBe(25);
    expect(sizeFor(26)).toBe(25);
    expect(sizeFor(27)).toBe(29);
    expect(sizeFor(42)).toBe(29);
    expect(sizeFor(43)).toBe(33);
    expect(sizeFor(62)).toBe(33);
    expect(sizeFor(63)).toBe(37);
    expect(sizeFor(84)).toBe(37);
    expect(sizeFor(85)).toBe(41);
    expect(sizeFor(106)).toBe(41);
    expect(sizeFor(107)).toBe(45);
    expect(sizeFor(122)).toBe(45);
  });

  it('refuses what it cannot draw, rather than drawing something that will not scan', () => {
    expect(QR_MAX_BYTES).toBe(122);
    expect(encodeQr('a'.repeat(QR_MAX_BYTES + 1))).toBeNull();
    expect(encodeQr('')).toBeNull();
  });

  it('counts BYTES, not characters, so a multi-byte name cannot overflow the symbol', () => {
    // `é` is two bytes in UTF-8. A length check on the string would let 106 of
    // them through and produce a symbol with 212 bytes of payload.
    expect(encodeQr('é'.repeat(61))).not.toBeNull();
    expect(encodeQr('é'.repeat(62))).toBeNull();
  });

  it('draws the three finder patterns exactly as the spec places them', () => {
    const qr = encodeQr(URL_TYPICAL);
    const m = qr?.modules ?? [];
    expect(m.length).toBeGreaterThan(0);
    for (const [oy, ox] of FINDERS) {
      const y0 = oy < 0 ? m.length + oy : oy;
      const x0 = ox < 0 ? m.length + ox : ox;
      for (let y = 0; y < 7; y += 1) {
        for (let x = 0; x < 7; x += 1) {
          const ring = y === 0 || y === 6 || x === 0 || x === 6;
          const core = y >= 2 && y <= 4 && x >= 2 && x <= 4;
          expect(m[y0 + y]?.[x0 + x], `finder at ${y0},${x0} cell ${y},${x}`).toBe(ring || core);
        }
      }
    }
  });

  it('separates each finder with a quiet ring of light modules', () => {
    const m = encodeQr(URL_TYPICAL)?.modules ?? [];
    for (let i = 0; i < 8; i += 1) {
      expect(at(m, 7, i), `separator below the top-left finder at ${i}`).toBe(false);
      expect(at(m, i, 7), `separator right of the top-left finder at ${i}`).toBe(false);
    }
  });

  it('draws both timing patterns as the alternating run everything aligns on', () => {
    const m = encodeQr(URL_TYPICAL)?.modules ?? [];
    for (let i = 8; i < m.length - 8; i += 1) {
      expect(m[6]?.[i], `horizontal timing at ${i}`).toBe(i % 2 === 0);
      expect(m[i]?.[6], `vertical timing at ${i}`).toBe(i % 2 === 0);
    }
  });

  it('always sets the dark module, which is the one fixed black cell in every symbol', () => {
    const m = encodeQr(URL_TYPICAL)?.modules ?? [];
    expect(m[m.length - 8]?.[8]).toBe(true);
  });

  it('is deterministic: the same address twice is the same symbol', () => {
    const a = encodeQr(URL_TYPICAL);
    const b = encodeQr(URL_TYPICAL);
    expect(a?.modules).toEqual(b?.modules);
  });

  it('says something different for a different address', () => {
    const a = encodeQr('https://one.example.ts.net');
    const b = encodeQr('https://two.example.ts.net');
    expect(a?.modules).not.toEqual(b?.modules);
  });

  it('does not paint a blank or a solid field', () => {
    // A matrix that is all one value would satisfy every structural check
    // above that does not name a specific cell. Roughly half of a QR's modules
    // are dark by construction; 20% either way is a wide, cheap net.
    const m = encodeQr(URL_TYPICAL)?.modules ?? [];
    const total = m.length * m.length;
    const dark = m.reduce((n, row) => n + row.filter(Boolean).length, 0);
    expect(dark / total).toBeGreaterThan(0.3);
    expect(dark / total).toBeLessThan(0.7);
  });
});
