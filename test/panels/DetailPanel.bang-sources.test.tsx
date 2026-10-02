// @vitest-environment happy-dom

/**
 * EC-67 (operator event #73): typing `!` in the Response view composer offers
 * no bash suggestion, "perhaps because the bash was answered in a block quote".
 *
 * The shapes a bash command takes in what the view holds are tried one at a
 * time, so the result can say which one the `!` list could not see at the base
 * commit. Each shape is built the way the source builds it: a proposed command
 * goes through `extractCommands` (the real `commands.ts` rule) before it rides
 * on a turn, so the fixture cannot offer the panel a row the source would not.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { extractCommands } from '../../src/main/sources/claude-code/commands.js';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';

const turn = (id: string, input: string, output: string | null): Decision => ({
  id,
  label: 'claude-code',
  input,
  output,
  commands: output === null ? [] : extractCommands(output, id),
});

const SHELL_TURN = turn('d2', '!git status', 'clean');
const BLOCKQUOTE = turn('d3', 'what next', 'Run this:\n\n> !pnpm run test\n');
const LIST_ITEM = turn('d4', 'and then', 'Steps:\n\n- ! pnpm run build\n');
const FENCED = turn('d5', 'and last', 'Run:\n\n```bash\n! pnpm run typecheck\n```\n');

function Composer({ decisions }: { readonly decisions: readonly Decision[] }) {
  const [draft, setDraft] = useState('');
  const session: Session = {
    vamControlled: true,
    id: 's1',
    title: 'bash',
    epic: null,
    branch: null,
    status: 'idle',
    runningAgents: 0,
    activity: null,
    age: '1m',
    // Newest first, the ordering `model.ts` promises.
    decisions: [...decisions].reverse(),
  };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  return (
    <DetailPanel
      entry={{ project, session }}
      decision={session.decisions[0] ?? null}
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

const box = () =>
  document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="prompt to session"]',
  ) as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const suggested = () =>
  [...document.querySelectorAll('[data-bang-suggestion] [data-bang-command]')].map((el) =>
    (el.textContent ?? '').trim(),
  );

afterEach(cleanup);

describe('EC-67 the ! list offers the bash the session holds', () => {
  it('(2) offers an operator !cmd turn', () => {
    render(<Composer decisions={[SHELL_TURN]} />);
    type('!');
    expect(suggested()).toEqual(['git status']);
  });

  it('(3a) offers a command proposed inside a blockquote', () => {
    render(<Composer decisions={[BLOCKQUOTE]} />);
    type('!');
    expect(suggested()).toEqual(['pnpm run test']);
  });

  it('(3b) offers a command proposed inside a list item', () => {
    render(<Composer decisions={[LIST_ITEM]} />);
    type('!');
    expect(suggested()).toEqual(['pnpm run build']);
  });

  it('(3c) offers a command proposed inside a fenced block, once', () => {
    render(<Composer decisions={[FENCED]} />);
    type('!');
    expect(suggested()).toEqual(['pnpm run typecheck']);
  });

  it('holds every shape at once, each exactly once, and `!pn` narrows to the pnpm rows', () => {
    render(<Composer decisions={[SHELL_TURN, BLOCKQUOTE, LIST_ITEM, FENCED]} />);
    type('!');
    expect([...suggested()].sort()).toEqual(
      ['git status', 'pnpm run build', 'pnpm run test', 'pnpm run typecheck'].sort(),
    );
    type('!pn');
    expect(suggested()).toHaveLength(3);
    expect(suggested().every((c) => c.startsWith('pnpm'))).toBe(true);
  });

  it('a ! inside a sentence opens nothing, as before', () => {
    render(<Composer decisions={[SHELL_TURN, BLOCKQUOTE, LIST_ITEM, FENCED]} />);
    type('run this !');
    expect(document.querySelector('[data-bang-suggest]')).toBeNull();
  });

  // (1) An assistant Bash tool_use whose `input.command` is 'pnpm run lint'.
  // BLOCKED, not written: no field of `Decision` carries a tool call's input
  // (`TurnStep` holds only `label` and `failed`), so the panel cannot be handed
  // this shape without a model change outside this task's claims.
  it.todo('(1) offers an assistant Bash tool_use input.command');
});
