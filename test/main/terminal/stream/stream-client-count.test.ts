/**
 * ONE CONTROL CLIENT PER VISIBLE TERMINAL, AGAINST A REAL TMUX.
 *
 * The performance brief for flipping `streamingTerminal`'s default asked for
 * exactly this invariant, measured rather than read off the source: "There
 * must be exactly one stream per VISIBLE terminal. Close or suspend it when
 * the tab or window is hidden, the session is switched, or the Terminal view
 * is left." `StreamClient#connect` is the one thing that ever spawns a real
 * `tmux -C` child (`main/terminal/stream/client.ts`); `TerminalStreamTab.tsx`'s
 * own visibility/session-switch effect (`teardownStream` before every fresh
 * `connect()`) is what is supposed to keep exactly one of these alive at a
 * time in the real app. A unit test of THAT component only proves it calls
 * `close()` before `open()` -- a real tmux is what can answer "and did that
 * actually kill the child", via `list-clients`, which is what this file asks.
 *
 * SAFETY. A private `-L` socket named for this process and this file, three
 * session names with no `vam-` prefix, and a `kill-server` afterwards --
 * `spawn.ts`'s own rule for why every other real-tmux test in this repo does
 * the same (`tmux-history-live.test.ts`).
 *
 * SKIPPED, LOUDLY, WHERE THERE IS NO TMUX -- the same `tmuxWorks()` probe
 * `tmux-history-live.test.ts` uses, for the identical reason: the provider is
 * optional in a way the rest of vam is not.
 */

import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StreamClient } from '../../../../src/main/terminal/stream/client.js';

const tmuxWorks = (): boolean => {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const SOCKET = `vamtest${process.pid}sc`;
// `StreamClient` itself refuses any target that does not match
// `SAFE_TARGET_RE` (`control-protocol.ts`), which requires a `vam-` prefix --
// unlike `tmux-history-live.test.ts`'s deliberately non-`vam-` names (proving
// the POLLING path reads any session), this file is exercising `StreamClient`
// directly, so its own validation gate applies. Still a private socket, still
// killed in `afterAll`.
const SESSION_A = `vam-streamcount-a-${process.pid}`;
const SESSION_B = `vam-streamcount-b-${process.pid}`;

const tmux = (...argv: string[]): string =>
  execFileSync('tmux', ['-L', SOCKET, ...argv], { encoding: 'utf8' });

/** How many control-mode clients tmux itself currently reports -- the fact
 *  under test, never inferred from this file's own bookkeeping. Trimmed and
 *  filtered for blank lines: `list-clients` against a server with none prints
 *  nothing, which `''.split('\n')` turns into ONE empty string, not zero. */
const clientCount = (): number => {
  let out: string;
  try {
    out = tmux('list-clients', '-F', '#{client_name}');
  } catch {
    // "no server running on <socket>" -- exactly zero clients, and the
    // ordinary state once the last one disconnects and tmux exits.
    return 0;
  }
  return out
    .trim()
    .split('\n')
    .filter((line) => line.length > 0).length;
};

const live = tmuxWorks();

describe.skipIf(!live)('one StreamClient == one real tmux -C client', () => {
  beforeAll(() => {
    tmux('new-session', '-d', '-s', SESSION_A, '-x', '80', '-y', '24', 'sh');
    tmux('new-session', '-d', '-s', SESSION_B, '-x', '80', '-y', '24', 'sh');
  }, 20_000);

  afterAll(() => {
    try {
      tmux('kill-server');
    } catch {
      // Already gone, which is the state this wanted.
    }
  });

  it('zero clients exist before anything opens a stream', () => {
    expect(clientCount()).toBe(0);
  });

  it('opening ONE stream (one visible terminal) is exactly one tmux -C client', async () => {
    const client = new StreamClient({ prefix: ['-L', SOCKET], target: SESSION_A });
    try {
      await client.connect();
      expect(clientCount()).toBe(1);
    } finally {
      client.dispose();
    }
  });

  it('disposing it (leaving the view) drops back to zero', async () => {
    const client = new StreamClient({ prefix: ['-L', SOCKET], target: SESSION_A });
    await client.connect();
    expect(clientCount()).toBe(1);

    client.dispose();
    // `dispose()` kills the child synchronously (`ControlChildProcess#kill`),
    // but the OS reaping the process and tmux itself noticing the pipe close
    // is not -- poll rather than assert immediately after `kill()` returns,
    // the same allowance a signal-based teardown always needs.
    const until = Date.now() + 5_000;
    while (Date.now() < until && clientCount() > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(clientCount()).toBe(0);
  });

  it('switching the viewed session (dispose THEN open, the app’s own order) never overlaps at two', async () => {
    const first = new StreamClient({ prefix: ['-L', SOCKET], target: SESSION_A });
    await first.connect();
    expect(clientCount()).toBe(1);

    // `TerminalStreamTab.tsx`'s own `teardownStream()` runs BEFORE the next
    // `connect()` -- disposing the old client before the new one is opened,
    // never the other way around. Mirrored here rather than opening both at
    // once, which would just prove a DIFFERENT (and wrong) protocol works.
    first.dispose();
    const until = Date.now() + 5_000;
    while (Date.now() < until && clientCount() > 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(clientCount()).toBe(0);

    const second = new StreamClient({ prefix: ['-L', SOCKET], target: SESSION_B });
    try {
      await second.connect();
      // Never two -- the invariant this whole file exists to falsify.
      expect(clientCount()).toBe(1);
    } finally {
      second.dispose();
    }
  });
});
