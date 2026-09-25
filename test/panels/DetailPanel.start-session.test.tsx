// @vitest-environment happy-dom

/**
 * The Response view of a pane with nothing started in it --
 * `docs/design/vam-owns-the-session.md` §3: "a Response view whose empty
 * state is the provider picker and the Start session button".
 *
 * WHAT THIS SCREEN IS NOT: a composer. A prompt typed into a shell would run
 * as a shell command, and a screen that offers a prompt box over a pane with
 * no agent in it promises an answer nothing will give. So the composer is
 * withdrawn on this status the way `composerHidden` withdraws it for a source
 * that records nothing, and the one act on offer is Start.
 *
 * Start TYPES: the button hands the caller the provider id, and the caller
 * (`Canvas.tsx`, `startSessionIn`) sends that provider's command through
 * `recordPrompt` -- the same keystrokes the operator could type by hand in
 * the Terminal view. Nothing is spawned; that is asserted at the source in
 * `claude-code-start-in-pane.test.ts`, and here by the shape of the prop.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import {
  DetailPanel,
  type DetailPanelProps,
  type StartingPaneWait,
} from '../../src/renderer/panels/DetailPanel.js';
import { PROVIDERS } from '../../src/shared/providers.js';

const EMPTY: Session = {
  id: 'pane:vam-atlas-aa11bb',
  title: 'vam-atlas-aa11bb',
  epic: null,
  branch: null,
  status: 'unstarted',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [],
  source: 'claude-code',
  vamControlled: true,
  pane: 'vam-atlas-aa11bb',
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [EMPTY] };
const ENTRY: SessionEntry = { project: PROJECT, session: EMPTY };

function draw(over: Partial<DetailPanelProps> = {}) {
  const props: DetailPanelProps = {
    entry: ENTRY,
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
const all = (selector: string) => [...document.querySelectorAll(selector)];

afterEach(cleanup);

describe('the Response view of a pane with nothing started in it', () => {
  it('draws the start screen, and no composer, no turns, no "no steps yet"', () => {
    draw({ onStartSession: () => {} });
    expect(q('[data-start-session]')).not.toBeNull();
    expect(q('textarea')).toBeNull();
    expect(q('[data-prompt-row]')).toBeNull();
    expect(document.body.textContent).not.toContain('no steps yet');
  });

  it('offers every provider in the table, as a pressed-state group, default first', () => {
    // The same shape the settings section's picker has (`SettingsOverlay`):
    // a group of `aria-pressed` buttons, exactly one pressed.
    draw({ onStartSession: () => {} });
    const options = all('[data-start-provider]');
    expect(options.map((o) => o.getAttribute('data-start-provider'))).toEqual(
      PROVIDERS.map((p) => p.id),
    );
    expect(options.map((o) => o.tagName)).toEqual(options.map(() => 'BUTTON'));
    expect(options.map((o) => o.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(q('[data-start-providers]')?.tagName).toBe('FIELDSET');
  });

  it('starts with the stored default provider selected, when one is given', () => {
    draw({ onStartSession: () => {}, defaultProvider: 'codex' });
    expect(q('[data-start-provider="codex"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-start-provider="claude-code"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  /**
   * THE MARK IS THE CHOSEN PROVIDER'S, LIVE -- the operator's own words: "for
   * an unstarted pane use the currently chosen provider in its picker,
   * updating when the choice changes." There is no session yet, so there is
   * no agent to name the way `TerminalOnlyStart` names one; the picker's own
   * live selection is the closest honest fact, wrapped in the same macOS-icon
   * frame `DetailPanel.getting-started.test.tsx` pins the shape of.
   */
  it('draws the DEFAULT provider’s mark before any click, inside the macOS-icon frame', () => {
    draw({ onStartSession: () => {}, defaultProvider: 'codex' });
    const frame = q('[data-start-session] [data-icon-frame]');
    expect(frame).not.toBeNull();
    expect(frame?.className).toContain('rounded-[14px]');
    const mark = q('[data-start-session-mark]');
    expect(mark?.getAttribute('data-source-mark')).toBe('brand');
    expect(mark?.querySelector('svg')).not.toBeNull();
  });

  it('switches the mark the instant the picker’s own selection changes', () => {
    draw({ onStartSession: () => {}, defaultProvider: 'claude-code' });
    const before = q('[data-start-session-mark] svg path')?.getAttribute('d');
    expect(before, 'the default provider must actually draw a path').toBeTruthy();

    fireEvent.click(q('[data-start-provider="codex"]') as Element);

    expect(q('[data-start-provider="codex"]')?.getAttribute('aria-pressed')).toBe('true');
    const after = q('[data-start-session-mark] svg path')?.getAttribute('d');
    expect(after, 'the newly chosen provider must actually draw a path').toBeTruthy();
    // NEVER THE OLD MARK LEFT BEHIND: the picker moved, so the icon beside it
    // must be a different path, not the previous provider's borrowed one.
    expect(after).not.toBe(before);
  });

  it('withdraws the mark along with the picker, when the caller has no route to start one', () => {
    draw();
    expect(q('[data-start-session-mark]')).toBeNull();
    expect(q('[data-start-session] [data-icon-frame]')).toBeNull();
  });

  it('Start hands the CHOSEN provider id to the caller -- an id, never a command', () => {
    const started: string[] = [];
    draw({ onStartSession: (id) => started.push(id) });
    fireEvent.click(q('[data-start-provider="codex"]') as Element);
    expect(q('[data-start-provider="codex"]')?.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(q('[data-start-session-button]') as Element);
    expect(started).toEqual(['codex']);
    // Not the command: the command is main's to resolve from the id
    // (`resolveProvider`), so a renderer cannot send a word main never listed.
    expect(started[0]).not.toBe('codex ');
  });

  it('names the pane it will start in, so two empty panes read as two', () => {
    draw({ onStartSession: () => {} });
    expect(q('[data-start-session]')?.textContent).toContain('vam-atlas-aa11bb');
  });

  it('says so, and offers no Start, when the caller has no route to type with', () => {
    // A demo source, a connecting one, a phone with no write: the screen still
    // explains what this row is; it just cannot start anything from here.
    draw();
    expect(q('[data-start-session]')).not.toBeNull();
    expect(q('[data-start-session-button]')).toBeNull();
    expect(q('[data-start-session]')?.textContent).toMatch(/Terminal/);
  });

  it('is drawn only on Response -- the Terminal view is the other way in', () => {
    draw({ onStartSession: () => {}, tab: 'Terminal', terminal: true });
    // Whatever the Terminal view draws for it, the start screen is not there.
    expect(q('[data-start-session]')).toBeNull();
  });
});

/**
 * THE OPERATOR'S FIRST REPORT, MADE CONCRETE: "if the CLI has an update or
 * needs to trust the folder, the Response view is stuck in the loading state
 * while the terminal is asking about the update and trust." `startingPane.
 * screen` (`Canvas.tsx`'s own poll, `start-screen.ts`'s classifier) is what
 * this card is drawn from instead of the bare spinner.
 */
describe('the start screen card -- what the pane is actually asking', () => {
  const waiting = (screen: StartingPaneWait['screen']): StartingPaneWait => ({
    kind: 'start',
    provider: 'claude-code',
    timedOut: false,
    projectId: 'p1',
    rowId: EMPTY.id,
    screen,
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'api');
  });

  it('names the trust question instead of an unexplained spinner', () => {
    draw({ onStartSession: () => {}, startingPane: waiting('trust') });
    const card = q('[data-start-screen-card]');
    expect(card?.getAttribute('data-start-screen-kind')).toBe('trust');
    expect(card?.textContent).toContain('Do you trust the files in this folder?');
    // The ordinary spinner label is gone -- the card replaces it outright.
    expect(q('[data-start-timeout-hint]')).toBeNull();
  });

  it('answers "Yes" through window.api.terminal.answerTrust, aimed at THIS wait’s own row', () => {
    const answerTrust = vi.fn(async () => null);
    (window as unknown as { api: unknown }).api = { terminal: { answerTrust } };
    draw({ onStartSession: () => {}, startingPane: waiting('trust') });
    fireEvent.click(q('[data-start-screen-trust-yes]') as Element);
    expect(answerTrust).toHaveBeenCalledWith('p1', EMPTY.id, true);
  });

  it('answers "No" the same way, with `trust: false`', () => {
    const answerTrust = vi.fn(async () => null);
    (window as unknown as { api: unknown }).api = { terminal: { answerTrust } };
    draw({ onStartSession: () => {}, startingPane: waiting('trust') });
    fireEvent.click(q('[data-start-screen-trust-no]') as Element);
    expect(answerTrust).toHaveBeenCalledWith('p1', EMPTY.id, false);
  });

  it('offers "Open Terminal to answer" beside the trust buttons too, as a fallback', () => {
    draw({
      onStartSession: () => {},
      startingPane: waiting('trust'),
      tab: 'Response',
      terminal: true,
    });
    expect(q('[data-start-screen-open-terminal]')).not.toBeNull();
  });

  it.each(['update', 'login', 'onboarding'] as const)(
    'names the %s screen with "Open Terminal to answer" and no Yes/No',
    (screen) => {
      draw({ onStartSession: () => {}, startingPane: waiting(screen), terminal: true });
      const card = q('[data-start-screen-card]');
      expect(card?.getAttribute('data-start-screen-kind')).toBe(screen);
      expect(q('[data-start-screen-trust-yes]')).toBeNull();
      expect(q('[data-start-screen-trust-no]')).toBeNull();
      expect(q('[data-start-screen-open-terminal]')).not.toBeNull();
    },
  );

  it('draws the ordinary spinner, never a card, while the screen is not yet known', () => {
    draw({ onStartSession: () => {}, startingPane: waiting(null) });
    expect(q('[data-start-screen-card]')).toBeNull();
    expect(q('[data-start-session-button]')?.querySelector('.vam-spin')).not.toBeNull();
  });

  it('falls back to the ordinary timeout hint for `unknown` output, past the bound', () => {
    // `unknown` never draws a card of its own (`StartingPaneWait`'s own
    // header) -- it only ever changes how SOON `timedOut` arrives, which
    // `Canvas.tsx`'s own `armUnknownStall` owns; this component just proves
    // the fallback still reads `timedOut`, unmoved by `screen`.
    draw({
      onStartSession: () => {},
      startingPane: { ...waiting('unknown'), timedOut: true },
    });
    expect(q('[data-start-screen-card]')).toBeNull();
    expect(q('[data-start-timeout-hint]')).not.toBeNull();
  });
});
