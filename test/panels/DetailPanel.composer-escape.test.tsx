// @vitest-environment happy-dom

/**
 * ESCAPE IN THE COMPOSER INTERRUPTS THE AGENT; `Mod-[` LETS GO OF THE BOX.
 *
 * Operator request: "Escape in the composer should cancel the running prompt
 * (Claude Code's default), and leaving insert mode should move to a different
 * key."
 *
 * THIS IS AN EXTENSION OF SHIPPED BEHAVIOUR, NOT A NEW CAPABILITY. vam already
 * sends Escape into a session's pane — `TerminalTab` maps it to
 * `{kind:'escape'}` and the phone keystroke strip presses the same key over the
 * same bridge. What is new is that the composer reaches it, and it reaches it
 * through `pressPaneKey`, the SAME channel with the same in-flight guard and
 * the same refusal caption (`data-mode-cycle`), rather than growing a second.
 *
 * THE THREE OUTCOMES ARE THREE OUTCOMES, and that is most of this file.
 * "Escape went into the agent", "there is nothing running to interrupt" and
 * "vam has no keyboard into this session at all" are different facts, and this
 * pane's oldest defect is two of them looking the same
 * (`main/sources/pull-requests.ts`: "'No PRs' and 'vam could not ask' must
 * never look the same"). None of them may be silence.
 *
 * AND ESCAPE NO LONGER LEAVES THE BOX. That is the risk the change creates —
 * an operator pressing Escape by reflex now interrupts an agent — so the way
 * out is asserted to be BOTH bound and PAINTED where the operator is typing.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session, SessionStatus } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import {
  DEFAULT_PROMPT_SUBMIT_KEY,
  setActivePromptSubmitKey,
} from '../../src/renderer/prefs/submit-key.js';
import type { PaneSendResult } from '../../src/shared/terminal.js';

const COMMANDS = [{ id: 'c1', label: 'open the PR', command: 'gh pr create --fill' }];

const DECISION: Decision = {
  id: 'd9',
  label: 'sign-off',
  input: 'ship it',
  output: 'here is what to run',
  commands: COMMANDS,
};

const SLASH_COMMANDS = [
  { id: 'compact', name: 'compact', description: 'summarise the conversation so far' },
];

function sessionWith(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: 'Provider survey',
    icon: null,
    epic: null,
    branch: null,
    status: 'running',
    runningAgents: 1,
    activity: null,
    age: '3m',
    decisions: [DECISION],
    slashCommands: SLASH_COMMANDS,
    vamControlled: true,
    ...over,
  };
}

function Harness({
  session,
  onStopComposing,
  over,
}: {
  readonly session: Session;
  readonly onStopComposing: () => void;
  readonly over?: Partial<DetailPanelProps>;
}) {
  const [draft, setDraft] = useState('');
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  const entry: SessionEntry = { project, session };
  return (
    <DetailPanel
      entry={entry}
      decision={DECISION}
      draft={draft}
      onDraftChange={setDraft}
      onSubmit={() => {}}
      composing={true}
      onCompose={() => {}}
      onStopComposing={onStopComposing}
      active={false}
      actionIndex={0}
      width={408}
      resizeHandle={null}
      {...over}
    />
  );
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const box = () => q('textarea[aria-label="prompt to session"]') as unknown as HTMLTextAreaElement;
const note = () => q('[data-mode-cycle]')?.textContent ?? '';
const keys = () => q('[data-prompt-keys]')?.textContent ?? '';
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

/** A bridge into a pane, typed as the real member is so calls can be read. */
function bridge(result: PaneSendResult = 'sent') {
  const send = vi.fn(async (): Promise<PaneSendResult> => result);
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { terminal: { send } },
  });
  return send;
}

function draw(over: Partial<Session> = {}, props: Partial<DetailPanelProps> = {}) {
  const stopped = vi.fn();
  render(<Harness session={sessionWith(over)} onStopComposing={stopped} over={props} />);
  return stopped;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'api');
  setActivePromptSubmitKey(DEFAULT_PROMPT_SUBMIT_KEY);
});

describe('Escape interrupts the session the composer is aimed at', () => {
  it('presses Escape in the pane, over the bridge the keystroke strip already uses', async () => {
    const send = bridge();
    draw();
    await act(async () => {
      fireEvent.keyDown(box(), { key: 'Escape' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledWith('p1', { kind: 'escape' }, 's1');
    expect(note()).toContain('sent');
  });

  it('claims the keystroke, so the shell-level Escape never sees it', () => {
    // `Canvas`'s `cancel` case says in a comment that an Escape typed INSIDE
    // the composer never reaches it. That was true because the box blurred
    // itself; it has to stay true now that the box does something else.
    bridge();
    draw();
    expect(fireEvent.keyDown(box(), { key: 'Escape' })).toBe(false);
  });

  it('stays in the box: no blur, no stop, and the draft is untouched', () => {
    // Claude Code does not clear the draft on interrupt and does not move the
    // keyboard, and neither may this. An interrupt that also cost the operator
    // their half-typed prompt would be a worse trade than pressing nothing.
    bridge();
    const stopped = draw();
    box().focus();
    type('half a thought');
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(stopped).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(box());
    expect(box().value).toBe('half a thought');
  });

  it('reports a bridge that refused, rather than looking like a interrupt that landed', async () => {
    const send = bridge('refused');
    draw();
    await act(async () => {
      fireEvent.keyDown(box(), { key: 'Escape' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(q('[data-mode-refusal]')?.getAttribute('data-mode-refusal')).toBe('true');
    expect(note()).toContain('not sent');
  });

  it('reports a missing bridge instead of interrupting nothing in silence', () => {
    // No `window.api` at all — the browser build, or Electron before preload.
    draw();
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(note()).toContain('no keyboard into a session');
  });
});

describe('an Escape with nothing to interrupt says so', () => {
  it('refuses aloud on a session that is not running, and sends nothing', () => {
    const send = bridge();
    draw({ status: 'idle' });
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(send).not.toHaveBeenCalled();
    expect(note().toLowerCase()).toContain('nothing running');
  });

  it('says the same for every status that is not running', () => {
    const send = bridge();
    for (const status of ['idle', 'done', 'failed', 'waiting'] as SessionStatus[]) {
      cleanup();
      draw({ status });
      fireEvent.keyDown(box(), { key: 'Escape' });
      expect(note().toLowerCase(), status).toContain('nothing running');
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('does NOT confuse "nothing to interrupt" with "vam cannot reach this session"', () => {
    // TWO UNKNOWNS, TWO SENTENCES. A session vam did not start has no keyboard
    // into it at all — that is a fact about vam's reach, not about whether the
    // agent is busy, and the operator acts differently on each.
    const send = bridge();
    draw({ vamControlled: false });
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(send).not.toHaveBeenCalled();
    expect(note()).not.toContain('nothing running');
    expect(note().toLowerCase()).toContain('did not start');
  });

  it('says its own thing again for a source with no terminal at all', () => {
    const send = bridge();
    draw({}, { terminal: false });
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(send).not.toHaveBeenCalled();
    expect(note()).not.toContain('nothing running');
    expect(note()).not.toContain('did not start');
    expect(note().toLowerCase()).toContain('terminal');
  });
});

describe('the typeahead lists still answer Escape first', () => {
  it('closes the ! list and interrupts nothing', () => {
    const send = bridge();
    draw();
    type('!pr');
    expect(q('[data-bang-suggest]')).not.toBeNull();
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(q('[data-bang-suggest]')).toBeNull();
    expect(send).not.toHaveBeenCalled();
    // And the typed `!` is left exactly where it was.
    expect(box().value).toBe('!pr');
    // A SECOND Escape, with the list gone, is the interrupt.
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('closes the / list and interrupts nothing', () => {
    const send = bridge();
    draw();
    type('/comp');
    expect(q('[data-slash-suggest]')).not.toBeNull();
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(q('[data-slash-suggest]')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('Mod-[ is the way out of the box', () => {
  it('lets go of the keyboard and stops composing', () => {
    const stopped = draw();
    box().focus();
    expect(fireEvent.keyDown(box(), { key: '[', code: 'BracketLeft', metaKey: true })).toBe(false);
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(box());
  });

  it('answers Ctrl+[ as well — Mod folds the two, and Ctrl+[ IS vim’s Escape', () => {
    const stopped = draw();
    box().focus();
    fireEvent.keyDown(box(), { key: '[', code: 'BracketLeft', ctrlKey: true });
    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it('interrupts nothing on its way out', () => {
    // The two keys are separate acts. A way out that also pressed Escape in
    // the pane would make leaving the box cost the operator their agent's run.
    const send = bridge();
    draw();
    fireEvent.keyDown(box(), { key: '[', code: 'BracketLeft', metaKey: true });
    expect(send).not.toHaveBeenCalled();
  });

  it('leaves a bare [ to the draft', () => {
    const stopped = draw();
    expect(fireEvent.keyDown(box(), { key: '[', code: 'BracketLeft' })).toBe(true);
    expect(stopped).not.toHaveBeenCalled();
  });

  it('leaves Mod-Shift-[ alone, so stepping a tab does not drop the keyboard', () => {
    const stopped = draw();
    expect(
      fireEvent.keyDown(box(), {
        key: '{',
        code: 'BracketLeft',
        metaKey: true,
        shiftKey: true,
      }),
    ).toBe(true);
    expect(stopped).not.toHaveBeenCalled();
  });
});

/**
 * THE KEYS THE BOX CAN BE OPERATED WITH, ON ONE ROW.
 *
 * Escape used to be the only way out of the composer, and the only place that
 * was written down was a caption saying `Esc → sidebar`. Both halves of that
 * are now false, so the row says the three things that are true — and it must
 * follow the preference and the session, not read as a fixed string that
 * happens to be right today.
 */
describe('the composer names the keys that operate it', () => {
  it('names the send key, the interrupt and the way out, all three', () => {
    bridge();
    draw();
    expect(keys()).toContain('Enter');
    expect(keys()).toContain('Esc');
    expect(keys()).toContain('Mod-[');
  });

  it('follows the send-key preference rather than naming a fixed key', () => {
    draw();
    const shipped = keys();
    act(() => setActivePromptSubmitKey('shift-enter'));
    expect(keys()).toContain('Shift-Enter');
    expect(keys()).not.toBe(shipped);
  });

  it('does not offer an interrupt for a session vam cannot press a key in', () => {
    // A CONTROL THAT CANNOT ACT IS NOT DRAWN AS ONE, in its caption form: the
    // hint would be promising an interrupt that can only ever be refused. The
    // way out is still named, because that one always works.
    draw({ vamControlled: false });
    expect(keys()).not.toContain('Esc');
    expect(keys()).toContain('Mod-[');
  });

  it('retires the caption that promised Escape went to the sidebar', () => {
    // It no longer does, and a hint that survives the behaviour it described
    // is worse than no hint: the operator would press Escape expecting to
    // leave and interrupt their agent instead.
    draw();
    expect(q('[data-prompt-escape]')).toBeNull();
    expect(keys()).not.toContain('sidebar');
  });

  it('costs no width while the box is not open for typing', () => {
    draw({}, { composing: false });
    expect(q('[data-prompt-keys]')).toBeNull();
  });
});
