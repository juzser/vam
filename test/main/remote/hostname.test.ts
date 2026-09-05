/**
 * Reading the MagicDNS address, and the three ways it can be absent.
 *
 * NOTHING HERE RUNS `tailscale`. The CLI is a double in every case, because
 * the property under test is precisely that vam does not depend on one being
 * installed -- a test that shelled out for real would pass or fail on the
 * machine rather than on the code.
 */

import { describe, expect, it, vi } from 'vitest';
import { readServeAddress } from '../../../src/main/remote/hostname.js';

/** The name the merged code uses. No real tailnet appears in this repo. */
const DNS_NAME = 'example-machine.example-tailnet.ts.net.';

const running = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ BackendState: 'Running', Self: { DNSName: DNS_NAME }, ...over });

describe('readServeAddress', () => {
  it('reads the https origin, and asks tailscale for status as JSON', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: running() }));

    const address = await readServeAddress(run);

    expect(address).toEqual({
      kind: 'found',
      url: 'https://example-machine.example-tailnet.ts.net',
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(['status', '--json']);
  });

  it('never offers a bare http MagicDNS URL', async () => {
    const address = await readServeAddress(async () => ({ code: 0, stdout: running() }));

    expect(address.kind === 'found' && address.url.startsWith('https://')).toBe(true);
  });

  it('says it could not ask when there is no CLI to ask', async () => {
    const address = await readServeAddress(async () => {
      throw Object.assign(new Error('spawn tailscale ENOENT'), { code: 'ENOENT' });
    });

    expect(address).toEqual({ kind: 'unavailable', reason: 'no-cli' });
  });

  it('says it could not ask when the CLI answers something that is not status', async () => {
    const address = await readServeAddress(async () => ({ code: 0, stdout: 'not json at all' }));

    expect(address).toEqual({ kind: 'unavailable', reason: 'no-cli' });
  });

  it('says Tailscale is not running, which is a different sentence', async () => {
    const address = await readServeAddress(async () => ({
      code: 1,
      stdout: JSON.stringify({ BackendState: 'Stopped', Self: { DNSName: DNS_NAME } }),
    }));

    expect(address).toEqual({ kind: 'unavailable', reason: 'not-running' });
  });

  it('never guesses a hostname: running with no MagicDNS name is its own answer', async () => {
    const address = await readServeAddress(async () => ({
      code: 0,
      stdout: running({ Self: { DNSName: '' } }),
    }));

    expect(address).toEqual({ kind: 'unavailable', reason: 'no-name' });
  });

  it('refuses a name that is not a MagicDNS name rather than dressing it as one', async () => {
    const address = await readServeAddress(async () => ({
      code: 0,
      stdout: running({ Self: { DNSName: 'localhost' } }),
    }));

    expect(address).toEqual({ kind: 'unavailable', reason: 'no-name' });
  });
});
