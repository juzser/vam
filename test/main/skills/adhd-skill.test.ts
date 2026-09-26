/**
 * THE ADHD SKILL, WRITTEN TO DISK -- and read back, and taken away again.
 *
 * Every test builds its own throwaway `homeDir` and `bundledDir` under
 * `os.tmpdir()` and NEVER reads `os.homedir()` or a real `~/.claude` /
 * `~/.agents` -- the one rule this file may not break, because a bug here
 * writes into an operator's real skills directory. `defaultAdhdSkillDeps` (the
 * production wiring that DOES call `homedir()`) is exercised once, at the
 * bottom, with `HOME` pointed at a temp dir for the length of that one test.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AdhdSkillDeps,
  defaultAdhdSkillDeps,
  installAdhdSkill,
  readAdhdSkillStatus,
  removeAdhdSkill,
} from '../../../src/main/skills/adhd-skill.js';

const made: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

afterEach(async () => {
  while (made.length > 0) {
    await rm(made.pop() as string, { recursive: true, force: true });
  }
});

const SKILL_MD = '---\nname: i-have-adhd\n---\n# i-have-adhd\nrules here\n';
const LICENSE = 'MIT License\n\nCopyright (c) 2026 Ayoub Ghriss\n';

async function bundle(): Promise<string> {
  const dir = await tempDir('vam-adhd-bundle-');
  await writeFile(join(dir, 'SKILL.md'), SKILL_MD);
  await writeFile(join(dir, 'LICENSE'), LICENSE);
  return dir;
}

async function home(): Promise<string> {
  return tempDir('vam-adhd-home-');
}

function deps(homeDir: string, bundledDir: string): AdhdSkillDeps {
  return { homeDir, bundledDir };
}

const claudeDir = (homeDir: string) => join(homeDir, '.claude', 'skills', 'i-have-adhd');
const codexDir = (homeDir: string) => join(homeDir, '.agents', 'skills', 'i-have-adhd');

describe('status: not installed', () => {
  it('reports every agent, and the whole thing, as not-installed on an empty home', async () => {
    const homeDir = await home();
    const bundledDir = await bundle();

    const status = await readAdhdSkillStatus(deps(homeDir, bundledDir));

    expect(status.overall).toBe('not-installed');
    expect(status.agents).toHaveLength(2);
    for (const agent of status.agents) {
      expect(agent.state).toBe('not-installed');
    }
    expect(status.agents.map((a) => a.agent).sort()).toEqual(['claude', 'codex']);
    expect(status.agents.find((a) => a.agent === 'claude')?.dir).toBe(claudeDir(homeDir));
    expect(status.agents.find((a) => a.agent === 'codex')?.dir).toBe(codexDir(homeDir));
  });
});

describe('status: installed', () => {
  it('reports installed only once BOTH files are byte-identical to the bundle', async () => {
    const homeDir = await home();
    const bundledDir = await bundle();
    await mkdir(claudeDir(homeDir), { recursive: true });
    await writeFile(join(claudeDir(homeDir), 'SKILL.md'), SKILL_MD);
    await writeFile(join(claudeDir(homeDir), 'LICENSE'), LICENSE);

    const status = await readAdhdSkillStatus(deps(homeDir, bundledDir));

    const claude = status.agents.find((a) => a.agent === 'claude');
    const codex = status.agents.find((a) => a.agent === 'codex');
    expect(claude?.state).toBe('installed');
    expect(codex?.state).toBe('not-installed');
    // ONE AGENT INSTALLED IS ENOUGH FOR THE OVERALL PILL: a phone/desktop with
    // only Claude Code installed is not a failure state.
    expect(status.overall).toBe('installed');
  });
});

describe('status: outdated or modified', () => {
  it('flags a hand-edited SKILL.md even though LICENSE still matches', async () => {
    const homeDir = await home();
    const bundledDir = await bundle();
    await mkdir(claudeDir(homeDir), { recursive: true });
    await writeFile(
      join(claudeDir(homeDir), 'SKILL.md'),
      `${SKILL_MD}\nEXTRA LINE THE OPERATOR ADDED\n`,
    );
    await writeFile(join(claudeDir(homeDir), 'LICENSE'), LICENSE);

    const status = await readAdhdSkillStatus(deps(homeDir, bundledDir));

    expect(status.agents.find((a) => a.agent === 'claude')?.state).toBe('outdated-modified');
    expect(status.overall).toBe('outdated-modified');
  });

  it('flags a FOREIGN skill of the same name -- a directory with unrelated content', async () => {
    const homeDir = await home();
    const bundledDir = await bundle();
    await mkdir(claudeDir(homeDir), { recursive: true });
    await writeFile(
      join(claudeDir(homeDir), 'SKILL.md'),
      '---\nname: something-else\n---\nunrelated\n',
    );

    const status = await readAdhdSkillStatus(deps(homeDir, bundledDir));

    // THE POINT: vam cannot tell "an operator edited vam's copy" apart from
    // "an operator's own skill happens to share this name" from content
    // alone, and both must land in the same cautious state rather than one
    // being silently overwritten.
    expect(status.agents.find((a) => a.agent === 'claude')?.state).toBe('outdated-modified');
  });

  it('flags a directory with only ONE of the two bundled files present', async () => {
    const homeDir = await home();
    const bundledDir = await bundle();
    await mkdir(claudeDir(homeDir), { recursive: true });
    await writeFile(join(claudeDir(homeDir), 'SKILL.md'), SKILL_MD);
    // No LICENSE written -- a partial, non-vam-shaped install.

    const status = await readAdhdSkillStatus(deps(homeDir, bundledDir));

    expect(status.agents.find((a) => a.agent === 'claude')?.state).toBe('outdated-modified');
  });
});

describe('install', () => {
  it('writes exactly the two bundled files, byte-identical, to both agent directories', async () => {
    const homeDir = await home();
    const bundledDir = await bundle();

    const result = await installAdhdSkill(deps(homeDir, bundledDir));

    expect(result.status.overall).toBe('installed');
    for (const agent of ['claude', 'codex'] as const) {
      expect(result.agents.find((a) => a.agent === agent)?.kind).toBe('written');
    }
    for (const dir of [claudeDir(homeDir), codexDir(homeDir)]) {
      const names = (await readdir(dir)).sort();
      expect(names).toEqual(['LICENSE', 'SKILL.md']);
      expect(await readFile(join(dir, 'SKILL.md'), 'utf8')).toBe(SKILL_MD);
      expect(await readFile(join(dir, 'LICENSE'), 'utf8')).toBe(LICENSE);
    }
  });

  it('is a no-op, reported as unchanged, when already installed', async () => {
    const homeDir = await home();
    const bundledDir = await bundle();
    await installAdhdSkill(deps(homeDir, bundledDir));

    const second = await installAdhdSkill(deps(homeDir, bundledDir));

    for (const outcome of second.agents) {
      expect(outcome.kind).toBe('unchanged');
    }
  });

  it('REFUSES to overwrite a foreign or modified directory without force', async () => {
    const homeDir = await home();
    const bundledDir = await bundle();
    await mkdir(claudeDir(homeDir), { recursive: true });
    await writeFile(join(claudeDir(homeDir), 'SKILL.md'), 'not the same skill at all');

    const result = await installAdhdSkill(deps(homeDir, bundledDir));

    expect(result.agents.find((a) => a.agent === 'claude')?.kind).toBe('refused');
    // NOT TOUCHED. The whole point of the refusal.
    expect(await readFile(join(claudeDir(homeDir), 'SKILL.md'), 'utf8')).toBe(
      'not the same skill at all',
    );
    expect(result.status.agents.find((a) => a.agent === 'claude')?.state).toBe('outdated-modified');
  });

  it('overwrites a foreign or modified directory when force is true, and only that one', async () => {
    const homeDir = await home();
    const bundledDir = await bundle();
    await mkdir(claudeDir(homeDir), { recursive: true });
    await writeFile(join(claudeDir(homeDir), 'SKILL.md'), 'not the same skill at all');

    const result = await installAdhdSkill(deps(homeDir, bundledDir), true);

    expect(result.agents.find((a) => a.agent === 'claude')?.kind).toBe('written');
    expect(await readFile(join(claudeDir(homeDir), 'SKILL.md'), 'utf8')).toBe(SKILL_MD);
    expect(result.status.overall).toBe('installed');
  });
});

describe('remove', () => {
  it('removes only the files vam wrote, and the now-empty directory with them', async () => {
    const homeDir = await home();
    const bundledDir = await bundle();
    await installAdhdSkill(deps(homeDir, bundledDir));

    const result = await removeAdhdSkill(deps(homeDir, bundledDir));

    for (const outcome of result.agents) {
      expect(outcome.kind).toBe('removed');
    }
    expect(result.status.overall).toBe('not-installed');
    await expect(readdir(claudeDir(homeDir))).rejects.toThrow();
    await expect(readdir(codexDir(homeDir))).rejects.toThrow();
  });

  it('is a quiet no-op when nothing is installed', async () => {
    const homeDir = await home();
    const bundledDir = await bundle();

    const result = await removeAdhdSkill(deps(homeDir, bundledDir));

    for (const outcome of result.agents) {
      expect(outcome.kind).toBe('unchanged');
    }
  });

  it('FALSIFIED: leaves a modified SKILL.md and the directory behind, but still removes a matching LICENSE', async () => {
    const homeDir = await home();
    const bundledDir = await bundle();
    await installAdhdSkill(deps(homeDir, bundledDir));
    // The operator edited just one of the two files after installing.
    await writeFile(join(claudeDir(homeDir), 'SKILL.md'), 'operator edited this after install');

    const result = await removeAdhdSkill(deps(homeDir, bundledDir));

    expect(result.agents.find((a) => a.agent === 'claude')?.kind).toBe('left-foreign');
    // THE EDITED FILE SURVIVES.
    expect(await readFile(join(claudeDir(homeDir), 'SKILL.md'), 'utf8')).toBe(
      'operator edited this after install',
    );
    // THE UNTOUCHED FILE IS GONE, because it was still provably vam's.
    await expect(readFile(join(claudeDir(homeDir), 'LICENSE'), 'utf8')).rejects.toThrow();
  });

  it('leaves an operator-added third file behind, and does not remove the directory', async () => {
    const homeDir = await home();
    const bundledDir = await bundle();
    await installAdhdSkill(deps(homeDir, bundledDir));
    await writeFile(join(claudeDir(homeDir), 'notes.txt'), "my own notes, not vam's");

    const result = await removeAdhdSkill(deps(homeDir, bundledDir));

    expect(result.agents.find((a) => a.agent === 'claude')?.kind).toBe('removed');
    const remaining = await readdir(claudeDir(homeDir));
    expect(remaining).toEqual(['notes.txt']);
  });

  it('never follows a symlinked skill directory outside the home it was given', async () => {
    // FALSIFY THE GUARD: a `.claude/skills/i-have-adhd` that is actually a
    // symlink to somewhere else entirely must not have ITS target's files
    // silently taken as "vam's own" and deleted -- `remove` only acts on
    // files whose CONTENT matches, so a symlink to an unrelated directory
    // with unrelated files is refused the same way any foreign content is.
    const homeDir = await home();
    const bundledDir = await bundle();
    const elsewhere = await tempDir('vam-adhd-elsewhere-');
    await writeFile(join(elsewhere, 'SKILL.md'), "somebody else's file entirely");
    await mkdir(join(homeDir, '.claude', 'skills'), { recursive: true });
    await symlink(elsewhere, claudeDir(homeDir));

    const result = await removeAdhdSkill(deps(homeDir, bundledDir));

    expect(result.agents.find((a) => a.agent === 'claude')?.kind).toBe('left-foreign');
    expect(await readFile(join(elsewhere, 'SKILL.md'), 'utf8')).toBe(
      "somebody else's file entirely",
    );
  });
});

describe('defaultAdhdSkillDeps: the production wiring', () => {
  it('resolves under a temp HOME, never the real one', async () => {
    const fakeHome = await tempDir('vam-adhd-real-home-shape-');
    const appPath = await tempDir('vam-adhd-app-path-');
    const savedHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      const resolved = defaultAdhdSkillDeps(appPath);
      expect(resolved.homeDir).toBe(fakeHome);
      expect(resolved.bundledDir).toBe(join(appPath, 'resources', 'skills', 'i-have-adhd'));
    } finally {
      process.env.HOME = savedHome;
    }
  });
});
