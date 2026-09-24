// @vitest-environment happy-dom

/**
 * THE COMPOSER'S PROVIDER PICKER, AGAINST A TABLE THAT HAS SOMETHING TO PICK.
 *
 * `DetailPanel.test.tsx` asserts the composer draws NO provider control,
 * because `PROVIDERS` (`src/shared/providers.ts`) has one row and a one-option
 * choice is a control that cannot act. On its own that assertion is satisfied
 * by a composer which has simply LOST its picker -- deleting the control passes
 * it exactly as well as making the control conditional does. This file is what
 * tells those two apart: a two-row table, and the picker back, writing.
 *
 * It is `test/settings/provider-double.test.tsx` one file over, for the same
 * reason and in the same idiom -- `vi.mock` replaces the whole module, so the
 * file that mocks it can no longer see the shipped table, and the two files are
 * therefore separate on purpose. THREE surfaces now ask this table whether
 * there is a choice (settings, the composer, and `prefs`), and each has its own
 * double beside its own shipped-table file.
 *
 * DO NOT DELETE THIS ONCE A REAL SECOND PROVIDER SHIPS. It would then be
 * testing the picker against a real table rather than a double, which is
 * strictly better; what makes it redundant is the condition itself being torn
 * out, not the table growing.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  // The same total function the shipped module ships, reimplemented rather
  // than imported: importing it would import the one-row table with it.
  function resolveProvider(id: unknown) {
    const match = PROVIDERS.find((provider) => provider.id === id);
    return match ?? PROVIDERS.find((provider) => provider.id === DEFAULT_PROVIDER_ID);
  }
  function readProviderId(id: unknown) {
    return resolveProvider(id)?.id;
  }
  // DERIVED FROM THIS TABLE, never hard-coded `true`: a double that asserted
  // the condition rather than computing it would stop being a double of the
  // module the moment the module's own derivation changed.
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

afterEach(cleanup);

describe('A15.4: with two providers, the composer offers the choice', () => {
  it('is still absent when the caller has no way to persist a change', () => {
    // BOTH conditions, not one: a table with something in it does not make a
    // control that cannot write into one that can.
    draw();
    expect(q('[data-provider-picker-toggle]')).toBeNull();
  });

  it('names the current default with a real accessible name, beside the model field', () => {
    draw({ defaultProvider: 'claude-code', onSetDefaultProvider: () => {} });
    const toggle = q<HTMLButtonElement>('[data-provider-picker-toggle]');
    const model = q<HTMLElement>('[data-model-request]');
    expect(toggle?.tagName).toBe('BUTTON');
    expect(toggle?.getAttribute('aria-label')).toContain('Claude Code');
    expect(model).not.toBeNull();
    // "Beside": immediately before the model field in document order, not
    // merely somewhere in the same pane.
    if (toggle !== null && model !== null) {
      expect(
        Boolean(toggle.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).toBe(true);
    }
  });

  it('keeps both claims the note makes about what it does and does not change', () => {
    // Moved here with the control: `DetailPanel.tooltip-length.test.tsx` holds
    // the rule that a claim may be corrected and never quietly dropped, and a
    // withdrawn control's note has to go on being asserted somewhere.
    draw({ defaultProvider: 'claude-code', onSetDefaultProvider: () => {} });
    const note = q('[data-provider-picker-toggle]')?.getAttribute('data-note') ?? '';
    expect(note).toMatch(/NEW sessions/);
    expect(note).toMatch(/not this one/);
  });

  it('opens a real listbox on click, marks the current provider, and closes once one is picked', () => {
    const seen: string[] = [];
    draw({
      defaultProvider: 'claude-code',
      onSetDefaultProvider: (id) => seen.push(id),
    });
    expect(q('[data-provider-picker]'), 'closed at rest').toBeNull();
    act(() => {
      q<HTMLButtonElement>('[data-provider-picker-toggle]')?.click();
    });
    const list = q<HTMLElement>('[data-provider-picker]');
    expect(list?.getAttribute('role')).toBe('listbox');
    // BOTH ROWS, which is the thing the shipped table cannot show: a list of
    // one is what the withdrawal is about.
    expect(document.querySelectorAll('[data-provider-option]')).toHaveLength(2);
    const option = q<HTMLButtonElement>('[data-provider-option="claude-code"]');
    expect(option?.getAttribute('role')).toBe('option');
    expect(option?.getAttribute('aria-selected')).toBe('true');
    const second = q<HTMLButtonElement>('[data-provider-option="vam-test-second-provider"]');
    expect(second?.getAttribute('aria-selected')).toBe('false');
    act(() => {
      second?.click();
    });
    expect(seen).toEqual(['vam-test-second-provider']);
    expect(q('[data-provider-picker]'), 'closes once a pick lands').toBeNull();
  });

  it('reads the default provider from a fresh vam the same way resolveProvider does', () => {
    // No `defaultProvider` passed at all -- the honest "nothing chosen yet"
    // case, which must not render a blank or a crash.
    draw({ onSetDefaultProvider: () => {} });
    expect(
      q<HTMLButtonElement>('[data-provider-picker-toggle]')?.getAttribute('aria-label'),
    ).toContain('Claude Code');
  });

  it('gives every option a 44px phone floor, which is where it was measured at 24', () => {
    // `.vam-phone .vam-tap` is the phone's floor and it is opt-in at the
    // component; this is the opt-in, asserted where the control can be drawn
    // at all. The SIZE is Playwright's (`e2e/phone-core-loop.pw.ts`), which is
    // also where 89x24 was measured -- happy-dom lays nothing out.
    draw({ defaultProvider: 'claude-code', onSetDefaultProvider: () => {} });
    act(() => {
      q<HTMLButtonElement>('[data-provider-picker-toggle]')?.click();
    });
    for (const option of document.querySelectorAll('[data-provider-option]')) {
      expect(option.className, option.getAttribute('data-provider-option') ?? '').toContain(
        'vam-tap',
      );
    }
  });
});
