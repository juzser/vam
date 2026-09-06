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

function draw(over: Partial<PairingPanelProps> = {}) {
  const props: PairingPanelProps = {
    view: LIVE,
    devices: [],
    url: 'https://example-machine.example-tailnet.ts.net',
    allowWrites: false,
    nowMs: NOW,
    // Serve already on, by default: most of the tests in this file are about
    // the pairing code, not phone access, and depend on `url` being drawn
    // unconditionally the way it always was before phone access existed.
    serve: { cliMissing: false, enabled: true, lastError: null, timedOut: false, pending: false },
    onRegenerate: vi.fn(),
    onApprove: vi.fn(),
    onDeny: vi.fn(),
    onRemove: vi.fn(),
    onRevokeAll: vi.fn(),
    onCopyUrl: vi.fn(),
    onEnableServe: vi.fn(),
    onDisableServe: vi.fn(),
    ...over,
  };
  render(<PairingPanel {...props} />);
  return props;
}

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
    draw({
      serve: { cliMissing: true, enabled: false, lastError: null, timedOut: false, pending: false },
    });

    expect(screen.getByTestId('serve-no-cli')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /enable phone access/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /turn off phone access/i })).toBeNull();
    const link = screen.getByRole('link', { name: /install tailscale/i });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/tailscale\.com\//);
  });

  it('states what turning it on exposes, and offers to enable it, while off', () => {
    const props = draw({
      serve: {
        cliMissing: false,
        enabled: false,
        lastError: null,
        timedOut: false,
        pending: false,
      },
    });

    expect(document.body.textContent ?? '').toMatch(/tailscale serve/i);
    expect(document.body.textContent ?? '').toMatch(/whole tailnet|every laptop/i);
    fireEvent.click(screen.getByRole('button', { name: /enable phone access/i }));
    expect(props.onEnableServe).toHaveBeenCalled();
  });

  it('never runs serve as a side effect of merely being drawn, while off', () => {
    const props = draw({
      serve: {
        cliMissing: false,
        enabled: false,
        lastError: null,
        timedOut: false,
        pending: false,
      },
    });
    expect(props.onEnableServe).not.toHaveBeenCalled();
  });

  it('offers an equally easy way back off, while on', () => {
    const props = draw({
      serve: { cliMissing: false, enabled: true, lastError: null, timedOut: false, pending: false },
    });

    expect(screen.queryByRole('button', { name: /enable phone access/i })).toBeNull();
    const off = screen.getByRole('button', { name: /turn off phone access/i });
    fireEvent.click(off);
    expect(props.onDisableServe).toHaveBeenCalled();
  });

  it('shows the resulting address while on', () => {
    draw({
      serve: { cliMissing: false, enabled: true, lastError: null, timedOut: false, pending: false },
      url: 'https://example-machine.example-tailnet.ts.net',
    });

    expect(screen.getByTestId('pairing-url').textContent).toMatch(/^https:\/\//);
  });

  it('says the address cannot be read rather than guessing one, while on', () => {
    draw({
      serve: { cliMissing: false, enabled: true, lastError: null, timedOut: false, pending: false },
      url: null,
    });

    expect(screen.queryByTestId('pairing-url')).toBeNull();
  });

  it("surfaces a refusal in the CLI's own real words, not a generic error", () => {
    draw({
      serve: {
        cliMissing: false,
        enabled: false,
        lastError: 'access denied: reauthenticate to use Serve',
        timedOut: false,
        pending: false,
      },
    });

    const said = screen.getByTestId('serve-error');
    expect(said.textContent).toBe('access denied: reauthenticate to use Serve');
    expect(said.getAttribute('role')).toBe('alert');
  });

  it('says the enable/disable round trip is in progress rather than looking frozen', () => {
    const props = draw({
      serve: { cliMissing: false, enabled: false, lastError: null, timedOut: false, pending: true },
    });

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
    draw({
      serve: { cliMissing: false, enabled: true, lastError: null, timedOut: false, pending: true },
    });

    expect(screen.queryByRole('button', { name: /^turn off phone access$/i })).toBeNull();
    const pending = screen.getByRole('button', { name: /turning off/i });
    expect(pending.hasAttribute('disabled')).toBe(true);
  });

  it('reports a timeout as its own honest state, not a made-up CLI refusal', () => {
    draw({
      serve: { cliMissing: false, enabled: false, lastError: null, timedOut: true, pending: false },
    });

    const said = screen.getByTestId('serve-error');
    expect(said.textContent).toMatch(/did not answer in time/i);
  });

  it('offers the manual `tailscale serve reset` escape hatch only for a failed DISABLE', () => {
    // enabled: true here can only mean the failure was a disable attempt --
    // a failed enable would have left `enabled` false (ServeState's own
    // invariant, see src/main/remote/state.ts).
    draw({
      serve: {
        cliMissing: false,
        enabled: true,
        lastError: 'ENOSPC: no space left on device',
        timedOut: false,
        pending: false,
      },
    });

    expect(screen.getByTestId('serve-error').textContent).toMatch(/tailscale serve reset/i);
  });

  it('never suggests the manual reset for a failed ENABLE', () => {
    draw({
      serve: {
        cliMissing: false,
        enabled: false,
        lastError: 'ENOSPC: no space left on device',
        timedOut: false,
        pending: false,
      },
    });

    expect(screen.getByTestId('serve-error').textContent).not.toMatch(/tailscale serve reset/i);
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
