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

import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
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

    render(
      <CommandPalette
        entries={entries}
        onPick={() => {}}
        onRunAction={() => {}}
        hasFocusedSession={false}
        onClose={() => {}}
      />,
    );

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

    render(
      <CommandPalette
        entries={entries}
        onPick={() => {}}
        onRunAction={() => {}}
        hasFocusedSession={false}
        onClose={() => {}}
      />,
    );

    expect(projectLabels().sort()).toEqual(['alpha/', 'beta/']);
  });
});

describe('the command palette, switching between sessions and actions', () => {
  const entries: SessionEntry[] = [
    { project: project({}), session: session({ id: 's1', title: 'fix the thing' }) },
  ];

  function open(hasFocusedSession: boolean, onRunAction: (action: unknown) => void = () => {}) {
    render(
      <CommandPalette
        entries={entries}
        onPick={() => {}}
        onRunAction={onRunAction as never}
        hasFocusedSession={hasFocusedSession}
        onClose={() => {}}
      />,
    );
    return screen.getByRole('combobox');
  }

  it('starts in session mode, with the session-mode hint and the session list drawn', () => {
    open(false);
    expect(document.body.textContent).toContain('fix the thing');
    expect(document.querySelector('[data-palette-mode]')?.getAttribute('data-palette-mode')).toBe(
      'sessions',
    );
    expect(document.querySelector('[data-palette-hint]')?.textContent).toMatch(/for actions/i);
  });

  it('switches to action mode the moment the query starts with /, without closing', async () => {
    const input = open(false);
    await userEvent.type(input, '/');
    expect(document.querySelector('[data-palette-mode]')?.getAttribute('data-palette-mode')).toBe(
      'actions',
    );
    expect(document.querySelector('[data-palette-hint]')?.textContent).toMatch(/back to sessions/i);
    // Still open, still holding its own DOM — the palette is the thing
    // that would have unmounted it.
    expect(document.querySelector('[data-command-palette]')).not.toBeNull();
  });

  it('returns to session mode the instant the leading / is deleted', async () => {
    const input = open(false);
    await userEvent.type(input, '/close');
    await userEvent.clear(input);
    expect(document.querySelector('[data-palette-mode]')?.getAttribute('data-palette-mode')).toBe(
      'sessions',
    );
  });

  it('filters the action list by what follows the /', async () => {
    const input = open(true);
    await userEvent.type(input, '/close session');
    const items = [...document.querySelectorAll('[data-command-palette] [cmdk-item]')].map(
      (el) => el.textContent ?? '',
    );
    expect(items.some((text) => /close session/i.test(text))).toBe(true);
    expect(items.some((text) => /new project/i.test(text))).toBe(false);
  });

  it('draws the row’s short Title Case name, not the key sheet’s sentence', async () => {
    const input = open(true);
    await userEvent.type(input, '/new project');
    const row = [...document.querySelectorAll('[data-command-palette] [cmdk-item]')].find((el) =>
      /^New Project/.test(el.textContent ?? ''),
    );
    expect(row).toBeDefined();
    // The key sheet's own sentence for this action -- must not appear here.
    expect(row?.textContent).not.toMatch(/choose a directory to start it in/i);
  });

  it('draws only the PRIMARY bound chord beside a row — not every chord joined with "or"', async () => {
    const input = open(true);
    await userEvent.type(input, '/close session');
    const row = [...document.querySelectorAll('[data-command-palette] [cmdk-item]')].find((el) =>
      /^Close Session/.test(el.textContent ?? ''),
    );
    expect(row).toBeDefined();
    // `close` holds two chords (`x` and `Mod-w`, in that table order) — only
    // the primary one, `x`, paints; `Mod-w`'s own ⌘ must not appear.
    expect(row?.textContent).toMatch(/x/);
    expect(row?.textContent).not.toMatch(/⌘/);
    expect(row?.textContent).not.toMatch(/\bor\b/i); // never a second chord joined by "or"
  });

  it('disables a session-scoped row with no session focused, and shows why', async () => {
    // The title alone disambiguates now: "Close Split" carries no "session".
    const input = open(false);
    await userEvent.type(input, '/close session');
    const row = document.querySelector('[data-command-palette] [cmdk-item][aria-disabled="true"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toMatch(/close session/i);
    expect(row?.textContent).toMatch(/pick a session first/i);
  });

  it('enables the same row once a session is focused', async () => {
    const input = open(true);
    await userEvent.type(input, '/close session');
    const row = [...document.querySelectorAll('[data-command-palette] [cmdk-item]')].find((el) =>
      /close session/i.test(el.textContent ?? ''),
    );
    expect(row?.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('running an action dispatches the exact action object through onRunAction', async () => {
    // Closing the palette on dispatch is `Canvas.tsx`'s own wiring
    // (`onRunAction={(action) => { runAction(action); setPaletteOpen(false);
    // }}`) — this component's contract stops at calling the callback with the
    // action a chord would have run.
    const seen: unknown[] = [];
    const input = open(true, (action) => seen.push(action));
    await userEvent.type(input, '/settings{Enter}');
    expect(seen).toEqual([{ kind: 'settings' }]);
  });

  it('never dispatches a disabled row, even on Enter', async () => {
    const seen: unknown[] = [];
    const input = open(false, (action) => seen.push(action));
    await userEvent.type(input, '/close session');
    // The disabled row is the only match; Enter must not run it.
    await userEvent.keyboard('{Enter}');
    expect(seen).toEqual([]);
  });
});
