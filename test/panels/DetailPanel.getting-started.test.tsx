// @vitest-environment happy-dom

/**
 * THE GETTING-STARTED SCREEN: the desktop detail pane's Response view when
 * vam has NO session to show anywhere in the app -- first launch (nothing
 * exists yet) or every row hidden by `hideForeign` (PR 456). Distinct from
 * `TerminalOnlyStart` (a pane whose OWN row is a known `terminal` conversation)
 * and from the plain "pane with nothing in it" text this file has always
 * drawn for `entry === null`: this screen is APP-WIDE, so the caller
 * (`Canvas.tsx`) opts it in with the `gettingStarted` prop rather than this
 * panel guessing from `entry` alone -- a pane can hold nothing while a
 * sibling pane, or another project entirely, still has a real session.
 *
 * THE SHORTCUTS MUST MATCH THE CHORD TABLE, the same discipline
 * `DetailPanel.terminal-only.test.tsx` already holds `TerminalOnlyStart` to:
 * one row per action, checked against the row it actually sits beside, never
 * against the list's flattened text.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { chordSymbols } from '../../src/renderer/keyboard/chords.js';
import { primaryChord } from '../../src/renderer/keyboard/ShortcutTip.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const RUNNING: Session = {
  id: 'pane:vam-atlas-aa11bb',
  title: 'fix the flaky test',
  epic: null,
  branch: null,
  status: 'running',
  runningAgents: 1,
  activity: null,
  age: null,
  decisions: [{ id: 'd1', label: 'you', input: 'fix it', output: 'fixing', commands: [] }],
  source: 'claude-code',
  vamControlled: true,
  pane: 'vam-atlas-aa11bb',
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [RUNNING] };
const ENTRY: SessionEntry = { project: PROJECT, session: RUNNING };

function draw(over: Partial<DetailPanelProps> = {}) {
  const props: DetailPanelProps = {
    entry: null,
    decision: null,
    draft: '',
    onDraftChange: () => {},
    onSubmit: () => {},
    composing: false,
    onCompose: () => {},
    onStopComposing: () => {},
    active: false,
    actionIndex: 0,
    width: 408,
    resizeHandle: null,
    ...over,
  };
  render(<DetailPanel {...props} />);
}

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);

afterEach(cleanup);

describe('the getting-started screen -- vam has no session to show anywhere', () => {
  it('is absent when the caller has not opted it in, even with nothing focused', () => {
    draw();
    expect(q('[data-getting-started]')).toBeNull();
  });

  it('is absent when a real session is focused, even if the caller passed the prop', () => {
    // Defensive: `gettingStarted` names an APP-WIDE fact, and a pane that
    // actually holds a session must never be replaced by it.
    draw({
      entry: ENTRY,
      decision: RUNNING.decisions[0] ?? null,
      gettingStarted: {
        onNewProject: () => {},
        newProjectDecline: null,
        hasDirectoryPicker: true,
        foreignHiddenCount: 0,
        onShowForeign: () => {},
      },
    });
    expect(q('[data-getting-started]')).toBeNull();
  });

  it('draws vam’s own mark, reused rather than redrawn', () => {
    draw({
      gettingStarted: {
        onNewProject: () => {},
        newProjectDecline: null,
        hasDirectoryPicker: true,
        foreignHiddenCount: 0,
        onShowForeign: () => {},
      },
    });
    const img = q<HTMLImageElement>('[data-getting-started] img');
    expect(img).not.toBeNull();
    expect(img?.src).toContain('favicon.png');
  });

  it('offers a primary New project button that hands the caller the click', () => {
    const clicks: true[] = [];
    draw({
      gettingStarted: {
        onNewProject: () => clicks.push(true),
        newProjectDecline: null,
        hasDirectoryPicker: true,
        foreignHiddenCount: 0,
        onShowForeign: () => {},
      },
    });
    const button = q('[data-getting-started-new-project]');
    expect(button?.textContent).toContain('New project');
    fireEvent.click(button as Element);
    expect(clicks).toEqual([true]);
  });

  it('withdraws the button and says what needs the desktop app, with no directory picker', () => {
    draw({
      gettingStarted: {
        onNewProject: () => {},
        newProjectDecline: null,
        hasDirectoryPicker: false,
        foreignHiddenCount: 0,
        onShowForeign: () => {},
      },
    });
    expect(q('[data-getting-started-new-project]')).toBeNull();
    const decline = q('[data-getting-started-decline]');
    expect(decline?.textContent).toMatch(/desktop app/);
  });

  it('withdraws the button and says why, when the source itself cannot create one', () => {
    draw({
      gettingStarted: {
        onNewProject: () => {},
        newProjectDecline: 'the factory has no new-session command',
        hasDirectoryPicker: true,
        foreignHiddenCount: 0,
        onShowForeign: () => {},
      },
    });
    expect(q('[data-getting-started-new-project]')).toBeNull();
    expect(q('[data-getting-started-decline]')?.textContent).toContain(
      'the factory has no new-session command',
    );
  });

  it('lists New session, New project and the command palette, each with ITS OWN current chord', () => {
    draw({
      gettingStarted: {
        onNewProject: () => {},
        newProjectDecline: null,
        hasDirectoryPicker: true,
        foreignHiddenCount: 0,
        onShowForeign: () => {},
      },
    });
    const list = q('[data-getting-started-shortcuts]');
    expect(list).not.toBeNull();
    const rows = [...(list?.querySelectorAll('li') ?? [])];
    const actions = [{ kind: 'newSession' }, { kind: 'newProject' }, { kind: 'palette' }] as const;
    expect(rows).toHaveLength(actions.length);
    actions.forEach((action, index) => {
      const chord = primaryChord(action);
      expect(chord, `${action.kind} must be bound for this to test anything`).not.toBeNull();
      const chip = rows[index]?.querySelector('[data-inline-chord]');
      expect(chip?.textContent, `row ${index} (${action.kind})`).toBe(
        chordSymbols(chord as string),
      );
    });
  });

  it('says nothing about hidden sessions when none are hidden', () => {
    draw({
      gettingStarted: {
        onNewProject: () => {},
        newProjectDecline: null,
        hasDirectoryPicker: true,
        foreignHiddenCount: 0,
        onShowForeign: () => {},
      },
    });
    expect(q('[data-getting-started-hidden]')).toBeNull();
  });

  it('names how many sessions hideForeign is hiding, and a way back -- PR 456’s own pref', () => {
    const shown: true[] = [];
    draw({
      gettingStarted: {
        onNewProject: () => {},
        newProjectDecline: null,
        hasDirectoryPicker: true,
        foreignHiddenCount: 3,
        onShowForeign: () => shown.push(true),
      },
    });
    const line = q('[data-getting-started-hidden]');
    expect(line?.textContent).toContain('3 sessions hidden');
    expect(line?.textContent).toContain('vam did not start them');
    fireEvent.click(q('[data-getting-started-show]') as Element);
    expect(shown).toEqual([true]);
  });

  it('reads one session, singular, for exactly one hidden row', () => {
    draw({
      gettingStarted: {
        onNewProject: () => {},
        newProjectDecline: null,
        hasDirectoryPicker: true,
        foreignHiddenCount: 1,
        onShowForeign: () => {},
      },
    });
    const line = q('[data-getting-started-hidden]');
    expect(line?.textContent).toContain('1 session hidden');
    expect(line?.textContent).toContain('vam did not start it');
  });

  it('replaces the plain "no session" text, not the reverse', () => {
    draw({
      gettingStarted: {
        onNewProject: () => {},
        newProjectDecline: null,
        hasDirectoryPicker: true,
        foreignHiddenCount: 0,
        onShowForeign: () => {},
      },
    });
    expect(document.body.textContent ?? '').not.toMatch(/no session selected/i);
  });

  it('is drawn only on Response -- the Terminal view is the other way in, unaffected', () => {
    draw({
      tab: 'Terminal',
      terminal: true,
      gettingStarted: {
        onNewProject: () => {},
        newProjectDecline: null,
        hasDirectoryPicker: true,
        foreignHiddenCount: 0,
        onShowForeign: () => {},
      },
    });
    expect(q('[data-getting-started]')).toBeNull();
  });
});
