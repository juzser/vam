// @vitest-environment happy-dom

/**
 * THE WAIT BETWEEN A PRESS AND THE AGENT REGISTERING.
 *
 * Operator: "After clicking Start session on the start screen, there needs
 * to be a loading state while the session is being created." `typeIntoOwnPane`
 * (main) resolves the moment the KEYS are typed, seconds before an agent
 * registers anywhere vam can see it (`startSessionIn`'s own header in
 * `Canvas.tsx`), and until now nothing on screen said so: the operator saw
 * the same picker, could press it again, and got `pane-occupied` back for
 * their trouble.
 *
 * ASSERTED THROUGH THE REAL SOURCE PORT, exactly as
 * `Canvas.terminal-only-resume.test.tsx` and `Canvas.new-session.test.tsx`
 * already do for their own writes: a `recordPrompt` the test resolves BY
 * HAND is what lets the in-flight state be read, and a model swapped by
 * `rerender` — the same `EMPTY -> AGENT` pair `Canvas.pane-row-resolves.
 * test.tsx` uses — is what proves the wait ends on the ROW, not on the write.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  Canvas,
  PROVIDER_CONFIRMATION_EXPIRY_MS,
  START_PANE_WAIT_TIMEOUT_MS,
  START_SCREEN_POLL_MS,
  START_SCREEN_UNKNOWN_STALL_MS,
} from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Session } from '../../src/renderer/domain/model.js';
import type { SessionSource } from '../../src/renderer/sources/port.js';
import type { CanvasSource } from '../../src/renderer/sources/source.js';

const PANE = 'vam-alpha-aa11bb';

const UNSTARTED: Session = {
  id: `pane:${PANE}`,
  title: PANE,
  epic: null,
  branch: null,
  status: 'unstarted',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [],
  source: 'claude-code',
  vamControlled: true,
  pane: PANE,
};

const TERMINAL: Session = {
  ...UNSTARTED,
  status: 'terminal',
  title: 'fix the flaky test',
  resumeCommand: 'claude --resume aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
};

/** The same pane, a poll later, with an agent registered in it. */
const LIVE: Session = {
  id: 'sess-a#4242',
  title: UNSTARTED.title,
  epic: null,
  branch: null,
  status: 'running',
  runningAgents: 0,
  activity: null,
  age: null,
  decisions: [{ id: 'd1', label: 'you', input: 'go on', output: null, commands: [] }],
  source: 'claude-code',
  vamControlled: true,
  pane: PANE,
};

function otherSession(id: string): Session {
  return {
    id,
    title: id,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
  };
}

function modelWith(...sessions: readonly Session[]): CanvasModel {
  return { projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions }] };
}

function sourceWith(onRecord: (sessionId: string, prompt: string) => Promise<void>): {
  source: CanvasSource;
  recorded: [string, string][];
  wrote: { count: number };
} {
  const recorded: [string, string][] = [];
  const wrote = { count: 0 };
  const inner = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: {
      liveUpdates: false,
      recordPrompt: true,
      deliverPrompt: true,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      closeSession: false,
      createSession: false,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
      resumeSession: false,
    },
    declines: {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: {
      recordPrompt: async (sessionId: string, prompt: string) => {
        recorded.push([sessionId, prompt]);
        await onRecord(sessionId, prompt);
      },
    },
  };
  return {
    source: {
      kind: 'session',
      source: inner as unknown as SessionSource,
      onWrote: () => {
        wrote.count += 1;
      },
    },
    recorded,
    wrote,
  };
}

/** A write the test resolves by hand, so the wait can be read mid-flight. */
function gatedSource() {
  let release: (() => void) | null = null;
  const built = sourceWith(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  return { ...built, release: () => release?.() };
}

const statusBar = () => document.querySelector('[data-status-bar]')?.textContent ?? '';
const startButton = () =>
  document.querySelector('[data-start-session-button]') as HTMLButtonElement | null;
const resumeButton = () =>
  document.querySelector('[data-resume-in-pane]') as HTMLButtonElement | null;
const providerPicker = () => document.querySelector('[data-start-providers]');
const timeoutHint = () => document.querySelector('[data-start-timeout-hint]');

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

describe('Start session — the wait for the agent to register', () => {
  it('shows a loading state the instant Start is pressed', async () => {
    const { source } = gatedSource();
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    expect(startButton()?.disabled).toBe(true);
    expect(startButton()?.textContent).toContain('Starting Claude Code');
    expect(providerPicker()?.hasAttribute('disabled')).toBe(true);
  });

  it('stays up after the write resolves, while the row is still unstarted', async () => {
    const { source, release } = gatedSource();
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    await act(async () => {
      release();
    });
    expect(startButton()?.disabled).toBe(true);
    expect(document.querySelector('[data-start-session]')).not.toBeNull();
  });

  it('clears once the row stops being unstarted — the agent registered', async () => {
    const { source, release } = gatedSource();
    const view = render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    await act(async () => {
      release();
    });
    await act(async () => {
      view.rerender(<Canvas model={modelWith(LIVE)} source={source} />);
    });
    expect(document.querySelector('[data-start-session]')).toBeNull();
    // AND THE RECORD ITSELF IS GONE, not merely unreadable because this row
    // no longer draws a start screen: a fresh `unstarted` row on the SAME
    // pane (`startingPaneByKey`'s own key) must open on the ordinary picker,
    // not on a wait nothing cleared.
    await act(async () => {
      view.rerender(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    });
    expect(startButton()?.disabled).toBe(false);
    expect(providerPicker()?.hasAttribute('disabled')).toBe(false);
  });

  it('clears at once on a refusal, and the reason is the source’s own', async () => {
    const { source } = sourceWith(async () => {
      throw {
        kind: 'refused',
        code: 'pane-occupied',
        message: 'someone typed claude by hand in the meantime',
      };
    });
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    expect(startButton()?.disabled).toBe(false);
    expect(providerPicker()?.hasAttribute('disabled')).toBe(false);
    expect(statusBar()).toContain('someone typed claude by hand in the meantime');
  });

  it('persists across a tab switch in the same pane, keyed by the row rather than local state', async () => {
    const { source } = gatedSource();
    render(<Canvas model={modelWith(UNSTARTED, otherSession('s2'))} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    expect(startButton()?.disabled).toBe(true);

    const tabs = () => [...document.querySelectorAll('[data-tab-select]')] as HTMLElement[];
    const otherTab = tabs().find((el) => el.textContent === 's2');
    await act(async () => {
      otherTab?.click();
    });
    expect(document.querySelector('[data-start-session]')).toBeNull();

    const firstTab = tabs().find((el) => el.textContent === PANE);
    await act(async () => {
      firstTab?.click();
    });
    expect(startButton()?.disabled).toBe(true);
    expect(startButton()?.textContent).toContain('Starting Claude Code');
  });

  it('a second press does nothing once the write has already resolved, while the row still has not arrived', async () => {
    const { source, recorded } = sourceWith(async () => {});
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    expect(recorded).toHaveLength(1);
    expect(startButton()?.disabled).toBe(true);
    await act(async () => {
      startButton()?.click();
    });
    expect(recorded).toHaveLength(1);
  });

  /**
   * D12: THE RACE THE `disabled` STATE COULD NOT CLOSE ON ITS OWN.
   *
   * The test above presses twice in two SEPARATE `act()` calls, so React has
   * already committed the first press's `disabled` before the second one is
   * even dispatched -- which proves the state works once it has landed, and
   * proves nothing about the gap before it does. Two clicks in the SAME tick
   * (a real fast double-click, or Enter's native activation landing beside a
   * mouse click) both run `startSessionIn` off the SAME closure, from the
   * SAME last commit, before either has caused a re-render -- so a guard
   * that reads only React state passes both. This is the shape a ref-based
   * synchronous guard closes and a state-only one cannot.
   */
  it('D12: two clicks in the SAME tick, before any re-render, still record once', async () => {
    const { source, recorded } = sourceWith(async () => {});
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
      startButton()?.click();
    });
    expect(recorded).toHaveLength(1);
  });

  /**
   * D-START: THE PANE ITSELF IS A SECOND, FASTER SIGNAL -- the operator's
   * two reports, both traced to `source.ts`'s own poll never learning about
   * a pane the live-agent list has nothing to say about yet
   * (`start-screen.ts`'s own header). These prove `Canvas.tsx`'s own direct
   * poll of the pane, independent of `allEntries` ever changing at all.
   */
  describe('the pane itself, polled directly -- independent of the row ever changing', () => {
    afterEach(() => {
      Reflect.deleteProperty(window, 'api');
    });

    /**
     * THE COORDINATOR'S OWN BLOCKER, on the first cut of this feature: this
     * test used to assert `ready` cleared the wait back to the ORDINARY
     * picker -- an idle, re-enabled Start button, with the row still
     * `unstarted` -- which is the operator's second report all over again
     * ("even when the terminal has finished starting the session, the
     * Response view is still stuck") and a standing invitation to type the
     * provider's command into a pane that already has it running. `ready`
     * now confirms the pane is running an agent and the Response view shows
     * that instead, never re-offering Start.
     */
    it('shows the ready state once the pane reports ready, never re-offering Start', async () => {
      const startScreen = vi.fn(async () => ({
        kind: 'ok' as const,
        screen: 'ready' as const,
        provider: 'claude-code' as const,
      }));
      (window as unknown as { api: unknown }).api = { terminal: { startScreen } };
      const { source, release } = gatedSource();
      render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
      await act(async () => {
        startButton()?.click();
      });
      await act(async () => {
        release();
      });
      // The poll fires on mount, before any interval tick -- one flush is
      // enough, and NOTHING here ever rerenders with the `LIVE` model: the
      // row is STILL `unstarted`, so this is `providerRunningByKey`'s own
      // proof, independent of `allEntries` ever agreeing.
      await act(async () => {});
      expect(startScreen).toHaveBeenCalledWith('p1', UNSTARTED.id);
      expect(document.querySelector('[data-pane-ready]')?.textContent).toContain(
        'Claude Code is ready',
      );
      expect(startButton()).toBeNull();
      expect(providerPicker()).toBeNull();
      expect(document.querySelector('[data-start-session]')).toBeNull();
    });

    /**
     * D-RELOAD, RE-FIXED AFTER THE COORDINATOR'S TRUST-CARD S2: the reload
     * case used to trust `Session.runningProvider` (the model's field)
     * OUTRIGHT, which drew `PaneReady` over a trust/update dialog the model's
     * field cannot see (it is only the pane's foreground COMMAND). It is
     * still answered with NO second background poll of every idle row --
     * only the ONE row actually on screen, auto-classified through the exact
     * same fast poll a real Start press already runs (`kind: 'confirm'`, no
     * press behind it) -- and only a `ready` READ of the pane itself earns
     * the ready state. Also doubles as the coordinator's own required proof:
     * "the displayed row with the model running and a ready pane: exactly
     * one short poll path, and it stops after ready."
     */
    it('classifies the displayed row once on a fresh mount when the model already reports a provider, and stops after ready', async () => {
      vi.useFakeTimers();
      const startScreen = vi.fn(async () => ({
        kind: 'ok' as const,
        screen: 'ready' as const,
        provider: 'codex' as const,
      }));
      (window as unknown as { api: unknown }).api = { terminal: { startScreen } };
      const { source } = gatedSource();
      render(
        <Canvas model={modelWith({ ...UNSTARTED, runningProvider: 'codex' })} source={source} />,
      );
      await act(async () => {});
      expect(startScreen).toHaveBeenCalledTimes(1);
      expect(startScreen).toHaveBeenCalledWith('p1', UNSTARTED.id);
      expect(document.querySelector('[data-pane-ready]')?.textContent).toContain('Codex is ready');
      expect(startButton()).toBeNull();
      expect(providerPicker()).toBeNull();

      // STOPS after ready -- well past the fast poll's own cadence, still one
      // call, ever: the wait itself ends (handed off to the model), so there
      // is nothing left in `startingPaneByKey` for the poll to iterate.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(START_SCREEN_POLL_MS * 5);
      });
      expect(startScreen).toHaveBeenCalledTimes(1);
    });

    /**
     * UNLIKE `start`/`resume`, WHICH SURVIVE A TAB SWITCH ON PURPOSE
     * (`startingPaneByKey`'s own header: the operator's own press deserves
     * to survive it), a `confirm` wait was never asked for, so there is
     * nothing to keep polling a pane the operator has already left. Still
     * unresolved (`trust`, never `ready`) when the operator navigates to a
     * different row -- the poll must stop right there, not merely "still
     * every `START_SCREEN_POLL_MS`, forever, for a row nobody is looking at
     * any more". Captures the call count once mount SETTLES rather than
     * asserting a literal one -- a second session sharing this project re-
     * renders the split tree an extra time regardless of this fix (a REAL
     * Start press with a second session present shows the same two calls,
     * unrelated to `confirm` at all); this test is about the count FREEZING
     * on navigation, not about that unrelated number.
     */
    it('ends the auto-classify poll the moment the operator navigates to a different row', async () => {
      vi.useFakeTimers();
      const startScreen = vi.fn(async () => ({ kind: 'ok' as const, screen: 'trust' as const }));
      (window as unknown as { api: unknown }).api = { terminal: { startScreen } };
      // Sorted alphabetically after `UNSTARTED` (`pane:vam-alpha-aa11bb`), so
      // it never displaces it as the row displayed by default -- this test
      // is about a NAVIGATION away, not about which one starts there.
      const OTHER: Session = { ...UNSTARTED, id: 'pane:zzz-other', pane: 'vam-alpha-zzz-other' };
      const { source } = gatedSource();
      render(
        <Canvas
          model={modelWith({ ...UNSTARTED, runningProvider: 'claude-code' }, OTHER)}
          source={source}
        />,
      );
      await act(async () => {});
      const callsOnceSettled = startScreen.mock.calls.length;
      expect(callsOnceSettled).toBeGreaterThan(0);

      await act(async () => {
        document.querySelector<HTMLElement>(`[data-session-row="${OTHER.id}"]`)?.click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      // NO NEW CALLS once navigated away, however many the initial settle
      // itself produced (a second session adopted into the same pane as a
      // background tab re-renders the split tree once more, which is not
      // what this test is about) -- past `START_SCREEN_POLL_MS` many times
      // over, still frozen at exactly what it was the moment the operator
      // left this row.
      expect(startScreen).toHaveBeenCalledTimes(callsOnceSettled);
    });

    it('draws the ready state for a `terminal` row too, once the pane itself confirms', async () => {
      const startScreen = vi.fn(async () => ({
        kind: 'ok' as const,
        screen: 'ready' as const,
        provider: 'claude-code' as const,
      }));
      (window as unknown as { api: unknown }).api = { terminal: { startScreen } };
      const { source } = gatedSource();
      render(
        <Canvas
          model={modelWith({ ...TERMINAL, runningProvider: 'claude-code' })}
          source={source}
        />,
      );
      await act(async () => {});
      expect(document.querySelector('[data-pane-ready]')?.textContent).toContain(
        'Claude Code is ready',
      );
      expect(document.querySelector('[data-terminal-only-start]')).toBeNull();
      expect(resumeButton()).toBeNull();
    });

    it('sends a first message from the ready state through the normal composer path, once the pane itself confirms', async () => {
      const startScreen = vi.fn(async () => ({
        kind: 'ok' as const,
        screen: 'ready' as const,
        provider: 'claude-code' as const,
      }));
      (window as unknown as { api: unknown }).api = { terminal: { startScreen } };
      const { source, recorded } = sourceWith(async () => {});
      render(
        <Canvas
          model={modelWith({ ...UNSTARTED, runningProvider: 'claude-code' })}
          source={source}
        />,
      );
      await act(async () => {});
      expect(document.querySelector('[data-pane-ready]')).not.toBeNull();
      const box = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="prompt to session"]',
      );
      expect(box, 'the composer must be enabled once the pane is confirmed ready').not.toBeNull();
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
      });
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
          ?.set as (this: HTMLElement, v: string) => void;
        setter.call(box as HTMLTextAreaElement, 'hello there');
        box?.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        box?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      expect(recorded).toEqual([[UNSTARTED.id, 'hello there']]);
    });

    /**
     * THE BROWSER BUILD HAS NO `window.api.terminal.startScreen` AT ALL, SO
     * IT CANNOT CLASSIFY -- unlike before this S2 fix, it must NOT fall back
     * to trusting `entry.session.runningProvider` outright either (that is
     * the bug). It stays on the ordinary ("unconfirmed") ready-adjacent
     * state -- Start withdrawn, no crash -- until `START_PANE_WAIT_TIMEOUT_MS`
     * offers the honest "Still starting" hint, the same fallback a real
     * Start press already had with no `window.api` (`never polls at all in
     * the browser build`, above).
     */
    it('never shows PaneReady from the model alone in the browser build, and still offers the timeout hint', async () => {
      vi.useFakeTimers();
      const { source } = gatedSource();
      render(
        <Canvas model={modelWith({ ...UNSTARTED, runningProvider: 'codex' })} source={source} />,
      );
      await act(async () => {});
      expect(document.querySelector('[data-pane-ready]')).toBeNull();
      expect(timeoutHint()).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(START_PANE_WAIT_TIMEOUT_MS);
      });
      expect(document.querySelector('[data-pane-ready]')).toBeNull();
      expect(timeoutHint()?.textContent).toContain('Still starting');
    });

    /**
     * THE COORDINATOR'S OWN BUG REPORT, SCENARIO (A): a REAL Start/Resume
     * wait's own pane-content read is authoritative even once the model
     * independently agrees mid-dialog -- `Session.runningProvider` is only
     * the pane's foreground COMMAND, true the instant the CLI process
     * starts, well before a trust dialog it is blocked on gets answered.
     * Falsified by hand: reverting the merge to `fromWait ?? entry.session.
     * runningProvider` (the pre-fix shape) draws `PaneReady` the moment the
     * model rerender lands, failing this test outright.
     */
    it('a real Start wait keeps the trust card up even once the model independently agrees mid-dialog', async () => {
      const startScreen = vi.fn(async () => ({ kind: 'ok' as const, screen: 'trust' as const }));
      (window as unknown as { api: unknown }).api = { terminal: { startScreen } };
      const { source, release } = gatedSource();
      const view = render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
      await act(async () => {
        startButton()?.click();
      });
      await act(async () => {
        release();
      });
      await act(async () => {});
      const card = document.querySelector('[data-start-screen-card]');
      expect(card?.getAttribute('data-start-screen-kind')).toBe('trust');
      expect(document.querySelector('[data-pane-ready]')).toBeNull();

      // The model's own ~10s poll lands MID-DIALOG.
      await act(async () => {
        view.rerender(
          <Canvas
            model={modelWith({ ...UNSTARTED, runningProvider: 'claude-code' })}
            source={source}
          />,
        );
      });
      expect(document.querySelector('[data-pane-ready]')).toBeNull();
      const cardAfter = document.querySelector('[data-start-screen-card]');
      expect(cardAfter?.getAttribute('data-start-screen-kind')).toBe('trust');
    });

    /** The same race, the update dialog -- `StartScreenCard` draws one of
     *  four named screens generically; this is not a special case of it. */
    it('a real Start wait keeps the update card up even once the model independently agrees mid-dialog', async () => {
      const startScreen = vi.fn(async () => ({ kind: 'ok' as const, screen: 'update' as const }));
      (window as unknown as { api: unknown }).api = { terminal: { startScreen } };
      const { source, release } = gatedSource();
      const view = render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
      await act(async () => {
        startButton()?.click();
      });
      await act(async () => {
        release();
      });
      await act(async () => {});
      const card = document.querySelector('[data-start-screen-card]');
      expect(card?.getAttribute('data-start-screen-kind')).toBe('update');
      expect(document.querySelector('[data-pane-ready]')).toBeNull();

      await act(async () => {
        view.rerender(
          <Canvas
            model={modelWith({ ...UNSTARTED, runningProvider: 'claude-code' })}
            source={source}
          />,
        );
      });
      expect(document.querySelector('[data-pane-ready]')).toBeNull();
      const cardAfter = document.querySelector('[data-start-screen-card]');
      expect(cardAfter?.getAttribute('data-start-screen-kind')).toBe('update');
    });

    /**
     * THE COORDINATOR'S OWN BUG REPORT, SCENARIO (B): NO wait was ever
     * pressed (a reload), the model already reports a provider running, and
     * the pane itself is sitting at a trust dialog -- the auto-classify
     * `confirm` wait must show the SAME blocking card, not `PaneReady`, and
     * only a LATER `ready` read (the dialog answered) earns it.
     */
    it('a reload with no wait shows the blocking card while the model already reports a provider, then PaneReady once the pane itself reads ready', async () => {
      let screen: 'trust' | 'ready' = 'trust';
      const startScreen = vi.fn(async () => ({
        kind: 'ok' as const,
        screen,
        provider: 'claude-code' as const,
      }));
      (window as unknown as { api: unknown }).api = { terminal: { startScreen } };
      vi.useFakeTimers();
      const { source } = gatedSource();
      render(
        <Canvas
          model={modelWith({ ...UNSTARTED, runningProvider: 'claude-code' })}
          source={source}
        />,
      );
      await act(async () => {});
      expect(document.querySelector('[data-pane-ready]')).toBeNull();
      const card = document.querySelector('[data-start-screen-card]');
      expect(card?.getAttribute('data-start-screen-kind')).toBe('trust');

      screen = 'ready';
      await act(async () => {
        await vi.advanceTimersByTimeAsync(START_SCREEN_POLL_MS);
      });
      expect(document.querySelector('[data-pane-ready]')?.textContent).toContain(
        'Claude Code is ready',
      );
    });

    /**
     * THE COORDINATOR'S OWN PERFORMANCE FIX, FALSIFIED -- ADAPTED for the
     * trust-card S2's auto-classify effect. A first cut of THIS feature ran
     * `window.api.terminal.startScreen` on an interval for EVERY idle
     * `unstarted`/`terminal` row, forever -- N tmux calls every few seconds,
     * whether or not the operator was even looking. Two rows prove it stays
     * fixed, for two DIFFERENT reasons: `UNSTARTED` (in the active project,
     * so it is what lands on screen) carries no `runningProvider` of its
     * own, so the model gives the auto-classify effect nothing to act on;
     * `BACKGROUND` DOES have one, and is STILL never polled, because "rows
     * that aren't displayed are never polled" (the coordinator's own later
     * requirement) -- proving the auto-classify effect is scoped to the row
     * on screen, not to every eligible one. A SEPARATE project is what pins
     * that deterministically: `adoptOrphans` only ever adopts the ACTIVE
     * project's own sessions into a pane (`activeProjectSessionIds`'s own
     * scoping), so `BACKGROUND`, in `p2`, never becomes a tab at all, let
     * alone the displayed one -- no reliance on which of several tabs in the
     * SAME pane `adoptOrphans`/`normaliseTree` happens to leave active.
     * Advances the fake clock well past both the fast poll's own cadence
     * (`START_SCREEN_POLL_MS`) and the retired background poll's own (3s) to
     * prove it stays that way -- not merely absent on the first tick.
     * FALSIFIED by hand against the pre-fix code (the `D-RELOAD` effect this
     * repo's history shows): that version fails this test outright, the
     * whole point of writing it.
     */
    it('never calls terminal.startScreen for an idle row with no active wait, nor for a non-displayed one the model reports running — the coordinator’s own perf fix', async () => {
      vi.useFakeTimers();
      const startScreen = vi.fn(async () => ({
        kind: 'ok' as const,
        screen: 'ready' as const,
        provider: 'claude-code' as const,
      }));
      (window as unknown as { api: unknown }).api = { terminal: { startScreen } };
      const BACKGROUND: Session = {
        ...UNSTARTED,
        id: 'pane:background',
        pane: 'vam-alpha-background',
        runningProvider: 'codex',
      };
      const model: CanvasModel = {
        projects: [
          {
            id: 'p1',
            name: 'alpha',
            source: 'claude-code',
            sessions: [UNSTARTED, otherSession('s2')],
          },
          { id: 'p2', name: 'beta', source: 'claude-code', sessions: [BACKGROUND] },
        ],
      };
      const { source } = gatedSource();
      render(<Canvas model={model} source={source} />);
      await act(async () => {});
      expect(document.querySelector('[data-start-session]')).not.toBeNull();
      expect(startScreen).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(startScreen).not.toHaveBeenCalled();
    });

    /**
     * THE S2 REVIEW FOUND: a stale confirmation could hold `PaneReady` up
     * FOREVER. The fast poll's `ready` used to survive until the row's own
     * `status` left `unstarted`/`terminal` -- but a CLI that crashes before
     * ever registering an agent never DOES leave `unstarted`, so nothing
     * closed the confirmation, and the operator's first message would have
     * gone into a bare shell prompt. `runningProvider` on the fixture stays
     * `undefined` throughout here -- the model NEVER agrees, which is the
     * whole point: this is the crash-before-registering shape, not the
     * long-running-then-crashes one (`hands off to the model` below covers
     * that one).
     *
     * `PROVIDER_CONFIRMATION_EXPIRY_MS` is what closes it: once the model has
     * had a fresh look PAST that bound and still reads a shell, the
     * confirmation was wrong and must not hold the ready state up forever.
     */
    it('the confirmation expires once a fresh model read, past its own bound, still says shell — Start comes back', async () => {
      vi.useFakeTimers();
      const startScreen = vi.fn(async () => ({
        kind: 'ok' as const,
        screen: 'ready' as const,
        provider: 'claude-code' as const,
      }));
      (window as unknown as { api: unknown }).api = { terminal: { startScreen } };
      const { source, release } = gatedSource();
      const view = render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
      await act(async () => {
        startButton()?.click();
      });
      await act(async () => {
        release();
      });
      await act(async () => {});
      expect(document.querySelector('[data-pane-ready]')).not.toBeNull();

      // Time and a FRESH model read both matter: advancing the clock alone,
      // with no new poll, must not be what clears it either -- there is
      // nothing here for the effect to react to until a new model arrives.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PROVIDER_CONFIRMATION_EXPIRY_MS);
      });
      expect(document.querySelector('[data-pane-ready]')).not.toBeNull();

      // NOW a fresh poll lands -- a new model object, the row still
      // `unstarted`, still reading a plain shell -- past the bound.
      await act(async () => {
        view.rerender(<Canvas model={modelWith({ ...UNSTARTED })} source={source} />);
      });
      expect(document.querySelector('[data-pane-ready]')).toBeNull();
      expect(startButton()).not.toBeNull();
      expect(startButton()?.disabled).toBe(false);
    });

    /**
     * THE OTHER HALF OF THE SAME FIX, FALSIFIED THE OTHER DIRECTION: a fresh
     * model read landing WELL UNDER the expiry bound, still showing the
     * pre-launch shell (the ordinary case -- the model's poll simply has not
     * caught up with the CLI yet), must NOT un-confirm the pane. Without
     * this, "clear whenever the model disagrees" would flash back to the
     * start screen on every ordinary Start press, which is the bug this
     * whole feature exists to avoid.
     */
    it('does not flash back to the start screen for a fresh-but-early model read that still says shell', async () => {
      vi.useFakeTimers();
      const startScreen = vi.fn(async () => ({
        kind: 'ok' as const,
        screen: 'ready' as const,
        provider: 'claude-code' as const,
      }));
      (window as unknown as { api: unknown }).api = { terminal: { startScreen } };
      const { source, release } = gatedSource();
      const view = render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
      await act(async () => {
        startButton()?.click();
      });
      await act(async () => {
        release();
      });
      await act(async () => {});
      expect(document.querySelector('[data-pane-ready]')).not.toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(PROVIDER_CONFIRMATION_EXPIRY_MS).toBeGreaterThan(1_000);
      await act(async () => {
        view.rerender(<Canvas model={modelWith({ ...UNSTARTED })} source={source} />);
      });
      expect(document.querySelector('[data-pane-ready]')).not.toBeNull();
      expect(startButton()).toBeNull();
    });

    /**
     * THE HANDOFF HALF OF THE DESIGN: the moment the MODEL independently
     * agrees a provider is running, the fast poll's own confirmation is
     * retired -- the model owns the fact from there on, so a revert reaches
     * the Response view on the model's own next poll, not bounded by
     * `PROVIDER_CONFIRMATION_EXPIRY_MS` at all (the long-running-then-
     * crashes shape, distinct from the never-registered one above).
     */
    it('hands off to the model the moment it agrees, so a later revert returns Start faster than the expiry bound', async () => {
      vi.useFakeTimers();
      const startScreen = vi.fn(async () => ({
        kind: 'ok' as const,
        screen: 'ready' as const,
        provider: 'claude-code' as const,
      }));
      (window as unknown as { api: unknown }).api = { terminal: { startScreen } };
      const { source, release } = gatedSource();
      const view = render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
      await act(async () => {
        startButton()?.click();
      });
      await act(async () => {
        release();
      });
      await act(async () => {});
      expect(document.querySelector('[data-pane-ready]')).not.toBeNull();

      // The model catches up and agrees -- still `unstarted` (no live agent
      // ever registered), but the pane's own foreground command now reads
      // as Claude Code too.
      await act(async () => {
        view.rerender(
          <Canvas
            model={modelWith({ ...UNSTARTED, runningProvider: 'claude-code' })}
            source={source}
          />,
        );
      });
      expect(document.querySelector('[data-pane-ready]')).not.toBeNull();

      // Immediately -- no time advanced at all, well under the expiry bound
      // -- the CLI crashes and the very next poll reverts.
      await act(async () => {
        view.rerender(<Canvas model={modelWith({ ...UNSTARTED })} source={source} />);
      });
      expect(document.querySelector('[data-pane-ready]')).toBeNull();
      expect(startButton()).not.toBeNull();
    });

    it('shows the trust card once the pane reports trust, and does not clear the wait', async () => {
      const startScreen = vi.fn(async () => ({ kind: 'ok' as const, screen: 'trust' as const }));
      (window as unknown as { api: unknown }).api = { terminal: { startScreen } };
      const { source } = gatedSource();
      render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
      await act(async () => {
        startButton()?.click();
      });
      await act(async () => {});
      const card = document.querySelector('[data-start-screen-card]');
      expect(card?.getAttribute('data-start-screen-kind')).toBe('trust');
      // Still waiting -- the picker/Start button stay frozen, unlike `ready`.
      expect(startButton()?.disabled).toBe(true);
    });

    it('shortens the wait to the unknown-stall bound, well under the full 30s timeout', async () => {
      vi.useFakeTimers();
      const startScreen = vi.fn(async () => ({ kind: 'ok' as const, screen: 'unknown' as const }));
      (window as unknown as { api: unknown }).api = { terminal: { startScreen } };
      const { source } = gatedSource();
      render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
      await act(async () => {
        startButton()?.click();
      });
      // The first poll's promise resolves on a microtask, which this flushes
      // WITHOUT advancing the fake clock -- so the stall timer it just armed
      // is pending but not yet due.
      await act(async () => {});
      expect(timeoutHint()).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(START_SCREEN_UNKNOWN_STALL_MS);
      });
      expect(timeoutHint()?.textContent).toContain('Still starting');
      // Well short of the ordinary 30s bound this same wait would otherwise
      // have run the full length of.
      expect(START_SCREEN_UNKNOWN_STALL_MS).toBeLessThan(START_PANE_WAIT_TIMEOUT_MS);
    });

    it('never polls at all in the browser build -- no window.api, and the 30s fallback is untouched', async () => {
      const { source } = gatedSource();
      render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
      await act(async () => {
        startButton()?.click();
      });
      await act(async () => {});
      // No card, no crash -- the ordinary spinner, exactly as before this
      // feature existed.
      expect(document.querySelector('[data-start-screen-card]')).toBeNull();
      expect(startButton()?.querySelector('.vam-spin')).not.toBeNull();
    });
  });

  it('drops the spinner and offers the Terminal view once the wait passes the timeout', async () => {
    vi.useFakeTimers();
    const { source } = gatedSource();
    render(<Canvas model={modelWith(UNSTARTED)} source={source} />);
    await act(async () => {
      startButton()?.click();
    });
    expect(timeoutHint()).toBeNull();
    expect(startButton()?.querySelector('.vam-spin')).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(START_PANE_WAIT_TIMEOUT_MS);
    });
    expect(timeoutHint()?.textContent).toContain('Still starting');
    expect(startButton()?.querySelector('.vam-spin')).toBeNull();
    // NEVER LEFT SPINNING: the button still says what it is doing, but the
    // one part that promised an end it could not see is gone.
    expect(startButton()?.disabled).toBe(true);
  });
});

describe('Resume — the same wait, on the terminal-only screen', () => {
  it('shows "Resuming…" the instant it is pressed, and freezes Start too', async () => {
    const { source } = gatedSource();
    render(<Canvas model={modelWith(TERMINAL)} source={source} />);
    await act(async () => {
      resumeButton()?.click();
    });
    expect(resumeButton()?.disabled).toBe(true);
    expect(resumeButton()?.textContent).toContain('Resuming');
    expect(startButton()?.disabled).toBe(true);
    expect(providerPicker()?.hasAttribute('disabled')).toBe(true);
  });

  it('clears at once on a refusal', async () => {
    const { source } = sourceWith(async () => {
      throw new Error('tmux said no');
    });
    render(<Canvas model={modelWith(TERMINAL)} source={source} />);
    await act(async () => {
      resumeButton()?.click();
    });
    expect(resumeButton()?.disabled).toBe(false);
    expect(statusBar()).toContain('tmux said no');
  });

  it('clears once the row stops being terminal — the agent registered', async () => {
    const { source, release } = gatedSource();
    const view = render(<Canvas model={modelWith(TERMINAL)} source={source} />);
    await act(async () => {
      resumeButton()?.click();
    });
    await act(async () => {
      release();
    });
    await act(async () => {
      view.rerender(<Canvas model={modelWith(LIVE)} source={source} />);
    });
    expect(document.querySelector('[data-terminal-only-start]')).toBeNull();
    // AND THE RECORD ITSELF IS GONE -- see the Start session version of this
    // assertion above for why this is not merely "the screen changed".
    await act(async () => {
      view.rerender(<Canvas model={modelWith(TERMINAL)} source={source} />);
    });
    expect(resumeButton()?.disabled).toBe(false);
  });

  it('a second press does nothing once the write has already resolved, while the row still has not arrived', async () => {
    const { source, recorded } = sourceWith(async () => {});
    render(<Canvas model={modelWith(TERMINAL)} source={source} />);
    await act(async () => {
      resumeButton()?.click();
    });
    expect(recorded).toHaveLength(1);
    await act(async () => {
      resumeButton()?.click();
    });
    expect(recorded).toHaveLength(1);
  });

  // D12's own twin here -- see the Start section's own comment for the shape.
  it('D12: two clicks in the SAME tick, before any re-render, still record once', async () => {
    const { source, recorded } = sourceWith(async () => {});
    render(<Canvas model={modelWith(TERMINAL)} source={source} />);
    await act(async () => {
      resumeButton()?.click();
      resumeButton()?.click();
    });
    expect(recorded).toHaveLength(1);
  });
});
