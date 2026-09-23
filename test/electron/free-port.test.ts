/**
 * `free-port.cjs` is the guard `userdata-probe.cjs` and `probe.cjs` both
 * call before `require`-ing main, so neither can ever let
 * `startRemoteTransport()` (`src/main/index.ts`) fall through to the
 * operator's own live `DEFAULT_REMOTE_PORT` for want of a caller that forgot
 * `VAM_REMOTE_PORT` -- see `test/electron/userdata-isolation.test.ts`'s own
 * "never lets the remote endpoint default..." test for the end-to-end proof
 * against a real Electron launch. This is the fast half: the pure logic,
 * with no Electron and no port left open when it is done.
 */
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

// CommonJS on purpose -- `free-port.cjs`'s own header says why; a plain
// `require` from a `.test.ts` file is how `probe.cjs`/`userdata-probe.cjs`
// reach it too.
const { allocateFreePort, ensureHarnessRemotePort } = require('./free-port.cjs');

const ENV_KEY = 'VAM_REMOTE_PORT';
const previous = process.env[ENV_KEY];

afterEach(() => {
  if (previous === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = previous;
  }
});

describe('allocateFreePort', () => {
  it('resolves to a real, bindable loopback port, and leaves nothing listening behind', async () => {
    const port = await allocateFreePort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65_535);

    // If the port were still held, THIS bind would fail -- the same
    // assertion `userdata-isolation.test.ts` makes against a real launch.
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('answers a different port on two consecutive calls -- each closes before the next asks', async () => {
    const a = await allocateFreePort();
    const b = await allocateFreePort();
    expect(b).not.toBe(a);
  });
});

describe('ensureHarnessRemotePort', () => {
  it('sets VAM_REMOTE_PORT when the caller left it unset', async () => {
    delete process.env[ENV_KEY];
    await ensureHarnessRemotePort();
    expect(process.env[ENV_KEY]).toMatch(/^\d+$/);
  });

  it('sets VAM_REMOTE_PORT when the caller left it empty -- a shell-expanded unset variable, not a real override', async () => {
    process.env[ENV_KEY] = '';
    await ensureHarnessRemotePort();
    expect(process.env[ENV_KEY]).toMatch(/^\d+$/);
  });

  it('leaves an explicit VAM_REMOTE_PORT alone, including DEFAULT_REMOTE_PORT itself -- a caller who asked for it on purpose is not this guard’s business', async () => {
    process.env[ENV_KEY] = '58217';
    await ensureHarnessRemotePort();
    expect(process.env[ENV_KEY]).toBe('58217');
  });
});
