/**
 * IS A CODEX WRITING THIS THREAD RIGHT NOW? The one question
 * `docs/design/a-second-source.md` left as "unmeasured", and the answer Stage
 * 3 was waiting on.
 *
 * ── WHAT WAS MEASURED, AND ON WHAT ────────────────────────────────────────
 *
 * codex-cli 0.153.2, macOS 25.6.0, Node 22.23.1, against the operator's own
 * `~/.codex` and one throwaway thread on a private `-L` tmux socket:
 *
 *   - a live Codex CLI holds an EXCLUSIVE `flock` on
 *     `~/.codex/thread-writer-locks/<uuid>.lock`; a non-blocking open asking
 *     for a lock fails with `EAGAIN`, errno 35 (`EWOULDBLOCK`). Measured for
 *     the ChatGPT desktop app's `codex app-server` AND, separately, for a
 *     `codex` CLI TUI started by hand -- the two lock identically.
 *   - the lock is taken BEFORE the thread has a row in `threads`. A just
 *     started session is live and invisible to the store.
 *   - a clean `/quit` DELETES the lock file.
 *   - `kill -9` LEAVES THE FILE BEHIND, and it probes free. So the presence of
 *     a lock file is NOT the signal; the held lock is. This is the whole
 *     reason `ended` has two roads into it below.
 *
 * ── THE TRAP THAT MAKES A PROBE REPORT "FREE" FOR EVERYTHING ──────────────
 *
 * `fs.constants.O_EXLOCK` and `fs.constants.O_SHLOCK` are **`undefined`** on
 * Node 22 / darwin. `O_RDONLY | O_NONBLOCK | constants.O_SHLOCK` is therefore
 * `0 | 4 | undefined === 4`, an ordinary non-blocking read that always
 * succeeds -- and a probe built on it answers "nothing is live" for a machine
 * with a live Codex on it. That was written, run, and believed here before a
 * controlled holder falsified it. The module uses the darwin literals and this
 * file pins them.
 *
 * ── WHY THIS FILE IS IN TWO HALVES ────────────────────────────────────────
 *
 * CI is `ubuntu-latest` (`.github/workflows/ci.yml`), and Linux has no
 * `O_SHLOCK` open flag at all. A single real-`flock` suite would SKIP on every
 * CI run and prove nothing there -- the shape this repo has already been
 * bitten by. So the decision is a pure function tested on every platform, and
 * the real syscall is a second suite that runs on darwin and is disclosed as
 * skipped elsewhere. The pure half is also what makes the non-darwin answer
 * (`unknown`, never `ended`) a tested fact rather than an accident.
 *
 * No fixture here comes from the operator's store: every lock file is created
 * by the test in its own temp directory, and every thread id is invented.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyProbe,
  DARWIN_O_NONBLOCK,
  DARWIN_O_SHLOCK,
  livenessOf,
  lockDirFor,
  lockPathFor,
  probeLockViaOpen,
} from '../../src/main/sources/codex/liveness.js';

const THREAD = '00000000-1111-2222-3333-444444444444';

describe('where a thread’s lock lives', () => {
  it('is the bare uuid plus .lock, under the home Codex was told to use', () => {
    expect(lockDirFor('/invented/home/.codex')).toBe('/invented/home/.codex/thread-writer-locks');
    expect(lockPathFor(THREAD, '/invented/home/.codex')).toBe(
      `/invented/home/.codex/thread-writer-locks/${THREAD}.lock`,
    );
  });

  // The thread id is read out of a database vam does not own. It is a uuid in
  // every row measured, and this is what happens on the day it is not.
  it('refuses to build a path out of anything that is not a bare uuid', () => {
    for (const hostile of [
      '../../../etc/passwd',
      'a/b',
      '',
      '00000000-1111-2222-3333-444444444444 ',
      'x'.repeat(200),
    ]) {
      expect(lockPathFor(hostile, '/invented/home/.codex')).toBeNull();
    }
  });
});

describe('classifyProbe -- the decision, on every platform', () => {
  it('reads a refused lock as a live Codex', () => {
    expect(classifyProbe({ platform: 'darwin', code: 'EAGAIN' })).toBe('live');
    // The same errno under its other spelling. macOS reports 35 for both.
    expect(classifyProbe({ platform: 'darwin', code: 'EWOULDBLOCK' })).toBe('live');
  });

  it('reads a lock it could take as ended -- the stale-file case', () => {
    expect(classifyProbe({ platform: 'darwin', code: null })).toBe('ended');
  });

  it('reads a missing lock file as ended too', () => {
    expect(classifyProbe({ platform: 'darwin', code: 'ENOENT' })).toBe('ended');
  });

  it('says unknown rather than ended when it was not allowed to look', () => {
    expect(classifyProbe({ platform: 'darwin', code: 'EACCES' })).toBe('unknown');
    expect(classifyProbe({ platform: 'darwin', code: 'EPERM' })).toBe('unknown');
    expect(classifyProbe({ platform: 'darwin', code: 'EINVAL' })).toBe('unknown');
  });

  /**
   * THE ONE THAT KEEPS THIS SUITE FROM BEING VACUOUS ON CI. Linux has no
   * `O_SHLOCK`; the same numeric flag is not a lock request there, so the open
   * would succeed against a live Codex and the probe would answer "ended" for
   * every thread on the machine. Refusing to guess is the only honest answer,
   * and `ended` is never it.
   */
  it('cannot tell on a platform without the flag, and says so', () => {
    for (const code of [null, 'ENOENT', 'EAGAIN']) {
      expect(classifyProbe({ platform: 'linux', code })).toBe('unknown');
      expect(classifyProbe({ platform: 'win32', code })).toBe('unknown');
    }
  });
});

describe('the flags the real probe opens with', () => {
  // Pinned by literal because the module cannot ask Node for them: see the
  // header. A wrong value here is a probe that answers "ended" for everything.
  it('are darwin’s own O_SHLOCK and O_NONBLOCK', () => {
    expect(DARWIN_O_SHLOCK).toBe(0x0010);
    expect(DARWIN_O_NONBLOCK).toBe(0x0004);
  });
});

describe('livenessOf', () => {
  it('asks the probe for the thread’s own lock', () => {
    const asked: string[] = [];
    const answer = livenessOf(
      THREAD,
      (path) => {
        asked.push(path);
        return 'live';
      },
      '/invented/home/.codex',
    );
    expect(answer).toBe('live');
    expect(asked).toEqual([`/invented/home/.codex/thread-writer-locks/${THREAD}.lock`]);
  });

  it('never probes at all for an id it would not build a path for', () => {
    let asked = 0;
    const answer = livenessOf(
      '../escape',
      () => {
        asked += 1;
        return 'live';
      },
      '/invented/home/.codex',
    );
    expect(answer).toBe('unknown');
    expect(asked).toBe(0);
  });
});

/**
 * The real syscall, against real `flock` holders. macOS only, and the `skip`
 * is disclosed rather than silent: on CI this whole block does not run and the
 * pure half above is what covers the decision.
 */
describe.skipIf(process.platform !== 'darwin')('a real flock, on darwin', () => {
  let dir = '';
  const held: number[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vam-codex-lock-'));
  });

  afterEach(() => {
    for (const pid of held.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });

  /** A child that takes an exclusive flock and sits on it, like Codex does. */
  const holdLock = (path: string): void => {
    const source = `
      import { openSync } from 'node:fs';
      openSync(${JSON.stringify(path)}, 0x0000 | 0x0020 | 0x0004);
      process.stdout.write('held');
      setTimeout(() => {}, 30000);
    `;
    const holder = join(dir, 'holder.mjs');
    writeFileSync(holder, source);
    // Spawned detached and waited on by its first byte of output, so the lock
    // is provably taken before the assertion runs.
    const child = execFileSync(
      process.execPath,
      [
        '-e',
        `
        const { spawn } = require('node:child_process');
        const c = spawn(process.execPath, [${JSON.stringify(holder)}], { stdio: ['ignore','pipe','ignore'] });
        c.stdout.once('data', () => { process.stdout.write(String(c.pid)); process.exit(0); });
      `,
      ],
      { encoding: 'utf8' },
    );
    held.push(Number(child.trim()));
  };

  it('calls a thread whose lock is held live', () => {
    const path = join(dir, `${THREAD}.lock`);
    writeFileSync(path, '');
    holdLock(path);
    expect(probeLockViaOpen()(path)).toBe('live');
  });

  /**
   * THE DISTINCTION THE WHOLE FEATURE RESTS ON. `kill -9` on a real Codex
   * leaves its lock file on disk -- measured -- and a reader that trusted the
   * file's existence would call a dead thread live forever.
   */
  it('calls a thread whose lock file survives its writer ended', () => {
    const path = join(dir, `${THREAD}.lock`);
    writeFileSync(path, '');
    holdLock(path);
    expect(probeLockViaOpen()(path)).toBe('live');
    for (const pid of held.splice(0)) process.kill(pid, 'SIGKILL');
    // Give the kernel the moment it needs to reap the fd.
    const deadline = Date.now() + 5000;
    let answer = probeLockViaOpen()(path);
    while (answer === 'live' && Date.now() < deadline) answer = probeLockViaOpen()(path);
    expect(existsSync(path)).toBe(true);
    expect(answer).toBe('ended');
  });

  it('calls a thread with no lock file at all ended', () => {
    expect(probeLockViaOpen()(join(dir, `${THREAD}.lock`))).toBe('ended');
  });

  /** And it must not CREATE one. vam does not write to Codex's home. */
  it('does not bring a lock file into existence by asking about it', () => {
    const path = join(dir, `${THREAD}.lock`);
    probeLockViaOpen()(path);
    expect(existsSync(path)).toBe(false);
  });
});
