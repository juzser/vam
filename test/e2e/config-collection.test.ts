import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the defect this repo already shipped once: a Playwright config's
 * `testMatch` silently widening to collect a spec it was never meant to run.
 *
 * `playwright.reconnect.config.ts`'s `testMatch` used to be the suffix glob
 * `**\/*.pw.ts`. That collected exactly one file the day it was written, and
 * then silently swept up a second one -- `phone-shell.pw.ts` -- the day that
 * file was added, sending 18 tests with no server behind them into a config
 * that declares none on purpose. A test that reads `testMatch` as a string
 * and checks its literal value would have stayed green through that whole
 * regression: the string still says `**\/*.pw.ts` was intended to be narrow,
 * it just silently stopped being narrow in practice. Only asking Playwright
 * itself what a config resolves to catches that.
 *
 * `--list --reporter=json` performs Playwright's real test collection --
 * the same file-matching logic `playwright test` uses to decide what to run
 * -- without launching a browser or a webServer, so it is safe to run here
 * in a vitest process.
 *
 * THIS SUITE DOES NOT RUN IN CI TODAY. `@playwright/test` is a dependency of
 * no `package.json` in this repo, and `e2e/` has no `package.json` of its
 * own -- the harness at `e2e/node_modules` exists only as a hand-made
 * install on the machines that happen to have run it, symlinked into by the
 * worktrees that share it. A fresh clone (and `.github/workflows/ci.yml`,
 * which runs `pnpm test`) has no such binary, so this suite self-skips with
 * a named reason rather than false-failing or false-passing -- same
 * precedent as `e2e/sse-drop-reconnect.pw.ts`'s and `e2e/sse-drop.spec.ts`'s
 * own env-var skips. Until `@playwright/test` is a real, installed
 * dependency somewhere `pnpm test` can see, this guard only protects the
 * machines where the harness already happens to exist -- which is not
 * nothing (this repo has exactly one such machine today), but it is not CI.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const playwrightBin = path.join(repoRoot, 'e2e', 'node_modules', '.bin', 'playwright');
const harnessInstalled = existsSync(playwrightBin);

interface ListedSuite {
  file: string;
}

function collectedFiles(configName: string): string[] {
  const result = spawnSync(
    playwrightBin,
    ['test', `--config=e2e/${configName}`, '--list', '--reporter=json'],
    { cwd: repoRoot, encoding: 'utf-8', timeout: 30_000 },
  );
  // `result.error` (spawn itself failed -- e.g. the binary vanished between
  // the existsSync check and the spawn) is checked before `result.status`:
  // on a killed or unspawnable child, `status` is `null`, which is
  // ambiguous with a clean-but-signalled exit, so branching on status alone
  // would mask the real cause. `result.error` and `result.stderr` are
  // included so a genuine failure here is diagnosable, not just "it broke".
  if (result.error) {
    throw new Error(
      `playwright --list did not run for ${configName}: ${result.error.message}\nstderr: ${result.stderr}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `playwright --list exited ${result.status} for ${configName}\nstderr: ${result.stderr}`,
    );
  }
  const parsed = JSON.parse(result.stdout) as { suites: ListedSuite[] };
  return [...new Set(parsed.suites.map((s) => s.file))].sort();
}

describe.skipIf(!harnessInstalled)(
  'e2e Playwright config collection (real --list, not a testMatch string read)',
  () => {
    it('the default config collects exactly the three .spec.ts specs', () => {
      expect(collectedFiles('playwright.config.ts')).toEqual([
        'branch-overlap.spec.ts',
        'pane-resize.spec.ts',
        'sse-drop.spec.ts',
      ]);
    });

    it('the reconnect config collects exactly its own spec, and nothing that arrived after it', () => {
      expect(collectedFiles('playwright.reconnect.config.ts')).toEqual([
        'sse-drop-reconnect.pw.ts',
      ]);
    });

    it('the phone config collects exactly its own spec', () => {
      expect(collectedFiles('playwright.phone.config.ts')).toEqual(['phone-shell.pw.ts']);
    });

    it('the electron config collects exactly its own spec', () => {
      expect(collectedFiles('playwright.electron.config.ts')).toEqual(['electron-launch.et.ts']);
    });
  },
);

if (!harnessInstalled) {
  // `describe.skipIf` reports the whole block as skipped without a reason
  // string in the default reporter output; this makes the "why" visible in
  // the same run rather than only in this file's own header comment.
  describe('e2e Playwright config collection', () => {
    it.skip('e2e/node_modules is not installed and @playwright/test is not a declared dependency -- see file header', () => {});
  });
}
