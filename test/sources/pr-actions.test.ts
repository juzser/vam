/**
 * THE TWO THINGS THE PRs TAB CAN DO TO A REAL REPOSITORY, and the bounds on
 * them.
 *
 * Everything else vam's `gh` integration does is a READ. These are not: they
 * act on the operator's own repositories with the operator's own credentials,
 * and neither of them can be undone from inside vam. So this file is mostly
 * about what must NOT happen -- the flags that must never appear, the argument
 * shapes that must be refused before a process is spawned, and the second
 * click that must be turned away rather than run twice.
 *
 * THE SPAWN IS NOT TESTED HERE, and cannot be: running it would merge a real
 * pull request. `pull-requests.ts` is split for exactly this reason and this
 * module is split the same way -- argv construction, argument validation,
 * failure classification and the in-flight guard are pure, and are what this
 * file exercises. `runPrActionViaCli` is the thin remainder.
 *
 * Every fixture below is invented. No repository, branch or number here is
 * real.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  checkBranchName,
  checkPrNumber,
  classifyPrActionFailure,
  createPrActionRunner,
  MERGE_METHODS,
  prDeleteBranchArgv,
  prMergeArgv,
} from '../../src/main/sources/claude-code/pr-actions.js';

describe('the argv for a merge', () => {
  it('names the number, one explicit method, and nothing else', () => {
    const argv = prMergeArgv(411, 'squash');
    expect(argv[0]).toBe('pr');
    expect(argv[1]).toBe('merge');
    // The number is ONE element, stringified -- never interpolated into a
    // sentence -- exactly as the reader carries a branch name.
    expect(argv[2]).toBe('411');
    expect(argv).toContain('--squash');
  });

  it('spells every method gh has, and each one exactly once', () => {
    expect([...MERGE_METHODS]).toEqual(['squash', 'merge', 'rebase']);
    expect(prMergeArgv(1, 'merge')).toContain('--merge');
    expect(prMergeArgv(1, 'rebase')).toContain('--rebase');
    for (const method of MERGE_METHODS) {
      const argv = prMergeArgv(7, method);
      const flags = argv.filter((a) => ['--squash', '--merge', '--rebase'].includes(a));
      // Exactly one strategy. Two would be gh's error, and none would make gh
      // PROMPT -- which, spawned with no terminal, is a hang rather than an
      // answer.
      expect(flags).toHaveLength(1);
    }
  });

  /**
   * THE FLAGS THAT MUST NEVER BE THERE, asserted by name rather than by
   * reading the list, because this is the assertion that has to survive
   * somebody adding an option in good faith.
   *
   * `--admin` merges a pull request that does not meet the repository's own
   * requirements -- it is the operator's branch protection being overridden by
   * a button in a side panel. `--auto` is worse in a quieter way: it reports
   * success and merges LATER, possibly hours later, with nobody watching.
   */
  it('never uses administrator privileges, auto-merge, or a head-commit override', () => {
    for (const method of MERGE_METHODS) {
      const argv = prMergeArgv(411, method);
      expect(argv).not.toContain('--admin');
      expect(argv).not.toContain('--auto');
      expect(argv).not.toContain('--disable-auto');
      expect(argv).not.toContain('--match-head-commit');
      // And it does not delete the branch as a side effect: that is the
      // operator's second, separately confirmed decision.
      expect(argv).not.toContain('--delete-branch');
      expect(argv).not.toContain('-d');
      // No repository override: which repository is acted on is decided by the
      // working directory, exactly as the reader decides which one it asks.
      expect(argv).not.toContain('--repo');
    }
  });
});

describe('the argv for deleting a branch', () => {
  /**
   * `gh` HAS NO `pr delete-branch` SUBCOMMAND -- measured against
   * `gh pr --help` on this machine (gh 2.95.0): the only delete-branch there
   * is is a FLAG on `gh pr merge`, which is the thing this action deliberately
   * is not. So the ref is deleted through the API, and `{owner}`/`{repo}` are
   * gh's OWN placeholders: gh fills them from the repository of the working
   * directory, which keeps the reader's rule -- the cwd decides which
   * repository is acted on, never a name vam composed.
   */
  it('deletes the ref through gh api, with gh resolving the repository itself', () => {
    const argv = prDeleteBranchArgv('feature/panel-rework');
    expect(argv[0]).toBe('api');
    expect(argv).toContain('--method');
    expect(argv[argv.indexOf('--method') + 1]).toBe('DELETE');
    expect(argv).toContain('repos/{owner}/{repo}/git/refs/heads/feature/panel-rework');
    expect(argv).not.toContain('--repo');
  });

  it('refuses a branch name that could climb out of the ref path', () => {
    // THE REAL DANGER, and it is not theoretical: the endpoint is a PATH, and
    // `..` in it is resolved by the HTTP client, not by gh. A branch called
    // `../../../../repos/someone/else/git/refs/heads/main` would address a ref
    // in a DIFFERENT REPOSITORY. The renderer chooses this string, so main
    // refuses it here, before anything is spawned.
    for (const bad of [
      '../../../../repos/someone/else/git/refs/heads/main',
      'feature/../..',
      '..',
      'a/../b',
    ]) {
      expect(checkBranchName(bad).ok).toBe(false);
    }
  });

  it('refuses a branch name that is empty, huge, or not a branch name at all', () => {
    for (const bad of ['', '   ', '-delete-everything', '/leading', 'trailing/', 'a b', 'a\nb']) {
      expect(checkBranchName(bad).ok).toBe(false);
    }
    expect(checkBranchName('x'.repeat(500)).ok).toBe(false);
    expect(checkBranchName(null).ok).toBe(false);
    expect(checkBranchName(42).ok).toBe(false);
    // And it says WHY, in a sentence meant to be drawn.
    const refusal = checkBranchName('a b');
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.reason.length).toBeGreaterThan(10);
  });

  it('accepts the branch names vam actually sees', () => {
    for (const good of [
      'main',
      'feature/panel-rework',
      'smith/vam/0.2-tab-shell',
      'release_1.2.3',
      'fix-411',
    ]) {
      const outcome = checkBranchName(good);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.branch).toBe(good);
    }
  });
});

describe('the pull request number is validated before anything runs', () => {
  it('takes a positive whole number and nothing else', () => {
    expect(checkPrNumber(411)).toEqual({ ok: true, number: 411 });
    for (const bad of [
      0,
      -1,
      1.5,
      Number.NaN,
      '411',
      null,
      undefined,
      Number.MAX_SAFE_INTEGER + 2,
    ]) {
      expect(checkPrNumber(bad).ok).toBe(false);
    }
  });
});

describe('a failure surfaces the CLI’s own words', () => {
  const classify = (over: Partial<Parameters<typeof classifyPrActionFailure>[0]> = {}) =>
    classifyPrActionFailure({
      failure: { message: 'Command failed' },
      stderr: '',
      what: 'merge #411',
      ...over,
    });

  it('quotes stderr rather than replacing it with a house sentence', () => {
    const outcome = classify({
      stderr:
        'X Pull request #411 is not mergeable: the base branch policy prohibits the merge.\nTo have the pull request merged after all the requirements have been met, add the `--auto` flag.',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain('the base branch policy prohibits the merge');
      expect(outcome.code).toBe('gh-failed');
    }
  });

  it('keeps a missing gh and a timeout as their own distinct states', () => {
    const missing = classify({ failure: { message: 'spawn gh ENOENT', code: 'ENOENT' } });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('cli-missing');

    const slow = classify({ failure: { message: 'killed', killed: true } });
    expect(slow.ok).toBe(false);
    if (!slow.ok) expect(slow.code).toBe('timed-out');
  });

  it('never republishes the argv when gh said nothing', () => {
    // `deliver.ts`'s rule and the reader's: node builds `failure.message` as
    // "Command failed: <file> <args>", which would put the whole command line
    // into a message the operator can copy into a public issue.
    const outcome = classify({
      failure: { message: 'Command failed: gh pr merge 411 --squash' },
      stderr: '',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).not.toContain('--squash');
      expect(outcome.message).toContain('merge #411');
    }
  });

  it('clips what it quotes, so one runaway stderr cannot become the whole pane', () => {
    const outcome = classify({ stderr: 'x'.repeat(5_000) });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message.length).toBeLessThan(1_000);
  });
});

describe('an action is a one-shot, and it is never re-entrant', () => {
  it('refuses a second action aloud while the first is still running', async () => {
    let release = (_: { ok: true; message: string }) => {};
    const run = vi.fn(
      () => new Promise<{ ok: true; message: string }>((resolve) => (release = resolve)),
    );
    const act = createPrActionRunner(run);

    const first = act({ cwd: '/repo', action: { kind: 'merge', number: 411, method: 'squash' } });
    const second = act({ cwd: '/repo', action: { kind: 'merge', number: 411, method: 'squash' } });

    const refused = await second;
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('busy');
      // ALOUD. A silently dropped second click is indistinguishable from a
      // button that does not work.
      expect(refused.message).toMatch(/already/i);
    }
    // And the second click spawned NOTHING.
    expect(run).toHaveBeenCalledTimes(1);

    release({ ok: true, message: 'merged' });
    expect(await first).toEqual({ ok: true, message: 'merged' });
  });

  it('refuses a second action on a DIFFERENT pull request too', async () => {
    // The guard is about vam having one write in flight, not about one row.
    // Two merges racing in one repository is the case that would leave the
    // operator unable to say which of them the answer belonged to.
    let release = (_: { ok: true; message: string }) => {};
    const run = vi.fn(
      () => new Promise<{ ok: true; message: string }>((resolve) => (release = resolve)),
    );
    const act = createPrActionRunner(run);

    const first = act({ cwd: '/repo', action: { kind: 'merge', number: 411, method: 'squash' } });
    const second = await act({
      cwd: '/other',
      action: { kind: 'delete-branch', branch: 'feature/x' },
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('busy');
    expect(run).toHaveBeenCalledTimes(1);

    release({ ok: true, message: 'merged' });
    await first;
  });

  it('lets the next action through once the first has finished, success or failure', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: 'gh-failed', message: 'it did not merge' })
      .mockResolvedValueOnce({ ok: true, message: 'merged' });
    const act = createPrActionRunner(run);

    const failed = await act({
      cwd: '/repo',
      action: { kind: 'merge', number: 411, method: 'squash' },
    });
    expect(failed.ok).toBe(false);
    // THE LOCK MUST NOT SURVIVE THE FAILURE. A guard that only released on
    // success would make one bad merge disable every action for the rest of
    // the session, and it would do it silently.
    const next = await act({
      cwd: '/repo',
      action: { kind: 'merge', number: 411, method: 'squash' },
    });
    expect(next).toEqual({ ok: true, message: 'merged' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('releases the lock when the runner THROWS, and turns the throw into a sentence', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('something nobody foresaw'))
      .mockResolvedValueOnce({ ok: true, message: 'merged' });
    const act = createPrActionRunner(run);

    const thrown = await act({
      cwd: '/repo',
      action: { kind: 'delete-branch', branch: 'feature/x' },
    });
    expect(thrown.ok).toBe(false);
    if (!thrown.ok) expect(thrown.message).toContain('something nobody foresaw');

    const next = await act({
      cwd: '/repo',
      action: { kind: 'delete-branch', branch: 'feature/x' },
    });
    expect(next.ok).toBe(true);
  });
});
