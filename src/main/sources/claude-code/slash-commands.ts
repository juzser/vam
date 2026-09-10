/**
 * The COMMAND FILES behind the `/` typeahead (`DetailPanel.tsx`,
 * `slashCommandQuery`) -- markdown on disk, in the two directories Claude Code
 * reads them from. SILENT, NEVER THROWING.
 *
 * TWO TIERS, AND THE HEADER USED TO CLAIM ONE. It said project-level
 * `<project>/.claude/commands/*.md` "depends on the session's own cwd, which
 * this source cannot reliably resolve per `load()`". That was false the day it
 * was written: `loadClaudeCodeProjects` holds `agent.cwd` for every row and
 * already spends it on `branchOf(agent.cwd)` and `readPrs({ cwd: agent.cwd })`.
 * What is real is the COST, and `createProjectCommandLookup` is the answer to
 * it: sessions in one project share a directory, so it is read once per
 * `load()` per directory, the way `createBranchLookup` reads `.git/HEAD`.
 *
 * THE THIRD TIER IS NOT HERE. Claude Code's BUILT-IN commands are not files
 * and cannot be read off a disk; `builtin-commands.ts` asks the installed CLI
 * to list them, and `mergeSlashCommands` below is where the three tiers become
 * the one list a session carries.
 */

import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SlashCommand } from '../../../renderer/domain/model.js';

/** Where Claude Code keeps the operator's own custom commands. */
export const defaultUserCommandsDir = (): string => join(homedir(), '.claude', 'commands');

/** Where a session's own project keeps its commands, relative to the session's cwd. */
export const projectCommandsDir = (cwd: string): string => join(cwd, '.claude', 'commands');

/** The `description:` line out of a command file's frontmatter, or `null`. */
function frontmatterDescription(contents: string): string | null {
  if (!contents.startsWith('---')) return null;
  const end = contents.indexOf('\n---', 3);
  if (end === -1) return null;
  const frontmatter = contents.slice(3, end);
  const line = frontmatter.split('\n').find((row) => row.trimStart().startsWith('description:'));
  if (line === undefined) return null;
  const value = line.slice(line.indexOf(':') + 1).trim();
  const quoted = value.match(/^"(.*)"$/) ?? value.match(/^'(.*)'$/);
  return quoted?.[1] ?? (value || null);
}

/** One command file's name plus its frontmatter description, if it has one. */
export function commandFromMarkdown(name: string, contents: string): SlashCommand {
  return { id: name, name, description: frontmatterDescription(contents) };
}

/**
 * Every `*.md` file under `dir`, sorted by name. A missing/unreadable
 * directory, or one bad file inside it, just drops that entry.
 *
 * `idPrefix` is what keeps three tiers' ids apart once they are merged: a
 * project and the user can both own `ship.md`, and two rows with one id is a
 * React key collision in the popover, not a harmless duplicate. It is the ID
 * only -- the NAME stays what the operator types.
 */
export async function readSlashCommandsIn(
  dir: string,
  idPrefix = '',
): Promise<readonly SlashCommand[]> {
  let entries: readonly string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const commands: SlashCommand[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const name = entry.slice(0, -3);
    try {
      const contents = await readFile(join(dir, entry), 'utf8');
      const command = commandFromMarkdown(name, contents);
      commands.push(idPrefix === '' ? command : { ...command, id: `${idPrefix}${name}` });
    } catch {
      // One unreadable file is left out, not a failure of the whole read.
    }
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

/** The operator's own commands, `~/.claude/commands/*.md`. */
export function readUserSlashCommands(
  dir: string = defaultUserCommandsDir(),
): Promise<readonly SlashCommand[]> {
  return readSlashCommandsIn(dir, 'user:');
}

/**
 * A per-directory lookup, cached for the life of the object it returns -- one
 * `load()`'s worth of sessions.
 *
 * THIS IS THE COST ANSWER, and it is why project commands are readable at all.
 * `load()` is documented as costing kilobytes (`source.ts`), and the sessions
 * it opens are single digits sharing a handful of directories: reading per
 * SESSION would spend a `readdir` plus a `readFile` per file on every row of
 * every poll, for a list that is identical across the rows of one project.
 * `createBranchLookup` solves the same problem for `.git/HEAD` and this is the
 * same shape, deliberately.
 */
export function createProjectCommandLookup(
  read: (dir: string) => Promise<readonly SlashCommand[]> = (dir) =>
    readSlashCommandsIn(dir, 'project:'),
): (cwd: string) => Promise<readonly SlashCommand[]> {
  const cache = new Map<string, Promise<readonly SlashCommand[]>>();
  return (cwd: string) => {
    const dir = projectCommandsDir(cwd);
    let result = cache.get(dir);
    if (result === undefined) {
      result = read(dir).catch(() => []);
      cache.set(dir, result);
    }
    return result;
  };
}

/**
 * The tiers as ONE list, most specific first: project, then user, then the
 * CLI's built-ins.
 *
 * A name appears once. That is the precedence Claude Code itself applies --
 * the more specific definition is the one that runs -- so a popover that
 * offered both would offer a choice the operator does not actually have.
 * Sorted by name afterwards, because one list that reads as three concatenated
 * ones is three lists wearing one border.
 */
export function mergeSlashCommands(
  ...tiers: readonly (readonly SlashCommand[])[]
): readonly SlashCommand[] {
  const byName = new Map<string, SlashCommand>();
  for (const tier of tiers) {
    for (const command of tier) {
      if (!byName.has(command.name)) byName.set(command.name, command);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
