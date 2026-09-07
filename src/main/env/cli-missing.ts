/**
 * The sentence every `ENOENT` from a spawned CLI (`claude`, `gh`, `tmux`)
 * becomes, across `deliver.ts`, `stop.ts`, `agents.ts` and
 * `pull-requests.ts`. "The `claude` command was not found" is true and tells
 * an operator nothing actionable -- this adds where vam looked and what
 * would fix it, without pasting the operator's whole (possibly long) PATH
 * into an error surface.
 */

import { homedir } from 'node:os';
import { fallbackDirs } from './resolve-path.js';

/**
 * `context` is a clause continuing "..., so <context>", matching the style
 * every call site already used before this file existed.
 */
export function cliMissingMessage(binary: string, context: string): string {
  const checked = fallbackDirs(homedir())
    .concat(['the directories your login shell reports at launch'])
    .join(', ');
  return (
    `the \`${binary}\` command was not found on PATH, so ${context}. ` +
    `vam checked: ${checked} — if ${binary} is installed elsewhere, add its directory to PATH ` +
    `(or move/symlink it into one of the locations above) and relaunch vam.`
  );
}
