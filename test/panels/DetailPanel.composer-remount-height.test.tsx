// @vitest-environment happy-dom

/**
 * THE COMPOSER LOSES ITS GROWN HEIGHT ON A SILENT REMOUNT (cross-provider
 * review finding, X-PH-1).
 *
 * The auto-resize effect (`inputRef`'s own `useEffect`, right above
 * `pickImage` in `DetailPanel.tsx`) depends on `[draft]` alone: `if (draft
 * !== '') box.style.height = \`${box.scrollHeight}px\``. That effect lives on
 * `DetailPanel` itself, which never unmounts -- but the TEXTAREA it resizes
 * is conditionally rendered a level down (`composerHidden`, drawn/withdrawn
 * by `drawsComposer(current) && !composerHidden`), and `composerHidden`
 * flips true the instant an `AskUserQuestion` opens
 * (`DetailPanel.questions.test.tsx`'s own "the composer stands down while a
 * question is open" describe block). "Chat about this" flips it back,
 * mounting a BRAND NEW textarea node with no inline height of its own.
 *
 * If the draft was already non-empty and UNCHANGED across that round trip --
 * the operator had typed a few lines, a question interrupted them, they hit
 * "Chat about this" to reply anyway -- the effect's own dependency array
 * gives it nothing to fire on: `draft` is the same string it was before the
 * question opened. The fresh node is left at its bare `rows` height instead
 * of the height its own (still multi-line) content asks for.
 *
 * happy-dom does not lay out a textarea at all -- `scrollHeight` reads a flat
 * `0` on every node, real content or none (verified against the shipped
 * happy-dom build: the getter lives on `Element.prototype`, not per-instance,
 * and returns 0 regardless) -- so this cannot assert a real pixel figure;
 * `DetailPanel.phone-composer.test.tsx`'s own header explains why the
 * project's own convention is to prove the SHAPE here and the pixel figure in
 * a real browser. `scrollHeight` is stubbed here, at the PROTOTYPE, precisely
 * because the node under test does not exist until the remount this test
 * triggers -- there is no instance to patch ahead of time. This is the
 * mechanism check; `e2e/phone-question-shots.mjs` (or a new real-browser
 * assertion beside it) is the pixel-figure half of this same fix.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentQuestion, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';

const QUESTION: AgentQuestion = {
  id: 'toolu_1:0',
  header: 'Providers',
  question: 'Which providers should vam support beyond Claude Code?',
  multiSelect: false,
  options: [{ label: 'Codex CLI', description: null, preview: null }],
  answer: null,
};

const MULTILINE_DRAFT = 'line one\nline two\nline three\nline four';
const MOCK_SCROLL_HEIGHT = 246;

function draw(over: Partial<DetailPanelProps> = {}) {
  const session: Session = {
    id: 's1',
    title: 'Provider survey',
    epic: null,
    branch: null,
    status: 'waiting',
    runningAgents: 0,
    activity: null,
    age: '3m',
    decisions: [{ id: 'd1', label: 'plan', input: 'ask me', output: 'asked', commands: [] }],
    questions: [QUESTION],
  };
  const project: Project = { id: 'p1', name: 'atlas', sessions: [session] };
  const entry: SessionEntry = { project, session };
  return render(
    <DetailPanel
      entry={entry}
      decision={session.decisions[0] ?? null}
      draft={MULTILINE_DRAFT}
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

let originalScrollHeight: PropertyDescriptor | undefined;

afterEach(() => {
  cleanup();
  if (originalScrollHeight === undefined) {
    delete (HTMLTextAreaElement.prototype as { scrollHeight?: unknown }).scrollHeight;
  } else {
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', originalScrollHeight);
  }
});

describe('the composer keeps its grown height across a remount with an unchanged draft', () => {
  it('resizes a freshly-mounted textarea to its content, not just its bare rows', () => {
    originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'scrollHeight',
    );
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return MOCK_SCROLL_HEIGHT;
      },
    });

    draw();
    // Withdrawn while the question is open -- nothing mounted yet to resize.
    expect(document.querySelector('[data-prompt-box]')).toBeNull();

    // "Chat about this" remounts the composer with the SAME draft: a brand
    // new textarea node, no inline height of its own yet.
    fireEvent.click(document.querySelector('[data-question-chat]') as HTMLElement);
    const box = document.querySelector<HTMLTextAreaElement>('[data-prompt-box] textarea');

    expect(box).not.toBeNull();
    expect(box?.style.height).toBe(`${MOCK_SCROLL_HEIGHT}px`);
  });
});
