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
 */

import { mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
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

/**
 * WRITE THE BUNDLE TO BOTH AGENT DIRECTORIES -- one click covers Claude and
 * Codex, because "install the skill" is one operator decision, not two.
 *
 * `force` GATES EXACTLY ONE CASE: an agent whose CURRENT state is
 * `outdated-modified`. Everything else (`not-installed`, or already
 * `installed` and therefore a no-op) proceeds regardless of `force` --
 * refusing those would make the ordinary "click Install" path ask a question
 * nobody needs answered.
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
      for (const [name, bytes] of bundle) {
        await writeFile(join(dir, name), bytes);
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
 */
export async function removeAdhdSkill(deps: AdhdSkillDeps): Promise<AdhdSkillActionResult> {
  const bundle = await readBundle(deps.bundledDir);
  const outcomes: AdhdSkillAgentOutcome[] = [];
  for (const agent of ADHD_SKILL_AGENTS) {
    const dir = agentDir(agent, deps.homeDir);
    try {
      let sawAny = false;
      let leftForeign = false;
      for (const [name, bytes] of bundle) {
        const path = join(dir, name);
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
