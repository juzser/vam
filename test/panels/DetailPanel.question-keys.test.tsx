// @vitest-environment happy-dom

/**
 * The card follows the operator's binding table, and the sheet stops lying.
 *
 * `keysheet.ts` generates "move ⟨direction⟩ — the options of an open question,
 * when one is asked" from the live table. The card tested `event.key` against
 * `h`/`j`/`k`/`l`/`c`, so rebinding move to `w`/`s` left the sheet promising
 * `s` walks the options while `s` did nothing and `j` still worked. Every case
 * below drives the CARD and reads the DOM; none of them asks the resolver what
 * it thinks, which is the tautology this class of test usually becomes.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentQuestion, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { NO_BINDINGS, setActiveBindings } from '../../src/renderer/keyboard/chords.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const question = (index: number, header: string, options: readonly string[]): AgentQuestion => ({
  id: `toolu_1:${index}`,
  header,
  question: `Which ${header.toLowerCase()}?`,
  multiSelect: false,
  options: options.map((label) => ({ label, description: null })),
  answer: null,
});

const SET = [question(0, 'Colour', ['Crimson', 'Cobalt']), question(1, 'Fruit', ['Apple', 'Pear'])];

const SESSION: Session = {
  id: 's1',
  title: 'Colour study',
  icon: null,
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '3m',
  questions: SET,
  decisions: [{ id: 'd1', label: 'plan', input: 'ask me', output: 'asked', commands: [] }],
};

function draw(over: Partial<DetailPanelProps> = {}) {
  const project: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
  const entry: SessionEntry = { project, session: SESSION };
  render(
    <DetailPanel
      entry={entry}
      decision={SESSION.decisions[0] ?? null}
      draft=""
      onDraftChange={() => {}}
      onSubmit={() => {}}
      composing={false}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={false}
      actionIndex={0}
      width={408}
      resizeHandle={null}
      {...over}
    />,
  );
}

const all = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)];
const options = () => all('[data-question-option]');
const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]') as HTMLElement;
const step = () => document.querySelector<HTMLElement>('[data-question-step][data-current]');

afterEach(() => {
  setActiveBindings(NO_BINDINGS);
  cleanup();
});

describe('the question card under a rebound grammar', () => {
  it('walks the options with the shipped keys when nothing is rebound', () => {
    draw();
    options()[0]?.focus();
    fireEvent.keyDown(listbox(), { key: 'j' });
    expect(document.activeElement).toBe(options()[1]);
  });

  it('walks the options with the key the operator moved the motion to', () => {
    setActiveBindings({ 'move:down': ['s'], 'move:up': ['w'] });
    draw();
    options()[0]?.focus();
    fireEvent.keyDown(listbox(), { key: 's' });
    expect(document.activeElement).toBe(options()[1]);
    fireEvent.keyDown(listbox(), { key: 'w' });
    expect(document.activeElement).toBe(options()[0]);
  });

  it('stops answering to the key the motion was moved OFF', () => {
    setActiveBindings({ 'move:down': ['s'] });
    draw();
    options()[0]?.focus();
    fireEvent.keyDown(listbox(), { key: 'j' });
    expect(document.activeElement).toBe(options()[0]);
  });

  it('walks the STEPS with the rebound horizontal pair', () => {
    setActiveBindings({ 'move:right': ['.'], 'move:left': [','] });
    draw();
    options()[0]?.focus();
    expect(step()?.textContent).toContain('Colour');
    fireEvent.keyDown(listbox(), { key: '.' });
    expect(step()?.textContent).toContain('Fruit');
    fireEvent.keyDown(listbox(), { key: ',' });
    expect(step()?.textContent).toContain('Colour');
  });

  it('keeps the arrows whatever the operator did to the letters', () => {
    setActiveBindings({ 'move:down': [], 'move:right': [] });
    draw();
    options()[0]?.focus();
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options()[1]);
    fireEvent.keyDown(listbox(), { key: 'ArrowRight' });
    expect(step()?.textContent).toContain('Fruit');
  });

  it('prints no `c` hint once a motion has taken that key, and does not chat', () => {
    setActiveBindings({ 'move:down': ['c'] });
    draw();
    const chat = document.querySelector<HTMLElement>('[data-question-chat]');
    expect(chat).not.toBeNull();
    expect(chat?.querySelector('[data-question-chat-key]')).toBeNull();
    options()[0]?.focus();
    fireEvent.keyDown(listbox(), { key: 'c' });
    // The motion won: the keyboard moved and no composer was opened.
    expect(document.activeElement).toBe(options()[1]);
  });
});

/**
 * AUDIT F2, DRIVEN THROUGH THE CARD.
 *
 * `test/keyboard/question-keys.test.ts` holds the resolution itself; these
 * press keys at the real widget and read the real DOM, because the leak was
 * never in a resolver — it was that the widget did not use one.
 */
describe('the card resolves in the grammar’s vocabulary, and in its order', () => {
  const marked = () => options().filter((el) => el.getAttribute('data-picked') === 'true');

  it('gives a rebound motion a digit it used to lose to `mark`', () => {
    setActiveBindings({ 'move:down': ['1'] });
    draw();
    options()[0]?.focus();
    fireEvent.keyDown(listbox(), { key: '1' });
    // WAS: `1` marked option one — the built-in digits were resolved before
    // the operator's table — so a rebind the settings editor had accepted did
    // nothing at all, under a sheet still promising the new key.
    expect(document.activeElement).toBe(options()[1]);
    expect(marked()).toHaveLength(0);
  });

  it('still marks by the digits the operator did NOT spend', () => {
    setActiveBindings({ 'move:down': ['1'] });
    draw();
    options()[0]?.focus();
    fireEvent.keyDown(listbox(), { key: '2' });
    expect(marked()).toHaveLength(1);
    expect(marked()[0]).toBe(options()[1]);
  });

  it('answers a motion the operator bound to a CHORD', () => {
    setActiveBindings({ 'move:down': ['Mod-j'] });
    draw();
    options()[0]?.focus();
    // WAS: rejected by a blanket "anything modified is not ours" guard, and
    // unmatchable anyway because the card compared raw `event.key` (`j`)
    // against the stored spelling (`Mod-j`). It fell through to Canvas, which
    // walked the pane's ACTION index instead of these options.
    fireEvent.keyDown(listbox(), { key: 'j', metaKey: true });
    expect(document.activeElement).toBe(options()[1]);
  });

  it('leaves an unbound chord to the window listener, unmarked and unwalked', () => {
    draw();
    options()[0]?.focus();
    fireEvent.keyDown(listbox(), { key: '2', metaKey: true, code: 'Digit2' });
    fireEvent.keyDown(listbox(), { key: 'c', metaKey: true });
    expect(document.activeElement).toBe(options()[0]);
    expect(marked()).toHaveLength(0);
  });

  it('walks the STEPS from the step strip with the rebound key, not with `l`', () => {
    // The strip carried its own hardcoded `h`/`l`/arrows — a second copy of
    // the vocabulary, one element over from the list that had already been
    // fixed. A step whose question is answered draws no options, so the strip
    // is the only thing holding the keyboard on it.
    setActiveBindings({ 'move:right': ['.'], 'move:left': [','] });
    draw();
    const strip = document.querySelector<HTMLElement>('[data-question-steps]') as HTMLElement;
    expect(step()?.textContent).toContain('Colour');
    fireEvent.keyDown(strip, { key: 'l' });
    expect(step()?.textContent).toContain('Colour');
    fireEvent.keyDown(strip, { key: '.' });
    expect(step()?.textContent).toContain('Fruit');
    fireEvent.keyDown(strip, { key: ',' });
    expect(step()?.textContent).toContain('Colour');
  });
});
