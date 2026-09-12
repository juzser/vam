// @vitest-environment happy-dom

/**
 * THE QR ON THE PAIRING SCREEN.
 *
 * Operator: "put a QR on the desktop so the remote link opens straight from
 * the phone." `test/settings/qr.test.ts` holds the encoder and
 * `e2e/qr-decode-check.mjs` proves a real barcode detector reads it. This is
 * the part in between: that the symbol is DRAWN, for the right address, and
 * that it is not drawn where it would be a lie or a nuisance.
 *
 * WHAT IS DELIBERATELY NOT HERE: whether it scans. happy-dom lays nothing out
 * and rasterises nothing, so every assertion about contrast, size or quiet
 * zone would be a class name read back. Those live with the encoder and the
 * decode check.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { QrAddress } from '../../src/renderer/settings/QrAddress.js';

const URL = 'https://example-machine.example-tailnet.ts.net';

afterEach(cleanup);

describe('the address as a QR', () => {
  it('draws a symbol for the address it is handed', () => {
    render(<QrAddress url={URL} />);
    const svg = screen.getByTestId('pairing-qr');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    // Modules, as rects. A symbol for a 46-byte address is 33x33 at level M,
    // and roughly half of those are dark -- a floor of 100 says "it drew the
    // symbol" without pinning the count to a mask choice.
    expect(svg.querySelectorAll('rect').length).toBeGreaterThan(100);
  });

  it('names the address it encodes, because a picture has no text', () => {
    // The QR is the only thing on the panel that a screen reader cannot read
    // by reading. The address is beside it in text, and this makes the image
    // itself say which address it carries rather than "QR code".
    render(<QrAddress url={URL} />);
    const svg = screen.getByTestId('pairing-qr');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toContain(URL);
  });

  it('draws a quiet zone, which is the half of the spec people skip', () => {
    // A symbol flush to its own edge is the classic "my QR will not scan":
    // the detector needs light modules around the finder patterns. Asserted
    // through the viewBox, which is the symbol's size plus four modules on
    // each side, because that is the geometry happy-dom CAN answer for.
    render(<QrAddress url={URL} />);
    const box = screen.getByTestId('pairing-qr').getAttribute('viewBox');
    const [, , w, h] = (box ?? '').split(' ').map(Number);
    expect(w).toBe(h);
    // 33 modules + 4 quiet either side.
    expect(w).toBe(41);
  });

  it('draws nothing at all for an address the encoder refuses', () => {
    // Over 122 bytes there is no symbol, and a blank square where a QR should
    // be is worse than no square: the panel keeps the address in text either
    // way, and the operator can still read and copy it.
    render(<QrAddress url={`https://${'x'.repeat(200)}.ts.net`} />);
    expect(screen.queryByTestId('pairing-qr')).toBeNull();
  });

  it('draws nothing for an empty address', () => {
    render(<QrAddress url="" />);
    expect(screen.queryByTestId('pairing-qr')).toBeNull();
  });

  it('is dark on white, whatever the theme is', () => {
    // NOT a theme token. This is a machine-readable object, not chrome: a
    // scanner wants a light quiet zone and dark modules, and vam's dark theme
    // would give it the inverse. Stated as literal colours so that a palette
    // template -- which repaints every surface in this app -- cannot reach it.
    render(<QrAddress url={URL} />);
    const svg = screen.getByTestId('pairing-qr');
    const background = svg.querySelector('rect');
    expect(background?.getAttribute('fill')).toBe('#ffffff');
    const modules = [...svg.querySelectorAll('rect')].slice(1);
    expect(modules.length).toBeGreaterThan(100);
    for (const rect of modules) expect(rect.getAttribute('fill')).toBe('#000000');
  });
});
