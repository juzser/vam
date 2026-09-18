// @vitest-environment happy-dom

/**
 * The model control, in its three states -- and what the enabled one ASKS FOR.
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
 *    of the CLI's own five aliases AND NOTHING ELSE; a choice goes down ONE
 *    bridge call -- `terminal.switchModel` -- with the SAME in-flight guard and
 *    the SAME refusal captions as the mode chip's Shift-Tab. It never writes a
 *    `model:` line into the draft: on this source the draft is typed into the
 *    CLI's prompt, where that line is words the agent reads and switches
 *    nothing.
 *
 *    THE FIVE USED TO BE FIVE PLUS A FREE-TEXT ROW, which took a full model id
 *    -- a choice the CLI's own menu has no row for, so it fell back to `/model
 *    <id>` + Return, the form that ALSO rewrites `~/.claude/settings.json`,
 *    and the caption disclosed it. Offered that fallback or an outright
 *    refusal, the operator chose refusal. A row whose every outcome would now
 *    be a refusal is a control that can only say no, so it is gone -- and the
 *    tests that drove it are below, holding it ABSENT, because this file is
 *    the specification for this control and an absence nobody asserts is an
 *    absence that grows its row back.
 *  - DISABLED (delivers, but no pane vam owns): the same button, disabled and
 *    dimmed, under a note that says why and what to do.
 *
 * THE BRIDGE MEMBER CHANGED, AND THAT IS THE POINT OF THE CHANGE THIS FILE
 * RECORDS. It used to be `terminal.send`, carrying `/model <alias>` + Enter --
 * the form the CLI answers with "and saved as your default for new sessions",
 * so every pick rewrote `~/.claude/settings.json`. Main drives the CLI's own
 * menu now and presses `s` (`main/terminal/model-switch.ts`). So this file
 * asserts the ASK and the CAPTION; the keys are asserted against a fake tmux
 * in `test/main/terminal/model-switch.test.ts`, on real captured screens.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import type { ModelSwitchResult, SessionModel } from '../../src/shared/terminal.js';

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

type Asked = { readonly projectId: unknown; readonly choice: string; readonly rowId: unknown };

/**
 * A bridge that records every switch it is asked for, answering with `answer`.
 *
 * `switchModel` AND NOT `send`, and that swap is the whole shape of this
 * change: the picker used to build `/model <alias>` strokes and type them over
 * the keystroke channel, which is the form the CLI ALSO saves as the operator's
 * default. Main owns the route end to end now
 * (`main/terminal/model-switch.ts`). So what is asserted here is the ASK -- the
 * project, the choice and the row -- and what the panel does with each answer;
 * what reaches tmux is asserted against a fake one in
 * `test/main/terminal/model-switch.test.ts`.
 */
function withBridge(
  answer: (choice: string) => Promise<ModelSwitchResult> = async () => ({
    kind: 'sent',
    scope: 'session',
  }),
) {
  const asked: Asked[] = [];
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      terminal: {
        switchModel: (projectId: unknown, choice: string, rowId: unknown) => {
          asked.push({ projectId, choice, rowId });
          return answer(choice);
        },
      },
    },
  });
  return asked;
}

/** Just the choices, in order -- what the operator picked, as main saw it. */
const chosen = (asked: readonly Asked[]) => asked.map((one) => one.choice);

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

  it('opens Default · Sonnet · Fable · Opus · Haiku, the provider picker’s pattern', () => {
    draw({ delivers: true, terminal: true });
    expect(q('[data-model-picker-menu]')).toBeNull();
    act(() => picker()?.click());
    // The five are a listbox, and now the popover is nothing BUT that listbox:
    // the `<input>` the five used to sit above is gone with the route it fed.
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
    expect(
      all('[data-model-option]').map((el) =>
        el.querySelector('[data-model-name]')?.textContent?.trim(),
      ),
    ).toEqual(['Default', 'Sonnet', 'Fable', 'Opus', 'Haiku']);
    for (const option of all('[data-model-option]')) {
      expect(option.getAttribute('role')).toBe('option');
    }
    expect(q('[data-model-id]')).toBeNull();
  });

  it('prints each alias’s version beside its name, in the CLI’s own values', () => {
    // Operator: "in the model picker, add the version on the right as well".
    // The values are `MODEL_CHOICES`' own, re-measured on Claude Code 2.1.276
    // (see `model-command.ts`); what this holds is that they REACH the row --
    // a table nothing renders is a table nobody reads.
    //
    // THE NAME IS FIRST IN THE ROW AND THE VERSION IS LAST, which is all a
    // unit environment can honestly say about "on the right": no stylesheet is
    // loaded here, so `ml-auto` resolves to nothing and every box measures 0.
    // That the version really PAINTS to the right of the name is measured on
    // the shipped bundle in `e2e/model-picker-shots.mjs`, against real
    // rectangles.
    //
    // BETWEEN THEM GOES THE TICK, on the row whose model the session is
    // running and on no other -- so an unmarked picker is exactly the two
    // boxes it always was. That marking a row does not move the version
    // column is a rectangle question, and the browser guard answers it.
    draw({ delivers: true, terminal: true });
    act(() => picker()?.click());
    expect(
      all('[data-model-option]').map((el) =>
        el.querySelector('[data-model-version]')?.textContent?.trim(),
      ),
    ).toEqual(['Sonnet 5', '5', '5.1', '5', '4.5']);
    for (const option of all('[data-model-option]')) {
      const kids = [...option.children];
      expect(kids[0]?.getAttribute('data-model-name')).not.toBeNull();
      expect(kids.at(-1)?.getAttribute('data-model-version')).not.toBeNull();
      // THREE, AND THE MIDDLE ONE IS EMPTY. The tick's slot is always drawn so
      // that a mark coming and going cannot move the popover -- which it did,
      // measured at 23px, once the free-text row stopped setting the width
      // (`e2e/model-picker-shots.mjs` holds the outcome). Nothing here reads a
      // model, so the slot is present and the glyph inside it is not.
      expect(kids).toHaveLength(3);
      expect(kids[1]?.getAttribute('data-model-tick-slot')).not.toBeNull();
      expect(kids[1]?.children).toHaveLength(0);
      expect(option.querySelector('[data-model-current]')).toBeNull();
    }
  });

  it('asks main to switch THIS session, naming the alias, and closes', async () => {
    const asked = withBridge();
    draw({ delivers: true, terminal: true });
    await choose('opus');
    // THE ALIAS, NOT A LINE. Main decides what is typed: an alias is walked
    // onto the CLI's own menu, which is the whole point of the channel.
    expect(asked).toEqual([{ projectId: 'p1', choice: 'opus', rowId: 's1' }]);
    expect(q('[data-model-picker-menu]')).toBeNull();
  });

  it('never writes a `model:` line into the draft on this source', async () => {
    withBridge();
    const seen: string[] = [];
    draw({ delivers: true, terminal: true, draft: 'ship it', onDraftChange: (n) => seen.push(n) });
    await choose('sonnet');
    expect(seen).toEqual([]);
  });

  it('says what vam can honestly claim: this session only, and the session answers there', async () => {
    withBridge();
    draw({ delivers: true, terminal: true });
    await choose('opus');
    const note = q<HTMLElement>('[data-mode-cycle]');
    expect(note?.getAttribute('data-mode-cycle-state')).toBe('sent');
    expect(note?.textContent).toContain('opus');
    expect(note?.textContent).toContain('Sprint board reorder');
    // THE SCOPE IS THE CLAIM THIS CONTROL EXISTS TO MAKE HONEST.
    expect(note?.textContent).toContain('this session only');
    expect(note?.textContent).toContain('the session answers there');
    // And it must NOT say the thing the old route made true.
    expect(note?.textContent ?? '').not.toMatch(/default for new sessions/i);
  });

  /**
   * THE ROW THAT TOOK A FULL MODEL ID IS GONE, and this used to be the test
   * that typed one into it and watched it reach main whole.
   *
   * Its outcome would now be a refusal every single time -- main answers
   * `not-in-menu` for anything that is not one of the five (see
   * `main/terminal/model-switch.ts`) -- and a control whose only possible
   * answer is no is worse than no control: it invites the ask, spends the
   * operator's attention and gives nothing back. So what is held here is the
   * ABSENCE, which is the part a later hand could undo without noticing.
   */
  it('has no free-text row to take a full model id from, anywhere in the popover', async () => {
    const asked = withBridge();
    draw({ delivers: true, terminal: true });
    act(() => picker()?.click());
    const popover = q('[data-model-picker-menu]');
    expect(popover).not.toBeNull();
    expect(q('[data-model-id]')).toBeNull();
    // Not just that ONE attribute is gone: no text box of any kind is in
    // there, so a row renamed rather than removed does not slip through.
    expect(popover?.querySelectorAll('input, textarea, [contenteditable]')).toHaveLength(0);
    expect(asked).toEqual([]);
  });

  /**
   * AND WHAT MAIN SAYS WHEN ONE REACHES IT ANYWAY, because main validates what
   * the renderer sends rather than trusting the renderer's list -- so this arm
   * is reachable from an older renderer, a replayed call, or the next hand.
   *
   * THE CAPTION NAMES THE REMEDY AND NOT ONLY THE REFUSAL. Typing `/model
   * <id>` at the REPL is still the operator's own to do, knowing it also
   * becomes their default for new sessions; what vam will not do is make that
   * write on their behalf. A refusal that stopped at "no" would leave someone
   * who really wants a full model id with nowhere to go.
   */
  it('names the remedy when main refuses a choice with no row on the CLI’s menu', async () => {
    withBridge(async () => ({ kind: 'not-in-menu', choice: 'claude-opus-5-20260501' }));
    draw({ delivers: true, terminal: true });
    await choose('opus');
    const note = q<HTMLElement>('[data-mode-cycle]');
    expect(note?.getAttribute('data-mode-cycle-state')).toBe('refused');
    expect(note?.getAttribute('data-mode-refusal')).toBe('true');
    // The choice in its own words, the way out, and where the way out is.
    expect(note?.textContent).toContain('claude-opus-5-20260501');
    expect(note?.textContent).toContain('/model claude-opus-5-20260501');
    expect(note?.textContent).toMatch(/Terminal tab/);
    // It may not read as a success, and it may not promise what vam refuses.
    expect(note?.textContent ?? '').not.toContain('this session only');
  });

  /**
   * AND THE REMEDY HAS TO BE WHERE THE EYE IS, which the first draft of that
   * caption was not.
   *
   * The caption is drawn in a `truncate whitespace-nowrap` line, so about
   * forty characters of it are ever on screen at a composer's width. The
   * sentence shipped at 220 characters with "type /model <id> in the Terminal
   * tab" starting at character 163 -- every word of the remedy past the clip,
   * on the one caption whose entire purpose is to say what to do instead.
   *
   * TWO RULES, BECAUSE ONE OF THEM ALONE WOULD ROT. Front-loading is about
   * this sentence and a later hand may rewrite it; the `title` is about the
   * ELEMENT and holds for every caption this row will ever draw -- a question
   * quoted back, a model id, whatever comes next. It is the model button's own
   * rule one control to the left: clip yourself, and stay one hover away.
   */
  it('puts the verb of the remedy inside the first clip, and the rest one hover away', async () => {
    withBridge(async () => ({ kind: 'not-in-menu', choice: 'claude-opus-5-20260501' }));
    draw({ delivers: true, terminal: true });
    await choose('opus');
    const note = q<HTMLElement>('[data-mode-cycle]');
    const text = note?.textContent ?? '';
    // What the operator DOES is in the part that survives truncation.
    expect(text.slice(0, 45)).toContain('type /model');
    // And nothing is lost for good: the whole sentence is on the element.
    expect(note?.getAttribute('title')).toBe(text);
    expect(text.length).toBeGreaterThan(45);
  });

  it('holds exactly the five aliases in the listbox, and no text box beside them', async () => {
    // WHAT THIS REPLACES: a free-text id with a space in it, refused before the
    // bridge was touched. There is no field to put a space into now, so the
    // rule it stood for is main's alone (`isModelChoice`) and what is left
    // here is the shape of the offer -- five aliases, each a button, each one
    // of `MODEL_CHOICES`, and nothing that can carry an arbitrary string.
    const asked = withBridge();
    draw({ delivers: true, terminal: true });
    act(() => picker()?.click());
    const popover = q('[data-model-picker-menu]');
    expect(all('[data-model-picker-menu] [data-model-option]').map((el) => el.tagName)).toEqual(
      Array(5).fill('BUTTON'),
    );
    // Every interactive thing in the popover IS one of the five.
    expect(popover?.querySelectorAll('button, input, textarea, select, a')).toHaveLength(5);
    expect(asked).toEqual([]);
  });

  it('shares the mode chip’s refusal caption when tmux would not deliver', async () => {
    withBridge(async () => ({ kind: 'refused' }));
    draw({ delivers: true, terminal: true });
    await choose('haiku');
    const note = q<HTMLElement>('[data-mode-cycle]');
    expect(note?.getAttribute('data-mode-cycle-state')).toBe('refused');
    expect(note?.getAttribute('data-mode-refusal')).toBe('true');
    expect(note?.textContent).toContain('tmux');
  });

  /**
   * EVERY REFUSAL GETS ITS OWN SENTENCE, because each sends a person somewhere
   * different: a question to answer, a busy REPL that may have EATEN the
   * `/model` line as a prompt, a menu that stopped taking keys, a row that is
   * not there, and a screen vam could not read. One shared "not sent" would
   * make four of the five unactionable.
   */
  it('words each of main’s refusals as its own thing', async () => {
    const cases: readonly { result: ModelSwitchResult; says: RegExp }[] = [
      { result: { kind: 'no-menu' }, says: /may have reached the agent as a prompt/ },
      { result: { kind: 'not-live' }, says: /did not answer vam’s arrow/ },
      { result: { kind: 'unmatched', label: 'Opus' }, says: /Opus is not a row/ },
      { result: { kind: 'unreadable' }, says: /could not read the screen/ },
      { result: { kind: 'unaimed' }, says: /could not name one session/ },
      { result: { kind: 'mispaired' }, says: /pane vam cannot use/ },
      { result: { kind: 'unavailable' }, says: /could not ask tmux/ },
    ];
    for (const { result, says } of cases) {
      withBridge(async () => result);
      draw({ delivers: true, terminal: true });
      await choose('opus');
      const note = q<HTMLElement>('[data-mode-cycle]');
      expect(note?.getAttribute('data-mode-cycle-state'), result.kind).toBe('refused');
      expect(note?.textContent ?? '', result.kind).toMatch(says);
      cleanup();
      Reflect.deleteProperty(window, 'api');
    }
  });

  it('shares the in-flight guard: a second choice while one is out sends nothing', async () => {
    let land: (r: ModelSwitchResult) => void = () => {};
    const asked = withBridge(
      () =>
        new Promise<ModelSwitchResult>((resolve) => {
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
    expect(chosen(asked)).toEqual(['opus']);
    await act(async () => {
      land({ kind: 'sent' });
      await Promise.resolve();
    });
    await settle();
    expect(chosen(asked)).toEqual(['opus']);
    expect(q<HTMLElement>('[data-mode-cycle]')?.getAttribute('data-mode-cycle-state')).toBe('sent');
  });

  it('reports a build with no bridge rather than pretending', async () => {
    draw({ delivers: true, terminal: true });
    await choose('opus');
    const note = q<HTMLElement>('[data-mode-cycle]');
    expect(note?.getAttribute('data-mode-cycle-state')).toBe('refused');
    expect(note?.textContent).toContain('no keyboard');
  });

  it('says in its note that the switch is this session’s, and promises no default rewrite', () => {
    draw({ delivers: true, terminal: true });
    const note = picker()?.getAttribute('data-note') ?? '';
    expect(note).toContain('/model');
    expect(note).toMatch(/this session only/);
    // THE CLAUSE THAT HAD TO GO. The note used to end "...a full id also
    // becomes the default for new sessions", which was true of the one route
    // that no longer exists. A note still saying it would send the operator
    // looking for a row that is not there, and would describe a write to
    // `~/.claude/settings.json` that vam now refuses to make.
    expect(note).not.toMatch(/default for new sessions/);
    expect(note).not.toMatch(/full id|full model id/i);
  });
});

describe('a session vam cannot type into gets the same button, disabled', () => {
  const DISABLED_NOTE =
    'vam owns no terminal here — open the session in a vam terminal to send /model';

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

/**
 * WHAT THE BUTTON SAYS AND WHICH ROW IS MARKED -- the session's own model,
 * read back off the pane rather than remembered.
 *
 * The operator's ask, translated: "the model switcher button's label also
 * needs to show the model that is currently selected, and there should be a
 * tick icon on the currently selected model in the popover."
 *
 * Both halves are one fact -- `SessionModel`, off the CLI's status line
 * (`main/terminal/model.ts`) -- and the rule that turns it into ticks is
 * `runningModelRows`, asserted on its own in `test/panels/model-command.test.ts`.
 * What is held HERE is the wiring: that the panel asks for it, for the right
 * row, only where a model could be read at all; that what comes back reaches
 * the label and the row; and that nothing invented reaches either. Whether the
 * tick and the label really PAINT -- and that the tick does not push the
 * version column off the popover -- is measured on the shipped bundle in
 * `e2e/model-picker-shots.mjs`, against real rectangles.
 */
describe('the button names the model the session is running', () => {
  /** A model bridge that records what it was asked, answering `answer`. */
  const reader = (answer: SessionModel | (() => SessionModel)) => {
    const asked: unknown[][] = [];
    return {
      asked,
      model: async (projectId: string, rowId?: string) => {
        asked.push([projectId, rowId]);
        return typeof answer === 'function' ? answer() : answer;
      },
    };
  };

  const label = () => picker()?.textContent?.trim() ?? null;
  const ticked = () =>
    all('[data-model-option]')
      .filter((el) => el.querySelector('[data-model-current]') !== null)
      .map((el) => el.getAttribute('data-model-option'));

  it('reads the model of THIS row, in THIS project', async () => {
    const { asked, model } = reader({ kind: 'model', name: 'Opus 5' });
    draw({ delivers: true, terminal: true, model });
    await settle();
    expect(asked).toEqual([['p1', 's1']]);
  });

  it('wears the name it read, where the word "model" used to be', async () => {
    const { model } = reader({ kind: 'model', name: 'Opus 5' });
    draw({ delivers: true, terminal: true, model });
    await settle();
    expect(label()).toBe('Opus 5');
    // And a screen reader is told what the eye is told, which is this file's
    // own rule for every icon-and-label control in the row.
    expect(picker()?.getAttribute('aria-label')).toContain('Opus 5');
  });

  it('names it in the tooltip too, where a clipped label can be read back', async () => {
    // The label gives way at a narrow pane rather than bursting the row
    // (measured in `e2e/model-picker-shots.mjs`), so the note is the eye's way
    // back to the whole name -- the screen reader already had it above. It
    // says "running" and not "chosen": vam read the pane, it did not pick.
    const { model } = reader({ kind: 'model', name: 'Sonnet 4.5' });
    draw({ delivers: true, terminal: true, model });
    await settle();
    expect(picker()?.getAttribute('data-note')).toContain('running Sonnet 4.5');
    // AND THE NOTE'S OWN SENTENCE SURVIVES THE PREFIX. It used to be the
    // CLI's side effect that was checked here; that clause is false now (vam
    // refuses the route that had it), and what must not be lost when the
    // running name is prepended is the scope claim that replaced it.
    expect(picker()?.getAttribute('data-note')).toContain('this session only');
  });

  it('says nothing about a model in the tooltip when it has not read one', async () => {
    const { model } = reader({ kind: 'unknown' });
    draw({ delivers: true, terminal: true, model });
    await settle();
    expect(picker()?.getAttribute('data-note') ?? '').not.toContain('running');
  });

  it('ticks the row whose model that is, and no other', async () => {
    const { model } = reader({ kind: 'model', name: 'Opus 5' });
    draw({ delivers: true, terminal: true, model });
    await settle();
    act(() => picker()?.click());
    expect(ticked()).toEqual(['opus']);
    // The mark is in the ROW's accessible name too, not only in a glyph.
    const opus = q<HTMLElement>('[data-model-option="opus"]');
    expect(opus?.textContent).toMatch(/running/i);
    expect(q<HTMLElement>('[data-model-option="haiku"]')?.textContent ?? '').not.toMatch(
      /running/i,
    );
  });

  it('ticks BOTH Default and Sonnet on Sonnet 5, because the pane cannot tell them apart', async () => {
    // MEASURED on Claude Code 2.1.276: `/model default` and `/model sonnet`
    // leave the same status line. The CLI's own menu ticks whichever was
    // chosen; vam has no way to know which, and marking one would be wrong
    // half the time with nothing on screen to say when.
    const { model } = reader({ kind: 'model', name: 'Sonnet 5' });
    draw({ delivers: true, terminal: true, model });
    await settle();
    act(() => picker()?.click());
    expect(ticked()).toEqual(['default', 'sonnet']);
  });

  it('keeps the word "model" and ticks nothing when the pane does not say', async () => {
    // The commonest case there is: a session with a question open is not
    // painting its status line at all.
    const { model } = reader({ kind: 'unknown' });
    draw({ delivers: true, terminal: true, model });
    await settle();
    expect(label()).toBe('model');
    act(() => picker()?.click());
    expect(ticked()).toEqual([]);
  });

  it('keeps the word "model" when this build has no reader at all', async () => {
    draw({ delivers: true, terminal: true });
    await settle();
    expect(label()).toBe('model');
    act(() => picker()?.click());
    expect(ticked()).toEqual([]);
  });

  it('never carries one row’s model onto another', async () => {
    // The lie this guards: the panel is one component that different sessions
    // pass through. A name held across a row change would be drawn under a
    // title it was never read for.
    const seen = ['Opus 5', 'Haiku 4.5'];
    let at = 0;
    const { model } = reader(() => ({ kind: 'model', name: seen[at] ?? '' }));
    draw({ delivers: true, terminal: true, model });
    await settle();
    expect(label()).toBe('Opus 5');
    at = 1;
    cleanup();
    draw({
      delivers: true,
      terminal: true,
      model,
      entry: { project: PROJECT, session: { ...SESSION, id: 's2', title: 'another row' } },
    });
    // Before the answer for the new row lands, the label is the fallback and
    // NOT the last row's model.
    expect(label()).toBe('model');
    await settle();
    expect(label()).toBe('Haiku 4.5');
  });

  it('looks again after vam types a /model line, rather than waiting out the poll', async () => {
    withBridge();
    const { asked, model } = reader({ kind: 'model', name: 'Opus 5' });
    draw({ delivers: true, terminal: true, model });
    await settle();
    expect(asked).toHaveLength(1);
    await choose('haiku');
    await settle();
    expect(asked.length).toBeGreaterThan(1);
  });

  it('asks nothing at all on a source that only records', async () => {
    // There is no pane to read there, and the control is the request field.
    const { asked, model } = reader({ kind: 'model', name: 'Opus 5' });
    draw({ model });
    await settle();
    expect(request()).not.toBeNull();
    expect(asked).toEqual([]);
  });

  it('asks nothing for a session vam did not start', async () => {
    // vam does not look into a pane it may not act in -- the same rule the
    // pane-prompt read keeps.
    const { asked, model } = reader({ kind: 'model', name: 'Opus 5' });
    draw({
      delivers: true,
      terminal: true,
      model,
      entry: { project: PROJECT, session: { ...SESSION, vamControlled: false } },
    });
    await settle();
    expect(picker()?.disabled).toBe(true);
    expect(label()).toBe('model');
    expect(asked).toEqual([]);
  });
});

/**
 * A QUESTION ON THE SCREEN STOPS THE SWITCH -- and the rule lives in MAIN now.
 *
 * Measured against a real Claude Code 2.1.276 over a private tmux socket: with
 * the CLI's own `/model` menu open, vam's old sequence -- `send-keys -l --
 * '/model haiku'` then `send-keys Enter` -- did NOT switch to Haiku. The
 * literal text was swallowed by the menu, which has no text buffer, and the
 * Enter behind it COMMITTED THE ROW THE CURSOR HAPPENED TO SIT ON:
 *
 *     ⎿  Set model to Opus 5 and saved as your default for new sessions
 *
 * Opus was merely the row the cursor was on. That is the benign case. The same
 * shape with a PERMISSION prompt on screen means vam's Enter answers a question
 * about somebody's files, and `answer.ts` already holds the rule this breaks:
 * "nothing here may ever press Return on a row it has not just read."
 *
 * THE RENDERER USED TO MAKE THAT CHECK ITSELF, over `readSessionPrompt`, and it
 * moved: main reads the pane before it types anything and answers
 * `{kind:'question', title}` (`main/terminal/model-switch.ts`), where the same
 * read is also the first step of the walk. ONE RULE, ONE PLACE -- and a rule
 * that types is a rule that belongs in main, not in the least trusted process
 * in the app. What stays here is the SENTENCE the refusal is drawn as, and the
 * ordering the web guard caught.
 */
describe('a question on the screen is drawn as a question, not as a tmux problem', () => {
  const asking: ModelSwitchResult = {
    kind: 'question',
    title: 'Do you want to make this edit to argv.ts?',
  };

  it('says a question is open and names it, rather than blaming tmux', async () => {
    withBridge(async () => asking);
    draw({ delivers: true, terminal: true });
    await choose('opus');
    const note = q<HTMLElement>('[data-mode-cycle]');
    expect(note?.getAttribute('data-mode-cycle-state')).toBe('refused');
    expect(note?.getAttribute('data-mode-refusal')).toBe('true');
    // The question in its OWN words, not "a question is open": the operator
    // has to know which one, and the pane may be off screen behind this tab.
    expect(note?.textContent).toContain('is asking');
    expect(note?.textContent).toContain('Do you want to make this edit to argv.ts?');
    // The remedy: the question is answerable, here, and then the switch works.
    expect(note?.textContent).toContain('answer it');
    // It must not read as a pairing or delivery problem -- those send the
    // operator looking in the wrong place entirely.
    expect(note?.textContent ?? '').not.toMatch(/tmux|pairing|not sent — this build/i);
  });

  it('still says something useful when the picker main saw had no title above it', async () => {
    // A menu with nothing above its rows leaves main no title to send, and a
    // caption quoting an empty string would read as a question with no words.
    withBridge(async () => ({ kind: 'question', title: '' }));
    draw({ delivers: true, terminal: true });
    await choose('opus');
    const note = q<HTMLElement>('[data-mode-cycle]');
    expect(note?.getAttribute('data-mode-cycle-state')).toBe('refused');
    expect(note?.textContent).toContain('has a menu open');
    expect(note?.textContent ?? '').not.toContain('“”');
  });

  it('has ONE way in, so main’s read covers every switch this control can make', async () => {
    // WHAT THIS ASSERTED BEFORE: the free-text row went down the same bridge
    // call as the five, so main's pane read guarded it too. The row is gone,
    // and the same claim is now a claim about the popover's shape -- there is
    // no second route to forget to route through main.
    const asked = withBridge(async () => asking);
    draw({ delivers: true, terminal: true });
    act(() => picker()?.click());
    expect(
      q('[data-model-picker-menu]')?.querySelectorAll('button, input, textarea, select, a'),
    ).toHaveLength(5);
    await act(async () => {
      q<HTMLButtonElement>('[data-model-option="opus"]')?.click();
      await Promise.resolve();
    });
    await settle();
    expect(chosen(asked)).toEqual(['opus']);
    expect(q<HTMLElement>('[data-mode-cycle]')?.textContent).toContain('is asking');
  });

  /**
   * THE SEAM MOVED, AND THIS IS THE ASSERTION THAT IT REALLY DID. A switch that
   * still read `readSessionPrompt` here would be a SECOND opinion about what is
   * on the pane, taken a tmux spawn before main takes its own -- two reads, two
   * windows in which the screen can change, and two places to keep the rule.
   */
  it('spends no read of its own: the prompt channel is not consulted at all', async () => {
    let looked = false;
    withBridge();
    draw({
      delivers: true,
      terminal: true,
      prompt: async () => {
        looked = true;
        return { kind: 'none' };
      },
    });
    await choose('opus');
    expect(looked).toBe(false);
  });

  /**
   * THE BRIDGE IS CHECKED FIRST, and the web guard found this before this test
   * existed: `model-picker-shots.mjs` drives the BROWSER build -- no
   * `window.api` at all -- against a demo row that happens to be asking a
   * question, and the caption came back naming the question. A build with no
   * keyboard into a pane cannot switch a model however the screen looks, so the
   * refusal that is true must win over the one that is merely visible;
   * answering the question would not have helped.
   */
  it('names the missing bridge, not the question, when there is no keyboard at all', async () => {
    let looked = false;
    draw({
      delivers: true,
      terminal: true,
      prompt: async () => {
        looked = true;
        return { kind: 'prompt', prompt: { title: 'Run this command?', options: ['Yes'] } };
      },
    });
    await choose('opus');
    const note = q<HTMLElement>('[data-mode-cycle]');
    expect(note?.getAttribute('data-mode-cycle-state')).toBe('refused');
    expect(note?.textContent).toContain('no keyboard into a session');
    expect(note?.textContent ?? '').not.toContain('Run this command?');
    // And it did not spend a tmux read to find that out.
    expect(looked).toBe(false);
  });

  it('asks about THIS row, not the project at large', async () => {
    const asked = withBridge();
    draw({ delivers: true, terminal: true });
    await choose('opus');
    expect(asked).toEqual([{ projectId: 'p1', choice: 'opus', rowId: 's1' }]);
  });
});
