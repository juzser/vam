/**
 * Phase 2a's own addition (`docs/design/worktrees.md`'s phase-2 list): a
 * dirty flag and an ahead/behind count per worktree, fetched SEPARATELY from
 * `listWorktrees` -- see `shared/worktree.ts`'s `WorktreeStatus` header for
 * why this is its own round trip rather than folded into `list()`'s answer.
 *
 * TWO GIT CALLS PER WORKTREE, EACH `cwd`-SCOPED TO THAT WORKTREE'S OWN
 * DIRECTORY (never `repoRoot` -- a worktree's dirty state and its own
 * upstream are per-CHECKOUT facts, not per-repository ones):
 *
 *  - `git -c core.fsmonitor=false --no-optional-locks status --porcelain=v1
 *    -z` -- WITH untracked files, deliberately. Measured against this very
 *    repository before choosing: 26ms including untracked files vs. 16ms
 *    with `--untracked-files=no` -- both far under any cadence this feature
 *    polls at (`useWorktreeStatuses.ts`'s own 20s), so the plainer, more
 *    complete form (an untracked file left in a worktree is not "clean" to
 *    an operator asking "did I leave something here") wins without needing
 *    the faster flag at all.
 *
 *    SECURITY REVIEW FINDING (S2): `git status` runs UNATTENDED, every 20s,
 *    with `cwd` inside a worktree this module has proven is real but NOT
 *    trusted content -- an adopted worktree's own `.git`/config is read by
 *    `git` itself before `status` ever answers. A planted `core.fsmonitor`
 *    (an arbitrary executable, invoked BY `git status` to answer "what
 *    might have changed") turns every recurring poll into a script vam
 *    itself fires. FALSIFIED, MEASURED (not argued): a real repo with
 *    `core.fsmonitor` set to a script that touches a marker file has that
 *    marker appear after a bare `git status --porcelain=v1 -z`, and NOT
 *    appear once `-c core.fsmonitor=false` is added -- `status.test.ts`'s
 *    own "fsmonitor hook" suite has both directions. `--no-optional-locks`
 *    alone does NOT stop it (measured the same way) -- it exists for a
 *    DIFFERENT reason: it stops this poll from taking `index.lock` at all,
 *    so a 20s background read never races the operator's own foreground
 *    `git` over that lock. Both are per-call argv (`-c`, never written to
 *    any `.git/config`), so neither ever survives past this one spawn.
 *
 *    RESIDUAL RISK, ACCEPTED: `-c core.fsmonitor=false` closes the ONE hook
 *    `git status` itself consults for "what changed" before answering. It
 *    does not disable every hook a full index refresh can still run under
 *    some configurations (a `filter.<driver>.clean` on a tracked path, for
 *    instance) -- closing every one of those would mean not running `git
 *    status` in an untrusted worktree at all, which is a larger change than
 *    this review round asked for. Accepted because the operator's own shell
 *    prompt and IDE already run plain `git status` inside the same
 *    worktrees on the same cadence class (seconds, not this feature's own
 *    20s) -- vam's unattended poll is not a NEW exposure, only one MORE
 *    caller of a surface the operator's own tooling already exercises.
 *  - `git rev-list --left-right --count @{u}...HEAD` -- `<behind>\t<ahead>`
 *    in that order (`--left-right`'s own convention: `@{u}` is the LEFT
 *    side of `...`). Fails outright when the worktree has no upstream
 *    configured, which is equally true of a DETACHED `HEAD` (no branch,
 *    hence no upstream either) -- caught and read as "cannot say", the
 *    same `null` reading `WorktreeInfo.branch` already gives. NEITHER FLAG
 *    ABOVE APPLIES HERE: `rev-list` walks the commit graph alone -- it
 *    never builds a working-tree diff, so it never consults `core.
 *    fsmonitor` (a status-family concept) at all, and it takes no lock
 *    `--no-optional-locks` would have skipped (it writes nothing).
 *
 * EVERY CANDIDATE IS PROVEN BEFORE EITHER CALL EVER RUNS -- the identical
 * two-check proof `removeWorktree` requires (`worktrees.ts`'s own security
 * rule 6): its commondir chain must resolve to the SAME repo root the
 * resolved project names, AND git's own LIVE `worktree list` must still
 * register it. A candidate that fails either is silently dropped from the
 * answer -- never a reason to fail the whole batch, and never a `git` spawn
 * in a directory this module has not independently confirmed is one of the
 * resolved project's own linked worktrees. `worktrees.ts`'s own exports
 * (`listRaw`, `findRepoRootFromWorktree`, `findMatchingEntry`, `safeRealpath`)
 * are reused WHOLE here rather than reimplemented, so there is exactly one
 * place this proof can drift from `removeWorktree`'s own.
 *
 * BOUNDED CONCURRENCY -- `mapWithConcurrencyLimit`, the same limiter
 * `claude-code/source.ts` already uses for its own per-session transcript
 * reads -- caps how many `git` child processes phase 2a's badges spawn at
 * once. A workspace with dozens of worktrees open at once must not fork
 * dozens of `git status`/`git rev-list` pairs in the same tick.
 */

import type { WorktreeStatus, WorktreeStatusInput } from '../../shared/worktree.js';
import type { SourceError } from '../ipc/channels.js';
import { mapWithConcurrencyLimit } from '../sources/claude-code/concurrency-limit.js';
import { repoRootOf, whyNotARepository } from '../sources/repo.js';
import type { GitRun } from './git-run.js';
import {
  findMatchingEntry,
  findRepoRootFromWorktree,
  listRaw,
  safeRealpath,
  type WorktreesDeps,
} from './worktrees.js';

const refused = (code: string, message: string): SourceError => ({
  kind: 'refused',
  code,
  message,
});

const unknownProject = (projectId: string): SourceError =>
  refused(
    'unknown-project',
    `vam does not know a project "${projectId}" with a live directory to run git in`,
  );

/** How many `git status`/`git rev-list` PAIRS run at once -- half of
 *  `claude-code/source.ts`'s own `TRANSCRIPT_READ_CONCURRENCY` (8), because
 *  each unit of work here is two real `git` child processes rather than one
 *  file read. */
const STATUS_CONCURRENCY_LIMIT = 4;

/** `<behind>\t<ahead>` (`--left-right`'s own field order) -> the pair, or
 *  `null` for anything that does not parse as two integers -- never thrown,
 *  same "an IO/parse failure is a blank fact, not a crash" rule every other
 *  optional read in this feature follows. */
function parseAheadBehind(stdout: string): { ahead: number; behind: number } | null {
  const [behindText, aheadText] = stdout.trim().split(/\s+/);
  if (behindText === undefined || aheadText === undefined) return null;
  const behind = Number(behindText);
  const ahead = Number(aheadText);
  if (!Number.isFinite(behind) || !Number.isFinite(ahead)) return null;
  return { ahead, behind };
}

/**
 * One PROVEN worktree's own status. Never throws: a `git status` that fails
 * outright (the directory vanished between listing and this call, `git`
 * itself missing, a real error) answers `null` -- dropped by the caller,
 * exactly like a candidate that failed the ownership proof -- rather than
 * guessing `dirty: false` for a worktree this call could not actually read.
 * `git rev-list` failing is treated differently (see this module's own
 * header): that failure mode is the ORDINARY "no upstream" case, not a
 * reason to drop the row, so it only blanks `ahead`/`behind`, never the
 * whole status.
 */
async function computeOneStatus(worktreeId: string, run: GitRun): Promise<WorktreeStatus | null> {
  let dirty: boolean;
  try {
    // `-c core.fsmonitor=false` and `--no-optional-locks` -- BOTH per-call
    // argv, NEVER written to any `.git/config` -- see this module's own
    // header for the measured reason each one is here.
    const { stdout } = await run(
      ['-c', 'core.fsmonitor=false', '--no-optional-locks', 'status', '--porcelain=v1', '-z'],
      worktreeId,
    );
    dirty = stdout !== '';
  } catch {
    return null;
  }

  let ahead: number | null = null;
  let behind: number | null = null;
  try {
    const { stdout } = await run(
      ['rev-list', '--left-right', '--count', '@{u}...HEAD'],
      worktreeId,
    );
    const parsed = parseAheadBehind(stdout);
    if (parsed !== null) {
      ahead = parsed.ahead;
      behind = parsed.behind;
    }
  } catch {
    // No upstream configured, or a detached HEAD (which cannot have one) --
    // `ahead`/`behind` stay `null`, this module's own "cannot say" reading.
  }

  return { worktreeId, dirty, ahead, behind };
}

/**
 * `input.worktreeIds` answered back as a `WorktreeStatus` per PROVEN one --
 * fewer entries than asked for is not an error, it is what asking about a
 * worktree that no longer exists, or was never really this project's own,
 * looks like.
 */
export async function getWorktreeStatuses(
  input: WorktreeStatusInput,
  deps: WorktreesDeps,
): Promise<SourceError | readonly WorktreeStatus[]> {
  const known = await deps.knownProjectIds();
  if (!known.includes(input.projectId)) return unknownProject(input.projectId);
  const resolvedDir = await deps.resolveProjectDirectory(input.projectId);
  if (resolvedDir === null) return unknownProject(input.projectId);
  const repoRoot = repoRootOf(resolvedDir);
  if (repoRoot === null) return whyNotARepository(resolvedDir) ?? unknownProject(input.projectId);

  const entries = await listRaw(repoRoot, deps.run);
  if ('kind' in entries) return entries;

  const realRepoRoot = await safeRealpath(repoRoot, deps.realpathFn);

  const proven: string[] = [];
  for (const candidateId of input.worktreeIds) {
    const realCandidate = await safeRealpath(candidateId, deps.realpathFn);
    if (realCandidate === null) continue;
    if (realRepoRoot !== null && realCandidate === realRepoRoot) continue; // the main worktree itself
    const claimedRepoRoot = await findRepoRootFromWorktree(realCandidate, deps.realpathFn);
    if (claimedRepoRoot === null || realRepoRoot === null || claimedRepoRoot !== realRepoRoot) {
      continue;
    }
    const matched = await findMatchingEntry(entries, realCandidate, deps.realpathFn);
    if (matched === undefined || matched.bare) continue;
    proven.push(realCandidate);
  }

  const statuses = await mapWithConcurrencyLimit(proven, STATUS_CONCURRENCY_LIMIT, (worktreeId) =>
    computeOneStatus(worktreeId, deps.run),
  );
  return statuses.filter((status): status is WorktreeStatus => status !== null);
}
