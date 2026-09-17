// @vitest-environment happy-dom

/**
 * The model control, in its three states -- and the keys the enabled one sends.
 *
 * The operator's ask, translated: "re-check the model picker in the prompt
 * input. Confirm whether choosing a model in vam is possible or not. If a
 * model cannot be chosen in some session, the model button should be disabled
 * for that session."
 *
 * The answer is `modelControlState` (`model-command.ts`), and this file holds
 * what each state DRAWS and DOES:
 *
 *  - RECORDING (no `deliverPrompt`): the free-text field and its note,
 *    untouched -- the factory chooses, and a request in words is the honest
 *    thing there. `readModelRequest`/`setModelRequest` are pinned in
 *    `DetailPanel.test.tsx` and must not move.
 *  - PICKER (delivers, a pane, vam's own session): a button opening a listbox
 *    of the CLI's own five aliases plus a free-text row; a choice types
 *    `/model <x>` and Enter into the session's pane over the SAME channel,
 *    with the SAME in-flight guard and refusal caption, as the mode chip's
 *    Shift-Tab. It never writes a `model:` line into the draft: on this
 *    source the draft is typed into the CLI's prompt, where that line is
 *    words the agent reads and switches nothing.
 *  - DISABLED (delivers, but no pane vam owns): the same button, disabled and
 *    dimmed, under a note that says why and what to do.
 *
 * `window.api.terminal.send` is faked at the boundary, so what is asserted is
 * the EXACT text and key order the bridge was handed -- a guard that only
 * checked "something was sent" would pass `model: opus`, which is the lie this
 * control replaces.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import type { PaneKey, PaneSendResult } from '../../src/shared/terminal.js';

const DECISION: Decision = {
  id: 'd1',
  label: 'plan',
  input: 'ask',
  output: 'answered',
  commands: [],
};

const SESSION: Session = {
  id: 's1',
  title: 'Sprint board reorder',
  icon: null,
  epic: 'board',
  branch: null,
  status: 'idle',
  runningAgents: 0,
  activity: null,
  age: '12m',
  decisions: [DECISION],
  vamControlled: true,
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ENTRY: SessionEntry = { project: PROJECT, session: SESSION };

function draw(over: Partial<DetailPanelProps> = {}) {
  const props: DetailPanelProps = {
    entry: ENTRY,
    decision: DECISION,
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
const picker = () => q<HTMLButtonElement>('[data-model-picker]');
const request = () => q<HTMLInputElement>('[data-model-request]');

type Sent = { readonly projectId: unknown; readonly key: PaneKey; readonly rowId: unknown };

/** A bridge that records every key, answering each with `answer`. */
function withBridge(answer: (key: PaneKey) => Promise<PaneSendResult> = async () => 'sent') {
  const sent: Sent[] = [];
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      terminal: {
        send: (projectId: unknown, key: PaneKey, rowId: unknown) => {
          sent.push({ projectId, key, rowId });
          return answer(key);
        },
      },
    },
  });
  return sent;
}

/** The text and key order the bridge saw -- `<enter>` for the interpreted key. */
const wire = (sent: readonly Sent[]) =>
  sent.map((s) => (s.key.kind === 'text' ? s.key.text : `<${s.key.kind}>`));

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Open the picker and choose one alias. */
async function choose(id: string) {
  act(() => picker()?.click());
  await act(async () => {
    q<HTMLButtonElement>(`[data-model-option="${id}"]`)?.click();
    await Promise.resolve();
  });
  await settle();
}

afterEach(() => {
  Reflect.deleteProperty(window, 'api');
  cleanup();
});

describe('a source that only records keeps the request line', () => {
  it('draws the free-text field with its note, and no picker, when delivers is not said', () => {
    draw();
    expect(request()).not.toBeNull();
    expect(request()?.getAttribute('data-note')).toContain('the factory chooses');
    expect(picker()).toBeNull();
  });

  it('keeps it when delivers is false, whatever the session says about itself', () => {
    draw({ delivers: false, terminal: true });
    expect(request()).not.toBeNull();
    expect(picker()).toBeNull();
    cleanup();
    draw({
      delivers: false,
      entry: { project: PROJECT, session: { ...SESSION, vamControlled: false } },
    });
    expect(request()).not.toBeNull();
    expect(picker()).toBeNull();
  });

  it('still writes the request into the draft, the one honest place it has there', () => {
    let draft = 'redo it';
    draw({
      draft,
      onDraftChange: (next) => {
        draft = next;
      },
    });
    const field = request();
    if (field !== null) fireEvent.change(field, { target: { value: 'opus' } });
    expect(draft).toBe('model: opus\nredo it');
  });
});

describe('a session vam can type into gets a real picker', () => {
  it('is a button with a listbox behind it, and the free-text field is gone', () => {
    draw({ delivers: true, terminal: true });
    const button = picker();
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute('aria-disabled')).toBeNull();
    expect(button?.getAttribute('aria-haspopup')).toBe('listbox');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.getAttribute('aria-label')).toContain('model');
    expect(request()).toBeNull();
    // In the tools row, where the field it replaces was.
    expect(button?.closest('[data-prompt-tools]')).not.toBeNull();
  });

  it('opens Default · Sonnet · Fable · Opus · Haiku and a free-text row, the provider picker’s pattern', () => {
    draw({ delivers: true, terminal: true });
    expect(q('[data-model-picker-menu]')).toBeNull();
    act(() => picker()?.click());
    // The five are a listbox OF THEIR OWN inside the popover, because the
    // free-text row is an `<input>` and an input is not an option.
    const listbox = q('[data-model-picker-menu] [role="listbox"]');
    expect(listbox).not.toBeNull();
    expect(listbox?.querySelectorAll('[data-model-option]')).toHaveLength(5);
    expect(listbox?.querySelector('[data-model-id]')).toBeNull();
    expect(picker()?.getAttribute('aria-expanded')).toBe('true');
    expect(all('[data-model-option]').map((el) => el.getAttribute('data-model-option'))).toEqual([
      'default',
      'sonnet',
      'fable',
      'opus',
      'haiku',
    ]);
    expect(all('[data-model-option]').map((el) => el.textContent?.trim())).toEqual([
      'Default',
      'Sonnet',
      'Fable',
      'Opus',
      'Haiku',
    ]);
    for (const option of all('[data-model-option]')) {
      expect(option.getAttribute('role')).toBe('option');
    }
    expect(q('[data-model-id]')?.tagName).toBe('INPUT');
  });

  it('types `/model opus` literally and then Enter, into THIS session, and closes', async () => {
    const sent = withBridge();
    draw({ delivers: true, terminal: true });
    await choose('opus');
    // EXACT: the argument form, as text, then the interpreted key. `model:
    // opus` -- the old draft line -- would be words in the prompt.
    expect(wire(sent)).toEqual(['/model opus', '<enter>']);
    for (const s of sent) {
      expect(s.projectId).toBe('p1');
      expect(s.rowId).toBe('s1');
    }
    expect(q('[data-model-picker-menu]')).toBeNull();
  });

  it('never writes a `model:` line into the draft on this source', async () => {
    withBridge();
    const seen: string[] = [];
    draw({ delivers: true, terminal: true, draft: 'ship it', onDraftChange: (n) => seen.push(n) });
    await choose('sonnet');
    expect(seen).toEqual([]);
  });

  it('says what vam can honestly claim: typed into the terminal, the session answers there', async () => {
    withBridge();
    draw({ delivers: true, terminal: true });
    await choose('opus');
    const note = q<HTMLElement>('[data-mode-cycle]');
    expect(note?.getAttribute('data-mode-cycle-state')).toBe('sent');
    expect(note?.textContent).toContain('/model opus');
    expect(note?.textContent).toContain('Sprint board reorder');
    expect(note?.textContent).toContain('the session answers there');
    // Not a claim the model changed: vam never reads the answer back.
    expect(note?.textContent ?? '').not.toMatch(/switched|changed to|now opus/i);
  });

  it('takes a full model id from the free-text row on Enter, and sends it in pieces', async () => {
    const sent = withBridge();
    draw({ delivers: true, terminal: true });
    act(() => picker()?.click());
    const field = q<HTMLInputElement>('[data-model-id]') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'claude-opus-5-20260501' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
      await Promise.resolve();
    });
    await settle();
    const typed = wire(sent);
    expect(typed.at(-1)).toBe('<enter>');
    expect(typed.slice(0, -1).join('')).toBe('/model claude-opus-5-20260501');
    expect(typed.slice(0, -1).length).toBeGreaterThan(1);
  });

  it('refuses a free-text id with a space in it before any key is built', async () => {
    const sent = withBridge();
    draw({ delivers: true, terminal: true });
    act(() => picker()?.click());
    const field = q<HTMLInputElement>('[data-model-id]') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'opus haiku' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
      await Promise.resolve();
    });
    expect(sent).toEqual([]);
    expect(q<HTMLElement>('[data-mode-cycle]')?.getAttribute('data-mode-cycle-state')).toBe(
      'refused',
    );
  });

  it('shares the mode chip’s refusal caption when tmux would not deliver', async () => {
    withBridge(async () => 'refused');
    draw({ delivers: true, terminal: true });
    await choose('haiku');
    const note = q<HTMLElement>('[data-mode-cycle]');
    expect(note?.getAttribute('data-mode-cycle-state')).toBe('refused');
    expect(note?.getAttribute('data-mode-refusal')).toBe('true');
    expect(note?.textContent).toContain('tmux');
  });

  it('stops at the first stroke that does not land, so the Return is never pressed after a refusal', async () => {
    const sent = withBridge(async () => 'refused');
    draw({ delivers: true, terminal: true });
    await choose('opus');
    expect(wire(sent)).toEqual(['/model opus']);
  });

  it('shares the in-flight guard: a second choice while one is out sends nothing', async () => {
    let land: (r: PaneSendResult) => void = () => {};
    const sent = withBridge(
      () =>
        new Promise<PaneSendResult>((resolve) => {
          land = resolve;
        }),
    );
    draw({ delivers: true, terminal: true });
    act(() => picker()?.click());
    await act(async () => {
      q<HTMLButtonElement>('[data-model-option="opus"]')?.click();
      await Promise.resolve();
    });
    expect(q<HTMLElement>('[data-mode-cycle]')?.getAttribute('data-mode-cycle-state')).toBe('busy');
    act(() => picker()?.click());
    await act(async () => {
      q<HTMLButtonElement>('[data-model-option="haiku"]')?.click();
      await Promise.resolve();
    });
    expect(wire(sent)).toEqual(['/model opus']);
    await act(async () => {
      land('sent');
      await Promise.resolve();
    });
    await settle();
    expect(wire(sent)).toEqual(['/model opus', '<enter>']);
  });

  it('reports a build with no bridge rather than pretending', async () => {
    draw({ delivers: true, terminal: true });
    await choose('opus');
    const note = q<HTMLElement>('[data-mode-cycle]');
    expect(note?.getAttribute('data-mode-cycle-state')).toBe('refused');
    expect(note?.textContent).toContain('no keyboard');
  });

  it('discloses the CLI’s side effect in its note: the choice becomes the default for new sessions', () => {
    draw({ delivers: true, terminal: true });
    const note = picker()?.getAttribute('data-note') ?? '';
    expect(note).toContain('/model');
    expect(note).toMatch(/default for new sessions/);
  });
});

describe('a session vam cannot type into gets the same button, disabled', () => {
  const DISABLED_NOTE =
    'vam has no terminal it owns for this session, so it cannot send /model — open it in a vam terminal';

  it('is disabled where vam did not start the session', () => {
    draw({
      delivers: true,
      terminal: true,
      entry: { project: PROJECT, session: { ...SESSION, vamControlled: false } },
    });
    const button = picker();
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(request()).toBeNull();
  });

  it('is disabled where the source delivers but has no terminal surface', () => {
    draw({ delivers: true, terminal: false });
    expect(picker()?.disabled).toBe(true);
    expect(picker()?.getAttribute('aria-disabled')).toBe('true');
  });

  it('is dimmed to the disabled ink other controls use, not hidden', () => {
    draw({
      delivers: true,
      terminal: true,
      entry: { project: PROJECT, session: { ...SESSION, vamControlled: false } },
    });
    // `text-ink-faint` is what `SettingsOverlay`'s stepper buttons take when
    // disabled. The paint is measured in `e2e/model-picker-shots.mjs`; this
    // holds the wiring.
    expect(picker()?.className).toContain('text-ink-faint');
    expect(picker()?.className).not.toContain('cursor-pointer');
  });

  it('carries the note that says why, and what to do, on a stop the keyboard can reach', () => {
    draw({
      delivers: true,
      terminal: true,
      entry: { project: PROJECT, session: { ...SESSION, vamControlled: false } },
    });
    // A disabled button takes no focus in any browser, so a `Note` hung on it
    // would open on hover and on nothing else -- the `title` this app
    // deleted. The note hangs on a wrapper that takes a tab stop instead.
    // Whether it really opens, by hover and by Tab, is a browser fact and is
    // measured in `e2e/model-picker-shots.mjs`; this holds the wiring.
    const shell = q<HTMLElement>('[data-model-picker-shell]');
    expect(shell?.getAttribute('data-note')).toBe(DISABLED_NOTE);
    expect(shell?.tabIndex).toBe(0);
    expect(shell?.contains(picker())).toBe(true);
  });

  it('opens nothing and sends nothing when clicked', async () => {
    const sent = withBridge();
    draw({
      delivers: true,
      terminal: true,
      entry: { project: PROJECT, session: { ...SESSION, vamControlled: false } },
    });
    act(() => picker()?.click());
    await settle();
    expect(q('[data-model-picker-menu]')).toBeNull();
    expect(sent).toEqual([]);
    expect(q('[data-mode-cycle]')).toBeNull();
  });
});
