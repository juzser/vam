// @vitest-environment happy-dom

/**
 * ONE OF THESE IS OPEN AT A TIME -- the state-machine half of the operator's
 * report, which is the half a unit environment can honestly answer.
 *
 * Operator: "When I open the auto/manual mode picker, clicking outside or
 * clicking over to the model picker does not close it, so the popovers end up
 * overlapping each other."
 *
 * TWO ROUTES WERE REPORTED AND SIX WERE MEASURED. The prompt tools row has
 * THREE popovers -- provider, model, mode -- each of which held its own
 * `useState` boolean, and none of which knew the other two existed. Driven in
 * a real browser against the shipped bundle before anything was changed:
 *
 *   mode open      + click outside            -> mode still open
 *   mode open      + click the model control  -> BOTH open
 *   model open     + click the mode control   -> BOTH open
 *   model open     + click outside            -> model still open
 *   provider open  + click outside            -> provider still open
 *   provider open  + click the mode control   -> all THREE open at once
 *
 * So the reported pair was a sample of a family of six, and patching the two
 * reported directions would have left four. The fix is the rule rather than
 * the patches: the three booleans became ONE `openPopover` name, so "two of
 * them are open" is a state that no longer exists to be reached.
 *
 * WHAT THIS FILE CANNOT ANSWER, and does not pretend to: clicking OUTSIDE.
 * That is a `pointerdown` listener on the document against real hit-testing,
 * and this repo has a standing lesson that jsdom-family environments hide
 * exactly this class of defect. `e2e/prompt-popovers-shots.mjs` drives all six
 * routes in Chromium against the built bundle and asserts the peer is GONE
 * FROM THE DOM -- the property, not a handler having been called.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A TWO-ROW PROVIDER TABLE, so that the family stays a family of six.
 *
 * The provider picker is withdrawn while `PROVIDERS` (`src/shared/providers.ts`)
 * has one row -- a popover over a single already-selected item is a control
 * that cannot act. Reduced to the two controls the shipped table draws, this
 * file would assert TWO ordered pairs instead of six, and the arm the operator
 * actually reported (`provider open + click the mode control -> all THREE
 * open`) would stop being measured anywhere.
 *
 * So the table is doubled rather than the coverage cut. The state machine
 * under test is `openPopover`, which is one name shared by all three and knows
 * nothing about how many providers exist; the double restores the third
 * control without touching it. The idiom, the `vi.hoisted` shape and the
 * reimplemented total functions are `test/settings/provider-double.test.tsx`'s,
 * verbatim and for its reason.
 */
const TEST_TABLE = vi.hoisted(() => ({
  DEFAULT_PROVIDER_ID: 'claude-code',
  PROVIDERS: [
    { id: 'claude-code', label: 'Claude Code', command: ['claude'] },
    {
      id: 'vam-test-second-provider',
      label: 'Test-Only Second Provider',
      command: ['vam-test-second-provider-cmd'],
    },
  ],
}));

vi.mock('../../src/shared/providers.js', () => {
  const { DEFAULT_PROVIDER_ID, PROVIDERS } = TEST_TABLE;
  function resolveProvider(id: unknown) {
    const match = PROVIDERS.find((provider) => provider.id === id);
    return match ?? PROVIDERS.find((provider) => provider.id === DEFAULT_PROVIDER_ID);
  }
  function readProviderId(id: unknown) {
    return resolveProvider(id)?.id;
  }
  return {
    CAN_CHOOSE_PROVIDER: PROVIDERS.length > 1,
    DEFAULT_PROVIDER_ID,
    PROVIDERS,
    resolveProvider,
    readProviderId,
  };
});

import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

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
      // All three controls at once: `delivers` + `terminal` put the model
      // picker in its enabled state, `vamControlled` (above) draws the mode
      // chip, and a `onSetDefaultProvider` the caller can honour draws the
      // provider one. This is the row the operator was looking at.
      delivers={true}
      terminal={true}
      onSetDefaultProvider={() => {}}
      {...over}
    />
  );
}

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const click = (selector: string) => fireEvent.click(q(selector) as HTMLElement);

/** Which of the three popovers have a node on screen, by name. */
const open = () =>
  (
    [
      ['provider', '[data-provider-picker]'],
      ['model', '[data-model-picker-menu]'],
      ['mode', '[data-mode-picker]'],
    ] as const
  )
    .filter(([, selector]) => q(selector) !== null)
    .map(([name]) => name);

/** The toggle that opens each one. */
const TOGGLE = {
  provider: '[data-provider-picker-toggle]',
  model: '[data-model-picker]',
  mode: '[data-mode-toggle]',
} as const;

const NAMES = ['provider', 'model', 'mode'] as const;

afterEach(cleanup);

describe('opening one popover closes whichever was open', () => {
  it('draws all three controls, so the collision the operator hit is reachable here', () => {
    render(<Harness />);
    for (const name of NAMES) {
      expect(q(TOGGLE[name])).not.toBeNull();
    }
    expect(open()).toEqual([]);
  });

  // EVERY ORDERED PAIR, not the one direction that was reported. A bug
  // reported in one direction is a sample of a population, and this row had
  // six members; asserting only `mode -> model` would leave the other five
  // free to come back.
  for (const first of NAMES) {
    for (const second of NAMES) {
      if (first === second) continue;
      it(`closes ${first} when ${second} is opened`, () => {
        render(<Harness />);
        click(TOGGLE[first]);
        expect(open()).toEqual([first]);
        click(TOGGLE[second]);
        // THE PROPERTY, NOT A PROXY: the peer's popover is GONE from the DOM,
        // which is what "they stopped overlapping" means. A check that the
        // second one opened would pass while both were on screen -- which is
        // precisely the state that was shipped.
        expect(open()).toEqual([second]);
      });
    }
  }

  it('still closes on its own toggle, which is how it always shut', () => {
    render(<Harness />);
    for (const name of NAMES) {
      click(TOGGLE[name]);
      expect(open()).toEqual([name]);
      click(TOGGLE[name]);
      expect(open()).toEqual([]);
    }
  });

  it('says so in `aria-expanded`, so a screen reader is told the peer collapsed', () => {
    render(<Harness />);
    click(TOGGLE.mode);
    expect(q(TOGGLE.mode)?.getAttribute('aria-expanded')).toBe('true');
    expect(q(TOGGLE.model)?.getAttribute('aria-expanded')).toBe('false');
    click(TOGGLE.model);
    expect(q(TOGGLE.mode)?.getAttribute('aria-expanded')).toBe('false');
    expect(q(TOGGLE.model)?.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes the open one when a row is PICKED in it, not only when a toggle is clicked', () => {
    // The pick path writes through a different call than the toggle path, so
    // it is asserted rather than assumed: a mode pick sets the draft's `mode:`
    // line AND shuts the popover.
    render(<Harness />);
    click(TOGGLE.mode);
    click('[data-mode-option="plan"]');
    expect(open()).toEqual([]);
  });
});
