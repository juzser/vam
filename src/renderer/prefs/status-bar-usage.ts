/**
 * THE STATUS BAR'S OWN USAGE CELL: whether it reads as `used` or as
 * `remaining`, and whether Claude's and Codex's own readings each get a cell
 * at all.
 *
 * Three flags, one file -- unlike every other one-flag module here -- because
 * they are one operator decision seen three ways: "how do I want my usage
 * numbers read". `PR 518` built the reading (`shared/usage.ts`,
 * `shared/codex-usage.ts`) and a popover to show both providers' numbers on
 * demand; this is the settings surface that decides what the STATUS BAR,
 * which is on screen all the time, shows of that same data without being
 * asked.
 *
 * CLAUDE DEFAULTS ON, because the bar has shown Claude's usage unconditionally
 * since before this switch existed -- an operator who never opens Settings
 * must see the identical bar they always have. CODEX DEFAULTS OFF: showing it
 * is a NEW cell (and a new poll main was not making before), so it must not
 * appear -- or start reading `~/.codex` on a timer -- for somebody who never
 * asked for it.
 */

import type { UsageDisplayMode } from '../../shared/usage.js';

/** Re-exported from `shared/usage.ts`, which is where `describeUsage` (both
 *  Claude's and, via `codex-usage.ts`, Codex's) actually reads this word --
 *  one declaration, not two that happen to agree today. */
export type { UsageDisplayMode };

export const DEFAULT_USAGE_DISPLAY_MODE: UsageDisplayMode = 'used';
export const DEFAULT_STATUS_BAR_SHOW_CLAUDE_USAGE = true;
export const DEFAULT_STATUS_BAR_SHOW_CODEX_USAGE = false;

export function readUsageDisplayMode(raw: unknown): UsageDisplayMode {
  return raw === 'used' || raw === 'remaining' ? raw : DEFAULT_USAGE_DISPLAY_MODE;
}

/** A boolean is a choice; anything else is the default -- the same symmetric
 *  read every switch-backed preference in this tree takes. */
export function readStatusBarShowClaudeUsage(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : DEFAULT_STATUS_BAR_SHOW_CLAUDE_USAGE;
}

export function readStatusBarShowCodexUsage(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : DEFAULT_STATUS_BAR_SHOW_CODEX_USAGE;
}
