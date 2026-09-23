// @vitest-environment happy-dom

/**
 * The palette's row builder, in isolation.
 *
 * `docs/design/canvas-layout.md` §4 mounts this over a real `entries` array
 * built by `allSessions`/`orderedSessions` — nothing here invents a shape the
 * selectors do not already produce. Two sources reading the same working
 * directory are two `Project` objects, same `name`, different `id`
 * (`Canvas.two-sources.test.tsx` fixes that shape down): `claude-code`'s
 * `projectIdOf(cwd)` and `codex`'s `codex:${basename}-${hash}` never agree,
 * so the palette's naive "one row per session, prefixed with its own
 * project's name" printed the same `vam/` prefix twice with nothing to say
 * they were the same checkout.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { CommandPalette } from '../../src/renderer/panels/CommandPalette.js';

afterEach(cleanup);

function project(over: Partial<Project>): Project {
  return { id: 'p', name: 'vam', source: 'claude-code', sessions: [], ...over };
}

function session(over: Partial<Session>): Session {
  return {
    id: 's',
    title: 'a session',
    epic: null,
    branch: null,
    status: 'idle',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    ...over,
  };
}

/** Every project-name label the palette painted, in DOM order. */
function projectLabels(): string[] {
  return [...document.querySelectorAll('[data-command-palette] [data-palette-project]')].map(
    (el) => el.textContent ?? '',
  );
}

describe('the command palette, reading a checkout two sources both report', () => {
  it('prints the project name once, not once per source', () => {
    const claudeCode = project({ id: 'claude-code:vam', name: 'vam', source: 'claude-code' });
    const codex = project({ id: 'codex:vam', name: 'vam', source: 'codex' });
    const entries: SessionEntry[] = [
      {
        project: claudeCode,
        session: session({ id: 'cc-1', title: 'fix the thing', source: 'claude-code' }),
      },
      {
        project: codex,
        session: session({ id: 'codex-1', title: 'a codex thread', source: 'codex' }),
      },
    ];

    render(<CommandPalette entries={entries} onPick={() => {}} onClose={() => {}} />);

    const labels = projectLabels();
    // Both sessions must still be reachable — this is a display fix, not a
    // session drop.
    expect(document.body.textContent).toContain('fix the thing');
    expect(document.body.textContent).toContain('a codex thread');
    // But the checkout itself is named once: two `vam/` labels for one
    // directory is the bug the operator saw.
    expect(labels.filter((label) => label === 'vam/')).toHaveLength(1);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('still prints each project once for genuinely different checkouts', () => {
    const alpha = project({ id: 'claude-code:alpha', name: 'alpha', source: 'claude-code' });
    const beta = project({ id: 'claude-code:beta', name: 'beta', source: 'claude-code' });
    const entries: SessionEntry[] = [
      { project: alpha, session: session({ id: 'a1', title: 'alpha one' }) },
      { project: beta, session: session({ id: 'b1', title: 'beta one' }) },
    ];

    render(<CommandPalette entries={entries} onPick={() => {}} onClose={() => {}} />);

    expect(projectLabels().sort()).toEqual(['alpha/', 'beta/']);
  });
});
