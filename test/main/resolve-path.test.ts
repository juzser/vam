/** `src/main/env/resolve-path.ts` -- the login-shell PATH probe. `probe` is always injected. */

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyLoginShellPath,
  dedupe,
  fallbackDirs,
  parseProbeOutput,
  probeLoginShellPath,
  resolveLoginShellPath,
  splitPath,
} from '../../src/main/env/resolve-path.js';

const HOME = '/home/op';

describe('splitPath / dedupe / parseProbeOutput / fallbackDirs', () => {
  it('splitPath drops empty segments', () => {
    expect(splitPath(':/a::/b:')).toEqual(['/a', '/b']);
    expect(splitPath('')).toEqual([]);
  });

  it('dedupe keeps only the first occurrence, preserving order', () => {
    expect(dedupe(['/a', '/b', '/a', '/c', '/b'])).toEqual(['/a', '/b', '/c']);
  });

  it('parseProbeOutput extracts the path between markers, ignoring rc-file noise', () => {
    expect(parseProbeOutput('__VAM_PATH_START__/a:/b__VAM_PATH_END__')).toBe('/a:/b');
    const noisy = 'nvm is using node v20\n__VAM_PATH_START__/a:/b__VAM_PATH_END__\nmotd\n';
    expect(parseProbeOutput(noisy)).toBe('/a:/b');
  });

  it('parseProbeOutput returns null when markers are missing, partial or empty', () => {
    expect(parseProbeOutput('/a:/b\n')).toBeNull();
    expect(parseProbeOutput('__VAM_PATH_START__/a:/b')).toBeNull();
    expect(parseProbeOutput('__VAM_PATH_START____VAM_PATH_END__')).toBeNull();
  });

  it('fallbackDirs includes the Claude Code default and the Homebrew/local prefixes', () => {
    const dirs = fallbackDirs(HOME);
    expect(dirs).toContain(`${HOME}/.local/bin`);
    expect(dirs).toContain('/opt/homebrew/bin');
    expect(dirs).toContain('/usr/local/bin');
  });
});

describe('resolveLoginShellPath', () => {
  it('merges a successful probe onto the current PATH', async () => {
    const result = await resolveLoginShellPath({
      currentPath: '/usr/bin:/bin',
      shell: '/bin/zsh',
      home: HOME,
      probe: async () => '/opt/homebrew/bin:/usr/bin',
    });
    const entries = result.split(':');
    expect(entries).toEqual(expect.arrayContaining(['/usr/bin', '/bin', '/opt/homebrew/bin']));
  });

  it('never drops an entry the process already had', async () => {
    const result = await resolveLoginShellPath({
      currentPath: '/some/custom/launcher-set/dir',
      shell: undefined,
      home: HOME,
      probe: async () => {
        throw new Error('must not be called');
      },
    });
    expect(result.split(':')).toContain('/some/custom/launcher-set/dir');
  });

  it('de-duplicates entries present in more than one source', async () => {
    const result = await resolveLoginShellPath({
      currentPath: '/usr/local/bin:/usr/bin',
      shell: '/bin/zsh',
      home: HOME,
      probe: async () => '/usr/local/bin:/opt/homebrew/bin',
    });
    expect(result.split(':').filter((e) => e === '/usr/local/bin')).toHaveLength(1);
  });

  it.each([
    // A probe returning `null` is what a timeout, an error, or unparseable
    // output all reduce to (see `probeLoginShellPath`'s own tests below).
    ['no $SHELL', undefined as string | undefined],
    ['an empty $SHELL', ''],
    ['a probe that fails/times out/returns junk', '/bin/zsh'],
  ])('falls back to the fixed directory list with %s', async (_label, shell) => {
    const result = await resolveLoginShellPath({
      currentPath: '/usr/bin',
      shell,
      home: HOME,
      probe: async () => null,
    });
    expect(result.split(':')).toEqual(
      expect.arrayContaining(['/usr/bin', `${HOME}/.local/bin`, '/opt/homebrew/bin']),
    );
  });
});

describe('probeLoginShellPath', () => {
  // A fake shell binary, never a real login shell -- same pattern as `test/sources/claude-code.test.ts`'s fake `claude`.
  let binRoot: string;

  beforeEach(() => {
    binRoot = mkdtempSync(join(tmpdir(), 'vam-fake-shell-'));
  });

  afterEach(() => {
    rmSync(binRoot, { recursive: true, force: true });
  });

  const fakeShell = (body: string): string => {
    const path = join(binRoot, 'fake-shell');
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  };

  it('invokes the shell with -ilc as the first argument', async () => {
    const flagFile = join(binRoot, 'flag');
    const shell = fakeShell(`printf '%s' "$1" > "${flagFile}"`);
    await probeLoginShellPath(shell);
    expect(readFileSync(flagFile, 'utf8')).toBe('-ilc');
  });

  it('reads a real PATH back out through the markers', async () => {
    const shell = fakeShell('PATH=/from/fake/shell; eval "$2"');
    expect(await probeLoginShellPath(shell)).toBe('/from/fake/shell');
  });

  it('resolves null when the shell does not exist', async () => {
    expect(await probeLoginShellPath(join(binRoot, 'does-not-exist'))).toBeNull();
  });

  it('resolves null, bounded, when the shell hangs past the timeout', async () => {
    const shell = fakeShell('sleep 10');
    const started = Date.now();
    expect(await probeLoginShellPath(shell)).toBeNull();
    expect(Date.now() - started).toBeLessThan(9_000);
  }, 10_000);

  it('resolves null when the shell exits non-zero', async () => {
    expect(await probeLoginShellPath(fakeShell('exit 1'))).toBeNull();
  });
});

describe('applyLoginShellPath', () => {
  it('mutates env.PATH with the merged result on macOS/Linux', async () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    await applyLoginShellPath(env, {
      platform: 'darwin',
      home: HOME,
      probe: async () => '/opt/homebrew/bin',
    });
    expect(env.PATH?.split(':')).toEqual(expect.arrayContaining(['/usr/bin', '/opt/homebrew/bin']));
  });

  it('leaves PATH untouched on win32, never calling the probe', async () => {
    const env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows\\System32' };
    await applyLoginShellPath(env, {
      platform: 'win32',
      home: HOME,
      probe: async () => {
        throw new Error('must not be called on Windows');
      },
    });
    expect(env.PATH).toBe('C:\\Windows\\System32');
  });
});
