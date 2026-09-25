/**
 * A genuinely free loopback port, the OS's own way: listen on 0, read back
 * what was bound, close immediately.
 *
 * Shared by every harness entry that `require`s the real `out/main/index.cjs`
 * (`probe.cjs`, `userdata-probe.cjs`) so NONE of them can ever let
 * `startRemoteTransport()` (`src/main/index.ts`) fall through to
 * `DEFAULT_REMOTE_PORT` (58217, `src/main/remote/launch.ts`) for want of a
 * caller that forgot to set `VAM_REMOTE_PORT` -- that default is the
 * operator's own, already-running `vam.app` on this same machine, and
 * `VAM_USER_DATA_DIR` isolates storage, not this. `test/electron/
 * userdata-isolation.test.ts` names the exact scenario this exists for: a
 * probe run directly, the way the bug this guards was actually found, never
 * goes through a test file's own `freePort()`-then-pass dance at all.
 */
const { createServer } = require('node:http');

function allocateFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address !== null && typeof address === 'object' ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port === null) reject(new Error('no port assigned'));
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

/**
 * Sets `process.env.VAM_REMOTE_PORT` to a freshly allocated port when the
 * caller left it unset or empty -- an explicit value, including one a caller
 * set to reach `DEFAULT_REMOTE_PORT` on purpose, always wins and is left
 * alone. Must run BEFORE `require`-ing main, the same discipline `index.ts`
 * itself documents for `VAM_USER_DATA_DIR`: nothing about a port chosen
 * after `startRemoteTransport()` has already read the environment can
 * un-bind it.
 */
async function ensureHarnessRemotePort() {
  if (process.env.VAM_REMOTE_PORT === undefined || process.env.VAM_REMOTE_PORT === '') {
    process.env.VAM_REMOTE_PORT = String(await allocateFreePort());
  }
}

module.exports = { allocateFreePort, ensureHarnessRemotePort };
