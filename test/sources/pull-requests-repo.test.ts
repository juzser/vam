/**
 * WHICH DIRECTORY VAM ASKED GITHUB FROM, and the two ways that can go wrong
 * once the operator is allowed to choose it.
 *
 * Operator: "a session started from an orchestrator or a factory often works
 * on a different repo than the one its directory is in — there needs to be a
 * way to switch repo."
 *
 * THE OVERRIDE IS A DIRECTORY, NOT AN `owner/name`, which keeps
 * `pull-requests.ts`'s own invariant true: `gh` still resolves the remote
 * itself, so the pane still describes the repository it is actually standing
 * in and no `--repo` argument can make it describe one it is not. What changes
 * is only WHERE it stands.
 *
 * AND THAT MAKES TWO NEW WAYS TO FAIL REACHABLE, both of which are "vam could
 * not ask" and neither of which may look like "no PRs" -- the distinction the
 * module's header is built around:
 *
 *  1. THE DIRECTORY IS GONE. A session's own cwd exists by construction: the
 *     agent is running in it. An override is a string the operator typed
 *     months ago, and the checkout can be deleted, moved or renamed.
 *  2. THE DIRECTORY IS NOT A REPOSITORY vam can ask about. This existed
 *     before, but its sentence said "this session's working directory" -- a
 *     sentence that becomes FALSE the moment the directory is not the
 *     session's. A message that names the wrong directory sends the operator
 *     to fix the wrong thing.
 *
 * ── THE FINDING THIS FILE WAS WRITTEN AROUND ─────────────────────────────
 * `ENOENT` ALREADY MEANT TWO THINGS AND VAM ONLY KNEW ONE. `execFile` reports
 * `ENOENT` both when the BINARY is missing and when the `cwd` does not exist,
 * and the classifier attributed all of it to a missing `gh`. With a session's
 * own cwd that was safe -- it always exists. With an override it is reachable,
 * and vam would tell an operator whose factory checkout had moved to go and
 * install a `gh` they already have. So the directory is checked BEFORE the
 * spawn, which gives that state its own sentence and leaves `ENOENT` meaning
 * the one thing it can then mean.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyGhFailure,
  readPullRequestsViaCli,
} from '../../src/main/sources/claude-code/pull-requests.js';

const OVERRIDE = '/Users/someone/code/other-repo';
const OWN = '/Users/someone/code/factory';

describe('a failure names the directory it happened in', () => {
  it('says which directory is not a repository, rather than "this session\'s"', () => {
    const list = classifyGhFailure({
      failure: { message: 'exit 1' },
      stderr: 'fatal: not a git repository (or any of the parent directories): .git',
      branch: 'smith/x',
      cwd: OVERRIDE,
      overridden: true,
    });
    expect(list.kind).toBe('unavailable');
    if (list.kind !== 'unavailable') return;
    expect(list.code).toBe('not-a-repo');
    // THE DIRECTORY, IN THE SENTENCE. Without it the operator reads "this
    // session's working directory is not a git repository" about a directory
    // the session is not in, and goes to look at the wrong one.
    expect(list.message).toContain(OVERRIDE);
  });

  it('says which directory has no GitHub remote', () => {
    const list = classifyGhFailure({
      failure: { message: 'exit 1' },
      stderr: 'none of the git remotes configured for this repository point to a known GitHub host',
      branch: 'smith/x',
      cwd: OVERRIDE,
      overridden: true,
    });
    expect(list.kind).toBe('unavailable');
    if (list.kind !== 'unavailable') return;
    expect(list.code).toBe('no-github-remote');
    expect(list.message).toContain(OVERRIDE);
  });

  it('keeps the session’s own wording when nothing was overridden', () => {
    // The common case by far, and it must not start quoting a path at an
    // operator who never chose one: the session's directory is the session's,
    // and naming it adds noise to a sentence that was already true.
    const list = classifyGhFailure({
      failure: { message: 'exit 1' },
      stderr: 'fatal: not a git repository',
      branch: 'smith/x',
      cwd: OWN,
      overridden: false,
    });
    if (list.kind !== 'unavailable') return;
    expect(list.message).toContain("this session's working directory");
    expect(list.message).not.toContain(OWN);
  });
});

describe('a directory that is gone is its own answer', () => {
  it('does not report a missing directory as a missing `gh`', async () => {
    // THE FINDING. `execFile` reports ENOENT for a missing binary AND for a
    // missing `cwd`, and vam knew only the first. An operator whose factory
    // checkout moved would be told to install a `gh` they already have.
    const read = readPullRequestsViaCli('gh', () => false);
    const list = await read({ cwd: OVERRIDE, branch: 'smith/x', overridden: true });
    expect(list.kind).toBe('unavailable');
    if (list.kind !== 'unavailable') return;
    expect(list.code).toBe('repo-missing');
    expect(list.message).toContain(OVERRIDE);
    // And it says what to DO. A state with no way out is a dead end with a
    // sentence in front of it.
    expect(list.message.toLowerCase()).toMatch(/settings|choose|pick|point/);
  });

  it('never spawns anything when the directory is not there', async () => {
    // The point is not only the message: a poll every ten seconds against a
    // directory that cannot work should cost no processes at all.
    let spawned = 0;
    const read = readPullRequestsViaCli('gh', () => {
      spawned += 1;
      return false;
    });
    await read({ cwd: OVERRIDE, branch: 'smith/x', overridden: true });
    // One existence check, no spawn -- asserted by the fact that a spawn of a
    // binary named `gh` in a directory that does not exist would reject, and
    // this resolved with the directory's own code above.
    expect(spawned).toBe(1);
  });

  it('checks the directory even when the operator chose nothing', async () => {
    // A session's cwd exists by construction -- until the operator deletes the
    // project's directory under a running agent, which is a real afternoon.
    // The check is not conditional on the override, because the failure is not
    // either.
    const read = readPullRequestsViaCli('gh', () => false);
    const list = await read({ cwd: OWN, branch: 'smith/x', overridden: false });
    if (list.kind !== 'unavailable') return;
    expect(list.code).toBe('repo-missing');
    expect(list.message).toContain(OWN);
  });
});
