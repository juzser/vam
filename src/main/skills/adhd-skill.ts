/**
 * INSTALLING THE REAL SKILL, on the two directories this app ever touches.
 *
 * `src/shared/adhd-skill.ts` carries the vocabulary and the two agent
 * directories (`~/.claude/skills/i-have-adhd`, `~/.agents/skills/i-have-adhd`)
 * pinned there against each agent's own docs. This module is where a byte
 * actually moves: it reads the bundled pinned copy this app ships
 * (`resources/skills/i-have-adhd/`, packaged by `electron-builder.config.cjs`'s
 * `files` list) and compares it against, writes it to, or removes it from
 * disk.
 *
 * NO PATH EVER ARRIVES FROM OUTSIDE THIS MODULE. Every exported function
 * takes an `AdhdSkillDeps` -- a resolved `homeDir` and `bundledDir` -- built
 * ONLY by `defaultAdhdSkillDeps` in production (`src/main/skills/ipc.ts`'s one
 * call site) or by a test. The IPC handlers this feeds
 * (`CHANNELS.adhdSkill*`) take no argument but a `force: boolean`, so the
 * renderer -- the least trusted process in this app -- cannot name a
 * directory even by accident.
 *
 * THE THREE-STATE COMPARISON IS PER FILE, THEN COLLAPSED PER AGENT.
 * `not-installed`: neither bundled file exists at the target. `installed`:
 * both exist and are byte-identical to the bundle. Anything else --one file
 * missing, one file differing, a directory that holds something else
 * entirely under the same name -- is `outdated-modified`, one bucket for
 * every case this module cannot safely overwrite without being told to.
 *
 * A SYMLINKED SKILL DIRECTORY IS NEVER "installed", EVEN WHEN ITS CONTENT
 * MATCHES BYTE-FOR-BYTE. Byte equality against a PUBLIC, pinned bundle is
 * something a planted symlink can trivially satisfy: an attacker who
 * replaces `~/.claude/skills/i-have-adhd` (or its immediate `skills`
 * parent, or just one of its two files) with a symlink to some other
 * location, then drops matching `SKILL.md`/`LICENSE` bytes at the far end,
 * would otherwise get "installed" read back honestly -- and a click on
 * Remove, or a force-Install, acting through the link at whatever it
 * points to. `symlinkedAnywhere()` below `lstat`s every path component this
 * module itself creates or touches -- the skill directory, its immediate
 * parent, and each bundled filename inside it -- and a positive answer
 * routes the SAME way everywhere: `readAdhdSkillStatus` reports
 * `outdated-modified` unconditionally (it never reads content through the
 * link to decide "this matches"), `installAdhdSkill` refuses regardless of
 * `force` (`force` overrides only "this directory's content differs from
 * the bundle", never "this path is not the directory it claims to be"),
 * and `removeAdhdSkill` treats it exactly like foreign content and deletes
 * nothing.
 *
 * THE RESIDUAL RACE, NAMED RATHER THAN HIDDEN: `lstat` is checked
 * immediately before each write or delete, and every file write
 * additionally opens with `O_NOFOLLOW` (verified: opening a path whose
 * final component is a symlink throws `ELOOP` rather than following it --
 * the file-level swap this module can fully close). Node's `fs` API has no
 * `openat`-style directory-relative primitive, so a symlink planted in the
 * narrow window between this module's `lstat` of the DIRECTORY and its
 * next call on that same directory is not provably closed -- but that
 * requires an attacker racing a live click on this card, a materially
 * different and harder threat than the pre-planted symlink this fix closes
 * completely, which is the scenario a supply-chain-style attack against a
 * public, pinned bundle actually has to work with.
 */

import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rm, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  ADHD_SKILL_AGENTS,
  ADHD_SKILL_NAME,
  type AdhdSkillActionResult,
  type AdhdSkillAgent,
  type AdhdSkillAgentOutcome,
  type AdhdSkillAgentStatus,
  type AdhdSkillState,
  type AdhdSkillStatus,
} from '../../shared/adhd-skill.js';

export type AdhdSkillDeps = {
  /** The operator's home directory -- `os.homedir()` in production, a
   *  throwaway temp directory in every test. */
  readonly homeDir: string;
  /** Where the bundled, pinned `SKILL.md` and `LICENSE` live. */
  readonly bundledDir: string;
};

/** Real production wiring: `os.homedir()` (which DOES read `$HOME`, unlike
 *  Electron's own `app.getPath('userData')` -- see
 *  `src/main/env/user-data-dir.ts`'s header for the platform difference this
 *  repo already measured) and the resource path `electron-builder.config.cjs`
 *  packages this skill's two files at. `appPath` is `app.getAppPath()`:
 *  the repo root in dev, the asar root when packaged -- the same call
 *  `main/index.ts` already makes for `dist-web` (see its own header). */
export function defaultAdhdSkillDeps(appPath: string): AdhdSkillDeps {
  return {
    homeDir: homedir(),
    bundledDir: join(appPath, 'resources', 'skills', ADHD_SKILL_NAME),
  };
}

const SKILL_FILENAMES = ['SKILL.md', 'LICENSE'] as const;

const AGENT_SEGMENTS: Record<AdhdSkillAgent, readonly string[]> = {
  claude: ['.claude', 'skills', ADHD_SKILL_NAME],
  codex: ['.agents', 'skills', ADHD_SKILL_NAME],
};

function agentDir(agent: AdhdSkillAgent, homeDir: string): string {
  return join(homeDir, ...AGENT_SEGMENTS[agent]);
}

async function readFileOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function readdirOrEmpty(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** `lstat`, which -- unlike `stat` or `readFile` -- never follows the
 *  path's OWN final component, so this answers "is the entry AT this exact
 *  path a symlink", never "does the real thing at the far end of one
 *  exist". A missing path is not a symlink. */
async function isSymlink(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** True if the skill directory itself, its immediate `skills` parent (the
 *  other path segment `mkdir(dir, { recursive: true })` can create), or
 *  either bundled filename inside it, is a symlink. This is the module's
 *  one safety boundary -- see the file header for what it defends and what
 *  it cannot. */
async function symlinkedAnywhere(dir: string): Promise<boolean> {
  if ((await isSymlink(dir)) || (await isSymlink(dirname(dir)))) return true;
  for (const name of SKILL_FILENAMES) {
    if (await isSymlink(join(dir, name))) return true;
  }
  return false;
}

/** The bundle, read once per call: `Buffer`s, never text, so a comparison
 *  against what is on disk is exact bytes rather than a decoding's opinion of
 *  them (line endings, BOM, an encoding neither file actually uses). */
async function readBundle(bundledDir: string): Promise<ReadonlyMap<string, Buffer>> {
  const entries = await Promise.all(
    SKILL_FILENAMES.map(async (name) => [name, await readFile(join(bundledDir, name))] as const),
  );
  return new Map(entries);
}

async function statusForAgent(
  agent: AdhdSkillAgent,
  homeDir: string,
  bundle: ReadonlyMap<string, Buffer>,
): Promise<AdhdSkillAgentStatus> {
  const dir = agentDir(agent, homeDir);
  // A symlinked target is `outdated-modified` UNCONDITIONALLY -- reading
  // content through it to decide "this matches" is exactly the operation a
  // hijack depends on succeeding, so this module never makes that read.
  if (await symlinkedAnywhere(dir)) {
    return { agent, state: 'outdated-modified', dir };
  }
  let present = 0;
  let matching = 0;
  for (const [name, bytes] of bundle) {
    const existing = await readFileOrNull(join(dir, name));
    if (existing === null) continue;
    present += 1;
    if (existing.equals(bytes)) matching += 1;
  }
  const state: AdhdSkillState =
    present === 0
      ? 'not-installed'
      : present === bundle.size && matching === bundle.size
        ? 'installed'
        : 'outdated-modified';
  return { agent, state, dir };
}

function overallState(agents: readonly AdhdSkillAgentStatus[]): AdhdSkillState {
  if (agents.some((a) => a.state === 'outdated-modified')) return 'outdated-modified';
  if (agents.some((a) => a.state === 'installed')) return 'installed';
  return 'not-installed';
}

export async function readAdhdSkillStatus(deps: AdhdSkillDeps): Promise<AdhdSkillStatus> {
  const bundle = await readBundle(deps.bundledDir);
  const agents = await Promise.all(
    ADHD_SKILL_AGENTS.map((agent) => statusForAgent(agent, deps.homeDir, bundle)),
  );
  return { overall: overallState(agents), agents };
}

/** Writes `bytes` to `path`, refusing to follow a symlink at that exact
 *  path -- `O_NOFOLLOW` makes the open itself throw `ELOOP` rather than
 *  writing through it, closing the race between this module's own `lstat`
 *  check and the write that follows it (see the file header). Does not,
 *  and cannot, guard a symlinked PARENT directory; `symlinkedAnywhere`'s
 *  `lstat` immediately beforehand is what does that. */
async function writeFileNoFollow(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(
    path,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW,
  );
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
}

/**
 * WRITE THE BUNDLE TO BOTH AGENT DIRECTORIES -- one click covers Claude and
 * Codex, because "install the skill" is one operator decision, not two.
 *
 * `force` GATES EXACTLY ONE CASE: an agent whose CURRENT state is
 * `outdated-modified` FOR AN ORDINARY REASON -- content that differs from
 * the bundle. Everything else (`not-installed`, or already `installed` and
 * therefore a no-op) proceeds regardless of `force` -- refusing those would
 * make the ordinary "click Install" path ask a question nobody needs
 * answered. A SYMLINKED target is refused UNCONDITIONALLY, `force` or not
 * -- see the file header.
 */
export async function installAdhdSkill(
  deps: AdhdSkillDeps,
  force = false,
): Promise<AdhdSkillActionResult> {
  const bundle = await readBundle(deps.bundledDir);
  const outcomes: AdhdSkillAgentOutcome[] = [];
  for (const agent of ADHD_SKILL_AGENTS) {
    const dir = agentDir(agent, deps.homeDir);
    try {
      if (await symlinkedAnywhere(dir)) {
        outcomes.push({ agent, kind: 'refused' });
        continue;
      }
      const current = await statusForAgent(agent, deps.homeDir, bundle);
      if (current.state === 'outdated-modified' && !force) {
        outcomes.push({ agent, kind: 'refused' });
        continue;
      }
      if (current.state === 'installed') {
        outcomes.push({ agent, kind: 'unchanged' });
        continue;
      }
      await mkdir(dir, { recursive: true });
      // Re-checked here, not just above: `mkdir` itself can be the thing
      // that first creates `dir`, so a symlink planted between the check
      // above and this line would otherwise reach the write unguarded.
      if (await symlinkedAnywhere(dir)) {
        outcomes.push({ agent, kind: 'refused' });
        continue;
      }
      for (const [name, bytes] of bundle) {
        await writeFileNoFollow(join(dir, name), bytes);
      }
      outcomes.push({ agent, kind: 'written' });
    } catch (error) {
      outcomes.push({ agent, kind: 'error', message: (error as Error).message });
    }
  }
  return { status: await readAdhdSkillStatus(deps), agents: outcomes };
}

/**
 * REMOVE, FILE BY FILE, NEVER THE DIRECTORY WHOLESALE.
 *
 * Each of the two bundled filenames is deleted ONLY when the file present at
 * the target has content byte-identical to the bundle -- the same check
 * `readAdhdSkillStatus` makes, applied per file rather than collapsed to one
 * verdict. A file that differs (hand-edited, or never vam's to begin with) is
 * left exactly as it was, and so is anything else an operator put in that
 * directory: the directory itself is removed only when it is EMPTY afterwards,
 * which a leftover foreign file or a leftover mismatched one both prevent.
 *
 * A SYMLINKED target -- directory, parent, or file -- is treated exactly
 * like foreign content: nothing is deleted, `left-foreign` either way. See
 * the file header for why a byte match through a symlink is never trusted.
 */
export async function removeAdhdSkill(deps: AdhdSkillDeps): Promise<AdhdSkillActionResult> {
  const bundle = await readBundle(deps.bundledDir);
  const outcomes: AdhdSkillAgentOutcome[] = [];
  for (const agent of ADHD_SKILL_AGENTS) {
    const dir = agentDir(agent, deps.homeDir);
    try {
      if (await symlinkedAnywhere(dir)) {
        outcomes.push({ agent, kind: 'left-foreign' });
        continue;
      }
      let sawAny = false;
      let leftForeign = false;
      for (const [name, bytes] of bundle) {
        const path = join(dir, name);
        // Re-checked per file, immediately before the read that decides
        // whether to delete it: the earlier `symlinkedAnywhere` call already
        // covers this exact path, but re-reading it here keeps the gap
        // between "last confirmed not a symlink" and "deleted" as small as
        // this API allows, matching the write side's re-check above.
        if (await isSymlink(path)) {
          sawAny = true;
          leftForeign = true;
          continue;
        }
        const existing = await readFileOrNull(path);
        if (existing === null) continue;
        sawAny = true;
        if (existing.equals(bytes)) {
          await rm(path);
        } else {
          leftForeign = true;
        }
      }
      if (!sawAny) {
        outcomes.push({ agent, kind: 'unchanged' });
        continue;
      }
      if (!leftForeign) {
        const remaining = await readdirOrEmpty(dir);
        // `rmdir`, not `rm`: it refuses a non-empty directory on its own
        // (ENOTEMPTY) rather than needing `recursive: true`, which would
        // happily delete contents this function never checked.
        if (remaining.length === 0) {
          await rmdir(dir).catch(() => {});
        }
      }
      outcomes.push({ agent, kind: leftForeign ? 'left-foreign' : 'removed' });
    } catch (error) {
      outcomes.push({ agent, kind: 'error', message: (error as Error).message });
    }
  }
  return { status: await readAdhdSkillStatus(deps), agents: outcomes };
}
