// @vitest-environment happy-dom

/**
 * The phone keystroke strip -- vam's real five `PaneKey` shapes (Escape,
 * Enter, Backspace, Shift-Tab, Space), reachable by tap.
 *
 * Gated on the SAME predicate as the mode row's `canCycleMode`
 * (`vamControlled === true && terminal !== false`), and placed first inside
 * `data-composer-bar` so it inherits `composerHidden` -- a `QuestionCard`
 * open makes it disappear with the rest of the composer, for free.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import type { PaneSendResult } from '../../src/shared/terminal.js';

const SESSION: Session = {
  id: 's1',
  title: 'Provider survey',
  icon: null,
  epic: null,
  branch: null,
  status: 'running',
  runningAgents: 0,
  activity: null,
  age: '3m',
  decisions: [{ id: 'd1', label: 'plan', input: 'ask me', output: 'asked', commands: [] }],
  vamControlled: true,
};

function draw(over: Partial<Session> = {}, props: Partial<DetailPanelProps> = {}) {
  const session: Session = { ...SESSION, ...over };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  const entry: SessionEntry = { project, session };
  render(
    <DetailPanel
      entry={entry}
      decision={session.decisions[0] ?? null}
      draft=""
      onDraftChange={() => {}}
      onSubmit={() => {}}
      composing={false}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={false}
      actionIndex={0}
      width={undefined}
      resizeHandle={null}
      phone
      {...props}
    />,
  );
}

const strip = () => document.querySelector('[data-key-strip]');
const keys = () => [...document.querySelectorAll('[data-key-strip-key]')];

afterEach(cleanup);

describe('the keystroke strip is drawn only where a key can actually be sent', () => {
  it('is absent on desktop even when every gate passes', () => {
    draw({}, { phone: false });
    expect(strip()).toBeNull();
  });

  it('is absent for a session vam did not start', () => {
    draw({ vamControlled: false });
    expect(strip()).toBeNull();
  });

  it('is absent when vamControlled has never been established', () => {
    // Three-state on purpose: `undefined` is "not established", not "false" --
    // spreading `unowned` over `SESSION` in `draw`'s own merge would put the
    // dropped key straight back, so the entry is built here instead.
    const { vamControlled: _dropped, ...unowned } = SESSION;
    const project: Project = { id: 'p1', name: 'atlas', sessions: [unowned] };
    const entry: SessionEntry = { project, session: unowned };
    render(
      <DetailPanel
        entry={entry}
        decision={unowned.decisions[0] ?? null}
        draft=""
        onDraftChange={() => {}}
        onSubmit={() => {}}
        composing={false}
        onCompose={() => {}}
        onStopComposing={() => {}}
        active={false}
        actionIndex={0}
        width={undefined}
        resizeHandle={null}
        phone
      />,
    );
    expect(strip()).toBeNull();
  });

  it('is absent where the source has no terminal surface at all', () => {
    draw({}, { terminal: false });
    expect(strip()).toBeNull();
  });

  it('is drawn for a session vam started, on a source with a terminal, on phone', () => {
    draw({}, { terminal: true });
    expect(strip()).not.toBeNull();
    expect(keys()).toHaveLength(5);
  });

  it('never draws a plain Tab key: there is no PaneKey behind it', () => {
    draw();
    expect(document.querySelector('[data-key-strip-key="tab"]')).toBeNull();
    expect(
      keys()
        .map((k) => k.getAttribute('data-key-strip-key'))
        .sort(),
    ).toEqual(['back-tab', 'backspace', 'enter', 'escape', 'space'].sort());
  });

  it('labels Escape and Enter distinctly from their textarea siblings', () => {
    draw({}, { composing: true });
    const escapeKey = document.querySelector('[data-key-strip-key="escape"]');
    const enterKey = document.querySelector('[data-key-strip-key="enter"]');
    expect(escapeKey?.textContent).toContain('agent');
    expect(escapeKey?.textContent).not.toBe('Esc');
    expect(enterKey?.textContent).toContain('agent');
    expect(enterKey?.textContent).not.toBe('Enter');
    // AND ON A PHONE THE TEXTAREA HAS NO Esc HINT TO BE CONFUSED WITH. The
    // strip's button is the only Escape a soft keyboard has, so the composer's
    // own key row names the send key and stops there -- the ambiguity this
    // test was written about cannot arise here at all. The retired
    // `Esc → sidebar` caption is asserted gone for the same reason: it
    // promised a destination Escape no longer has anywhere.
    expect(document.querySelector('[data-prompt-keys]')?.textContent).not.toContain('Esc');
    expect(document.querySelector('[data-prompt-escape]')).toBeNull();
  });

  it('disappears with the composer while a QuestionCard is open', () => {
    draw(
      {
        questions: [
          {
            id: 'tool-1:0',
            header: null,
            question: 'Which colour?',
            multiSelect: false,
            options: [{ label: 'Crimson', description: null }],
            answer: null,
          },
        ],
      },
      { terminal: true },
    );
    expect(document.querySelector('[data-question]')).not.toBeNull();
    expect(strip()).toBeNull();
  });

  it('stays absent after "Chat about this" un-hides the composer -- the card is still open', () => {
    // THE S1 REGRESSION. `composerHidden` alone is `records === false ||
    // (openQuestion && chattingAbout !== setId)` -- tapping "Chat about
    // this" sets `chattingAbout = setId`, which cancels the second clause
    // and un-hides the composer ON PURPOSE. But `QuestionCard` keeps
    // drawing: it renders on `answer === null`, not on the composer's own
    // state. Inheriting `composerHidden` alone therefore does NOT stop the
    // strip from appearing over a card that is still open and unanswered --
    // two live ways to answer one question, which is exactly what this gate
    // exists to prevent.
    draw(
      {
        questions: [
          {
            id: 'tool-1:0',
            header: null,
            question: 'Which colour?',
            multiSelect: false,
            options: [{ label: 'Crimson', description: null }],
            answer: null,
          },
        ],
      },
      { terminal: true },
    );
    const chat = document.querySelector('[data-question-chat]');
    expect(chat).not.toBeNull();
    fireEvent.click(chat as Element);
    // The composer really did un-hide -- that is `chattingAbout`'s whole job.
    expect(document.querySelector('[data-composer-bar]')).not.toBeNull();
    // But the card is still the live surface: the option is still there.
    expect(document.querySelector('[data-question-option]')).not.toBeNull();
    expect(strip()).toBeNull();
  });

  it('is not drawn on a read-only source, same as the rest of the composer', () => {
    draw({}, { records: false, terminal: true });
    expect(document.querySelector('[data-composer-bar]')).toBeNull();
    expect(strip()).toBeNull();
  });

  it('presses the session’s own key over the same bridge the mode row uses', async () => {
    const send = vi.fn(async (): Promise<PaneSendResult> => 'sent');
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { terminal: { send } },
    });
    draw({}, { terminal: true });
    const escapeKey = document.querySelector('[data-key-strip-key="escape"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(escapeKey);
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledWith('p1', { kind: 'escape' }, 's1');
    Reflect.deleteProperty(window, 'api');
  });

  it('sends Space as one character of literal text, not a key name', async () => {
    const send = vi.fn(async (): Promise<PaneSendResult> => 'sent');
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { terminal: { send } },
    });
    draw({}, { terminal: true });
    const spaceKey = document.querySelector('[data-key-strip-key="space"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(spaceKey);
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledWith('p1', { kind: 'text', text: ' ' }, 's1');
    Reflect.deleteProperty(window, 'api');
  });

  /**
   * THE S2 REGRESSION. `sendKey` used to call `terminal.send` directly, with
   * no busy-guard, no refusal caption and no missing-bridge report -- the
   * exact three things `cycleMode`'s own comment says a repeat send needs
   * ("held down, this queued a `back-tab` per repeat into a live agent with
   * nothing on screen counting them"), on the identical channel. Both tests
   * below go through `pressPaneKey`, the mechanism now SHARED with
   * `cycleMode` rather than copied -- so a refusal or an in-flight guard
   * raised by either control shows up on the one caption both read,
   * `data-mode-cycle`.
   */
  it('surfaces a refusal from the shared bridge, on the caption the mode row already reads', async () => {
    const send = vi.fn(async (): Promise<PaneSendResult> => 'refused');
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { terminal: { send } },
    });
    draw({}, { terminal: true });
    const escapeKey = document.querySelector('[data-key-strip-key="escape"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(escapeKey);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('[data-mode-refusal]')?.getAttribute('data-mode-refusal')).toBe(
      'true',
    );
    expect(document.querySelector('[data-mode-cycle]')?.textContent).toContain('not sent');
    Reflect.deleteProperty(window, 'api');
  });

  it('reports a missing bridge instead of sending nothing silently', async () => {
    // No `window.api` at all -- the browser build, or Electron before preload
    // has run.
    draw({}, { terminal: true });
    const escapeKey = document.querySelector('[data-key-strip-key="escape"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(escapeKey);
    });
    expect(document.querySelector('[data-mode-cycle]')?.textContent).toContain(
      'no keyboard into a session',
    );
  });

  it('does not queue a second press while the first is still in flight', async () => {
    // A plain object, not a reassigned `let`: TS narrows a closure-only
    // reassignment of a `let` to `null` at the read site, which is a control
    // -flow quirk this test does not need to fight.
    const inFlight: { resolve: ((result: PaneSendResult) => void) | null } = { resolve: null };
    const send = vi.fn(
      () =>
        new Promise<PaneSendResult>((resolve) => {
          inFlight.resolve = resolve;
        }),
    );
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { terminal: { send } },
    });
    draw({}, { terminal: true });
    const escapeKey = document.querySelector('[data-key-strip-key="escape"]') as HTMLElement;
    const enterKey = document.querySelector('[data-key-strip-key="enter"]') as HTMLElement;
    // Two taps before the first ever resolves -- a hurried repeat on a phone,
    // on two DIFFERENT strip buttons, which is still one channel into one
    // pane.
    await act(async () => {
      fireEvent.click(escapeKey);
      await Promise.resolve();
      fireEvent.click(enterKey);
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('[data-mode-cycle-state]')?.getAttribute('data-mode-cycle-state'),
    ).toBe('busy');
    inFlight.resolve?.('sent');
    await act(async () => {
      await Promise.resolve();
    });
    Reflect.deleteProperty(window, 'api');
  });
});
