/**
 * Claude Code's own slash commands, read off the user-level commands
 * directory (`~/.claude/commands/*.md`).
 *
 * Every fixture here lives under a fresh `mkdtemp` directory; the operator's
 * real `~/.claude/commands` is never read by these tests, and nothing off
 * this machine -- no home path, no real command name -- is reproduced here.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commandFromMarkdown,
  createProjectCommandLookup,
  mergeSlashCommands,
  projectCommandsDir,
  readUserSlashCommands,
} from '../../src/main/sources/claude-code/slash-commands.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vam-slash-commands-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (name: string, contents: string) => writeFileSync(join(root, name), contents);

describe('commandFromMarkdown', () => {
  it('reads and unquotes the description out of the frontmatter', () => {
    expect(
      commandFromMarkdown('wombat', '---\ndescription: does wombat things\n---\n\nbody\n'),
    ).toEqual({ id: 'wombat', name: 'wombat', description: 'does wombat things' });
    expect(
      commandFromMarkdown('wombat', '---\ndescription: "quoted, with a comma"\n---\n').description,
    ).toBe('quoted, with a comma');
  });

  it('answers a null description when there is no frontmatter, or none in it', () => {
    expect(commandFromMarkdown('wombat', 'just a body, no frontmatter\n').description).toBeNull();
    expect(
      commandFromMarkdown('wombat', '---\nallowed-tools: Bash(node:*)\n---\nbody\n').description,
    ).toBeNull();
  });
});

describe('readUserSlashCommands', () => {
  it('answers nothing for a directory that does not exist', async () => {
    expect(await readUserSlashCommands(join(root, 'nope'))).toEqual([]);
  });

  it('reads every .md file as one command, named off the file, ignoring the rest', async () => {
    write('wombat.md', '---\ndescription: does wombat things\n---\n');
    write('otter.md', '---\ndescription: does otter things\n---\n');
    write('notes.txt', 'not a command');
    const commands = await readUserSlashCommands(root);
    expect(commands.map((c) => c.name)).toEqual(['otter', 'wombat']);
  });

  it('is silent, not throwing, on an unreadable directory or one bad file inside it', async () => {
    // A file where a directory was expected fails `readdir` the same way an
    // unreadable directory would, without a permissions dance that behaves
    // differently by platform.
    const blocked = join(root, 'blocked');
    writeFileSync(blocked, 'not a directory');
    await expect(readUserSlashCommands(blocked)).resolves.toEqual([]);

    write('wombat.md', '---\ndescription: does wombat things\n---\n');
    mkdirSync(join(root, 'otter.md')); // a directory where a file was expected
    const commands = await readUserSlashCommands(root);
    expect(commands.map((c) => c.name)).toEqual(['wombat']);
  });
});

/**
 * PROJECT-LEVEL COMMANDS, `<cwd>/.claude/commands/*.md`.
 *
 * The module header used to say these could not be read because they "depend
 * on the session's own cwd, which this source cannot reliably resolve per
 * `load()`". That was false when it was written: `loadClaudeCodeProjects`
 * already has `agent.cwd` in hand and already spends it on
 * `branchOf(agent.cwd)` and `readPrs({ cwd: agent.cwd })`, per session, every
 * load.
 *
 * What is true is the COST, and that is what the lookup below is about:
 * sessions in one project share a cwd, so the directory is read once per
 * `load()` per directory, exactly the way `createBranchLookup` handles
 * `.git/HEAD`.
 */
describe('project-level commands, read per project rather than per session', () => {
  const commandsIn = (dir: string) => {
    mkdirSync(join(dir, '.claude', 'commands'), { recursive: true });
    return (name: string, contents: string) =>
      writeFileSync(join(dir, '.claude', 'commands', name), contents);
  };

  it('reads `<cwd>/.claude/commands/*.md` for a session’s own directory', async () => {
    const project = join(root, 'atlas');
    mkdirSync(project);
    commandsIn(project)('ship.md', '---\ndescription: ship the branch\n---\n');
    const lookup = createProjectCommandLookup();
    expect(await lookup(project)).toEqual([
      { id: 'project:ship', name: 'ship', description: 'ship the branch' },
    ]);
  });

  it('answers an empty list for a directory with no .claude/commands at all', async () => {
    const project = join(root, 'bare');
    mkdirSync(project);
    expect(await createProjectCommandLookup()(project)).toEqual([]);
  });

  it('reads each directory ONCE per load, however many sessions share it', async () => {
    // THE COST CONTRACT, as a test. `source.ts` documents `load()` as costing
    // kilobytes; a read per session would make it cost a read per row.
    const seen: string[] = [];
    const lookup = createProjectCommandLookup(async (dir) => {
      seen.push(dir);
      return [];
    });
    await Promise.all([lookup('/a'), lookup('/a'), lookup('/b'), lookup('/a')]);
    expect(seen).toEqual([projectCommandsDir('/a'), projectCommandsDir('/b')]);
  });
});

/**
 * MERGING THE TIERS. One list per session, most specific first: a project
 * command shadows a user command of the same name, which shadows a built-in.
 */
describe('mergeSlashCommands', () => {
  const cmd = (id: string, name: string, description: string | null = null) => ({
    id,
    name,
    description,
  });

  it('keeps the most specific of two commands sharing a name', () => {
    const merged = mergeSlashCommands(
      [cmd('project:ship', 'ship', 'the project’s own')],
      [cmd('user:ship', 'ship', 'the operator’s own')],
      [cmd('builtin:ship', 'ship', 'the CLI’s own')],
    );
    expect(merged).toEqual([cmd('project:ship', 'ship', 'the project’s own')]);
  });

  it('sorts by name so one list reads as one list', () => {
    const merged = mergeSlashCommands(
      [cmd('project:otter', 'otter')],
      [cmd('user:wombat', 'wombat')],
      [cmd('builtin:aardvark', 'aardvark')],
    );
    expect(merged.map((c) => c.name)).toEqual(['aardvark', 'otter', 'wombat']);
  });
});
