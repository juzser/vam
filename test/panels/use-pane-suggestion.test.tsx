// @vitest-environment happy-dom

/**
 * EC-39: the pane suggestion's read path and its staleness.
 *
 * The stub route is `readPane` over a recording `TmuxRun`, so what is counted
 * is the tmux argv a read would run -- and the claim that reading a suggestion
 * sends nothing is made against that argv, not against a spy on a function the
 * hook never calls.
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPane, type TmuxRun } from '../../src/main/sources/tmux/spawn.js';
import {
  type UsePaneSuggestionInput,
  usePaneSuggestion,
} from '../../src/renderer/panels/use-pane-suggestion.js';
import type { PaneReadMode } from '../../src/shared/terminal.js';
import { FRESH_HINT, SUGGESTION } from '../fixtures/prompt-suggestion-screens.js';

let screen = SUGGESTION;
let argvs: (readonly string[])[] = [];
let modes: (PaneReadMode | undefined)[] = [];

const run: TmuxRun = async (argv) => {
  argvs.push(argv);
  return { failure: null, stdout: screen, stderr: '' };
};

const read: NonNullable<UsePaneSuggestionInput['read']> = async (_project, row, mode) => {
  modes.push(mode);
  const pane = await readPane(run, `vam-${row ?? ''}`, 0);
  if (pane.kind !== 'ok') throw new Error('stub run never fails');
  return { kind: 'ok', name: `vam-${row ?? ''}`, text: pane.text, cursor: pane.cursor };
};

const BASE: UsePaneSuggestionInput = {
  read,
  projectId: 'p1',
  rowId: 's1',
  phone: false,
  tab: 'Response',
  status: 'idle',
  draft: '',
  cardSuggestion: null,
};

const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const captures = () => argvs.filter((argv) => argv.includes('capture-pane')).length;

beforeEach(() => {
  vi.useFakeTimers();
  screen = SUGGESTION;
  argvs = [];
  modes = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('usePaneSuggestion (EC-39)', () => {
  it('reads the standing suggestion while idle, on Response, with an empty draft', async () => {
    const { result } = renderHook((props) => usePaneSuggestion(props), { initialProps: BASE });
    await settle();
    expect(result.current).toBe('run the test');
  });

  it.each([
    ['the session is running', { status: 'running' as const }],
    ['the draft is non-empty', { draft: 'x' }],
    ['the tab is not Response', { tab: 'Terminal' }],
    ['it is the phone', { phone: true }],
    ['a question card offers one', { cardSuggestion: 'Codex CLI' }],
    ['there is no session', { rowId: undefined }],
    ['there is no reader', { read: undefined }],
  ])('makes no capture call while %s', async (_name, over) => {
    const { result } = renderHook((props) => usePaneSuggestion(props), {
      initialProps: { ...BASE, ...over } as UsePaneSuggestionInput,
    });
    await settle();
    await tick(10_000);
    expect(captures()).toBe(0);
    expect(result.current).toBeNull();
  });

  it('reads at most once per 2 s while idle', async () => {
    renderHook((props) => usePaneSuggestion(props), { initialProps: BASE });
    await settle();
    expect(captures()).toBe(1);
    await tick(1_999);
    expect(captures()).toBe(1);
    await tick(1);
    expect(captures()).toBe(2);
    await tick(10_000);
    expect(captures()).toBe(7);
  });

  it('does not beat the 2 s rate by toggling the draft', async () => {
    const view = renderHook((props) => usePaneSuggestion(props), { initialProps: BASE });
    await settle();
    view.rerender({ ...BASE, draft: 'a' });
    view.rerender({ ...BASE, draft: '' });
    await tick(500);
    expect(captures()).toBe(1);
    await tick(1_500);
    expect(captures()).toBe(2);
  });

  it('clears at once on a keystroke into the draft, and re-reads once it is empty again', async () => {
    const view = renderHook((props) => usePaneSuggestion(props), { initialProps: BASE });
    await settle();
    expect(view.result.current).toBe('run the test');
    view.rerender({ ...BASE, draft: 'r' });
    expect(view.result.current).toBeNull();
    view.rerender({ ...BASE, draft: '' });
    expect(view.result.current).toBeNull();
    await tick(2_000);
    expect(view.result.current).toBe('run the test');
  });

  it('clears at once on a session switch, before any new read', async () => {
    const view = renderHook((props) => usePaneSuggestion(props), { initialProps: BASE });
    await settle();
    const before = captures();
    view.rerender({ ...BASE, rowId: 's2' });
    expect(view.result.current).toBeNull();
    expect(captures()).toBe(before);
  });

  it('clears when the session leaves idle, and a later idle re-reads it', async () => {
    const view = renderHook((props) => usePaneSuggestion(props), { initialProps: BASE });
    await settle();
    view.rerender({ ...BASE, status: 'running' });
    expect(view.result.current).toBeNull();
    const before = captures();
    await tick(10_000);
    expect(captures()).toBe(before);
    view.rerender({ ...BASE, status: 'idle' });
    expect(view.result.current).toBeNull();
    await tick(2_000);
    expect(view.result.current).toBe('run the test');
  });

  it('drops a read that lands after the session moved on', async () => {
    let release: (() => void) | undefined;
    const slow: UsePaneSuggestionInput['read'] = (project, row, mode) =>
      new Promise((resolve) => {
        release = () => resolve(read(project, row, mode));
      });
    const view = renderHook((props) => usePaneSuggestion(props), {
      initialProps: { ...BASE, read: slow },
    });
    await settle();
    view.rerender({ ...BASE, read: slow, draft: 'r' });
    await act(async () => release?.());
    await settle();
    expect(view.result.current).toBeNull();
  });

  it('is null for a screen with no suggestion, such as the fresh-session hint', async () => {
    screen = FRESH_HINT;
    const { result } = renderHook((props) => usePaneSuggestion(props), { initialProps: BASE });
    await settle();
    expect(captures()).toBe(1);
    expect(result.current).toBeNull();
  });

  it('only ever runs capture calls: reading sends nothing to the session', async () => {
    renderHook((props) => usePaneSuggestion(props), { initialProps: BASE });
    await settle();
    await tick(6_000);
    expect(argvs.length).toBeGreaterThan(0);
    for (const argv of argvs) {
      expect(argv).toContain('capture-pane');
      expect(argv).not.toContain('send-keys');
    }
  });

  it("asks every read in 'echo' mode: it never proves, so it never refreshes the aim", async () => {
    renderHook((props) => usePaneSuggestion(props), { initialProps: BASE });
    await settle();
    await tick(6_000);
    expect(modes.length).toBeGreaterThan(2);
    expect(modes.every((mode) => mode === 'echo')).toBe(true);
  });
});
