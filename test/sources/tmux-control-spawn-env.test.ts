/**
 * HYPOTHESIS 1 OF THE STREAMING-GLITCH REPORT, PINNED: does the control
 * client's own spawn (`spawnRealControlChild`, `control.ts` -- reused by
 * `StreamClient#connect`'s `attach-session`) carry a UTF-8 `LC_CTYPE`?
 *
 * REPRODUCED AND REFUTED as the cause of the reported "???" (this task's own
 * report): a real `tmux -C attach-session`, driven through `StreamClient`,
 * with EVERY `LANG`/`LC_*` variable stripped from `process.env` (a
 * launchd-shaped environment, no `applyUtf8Ctype` call anywhere in that
 * harness), still decoded a Claude Code-style box, CJK, an emoji and
 * Vietnamese combining marks byte-for-byte correctly
 * (`e2e/terminal-stream-glitch-shots.mjs`'s own fixture) -- because tmux's
 * control-mode wire protocol only escapes bytes below 32 and passes raw
 * UTF-8 through literally (`control-protocol.ts`'s own `decodeOutputPayload`
 * header), so the CLIENT's locale never enters the decode path for pane
 * BYTES at all -- unlike `listVamSessions`'s own `-F` format-string
 * expansion, which is genuinely locale-sensitive (`utf8-ctype.ts`'s own
 * header) and already has its own repair and its own test file.
 *
 * WHAT IS STILL WORTH PINNING, since the repro above is not a permanent
 * guard: `spawnRealControlChild` must never acquire an explicit `env`
 * override. `main/index.ts` calls `applyUtf8Ctype(process.env, ...)` once,
 * at app startup, mutating the process's OWN environment; every spawn
 * downstream of that (including this one) inherits it FOR FREE only as
 * long as it never passes its own `env` to `child_process.spawn` -- Node's
 * own default (`options.env` omitted) is "inherit `process.env`" verbatim.
 * An `env: {}` (or any other explicit override) added here later would
 * silently drop that repair for exactly this one spawn, and nothing else
 * would say so.
 */

import { describe, expect, it, vi } from 'vitest';

// Typed to `spawn`'s own two-argument shape this file actually calls it with
// (`spawnRealControlChild` never passes a third `options` argument -- the
// whole point of this test): an untyped `() => ...` infers a zero-length
// parameter tuple for `spawnSpy.mock.calls[n]`, which `tsconfig.test.json`'s
// stricter tuple indexing then refuses to index into at all.
const spawnSpy = vi.fn((_command: string, _args: readonly string[]) => ({ pid: 1 }));
vi.mock('node:child_process', () => ({ spawn: spawnSpy }));

describe('spawnRealControlChild (control.ts)', () => {
  it('spawns with no explicit `env`, so it inherits whatever applyUtf8Ctype already set on process.env', async () => {
    const { spawnRealControlChild } = await import('../../src/main/sources/tmux/control.js');
    spawnRealControlChild('tmux', ['-C', 'attach-session', '-t', '=vam-atlas-a1b2c3:']);

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const call = spawnSpy.mock.calls[0];
    expect(call?.[0]).toBe('tmux');
    expect(call?.[1]).toEqual(['-C', 'attach-session', '-t', '=vam-atlas-a1b2c3:']);
    // No third argument at all -- `child_process.spawn`'s own contract for
    // "inherit `process.env`", never a `{}` or any other object that would
    // (per Node's docs) replace it instead. `call?.length` rather than
    // indexing a third element directly: `call`'s own tuple type (matching
    // `spawnSpy`'s two-argument signature above) has no such index for
    // `tsconfig.test.json`'s stricter tuple checking to accept at all, which
    // is exactly the fact this assertion wants to state.
    expect(call?.length).toBe(2);
  });
});
