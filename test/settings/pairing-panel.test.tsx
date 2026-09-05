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
    onRegenerate: vi.fn(),
    onApprove: vi.fn(),
    onDeny: vi.fn(),
    onRemove: vi.fn(),
    onRevokeAll: vi.fn(),
    onCopyUrl: vi.fn(),
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

  it('asks the operator to find the address when it could not be read', () => {
    draw({ url: null });
    expect(screen.queryByTestId('pairing-url')).toBeNull();
    expect(document.body.textContent ?? '').toMatch(/tailscale serve/i);
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
