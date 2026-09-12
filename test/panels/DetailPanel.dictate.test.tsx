// @vitest-environment happy-dom

/**
 * THE MICROPHONE BESIDE THE SEND BUTTON.
 *
 * Operator: "add a record feature so a prompt can be spoken, with the icon
 * next to Send."
 *
 * `test/panels/dictation.test.ts` holds the wrapper over the Web Speech API --
 * what is final, what is interim, and what every failure says. This is the
 * half that makes it a control: when it is drawn, what pressing it does, and
 * where the words land.
 *
 * THE FAKE IS ON THE GLOBAL SCOPE RATHER THAN INJECTED THROUGH A PROP, and
 * that is deliberate: the module reads `globalThis` exactly as it will in a
 * browser, so these tests exercise the real detection path instead of a seam
 * built for them. The panel's prop surface is already large enough that adding
 * one for a capability the platform either has or does not would be the wrong
 * trade.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = false;
  interimResults = false;
  started = 0;
  stopped = 0;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started += 1;
  }
  stop() {
    this.stopped += 1;
    this.onend?.();
  }
  say(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal: true })],
    });
  }
  fail(error: string) {
    this.onerror?.({ error });
    this.onend?.();
  }
}

const DECISION: Decision = { id: 'd1', label: 'turn', input: 'ask', output: 'done', commands: [] };

function draw(over: Partial<DetailPanelProps> = {}) {
  const session: Session = {
    id: 's1',
    title: 'Provider survey',
    icon: null,
    epic: null,
    branch: 'topic/rework',
    status: 'running',
    runningAgents: 0,
    activity: null,
    age: '3m',
    decisions: [DECISION],
  };
  const project: Project = {
    id: 'p1',
    name: 'factory',
    source: 'claude-code',
    sessions: [session],
  };
  const entry: SessionEntry = { project, session };
  const onDraftChange = vi.fn();
  render(
    <DetailPanel
      entry={entry}
      decision={DECISION}
      draft=""
      onDraftChange={onDraftChange}
      onSubmit={() => {}}
      composing={true}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={true}
      actionIndex={0}
      width={408}
      resizeHandle={null}
      {...over}
    />,
  );
  return { onDraftChange };
}

const mic = () => document.querySelector<HTMLElement>('[data-prompt-dictate]');
const send = () => document.querySelector<HTMLElement>('[data-prompt-record]');

beforeEach(() => {
  FakeRecognition.last = null;
  Object.defineProperty(globalThis, 'SpeechRecognition', {
    configurable: true,
    value: FakeRecognition,
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(globalThis as object, 'SpeechRecognition');
});

describe('dictating a prompt', () => {
  it('is not drawn where the platform has no recogniser', () => {
    // ABSENT, NOT DIMMED -- the rule the directory picker and the attach
    // button already follow in this file. A microphone that cannot listen is
    // not a disabled microphone, it is not a microphone.
    Reflect.deleteProperty(globalThis as object, 'SpeechRecognition');
    draw();
    expect(mic()).toBeNull();
    expect(send(), 'and the composer is otherwise intact').not.toBeNull();
  });

  it('sits beside the send button, which is where the operator was told it is', () => {
    draw();
    expect(mic()).not.toBeNull();
    // Same row, and immediately before it: `Note` wraps the send control, so
    // the comparison is against the wrapper that actually contains it.
    const row = mic()?.closest('[data-prompt-tools]');
    expect(row, 'the mic is in the tools row').not.toBeNull();
    expect(row?.contains(send() as Node)).toBe(true);
  });

  it('listens on the first press and stops on the second', () => {
    draw();
    expect(mic()?.getAttribute('aria-pressed')).toBe('false');
    act(() => {
      fireEvent.click(mic() as HTMLElement);
    });
    expect(FakeRecognition.last?.started).toBe(1);
    expect(mic()?.getAttribute('aria-pressed')).toBe('true');
    act(() => {
      fireEvent.click(mic() as HTMLElement);
    });
    expect(FakeRecognition.last?.stopped).toBe(1);
    expect(mic()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('says which act it performs in each state, since it paints no word', () => {
    draw();
    const idle = mic()?.getAttribute('aria-label') ?? '';
    act(() => {
      fireEvent.click(mic() as HTMLElement);
    });
    const listening = mic()?.getAttribute('aria-label') ?? '';
    expect(idle).not.toBe('');
    expect(listening).not.toBe('');
    expect(idle).not.toBe(listening);
    expect(listening.toLowerCase()).toMatch(/stop|listening/);
  });

  it('appends what was said to the draft, rather than replacing it', () => {
    // The operator may have typed half a prompt already, and a microphone
    // that clears it is worse than one that does nothing.
    const { onDraftChange } = draw({ draft: 'ship the branch' });
    act(() => {
      fireEvent.click(mic() as HTMLElement);
    });
    act(() => {
      FakeRecognition.last?.say('and then open the PR');
    });
    expect(onDraftChange).toHaveBeenCalledWith('ship the branch and then open the PR');
  });

  it('starts an empty draft without a leading space', () => {
    const { onDraftChange } = draw({ draft: '' });
    act(() => {
      fireEvent.click(mic() as HTMLElement);
    });
    act(() => {
      FakeRecognition.last?.say('open the PR');
    });
    expect(onDraftChange).toHaveBeenCalledWith('open the PR');
  });

  it('draws the failure as a sentence, and stops listening', () => {
    draw();
    act(() => {
      fireEvent.click(mic() as HTMLElement);
    });
    act(() => {
      FakeRecognition.last?.fail('not-allowed');
    });
    const note = document.querySelector('[data-dictate-error]');
    expect(note?.textContent ?? '').toMatch(/permission|allow/i);
    // AND THE BUTTON GOES BACK. A microphone left lit over a recogniser that
    // stopped is the state where the operator keeps talking to nothing.
    expect(mic()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('clears the last failure when it is tried again', () => {
    draw();
    act(() => {
      fireEvent.click(mic() as HTMLElement);
    });
    act(() => {
      FakeRecognition.last?.fail('no-speech');
    });
    expect(document.querySelector('[data-dictate-error]')).not.toBeNull();
    act(() => {
      fireEvent.click(mic() as HTMLElement);
    });
    expect(document.querySelector('[data-dictate-error]')).toBeNull();
  });
});
