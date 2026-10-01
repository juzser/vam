import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Operator events #43/#44: the visible copy below started a label or
// sentence in lower case. Only the first letter changes. aria-labels are
// accessible names, not visible copy, so they are stripped before matching.
const ROWS: Array<[file: string, before: string, after: string]> = [
  ['errors/ErrorLogPanel.tsx', 'error log', 'Error log'],
  ['errors/ErrorLogPanel.tsx', 'nothing has failed yet', 'Nothing has failed yet'],
  ['panels/KeySheet.tsx', 'keyboard', 'Keyboard'],
  [
    'panels/KeySheet.tsx',
    'search by what it does, or by the key…',
    'Search by what it does, or by the key…',
  ],
  ['panels/GroupPicker.tsx', 'move', 'Move'],
  ['panels/GroupPicker.tsx', 'folder name', 'Folder name'],
  ['panels/ProjectPicker.tsx', 'repos in', 'Repos in'],
  ['phone/SessionCreatePicker.tsx', 'new session in', 'New session in'],
  ['panels/SessionList.tsx', 'project name', 'Project name'],
  ['panels/SessionList.tsx', 'repo name', 'Repo name'],
  ['panels/FilesTab.tsx', 'new file…', 'New file…'],
  ['panels/worktrees/WorktreesSection.tsx', 'uncommitted changes', 'Uncommitted changes'],
  ['panels/worktrees/WorktreesSection.tsx', 'worktree name', 'Worktree name'],
  [
    'panels/worktrees/WorktreesSection.tsx',
    'base ref (current branch)',
    'Base ref (current branch)',
  ],
  ['settings/PairedDeviceList.tsx', 'this device', 'This device'],
];

function visibleSource(file: string): string {
  const src = readFileSync(resolve(__dirname, '../../src/renderer', file), 'utf8');
  return src.replace(/aria-label="[^"]*"/g, '');
}

function appearsAsCopy(src: string, text: string): boolean {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A string literal / attribute value, or JSX text between tags or on its own line.
  return new RegExp(`(["'>]|^[ \\t]*)${escaped}(["'<]|[ \\t]*$)`, 'm').test(src);
}

describe('sentence-case pass (events #43 and #44)', () => {
  it.each(ROWS)('%s: "%s" becomes "%s"', (file, before, after) => {
    const src = visibleSource(file);
    expect(appearsAsCopy(src, after)).toBe(true);
    expect(appearsAsCopy(src, before)).toBe(false);
  });
});
