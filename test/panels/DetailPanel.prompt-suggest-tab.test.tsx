// @vitest-environment happy-dom

/** EC-36 / EC-37: the pane's suggestion drawn as a `Tab` key tag, and the one Tab rule that takes it. */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { defaultBindings } from '../../src/renderer/keyboard/chords.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import type { PaneSendResult } from '../../src/shared/terminal.js';
import { FRESH_HINT, SUGGESTION } from '../fixtures/prompt-suggestion-screens.js';

const DECISION: Decision = { id: 'd1', label: 'plan', input: 'ask', output: 'ok', commands: [] };
const SESSION: Session = {
  id: 's1',
  title: 'Sprint board',
  epic: null,
  branch: null,
  status: 'idle',
  runningAgents: 0,
  activity: null,
  age: '1m',
  decisions: [DECISION],
  vamControlled: true,
};
const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ENTRY: SessionEntry = { project: PROJECT, session: SESSION };

function bridge(screen: string, send: () => Promise<PaneSendResult> = async () => 'sent') {
  const read = vi.fn(async () => ({
    kind: 'ok' as const,
    name: 'vam-s1',
    text: screen,
    cursor: { row: 0, col: 0 },
  }));
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { terminal: { read, send } },
  });
  return { read, send };
}

function draw(over: Partial<DetailPanelProps> = {}) {
  const props: DetailPanelProps = {
    entry: ENTRY,
    decision: DECISION,
    draft: '',
    onDraftChange: () => {},
    onSubmit: () => {},
    composing: true,
    onCompose: () => {},
    onStopComposing: () => {},
    active: false,
    actionIndex: 0,
    width: 408,
    resizeHandle: null,
    ...over,
  };
  return render(<DetailPanel {...props} />);
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const box = () => q('textarea[aria-label="prompt to session"]') as HTMLTextAreaElement;
const ghost = () => q('[data-prompt-suggestion-ghost]');

afterEach(() => {
  Reflect.deleteProperty(window, 'api');
  cleanup();
});

describe('EC-36: the suggestion is a Tab key tag before its text', () => {
  it('draws an aria-hidden, pointer-less ghost: the Tab tag first, then the text', async () => {
    bridge(SUGGESTION);
    draw();
    await waitFor(() => expect(ghost()).not.toBeNull());
    const el = ghost() as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.className).toContain('pointer-events-none');
    const first = el.firstElementChild as HTMLElement;
    expect(first.tagName).toBe('KBD');
    expect(first.hasAttribute('data-key-tag')).toBe(true);
    expect(first.textContent).toBe('Tab');
    expect(el.textContent).toBe('Tabrun the test');
    expect(box().placeholder).toContain('run the test');
    expect(box().placeholder).not.toContain('Tab to use');
    expect(box().getAttribute('aria-keyshortcuts')).toBe('Tab');
  });

  it('a session vam does not hold is never read, and offers nothing', async () => {
    const { read } = bridge(SUGGESTION);
    const held = { ...SESSION, vamControlled: false };
    draw({ entry: { project: PROJECT, session: held } });
    await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
    expect(read).not.toHaveBeenCalled();
    expect(ghost()).toBeNull();
    expect(box().hasAttribute('aria-keyshortcuts')).toBe(false);
  });

  it('is absent when the pane holds no suggestion', async () => {
    const { read } = bridge(FRESH_HINT);
    draw();
    await waitFor(() => expect(read).toHaveBeenCalled());
    await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
    expect(ghost()).toBeNull();
    expect(box().placeholder).not.toContain('Tab');
  });
});

describe('the question card keeps priority over the pane', () => {
  it('draws the card offer, and reads nothing, while both would apply', async () => {
    const { read } = bridge(SUGGESTION);
    const options = [{ label: 'Codex CLI', description: 'a second CLI agent' }];
    const question = {
      id: 'q:0',
      header: 'H',
      question: 'Which?',
      multiSelect: false,
      options,
      answer: null,
    };
    const session = { ...SESSION, questions: [question] };
    draw({ entry: { project: PROJECT, session } });
    fireEvent.click(q('[data-question-chat]') as HTMLElement);
    await waitFor(() => expect(ghost()?.textContent).toBe('TabCodex CLI'));
    await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
    expect(read).not.toHaveBeenCalled();
    expect(ghost()?.textContent).not.toContain('run the test');
  });
});

describe('EC-37: Tab takes the suggestion, and is the exit otherwise', () => {
  it('(a) Tab fills the draft with the suggestion, keeps focus and sends nothing', async () => {
    bridge(SUGGESTION);
    const onSubmit = vi.fn();
    const onDraftChange = vi.fn();
    draw({ onSubmit, onDraftChange });
    await waitFor(() => expect(ghost()).not.toBeNull());
    box().focus();
    expect(fireEvent.keyDown(box(), { key: 'Tab' })).toBe(false);
    expect(onDraftChange).toHaveBeenCalledWith('run the test');
    expect(document.activeElement).toBe(box());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('(b) Tab with no suggestion is not prevented, so focus can leave the box', async () => {
    const { read } = bridge(FRESH_HINT);
    draw();
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(fireEvent.keyDown(box(), { key: 'Tab' })).toBe(true);
  });

  it('(c) Shift+Tab still cycles the mode, and never takes the suggestion', async () => {
    const send = vi.fn(async (): Promise<PaneSendResult> => 'sent');
    bridge(SUGGESTION, send);
    const onDraftChange = vi.fn();
    draw({ onDraftChange });
    await waitFor(() => expect(ghost()).not.toBeNull());
    await act(async () => {
      fireEvent.keyDown(box(), { key: 'Tab', shiftKey: true });
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalled();
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it('(d) no default chord in the keyboard registry is a plain Tab', () => {
    const chords = defaultBindings().flatMap((binding) => binding.chords);
    expect(chords.filter((chord) => chord.key === 'Tab' || chord.key === '\t')).toEqual([]);
  });
});
