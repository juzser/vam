import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ONE HELPER (or, for `e2e/electron-launch.et.ts`, the identical inline
 * mechanism -- see that file's own header for why it does not import
 * across the `e2e/`/root-`test/` boundary), AND NOTHING ELSE MAY LAUNCH A
 * REAL ELECTRON PROCESS WITHOUT IT.
 *
 * THE EVIDENCE THIS GUARDS: `test/electron/launch.test.ts` and its siblings
 * spawn a REAL `electron` binary, and `e2e/electron-launch.et.ts` launches
 * the packaged app through Playwright's `_electron` -- and until this fix,
 * none of them redirected tmux's own socket resolution. vam's Terminal
 * machinery (`createControlTmuxRunner`, `src/main/sources/tmux/control.ts`)
 * then opened its `-C new-session -A -s vamctl` control connection against
 * the OPERATOR'S REAL default tmux server: measured directly on the
 * operator's own machine, a `vamctl` session with a pane cwd inside an
 * agent's worktree, sitting on the same server that hosts the operator's own
 * live `vam-*` sessions and, if their real app happened to be open, their
 * own `vamctl` -- `-A` ATTACHES to an existing session by that name rather
 * than refusing.
 *
 * `TMUX_TMPDIR` (`test/support/tmux-harness-env.ts`'s `isolatedTmuxEnv`) is
 * the fix: every tmux entry point vam's production code has inherits the
 * launched process's OWN environment (neither `createTmuxRunner`'s
 * `execFile` nor `createControlTmuxRunner`'s `spawn` passes an explicit
 * `env`), so setting it on the harness's own spawn/launch redirects every
 * tmux call the app makes to a private socket, with zero production code
 * touched.
 *
 * THE SWEEP BELOW IS THE GUARD FOR THE GUARD, the same discipline
 * `test/e2e/tmux-socket-guard.test.ts` already applies to `e2e/`'s own
 * real-tmux `.mjs` scripts: it does not merely trust that every launcher
 * remembered to call `isolatedTmuxEnv`/set `TMUX_TMPDIR` once -- it finds
 * every file that actually spawns a real `electron` binary or launches one
 * through Playwright's `_electron`, by content, and asserts EACH one carries
 * the isolation. A CORPUS FLOOR too (`a sweep must prove it found a
 * corpus`): the sweep asserts it found more than zero launcher files before
 * trusting a clean result from it, and separately pins the exact set it
 * expects, so a launcher that stops matching the detection pattern (a
 * rename, a refactor to a helper the sweep does not recognise) still fails
 * loudly rather than silently dropping out of the corpus.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Block comments, then line comments -- `test/e2e/tmux-socket-guard.test.ts`'s
 *  own order and its own reason: a `//` inside a `/* ... *\/` block would cut
 *  the block comment short if line comments were stripped first. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function walk(dir: string, pattern: RegExp, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, pattern, out);
    } else if (pattern.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Every file under `test/electron/`, `test/app/` and `e2e/` that could
 *  possibly launch a real Electron process -- the CANDIDATE corpus, before
 *  it is narrowed to the ones that actually do. */
function candidateFiles(): string[] {
  return [
    ...walk(path.join(REPO_ROOT, 'test', 'electron'), /\.test\.ts$/),
    ...walk(path.join(REPO_ROOT, 'test', 'app'), /\.test\.tsx?$/),
    ...walk(path.join(REPO_ROOT, 'e2e'), /\.(et|pw|spec)\.ts$/),
  ];
}

/** The shape a REAL Electron launch has in this repo, whichever of the two
 *  styles it uses: `spawn(bin('electron'), ...)` (every `test/electron/
 *  *.test.ts` harness) or Playwright's `_electron`/`electron.launch(...)`
 *  (`e2e/electron-launch.et.ts`). */
const LAUNCHES_ELECTRON = /spawn\(\s*bin\(['"]electron['"]\)|_electron|electron\.launch\(/;

/** The isolation itself, after comments are stripped -- a call to the
 *  shared helper (the four `test/electron/*.test.ts` files) or the literal
 *  env-key assignment `e2e/electron-launch.et.ts`'s own inline mechanism
 *  uses. Either is `TMUX_TMPDIR` reaching the launched process's env. */
const ISOLATES_TMUX = /isolatedTmuxEnv\(|TMUX_TMPDIR\s*:/;

/** This file itself -- excluded from its own sweep for the same reason
 *  `test/e2e/tmux-socket-guard.test.ts` excludes its own helper module: its
 *  OWN prose and regex literals name `_electron`/`electron.launch(` to
 *  describe the pattern being swept for, which would otherwise self-match
 *  as a "launcher" that carries no isolation of its own -- it launches
 *  nothing. */
const SELF = path.relative(REPO_ROOT, path.resolve(__dirname, 'tmux-isolation-guard.test.ts'));

function launcherFiles(): string[] {
  const candidates = candidateFiles();
  return candidates.filter((file) => {
    if (path.relative(REPO_ROOT, file) === SELF) return false;
    return LAUNCHES_ELECTRON.test(readFileSync(file, 'utf8'));
  });
}

describe('every real Electron launch isolates tmux from the operator’s default server', () => {
  it('sweeps a real corpus and finds at least one real-Electron-launching file', () => {
    const candidates = candidateFiles();
    expect(candidates.length, 'the sweep must examine a real corpus').toBeGreaterThan(10);
    const launchers = launcherFiles();
    expect(launchers.length, 'the sweep must find at least one launcher').toBeGreaterThan(0);
  });

  it('every file that launches a real Electron process isolates tmux via TMUX_TMPDIR', () => {
    const offenders: string[] = [];
    for (const file of launcherFiles()) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (!ISOLATES_TMUX.test(code)) {
        offenders.push(path.relative(REPO_ROOT, file).replace(/\\/g, '/'));
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('finds exactly the five launchers this fix isolated, by name', () => {
    const expected = [
      'e2e/electron-launch.et.ts',
      'test/electron/getting-started-image.test.ts',
      'test/electron/launch.test.ts',
      'test/electron/settings-update.test.ts',
      'test/electron/userdata-isolation.test.ts',
    ];
    const found = launcherFiles()
      .map((file) => path.relative(REPO_ROOT, file).replace(/\\/g, '/'))
      .sort();
    expect(found).toEqual(expected);
  });
});
