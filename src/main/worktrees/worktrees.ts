/**
 * The worktrees feature's main-process service: list, create, remove -- the
 * only place this app runs `git worktree *`.
 *
 * EVERY FUNCTION RESOLVES TO `SourceError | T`, NEVER THROWS, the same
 * result/`SourceError` union style `createSessionInDirectory` already uses
 * (`sources/claude-code/create-session.ts`): a refusal travels as data so a
 * caller narrows on `'kind' in result` rather than wrapping every call in a
 * `try`.
 *
 * SECURITY, NAMED, BECAUSE THE OPERATOR'S SPEC FOR THIS FEATURE NAMES IT:
 *
 *  1. `projectId` MUST BE A KNOWN PROJECT. `knownProjectIds` mirrors
 *     `remote/server.ts`'s `confineToProjectSet` -- the same `source.load()`
 *     project set the `create-session-in` remote route confines itself to --
 *     applied here to the LOCAL bridge instead, where the caller never hands
 *     over a raw path to canonicalise in the first place (see the next
 *     point), only an id.
 *  2. THE DIRECTORY IS NEVER TAKEN FROM THE RENDERER. `Project` carries no
 *     `cwd` (`renderer/domain/model.ts`'s own rule), so the only honest way
 *     from an id back to a path is `resolveProjectDirectory` -- a live agent
 *     or a live pane vam already watches, never a string the least trusted
 *     process supplied.
 *  3. THE COMPUTED PATH IS PROVEN INSIDE `<repoName>-worktrees/`, by
 *     `files/authorize.ts`'s own `authorize()` -- realpath both sides,
 *     tolerate a leaf that does not exist yet (the worktree about to be
 *     created), refuse a symlink escape. Reused whole, not reimplemented:
 *     that module's header is the traversal argument this feature would
 *     otherwise have to repeat.
 *  4. THE BRANCH NAME PASSES TWO GATES: `sanitizeWorktreeName` (this
 *     feature's own plausibility filter) AND `git check-ref-format
 *     --branch` (git's own, authoritative one) -- see `name.ts`'s header
 *     for why neither is trusted alone.
 *  5. REMOVAL NEVER FORCES SILENTLY. A dirty worktree is refused until the
 *     operator retypes its name (`confirmName`); a LOCKED worktree is never
 *     removed at all, force or not; branch deletion is always `git branch
 *     -d` (never `-D`) and a branch `-d` refuses is PRESERVED, reported as
 *     `preservedBranch`, never silently discarded.
 *  6. REMOVAL IS CONFINED TO A KNOWN PROJECT'S OWN WORKTREES, exactly like
 *     rules 1-3 above -- `removeWorktree` takes a `projectId`, checked
 *     against `knownProjectIds()` and resolved through
 *     `resolveProjectDirectory` the same as `list`/`create`, and the
 *     candidate `worktreeId` must pass the SAME `authorize()` call against
 *     THAT project's `<repoRoot>-worktrees/` root. A second, independent
 *     check reads the worktree's own `.git` -> `commondir` chain and
 *     refuses unless it agrees with the resolved project's own repo root --
 *     belt-and-suspenders against a directory that merely sits inside the
 *     confined root without actually being a linked worktree of it. Without
 *     rule 6, `worktreeId` alone (an absolute path) would let a
 *     compromised renderer `remove --force` any linked worktree of ANY git
 *     repository on disk, known to vam or not -- `removeWorktree` used to
 *     derive its own repo root purely from the untrusted path's `.git`
 *     file, with no check that the repo it found was one vam manages at
 *     all. See `test/main/worktrees/worktrees.integration.test.ts`'s
 *     "removeWorktree confinement" suite for the three shapes this closes.
 */

import { mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type {
  CreateWorktreeInput,
  RemoveWorktreeInput,
  RemoveWorktreeOutcome,
  WorktreeInfo,
} from '../../shared/worktree.js';
import { cliMissingMessage } from '../env/cli-missing.js';
import { authorize, type RealpathFn } from '../files/authorize.js';
import type { SourceError } from '../ipc/channels.js';
import { projectIdOf } from '../sources/claude-code/project-id.js';
import { repoRootOf, whyNotARepository } from '../sources/repo.js';
import { GIT_TIMEOUT_MS, type GitRun } from './git-run.js';
import { sanitizeWorktreeName } from './name.js';
import { parseWorktreeListPorcelain, type WorktreeListEntry } from './porcelain.js';

export type { GitRun } from './git-run.js';

export type WorktreesDeps = {
  readonly run: GitRun;
  readonly realpathFn: RealpathFn;
  /** `null` when no live agent or pane names this project -- see
   *  `resolve-directory.ts`. */
  readonly resolveProjectDirectory: (projectId: string) => Promise<string | null>;
  /** The ids `source.load()` currently reports, asked fresh per call. */
  readonly knownProjectIds: () => Promise<readonly string[]>;
};

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

const MAX_CLI_MESSAGE = 400;
const clip = (text: string): string =>
  text.trim().length > MAX_CLI_MESSAGE
    ? `${text.trim().slice(0, MAX_CLI_MESSAGE)}...`
    : text.trim();

type GitFailure = NodeJS.ErrnoException & { killed?: boolean; stderr?: string };

export function classifyGitFailure(error: unknown, what: string): SourceError {
  const failure = error as GitFailure;
  if (failure.code === 'ENOENT') {
    return refused('cli-missing', cliMissingMessage('git', `vam cannot ${what}`));
  }
  if (failure.killed === true) {
    return refused(
      'timed-out',
      `${what} did not finish within ${Math.round(GIT_TIMEOUT_MS / 1000)}s`,
    );
  }
  const said = clip(failure.stderr ?? '');
  return refused(
    'git-failed',
    said === '' ? `${what} failed, and git said nothing about why` : `${what} failed: ${said}`,
  );
}

export async function safeRealpath(path: string, realpathFn: RealpathFn): Promise<string | null> {
  try {
    return await realpathFn(path);
  } catch {
    return null;
  }
}

/** `<repoParent>/<repoName>-worktrees` -- the operator's own decision for
 *  this feature: a sibling of the repository, never a folder inside it. */
export function worktreesRootFor(repoRoot: string): string {
  return join(dirname(repoRoot), `${basename(repoRoot)}-worktrees`);
}

/** `refs/heads/<name>` -> `<name>`; a detached `HEAD`'s short sha; `null`
 *  when neither is known (a bare entry, or a record this module could not
 *  fully read). */
function friendlyBranch(entry: WorktreeListEntry): string | null {
  if (entry.branchRef !== null) {
    return entry.branchRef.startsWith('refs/heads/')
      ? entry.branchRef.slice('refs/heads/'.length)
      : entry.branchRef;
  }
  if (entry.detached && entry.headSha !== null) {
    return entry.headSha.slice(0, 7);
  }
  return null;
}

/** `git worktree list --porcelain -z`, falling back to the plain porcelain
 *  form for a git older than 2.36 (which does not know `-z`). */
export async function listRaw(
  repoRoot: string,
  run: GitRun,
): Promise<SourceError | readonly WorktreeListEntry[]> {
  try {
    const { stdout } = await run(['worktree', 'list', '--porcelain', '-z'], repoRoot);
    return parseWorktreeListPorcelain(stdout, '\0');
  } catch {
    try {
      const { stdout } = await run(['worktree', 'list', '--porcelain'], repoRoot);
      return parseWorktreeListPorcelain(stdout, '\n');
    } catch (plainError) {
      return classifyGitFailure(plainError, 'list worktrees');
    }
  }
}

/**
 * Every LINKED worktree of the project `projectId` names -- the main
 * worktree itself (the project's own checkout, already a row in the
 * sidebar) is filtered out by realpath comparison, and a `bare` record
 * (git's own administrative entry for a bare clone, never one vam creates)
 * is skipped too.
 *
 * ADOPTION NEEDED NO CHANGE HERE (phase 2a, `docs/design/worktrees.md`'s
 * phase-2 list): `listRaw` already runs an unconditional
 * `git worktree list --porcelain`, with no filter on WHERE a worktree lives
 * or WHAT made it -- a worktree a CLI, Orca, or `claude --worktree` created
 * was already in this answer. `removeWorktree`'s own header explains the
 * half that DID have to change: listing one and being allowed to safely
 * remove it used to be two different questions.
 */
export async function listWorktrees(
  projectId: string,
  deps: WorktreesDeps,
): Promise<SourceError | readonly WorktreeInfo[]> {
  const known = await deps.knownProjectIds();
  if (!known.includes(projectId)) return unknownProject(projectId);
  const resolvedDir = await deps.resolveProjectDirectory(projectId);
  if (resolvedDir === null) return unknownProject(projectId);
  const repoRoot = repoRootOf(resolvedDir);
  if (repoRoot === null) return whyNotARepository(resolvedDir) ?? unknownProject(projectId);

  const entries = await listRaw(repoRoot, deps.run);
  if ('kind' in entries) return entries;

  const selfRealPath = await safeRealpath(repoRoot, deps.realpathFn);
  const worktrees: WorktreeInfo[] = [];
  for (const entry of entries) {
    if (entry.bare) continue;
    const realPath = (await safeRealpath(entry.path, deps.realpathFn)) ?? entry.path;
    if (selfRealPath !== null && realPath === selfRealPath) continue;
    worktrees.push({
      worktreeId: realPath,
      path: realPath,
      branch: friendlyBranch(entry),
      projectId: projectIdOf(realPath),
      locked: entry.locked,
      lockReason: entry.lockedReason,
      prunable: entry.prunable,
      prunableReason: entry.prunableReason,
      detached: entry.detached,
    });
  }
  return worktrees;
}

async function checkRefFormat(
  candidate: string,
  run: GitRun,
  cwd: string,
): Promise<SourceError | null> {
  try {
    await run(['check-ref-format', '--branch', candidate], cwd);
    return null;
  } catch {
    return refused(
      'invalid-branch-name',
      `"${candidate}" is not a name git will accept as a branch`,
    );
  }
}

/**
 * `git rev-parse --verify --quiet --end-of-options <baseRef>^{commit}` --
 * `baseRef` is an OPERATOR-TYPED STRING that would otherwise be handed to
 * `git worktree add` as a bare trailing argv element, where git's own flag
 * parser reads it BEFORE deciding it is a revision: a typed base ref of
 * `-f` is indistinguishable from the flag `--force`, `--detach` from the
 * flag of the same name, `--upload-pack=x` likewise -- proven against a
 * real git binary, not assumed (this function's own test file). `--end-of-
 * options` (git >= 2.24) is what makes `rev-parse` itself treat a leading
 * `-` as part of the revision text rather than a flag, so THIS check cannot
 * be fooled by the same trick it exists to catch; a candidate that starts
 * with `-` and is not a real revision fails `rev-parse` and is refused here,
 * before `createWorktree` ever puts it in argv at all. The `^{commit}`
 * suffix additionally refuses a tag or ref that does not point AT a commit
 * (an annotated tag of a blob, for instance) -- `worktree add` needs a
 * commit to check out, not merely something that exists.
 */
async function validateBaseRef(
  baseRef: string,
  run: GitRun,
  cwd: string,
): Promise<SourceError | null> {
  try {
    await run(['rev-parse', '--verify', '--quiet', '--end-of-options', `${baseRef}^{commit}`], cwd);
    return null;
  } catch {
    return refused('invalid-base-ref', `"${baseRef}" is not a ref git can resolve to a commit`);
  }
}

function classifyCreateFailure(error: unknown, slug: string, targetPath: string): SourceError {
  const failure = error as GitFailure;
  if (failure.code === 'ENOENT') {
    return refused('cli-missing', cliMissingMessage('git', 'vam cannot create a worktree'));
  }
  if (failure.killed === true) {
    return refused(
      'timed-out',
      `creating the worktree did not finish within ${Math.round(GIT_TIMEOUT_MS / 1000)}s`,
    );
  }
  const stderr = (failure.stderr ?? '').trim();
  if (/already exists/i.test(stderr) && /branch/i.test(stderr)) {
    return refused(
      'branch-exists',
      `a branch named "${slug}" already exists — choose a different name`,
    );
  }
  if (/already checked out/i.test(stderr)) {
    return refused(
      'branch-exists',
      `"${slug}" is already checked out elsewhere — choose a different name`,
    );
  }
  if (/already exists/i.test(stderr)) {
    return refused('already-exists', `${targetPath} already exists`);
  }
  const said = clip(stderr);
  return refused(
    'git-failed',
    said === ''
      ? 'git worktree add failed, and git said nothing about why'
      : `git worktree add failed: ${said}`,
  );
}

/**
 * `git worktree add --no-track -b <slug> <path> [<baseRef>]`. `baseRef`
 * omitted (or empty) means "the repository's current `HEAD`" -- which is
 * also exactly what a bare `git worktree add -b <branch> <path>` does on
 * its own with no base given, so this simply never passes one rather than
 * resolving `HEAD` itself first.
 */
export async function createWorktree(
  input: CreateWorktreeInput,
  deps: WorktreesDeps,
): Promise<SourceError | WorktreeInfo> {
  const known = await deps.knownProjectIds();
  if (!known.includes(input.projectId)) return unknownProject(input.projectId);
  const resolvedDir = await deps.resolveProjectDirectory(input.projectId);
  if (resolvedDir === null) return unknownProject(input.projectId);

  // Covers "not a git repository" AND "a bare repository" in one check: a
  // bare repo's own root has no `.git` entry either, so `repoRootOf` answers
  // `null` for it exactly as it does for a plain directory (`sources/
  // repo.ts`'s own comment on `repoRootOf`).
  const notARepo = whyNotARepository(resolvedDir);
  if (notARepo !== null) return notARepo;
  const repoRoot = repoRootOf(resolvedDir) as string;

  const slug = sanitizeWorktreeName(input.name);
  if (slug === null) {
    return refused(
      'invalid-name',
      `"${input.name}" has nothing left once vam removes characters that cannot be part of a worktree name or a git branch`,
    );
  }
  const refFormatError = await checkRefFormat(slug, deps.run, repoRoot);
  if (refFormatError !== null) return refFormatError;

  const hasBaseRef = input.baseRef !== undefined && input.baseRef !== '';
  if (hasBaseRef) {
    const baseRefError = await validateBaseRef(input.baseRef as string, deps.run, repoRoot);
    if (baseRefError !== null) return baseRefError;
  }

  const worktreesRoot = worktreesRootFor(repoRoot);
  try {
    await mkdir(worktreesRoot, { recursive: true });
  } catch (error) {
    return refused(
      'worktree-root-unavailable',
      `vam could not create ${worktreesRoot}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const realWorktreesRoot = await safeRealpath(worktreesRoot, deps.realpathFn);
  if (realWorktreesRoot === null) {
    return refused('worktree-root-unavailable', `vam could not resolve ${worktreesRoot}`);
  }

  const targetPath = join(worktreesRoot, slug);
  const authorization = await authorize(targetPath, [realWorktreesRoot], deps.realpathFn);
  if (!authorization.authorized) {
    return refused(
      'path-confinement',
      `"${input.name}" would not create a worktree inside ${worktreesRoot}`,
    );
  }
  if (authorization.existed) {
    return refused('already-exists', `${targetPath} already exists`);
  }

  // `--` before `baseRef`, VERIFIED against a real git binary (this
  // module's own header): without it, a validated-but-still-hyphen-shaped
  // ref would still reach `worktree add`'s own flag parser first. Belt and
  // suspenders alongside `validateBaseRef` above, not a substitute for it.
  const argv = [
    'worktree',
    'add',
    '--no-track',
    '-b',
    slug,
    targetPath,
    ...(hasBaseRef ? ['--', input.baseRef as string] : []),
  ];
  try {
    await deps.run(argv, repoRoot);
  } catch (error) {
    return classifyCreateFailure(error, slug, targetPath);
  }

  const realPath = (await safeRealpath(targetPath, deps.realpathFn)) ?? targetPath;
  return {
    worktreeId: realPath,
    path: realPath,
    branch: slug,
    projectId: projectIdOf(realPath),
    locked: false,
    lockReason: null,
    prunable: false,
    prunableReason: null,
    detached: false,
  };
}

/**
 * Reads `<worktreePath>/.git` (a FILE for a linked worktree -- `sources/
 * repo.ts`'s own comment on the shape) and walks `gitdir:` -> `commondir` to
 * the shared `.git` directory every worktree of one repository shares, the
 * same layout `git` itself relies on. Its PARENT is the main repository's
 * root -- resolved this way, from the worktree's own directory alone, so
 * `removeWorktree` needs no `projectId` and can run `git worktree remove`
 * with `cwd` set to a directory that is NOT the one being deleted (removing
 * a worktree from inside itself is not a state this module ever creates).
 *
 * `null` for anything that does not parse: a `.git` DIRECTORY (this path is
 * itself a main repository, not a linked worktree), a missing `commondir`,
 * or a `commondir` that does not resolve -- every one of them means
 * "`removeWorktree` cannot prove this is a worktree it manages", refused by
 * the caller rather than guessed at.
 */
export async function findRepoRootFromWorktree(
  worktreePath: string,
  realpathFn: RealpathFn,
): Promise<string | null> {
  let content: string;
  try {
    content = await readFile(join(worktreePath, '.git'), 'utf8');
  } catch {
    return null;
  }
  const line = content
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('gitdir:'));
  if (line === undefined) return null;
  const rawGitdir = line.slice('gitdir:'.length).trim();
  if (rawGitdir === '') return null;
  const gitdir = isAbsolute(rawGitdir) ? rawGitdir : join(worktreePath, rawGitdir);

  let rawCommondir: string;
  try {
    rawCommondir = (await readFile(join(gitdir, 'commondir'), 'utf8')).trim();
  } catch {
    return null;
  }
  if (rawCommondir === '') return null;
  const commonGitDir = isAbsolute(rawCommondir) ? rawCommondir : join(gitdir, rawCommondir);
  const realCommonGitDir = await safeRealpath(commonGitDir, realpathFn);
  return realCommonGitDir === null ? null : dirname(realCommonGitDir);
}

export async function findMatchingEntry(
  entries: readonly WorktreeListEntry[],
  realWorktreeId: string,
  realpathFn: RealpathFn,
): Promise<WorktreeListEntry | undefined> {
  for (const entry of entries) {
    const real = await safeRealpath(entry.path, realpathFn);
    if (real === realWorktreeId) return entry;
  }
  return undefined;
}

function classifyRemoveFailure(error: unknown, worktreePath: string): SourceError {
  const failure = error as GitFailure;
  const stderr = (failure.stderr ?? '').trim();
  if (
    failure.code !== 'ENOENT' &&
    failure.killed !== true &&
    /modified or untracked files/i.test(stderr)
  ) {
    return refused(
      'dirty',
      `${basename(worktreePath)} has uncommitted changes — type its name to confirm removing it anyway`,
    );
  }
  return classifyGitFailure(error, 'remove the worktree');
}

/**
 * `git worktree remove [--force] <path>`, then `git branch -d <branch>` --
 * safe delete, never `-D`, so an unmerged/unpublished branch survives and
 * `preservedBranch` says so.
 *
 * A `git worktree lock`ED WORKTREE IS NEVER REMOVED, `force` or not -- the
 * operator's own decision for this feature. A DIRTY worktree is refused
 * (`code: 'dirty'`) UNLESS `force` is `true` AND `confirmName` equals the
 * worktree's own directory name exactly -- a checkbox is not proof anyone
 * read what they were about to discard.
 *
 * CONFINED TO `input.projectId`'S OWN WORKTREES (rule 6, this module's
 * header): `worktreeId` is never trusted to name its own repository. The
 * repo root comes ONLY from `resolveProjectDirectory(input.projectId)` --
 * the same live-agent-or-pane resolution `list`/`create` already use.
 * TWO INDEPENDENT PROOFS, NEITHER OF THEM LOCATION: the candidate's OWN
 * `.git` -> `commondir` chain must resolve to that SAME repo root (a
 * directory whose crafted `.git` file merely CLAIMS a known repo is refused
 * here), AND the candidate must still be one of THAT repo's own registered
 * worktrees according to a fresh `git worktree list` (a directory git itself
 * has never heard of is refused here too, no matter what its `.git` file
 * says). Together these prove "this really is a linked worktree of the
 * repo it claims" without caring where on disk it happens to live --
 * deliberately: v1 ALSO required the candidate to sit inside
 * `<repoRoot>-worktrees/` (`authorize()`, the same call `createWorktree`
 * still makes), which is exactly what stood between listing a worktree
 * `git worktree add` made outside vam and being allowed to remove it again.
 * Phase 2a drops that third check because the other two already carry the
 * whole weight rule 6 exists for -- `worktrees.integration.test.ts`'s own
 * "confinement (S2)" suite still falsifies both, and its "adoption" suite
 * proves the location check was the only thing that changed.
 */
export async function removeWorktree(
  input: RemoveWorktreeInput,
  deps: WorktreesDeps,
): Promise<SourceError | RemoveWorktreeOutcome> {
  const known = await deps.knownProjectIds();
  if (!known.includes(input.projectId)) return unknownProject(input.projectId);
  const resolvedDir = await deps.resolveProjectDirectory(input.projectId);
  if (resolvedDir === null) return unknownProject(input.projectId);
  const repoRoot = repoRootOf(resolvedDir);
  if (repoRoot === null) return whyNotARepository(resolvedDir) ?? unknownProject(input.projectId);

  const realWorktreeId = await safeRealpath(input.worktreeId, deps.realpathFn);
  if (realWorktreeId === null) {
    return refused('not-found', `${input.worktreeId} does not exist`);
  }

  const realRepoRoot = await safeRealpath(repoRoot, deps.realpathFn);
  const claimedRepoRoot = await findRepoRootFromWorktree(realWorktreeId, deps.realpathFn);
  if (claimedRepoRoot === null || realRepoRoot === null || claimedRepoRoot !== realRepoRoot) {
    return refused(
      'not-a-worktree',
      `${input.worktreeId} is not a linked worktree of the project it was asked to remove from`,
    );
  }

  const entries = await listRaw(repoRoot, deps.run);
  if ('kind' in entries) return entries;
  const matched = await findMatchingEntry(entries, realWorktreeId, deps.realpathFn);
  if (matched === undefined) {
    return refused('not-a-worktree', `${input.worktreeId} is not a linked worktree of ${repoRoot}`);
  }
  // BELT AND SUSPENDERS, SAME AS `status.ts`'s OWN `matched.bare` CHECK --
  // provably unreachable through any REAL git state today (a `bare` record
  // only appears when the REPO itself being queried is bare, and `repoRoot`
  // here is never bare: `whyNotARepository`/`repoRootOf` already refused
  // that earlier, both in `removeWorktree` and in whatever resolved
  // `resolvedDir` in the first place). NOT what protects the main worktree
  // (that is the commondir check above; the main worktree's own entry is
  // real, unlocked and NOT bare) -- this is a second, independent refusal
  // for a different, purely hypothetical shape: an entry this module would
  // otherwise treat as a normal, deletable worktree despite git itself
  // marking it administrative.
  if (matched.bare) {
    return refused(
      'not-a-worktree',
      `${input.worktreeId} is a bare repository record, not a linked worktree`,
    );
  }
  if (matched.locked) {
    return refused(
      'locked',
      `${basename(realWorktreeId)} is locked${matched.lockedReason !== null ? `: ${matched.lockedReason}` : ''} — unlock it before removing it`,
    );
  }

  const wantsForce = input.force === true;
  if (wantsForce) {
    const name = basename(realWorktreeId);
    if (input.confirmName !== name) {
      return refused(
        'confirm-name-mismatch',
        `type "${name}" to confirm removing a worktree with uncommitted changes`,
      );
    }
  }

  try {
    await deps.run(
      ['worktree', 'remove', ...(wantsForce ? ['--force'] : []), realWorktreeId],
      repoRoot,
    );
  } catch (error) {
    return classifyRemoveFailure(error, realWorktreeId);
  }

  let preservedBranch = false;
  if (matched.branchRef !== null && matched.branchRef.startsWith('refs/heads/')) {
    const branchName = matched.branchRef.slice('refs/heads/'.length);
    try {
      await deps.run(['branch', '-d', branchName], repoRoot);
    } catch {
      preservedBranch = true;
    }
  }
  return { preservedBranch };
}
