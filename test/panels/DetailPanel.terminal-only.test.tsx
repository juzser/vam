// @vitest-environment happy-dom

/**
 * The Response view of a `terminal` row -- a pane whose agent exited but
 * whose conversation vam still knows (`model.ts`, `docs/design/vam-terminal-
 * only.md`).
 *
 * THE OPERATOR'S OWN REVISION governs this screen's shape: a getting-started
 * screen (mark, info line, shortcuts, provider picker, Start session), NOT
 * the transcript with a footer bar -- that was the first draft, and this
 * file tests the second. Resume is kept as a SECONDARY, quieter action for
 * the conversation this pane last hosted.
 *
 * THE SHORTCUTS MUST MATCH THE CHORD TABLE, never a hard-coded string: every
 * assertion about a key below reads it from `chordSymbols`/`primaryChord`,
 * the same functions the screen itself calls through `InlineChord`, so a
 * rebind is exactly as likely to break this test as it is to break the
 * screen -- which is the point.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { chordSymbols } from '../../src/renderer/keyboard/chords.js';
import { primaryChord } from '../../src/renderer/keyboard/ShortcutTip.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import { PROVIDERS } from '../../src/shared/providers.js';

const TERMINAL: Session = {
  id: 'pane:vam-atlas-aa11bb',
  title: 'fix the flaky test',
  epic: null,
  branch: 'feature/x',
  status: 'terminal',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [{ id: 'd1', label: 'you', input: 'fix it', output: 'fixed', commands: [] }],
  source: 'claude-code',
  vamControlled: true,
  pane: 'vam-atlas-aa11bb',
  resumeCommand: 'claude --resume aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [TERMINAL] };
const ENTRY: SessionEntry = { project: PROJECT, session: TERMINAL };

function draw(over: Partial<DetailPanelProps> = {}) {
  const props: DetailPanelProps = {
    entry: ENTRY,
    decision: TERMINAL.decisions[0] ?? null,
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
const all = (selector: string) => [...document.querySelectorAll(selector)];

afterEach(cleanup);

describe('the Response view of a pane whose agent exited but whose conversation is known', () => {
  it('draws the getting-started screen instead of the transcript -- no turns, no composer', () => {
    draw({ onStartSession: () => {} });
    expect(q('[data-terminal-only-start]')).not.toBeNull();
    // NOT the plain unstarted screen, and not the transcript either.
    expect(q('[data-start-session]')).toBeNull();
    expect(q('textarea')).toBeNull();
    expect(q('[data-prompt-row]')).toBeNull();
    // The turn this fixture carries (`decisions[0]`, "fixed") must not be on
    // screen -- the whole point of the operator's revision is that this
    // screen replaces the transcript, not that it sits above one.
    expect(document.body.textContent).not.toContain('fixed');
  });

  it('names the conversation, not the pane, as its headline', () => {
    draw({ onStartSession: () => {} });
    expect(q('[data-terminal-only-start]')?.textContent).toContain('fix the flaky test');
  });

  it('says the pane is at a shell prompt, and names the pane too', () => {
    draw({ onStartSession: () => {} });
    const text = q('[data-terminal-only-start]')?.textContent ?? '';
    expect(text).toContain('vam-atlas-aa11bb');
    expect(text).toMatch(/shell prompt/);
  });

  it('shows vam’s own mark, reused rather than redrawn', () => {
    draw({ onStartSession: () => {} });
    const img = q<HTMLImageElement>('[data-terminal-only-start] img');
    expect(img).not.toBeNull();
    expect(img?.src).toContain('favicon.png');
  });

  it('lists New session, New project and the command palette, each with ITS OWN current chord', () => {
    draw({ onStartSession: () => {} });
    const list = q('[data-terminal-only-shortcuts]');
    expect(list).not.toBeNull();
    // ONE ROW PER ACTION, IN THIS ORDER -- the shape the screen renders in --
    // so each chip is checked against the action it actually sits beside,
    // never against the list's flattened text: a chip's symbol can be a
    // single letter, and `list.textContent.includes('o')` would pass on the
    // word "session" alone, proving nothing. `nth-child` pins the pairing.
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

  it('offers the same provider picker and Start session as the plain start screen -- one implementation', () => {
    const started: string[] = [];
    draw({ onStartSession: (id) => started.push(id) });
    const options = all('[data-start-provider]');
    expect(options.map((o) => o.getAttribute('data-start-provider'))).toEqual(
      PROVIDERS.map((p) => p.id),
    );
    fireEvent.click(q('[data-start-provider="codex"]') as Element);
    fireEvent.click(q('[data-start-session-button]') as Element);
    expect(started).toEqual(['codex']);
  });

  it('offers Resume as a secondary action, naming the conversation, when the row carries one', () => {
    const resumed: true[] = [];
    draw({ onStartSession: () => {}, onResumeInPane: () => resumed.push(true) });
    const button = q('[data-resume-in-pane]');
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain('fix the flaky test');
    fireEvent.click(button as Element);
    expect(resumed).toEqual([true]);
  });

  it('withholds Resume when the row carries no resumeCommand -- vam could not build one', () => {
    const noResume: Session = { ...TERMINAL, resumeCommand: undefined };
    draw({
      entry: { project: PROJECT, session: noResume },
      onStartSession: () => {},
      onResumeInPane: () => {},
    });
    expect(q('[data-resume-in-pane]')).toBeNull();
  });

  it('withholds Resume when the caller gave no route to it, even though the row has a command', () => {
    draw({ onStartSession: () => {} });
    expect(q('[data-resume-in-pane]')).toBeNull();
  });

  it('says so, and offers neither Start nor Resume, when the caller has no route to type with', () => {
    draw();
    expect(q('[data-terminal-only-start]')).not.toBeNull();
    expect(q('[data-start-session-button]')).toBeNull();
    expect(q('[data-resume-in-pane]')).toBeNull();
    expect(q('[data-terminal-only-start]')?.textContent).toMatch(/Terminal/);
  });

  it('is drawn only on Response -- the Terminal view is the other way in, unaffected', () => {
    draw({ onStartSession: () => {}, tab: 'Terminal', terminal: true });
    expect(q('[data-terminal-only-start]')).toBeNull();
  });
});
