// @vitest-environment happy-dom

/**
 * The queue that writes answers onto the permanent record.
 *
 * Everything here is about refusing to make a consequential answer easy to give
 * by accident: no default, no single click, and a reason before the button that
 * accepts a defect will do anything.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiFinding, ApiLesson } from '../../src/adapter/api.js';
import { ReviewQueue, type ReviewQueueProps } from '../../src/panels/ReviewQueue.js';

function finding(over: Partial<ApiFinding> = {}): ApiFinding {
  return {
    findingId: 'f-1',
    taskId: 'e2e/task-1',
    fingerprint: 'fp-1',
    severity: 'S3-minor',
    findingStatus: 'raised',
    summary: 'Comment names a variable that was renamed.',
    foundBy: 'reviewer',
    waiverId: null,
    ...over,
  };
}

function lesson(over: Partial<ApiLesson> = {}): ApiLesson {
  return {
    lessonId: 'l-1',
    sessionId: 's1',
    lessonType: 'rule',
    lessonScope: 'stack-wide',
    lessonStatus: 'candidate',
    statement: 'Re-read the claim before writing outside it.',
    ...over,
  };
}

type Answered = { id: string; verdict: string; note: string };

/**
 * The queue is controlled — its notes live in the parent so the keyboard can
 * read them — so the test supplies a parent that holds them, exactly as Canvas
 * does.
 */
function mount(over: Partial<ReviewQueueProps> = {}) {
  const answers: Answered[] = [];

  function Host() {
    const [notes, setNotes] = useState<Record<string, string>>({});
    const props: ReviewQueueProps = {
      waivers: [],
      lessons: [],
      error: null,
      hidden: 0,
      busyId: null,
      notes,
      onNoteChange: (rowId, note) => setNotes((all) => ({ ...all, [rowId]: note })),
      onNoteDone: () => {},
      selectedActionId: null,
      focusNoteFor: null,
      onWaiver: (fingerprint, decision, note) =>
        answers.push({ id: fingerprint, verdict: decision, note }),
      onLesson: (lessonId, to, note) => answers.push({ id: lessonId, verdict: to, note }),
      ...over,
    };
    return <ReviewQueue {...props} />;
  }

  render(<Host />);
  return answers;
}

const typeInto = (input: HTMLInputElement, text: string) => {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (
      this: HTMLInputElement,
      v: string,
    ) => void;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const button = (row: Element, label: string) =>
  [...row.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;

afterEach(cleanup);

describe('when there is nothing to answer', () => {
  it('draws nothing at all', () => {
    mount();
    expect(document.querySelector('[data-review-queue]')).toBeNull();
  });

  it('but says so when the read failed, rather than looking empty', () => {
    // An empty list reads as "nothing to answer", which is the opposite of what
    // a failed read means.
    mount({ error: 'HTTP 500' });
    expect(screen.getByText(/could not read the approval queue/)).toBeTruthy();
    expect(document.querySelector('[data-review-queue]')).toBeNull();
  });
});

describe('a waiver', () => {
  it('shows what is being waived, on whose word', () => {
    mount({ waivers: [finding()] });
    const row = document.querySelector('[data-waiver="fp-1"]') as HTMLElement;
    expect(row.textContent).toContain('S3-minor');
    expect(row.textContent).toContain('e2e/task-1');
    expect(row.textContent).toContain('reviewer');
    expect(row.textContent).toContain('Comment names a variable');
  });

  it('will not answer until a reason is given', () => {
    // waivers.ts requires operatorNote. Enforcing it here means the refusal
    // arrives before you have committed to an answer rather than after — and a
    // waiver with no reason reads as an accident a month later.
    const answers = mount({ waivers: [finding()] });
    const row = document.querySelector('[data-waiver="fp-1"]') as HTMLElement;
    expect(button(row, 'waive').disabled).toBe(true);
    expect(button(row, 'fix').disabled).toBe(true);
    act(() => {
      button(row, 'waive').click();
    });
    expect(answers).toEqual([]);
  });

  it('carries the reason through with the verdict', () => {
    const answers = mount({ waivers: [finding()] });
    const row = document.querySelector('[data-waiver="fp-1"]') as HTMLElement;
    typeInto(row.querySelector('input') as HTMLInputElement, 'just a comment');
    act(() => {
      button(row, 'waive').click();
    });
    expect(answers).toEqual([{ id: 'fp-1', verdict: 'granted', note: 'just a comment' }]);
  });

  it('sends the fingerprint, which is what the factory answers in', () => {
    const answers = mount({ waivers: [finding({ findingId: 'f-9', fingerprint: 'fp-9' })] });
    const row = document.querySelector('[data-waiver="fp-9"]') as HTMLElement;
    typeInto(row.querySelector('input') as HTMLInputElement, 'ok');
    act(() => {
      button(row, 'fix').click();
    });
    expect(answers[0]).toMatchObject({ id: 'fp-9', verdict: 'denied' });
  });

  it('stops taking clicks while its answer is in flight', () => {
    const answers = mount({ waivers: [finding()], busyId: 'fp-1' });
    const row = document.querySelector('[data-waiver="fp-1"]') as HTMLElement;
    typeInto(row.querySelector('input') as HTMLInputElement, 'ok');
    act(() => {
      button(row, 'waive').click();
    });
    expect(answers).toEqual([]);
  });
});

describe('a lesson candidate', () => {
  it('shows the statement and what kind of rule it would become', () => {
    mount({ lessons: [lesson()] });
    const row = document.querySelector('[data-lesson="l-1"]') as HTMLElement;
    expect(row.textContent).toContain('rule');
    expect(row.textContent).toContain('stack-wide');
    expect(row.textContent).toContain('Re-read the claim');
  });

  it('takes an answer without requiring a note', () => {
    // Unlike a waiver: approving a lesson accepts a statement that is already
    // written down and reviewable. Nothing is being excused.
    const answers = mount({ lessons: [lesson()] });
    const row = document.querySelector('[data-lesson="l-1"]') as HTMLElement;
    act(() => {
      button(row, 'approve').click();
    });
    expect(answers).toEqual([{ id: 'l-1', verdict: 'approve', note: '' }]);
  });

  it('routes a rejection separately', () => {
    const answers = mount({ lessons: [lesson()] });
    const row = document.querySelector('[data-lesson="l-1"]') as HTMLElement;
    typeInto(row.querySelector('input') as HTMLInputElement, 'duplicate of an old one');
    act(() => {
      button(row, 'reject').click();
    });
    expect(answers).toEqual([{ id: 'l-1', verdict: 'reject', note: 'duplicate of an old one' }]);
  });

  it('counts both queues in the heading', () => {
    mount({ waivers: [finding()], lessons: [lesson()] });
    const header = document.querySelector('[data-review-queue]') as HTMLElement;
    expect(header.textContent).toContain('waiting for your review');
    expect(header.textContent).toContain('2');
  });
});

describe('what the keyboard sees', () => {
  it('rings the verdict button the action cursor is on', () => {
    // The ring around the thing you are about to press IS the answer to what
    // will happen — that is why every button is its own stop.
    mount({ waivers: [finding()], selectedActionId: 'waiver:fp-1:granted' });
    const row = document.querySelector('[data-waiver="fp-1"]') as HTMLElement;
    const grant = [...row.querySelectorAll('button')].find((b) => b.textContent === 'waive');
    const deny = [...row.querySelectorAll('button')].find((b) => b.textContent === 'fix');
    expect(grant?.className).toContain('ring-running');
    expect(deny?.className).not.toContain('ring-running');
  });

  it('rings nothing while the pane does not hold the keyboard', () => {
    mount({ waivers: [finding()], selectedActionId: null });
    const row = document.querySelector('[data-waiver="fp-1"]') as HTMLElement;
    expect(row.innerHTML).not.toContain('ring-running');
  });

  it('takes the caret when `i` asks for that row', () => {
    mount({ waivers: [finding()], focusNoteFor: 'fp-1' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('reason for fp-1');
  });

  it('leaves the caret alone when `i` asked for a different row', () => {
    // A queue that grabbed focus on every render would fight the person typing.
    mount({ waivers: [finding()], focusNoteFor: 'fp-other' });
    expect(document.activeElement?.getAttribute('aria-label')).not.toBe('reason for fp-1');
  });
});

describe('getting back out of a note box', () => {
  it('Escape ends typing and hands the keyboard back', () => {
    // The window listener ignores keys typed in an input — that is what keeps
    // the grammar from firing mid-word — so a box with no handler of its own is
    // a box the caret cannot leave. It could not, until it could.
    let done = 0;
    mount({ waivers: [finding()], focusNoteFor: 'fp-1', onNoteDone: () => (done += 1) });
    const input = document.querySelector('input[aria-label="reason for fp-1"]') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(done).toBe(1);
    expect(document.activeElement).not.toBe(input);
  });

  it('Enter does the same, and never answers the verdict', () => {
    // The cursor is still on whichever button `j` last reached. Firing it from
    // inside the text box would grant a waiver as the last keystroke of writing
    // its excuse.
    let done = 0;
    const answers = mount({
      waivers: [finding()],
      focusNoteFor: 'fp-1',
      onNoteDone: () => (done += 1),
    });
    const input = document.querySelector('input[aria-label="reason for fp-1"]') as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(done).toBe(1);
    expect(answers).toEqual([]);
  });
});
