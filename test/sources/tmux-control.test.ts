/**
 * The stateful half of the control-mode fast path, with a FAKE child process
 * -- no real tmux here, exactly as `tmux-spawn.test.ts` injects a fake
 * `TmuxRun` rather than running `execFile`. What is under test is the state
 * machine: one client per server, one command in flight at a time, and every
 * way this degrades to a real spawn rather than hanging or answering wrong.
 */

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listSessionsArgv } from '../../src/main/sources/tmux/argv.js';
import {
  CONTROL_TIMEOUT_MS,
  type ControlChildProcess,
  createControlTmuxRunner,
  RECONNECT_BACKOFF_MS,
} from '../../src/main/sources/tmux/control.js';
import type { TmuxRun } from '../../src/main/sources/tmux/spawn.js';

/** A real, recognised argv (`list-sessions -F <the real format string>`) --
 * used throughout rather than a hand-typed fixture, so these tests exercise
 * the SAME encoder `tmux-control-protocol.test.ts` already pins rather than
 * a shape that only looks like one. */
const LS = listSessionsArgv();

/** A `ControlChildProcess` driven entirely by the test. */
class FakeChild extends EventEmitter implements ControlChildProcess {
  readonly written: string[] = [];
  killed = false;
  readonly stdout = new EventEmitter();
  readonly stdin = {
    write: (data: string): boolean => {
      this.written.push(data);
      return true;
    },
  };
  kill(): void {
    this.killed = true;
  }
  data(chunk: string): void {
    this.stdout.emit('data', chunk);
  }
}

/** A fake `TmuxRun` that always answers `ok`, recording every argv it was
 * asked to run -- none of these tests need it to answer anything else; what
 * matters is only ever WHETHER it was called. */
function fakeFallback(): TmuxRun & { calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const run = (async (argv: readonly string[]) => {
    calls.push(argv);
    return { failure: null, stdout: '', stderr: '' };
  }) as TmuxRun & { calls: (readonly string[])[] };
  run.calls = calls;
  return run;
}

/** Let every already-queued microtask (the client's own promise chain,
 * chiefly) run before the next assertion looks at its side effects. */
const tick = async (n = 3): Promise<void> => {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
};

function harness(now: () => number = () => 0) {
  const children: FakeChild[] = [];
  const spawnChild = vi.fn((_binary: string, _argv: readonly string[]) => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  const fallback = fakeFallback();
  const run = createControlTmuxRunner('tmux', { fallback, spawnChild, now });
  return { run, spawnChild, fallback, children };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createControlTmuxRunner', () => {
  it('bootstraps ONE control client, attached to the housekeeping session, on the first real call', async () => {
    const { run, spawnChild, children } = harness();
    const promise = run(LS);
    await tick();
    expect(spawnChild).toHaveBeenCalledTimes(1);
    expect(spawnChild.mock.calls[0]?.[1]).toEqual([
      '-C',
      'new-session',
      '-A',
      '-s',
      'vamctl',
      '-x',
      '10',
      '-y',
      '4',
      'cat',
    ]);
    children[0]?.data('%begin 1 1 0\nvam-a1b2c3\n%end 1 1 0\n');
    await expect(promise).resolves.toEqual({ failure: null, stdout: 'vam-a1b2c3\n', stderr: '' });
  });

  it('writes the encoded line, not the raw argv, to the child’s stdin', async () => {
    const { run, children } = harness();
    const promise = run(['send-keys', '-t', '=vam-a1b2c3:', '-l', '--', 'a']);
    await tick();
    expect(children[0]?.written).toEqual(['send-keys -t =vam-a1b2c3: -H 61\n']);
    children[0]?.data('%begin 1 1 0\n%end 1 1 0\n');
    await promise;
  });

  it('reuses the SAME client for a second call to the same (default) server', async () => {
    const { run, spawnChild, children } = harness();
    const p1 = run(LS);
    await tick();
    children[0]?.data('%begin 1 1 0\na\n%end 1 1 0\n');
    await p1;
    const p2 = run(LS);
    await tick();
    expect(spawnChild).toHaveBeenCalledTimes(1);
    children[0]?.data('%begin 1 2 0\nb\n%end 1 2 0\n');
    await p2;
  });

  it('runs a SEPARATE client per -L socket, never crossing a reply between servers', async () => {
    const { run, spawnChild, children } = harness();
    const pA = run(['-L', 'sock-a', ...LS]);
    const pB = run(['-L', 'sock-b', ...LS]);
    await tick();
    expect(spawnChild).toHaveBeenCalledTimes(2);
    expect(spawnChild.mock.calls[0]?.[1].slice(0, 2)).toEqual(['-L', 'sock-a']);
    expect(spawnChild.mock.calls[1]?.[1].slice(0, 2)).toEqual(['-L', 'sock-b']);
    children[1]?.data('%begin 1 1 0\nb\n%end 1 1 0\n');
    children[0]?.data('%begin 1 1 0\na\n%end 1 1 0\n');
    await expect(pA).resolves.toMatchObject({ stdout: 'a\n' });
    await expect(pB).resolves.toMatchObject({ stdout: 'b\n' });
  });

  it('waits for BOTH blocks of a compound command before resolving, in order', async () => {
    const { run, children } = harness();
    const promise = run([
      'display-message',
      '-p',
      '-t',
      '=vam-a1b2c3:',
      '-F',
      '@vam-cursor #{cursor_flag} #{cursor_x} #{cursor_y} #{history_size} #{mouse_any_flag}',
      ';',
      'capture-pane',
      '-p',
      '-e',
      '-t',
      '=vam-a1b2c3:',
    ]);
    await tick();
    children[0]?.data('%begin 1 1 0\n@vam-cursor 1 8 0 0 0\n%end 1 1 0\n');
    // Not yet: only one of the two expected blocks has arrived.
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false);
    children[0]?.data('%begin 1 2 0\nsh-3.2$\n\n%end 1 2 0\n');
    await expect(promise).resolves.toEqual({
      failure: null,
      stdout: '@vam-cursor 1 8 0 0 0\nsh-3.2$\n\n',
      stderr: '',
    });
  });

  it('serialises: a second call’s line is not written until the first has resolved', async () => {
    const { run, children } = harness();
    const p1 = run(LS);
    const p2 = run(LS);
    await tick();
    expect(children[0]?.written).toHaveLength(1);
    children[0]?.data('%begin 1 1 0\na\n%end 1 1 0\n');
    await p1;
    await tick();
    expect(children[0]?.written).toHaveLength(2);
    children[0]?.data('%begin 1 2 0\nb\n%end 1 2 0\n');
    await p2;
  });

  it('falls back straight to a real spawn for an argv it does not know how to encode', async () => {
    const { run, spawnChild, fallback } = harness();
    const result = await run(['new-session', '-d', '-s', 'vam-x']);
    expect(spawnChild).not.toHaveBeenCalled();
    expect(fallback.calls).toEqual([['new-session', '-d', '-s', 'vam-x']]);
    expect(result).toEqual({ failure: null, stdout: '', stderr: '' });
  });

  it('falls back for an argv whose leading flag it does not recognise as a server prefix', async () => {
    const { run, spawnChild, fallback } = harness();
    await run(['-f', 'x.conf', 'list-sessions']);
    expect(spawnChild).not.toHaveBeenCalled();
    expect(fallback.calls).toEqual([['-f', 'x.conf', 'list-sessions']]);
  });

  it('falls back when the child dies before answering, and does not leave the caller hanging', async () => {
    const { run, children, fallback } = harness();
    const promise = run(LS);
    await tick();
    children[0]?.emit('exit', 1, null);
    await expect(promise).resolves.toEqual({ failure: null, stdout: '', stderr: '' });
    expect(fallback.calls).toEqual([LS]);
  });

  it('falls back when the write itself throws (e.g. EPIPE on a half-dead child)', async () => {
    const throwing = new FakeChild();
    throwing.stdin.write = () => {
      throw new Error('EPIPE');
    };
    const spawnChild = vi.fn(() => throwing);
    const runner = createControlTmuxRunner('tmux', {
      fallback: fakeFallback(),
      spawnChild,
      now: () => 0,
    });
    const result = await runner(LS);
    expect(result).toEqual({ failure: null, stdout: '', stderr: '' });
  });

  it('times out a reply that never arrives, KILLS the connection, and falls back', async () => {
    // The kill is deliberate, not a bonus cleanup: see the next test for
    // exactly the ambiguity it exists to rule out. A timeout only means this
    // client gave up waiting -- tmux was never told to stop working on the
    // line, so its real reply can still land later. Tearing the connection
    // down is what guarantees a late reply can never reach a `#pending` that
    // has moved on to a different command.
    vi.useFakeTimers();
    let clock = 0;
    const { run, spawnChild, children, fallback } = harness(() => clock);
    const p1 = run(LS);
    await vi.advanceTimersByTimeAsync(CONTROL_TIMEOUT_MS);
    await expect(p1).resolves.toEqual({ failure: null, stdout: '', stderr: '' });
    expect(fallback.calls).toEqual([LS]);
    expect(children[0]?.killed).toBe(true);
    // Past the backoff: the NEXT command reconnects with a fresh child.
    clock += RECONNECT_BACKOFF_MS + 1;
    const p2 = run(LS);
    await tick();
    expect(spawnChild).toHaveBeenCalledTimes(2);
    children[1]?.data('%begin 1 1 0\nok\n%end 1 1 0\n');
    await expect(p2).resolves.toMatchObject({ stdout: 'ok\n' });
  });

  it('backs off reconnecting after a death, and retries once the backoff has passed', async () => {
    let clock = 0;
    const { run, spawnChild, children, fallback } = harness(() => clock);
    const p1 = run(LS);
    await tick();
    children[0]?.emit('exit', 1, null);
    await p1;
    fallback.calls.length = 0;
    clock += RECONNECT_BACKOFF_MS - 1;
    const p2 = run(LS);
    await tick();
    // Still backing off: no second spawn attempt yet, straight to fallback.
    expect(spawnChild).toHaveBeenCalledTimes(1);
    await p2;
    expect(fallback.calls).toHaveLength(1);
    clock += 2;
    const p3 = run(LS);
    await tick();
    expect(spawnChild).toHaveBeenCalledTimes(2);
    children[1]?.data('%begin 1 1 0\nok\n%end 1 1 0\n');
    await expect(p3).resolves.toMatchObject({ stdout: 'ok\n' });
  });

  it('a stale reply on the OLD (killed) child is never mistaken for the NEW command’s answer', async () => {
    // THE EXACT RACE THE KILL-ON-TIMEOUT EXISTS TO CLOSE. `p1` times out and
    // its connection is torn down; `p2` reconnects on a FRESH child. If the
    // old child's process was merely abandoned rather than killed -- or if
    // its late data were not gated on which child is still current -- this
    // stale reply would arrive indistinguishable from `p2`'s own answer,
    // landing the wrong text on screen for a poll or an echo read.
    vi.useFakeTimers();
    let clock = 0;
    const { run, children } = harness(() => clock);
    const p1 = run(LS);
    await vi.advanceTimersByTimeAsync(CONTROL_TIMEOUT_MS);
    await p1;
    const oldChild = children[0];
    clock += RECONNECT_BACKOFF_MS + 1;
    const p2 = run(LS);
    await tick();
    const newChild = children[1];
    expect(newChild).not.toBe(oldChild);
    // The late reply to `p1`, arriving on the OLD child -- gated out, since
    // it is no longer `this.#child`.
    oldChild?.data('%begin 1 1 0\nstale\n%end 1 1 0\n');
    newChild?.data('%begin 1 1 0\nfresh\n%end 1 1 0\n');
    await expect(p2).resolves.toMatchObject({ stdout: 'fresh\n' });
  });

  it('a late ’exit’ from an old, already-replaced child does not tear down the new connection', async () => {
    // Node does not promise a killed child's `'exit'` fires before the next
    // reconnect finishes -- it is always asynchronous. If `#onDown` were not
    // gated on child identity, this late event would null out the brand-new
    // connection `p2` is using and force a THIRD spawn for `p3` that should
    // never have been needed.
    vi.useFakeTimers();
    let clock = 0;
    const { run, spawnChild, children } = harness(() => clock);
    const p1 = run(LS);
    await vi.advanceTimersByTimeAsync(CONTROL_TIMEOUT_MS);
    await p1;
    const oldChild = children[0];
    clock += RECONNECT_BACKOFF_MS + 1;
    const p2 = run(LS);
    await tick();
    children[1]?.data('%begin 1 1 0\na\n%end 1 1 0\n');
    await p2;
    // The real process's exit finally arrives, long after this client moved on.
    oldChild?.emit('exit', null, 'SIGTERM');
    expect(spawnChild).toHaveBeenCalledTimes(2);
    const p3 = run(LS);
    await tick();
    expect(spawnChild).toHaveBeenCalledTimes(2);
    children[1]?.data('%begin 1 2 0\nb\n%end 1 2 0\n');
    await expect(p3).resolves.toMatchObject({ stdout: 'b\n' });
  });

  it('dispose() kills every live client and forgets it', async () => {
    const child = new FakeChild();
    const spawnChild = vi.fn(() => child);
    const runner = createControlTmuxRunner('tmux', {
      fallback: fakeFallback(),
      spawnChild,
      now: () => 0,
    });
    void runner(LS);
    await tick();
    runner.dispose();
    expect(child.killed).toBe(true);
  });
});
