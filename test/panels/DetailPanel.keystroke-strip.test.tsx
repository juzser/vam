// @vitest-environment happy-dom

/**
 * The phone keystroke strip -- eight `PaneKey` shapes reachable by tap:
 * Escape, Tab, Enter, Back-Tab (Shift-Tab), Space, Backspace, and Up/Down
 * (vam/terminal-arrows -- a phone has no arrow keys and Claude Code's own
 * pickers need them).
 *
 * Gated on `canSendKeys`: `canCycleMode` (the mode row's own predicate,
 * `vamControlled === true && terminal !== false`, for the LOCAL
 * `window.api.terminal.send` channel) OR'd with `canSendKeysRemotely`
 * (`vamControlled === true` alone -- deliberately NOT `terminal !== false`,
 * since the remote server reports `terminal: false` for every phone client
 * by design; see that constant's own comment in `DetailPanel.tsx`). WHICH
 * keys actually render is a separate question, answered by
 * `hasLocalTerminalChannel` alone: all eight where `window.api` exists, the
 * six `paneKeyToRemoteKeyId` answers for otherwise (`shared/remote-key.ts`).
 *
 * Placed first inside `data-composer-bar` so it inherits `composerHidden` --
 * a `QuestionCard` open makes it disappear with the rest of the composer, for
 * free.
 */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import type { PaneSendResult } from '../../src/shared/terminal.js';
import { onBothPlatforms } from '../support/platform.js';

const SESSION: Session = {
  id: 's1',
  title: 'Provider survey',
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

  it('is drawn even where the source reports no terminal at all -- the phone’s own real case', () => {
    // `terminal: false` used to mean "nothing here to send a key into", full
    // stop. It no longer does: the remote server marks EVERY phone client
    // this way on purpose (`UNSERVED.terminal`, `remote/server.ts`), and this
    // is exactly the state `/api/send-key` exists to answer instead of
    // leaving silent -- `canSendKeysRemotely`'s own comment in
    // `DetailPanel.tsx` says so. Gating this on `terminal !== false`, the way
    // `canCycleMode` does for the local channel, would make the strip never
    // draw on the one surface it was built for.
    draw({}, { terminal: false });
    expect(strip()).not.toBeNull();
  });

  it('is drawn for a session vam started, on a source with a terminal, on phone', () => {
    draw({}, { terminal: true });
    expect(strip()).not.toBeNull();
    // All twenty: every KEY_STRIP key has a remote id now, so the strip draws
    // the same keys with no `window.api` mocked (Up and Down included).
    expect(keys().map((el) => el.getAttribute('data-key-strip-key'))).toEqual([
      'escape',
      'tab',
      'enter',
      'back-tab',
      'space',
      'backspace',
      'delete',
      'up',
      'down',
      'left',
      'right',
      'ctrl-c',
      'ctrl-d',
      'ctrl-l',
      'ctrl-z',
      'ctrl-r',
      'ctrl-a',
      'ctrl-e',
      'ctrl-w',
      'ctrl-u',
    ]);
  });

  it('draws a plain Tab key now, over the same literal-text path Space already proved', () => {
    // `KEY_STRIP`'s own header explains why Tab needed no new `PaneKey` kind
    // (it reuses the one-character `text` path `space` already took), and
    // why it is one of the eight the remote channel carries too -- so it shows
    // up here even with no `window.api` mocked (the default `draw()` below).
    draw();
    expect(document.querySelector('[data-key-strip-key="tab"]')).not.toBeNull();
    expect(
      keys()
        .map((k) => k.getAttribute('data-key-strip-key'))
        .sort(),
    ).toEqual(
      [
        'back-tab',
        'backspace',
        'down',
        'enter',
        'escape',
        'space',
        'tab',
        'up',
        'delete',
        'left',
        'right',
        ...['c', 'd', 'l', 'z', 'r', 'a', 'e', 'w', 'u'].map((l) => `ctrl-${l}`),
      ].sort(),
    );
  });

  it('sends Up/Down as real navigation keys, so a phone can walk a picker too', async () => {
    // vam/terminal-arrows. A phone has no arrow keys at all, and Claude
    // Code's own option pickers are walked with them -- the same report the
    // Terminal tab's own keyboard fix answers, from the surface that never
    // had a keyboard to begin with.
    const send = vi.fn(async (): Promise<PaneSendResult> => 'sent');
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { terminal: { send } },
    });
    draw({}, { terminal: true });
    const upKey = document.querySelector('[data-key-strip-key="up"]') as HTMLElement;
    const downKey = document.querySelector('[data-key-strip-key="down"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(upKey);
      await Promise.resolve();
    });
    expect(send).toHaveBeenLastCalledWith('p1', { kind: 'nav', nav: 'up' }, 's1');
    await act(async () => {
      fireEvent.click(downKey);
      await Promise.resolve();
    });
    expect(send).toHaveBeenLastCalledWith('p1', { kind: 'nav', nav: 'down' }, 's1');
    Reflect.deleteProperty(window, 'api');
  });

  it('labels Escape and Enter with short, plain captions -- no confusion with the textarea possible', () => {
    // REVERSED (PR #530 follow-up): this used to assert the OPPOSITE --
    // that the caption said MORE than the bare key name (`Esc → agent`),
    // to read as distinct from a key row the textarea itself used to
    // print. That row is long gone (the paragraph below), and the operator
    // asked for the reverse of the added wording too: "short plain
    // labels... instead of '⟲→ agent' / '↩→ agent' style captions" -- so
    // the strip's own caption is now exactly `Esc` and exactly `Enter`, nothing
    // appended, on every platform (`chordSymbols` used to vary this by
    // `navigator.platform`; see the platform test below for why that had to
    // go too).
    draw({}, { composing: true });
    const escapeKey = document.querySelector('[data-key-strip-key="escape"]');
    const enterKey = document.querySelector('[data-key-strip-key="enter"]');
    expect(escapeKey?.textContent).toBe('Esc');
    expect(enterKey?.textContent).toBe('Enter');
    // AND THE TEXTAREA NAMES NO KEY AT ALL TO BE CONFUSED WITH. The strip's
    // button is now the only thing under the composer that says "Esc" on any
    // route: the key row beneath the input is gone entirely, at the operator's
    // ask ("nothing is ever displayed down there"). This was already the
    // ambiguity the test was written about, and the answer is now structural
    // rather than a matter of which caption won.
    expect(document.querySelector('[data-prompt-keys]')).toBeNull();
    expect(document.querySelector('[data-prompt-escape]')).toBeNull();
  });

  /**
   * THE STRIP NO LONGER PAINTS chords.ts's PLATFORM-READ TABLE (PR #530
   * follow-up, reversing what this test used to pin). It shipped once with
   * seven glyphs hand-typed straight into `KEY_STRIP`'s captions, then moved
   * to `chordSymbols`/`ChordGlyphs` so it could not drift from the app's one
   * table of platform glyphs -- but `chordSymbols` is `navigator.platform`-
   * read (`chords.ts`'s own comment), so the SAME button painted `⎋ → agent`
   * on an iPhone and `Esc → agent` on the Android phone this same bundle is
   * served to over Tailscale. The operator asked for one short, plain label
   * instead, independent of which phone is reading it: `KEY_STRIP.label` is
   * now a hard-coded string, and this test's whole point is that it reads
   * the SAME on both platform branches `onBothPlatforms` still drives --
   * proving the platform-dependence is gone, not merely relocated.
   */
  it('paints the same short, plain label on every key regardless of platform', () => {
    const EXPECT: Readonly<Record<string, string>> = {
      escape: 'Esc',
      tab: 'Tab',
      enter: 'Enter',
      backspace: '⌫',
      'back-tab': 'Shift+Tab',
      space: 'Space',
      up: '↑',
      down: '↓',
    };
    // `window.api` mocked here, for all eight -- Up/Down only ever paint over
    // the local channel (`hasLocalTerminalChannel`), and this test's whole
    // point is that every key on the strip reads the same fixed label, not
    // just the six the remote channel also carries.
    const send = vi.fn(async (): Promise<PaneSendResult> => 'sent');
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { terminal: { send } },
    });
    onBothPlatforms(() => {
      draw({}, { terminal: true });
      for (const [id, label] of Object.entries(EXPECT)) {
        const el = document.querySelector(`[data-key-strip-key="${id}"]`);
        expect(el?.textContent, id).toBe(label);
      }
      cleanup();
    });
    Reflect.deleteProperty(window, 'api');
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

  it('sends Tab as one character of literal text, not a key name', async () => {
    const send = vi.fn(async (): Promise<PaneSendResult> => 'sent');
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { terminal: { send } },
    });
    draw({}, { terminal: true });
    const tabKey = document.querySelector('[data-key-strip-key="tab"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(tabKey);
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledWith('p1', { kind: 'text', text: '\t' }, 's1');
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

  it('falls back to the remote channel with no window.api at all, and reports what it answers', async () => {
    // No `window.api` -- the browser build, served over Tailscale, with no
    // Electron preload ever running. Escape is one of the six
    // `paneKeyToRemoteKeyId` answers for, so this no longer refuses
    // instantly the way it used to for every key: it takes the exact path
    // `send-key-remote.ts`'s own tests already cover end to end
    // (`test/panels/send-key-remote.test.ts`), and this test only checks
    // `DetailPanel` wires that path's refusal onto the same caption the
    // local channel already uses.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      json: async () => ({
        ok: false,
        error: { kind: 'refused', code: 'no-terminal', message: 'no pane for this session' },
      }),
    })) as unknown as typeof fetch;
    draw({}, { terminal: true });
    const escapeKey = document.querySelector('[data-key-strip-key="escape"]') as HTMLElement;
    // The fetch chain here is several microtasks deeper than the desktop
    // channel's own single `await send(...)` (`fetch` itself, then
    // `response.json()`, then `sendKeyRemote`'s own await) -- `waitFor`
    // polls rather than counting ticks, the same reason `DetailPanel.
    // file-ref.test.tsx` already gives for using it.
    await act(async () => {
      fireEvent.click(escapeKey);
    });
    await waitFor(() => {
      expect(document.querySelector('[data-mode-cycle]')?.textContent).toContain('not sent');
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/send-key',
      expect.objectContaining({ method: 'POST' }),
    );
    globalThis.fetch = originalFetch;
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

describe('the quick-key strip, item 21/22: text chips in the operator’s order', () => {
  const ORDER = [
    'Keyboard',
    'Paste',
    'Esc',
    'Tab',
    'Enter',
    'Shift+Tab',
    'Space',
    '⌫',
    'Del',
    '↑',
    '↓',
    '←',
    '→',
    'Ctrl+C',
    'Ctrl+D',
    'Ctrl+L',
    'Ctrl+Z',
    'Ctrl+R',
    'Ctrl+A',
    'Ctrl+E',
    'Ctrl+W',
    'Ctrl+U',
    'Terminal',
    'More',
  ];
  const chips = () => [...document.querySelectorAll('[data-key-strip] button')];

  it('lists every chip in order, all text with no svg but Backspace’s glyph', () => {
    draw({}, { terminal: true, onRequestTab: () => {} });
    expect(chips().map((c) => c.textContent)).toEqual(ORDER);
    for (const chip of chips()) expect(chip.querySelector('svg')).toBeNull();
    expect(chips().every((c) => (c.getAttribute('aria-label') ?? '') !== '')).toBe(true);
  });

  it('omits the Terminal chip where the source has no terminal', () => {
    draw({}, { terminal: false, onRequestTab: () => {} });
    expect(chips().map((c) => c.textContent)).toEqual(ORDER.filter((l) => l !== 'Terminal'));
  });

  it('sends each new chip’s PaneKey over the local channel', async () => {
    const send = vi.fn(async (): Promise<PaneSendResult> => 'sent');
    Object.defineProperty(window, 'api', { configurable: true, value: { terminal: { send } } });
    draw({}, { terminal: true });
    const press = async (id: string) => {
      await act(async () => {
        fireEvent.click(document.querySelector(`[data-key-strip-key="${id}"]`) as HTMLElement);
        await Promise.resolve();
        await Promise.resolve();
      });
    };
    await press('delete');
    expect(send).toHaveBeenLastCalledWith('p1', { kind: 'nav', nav: 'delete' }, 's1');
    await press('left');
    expect(send).toHaveBeenLastCalledWith('p1', { kind: 'nav', nav: 'left' }, 's1');
    await press('ctrl-c');
    expect(send).toHaveBeenLastCalledWith('p1', { kind: 'control', letter: 'c' }, 's1');
    await press('ctrl-u');
    expect(send).toHaveBeenLastCalledWith('p1', { kind: 'control', letter: 'u' }, 's1');
    Reflect.deleteProperty(window, 'api');
  });

  it('POSTs each new chip with its remote id on a phone with no window.api', async () => {
    const originalFetch = globalThis.fetch;
    const bodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return { json: async () => ({ ok: true, value: null }) };
    }) as unknown as typeof fetch;
    draw({}, { terminal: false });
    for (const [id, remote] of [
      ['delete', 'delete'],
      ['left', 'arrow-left'],
      ['ctrl-c', 'ctrl-c'],
    ] as const) {
      const chip = document.querySelector(`[data-key-strip-key="${id}"]`);
      expect(chip, id).not.toBeNull();
      await act(async () => {
        fireEvent.click(chip as HTMLElement);
      });
      await waitFor(() => expect(bodies.at(-1)).toEqual({ sessionId: 's1', key: remote }));
    }
    globalThis.fetch = originalFetch;
  });

  it('the Keyboard chip is always drawn: focuses the composer when blurred, blurs it when focused', async () => {
    draw({}, { terminal: true });
    const chip = () => document.querySelector('[data-key-strip-keyboard]') as HTMLElement;
    const box = document.querySelector('[data-composer-bar] textarea') as HTMLTextAreaElement;
    expect(chip()).not.toBeNull();
    expect(document.activeElement).not.toBe(box);
    await act(async () => {
      fireEvent.click(chip());
    });
    expect(document.activeElement).toBe(box);
    expect(chip()).not.toBeNull();
    await act(async () => {
      fireEvent.click(chip());
    });
    expect(document.activeElement).not.toBe(box);
  });
});

describe('the quick-key strip: full key matrix, and the chips that are not keys', () => {
  const MATRIX: readonly (readonly [string, string, object])[] = [
    ['escape', 'escape', { kind: 'escape' }],
    ['tab', 'tab', { kind: 'text', text: '\t' }],
    ['enter', 'enter', { kind: 'enter', shift: false }],
    ['back-tab', 'back-tab', { kind: 'back-tab' }],
    ['space', 'space', { kind: 'text', text: ' ' }],
    ['backspace', 'backspace', { kind: 'backspace' }],
    ['delete', 'delete', { kind: 'nav', nav: 'delete' }],
    ['up', 'arrow-up', { kind: 'nav', nav: 'up' }],
    ['down', 'arrow-down', { kind: 'nav', nav: 'down' }],
    ['left', 'arrow-left', { kind: 'nav', nav: 'left' }],
    ['right', 'arrow-right', { kind: 'nav', nav: 'right' }],
    ...(['c', 'd', 'l', 'z', 'r', 'a', 'e', 'w', 'u'] as const).map(
      (l) => [`ctrl-${l}`, `ctrl-${l}`, { kind: 'control', letter: l }] as const,
    ),
  ];

  it('every key sends its own PaneKey over the local channel', async () => {
    const send = vi.fn(async (): Promise<PaneSendResult> => 'sent');
    Object.defineProperty(window, 'api', { configurable: true, value: { terminal: { send } } });
    draw({}, { terminal: true });
    for (const [id, , pane] of MATRIX) {
      await act(async () => {
        fireEvent.click(document.querySelector(`[data-key-strip-key="${id}"]`) as HTMLElement);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(send, id).toHaveBeenLastCalledWith('p1', pane, 's1');
    }
    expect(send).toHaveBeenCalledTimes(MATRIX.length);
    Reflect.deleteProperty(window, 'api');
  });

  it('every key POSTs its own remote id where there is no window.api', async () => {
    const originalFetch = globalThis.fetch;
    const bodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return { json: async () => ({ ok: true, value: null }) };
    }) as unknown as typeof fetch;
    draw({}, { terminal: false });
    for (const [id, remote] of MATRIX) {
      await act(async () => {
        fireEvent.click(document.querySelector(`[data-key-strip-key="${id}"]`) as HTMLElement);
      });
      await waitFor(() => expect(bodies.at(-1), id).toEqual({ sessionId: 's1', key: remote }));
    }
    expect(bodies).toHaveLength(MATRIX.length);
    globalThis.fetch = originalFetch;
  });

  it('the More chip scrolls the strip to its own end', async () => {
    draw({}, { terminal: true });
    const nav = document.querySelector('[data-key-strip]') as HTMLElement;
    const scrollTo = vi.fn();
    Object.defineProperty(nav, 'scrollTo', { configurable: true, value: scrollTo });
    Object.defineProperty(nav, 'scrollWidth', { configurable: true, value: 1234 });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-key-strip-more]') as HTMLElement);
    });
    expect(scrollTo).toHaveBeenCalledWith({ left: 1234, behavior: 'smooth' });
  });

  it('the Terminal chip asks for the Terminal tab', async () => {
    const onRequestTab = vi.fn();
    draw({}, { terminal: true, onRequestTab });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-key-strip-screen]') as HTMLElement);
    });
    expect(onRequestTab).toHaveBeenCalledWith('Terminal');
  });

  it('Paste reads the clipboard into the draft, never through the send-key route', async () => {
    const readText = vi.fn(async () => 'pasted!');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const onDraftChange = vi.fn();
    draw({}, { terminal: true, onDraftChange });
    await act(async () => {
      fireEvent.click(document.querySelector('[data-key-strip-paste]') as HTMLElement);
    });
    await waitFor(() => expect(onDraftChange).toHaveBeenCalledWith('pasted!'));
    expect(readText).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    globalThis.fetch = originalFetch;
    Reflect.deleteProperty(navigator, 'clipboard');
  });
});
