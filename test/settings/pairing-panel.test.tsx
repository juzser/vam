// @vitest-environment happy-dom

/**
 * The pairing screen, and the list of devices it produced.
 *
 * Two things this panel must say out loud, because they are the feature's
 * whole reasoning: the address is reachable by EVERYONE on the tailnet, and
 * granting a device is a decision the operator makes in person. The third is
 * the one that keeps the code from living forever: it is on a clock, and the
 * screen says so.
 *
 * No fixture here is a real machine, tailnet, device or token.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PairingPanel,
  type PairingPanelProps,
  type PairingView,
  type ServeAccessView,
} from '../../src/renderer/settings/PairingPanel.js';

afterEach(cleanup);

const NOW = 1_700_000_000_000;

const IDLE: PairingView = {
  code: null,
  expiresAtMs: 0,
  burned: false,
  throttledUntilMs: 0,
  awaiting: null,
  pairedName: null,
};

const LIVE: PairingView = { ...IDLE, code: 'ABCD2345', expiresAtMs: NOW + 95_000 };

/**
 * Serve already ON, by default: most of the tests in this file are about the
 * pairing code, not phone access, and depend on `url` being drawn
 * unconditionally the way it always was before phone access existed.
 */
const SERVE_DEFAULT: ServeAccessView = {
  cliMissing: false,
  enabled: true,
  lastError: null,
  timedOut: false,
  pending: false,
  tailnetServeDisabledUrl: null,
};

/**
 * `draw({ serve: { enabled: false } })` merges onto `SERVE_DEFAULT` rather
 * than replacing it wholesale -- `serve` has grown a field on every one of
 * three separate rounds of feedback so far, and a shallow `{ ...over }`
 * merge on `PairingPanelProps` made every existing call site that touched
 * `serve` at all responsible for re-stating every OTHER field, unrelated to
 * what it was actually testing, every time.
 */
function draw(
  over: Omit<Partial<PairingPanelProps>, 'serve'> & { serve?: Partial<ServeAccessView> } = {},
) {
  const { serve: serveOver, ...rest } = over;
  const props: PairingPanelProps = {
    view: LIVE,
    devices: [],
    url: 'https://example-machine.example-tailnet.ts.net',
    allowWrites: false,
    writesPreference: false,
    nowMs: NOW,
    onRegenerate: vi.fn(),
    onApprove: vi.fn(),
    onDeny: vi.fn(),
    onRemove: vi.fn(),
    onRevokeAll: vi.fn(),
    onCopyUrl: vi.fn(),
    onEnableServe: vi.fn(),
    onDisableServe: vi.fn(),
    onSetWritesPreference: vi.fn(),
    ...rest,
    serve: { ...SERVE_DEFAULT, ...serveOver },
  };
  render(<PairingPanel {...props} />);
  return props;
}

/**
 * THE QR, which is the address drawn for a camera.
 *
 * Operator: "put a QR on the desktop so the remote link opens straight from
 * the phone." `test/settings/qr-address.test.tsx` holds the component and
 * `e2e/qr-decode-check.mjs` proves a real barcode detector reads the symbol;
 * this is about WHEN the panel draws one.
 */
describe('the address as a QR', () => {
  const qr = () => screen.queryByTestId('pairing-qr');

  it('draws one beside the address, for the address', () => {
    draw();
    expect(qr()).not.toBeNull();
    expect(qr()?.getAttribute('aria-label')).toContain(
      'https://example-machine.example-tailnet.ts.net',
    );
  });

  it('draws none when there is no address to draw', () => {
    // Reading the address needs the Tailscale CLI, and `null` is ordinary.
    draw({ url: null });
    expect(qr()).toBeNull();
  });

  it('draws none while phone access is off', () => {
    // There is nothing to reach yet: a QR here would encode an address that
    // answers nothing, which is worse than no QR at all.
    draw({ serve: { enabled: false } });
    expect(qr()).toBeNull();
  });

  it('draws none on a phone, which is the thing that would be scanning it', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (media: string) => ({
        media,
        // Every query matches: this is the phone width, and `usePhoneViewport`
        // is the only reader in this component.
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    try {
      draw();
      expect(qr(), 'a phone showing itself a QR of its own address').toBeNull();
      // And the address is still there to read and copy.
      expect(screen.getByTestId('pairing-url').textContent).toMatch(/^https:\/\//);
    } finally {
      if (original === undefined) Reflect.deleteProperty(window, 'matchMedia');
      else Object.defineProperty(window, 'matchMedia', original);
    }
  });
});

describe('the pairing screen', () => {
  it('says what being on the tailnet does and does not buy', () => {
    draw();
    const said = document.body.textContent ?? '';
    expect(said).toMatch(/everyone on your tailnet/i);
    expect(said).toMatch(/does not|not authoris/i);
  });

  it('never mentions funnel, which would put this on the public internet', () => {
    draw();
    expect(document.body.textContent ?? '').not.toMatch(/funnel/i);
  });

  it('shows the code in two groups of four, and the clock it is on', () => {
    draw();
    expect(screen.getByTestId('pairing-code').textContent).toBe('ABCD-2345');
    expect(screen.getByTestId('pairing-countdown').textContent).toBe('expires in 1:35');
  });

  it('shows an https address and offers to copy it', () => {
    const props = draw();
    expect(screen.getByTestId('pairing-url').textContent).toMatch(/^https:\/\//);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    expect(props.onCopyUrl).toHaveBeenCalled();
  });

  it('draws no address when it could not be read, and invents nothing in its place', () => {
    draw({ url: null });
    expect(screen.queryByTestId('pairing-url')).toBeNull();
  });

  it('says whether this server accepts writes', () => {
    draw({ allowWrites: false });
    expect(screen.getByTestId('pairing-writes').textContent).toMatch(/read.only/i);
    cleanup();
    draw({ allowWrites: true });
    expect(screen.getByTestId('pairing-writes').textContent).toMatch(/close sessions|write/i);
  });

  it('offers a writes-preference toggle, off by default, for the next launch', () => {
    const props = draw({ writesPreference: false });
    const toggle = screen.getByRole('button', { name: /turn writes on/i });
    fireEvent.click(toggle);
    expect(props.onSetWritesPreference).toHaveBeenCalledWith(true);
  });

  it('offers to turn a persisted writes preference back off', () => {
    const props = draw({ writesPreference: true });
    const toggle = screen.getByRole('button', { name: /turn writes off/i });
    fireEvent.click(toggle);
    expect(props.onSetWritesPreference).toHaveBeenCalledWith(false);
  });

  it('says a changed writes preference applies on the next launch, not this one', () => {
    draw({ allowWrites: false, writesPreference: true });
    expect(screen.getByTestId('pairing-writes-preference').textContent).toMatch(
      /next (time|launch)/i,
    );
  });

  it('mints a code only when asked', () => {
    const props = draw({ view: IDLE });
    expect(screen.queryByTestId('pairing-code')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /show a pairing code/i }));
    expect(props.onRegenerate).toHaveBeenCalled();
  });

  it('waits, then names the device that paired', () => {
    draw();
    expect(screen.getByTestId('pairing-status').textContent).toMatch(/waiting/i);
    cleanup();
    draw({ view: { ...IDLE, pairedName: 'a phone' } });
    expect(screen.getByTestId('pairing-status').textContent).toMatch(/paired: a phone/i);
  });

  it('warns when the code burned, and offers a fresh one', () => {
    const props = draw({ view: { ...IDLE, burned: true } });
    const warning = screen.getByTestId('pairing-warning');
    expect(warning.textContent).toMatch(/burned/i);
    expect(warning.getAttribute('role')).toBe('alert');
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(props.onRegenerate).toHaveBeenCalled();
  });

  it('warns, loudly, while pairing is throttled', () => {
    draw({ view: { ...IDLE, throttledUntilMs: NOW + 900_000 } });
    const warning = screen.getByTestId('pairing-warning');
    expect(warning.textContent).toMatch(/unpaired device|too many/i);
    expect(warning.textContent).toMatch(/15 minutes/i);
  });
});

describe('the second gate', () => {
  it('asks the operator in person before any token is minted', () => {
    const props = draw({
      view: { ...LIVE, awaiting: { name: 'a phone', source: '100.64.0.2' } },
    });
    const prompt = screen.getByTestId('pairing-approval');
    expect(prompt.textContent).toMatch(/allow/i);
    expect(screen.getByTestId('pairing-device-name').textContent).toBe('a phone');
    expect(screen.getByTestId('pairing-source').textContent).toContain('100.64.0.2');
    fireEvent.click(screen.getByRole('button', { name: /^allow/i }));
    expect(props.onApprove).toHaveBeenCalled();
  });

  it('lets the operator say no', () => {
    const props = draw({
      view: { ...LIVE, awaiting: { name: 'a phone', source: '100.64.0.2' } },
    });
    fireEvent.click(screen.getByRole('button', { name: /^don.t allow|^deny/i }));
    expect(props.onDeny).toHaveBeenCalled();
  });

  it('says what the operator is granting, not merely that someone knocked', () => {
    draw({ view: { ...LIVE, awaiting: { name: 'a phone', source: '100.64.0.2' } } });
    expect(screen.getByTestId('pairing-approval').textContent).toMatch(/drive|type into|agent/i);
  });

  /**
   * `source` is always 127.0.0.1 behind Serve, so the NAME is the operator's
   * only discriminator -- and it is chosen by whoever is trying to pair. It
   * must not be able to wear the prompt's own chrome.
   */
  it('keeps the device name out of the sentence it could otherwise argue with', () => {
    const hostile = 'phone Read-only. Safe to allow.';
    draw({ view: { ...LIVE, awaiting: { name: hostile, source: '100.64.0.2' } } });
    // Its own element, verbatim, and nowhere near the warning.
    expect(screen.getByTestId('pairing-device-name').textContent).toBe(hostile);
    expect(screen.getByTestId('pairing-grant').textContent).not.toContain(hostile);
    // The prompt draws no quotation marks the name could close.
    expect(screen.getByTestId('pairing-grant').textContent ?? '').not.toMatch(/["\u201c\u201d]/);
  });
});

describe('phone access -- vam setting up tailscale serve itself', () => {
  it('explains and links to Tailscale, offering nothing, when there is no CLI', () => {
    draw({ serve: { cliMissing: true, enabled: false } });

    expect(screen.getByTestId('serve-no-cli')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /enable phone access/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /turn off phone access/i })).toBeNull();
    const link = screen.getByRole('link', { name: /install tailscale/i });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/tailscale\.com\//);
  });

  it('states what turning it on exposes, and offers to enable it, while off', () => {
    const props = draw({ serve: { enabled: false } });

    expect(document.body.textContent ?? '').toMatch(/tailscale serve/i);
    expect(document.body.textContent ?? '').toMatch(/whole tailnet|every laptop/i);
    fireEvent.click(screen.getByRole('button', { name: /enable phone access/i }));
    expect(props.onEnableServe).toHaveBeenCalled();
  });

  it('never runs serve as a side effect of merely being drawn, while off', () => {
    const props = draw({ serve: { enabled: false } });
    expect(props.onEnableServe).not.toHaveBeenCalled();
  });

  it('offers an equally easy way back off, while on', () => {
    const props = draw({ serve: { enabled: true } });

    expect(screen.queryByRole('button', { name: /enable phone access/i })).toBeNull();
    const off = screen.getByRole('button', { name: /turn off phone access/i });
    fireEvent.click(off);
    expect(props.onDisableServe).toHaveBeenCalled();
  });

  it('shows the resulting address while on', () => {
    draw({
      serve: { enabled: true },
      url: 'https://example-machine.example-tailnet.ts.net',
    });

    expect(screen.getByTestId('pairing-url').textContent).toMatch(/^https:\/\//);
  });

  it('says the address cannot be read rather than guessing one, while on', () => {
    draw({ serve: { enabled: true }, url: null });

    expect(screen.queryByTestId('pairing-url')).toBeNull();
  });

  it("surfaces a refusal in the CLI's own real words, not a generic error", () => {
    draw({
      serve: { enabled: false, lastError: 'access denied: reauthenticate to use Serve' },
    });

    const said = screen.getByTestId('serve-error');
    expect(said.textContent).toBe('access denied: reauthenticate to use Serve');
    expect(said.getAttribute('role')).toBe('alert');
  });

  it('says the enable/disable round trip is in progress rather than looking frozen', () => {
    const props = draw({ serve: { enabled: false, pending: true } });

    // Not the same accessible name as the idle button -- a poll or a second
    // click landing on "Enable phone access" while a request is already in
    // flight is the thing this state exists to prevent.
    expect(screen.queryByRole('button', { name: /^enable phone access$/i })).toBeNull();
    const pending = screen.getByRole('button', { name: /enabling/i });
    expect(pending.hasAttribute('disabled')).toBe(true);
    fireEvent.click(pending);
    expect(props.onEnableServe).not.toHaveBeenCalled();
  });

  it('shows the same pending state disabling, not just enabling', () => {
    draw({ serve: { enabled: true, pending: true } });

    expect(screen.queryByRole('button', { name: /^turn off phone access$/i })).toBeNull();
    const pending = screen.getByRole('button', { name: /turning off/i });
    expect(pending.hasAttribute('disabled')).toBe(true);
  });

  it('reports a timeout as its own honest state, not a made-up CLI refusal', () => {
    draw({ serve: { enabled: false, timedOut: true } });

    const said = screen.getByTestId('serve-error');
    expect(said.textContent).toMatch(/did not answer in time/i);
  });

  it('offers the manual `tailscale serve reset` escape hatch only for a failed DISABLE', () => {
    // enabled: true here can only mean the failure was a disable attempt --
    // a failed enable would have left `enabled` false (ServeState's own
    // invariant, see src/main/remote/state.ts).
    draw({ serve: { enabled: true, lastError: 'ENOSPC: no space left on device' } });

    expect(screen.getByTestId('serve-error').textContent).toMatch(/tailscale serve reset/i);
  });

  it('never suggests the manual reset for a failed ENABLE', () => {
    draw({ serve: { enabled: false, lastError: 'ENOSPC: no space left on device' } });

    expect(screen.getByTestId('serve-error').textContent).not.toMatch(/tailscale serve reset/i);
  });

  /**
   * THE FIRST-RUN CASE, measured against a real Tailscale (1.102.2): Serve is
   * off by default for a tailnet, and `tailscale serve --bg` prints the exact
   * enable link to stdout rather than exiting. The node id in this URL is
   * INVENTED -- a real one identifies the operator's machine and must never
   * appear in a committed fixture.
   */
  it('offers the tailnet-admin enable link as an actionable state, not a generic error', () => {
    const url = 'https://login.tailscale.com/f/serve?node=invented-node-id-0000';
    draw({ serve: { enabled: false, tailnetServeDisabledUrl: url } });

    expect(screen.queryByTestId('serve-error')).toBeNull();
    const said = screen.getByTestId('serve-tailnet-disabled');
    expect(said.textContent).toMatch(/tailnet/i);
    const link = screen.getByRole('link', { name: url });
    expect(link.getAttribute('href')).toBe(url);
  });

  it('still offers a retry once the tailnet admin enables Serve', () => {
    const url = 'https://login.tailscale.com/f/serve?node=invented-node-id-0000';
    draw({ serve: { enabled: false, tailnetServeDisabledUrl: url } });

    // The button stays: the operator (or their admin) fixes this elsewhere
    // and comes back to click Enable again, rather than the panel dead-ending.
    expect(screen.getByRole('button', { name: /enable phone access/i })).toBeTruthy();
  });

  it('never shows a made-up URL: draws exactly the one it was given, verbatim', () => {
    const url = 'https://login.tailscale.com/f/serve?node=invented-node-id-9999';
    draw({ serve: { enabled: false, tailnetServeDisabledUrl: url } });

    expect(screen.getByRole('link', { name: url }).getAttribute('href')).toBe(url);
  });
});

describe('the paired devices', () => {
  const devices = [
    { deviceId: 'd-1', name: 'a phone', pairedAt: NOW - 86_400_000, lastSeenAt: NOW - 60_000 },
    { deviceId: 'd-2', name: 'a tablet', pairedAt: NOW - 3_600_000, lastSeenAt: NOW - 5_000 },
  ];

  it('says none are paired rather than showing an empty list', () => {
    draw({ devices: [] });
    expect(screen.getByTestId('paired-devices').textContent).toMatch(/no device/i);
    expect(screen.queryByRole('button', { name: /revoke all/i })).toBeNull();
  });

  it('names each device, when it paired and when it was last heard from', () => {
    draw({ devices });
    const row = screen.getByTestId('paired-device-d-1');
    expect(row.textContent).toContain('a phone');
    expect(row.textContent).toMatch(/paired 1 day ago/i);
    expect(row.textContent).toMatch(/last seen 1 minute ago/i);
  });

  it('carries no token anywhere on screen', () => {
    draw({ devices });
    expect(document.body.textContent ?? '').not.toMatch(/token/i);
  });

  it('removes one device', () => {
    const props = draw({ devices });
    fireEvent.click(screen.getByRole('button', { name: /remove a phone/i }));
    expect(props.onRemove).toHaveBeenCalledWith('d-1');
  });

  it('revokes every device at once', () => {
    const props = draw({ devices });
    fireEvent.click(screen.getByRole('button', { name: /revoke all/i }));
    expect(props.onRevokeAll).toHaveBeenCalled();
  });
});

/**
 * This panel shipped with three semantic class names -- `pairing`,
 * `pairing-code`, `pairing-device-name` -- and NONE OF THEM had a CSS rule
 * anywhere in the repo: `src/renderer/styles.css` is the only stylesheet and
 * defined none of the three, so the markup was effectively unstyled. Asserted
 * here on the RENDERED ELEMENT's own `className`, never on the stylesheet's
 * text: a content scan over `styles.css` can prove a rule was typed, never
 * that it matches anything, which is exactly how the gap above shipped
 * unnoticed. This suite fails the moment these controls go bare again.
 */
describe('styled with the rest of src/renderer/settings, not a dead semantic class', () => {
  it('draws the pairing code as a large, generously tracked monospace glyph', () => {
    draw();
    const code = screen.getByTestId('pairing-code');
    expect(code.className).not.toBe('pairing-code');
    expect(code.className).toMatch(/font-mono/);
    expect(code.className).toMatch(/tracking-/);
    // "large enough to read across a room" (the coordinator's own words) is a
    // real Tailwind size utility, not merely inherited 12-13px body text.
    expect(code.className).toMatch(/text-\[(3|4)\d(\.\d+)?px\]/);
  });

  it('draws the asking device name as its own visually distinct block', () => {
    draw({ view: { ...LIVE, awaiting: { name: 'a phone', source: '100.64.0.2' } } });
    const name = screen.getByTestId('pairing-device-name');
    expect(name.className).not.toBe('pairing-device-name');
    expect(name.className.length).toBeGreaterThan(0);
  });

  it('gives every action button in this panel a real 44px+ hit target', () => {
    draw({ devices: [{ deviceId: 'd-1', name: 'a phone', pairedAt: NOW, lastSeenAt: NOW }] });
    const buttons = [
      screen.getByRole('button', { name: /copy/i }),
      screen.getByRole('button', { name: /regenerate/i }),
      screen.getByRole('button', { name: /turn off phone access/i }),
      screen.getByRole('button', { name: /remove a phone/i }),
      screen.getByRole('button', { name: /revoke all/i }),
    ];
    for (const button of buttons) {
      expect(button.className).toMatch(/min-h-\[44px\]/);
    }
  });

  it('sizes buttons to their own label rather than a fixed box that could clip a longer one', () => {
    draw();
    const button = screen.getByRole('button', { name: /turn off phone access/i });
    // A FIXED pixel width is exactly the shape that clears a hit-box floor
    // while clipping longer paint -- the standing "44px floor does not check
    // the paint" lesson. Padding lets the box grow with its own content.
    expect(button.className).not.toMatch(/\bw-\[\d/);
    expect(button.className).toMatch(/\bpx-\d/);
  });

  it('never borrows the four session-state tokens for decoration', () => {
    draw({ view: { ...IDLE, burned: true } });
    const root = document.body;
    for (const token of ['running', 'waiting', 'done', 'failed']) {
      // `text-waiting`/`bg-done`/etc -- word-bounded so `text-danger` (a real,
      // unrelated token) or "waiting for a device" prose cannot false-positive.
      expect(root.innerHTML).not.toMatch(new RegExp(`\\b(?:text|bg|border)-${token}\\b`));
    }
  });

  it('is a Tailwind layout, not the old dead `.pairing` class', () => {
    draw();
    const root = screen.getByTestId('pairing-panel');
    expect(root.className).not.toBe('pairing');
    expect(root.className).toMatch(/flex|grid/);
  });
});
