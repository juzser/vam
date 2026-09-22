// @vitest-environment happy-dom

/**
 * DetailPanel's two narrow polls -- the pane prompt and the running model --
 * pause outright while the window is hidden and resume with one immediate
 * tick the moment it is visible again, the same shape
 * `useVisibilityInterval.test.ts` pins in isolation and `useSourceModel` /
 * `useAgentWork` pin for their own callers. Neither poll feeds
 * `notify/waiting.ts` (its own header names `useSourceModel` as the app's
 * one transition-detection loop), so `hidden: 'pause'` costs nothing this
 * pane could not already afford to lose while nobody is looking.
 *
 * WHAT THIS FILE IS NOT: a second copy of the READ itself.
 * `DetailPanel.pane-prompt.test.tsx` already pins what the prompt poll
 * DRAWS and `DetailPanel.model-picker.test.tsx`'s "the button names the
 * model the session is running" already pins what the model poll DRAWS and
 * WIRES; this file is the CADENCE alone, split out the way this repo splits
 * `DetailPanel.*.test.tsx` by concern rather than growing one giant file.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import type { PromptView } from '../../src/shared/answer.js';
import type { SessionModel } from '../../src/shared/terminal.js';

const DECISION: Decision = {
  id: 'd1',
  label: 'step 1',
  input: 'ask',
  output: 'answered',
  commands: [],
};

const SESSION: Session = {
  id: 's1',
  title: 'atlas work',
  epic: null,
  branch: null,
  status: 'waiting',
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
    delivers: true,
    terminal: true,
    ...over,
  };
  render(<DetailPanel {...props} />);
}

/** Starts the document VISIBLE; returns the spy so a test can flip it. */
const visibilitySpy = () => vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

const changeVisibility = async () => {
  await act(async () => {
    fireEvent(document, new Event('visibilitychange'));
  });
};

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the pane-prompt poll (PROMPT_POLL_MS)', () => {
  /** `readable`'s own conditions, off `DetailPanel.tsx`: a row vam started,
   *  waiting, with no recorded question -- the shape `pane-prompt.test.tsx`
   *  itself draws under the name `waiting`. */
  const waiting = { waitingFor: 'permission prompt', questions: [] } as const;
  const PROMPT: PromptView = {
    kind: 'prompt',
    prompt: { title: 'Do you want to proceed?', options: ['Yes', 'No'] },
  };

  it('stops re-reading the pane once the window is hidden, and never reads at that cadence again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const visibility = visibilitySpy();
    const prompt = vi.fn(async () => PROMPT);
    draw({ entry: { project: PROJECT, session: { ...SESSION, ...waiting } }, prompt });
    await settle();
    const before = prompt.mock.calls.length;
    expect(before).toBeGreaterThan(0); // the immediate read on mount

    visibility.mockReturnValue('hidden');
    await changeVisibility();

    await act(async () => {
      vi.advanceTimersByTime(2_000 * 5); // five PROMPT_POLL_MS ticks, well past
    });
    expect(prompt.mock.calls.length).toBe(before); // nothing while hidden
    visibility.mockRestore();
  });

  it('reads once immediately the moment the window is visible again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const visibility = visibilitySpy();
    const prompt = vi.fn(async () => PROMPT);
    draw({ entry: { project: PROJECT, session: { ...SESSION, ...waiting } }, prompt });
    await settle();

    visibility.mockReturnValue('hidden');
    await changeVisibility();
    const beforeReturn = prompt.mock.calls.length;

    visibility.mockReturnValue('visible');
    await changeVisibility();
    expect(prompt.mock.calls.length).toBeGreaterThan(beforeReturn);
    visibility.mockRestore();
  });
});

describe('the running-model poll (MODEL_POLL_MS)', () => {
  const answer = (): SessionModel => ({ kind: 'model', name: 'Opus 5' });

  it('stops re-reading the model once the window is hidden, and never reads at that cadence again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const visibility = visibilitySpy();
    const model = vi.fn(async () => answer());
    draw({ model });
    await settle();
    const before = model.mock.calls.length;
    expect(before).toBeGreaterThan(0); // the immediate read on mount

    visibility.mockReturnValue('hidden');
    await changeVisibility();

    await act(async () => {
      vi.advanceTimersByTime(4_000 * 5); // five MODEL_POLL_MS ticks, well past
    });
    expect(model.mock.calls.length).toBe(before); // nothing while hidden
    visibility.mockRestore();
  });

  it('reads once immediately the moment the window is visible again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const visibility = visibilitySpy();
    const model = vi.fn(async () => answer());
    draw({ model });
    await settle();

    visibility.mockReturnValue('hidden');
    await changeVisibility();
    const beforeReturn = model.mock.calls.length;

    visibility.mockReturnValue('visible');
    await changeVisibility();
    expect(model.mock.calls.length).toBeGreaterThan(beforeReturn);
    visibility.mockRestore();
  });
});
