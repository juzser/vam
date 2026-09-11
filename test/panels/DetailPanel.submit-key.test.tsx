// @vitest-environment happy-dom

/**
 * WHICH KEY SENDS, AS THE BOX ACTUALLY BEHAVES.
 *
 * Operator request: "in the prompt input right now, Enter submits and
 * Shift+Enter makes a newline. Add a settings toggle to swap between these two
 * behaviours." `prefs/submit-key.ts` holds the word and the rule; this file is
 * about what a real keystroke in a real textarea does under each of the two,
 * because a predicate that says "this sends" is worth nothing if the box sends
 * off a second conditional of its own.
 *
 * THE NEWLINE IS ASSERTED AS A NEWLINE, never as `defaultPrevented` alone.
 * `preventDefault()` not being called is the MECHANISM by which the box takes
 * a newline; the newline landing in the draft is the OUTCOME the operator
 * asked for, and only `userEvent` produces it -- `fireEvent.keyDown` inserts no
 * text in any environment, so a test built on it could not tell a working
 * newline from a swallowed one.
 *
 * WHAT THE MODE DELIBERATELY DOES NOT REACH is the last block: the `!` and `/`
 * typeahead lists keep Enter-accepts-the-suggestion in BOTH modes. That is a
 * decision, not an omission, and it is guarded here so a later edit that
 * "finishes the job" by routing those two branches through the pref goes red.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import {
  DEFAULT_PROMPT_SUBMIT_KEY,
  type PromptSubmitKey,
  setActivePromptSubmitKey,
} from '../../src/renderer/prefs/submit-key.js';

const COMMANDS = [
  { id: 'c1', label: 'push the branch', command: 'git push -u origin work' },
  { id: 'c2', label: 'open the PR', command: 'gh pr create --fill' },
];

const DECISION: Decision = {
  id: 'd9',
  label: 'sign-off',
  input: 'ship it',
  output: 'here is what to run',
  commands: COMMANDS,
};

const SLASH_COMMANDS = [
  { id: 'compact', name: 'compact', description: 'summarise the conversation so far' },
  { id: 'notify', name: 'notify', description: 'toggle a push notification' },
];

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
  decisions: [DECISION],
  slashCommands: SLASH_COMMANDS,
};

/**
 * The draft is a PROP owned by the canvas, so a test that wants to see what a
 * keystroke put in the box has to hold it the way the canvas does.
 */
function Harness({
  onSubmit,
  over,
}: {
  readonly onSubmit: () => void;
  readonly over?: Partial<DetailPanelProps>;
}) {
  const [draft, setDraft] = useState('');
  const project: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
  const entry: SessionEntry = { project, session: SESSION };
  return (
    <DetailPanel
      entry={entry}
      decision={DECISION}
      draft={draft}
      onDraftChange={setDraft}
      onSubmit={onSubmit}
      composing={true}
      onCompose={() => {}}
      onStopComposing={() => {}}
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
const hint = () => q('[data-prompt-send-key]');

/** Mount the composer under `mode`, and hand back the list of sends. */
function composer(mode: PromptSubmitKey, over?: Partial<DetailPanelProps>): string[] {
  setActivePromptSubmitKey(mode);
  const sent: string[] = [];
  render(<Harness onSubmit={() => sent.push('sent')} over={over} />);
  return sent;
}

/** Type `text` into the prompt box, caret at its end — the `!`/`/` idiom. */
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

afterEach(() => {
  cleanup();
  setActivePromptSubmitKey(DEFAULT_PROMPT_SUBMIT_KEY);
});

describe('the shipped mode: Enter sends, Shift+Enter takes a newline', () => {
  it('sends on a bare Enter, and claims the keystroke', () => {
    const sent = composer('enter');
    type('ship it');
    // `false` is "the event was cancelled" — `fireEvent` builds a CANCELABLE
    // event, which a hand-rolled `new KeyboardEvent` does not, and without
    // that this assertion would be inert whatever the handler did.
    expect(fireEvent.keyDown(box(), { key: 'Enter' })).toBe(false);
    expect(sent).toEqual(['sent']);
  });

  it('leaves Shift+Enter to the textarea', () => {
    const sent = composer('enter');
    type('ship it');
    expect(fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })).toBe(true);
    expect(sent).toEqual([]);
  });

  it('really puts a newline in the draft on Shift+Enter, and none on Enter', async () => {
    const user = userEvent.setup();
    const sent = composer('enter');
    await user.click(box());
    await user.keyboard('one{Shift>}{Enter}{/Shift}two');
    expect(box().value).toBe('one\ntwo');
    expect(sent).toEqual([]);
    // And the send key inserts nothing: a key that both sent and typed would
    // leave the next draft carrying the last one's stray newline.
    await user.keyboard('{Enter}');
    expect(box().value).toBe('one\ntwo');
    expect(sent).toEqual(['sent']);
  });
});

describe('the swapped mode: Shift+Enter sends, Enter takes a newline', () => {
  it('sends on Shift+Enter, and claims the keystroke', () => {
    const sent = composer('shift-enter');
    type('ship it');
    expect(fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })).toBe(false);
    expect(sent).toEqual(['sent']);
  });

  it('leaves a bare Enter to the textarea rather than swallowing it', () => {
    // THE HALF THAT IS EASY TO GET WRONG. "Enter no longer sends" is one line;
    // "Enter still types a newline" needs the handler to let the event go. A
    // mode that merely stopped sending would give the operator a box with no
    // send and no newline.
    const sent = composer('shift-enter');
    type('ship it');
    expect(fireEvent.keyDown(box(), { key: 'Enter' })).toBe(true);
    expect(sent).toEqual([]);
  });

  it('really puts a newline in the draft on Enter, and none on Shift+Enter', async () => {
    const user = userEvent.setup();
    const sent = composer('shift-enter');
    await user.click(box());
    await user.keyboard('one{Enter}two');
    expect(box().value).toBe('one\ntwo');
    expect(sent).toEqual([]);
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(box().value).toBe('one\ntwo');
    expect(sent).toEqual(['sent']);
  });
});

/**
 * ACCEPTING A COMPLETION IS NOT SENDING, so the two typeahead lists keep Enter
 * in both modes. Three reasons, and they all point the same way: Enter-accepts
 * is the universal typeahead idiom; the list is a completion rather than a
 * delivery, so the pref — which is about WHEN A PROMPT LEAVES — has no claim
 * on it; and in `shift-enter` mode a list that followed the pref would have no
 * accept key at all, since Shift+Enter would then be the send.
 */
describe('the typeahead lists keep Enter in both modes', () => {
  it('accepts the ! suggestion on a bare Enter even where Enter does not send', () => {
    const sent = composer('shift-enter');
    type('!pr');
    expect(fireEvent.keyDown(box(), { key: 'Enter' })).toBe(false);
    expect(box().value).toBe('!gh pr create --fill');
    expect(sent).toEqual([]);
  });

  it('accepts the / suggestion on a bare Enter even where Enter does not send', () => {
    const sent = composer('shift-enter');
    type('/comp');
    expect(fireEvent.keyDown(box(), { key: 'Enter' })).toBe(false);
    expect(box().value).toBe('/compact');
    expect(sent).toEqual([]);
  });

  it('still sends on the operator’s own send key once the list is closed', () => {
    const sent = composer('shift-enter');
    type('!pr');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(box().value).toBe('!gh pr create --fill');
    expect(sent).toEqual([]);
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
    expect(sent).toEqual(['sent']);
  });

  it('accepts on Enter in the shipped mode too — the idiom did not move', () => {
    const sent = composer('enter');
    type('!pr');
    expect(fireEvent.keyDown(box(), { key: 'Enter' })).toBe(false);
    expect(box().value).toBe('!gh pr create --fill');
    expect(sent).toEqual([]);
  });
});

/**
 * THE BOX SAYS WHICH KEY SENDS.
 *
 * Before this, `grep -rn "Enter to send\|Shift+Enter" src/` found nothing but a
 * source comment: the composer knew which key sent and showed silence. Adding a
 * swap without a caption would make that worse than silence — the operator
 * would have two possible behaviours and no way to see which one is live.
 *
 * THE ASSERTION IS THAT THE TEXT CHANGES, not that it reads a particular
 * sentence. A test that only checked the default wording would pass with the
 * whole feature reverted.
 */
describe('the composer names its send key, and follows the pref', () => {
  it('changes the visible caption when the pref changes', () => {
    composer('enter');
    const shipped = hint()?.textContent ?? '';
    expect(shipped).toContain('Enter');
    expect(shipped).not.toContain('Shift');

    act(() => setActivePromptSubmitKey('shift-enter'));
    const swapped = hint()?.textContent ?? '';
    expect(swapped).toContain('Shift-Enter');
    // The load-bearing line: the caption is a report about the pref, not a
    // fixed string that happens to be true of the default.
    expect(swapped).not.toBe(shipped);
  });

  it('carries the mode as a fact a guard can read, beside the words', () => {
    composer('shift-enter');
    expect(hint()?.getAttribute('data-prompt-send-key')).toBe('shift-enter');
    act(() => setActivePromptSubmitKey('enter'));
    expect(hint()?.getAttribute('data-prompt-send-key')).toBe('enter');
  });

  it('says record, not send, where the source cannot deliver', () => {
    // The button's word is already per-source (`composerClaim`). A caption
    // promising "send" over a source that only appends to a log would be the
    // same lie one line lower.
    composer('enter', { delivers: false });
    expect(hint(), 'no caption at all — the box says nothing about its key').not.toBeNull();
    expect(hint()?.textContent).toContain('record');
    expect(hint()?.textContent).not.toContain('send');
    cleanup();
    composer('enter', { delivers: true });
    expect(hint()?.textContent).toContain('send');
  });

  it('costs no width while the box is not open for typing', () => {
    // Same gate as the `Esc → sidebar` hint beside it: the key that sends is
    // the thing you need to know while you are typing, and nothing the rest of
    // the time.
    composer('enter', { composing: false });
    expect(hint()).toBeNull();
  });
});
