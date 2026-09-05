/**
 * The pairing code: how one is minted, how it dies, and how few guesses it
 * survives.
 *
 * THE BURN RULE IS THE DEFENCE, NOT THE ENTROPY. Eight symbols out of thirty
 * is ~39 bits, which is a lot for a human to type and not much for a machine
 * to guess; what makes the window unusable is that the code exists only while
 * the operator is looking at the pairing screen, lives 120 seconds, and is
 * destroyed after five wrong answers. These tests are mostly about the death
 * of codes.
 *
 * No fixture here is a real code, device name or address, and nothing opens a
 * socket: the clock is injected and the grant is a stub.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../../../src/main/remote/auth.js';
import type { Grant } from '../../../src/main/remote/devices.js';
import {
  APPROVAL_TIMEOUT_MS,
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_TTL_MS,
  createPairing,
  formatCode,
  GLOBAL_FAILURE_LIMIT,
  LOCKOUT_MS,
  MAX_ATTEMPTS_PER_CODE,
  mintCode,
  normalizeCode,
} from '../../../src/main/remote/pairing.js';

const GRANTED: Identity = { deviceId: 'device-1', name: 'a phone' };
const grantOf = async (name: string): Promise<Grant> => ({
  identity: { ...GRANTED, name },
  token: 'a-token-this-test-invented',
});

function harness(over: { grant?: (name: string) => Promise<Grant> } = {}) {
  let now = 1_000_000;
  const pairing = createPairing({ now: () => now, grant: over.grant ?? grantOf });
  return { pairing, advance: (ms: number) => (now += ms) };
}

/** Submits and lets the operator say yes, which is the ordinary path. */
async function submitAndApprove(
  pairing: ReturnType<typeof harness>['pairing'],
  code: string,
  name = 'a phone',
): Promise<Awaited<ReturnType<typeof pairing.submit>>> {
  const settled = pairing.submit(code, name, '100.64.0.2');
  await Promise.resolve();
  pairing.approve();
  return await settled;
}

describe('mintCode', () => {
  it('draws only from the unambiguous alphabet, at the stated length', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = mintCode();
      expect(code).toHaveLength(CODE_LENGTH);
      for (const glyph of code) {
        expect(CODE_ALPHABET).toContain(glyph);
      }
    }
  });

  it('excludes every glyph a human confuses with another', () => {
    for (const ambiguous of ['I', 'L', 'O', 'U', '0', '1']) {
      expect(CODE_ALPHABET).not.toContain(ambiguous);
    }
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintCode()));
    expect(seen.size).toBe(200);
  });
});

describe('formatCode and normalizeCode', () => {
  it('shows a code in two groups of four', () => {
    expect(formatCode('ABCD2345')).toBe('ABCD-2345');
  });

  it('accepts what a human actually types', () => {
    expect(normalizeCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(normalizeCode('abcd 2345')).toBe('ABCD2345');
  });

  it('caps the input length, so a huge body is never compared', () => {
    expect(normalizeCode('A'.repeat(10_000))).toHaveLength(CODE_LENGTH);
  });
});

describe('a live code', () => {
  it('exists only while the pairing screen is open', () => {
    const { pairing } = harness();
    expect(pairing.live()).toBeNull();
    const code = pairing.open();
    expect(pairing.live()?.code).toBe(code.code);
    pairing.close();
    expect(pairing.live()).toBeNull();
  });

  it('expires after two minutes', async () => {
    const { pairing, advance } = harness();
    const { code } = pairing.open();
    advance(CODE_TTL_MS + 1);
    expect(pairing.live()).toBeNull();
    expect(await pairing.submit(code, 'a phone', '100.64.0.2')).toEqual({
      ok: false,
      reason: 'no-code',
    });
  });

  it('is single-use: the same code cannot pair a second device', async () => {
    const { pairing } = harness();
    const { code } = pairing.open();
    expect(await submitAndApprove(pairing, code)).toMatchObject({ ok: true });
    expect(await pairing.submit(code, 'another phone', '100.64.0.3')).toEqual({
      ok: false,
      reason: 'no-code',
    });
  });

  it('is killed by minting a new one, so a never-entered code cannot live on', async () => {
    const { pairing } = harness();
    const first = pairing.open().code;
    const second = pairing.open().code;
    expect(second).not.toBe(first);
    expect(await pairing.submit(first, 'a phone', '100.64.0.2')).toEqual({
      ok: false,
      reason: 'wrong-code',
    });
  });
});

describe('wrong answers', () => {
  it('refuses a wrong code without saying anything about the right one', async () => {
    const { pairing } = harness();
    pairing.open();
    const outcome = await pairing.submit('ZZZZZZZZ', 'a phone', '100.64.0.2');
    expect(outcome).toEqual({ ok: false, reason: 'wrong-code' });
  });

  it('burns the code after five wrong answers, and stays burned', async () => {
    const { pairing } = harness();
    const { code } = pairing.open();
    for (let i = 1; i < MAX_ATTEMPTS_PER_CODE; i += 1) {
      expect(await pairing.submit('ZZZZZZZZ', 'a phone', '100.64.0.2')).toEqual({
        ok: false,
        reason: 'wrong-code',
      });
    }
    expect(await pairing.submit('ZZZZZZZZ', 'a phone', '100.64.0.2')).toEqual({
      ok: false,
      reason: 'burned',
    });
    expect(pairing.live()).toBeNull();
    expect(pairing.state().burned).toBe(true);
    // The right code is worth nothing once the wrong ones burned it.
    expect(await pairing.submit(code, 'a phone', '100.64.0.2')).toEqual({
      ok: false,
      reason: 'burned',
    });
  });

  it('disables pairing for fifteen minutes after ten failures in a minute', async () => {
    const { pairing, advance } = harness();
    for (let i = 0; i < GLOBAL_FAILURE_LIMIT; i += 1) {
      pairing.open();
      await pairing.submit('ZZZZZZZZ', 'a phone', `100.64.0.${i}`);
      advance(1_000);
    }
    const { code } = pairing.open();
    expect(await pairing.submit(code, 'a phone', '100.64.0.2')).toEqual({
      ok: false,
      reason: 'throttled',
    });
    expect(pairing.state().throttledUntil).toBeGreaterThan(0);
    advance(LOCKOUT_MS + 1);
    const fresh = pairing.open();
    expect(await submitAndApprove(pairing, fresh.code)).toMatchObject({ ok: true });
  });

  it('forgets failures older than the window rather than accumulating them', async () => {
    const { pairing, advance } = harness();
    for (let i = 0; i < GLOBAL_FAILURE_LIMIT - 1; i += 1) {
      pairing.open();
      await pairing.submit('ZZZZZZZZ', 'a phone', '100.64.0.2');
    }
    advance(61_000);
    const { code } = pairing.open();
    expect(await submitAndApprove(pairing, code)).toMatchObject({ ok: true });
  });
});

describe('the operator confirmation', () => {
  it('grants nothing until the operator says yes', async () => {
    const grant = vi.fn(grantOf);
    const { pairing } = harness({ grant });
    const { code } = pairing.open();
    const settled = pairing.submit(code, 'a phone', '100.64.0.2');
    await Promise.resolve();
    expect(grant).not.toHaveBeenCalled();
    expect(pairing.state().awaiting).toEqual({ name: 'a phone', source: '100.64.0.2' });
    pairing.approve();
    expect(await settled).toEqual({
      ok: true,
      identity: { deviceId: 'device-1', name: 'a phone' },
      token: 'a-token-this-test-invented',
    });
    expect(grant).toHaveBeenCalledWith('a phone');
  });

  it('refuses when the operator says no', async () => {
    const { pairing } = harness();
    const { code } = pairing.open();
    const settled = pairing.submit(code, 'a phone', '100.64.0.2');
    await Promise.resolve();
    pairing.deny();
    expect(await settled).toEqual({ ok: false, reason: 'denied' });
  });

  it('refuses when the screen closes with a request still waiting', async () => {
    const { pairing } = harness();
    const { code } = pairing.open();
    const settled = pairing.submit(code, 'a phone', '100.64.0.2');
    await Promise.resolve();
    pairing.close();
    expect(await settled).toEqual({ ok: false, reason: 'denied' });
  });

  it('refuses a second device while one is already waiting', async () => {
    const { pairing } = harness();
    const { code } = pairing.open();
    const settled = pairing.submit(code, 'a phone', '100.64.0.2');
    await Promise.resolve();
    expect(await pairing.submit(code, 'another', '100.64.0.3')).toEqual({
      ok: false,
      reason: 'no-code',
    });
    pairing.deny();
    await settled;
  });

  it('refuses a request the operator never answered, rather than waiting forever', async () => {
    vi.useFakeTimers();
    try {
      const { pairing } = harness();
      const { code } = pairing.open();
      const settled = pairing.submit(code, 'a phone', '100.64.0.2');
      await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS + 1);
      expect(await settled).toEqual({ ok: false, reason: 'denied' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('sanitises the name a device proposes, which is attacker-supplied text', async () => {
    const { pairing } = harness();
    const { code } = pairing.open();
    const outcome = await submitAndApprove(pairing, code, `  a\nphone${'!'.repeat(200)}  `);
    expect(outcome).toMatchObject({ ok: true });
    if (outcome.ok) {
      expect(outcome.identity.name).not.toMatch(/\n/);
      expect(outcome.identity.name.length).toBeLessThanOrEqual(64);
    }
  });
});
