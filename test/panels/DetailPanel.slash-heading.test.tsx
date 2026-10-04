// @vitest-environment happy-dom

/**
 * EC-40, operator event #31: the `/` popover's lead-in line is a small section
 * heading set apart from the command rows, with Enter and Esc drawn as keys.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';

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
  epic: null,
  branch: null,
  status: 'idle',
  runningAgents: 0,
  activity: null,
  age: '12m',
  decisions: [DECISION],
  vamControlled: true,
  slashCommands: [
    { id: 'compact', name: 'compact', description: 'summarise the conversation so far' },
    { id: 'review', name: 'review', description: null },
  ],
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ENTRY: SessionEntry = { project: PROJECT, session: SESSION };

function Composer() {
  const [draft, setDraft] = useState('');
  return (
    <DetailPanel
      entry={ENTRY}
      decision={null}
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
    />
  );
}

afterEach(cleanup);

describe('the / popover heading', () => {
  function open() {
    render(<Composer />);
    const box = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="prompt to session"]',
    ) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '/' } });
    return document.querySelector('[data-slash-suggest]') as HTMLElement;
  }

  it('is the first child, capitalised, and not a row', () => {
    const list = open();
    const heading = list.firstElementChild as HTMLElement;
    expect(heading.hasAttribute('data-slash-suggest-heading')).toBe(true);
    expect(heading.textContent?.startsWith("The provider's own commands")).toBe(true);
    expect(heading.tagName).not.toBe('BUTTON');
    expect(heading.getAttribute('role')).not.toBe('option');
    expect(heading.querySelector('button, [role="option"]')).toBeNull();
  });

  it('is divided from the first command row and set smaller than the rows', () => {
    const heading = open().firstElementChild as HTMLElement;
    const cls = heading.className.split(/\s+/);
    expect(cls).toContain('border-b');
    expect(cls).toContain('border-line');
    expect(cls).toContain('text-meta');
    expect(cls).toContain('text-ink-faint');
    expect(cls).not.toContain('text-control');
    expect(heading.nextElementSibling?.hasAttribute('data-slash-suggestion')).toBe(true);
  });

  it('draws Enter and Esc as exactly two key tags', () => {
    const heading = open().firstElementChild as HTMLElement;
    const tags = [...heading.querySelectorAll('kbd[data-key-tag]')];
    expect(tags.map((tag) => tag.textContent)).toEqual(['Enter', 'Esc']);
  });
});
