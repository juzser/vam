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
