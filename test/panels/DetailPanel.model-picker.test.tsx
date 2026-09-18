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
import type { PaneKey, PaneSendResult, SessionModel } from '../../src/shared/terminal.js';

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
    expect(
      all('[data-model-option]').map((el) =>
        el.querySelector('[data-model-name]')?.textContent?.trim(),
      ),
    ).toEqual(['Default', 'Sonnet', 'Fable', 'Opus', 'Haiku']);
    for (const option of all('[data-model-option]')) {
      expect(option.getAttribute('role')).toBe('option');
    }
    expect(q('[data-model-id]')?.tagName).toBe('INPUT');
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
      // Nothing here reads a model, so no row may claim to be running one.
      expect(kids).toHaveLength(2);
      expect(option.querySelector('[data-model-current]')).toBeNull();
    }
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
    // And the disclosure it has always carried is still there beside it.
    expect(picker()?.getAttribute('data-note')).toContain('default for new sessions');
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
