// @vitest-environment happy-dom

/**
 * THE PROMPT ROW'S TOOLTIPS ARE SHORT, AND STILL SAY THE THING.
 *
 * Operator: "The tooltips on the buttons in the prompt input have content that
 * is a bit long — shorten them and make them more concise."
 *
 * WHAT WAS CUT AND WHAT WAS NOT. Every tooltip in the row was rewritten
 * shorter; none had its MEANING removed, and two kinds of sentence were
 * protected outright:
 *
 *  - A TOOLTIP THAT EXPLAINS WHY A CONTROL IS DISABLED IS THE REMEDY, not
 *    decoration. The model control is drawn DISABLED rather than absent
 *    exactly so it can say "there is a model here and vam has no keyboard into
 *    this session"; its note carries the way out, and a shorter note that
 *    dropped the way out would have deleted the reason the control is on
 *    screen at all.
 *  - THE MODE TOOLTIP IS THE COLOUR'S ONLY LEGEND. It names the current mode
 *    and says what that mode DOES, at the operator's own earlier ask, because
 *    the hue the glyph is painted in has no other explanation anywhere in the
 *    app. It also names BOTH mechanisms -- the line this writes into the
 *    prompt, and the ⇧Tab that presses the session's own chord -- because an
 *    operator who knows only one is left believing the other is broken.
 *
 * Also kept, being claims rather than prose: "vam uploads nothing" on both
 * attachments, "vam records and uploads nothing" on dictation, "not this one"
 * on the provider default, and the model picker's own scope -- which used to
 * be the CLI's side effect ("choosing a model there also makes it the default
 * for new sessions"), and is now the sentence that replaced it once vam
 * stopped taking the route that had one: the switch is this session's only.
 *
 * THE CAP IS A FENCE, NOT THE PROOF. `Note` paints into a 260px box at
 * `text-control` (12px), so a line of tip holds roughly forty characters and
 * `MAX_TIP` is about three and a half of them. It catches the four that had
 * run well past that -- the image attach (167), the model picker (153) and the
 * mode tooltip (212 for Auto, 222 for Plan) -- and it cannot prove the shorter
 * ones got shorter, because they were already under it. What proves that is
 * the commit's before/after count per tooltip; what stops the shortening from
 * being a DELETION is the content list below. And what a character count
 * cannot answer at all -- how many lines the tip really paints, on a machine
 * whose character width is not this machine's -- is measured on the rendered
 * box in `e2e/prompt-mode-icon-shots.mjs`.
 */

import { cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

/** About three and a half lines of the 260px tip box at 12px. */
const MAX_TIP = 140;

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
  epic: null,
  branch: null,
  status: 'idle',
  runningAgents: 0,
  activity: null,
  age: '12m',
  decisions: [DECISION],
  vamControlled: true,
};

function Harness(over: Partial<DetailPanelProps>) {
  const [draft, setDraft] = useState('');
  const project: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
  const entry: SessionEntry = { project, session: SESSION };
  return (
    <DetailPanel
      entry={entry}
      decision={DECISION}
      draft={draft}
      onDraftChange={setDraft}
      onSubmit={() => {}}
      composing={true}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={false}
      actionIndex={0}
      width={408}
      resizeHandle={null}
      delivers={true}
      terminal={true}
      onSetDefaultProvider={() => {}}
      pickImageAttachment={async () => null}
      {...over}
    />
  );
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const tip = (selector: string) => q(selector)?.getAttribute('data-note') ?? null;

/**
 * Every note in the prompt block, with its trigger -- the row itself plus the
 * submit button, which sits in the same block and is the same operator's same
 * complaint. Read off the DOM rather than listed, so a note ADDED here is
 * caught by the cap instead of quietly sitting outside a hand-written list.
 */
const notesInComposer = () =>
  [
    // DEDUPED, because `data-prompt-tools` is INSIDE `data-prompt-box`: without
    // the set, every note in the row was collected twice and a count of them
    // would have been double what it measured.
    ...new Set(
      [...document.querySelectorAll('[data-prompt-box], [data-prompt-tools]')].flatMap((root) => [
        ...(root.hasAttribute('data-note') ? [root] : []),
        ...root.querySelectorAll('[data-note]'),
      ]),
    ),
  ].map((el) => ({
    what:
      [...el.attributes].find((a) => a.name.startsWith('data-') && a.name !== 'data-note')?.name ??
      el.tagName,
    text: el.getAttribute('data-note') ?? '',
  }));

afterEach(cleanup);

describe('the prompt row’s tooltips are short', () => {
  it('finds a corpus of notes to measure at all', () => {
    // A sweep must prove it found something: this whole file passes vacuously
    // if the selector stops matching, which is how a green guard ends up
    // having examined zero elements.
    render(<Harness />);
    const notes = notesInComposer();
    // FIVE, AND IT WAS SIX. The provider picker is withdrawn while `PROVIDERS`
    // has one row (`src/shared/providers.ts`), and its note went with the
    // control -- a tooltip is not a thing to keep after the control it hangs
    // on. The floor moves with the corpus rather than being left high enough
    // to fail, and low enough to still catch the selector going dead.
    expect(notes.length).toBeGreaterThanOrEqual(5);
    for (const note of notes) expect(note.text.length).toBeGreaterThan(0);
  });

  it('keeps every one of them inside the tip box’s own few lines', () => {
    render(<Harness />);
    const over = notesInComposer()
      .filter((note) => note.text.length > MAX_TIP)
      .map((note) => `${note.what} (${note.text.length}): ${note.text}`);
    expect(over).toEqual([]);
  });

  it('holds the mode tooltip under the cap for the LONGEST mode, not the first', () => {
    // `Plan` has the longest `means` of the three, so it is the one that
    // decides whether this tooltip fits. Measuring only the default would be a
    // check that passes on the easy case.
    for (const mode of ['Auto', 'Manual', 'Plan'] as const) {
      cleanup();
      render(<Harness draft={`mode: ${mode}\nask`} />);
      const text = tip('[data-mode-toggle]') ?? '';
      expect(text).toContain(`mode: ${mode}`);
      expect(text.length).toBeLessThanOrEqual(MAX_TIP);
    }
  });
});

describe('and shorter did not mean emptier', () => {
  it('leaves the mode tooltip its legend and BOTH mechanisms', () => {
    render(<Harness draft={'mode: Plan\nask'} />);
    const text = tip('[data-mode-toggle]') ?? '';
    // The mode's name, what it means (the hue's only legend anywhere), the
    // line this control writes, and the chord that presses the session's own.
    expect(text).toContain('mode: Plan');
    expect(text).toContain('writes the list before it touches anything');
    expect(text).toMatch(/prompt/);
    expect(text).toMatch(/⇧Tab|Shift\+Tab/);
  });

  it('leaves the DISABLED model control its reason and its remedy', () => {
    cleanup();
    // `delivers` with no pane vam owns: the one state whose whole point is the
    // sentence on the control.
    render(
      <Harness
        entry={{
          project: { id: 'p1', name: 'atlas', sessions: [SESSION] },
          session: { ...SESSION, vamControlled: false },
        }}
      />,
    );
    const text = tip('[data-model-picker-shell]') ?? '';
    expect(text).toMatch(/no terminal/i); // why
    expect(text).toMatch(/vam terminal/i); // what to do about it
    expect(text.length).toBeLessThanOrEqual(MAX_TIP);
  });

  it('leaves every claim vam makes about what it does NOT do', () => {
    render(<Harness />);
    // These are not prose, they are claims -- the reason an operator can paste
    // a private path into this box at all. A shortening that dropped one would
    // be a different change wearing this one's commit message.
    expect(tip('[data-attach]')).toMatch(/uploads nothing/);
    expect(tip('[data-attach-image]')).toMatch(/uploads nothing/);
    expect(tip('[data-attach-image]')).toMatch(/this session’s own directory/);
    // THE PROVIDER PICKER'S TWO CLAIMS ARE NOT DROPPED, THE CONTROL IS. It is
    // withdrawn while the table has one row (`CAN_CHOOSE_PROVIDER`), so there
    // is nothing here to make a claim about; the note travels with the button
    // and comes back with it, unchanged, the day a second provider ships. The
    // rule this file holds -- a claim may be corrected, never quietly dropped
    // -- is what makes the distinction worth writing down rather than just
    // deleting two lines. `test/panels/DetailPanel.provider-double.test.tsx`
    // is where both sentences are still asserted, against a two-row table.
    expect(tip('[data-provider-picker-toggle]'), 'withdrawn with its control').toBeNull();
    // THE MODEL PICKER'S CLAIM CHANGED SIDES, and it is still a claim. It used
    // to disclose the CLI's own side effect -- "a full id also becomes the
    // default for new sessions" -- true while vam typed `/model <id>` for a
    // full model id. vam refuses that route now
    // (`main/terminal/model-switch.ts`), so the honest sentence is the scope
    // itself, and the old one would promise a settings change vam will not
    // make. The rule this file holds is unchanged: the claim may be corrected,
    // never dropped.
    expect(tip('[data-model-picker]')).toMatch(/this session only/);
    expect(tip('[data-model-picker]')).not.toMatch(/default for new sessions/);
    expect(tip('[data-model-picker]')).toMatch(/\/model/);
  });

  it('leaves the recording source its "vam cannot switch models" sentence', () => {
    render(<Harness delivers={false} />);
    const text = tip('[data-model-request]') ?? '';
    expect(text).toMatch(/cannot switch models/);
    expect(text).toMatch(/factory chooses/);
    expect(text.length).toBeLessThanOrEqual(MAX_TIP);
  });
});
