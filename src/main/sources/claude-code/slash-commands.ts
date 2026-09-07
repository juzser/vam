/**
 * Claude Code's own slash commands, for the `/` typeahead (`DetailPanel.tsx`,
 * `slashCommandQuery`). USER-LEVEL ONLY: project-level
 * `<project>/.claude/commands/*.md` depends on the session's own cwd, which
 * this source cannot reliably resolve per `load()`. BUILT-INS NEVER LISTED:
 * `claude --help` names no way to enumerate them for the installed version,
 * and a hand-maintained guess would drift. SILENT, NEVER THROWING.
 */

import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SlashCommand } from '../../../renderer/domain/model.js';

/** Where Claude Code keeps the operator's own custom commands. */
export const defaultUserCommandsDir = (): string => join(homedir(), '.claude', 'commands');

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
 */
export async function readUserSlashCommands(
  dir: string = defaultUserCommandsDir(),
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
      commands.push(commandFromMarkdown(name, contents));
    } catch {
      // One unreadable file is left out, not a failure of the whole read.
    }
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}
