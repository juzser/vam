// @vitest-environment happy-dom

/**
 * The right-hand detail pane: what it collapses, what it colours, and what it
 * refuses to claim.
 *
 * Every assertion here is one of five operator requests read off the ADE
 * mockup's right pane (artboards 1a/1b, the `width:408px` column). The one that
 * is NOT a fidelity question is the composer's button: the mockup draws a send
 * arrow, black-smith has no channel into a running agent session, and the whole
 * point of the tests below is that the button says `record` in every place a
 * reader or a screen reader can find it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import {
  ATTACH_LIMIT_BYTES,
  type AttachedFile,
  attachIntoDraft,
  DetailPanel,
  type DetailPanelProps,
  detachFromDraft,
  readAttachedName,
  readModelRequest,
  readModeRequest,
  setModelRequest,
  setModeRequest,
  splitAnswers,
} from '../../src/renderer/panels/DetailPanel.js';
import {
  hasContentAbove,
  hasContentBelow,
  isAtBottom,
} from '../../src/renderer/panels/stick-to-bottom.js';
import { OUT_FONT_SIZE_VAR } from '../../src/renderer/prefs/prefs.js';
import type { PaneView } from '../../src/shared/terminal.js';

/** `attachIntoDraft` for the cases a test knows will be accepted. */
function attachOk(draft: string, file: AttachedFile): string {
  const result = attachIntoDraft(draft, file);
  if (!result.ok) throw new Error(result.message);
  return result.draft;
}

function decision(id: string, output: string | null = 'answered'): Decision {
  return { id, label: `step ${id}`, input: `ask ${id}`, output, commands: [] };
}

// Five, so "the newest three" and "all of them" are different lists: with
// three turns a collapsed region and an expanded one look identical and the
// test proves nothing.
const DECISIONS = [
  decision('d5', null),
  decision('d4'),
  decision('d3'),
  decision('d2'),
  decision('d1'),
];

const SESSION: Session = {
  id: 's1',
  title: 'Sprint board reorder',
  icon: null,
  epic: 'board',
  branch: null,
  status: 'waiting',
  runningAgents: 2,
  activity: 'just now',
  age: '12m',
  decisions: DECISIONS,
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ENTRY: SessionEntry = { project: PROJECT, session: SESSION };

/**
 * The header dot is the pane's only status channel, and it used to have two
 * values for four states plus an empty one: `needsYou ? waiting : running`.
 * So a `done` session, a `failed` session, AND no session at all were all
 * painted as RUNNING -- the last of those putting a live-looking dot beside
 * the words "No session selected".
 */
describe('the pane header names the session status it actually has', () => {
  const dotClass = () => document.querySelector('[data-pane-status]')?.getAttribute('class') ?? '';

  it('paints each of the four statuses with its own token', () => {
    for (const [status, token] of [
      ['waiting', 'bg-waiting'],
      ['running', 'bg-running'],
      ['done', 'bg-done'],
      ['failed', 'bg-failed'],
    ] as const) {
      cleanup();
      draw({ entry: { project: PROJECT, session: { ...SESSION, status } } });
      expect(dotClass(), `status ${status}`).toContain(token);
      // Each token appears for exactly its own status, so a map collapsing two
      // of them together fails rather than passing on a shared colour.
      for (const other of ['bg-waiting', 'bg-running', 'bg-done', 'bg-failed']) {
        if (other !== token)
          expect(dotClass(), `${status} must not be ${other}`).not.toContain(other);
      }
    }
  });

  it('breathes only for the status that is asking for something', () => {
    for (const [status, breathes] of [
      ['waiting', true],
      ['running', true],
      ['done', false],
      ['failed', false],
    ] as const) {
      cleanup();
      draw({ entry: { project: PROJECT, session: { ...SESSION, status } } });
      expect(dotClass().includes('vam-breathe'), `status ${status}`).toBe(breathes);
    }
  });

  it('shows no status colour at all when no session is selected', () => {
    // The dot claimed a running session while the title said none was picked.
    draw({ entry: null, decision: null });
    for (const token of ['bg-waiting', 'bg-running', 'bg-done', 'bg-failed']) {
      expect(dotClass()).not.toContain(token);
    }
    expect(dotClass()).not.toContain('vam-breathe');
  });
});

/**
 * In-flight delivery.
 *
 * `claude --resume` is a subprocess with a 120-SECOND timeout
 * (`deliver.ts`'s `DELIVER_TIMEOUT_MS`). Before this the composer showed
 * nothing while it ran: Enter appeared to do nothing for up to two minutes,
 * and every further Enter was swallowed by `Canvas`'s `writing` guard without
 * a word. The flag existed; it just never left `Canvas`.
 */
describe('the composer says when a prompt is in flight', () => {
  const submit = () => document.querySelector('[data-prompt-record]');

  it('names the in-flight state on the control, and marks it busy', () => {
    draw({ draft: 'ship it', sending: true, delivers: true });
    expect(submit()?.getAttribute('aria-busy')).toBe('true');
    expect(submit()?.getAttribute('aria-label')).toMatch(/sending/i);
    expect(submit()?.hasAttribute('disabled')).toBe(true);
  });

  it('is not busy at rest, and the control keeps its own wording', () => {
    draw({ draft: 'ship it', sending: false, delivers: true });
    expect(submit()?.getAttribute('aria-busy')).toBe('false');
    expect(submit()?.getAttribute('aria-label')).toBe('send prompt');
    expect(submit()?.hasAttribute('disabled')).toBe(false);
  });

  it('keeps the draft on screen while it is being sent', () => {
    // The words are mid-flight, not gone: a failure leaves them to retry, and
    // clearing the box early would look like a send that had completed.
    draw({ draft: 'ship it', sending: true, delivers: true });
    expect(q<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]')?.value).toBe(
      'ship it',
    );
  });

  it('says RECORDING, not sending, for a source that only records', () => {
    // The delivers/records distinction has to survive into the in-flight
    // wording too, or the one honest sentence in this pane becomes a lie for
    // exactly as long as the write takes.
    draw({ draft: 'ship it', sending: true, delivers: false });
    expect(submit()?.getAttribute('aria-label')).toMatch(/recording/i);
    expect(submit()?.getAttribute('aria-label')).not.toMatch(/sending/i);
  });
});

/**
 * Session-level facts must not be captioned as turn-level ones.
 *
 * `Decision` carries no timestamp (`model.ts`), so nothing in the model can
 * say when a particular turn happened. The `in` rule captioned every turn
 * with `you · <session.age>` -- the session's LAST ACTIVITY, which is usually
 * the agent's most recent write, not when you typed that input -- and the
 * `out` rule captioned every turn's output with `session.activity`, which is
 * what the session is doing RIGHT NOW. Walk back to an older turn with `h`
 * and both captions kept describing the present.
 */
describe('the in and out rules do not date a turn the model cannot date', () => {
  const ruleMeta = (block: string) =>
    q<HTMLElement>(`[data-detail-block="${block}"] [data-rule-meta]`)?.textContent ?? '';

  it('the in rule names who, and claims no per-turn time', () => {
    draw({ entry: ENTRY, decision: DECISIONS[2] as Decision });
    expect(ruleMeta('in')).toContain('you');
    // 12m is SESSION.age. It must not appear against a turn three back.
    expect(ruleMeta('in')).not.toContain('12m');
  });

  it('the out rule shows current activity only on the turn being worked', () => {
    // Newest turn of a running session: the activity genuinely belongs to it.
    cleanup();
    draw({
      entry: { project: PROJECT, session: { ...SESSION, status: 'running' } },
      decision: DECISIONS[0] as Decision,
    });
    expect(ruleMeta('out')).toContain('just now');

    // An older turn: the same activity line would be describing the present
    // while the operator reads the past.
    cleanup();
    draw({
      entry: { project: PROJECT, session: { ...SESSION, status: 'running' } },
      decision: DECISIONS[2] as Decision,
    });
    expect(ruleMeta('out')).not.toContain('just now');
  });

  it('says no session is selected rather than that the session has no steps', () => {
    // With nothing focused the pane read "This session has no steps yet",
    // which names a session that does not exist.
    draw({ entry: null, decision: null });
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('This session has no steps yet');
    expect(body).toMatch(/no session/i);
  });
});

/**
 * A failed session, and the reason nobody has.
 *
 * Measured against the real CLI: `claude agents --json --all` reports two
 * failed background sessions on this machine, and a failed row carries only
 * `cwd, id, kind, name, sessionId, startedAt, state` -- NO error, no message,
 * no exit code. The job's own `~/.claude/jobs/<id>/state.json` says
 * `state: "working"` for the same session, contradicting the CLI, so it is not
 * a second opinion worth showing either.
 *
 * So the pane's job is to say the session failed and to say that nothing
 * reports why. Inventing a reason, or presenting internal state that
 * disagrees with the tool, would both be worse than the silence.
 */
describe('a failed session says so, and does not invent a reason', () => {
  const failed = (over: Partial<Session> = {}) => ({
    project: PROJECT,
    session: { ...SESSION, status: 'failed' as const, ...over },
  });

  it('names the failure and names the gap where the reason would be', () => {
    draw({ entry: failed(), decision: DECISIONS[0] as Decision });
    const banner = q<HTMLElement>('[data-session-failed]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toMatch(/failed/i);
    // The gap, on hover, in the same shape the rest of the pane uses.
    expect(document.querySelector('[data-note]')?.getAttribute('data-note') ?? '').toMatch(
      /no reason/i,
    );
  });

  it('draws nothing for any status that has not failed', () => {
    for (const status of ['waiting', 'running', 'done'] as const) {
      cleanup();
      draw({
        entry: { project: PROJECT, session: { ...SESSION, status } },
        decision: DECISIONS[0] as Decision,
      });
      expect(q('[data-session-failed]'), `status ${status}`).toBeNull();
    }
  });

  it('says a failed session recorded nothing, rather than "no steps yet"', () => {
    // A failed BACKGROUND session has no transcript at all -- verified: the
    // CLI lists it while `~/.claude/projects/` holds no `.jsonl` for its id.
    // "no steps yet" promises steps that are never coming.
    draw({ entry: failed({ decisions: [] }), decision: null });
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('no steps yet');
    expect(body).toMatch(/failed/i);
  });

  it('still says "no steps yet" for a live session that simply has none', () => {
    // The two absences must not collapse into one sentence.
    draw({
      entry: { project: PROJECT, session: { ...SESSION, status: 'running', decisions: [] } },
      decision: null,
    });
    expect(document.body.textContent ?? '').toContain('no steps yet');
  });
});

function draw(over: Partial<DetailPanelProps> = {}) {
  const props: DetailPanelProps = {
    entry: ENTRY,
    // The newest turn, which is the one the canvas focuses by default.
    decision: DECISIONS[0] as Decision,
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

/** `draw`, but able to re-render with new props -- for a capability that changes. */
function drawFor(over: Partial<DetailPanelProps> = {}) {
  const build = (extra: Partial<DetailPanelProps>): DetailPanelProps => ({
    entry: ENTRY,
    decision: DECISIONS[0] as Decision,
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
    ...extra,
  });
  const view = render(<DetailPanel {...build({})} />);
  return {
    rerender: (extra: Partial<DetailPanelProps>) =>
      view.rerender(<DetailPanel {...build(extra)} />),
  };
}

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const all = (selector: string) => [...document.querySelectorAll(selector)];
const progress = () => q<HTMLElement>('[data-detail-block="progress"]');
const turns = () => all('[data-progress-turn]');
const toggle = () => q<HTMLButtonElement>('[data-progress-toggle]');

afterEach(cleanup);

describe('the progress region shows nothing until it is opened', () => {
  // Seven turns, so "the newest five" and "all of them" are different lists.
  const MANY = ['d7', 'd6', 'd5', 'd4', 'd3', 'd2', 'd1'].map((id) => decision(id));
  const manyEntry: SessionEntry = {
    project: PROJECT,
    session: { ...SESSION, decisions: MANY },
  };

  it('draws no turn collapsed, the newest five expanded, and says which it is', () => {
    draw({ entry: manyEntry, decision: MANY[0] as Decision });
    // Zero, per the operator: collapsed, `progress` is its rule and its toggle
    // and nothing else, so the height it costs goes to `out`.
    expect(turns()).toHaveLength(0);
    // And no empty box either — the list is not rendered at all, so the
    // section cannot leave a bordered gap where its content would be.
    expect(progress()?.querySelector('ul')).toBeNull();
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');

    act(() => toggle()?.click());
    // The five most RECENT, not all seven, and ordered oldest-first like the
    // ribbon: the last line is the newest turn.
    expect(turns()).toHaveLength(5);
    expect(turns()[4]?.textContent).toContain('step d7');
    expect(turns()[0]?.textContent).toContain('step d3');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');

    act(() => toggle()?.click());
    expect(turns()).toHaveLength(0);
  });

  it('keeps the three-region structure the pane already earned', () => {
    draw();
    // A real <button>, so Enter and Space work with no new global binding and
    // no key stolen from the modal keymap.
    expect(toggle()?.tagName).toBe('BUTTON');
    // Regressions guarded elsewhere, restated here because this change is the
    // one most likely to eat them: still flex-none, and once open the list is
    // its own scroller rather than growing the pane.
    expect(progress()?.className).toContain('flex-none');
    act(() => toggle()?.click());
    expect(progress()?.querySelector('.vam-no-scrollbar')?.className).toContain('overflow-y-auto');
  });
});

describe('the pane drops the status line under the tab bar', () => {
  it('says nothing in prose, and still says it with the status dot', () => {
    draw();
    // The operator asked for the banner under the tabs to go. Nothing is lost
    // with it: the same `waiting` status is what makes the header dot amber
    // and breathe, two lines above where the sentence used to be.
    expect(document.body.textContent).not.toContain('waiting on you');
    expect(q<HTMLElement>('.vam-breathe.bg-waiting')).not.toBeNull();

    cleanup();
    draw({ entry: { project: PROJECT, session: { ...SESSION, status: 'running' } } });
    expect(q<HTMLElement>('.vam-breathe.bg-waiting')).toBeNull();
  });
});

describe('the pane wears the mockup’s own background', () => {
  it('uses the sidebar token, the pane colour measured off both artboards', () => {
    draw();
    // #171717 dark / #f0eeea light in the mockup — exactly `--vam-sidebar`,
    // so this is an existing token rather than a new one.
    const aside = q<HTMLElement>('[data-action-pane]');
    expect(aside?.className).toContain('bg-sidebar');
    expect(aside?.className).not.toContain('bg-sunken');
  });
});

describe('the composer is multiline, and honest about what its button does', () => {
  // `composing`, because the default entry is WAITING and the option picker
  // stands in place of the prompt box there until the box owns the keyboard.
  // These tests are about the box itself, not about when it is drawn.
  it('is a textarea with a record button, and no i / I notes', () => {
    draw({ composing: true });
    const box = q<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]');
    expect(box).not.toBeNull();
    expect(document.querySelector('input[aria-label="prompt to session"]')).toBeNull();

    // The button exists and never uses the word `send`: black-smith records a
    // prompt into the session log, it cannot hand it to a running agent.
    const button = q<HTMLButtonElement>('[data-prompt-record]');
    expect(button?.tagName).toBe('BUTTON');
    const claims = `${button?.getAttribute('aria-label')} ${button?.getAttribute('title')} ${button?.textContent}`;
    expect(claims.toLowerCase()).toContain('record');
    expect(claims.toLowerCase()).not.toContain('send');

    // The two hint notes the operator asked to lose.
    const footer = q<HTMLElement>('[data-action-pane]')?.textContent ?? '';
    expect(footer).not.toContain('i type · I pane');
    expect(footer).not.toContain('i reason · Enter act');
  });

  it('records on Enter and takes a newline on Shift+Enter', () => {
    let submitted = 0;
    draw({
      composing: true,
      onSubmit: () => {
        submitted += 1;
      },
    });
    const box = q<HTMLTextAreaElement>(
      'textarea[aria-label="prompt to session"]',
    ) as HTMLTextAreaElement;

    act(() => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(submitted).toBe(1);

    // Shift+Enter is the newline the box became multiline to allow, so it must
    // not also be the key that files the prompt.
    act(() => {
      box.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
      );
    });
    expect(submitted).toBe(1);
  });

  it('shortens a pasted image to `[image #N]` and says the image is not sent', () => {
    // The terminal does this, and the operator asked for the same: a
    // screenshot must not unfold into whatever text flavour the clipboard had.
    let draft = 'look at ';
    const view = drawFor({
      composing: true,
      draft,
      onDraftChange: (next: string) => {
        draft = next;
      },
    });
    const box = q<HTMLTextAreaElement>(
      'textarea[aria-label="prompt to session"]',
    ) as HTMLTextAreaElement;
    box.selectionStart = draft.length;
    box.selectionEnd = draft.length;

    const paste = (name: string) =>
      act(() => {
        fireEvent.paste(box, {
          clipboardData: {
            items: [
              { kind: 'file', type: 'image/png', getAsFile: () => ({ name }) as unknown as File },
            ],
          },
        });
      });

    paste('one.png');
    expect(draft).toBe('look at [image #1]');
    view.rerender({ draft });

    // The second image in the SAME composition is #2, not #1 again. Nothing
    // is inserted around it: a separate paste goes exactly where the cursor
    // is, and the spacing between two of them is the operator's to type.
    box.selectionStart = draft.length;
    box.selectionEnd = draft.length;
    paste('two.png');
    expect(draft).toBe('look at [image #1][image #2]');
    view.rerender({ draft });

    // Both images are still held, and the box does not let the placeholder
    // imply they travel.
    const held = q('[data-pasted-images]')?.textContent ?? '';
    expect(held).toContain('2 images');
    expect(held).toMatch(/not sent|only the/i);
  });

  it('leaves a paste carrying no image to the browser', () => {
    let draft = 'typed';
    let changes = 0;
    draw({
      composing: true,
      draft,
      onDraftChange: (next: string) => {
        draft = next;
        changes += 1;
      },
    });
    const box = q<HTMLTextAreaElement>(
      'textarea[aria-label="prompt to session"]',
    ) as HTMLTextAreaElement;

    act(() => {
      fireEvent.paste(box, {
        clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] },
      });
    });

    expect(changes).toBe(0);
    expect(draft).toBe('typed');
    expect(q('[data-pasted-images]')).toBeNull();
  });

  it('clicking record files the draft', () => {
    let submitted = 0;
    draw({
      draft: 'do it again',
      onSubmit: () => {
        submitted += 1;
      },
    });
    act(() => q<HTMLButtonElement>('[data-prompt-record]')?.click());
    expect(submitted).toBe(1);
  });
});

describe('the row under the composer is the mockup’s mode row', () => {
  it('replaces the slash tags with mode pills', () => {
    draw();
    const row = q<HTMLElement>('[data-mode-row]');
    expect(row).not.toBeNull();
    expect(all('[data-mode-pill]').map((el) => el.textContent)).toEqual(['Auto', 'Manual', 'Plan']);
    // The slash tags this row replaced.
    expect(row?.textContent).not.toContain('/diff');
    expect(document.querySelector('[data-placeholder="slash-diff"]')).toBeNull();
  });

  it('advertises no chord in the row, because none is bound', () => {
    draw();
    // The `⇧Tab · cycle mode` tag that sat at the right-hand end named a
    // chord no table ever answered to -- the same hand-written caption
    // `keysheet.ts` cites as the reason the key sheet is DERIVED from the
    // chord tables. Pinned as an absence so a re-add fails here rather than
    // quietly promising the key again. A real binding may bring it back;
    // the caption alone may not.
    expect(q<HTMLElement>('[data-mode-cycle]')).toBeNull();
    expect(q<HTMLElement>('[data-mode-row]')?.textContent).not.toContain('cycle mode');
  });
});

describe('there is a way out of the prompt box without a mouse', () => {
  it('Escape gives the keyboard back, and does not leave DOM focus behind', () => {
    let left = 0;
    draw({
      composing: true,
      onStopComposing: () => {
        left += 1;
      },
    });
    const box = q<HTMLTextAreaElement>(
      'textarea[aria-label="prompt to session"]',
    ) as HTMLTextAreaElement;
    // `composing` focuses the box, which is the state the operator gets stuck
    // in: while it holds DOM focus the window listener returns early on every
    // key, so no navigation key reaches the sidebar at all.
    expect(document.activeElement).toBe(box);

    act(() => {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(left).toBe(1);
    // Clearing `composing` alone is not enough: it only makes the box
    // read-only. Until it is blurred the keys still land on it and vanish.
    expect(document.activeElement).not.toBe(box);
  });

  it('says how to get out, in the box, while you are in it', () => {
    draw({ composing: true });
    expect(q<HTMLElement>('[data-prompt-escape]')?.textContent).toContain('Esc');
    expect(q<HTMLElement>('[data-prompt-escape]')?.textContent).toContain('sidebar');
    // Not clutter the rest of the time: the way out only matters once you are
    // in, and this row is already carrying four things at 408px.
    cleanup();
    draw({ composing: false });
    expect(q<HTMLElement>('[data-prompt-escape]')).toBeNull();
  });
});

describe('the regions are capped in lines, and `out` gets what they give up', () => {
  it('caps `in` at two rendered lines of its own body text', () => {
    draw();
    const box = q<HTMLElement>('[data-detail-scroll="in"]');
    expect(box).not.toBeNull();
    // Two lines of 12px/1.55 plus the box's own 10px padding and 1px border.
    // A number, not a percentage: "two lines" is a promise about the text,
    // and a percentage of the pane is a promise about the window.
    expect(box?.style.maxHeight).toBe('59px');
    // Still a scroller — capped, not clipped: the rest is one drag away.
    expect(box?.className).toContain('overflow-y-auto');
  });

  it('gives `out` the height the other two gave up', () => {
    draw();
    const out = q<HTMLElement>('[data-detail-block="out"]');
    expect(out?.className).toContain('flex-1');
    expect(q<HTMLElement>('[data-detail-scroll="out"]')).not.toBeNull();
  });
});

describe('the out text is formatted, not a flat wall', () => {
  it('splits the adapter’s newline-joined answers into one block each', () => {
    // What `toDecisions` actually produces: one summarised answer per line,
    // each `eventType · taskId · detail`.
    draw({
      decision: {
        id: 'd5',
        label: 'step d5',
        input: 'ask',
        output: 'task.completed · t-4 · wrote the migration\nnote.added · t-4 · needs review',
        commands: [],
      },
    });
    const lines = all('[data-out-line]');
    expect(lines).toHaveLength(2);
    // The machine-ish head is monospace and carries the mockup's emphasis
    // colour (#ededed dark / #18181b light = `ink`); the prose stays at the
    // measured body colour (#a1a1a1 / #52525b = `ink-dim`).
    const head = lines[0]?.querySelector('[data-out-head]');
    expect(head?.textContent).toBe('task.completed · t-4');
    expect(head?.className).toContain('font-mono');
    expect(head?.className).toContain('text-ink');
    expect(lines[0]?.querySelector('[data-out-body] p')?.className).toContain('text-ink-dim');
    expect(lines[1]?.textContent).toContain('needs review');
  });

  it('leaves an output with no separator as a single readable block', () => {
    draw({
      decision: { id: 'd5', label: 'l', input: 'i', output: 'just words', commands: [] },
    });
    const lines = all('[data-out-line]');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.textContent).toBe('just words');
    expect(lines[0]?.querySelector('[data-out-head]')).toBeNull();
  });
});

/**
 * The `out` region renders GitHub-flavoured markdown, per the operator.
 *
 * Two things are being asserted at once here and they pull in opposite
 * directions: an agent's answer should READ like the markdown it was written
 * as, and an agent's answer is untrusted text that must not be able to run
 * anything or fetch anything. `react-markdown` with no `rehype-raw` is what
 * buys both, and the tests below hold that line rather than assuming it.
 */
describe('the out region renders the agent’s markdown', () => {
  const withOutput = (output: string) =>
    draw({ decision: { id: 'd5', label: 'l', input: 'i', output, commands: [] } });

  it('keeps a multi-line answer whole instead of one block per newline', () => {
    // The adapter joins summarised answers with a newline, so a newline is
    // AMBIGUOUS: it separates two answers, and it is also every line break
    // inside one answer's own text. A fence or a table would be shredded by
    // splitting on it, so a block breaks only where a new answer's head sits.
    expect(
      splitAnswers('task.done · t-1 · here:\n```\nrun me\n```\nnote.added · t-1 · done'),
    ).toEqual(['task.done · t-1 · here:\n```\nrun me\n```', 'note.added · t-1 · done']);
    // Prose that merely mentions the separator mid-sentence is not a new
    // answer: a head is one bare token and then the separator.
    expect(splitAnswers('one\nand two · three')).toEqual(['one\nand two · three']);
    expect(splitAnswers('  \n\n')).toEqual([]);
  });

  it('renders headings, emphasis, lists and gfm tables', () => {
    withOutput(
      '## heading\n\n**bold** and ~~struck~~\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |',
    );
    const out = q<HTMLElement>('[data-detail-scroll="out"]') as HTMLElement;
    expect(out.querySelector('h2')?.textContent).toBe('heading');
    expect(out.querySelector('strong')?.textContent).toBe('bold');
    // Strikethrough is gfm, not core markdown: it is the cheapest proof that
    // `remark-gfm` is actually plugged in and not merely installed.
    expect(out.querySelector('del')?.textContent).toBe('struck');
    expect(out.querySelectorAll('li')).toHaveLength(2);
    // The pane is resizable and 408px by default, so the two elements that
    // have no width of their own scroll inside their own box rather than
    // widening the pane.
    const table = out.querySelector('table');
    expect(table).not.toBeNull();
    expect(table?.parentElement?.className).toContain('overflow-x-auto');
  });

  it('scrolls a fenced block sideways rather than widening the pane', () => {
    withOutput('```sh\necho a-very-long-command-that-does-not-wrap\n```');
    const pre = q<HTMLElement>('[data-detail-scroll="out"] pre');
    expect(pre).not.toBeNull();
    expect(pre?.className).toContain('overflow-x-auto');
    // Wrapping a fence is worse than scrolling it: a wrapped command line
    // reads as two commands.
    expect(pre?.className).not.toContain('whitespace-pre-wrap');
  });

  it('renders none of the raw HTML an untrusted answer may carry', () => {
    // This is the reason the library was chosen: it parses markdown into
    // React elements and drops embedded HTML unless `rehype-raw` is added,
    // which it is not and must not be. `out` is an agent's text and vam has
    // no way to know what produced it.
    withOutput('before <img src="x" onerror="boom"> <script>bad()</script> after');
    const out = q<HTMLElement>('[data-detail-scroll="out"]') as HTMLElement;
    expect(out.querySelector('img')).toBeNull();
    expect(out.querySelector('script')).toBeNull();
    // It is not dropped, it is defused: the tags arrive as escaped TEXT, so
    // the markup carries `&lt;img` and no element and no attribute. This is
    // the assertion that would fail the day someone adds `rehype-raw` — it
    // cannot fail against a plain-text renderer, which is the point: it is a
    // standing guard, not a claim that today's rendering changed anything.
    expect(out.innerHTML).toContain('&lt;img');
    expect(out.textContent).toContain('before');
    expect(out.textContent).toContain('after');
  });

  it('shows a markdown image as its words, and never fetches it', () => {
    // An image URL in an agent's answer is a remote fetch that would tell
    // whoever wrote the answer that this pane opened, and when.
    withOutput('![a chart](https://example.com/pixel.png)');
    const out = q<HTMLElement>('[data-detail-scroll="out"]') as HTMLElement;
    expect(out.querySelector('img')).toBeNull();
    expect(out.textContent).toContain('a chart');
    // And the syntax itself is consumed rather than printed: without this the
    // assertions above pass on any renderer that shows the source text.
    expect(out.textContent).not.toContain('![');
  });

  it('prints a link’s address instead of offering a click that goes nowhere', () => {
    // The shell denies `window.open` and every off-origin navigation
    // (src/main/index.ts), which is the right policy and makes an <a> here a
    // control that silently does nothing. The address is shown instead, in a
    // pane where text is selectable, so it can be copied and opened by hand.
    withOutput('see [the docs](https://example.com/x) for more');
    const out = q<HTMLElement>('[data-detail-scroll="out"]') as HTMLElement;
    expect(out.querySelector('a')).toBeNull();
    expect(out.textContent).toContain('the docs');
    expect(out.textContent).toContain('https://example.com/x');
    // Same guard: the brackets are gone, so this cannot pass on raw text.
    expect(out.textContent).not.toContain('](');
  });
});

describe('the in and out rules wear the mockup’s own glyphs', () => {
  it('is a user for in and a bot for out, announced rather than drawn only', () => {
    draw();
    // Measured off the Response artboards: `in` is a head-and-shoulders glyph,
    // `out` is a bot (antenna, two eyes, a mouth) — not the arrows vam had.
    // `role="img"` is what makes the label announced at all; on a bare <span>
    // aria-label is dropped in silence.
    const inIcon = q<HTMLElement>('[data-detail-block="in"] [role="img"]');
    const outIcon = q<HTMLElement>('[data-detail-block="out"] [role="img"]');
    expect(inIcon?.getAttribute('aria-label')).toContain('you');
    expect(outIcon?.getAttribute('aria-label')).toContain('agent');
  });
});

/**
 * Three section rules, three colours.
 *
 * The operator could not tell `in`, `progress` and `out` apart at a glance:
 * all three drew their icon inside the rule's one `text-ink-faint` span, so
 * the pane had three headings in the same faint grey. Colour is ADDED to the
 * existing scheme, never substituted for it — a colour-only distinction is
 * invisible to a colour-blind operator, so the distinct glyph and the
 * announced `aria-label` are asserted here beside the colour and are what
 * carries the meaning when the colour does not arrive.
 */
describe('the three section rules are told apart by colour as well as by glyph', () => {
  const BLOCKS = ['in', 'progress', 'out'] as const;

  const icon = (block: string) =>
    q<HTMLElement>(`[data-detail-block="${block}"] [role="img"]`) ?? null;

  /** The colour utility on an icon, e.g. `text-rule-in`. */
  const tone = (block: string) =>
    (icon(block)?.getAttribute('class') ?? '').split(/\s+/).find((c) => c.startsWith('text-')) ??
    '';

  it('paints each icon with its own token, pairwise distinct', () => {
    draw();
    const tones = BLOCKS.map(tone);
    for (const [i, block] of BLOCKS.entries()) {
      // Not merely non-empty: the faint grey they all shared is a `text-`
      // class too, and three of it would pass an "each has a colour" check.
      expect(tones[i], `${block} carries a colour token`).not.toBe('');
      expect(tones[i], `${block} is no longer the shared faint grey`).not.toBe('text-ink-faint');
    }
    // Pairwise, so two sections sharing one hue fails rather than passing on
    // the third being different.
    expect(new Set(tones).size, `three distinct tokens, got ${tones.join(', ')}`).toBe(3);
  });

  it('keeps every icon announced, so colour is never the only channel', () => {
    draw();
    const labels = BLOCKS.map((block) => {
      const el = icon(block);
      // `role="img"` is what makes the label announced at all; on a bare
      // <span> aria-label is dropped in silence, which this codebase has
      // shipped once already.
      expect(el, `${block} has a role="img" icon`).not.toBeNull();
      return el?.getAttribute('aria-label') ?? '';
    });
    // Each word is what the GLYPH means, complementing the visible label
    // rather than repeating it: `in` is you, `out` is the agent, and the
    // commit line is the session's turns.
    expect(labels).toEqual(['you', 'turns', 'agent']);
  });

  it('draws three different glyphs, which is the distinction without colour', () => {
    draw();
    // The glyphs are a head-and-shoulders, a commit line and a bot, measured
    // off the Response artboards in #53 — not the opposing arrows vam started
    // with. Compare the drawn geometry, so a shared icon fails here even when
    // the three colours pass above.
    const shapes = BLOCKS.map((block) => icon(block)?.querySelector('svg')?.innerHTML ?? '');
    for (const [i, block] of BLOCKS.entries())
      expect(shapes[i], `${block} draws a glyph`).not.toBe('');
    expect(new Set(shapes).size).toBe(3);
  });
});

describe('the attachment button inlines a file into the text that gets recorded', () => {
  const file = (over: Partial<AttachedFile> = {}): AttachedFile => ({
    name: 'notes.md',
    size: 12,
    text: 'hello\nthere',
    ...over,
  });

  it('wraps the contents in a named block appended to the draft', () => {
    const result = attachIntoDraft('please read this', file());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toContain('please read this');
    expect(result.draft).toContain('--- attached: notes.md ---');
    expect(result.draft).toContain('hello\nthere');
    expect(result.draft).toContain('--- end attached ---');
    // And the block is what the chip and the remove button read back.
    expect(readAttachedName(result.draft)).toBe('notes.md');
    expect(detachFromDraft(result.draft)).toBe('please read this');
  });

  it('refuses a file bigger than the inline limit, and says the limit', () => {
    const result = attachIntoDraft('', file({ size: ATTACH_LIMIT_BYTES + 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('64 KB');
    expect(result.message).toContain('notes.md');
  });

  it('refuses a file it could not decode rather than inlining the wreckage', () => {
    // What `File.text()` hands back for bytes that are not UTF-8: the
    // replacement character. Inlining that writes noise into a log that is
    // append-only, so it is refused with a sentence instead.
    const result = attachIntoDraft('', file({ text: 'PK��' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('text');
  });

  it('takes one file at a time, and says which one is in the way', () => {
    const first = attachIntoDraft('ask', file());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = attachIntoDraft(first.draft, file({ name: 'other.txt' }));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.message).toContain('notes.md');
  });

  it('reads nothing back out of a draft that merely mentions the words', () => {
    expect(readAttachedName('I attached: nothing at all')).toBeNull();
    expect(detachFromDraft('plain text')).toBe('plain text');
  });
});

describe('the model field writes the request into the prompt, and claims nothing more', () => {
  it('puts the request on its own leading line, and round-trips it', () => {
    const withModel = setModelRequest('redo the gate', 'opus');
    expect(withModel.startsWith('model: opus\n')).toBe(true);
    expect(withModel).toContain('redo the gate');
    expect(readModelRequest(withModel)).toBe('opus');
  });

  it('replaces rather than stacks, and clears away cleanly', () => {
    const once = setModelRequest('redo the gate', 'opus');
    const twice = setModelRequest(once, 'sonnet');
    expect(readModelRequest(twice)).toBe('sonnet');
    expect(twice).not.toContain('opus');
    expect(setModelRequest(twice, '')).toBe('redo the gate');
    expect(readModelRequest('redo the gate')).toBe('');
  });
});

describe('the composer draws both controls, and both do something', () => {
  it('opens a real file input, shows the name, and takes it back off', () => {
    let draft = '';
    const onDraftChange = (value: string) => {
      draft = value;
    };
    draw({ draft: 'ask', onDraftChange });
    const button = q<HTMLButtonElement>('[data-attach]');
    expect(button?.tagName).toBe('BUTTON');
    expect(q<HTMLInputElement>('input[type="file"]')).not.toBeNull();
    // The note is no longer a `title`: a title never appears on keyboard focus,
    // and this is a keyboard-first tool.
    expect(button?.getAttribute('title')).toBeNull();
    expect(button?.getAttribute('data-note')).toContain('into the prompt text');

    cleanup();
    // With a file already inlined, the chip names it and offers it back.
    draw({ draft: attachOk('ask', { name: 'plan.md', size: 4, text: 'x' }), onDraftChange });
    expect(q<HTMLElement>('[data-attach-chip]')?.textContent).toContain('plan.md');
    act(() => q<HTMLButtonElement>('[data-attach-remove]')?.click());
    expect(draft).toBe('ask');
  });

  it('drives the model request off the draft itself, not a second copy', () => {
    let draft = 'model: opus\nredo it';
    const onDraftChange = (value: string) => {
      draft = value;
    };
    draw({ draft, onDraftChange });
    const field = q<HTMLInputElement>('[data-model-request]');
    expect(field?.value).toBe('opus');
    expect(field?.getAttribute('data-note')).toContain('cannot');
    // `fireEvent.change`, not a hand-built event: React tracks an input's last
    // value and swallows an event whose value it set itself.
    if (field !== null) fireEvent.change(field, { target: { value: 'sonnet' } });
    expect(draft).toBe('model: sonnet\nredo it');
  });
});

describe('the out region offers the two jumps that would do something', () => {
  it('offers `to top` only with content above and `to bottom` only with content below', () => {
    expect(hasContentAbove({ scrollTop: 0, scrollHeight: 900, clientHeight: 300 })).toBe(false);
    expect(hasContentAbove({ scrollTop: 40, scrollHeight: 900, clientHeight: 300 })).toBe(true);
    expect(hasContentBelow({ scrollTop: 40, scrollHeight: 900, clientHeight: 300 })).toBe(true);
    expect(hasContentBelow({ scrollTop: 600, scrollHeight: 900, clientHeight: 300 })).toBe(false);
    // A region shorter than its own box offers neither: a control that scrolls
    // nowhere is worse than no control.
    const short = { scrollTop: 0, scrollHeight: 200, clientHeight: 300 };
    expect(hasContentAbove(short)).toBe(false);
    expect(hasContentBelow(short)).toBe(false);
  });

  it('uses the same slack as the stick rule, so `to bottom` and stuck agree', () => {
    const nearly = { scrollTop: 590, scrollHeight: 900, clientHeight: 300 };
    expect(isAtBottom(nearly)).toBe(true);
    expect(hasContentBelow(nearly)).toBe(false);
  });
});

/**
 * The mode pills, and the composer's missing caret.
 *
 * The pills were inert `<span>`s. They are buttons now, and what they change
 * is the prompt text — black-smith has no per-session mode to switch, so a
 * control that only moved vam's own highlight would look like it worked and
 * do nothing.
 */
describe('the mode pills select, and what they select gets recorded', () => {
  const pill = (name: string) => q<HTMLButtonElement>(`[data-mode-pill="${name}"]`);

  it('writes the chosen mode into the draft as a leading line', () => {
    const seen: string[] = [];
    draw({ draft: 'ship it', onDraftChange: (next) => seen.push(next) });
    act(() => {
      pill('plan')?.click();
    });
    expect(seen).toEqual(['mode: Plan\nship it']);
  });

  it('clears the line when the default mode is chosen, rather than writing "unchanged"', () => {
    const seen: string[] = [];
    draw({ draft: 'mode: Plan\nship it', onDraftChange: (next) => seen.push(next) });
    act(() => {
      pill('auto')?.click();
    });
    expect(seen).toEqual(['ship it']);
  });

  it('shows the selection from the draft, not from a copy of it', () => {
    draw({ draft: 'mode: Manual\nship it' });
    expect(pill('manual')?.getAttribute('aria-pressed')).toBe('true');
    expect(pill('auto')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('reads Auto for a draft with no mode line at all', () => {
    draw({ draft: 'ship it' });
    expect(pill('auto')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('lets a model request and a mode request coexist', () => {
    // The hazard this pins: both readers were anchored at offset 0, so
    // whichever header was written SECOND sat on top and hid the first from
    // its own regex. Two headers is the only input that shows it.
    const both = setModeRequest(setModelRequest('ship it', 'opus'), 'Plan');
    expect(readModelRequest(both)).toBe('opus');
    expect(readModeRequest(both)).toBe('Plan');
    expect(both).toContain('ship it');
  });

  it('drops the caret that used to sit in front of the composer', () => {
    // `composing`: an empty draft on a waiting session draws the picker in
    // place of the box, and the caret question is about the box.
    draw({ draft: '', composing: true });
    const composer = q<HTMLElement>('[aria-label="prompt to session"]')?.parentElement;
    expect(composer).not.toBeNull();
    expect(composer?.textContent).not.toContain('\u276f');
  });
});

describe('the empty tabs carry no tooltip, and the other notes stay', () => {
  it('drops the tab note without touching the mode, attach or model notes', () => {
    draw();
    // NO placeholder left in the tab bar. `Agents` has a roster behind it,
    // `PRs` has `gh`, and `Terminal` -- the last one -- has the tmux provider.
    // Each became a real control as it got a source, and none of them ever
    // carried a note explaining an emptiness.
    expect(all('[data-placeholder^="tab-"]')).toHaveLength(0);
    for (const tab of all('[role="tab"]')) {
      expect(tab.closest('[data-note]')).toBeNull();
    }
    // The three the operator asked to KEEP.
    expect(q<HTMLElement>('[data-attach]')?.getAttribute('data-note')).not.toBeNull();
    expect(q<HTMLElement>('[data-model-request]')?.getAttribute('data-note')).not.toBeNull();
    expect(q<HTMLElement>('[data-mode-row] [data-note]')).not.toBeNull();
  });
});

/**
 * The Agents tab: the first tab besides `Response` with anything behind it.
 *
 * What is being pinned is mostly what it must NOT do. The pane has just had
 * several rounds of invented content removed from it, so a session with no
 * subagents gets one plain sentence -- no spinner, no fabricated row -- and an
 * agent whose meta file could not be read is still listed, saying what is
 * unknown, rather than dropped.
 */
describe('the Agents tab', () => {
  const withAgents = (agents: Session['agents']): SessionEntry => ({
    project: PROJECT,
    session: { ...SESSION, agents },
  });

  const agentsTab = () => q<HTMLButtonElement>('[data-tab="agents"]');
  const openAgents = () => {
    const button = agentsTab();
    if (button === null) throw new Error('no Agents tab to click');
    fireEvent.click(button);
  };

  it('is a real control, as every tab in the bar now is', () => {
    draw({ entry: withAgents([]) });
    expect(agentsTab()).not.toBeNull();
    expect(agentsTab()?.tagName).toBe('BUTTON');
    // `PRs` and `Terminal` have since become controls of their own, so the bar
    // holds four buttons and no inert label.
    expect(all('[role="tab"]').map((t) => t.tagName)).toEqual([
      'BUTTON',
      'BUTTON',
      'BUTTON',
      'BUTTON',
    ]);
  });

  it('starts on Response and moves the pane content when Agents is picked', () => {
    draw({ entry: withAgents([]) });
    expect(q('[data-detail-block="out"]')).not.toBeNull();
    expect(q('[data-agents]')).toBeNull();
    expect(agentsTab()?.getAttribute('aria-selected')).toBe('false');

    openAgents();

    expect(q('[data-agents]')).not.toBeNull();
    expect(q('[data-detail-block="out"]')).toBeNull();
    expect(q('[data-detail-block="in"]')).toBeNull();
    expect(agentsTab()?.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(q<HTMLButtonElement>('[data-tab="response"]') as HTMLButtonElement);
    expect(q('[data-detail-block="out"]')).not.toBeNull();
    expect(q('[data-agents]')).toBeNull();
  });

  it('says a session spawned none, with no row and nothing spinning', () => {
    draw({ entry: withAgents([]) });
    openAgents();

    expect(all('[data-agent-row]')).toHaveLength(0);
    expect(q<HTMLElement>('[data-agents-empty]')?.textContent).toContain('spawned no agents');
    expect(q('[data-agents] .vam-breathe')).toBeNull();
    expect(q('[data-agents] [data-out-running]')).toBeNull();
  });

  it('distinguishes a source that has no roster at all from a session with none', () => {
    // `agents` absent, per model.ts: black-smith reports a live count and
    // nothing about which agents they are, so "spawned none" would be a claim
    // vam cannot make.
    draw({ entry: withAgents(undefined) });
    openAgents();

    expect(all('[data-agent-row]')).toHaveLength(0);
    expect(q<HTMLElement>('[data-agents-empty]')?.textContent).not.toContain('spawned no agents');
    expect(q<HTMLElement>('[data-agents-empty]')?.textContent).toContain('does not report');
  });

  const idleToggle = () => q<HTMLButtonElement>('[data-agents-toggle]');
  const clickToggle = () => {
    const button = idleToggle();
    if (button === null) throw new Error('no idle toggle to click');
    fireEvent.click(button);
  };

  it('lists each agent with its type, its description and whether it is running', () => {
    draw({
      entry: withAgents([
        { id: 'agent-one', type: 'coder', description: 'write the parser', running: true },
        { id: 'agent-two', type: 'uiux', description: 'review the pane', running: false },
      ]),
    });
    openAgents();
    // The idle one is behind the toggle by default; revealed, the roster is
    // the whole roster, in source order.
    clickToggle();

    const rows = all('[data-agent-row]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('coder');
    expect(rows[0]?.textContent).toContain('write the parser');
    expect(rows[0]?.getAttribute('data-agent-running')).toBe('true');
    expect(rows[1]?.getAttribute('data-agent-running')).toBe('false');
  });

  it('shows only the running agents by default, hiding the finished ones', () => {
    draw({
      entry: withAgents([
        { id: 'agent-one', type: 'coder', description: 'write the parser', running: true },
        { id: 'agent-two', type: 'uiux', description: 'review the pane', running: false },
        { id: 'agent-three', type: 'planner', description: 'plan it', running: false },
      ]),
    });
    openAgents();

    const rows = all('[data-agent-row]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-agent-running')).toBe('true');
    // Hidden rows are never silently invisible: the toggle carries their count.
    expect(idleToggle()?.textContent).toContain('2');
    expect(q('[data-agents-empty]')).toBeNull();
  });

  it('reveals the idle agents when the toggle is pressed, and hides them again', () => {
    draw({
      entry: withAgents([
        { id: 'agent-one', type: 'coder', description: 'write the parser', running: true },
        { id: 'agent-two', type: 'uiux', description: 'review the pane', running: false },
      ]),
    });
    openAgents();
    expect(idleToggle()?.getAttribute('aria-pressed')).toBe('false');

    clickToggle();
    expect(all('[data-agent-row]')).toHaveLength(2);
    expect(idleToggle()?.getAttribute('aria-pressed')).toBe('true');

    clickToggle();
    expect(all('[data-agent-row]')).toHaveLength(1);
    expect(idleToggle()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('draws no toggle at all when every agent is running', () => {
    draw({
      entry: withAgents([
        { id: 'agent-one', type: 'coder', description: 'write the parser', running: true },
      ]),
    });
    openAgents();

    expect(all('[data-agent-row]')).toHaveLength(1);
    expect(idleToggle()).toBeNull();
  });

  it('says none is running -- not that none was spawned -- when all are idle', () => {
    // The third state the filter introduces. Telling an operator with twenty
    // finished agents that the session "spawned no agents" is the caption
    // outrunning the data, and the toggle that would disprove it is right
    // there.
    draw({
      entry: withAgents([
        { id: 'agent-one', type: 'coder', description: 'write the parser', running: false },
        { id: 'agent-two', type: 'uiux', description: 'review the pane', running: false },
      ]),
    });
    openAgents();

    expect(all('[data-agent-row]')).toHaveLength(0);
    const empty = q<HTMLElement>('[data-agents-empty]');
    expect(empty?.textContent).not.toContain('spawned no agents');
    expect(empty?.textContent).toContain('2');
    expect(empty?.textContent).toContain('None');
    // The way out of the state is on screen with it.
    expect(idleToggle()).not.toBeNull();
    clickToggle();
    expect(all('[data-agent-row]')).toHaveLength(2);
    expect(q('[data-agents-empty]')).toBeNull();
  });

  it('offers no toggle for the two absences, which have nothing to reveal', () => {
    draw({ entry: withAgents([]) });
    openAgents();
    expect(idleToggle()).toBeNull();

    draw({ entry: withAgents(undefined) });
    openAgents();
    expect(idleToggle()).toBeNull();
  });

  it('keeps an agent whose meta could not be read, naming what is unknown', () => {
    draw({
      entry: withAgents([{ id: 'agent-three', type: null, description: null, running: true }]),
    });
    openAgents();

    const row = all('[data-agent-row]')[0];
    expect(row).not.toBeUndefined();
    // The id and the running state are the two facts that survive an
    // unreadable meta file, and both are on screen.
    expect(row?.textContent).toContain('agent-three');
    expect(row?.textContent).toContain('unknown');
    expect(row?.getAttribute('data-agent-running')).toBe('true');
  });

  it('truncates a long description rather than widening the pane', () => {
    draw({
      entry: withAgents([
        { id: 'agent-four', type: 'coder', description: 'x'.repeat(400), running: false },
      ]),
    });
    openAgents();
    clickToggle();

    expect(q<HTMLElement>('[data-agent-description]')?.className).toContain('truncate');
  });
});

/**
 * What stands above the composer while a session is waiting.
 *
 * Three cards used to: an amber `SUGGESTED` one and two offering `↵`, with a
 * header reading "the agent is asking". Every word of that was a constant in
 * `DetailPanel.tsx`. A census of every transcript on this machine, plus the
 * CLI and `~/.claude/`, found no surface vam reads that records what a session
 * is asking or what its options are -- the file's own comment said exactly
 * that while the cards rendered anyway. Worse, `statusOf`
 * (`main/sources/claude-code/agents.ts`) maps everything that is not `busy` to
 * `waiting`, so a merely IDLE session was told an agent was asking it
 * something.
 *
 * Nothing invented takes their place. A session that asked through the
 * `AskUserQuestion` tool now gets a card built from that record
 * (`DetailPanel.questions.test.tsx`); a session that asked nothing -- the one
 * these tests draw -- gets what it always had: `Decision.output` in `out`,
 * its real final turn. So these tests are an absence and a presence: nothing
 * invented above the composer, and the real turn on screen underneath.
 *
 * The tests that stood here pinned the placeholder: that three cards rendered,
 * that the badges counted 1-3, and that clicking one wrote the card's own
 * title into the draft. They are removed rather than repointed -- there is no
 * component left to assert against, and a test for "the picker is honest about
 * being a placeholder" cannot be repointed at not drawing one.
 */
describe('a waiting session is shown its real turn, not invented options', () => {
  const withOutput = (output: string | null): Decision => ({
    id: 'd9',
    label: 'sign-off',
    input: 'ship it',
    output,
    commands: [],
  });

  it('draws no option cards, no pick hint, and no “the agent is asking” label', () => {
    // The default entry is `waiting` -- the exact state that drew the cards.
    draw();
    expect(q<HTMLElement>('[data-approval]')).toBeNull();
    expect(all('[data-approval-option]')).toHaveLength(0);
    expect(q<HTMLElement>('[data-placeholder="approval-options"]')).toBeNull();
    expect(all('[aria-label="the agent is asking"]')).toHaveLength(0);
    // Every one of these was a string literal in the source file, on screen as
    // if a session had said it.
    const pane = document.body.textContent ?? '';
    for (const invented of [
      'SUGGESTED',
      'to pick',
      'type your own instruction',
      'The option the agent leans towards',
      'A second way to go',
      'A third way to go',
      'option picker',
    ]) {
      expect(pane, invented).not.toContain(invented);
    }
  });

  it('shows the session’s own final answer as the content of the turn', () => {
    draw({ decision: withOutput('The migration ran clean; nothing is left to approve.') });
    const out = q<HTMLElement>('[data-detail-scroll="out"]')?.textContent ?? '';
    expect(out).toContain('The migration ran clean; nothing is left to approve.');
    // A real answer is not the empty-turn sentence, and never was a card.
    expect(q<HTMLElement>('[data-out-empty]')).toBeNull();
    expect(q<HTMLElement>('[data-approval]')).toBeNull();
  });

  it('keeps the existing no-answer sentences instead of falling back to invented content', () => {
    // `null`: the turn collected no answer event. Still the pane's own words.
    draw({ decision: withOutput(null) });
    expect(q<HTMLElement>('[data-out-empty]')?.textContent ?? '').toContain(
      'no answer for this turn yet',
    );
    expect(q<HTMLElement>('[data-approval]')).toBeNull();
    cleanup();
    // `''`: a turn that resolved to nothing -- the other absence, unchanged.
    draw({ decision: withOutput('') });
    expect(q<HTMLElement>('[data-out-empty]')?.textContent ?? '').toContain('resolved to nothing');
    expect(all('[data-approval-option]')).toHaveLength(0);
  });

  it('draws the prompt box while waiting, since nothing else offers a way to answer', () => {
    // Waiting, not composing, empty draft: the one case the picker used to
    // take the box's place in. With the picker gone the box must be there, or
    // a waiting session has no visible way to reply at all.
    draw();
    expect(q<HTMLElement>('[data-prompt-box]')).not.toBeNull();
  });
});

describe('the composer says what the session’s source actually does', () => {
  const claims = () => {
    const button = q<HTMLButtonElement>('[data-prompt-record]');
    return `${button?.getAttribute('aria-label')} ${button?.getAttribute('title')}`.toLowerCase();
  };

  it('says send, not record, once the source delivers into a running agent', () => {
    draw({ delivers: true, composing: true });
    expect(claims()).toContain('send');
    expect(claims()).not.toContain('record');
  });

  it('keeps the recording wording when the source only records, and when nothing said', () => {
    draw({ delivers: false, composing: true });
    expect(claims()).toContain('record');
    expect(claims()).not.toContain('send');
    cleanup();
    draw({ composing: true });
    expect(claims()).toContain('record');
    expect(claims()).not.toContain('send');
  });
});

describe('the pane’s minted surfaces are token pairs, not dark-only hexes', () => {
  it('has no --vam-lifted left, the token no rule ever consumed', () => {
    // `--vam-lifted` was minted for the option picker's unchosen cards. The
    // picker is gone, and `--color-lifted` reached no rule, component or
    // class anywhere under `src/` -- a three-line chain feeding nothing.
    // Asserted as an absence so the dead pair is not reintroduced without the
    // surface that would justify it.
    //
    // The two TOKEN names, not the bare substring. This file is mostly prose,
    // and `lifted` is an ordinary English word -- the substring form of this
    // guard fired on the comment "a path lifted out of prose" in an unrelated
    // branch, which is a false positive on a word no rule can consume. A
    // guard that bans English is a guard someone will delete.
    // `import.meta.url` is not a file URL under happy-dom, so the path is
    // resolved from the runner's own root instead.
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
    expect(css).not.toContain('--vam-lifted');
    expect(css).not.toContain('--color-lifted');
  });

  it('pins the light line-loud to the value the light artboard actually draws', () => {
    // The composer card's own border, among others. The value is read off the
    // light artboard's surfaces at that weight -- the composer card and the
    // answer pills. It was a few units too dark before, which is why it is
    // pinned here.
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
    const light = css.slice(css.indexOf('html.light {'));
    expect(light).toContain('--vam-line-loud: #c9c7c1;');
  });
});

/*
 * The `x/y` step counter and its expandable note had tests here.
 *
 * The whole row above the tabs — counter, note and age — was removed at the
 * operator's request, after the per-turn tick strip that preceded it. Nothing
 * it showed lives only there: the focused step is named at the right of the
 * title row, the turn count is the `progress` section's own counter, and the
 * age is on the sidebar card and the canvas. There is no element left to
 * assert against, so the tests go with the row rather than being rewritten
 * into assertions about its absence.
 */

/**
 * The `!` typeahead, in place of the command strip that used to stand above
 * the composer.
 *
 * WHAT CHANGED AND WHY. The pane used to draw every `!` command the agent's
 * turn proposed, always, in a strip above the prompt box -- rows the operator
 * had not asked for, occupying the composer's space on every turn that
 * mentioned a command. The operator asked for the strip to go and for the same
 * commands to arrive on demand instead: typing `!` in the prompt box opens the
 * list, and picking one writes it into the prompt.
 *
 * The extraction behind it is unchanged and unwidened
 * (`main/sources/claude-code/commands.ts`): a line beginning `!` followed by
 * whitespace and a non-space character, and nothing inferred. This is a second
 * PRESENTATION of that list, never a second rule.
 *
 * THE ENTER COLLISION IS THE LOAD-BEARING PART. Enter sends, and since the reply PR it
 * really delivers -- into a tmux pane for sessions vam started, with a CLI
 * fallback. So with the list open Enter must ACCEPT, and send nothing: an
 * Enter that both completed the word and shipped it would put a half-typed
 * command into a live session. The two outcomes are asserted as two outcomes,
 * not as two status strings.
 */
describe('the ! typeahead replaces the standing command strip', () => {
  const COMMANDS = [
    { id: 'c1', label: 'push the branch', command: 'git push -u origin work' },
    { id: 'c2', label: 'open the PR', command: 'gh pr create --fill' },
    { id: 'c3', label: 'watch CI', command: 'gh run watch' },
  ];
  const WITH_COMMANDS: Decision = {
    id: 'd9',
    label: 'sign-off',
    input: 'ship it',
    output: 'here is what to run',
    commands: COMMANDS,
  };

  /** The suggestion rows on screen, by the command text each one offers. */
  const suggested = () =>
    all('[data-bang-suggestion]').map((row) =>
      (row.querySelector('[data-bang-command]')?.textContent ?? '').trim(),
    );
  const selected = () =>
    all('[data-bang-suggestion]')
      .filter((row) => row.getAttribute('data-selected') === 'true')
      .map((row) => (row.querySelector('[data-bang-command]')?.textContent ?? '').trim());
  const box = () =>
    q<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]') as HTMLTextAreaElement;

  /**
   * The composer with its draft held in real state, because a typeahead is a
   * conversation between what is typed and what is offered: a fixed `draft`
   * prop can only ever show one frame of it.
   */
  function Composer(props: { readonly onSubmit: () => void }) {
    const [draft, setDraft] = useState('');
    return (
      <DetailPanel
        entry={ENTRY}
        decision={WITH_COMMANDS}
        draft={draft}
        onDraftChange={setDraft}
        onSubmit={props.onSubmit}
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

  /** Type `text` into the prompt box, caret at its end. */
  function type(text: string) {
    fireEvent.change(box(), { target: { value: text } });
  }

  function composer() {
    const sent: string[] = [];
    render(<Composer onSubmit={() => sent.push('sent')} />);
    return sent;
  }

  it('draws no command strip, and nothing to copy from one', () => {
    // The strip's own hooks, gone: a box the operator asked to remove that is
    // merely hidden behind a class is still there for every keyboard and
    // every screen reader that walks the DOM.
    draw({ decision: WITH_COMMANDS });
    expect(all('[data-command-copy]')).toHaveLength(0);
    expect(q('[data-commands-copy-all]')).toBeNull();
    expect(q('[data-bang-suggest]')).toBeNull();
    expect(document.body.textContent ?? '').not.toContain('gh pr create --fill');
  });

  it('offers nothing until a ! begins a line, and everything once it does', () => {
    composer();
    type('ship it');
    expect(q('[data-bang-suggest]')).toBeNull();
    type('!');
    expect(suggested()).toEqual(['git push -u origin work', 'gh pr create --fill', 'gh run watch']);
  });

  it('stays shut for a ! in the middle of a line, and opens for one starting the next', () => {
    // The extractor reads a command as a whole LINE. A `!` inside a sentence
    // is not a command anywhere else in vam, so completing one there would
    // invent a wider rule for the same glyph.
    composer();
    type('run this !');
    expect(q('[data-bang-suggest]')).toBeNull();
    type('run this\n!');
    expect(suggested()).toHaveLength(3);
  });

  it('narrows on what is typed after the !, matching label or command', () => {
    composer();
    type('!pr');
    expect(suggested()).toEqual(['gh pr create --fill']);
    type('!push');
    expect(suggested()).toEqual(['git push -u origin work']);
  });

  it('disappears when nothing matches rather than sitting there stale', () => {
    composer();
    type('!gh');
    expect(suggested()).toHaveLength(2);
    type('!ghzz');
    expect(q('[data-bang-suggest]')).toBeNull();
  });

  it('writes the picked command into the prompt, keeping the rest of the line', () => {
    composer();
    type('!pr');
    fireEvent.click(all('[data-bang-suggestion]')[0] as HTMLElement);
    expect(box().value).toBe('!gh pr create --fill');
    expect(q('[data-bang-suggest]')).toBeNull();
  });

  it('walks the list with the arrow keys, clamped at both ends', () => {
    composer();
    type('!gh');
    expect(selected()).toEqual(['gh pr create --fill']);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(selected()).toEqual(['gh run watch']);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(selected()).toEqual(['gh run watch']);
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    fireEvent.keyDown(box(), { key: 'ArrowUp' });
    expect(selected()).toEqual(['gh pr create --fill']);
  });

  it('accepts on Enter and sends nothing', () => {
    // The negative is the point. A test that only read the status line would
    // pass while the prompt went to a live session as well.
    const sent = composer();
    type('!pr');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(sent).toEqual([]);
    expect(box().value).toBe('!gh pr create --fill');
  });

  it('sends on Enter once the list is closed', () => {
    const sent = composer();
    type('ship it');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(sent).toEqual(['sent']);
  });

  it('sends on Enter after Escape dismissed the list, leaving the typed ! alone', () => {
    // Escape puts the list away and NOT the text: the operator may be typing a
    // command of their own, and deleting it would be the app overruling them.
    const sent = composer();
    type('!pr');
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(q('[data-bang-suggest]')).toBeNull();
    expect(box().value).toBe('!pr');
    expect(sent).toEqual([]);
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(sent).toEqual(['sent']);
  });

  it('keeps the composer open when Escape only dismissed the list', () => {
    // The second Escape is the one that hands the keyboard back to the
    // sidebar; the first must not, or dismissing a suggestion would cost the
    // operator their place in the prompt.
    const sent = composer();
    type('!pr');
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(box().readOnly).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe('a turn with no answer says which kind of nothing it is', () => {
  const withOutput = (output: string | null): Decision => ({
    id: 'd9',
    label: 'sign-off',
    input: 'ship it',
    output,
    commands: [],
  });
  const status = (s: Session['status']) => ({
    project: PROJECT,
    session: { ...SESSION, status: s },
  });

  it('renders an explicit line for an empty answer rather than blank space', () => {
    // `''` is a distinct state: a turn that resolved to nothing. But `'' !==
    // null`, so `OutText` ran, `splitAnswers('')` filtered every block out as
    // empty, and the operator got an `OUT` rule over blank space --
    // indistinguishable from a failed render.
    expect(splitAnswers('')).toEqual([]);
    draw({ decision: withOutput('') });
    expect(all('[data-out-line]')).toHaveLength(0);
    const note = q<HTMLElement>('[data-out-empty]');
    expect(note?.textContent ?? '').toContain('nothing');
  });

  it('says "still running" only for a session that is running', () => {
    draw({ decision: withOutput(null), entry: status('running') });
    expect(q<HTMLElement>('[data-out-empty]')?.textContent ?? '').toContain('still running');
  });

  it('tells a done or failed session the turn ended without an answer', () => {
    // `to-canvas.ts` sets `null` whenever a turn collected zero answer events,
    // whatever the status -- so a finished session was told to keep waiting
    // for something that will never arrive.
    for (const s of ['done', 'failed'] as const) {
      cleanup();
      draw({ decision: withOutput(null), entry: status(s) });
      const text = q<HTMLElement>('[data-out-empty]')?.textContent ?? '';
      expect(text, `status ${s}`).toContain('ended without an answer');
      expect(text, `status ${s}`).not.toContain('still running');
    }
  });
});

/**
 * A running session's `out` used to read exactly like a dead one's: one static
 * sentence, identical whether the agent was mid-tool-call or had quietly
 * stopped. `Session.activity` already carries what it is doing right now
 * (model.ts), so the empty `out` says that instead, and wears a blinking block
 * cursor while it is true -- a terminal's own idiom for "this line is still
 * being written", withheld from `done` and `failed` for the same reason the
 * breathing was: a live cursor on a stopped session reads as activity that is
 * not there. The cursor REPLACED the `vam-breathe` pulse this line shipped
 * with, so the assertions below check both halves: the terminal marker is
 * there and the old opacity pulse is gone, or neither is.
 *
 * `null` activity is a source that cannot say, and model.ts is explicit that
 * it must render as no line rather than as an empty spinner pretending to be
 * live -- so the sentence stays and nothing is invented in its place.
 */
describe('the out region shows live work while the session is running', () => {
  const live = () => q<HTMLElement>('[data-out-empty]');
  const running = (activity: string | null) => ({
    project: PROJECT,
    session: { ...SESSION, status: 'running' as const, activity },
  });

  const cursor = () => q<HTMLElement>('[data-out-empty] [data-out-running]');

  it('renders the activity as the running word on the turn being worked', () => {
    draw({ entry: running('editing transcript.ts') });
    expect(live()?.textContent ?? '').toContain('editing transcript.ts');
    expect(cursor()).not.toBeNull();
    // The word IS the activity: nothing invents a second one beside it.
    expect(q<HTMLElement>('[data-out-running-word]')?.textContent).toBe('editing transcript.ts');
    // One motion story, not two: the pulse this line shipped with is gone.
    expect(live()?.getAttribute('class') ?? '').not.toContain('vam-breathe');
  });

  it('leaves no blinking terminal cursor behind', () => {
    draw({ entry: running('editing transcript.ts') });
    expect(all('[data-out-cursor]')).toHaveLength(0);
    expect(document.body.innerHTML).not.toContain('vam-term-cursor');
  });

  it('hides the decorative marks from assistive tech', () => {
    draw({ entry: running('editing transcript.ts') });
    // A screen reader should read the activity, not a star and three dots.
    for (const decorative of all('[data-out-running] [aria-hidden]')) {
      expect(decorative.getAttribute('aria-hidden')).toBe('true');
    }
    expect(q('[data-out-ellipsis]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the sentence and invents no words when the source cannot say', () => {
    draw({ entry: running(null) });
    const text = live()?.textContent ?? '';
    expect(text).toContain('still running');
    expect(text.trim()).not.toBe('');
    // The cursor asserts only "running", which is still true with no activity.
    expect(cursor()).not.toBeNull();
    // Nothing invented in place of the words the source could not give.
    expect(live()?.getAttribute('class') ?? '').not.toContain('vam-breathe');
  });

  it('does not animate a session that has stopped', () => {
    for (const s of ['done', 'failed'] as const) {
      cleanup();
      draw({ entry: { project: PROJECT, session: { ...SESSION, status: s } } });
      const node = live();
      expect(node?.getAttribute('class') ?? '', `status ${s}`).not.toContain('vam-breathe');
      expect(cursor(), `status ${s}`).toBeNull();
      expect(node?.textContent ?? '', `status ${s}`).not.toContain('just now');
    }
  });

  it('does not animate an older turn of a running session', () => {
    // `decisions` is newest first, so d3 is three turns back: the activity
    // would be describing the present while the operator reads the past.
    draw({ entry: running('editing transcript.ts'), decision: DECISIONS[2] as Decision });
    expect(all('[data-out-empty]')).toHaveLength(0);
    expect(cursor()).toBeNull();
    expect(document.body.textContent ?? '').not.toContain('editing transcript.ts');
  });

  it('still says the session is working under reduced motion', () => {
    // Stopped, the ellipsis has to stay READ: all three dots at full opacity
    // after the word, which is what says "still going" without moving.
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.vam-ellipsis');
    expect(reduced).toMatch(/\.vam-ellipsis[^}]*\{[^}]*opacity:\s*1/s);
    expect(css).toContain('@keyframes vam-ellipsis');
    // The cursor it replaces is gone from the stylesheet entirely.
    expect(css).not.toContain('vam-term-cursor');
  });

  /**
   * The reference caption vam is modelled on reads
   * `Improvising... (5m 3s - 15.2k tokens - xhigh effort)`, and vam can source
   * exactly one of those clauses: `Session.age`, the compact "how long ago it
   * last did anything" the sidebar right-aligns. There is no per-session token
   * count in the model (`CanvasBudget` is the FACTORY's figure, for the whole
   * canvas) and no effort level at all, so neither is printed -- an omitted
   * clause, never a faked one.
   */
  describe('the detail beside the word is sourced or absent', () => {
    const withAge = (age: string | null) => ({
      project: PROJECT,
      session: { ...SESSION, status: 'running' as const, activity: 'editing transcript.ts', age },
    });

    it('shows the age vam has, dimmed beside the word', () => {
      draw({ entry: withAge('12m') });
      expect(q<HTMLElement>('[data-out-running-detail]')?.textContent ?? '').toContain('12m');
      expect(q<HTMLElement>('[data-out-running-detail]')?.getAttribute('class') ?? '').toContain(
        'text-ink-faint',
      );
    });

    it('omits the clause rather than faking one when the source cannot say', () => {
      draw({ entry: withAge(null) });
      expect(all('[data-out-running-detail]')).toHaveLength(0);
      // Still a running word: the caption degrades to the word alone.
      expect(q<HTMLElement>('[data-out-running-word]')?.textContent).toBe('editing transcript.ts');
    });

    it('claims no tokens and no effort, which vam cannot source', () => {
      draw({ entry: withAge('12m') });
      const text = q<HTMLElement>('[data-out-running]')?.textContent ?? '';
      expect(text).not.toContain('token');
      expect(text).not.toContain('effort');
      expect(text).not.toMatch(/\b0\b/);
    });
  });
});

/**
 * The live line is about the session's state; the answer is about what it has
 * said. They are not alternatives, and the pane used to treat them as one: the
 * activity line lived in the `else` of `output === null || output === ''`, so
 * it could only ever be seen by a turn with no answer. `transcript.ts` writes
 * `turns[last].output` on every assistant text, so a running session has a
 * non-empty answer within seconds and the live line was gone for the rest of
 * the run -- the operator's report was that it never appeared at all.
 *
 * So the line is rendered whenever the turn is live, under the answer: what it
 * has said, then what it is doing now. Every guard from the original work
 * holds -- newest turn AND `running`, a null `activity` invents no words, a
 * stopped session gets no motion -- and the empty-answer case must still print
 * exactly one line, not the sentence twice.
 */
describe('the live line stands beside the answer, not instead of it', () => {
  const ANSWER = 'The migration ran clean; nothing is left to approve.';
  const turn = (output: string | null): Decision => ({
    id: 'd5',
    label: 'sign-off',
    input: 'ship it',
    output,
    commands: [],
  });
  // `decision` is the newest turn (`d5`), so the pane's live test can pass.
  const show = (
    output: string | null,
    activity: string | null = 'editing transcript.ts',
    status: Session['status'] = 'running',
  ) =>
    draw({
      entry: { project: PROJECT, session: { ...SESSION, status, activity } },
      decision: turn(output),
    });
  const liveLine = () => q<HTMLElement>('[data-out-live]');
  const cursor = () => q<HTMLElement>('[data-out-live] [data-out-running]');

  it('shows the answer AND the live line while a running turn has output', () => {
    show(ANSWER);
    const out = q<HTMLElement>('[data-detail-scroll="out"]')?.textContent ?? '';
    expect(out).toContain(ANSWER);
    expect(liveLine()?.textContent ?? '').toContain('editing transcript.ts');
    expect(cursor()).not.toBeNull();
    expect(q('[data-out-live] [data-out-ellipsis]')).not.toBeNull();
  });

  it('puts the live line after the answer, not above it', () => {
    show(ANSWER);
    const scroll = q<HTMLElement>('[data-detail-scroll="out"]') as HTMLElement;
    const line = liveLine() as HTMLElement;
    const answer = all('[data-out-line]')[0] as Element;
    expect(scroll.contains(line)).toBe(true);
    // `DOCUMENT_POSITION_FOLLOWING` (4): the line comes after the answer.
    expect(answer.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(4);
  });

  it('still shows the live line when the answer is empty, and shows it once', () => {
    for (const empty of [null, ''] as const) {
      cleanup();
      show(empty);
      expect(all('[data-out-live]'), `output ${JSON.stringify(empty)}`).toHaveLength(1);
      expect(liveLine()?.textContent ?? '', `output ${JSON.stringify(empty)}`).toContain(
        'editing transcript.ts',
      );
      // The sentence must not print alongside the words that replaced it.
      expect(all('[data-out-running]'), `output ${JSON.stringify(empty)}`).toHaveLength(1);
    }
  });

  it('says the session is running, and no more, when the source cannot say', () => {
    show(ANSWER, null);
    const text = liveLine()?.textContent ?? '';
    expect(text).toContain('still running');
    // There IS an answer on screen, so the empty-turn wording would be a lie.
    expect(text).not.toContain('no answer');
    expect(text.trim()).not.toBe('');
    expect(cursor()).not.toBeNull();
  });

  it('leaves no live line on a session that has stopped', () => {
    for (const s of ['done', 'failed', 'waiting'] as const) {
      cleanup();
      show(ANSWER, 'editing transcript.ts', s);
      expect(all('[data-out-live]'), `status ${s}`).toHaveLength(0);
      expect(all('[data-out-running]'), `status ${s}`).toHaveLength(0);
      // Scoped to the body: the `out` rule's meta carries the session's
      // current activity on the newest turn whatever its status, and that
      // caption is not what this test is about.
      const body = q<HTMLElement>('[data-detail-scroll="out"]')?.textContent ?? '';
      expect(body, `status ${s}`).not.toContain('editing transcript.ts');
      expect(body, `status ${s}`).toContain('The migration ran clean');
    }
  });

  it('leaves no live line on an older turn of a running session', () => {
    draw({
      entry: {
        project: PROJECT,
        session: { ...SESSION, status: 'running', activity: 'editing transcript.ts' },
      },
      decision: DECISIONS[2] as Decision,
    });
    expect(all('[data-out-live]')).toHaveLength(0);
    expect(all('[data-out-running]')).toHaveLength(0);
    expect(document.body.textContent ?? '').not.toContain('editing transcript.ts');
  });
});

/**
 * The PRs tab: vam's first surface for something it went to the network to
 * find out, on the operator's behalf and with the operator's credentials.
 *
 * What is pinned here is mostly the same thing the module underneath pins:
 * "this branch has no pull request" and "vam could not ask" must not look
 * alike. A pane that renders a failure as an empty list would be telling the
 * operator there is nothing to see, on the strength of never having found
 * out. Every fixture below is invented.
 */
describe('the PRs tab', () => {
  const withPrs = (pullRequests: Session['pullRequests']): SessionEntry => ({
    project: PROJECT,
    session: { ...SESSION, ...(pullRequests === undefined ? {} : { pullRequests }) },
  });

  const prsTab = () => q<HTMLButtonElement>('[data-tab="prs"]');
  const openPrs = () => {
    const button = prsTab();
    if (button === null) throw new Error('no PRs tab to click');
    fireEvent.click(button);
  };
  const body = () => q<HTMLElement>('[data-prs]')?.textContent ?? '';

  const POPULATED: Session['pullRequests'] = {
    kind: 'ok',
    prs: [
      {
        number: 128,
        title:
          'Rework the detail pane so a narrow column stays readable end to end, however long the branch name grows',
        state: 'open',
        checks: 'failing',
      },
      { number: 121, title: 'Spike the roster reader', state: 'draft', checks: 'pending' },
      { number: 97, title: 'Carry the branch to the sidebar', state: 'merged', checks: 'passing' },
    ],
  };

  it('is a real control now, and no tab in the bar is a placeholder any more', () => {
    draw({ entry: withPrs({ kind: 'ok', prs: [] }) });
    expect(prsTab()).not.toBeNull();
    expect(prsTab()?.tagName).toBe('BUTTON');
    expect(all('[data-placeholder^="tab-"]')).toHaveLength(0);
  });

  it('moves the pane content when picked, and gives it back to Response', () => {
    draw({ entry: withPrs({ kind: 'ok', prs: [] }) });
    expect(q('[data-prs]')).toBeNull();
    expect(prsTab()?.getAttribute('aria-selected')).toBe('false');

    openPrs();

    expect(q('[data-prs]')).not.toBeNull();
    expect(q('[data-detail-block="out"]')).toBeNull();
    expect(q('[data-agents]')).toBeNull();
    expect(prsTab()?.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(q<HTMLButtonElement>('[data-tab="response"]') as HTMLButtonElement);
    expect(q('[data-prs]')).toBeNull();
    expect(q('[data-detail-block="out"]')).not.toBeNull();
  });

  it('says the branch has none only when vam actually asked and GitHub said none', () => {
    draw({ entry: withPrs({ kind: 'ok', prs: [] }) });
    openPrs();

    expect(all('[data-pr-row]')).toHaveLength(0);
    expect(q('[data-prs-empty]')).not.toBeNull();
    expect(q('[data-prs-unavailable]')).toBeNull();
    expect(body()).toContain('no pull request');
  });

  it('says vam could not ask, in gh’s own terms, and never calls that "none"', () => {
    for (const [code, message] of [
      ['cli-missing', 'the `gh` command was not found'],
      ['not-authenticated', '`gh` is installed but not authenticated'],
      ['not-a-repo', 'not a git repository'],
      ['no-github-remote', 'no GitHub remote'],
      ['timed-out', 'GitHub did not answer'],
      ['bad-response', 'gh answered with something that was not JSON'],
      ['branch-unknown', 'could not tell which branch'],
    ] as const) {
      cleanup();
      draw({ entry: withPrs({ kind: 'unavailable', code, message }) });
      openPrs();

      expect(all('[data-pr-row]'), code).toHaveLength(0);
      expect(q('[data-prs-empty]'), code).toBeNull();
      // The reason travels verbatim: the operator can only fix `gh auth login`
      // if the pane says that is what is wrong.
      expect(body(), code).toContain(message);
      expect(q('[data-prs-unavailable]')?.getAttribute('data-prs-code'), code).toBe(code);
      expect(body(), code).not.toContain('no pull request');
    }
  });

  it('distinguishes a source that cannot ask at all from one that asked and found none', () => {
    draw({ entry: withPrs(undefined) });
    openPrs();

    expect(all('[data-pr-row]')).toHaveLength(0);
    expect(q('[data-prs-absent]')).not.toBeNull();
    expect(body()).not.toContain('no pull request');
    expect(body()).toContain('does not report');
  });

  it('lists each pull request with its number, title, state and checks', () => {
    draw({ entry: withPrs(POPULATED) });
    openPrs();

    const rows = all('[data-pr-row]');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.getAttribute('data-pr-state'))).toEqual(['open', 'draft', 'merged']);
    expect(rows.map((r) => r.getAttribute('data-pr-checks'))).toEqual([
      'failing',
      'pending',
      'passing',
    ]);
    expect(rows[0]?.querySelector('[data-pr-number]')?.textContent).toContain('128');
    expect(rows[2]?.querySelector('[data-pr-title]')?.textContent).toBe(
      'Carry the branch to the sidebar',
    );
    // Each check verdict is drawn with its own token, so failing and passing
    // can never arrive at the operator as the same colour.
    const checkClass = (i: number) =>
      rows[i]?.querySelector('[data-pr-checks-mark]')?.getAttribute('class') ?? '';
    expect(checkClass(0)).toContain('failed');
    expect(checkClass(2)).toContain('running');
    expect(checkClass(0)).not.toBe(checkClass(1));
  });

  it('truncates a long title rather than widening the pane', () => {
    draw({ entry: withPrs(POPULATED) });
    openPrs();
    const title = all('[data-pr-row]')[0]?.querySelector('[data-pr-title]');
    expect(title?.getAttribute('class')).toContain('truncate');
    // Truncation is visual, so the full title stays in the DOM for anything
    // that reads rather than looks.
    expect(title?.textContent).toBe(POPULATED?.kind === 'ok' ? POPULATED.prs[0]?.title : '');
  });
});

/**
 * The Terminal tab's laziness, which is an operator requirement and not an
 * optimisation: the tab loads only when it is opened.
 *
 * Asserted from the pane rather than from the component, because the pane is
 * where the decision is: the tab's content is mounted by one branch of one
 * ternary, so "closed" has to mean the component does not exist -- not that it
 * exists and skips its work. A `display:none` tab is still a tab, still
 * mounted, and still holding an interval that spawns `tmux capture-pane` every
 * second for a session nobody is looking at.
 */
describe('the Terminal tab costs nothing until it is opened', () => {
  const withBridge = (read: (title: string) => Promise<PaneView>) => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { terminal: { read } },
    });
  };

  afterEach(() => {
    Reflect.deleteProperty(window, 'api');
  });

  it('issues no read at all while another tab is showing', async () => {
    const read = vi.fn(async (): Promise<PaneView> => ({ kind: 'not-vam' }));
    withBridge(read);

    // Response, then every other tab that is not Terminal. None of them may
    // reach tmux.
    draw();
    fireEvent.click(q<HTMLButtonElement>('[data-tab="agents"]') as HTMLButtonElement);
    fireEvent.click(q<HTMLButtonElement>('[data-tab="prs"]') as HTMLButtonElement);
    await act(async () => {
      await Promise.resolve();
    });

    expect(read).toHaveBeenCalledTimes(0);
    expect(q('[data-terminal]')).toBeNull();
  });

  it('reads once the tab is opened, for the focused session, and stops when it is left', async () => {
    const read = vi.fn(
      async (): Promise<PaneView> => ({
        kind: 'ok',
        name: 'vam-sprint-board-reorder-a1b2c3',
        text: 'the pane',
      }),
    );
    withBridge(read);
    draw();

    await act(async () => {
      fireEvent.click(q<HTMLButtonElement>('[data-tab="terminal"]') as HTMLButtonElement);
      await Promise.resolve();
    });
    // BY PROJECT ID AND ROW, never by the session title. The project alone
    // cannot answer for a project vam started two sessions in -- both panes
    // are its own -- so the row travels with it and main pairs against the
    // pane that session published. A title was slugged and truncated on the
    // way in and matched nothing that was ever created.
    expect(read).toHaveBeenCalledWith(PROJECT.id, SESSION.id);
    expect(q<HTMLElement>('[data-terminal-pane]')?.textContent).toContain('the pane');

    const whileOpen = read.mock.calls.length;
    fireEvent.click(q<HTMLButtonElement>('[data-tab="response"]') as HTMLButtonElement);
    await act(async () => {
      await Promise.resolve();
    });
    // Unmounted, so the interval is cleared with it: leaving the tab stops the
    // spawning, exactly as closing it never started any.
    expect(q('[data-terminal]')).toBeNull();
    expect(read).toHaveBeenCalledTimes(whileOpen);
  });
});

/**
 * `capabilities.terminal` was declared and then read by nothing, while the tab
 * was mounted unconditionally -- a flag that could be flipped either way with
 * no visible effect, which is worse than no flag.
 */
describe('the Terminal tab is offered only by a source that has one', () => {
  it('drops the tab entirely for a source that says it has no terminal', () => {
    draw({ terminal: false });
    expect(q('[data-tab="terminal"]')).toBeNull();
    expect(all('[role="tab"]').map((t) => t.getAttribute('data-tab'))).not.toContain('terminal');
  });

  it('keeps it for a source that has one', () => {
    draw({ terminal: true });
    expect(q('[data-tab="terminal"]')).not.toBeNull();
  });

  it('falls back to Response when the showing tab is withdrawn', () => {
    // Reachable: the operator opens Terminal, then focus moves to a session
    // from a source without one. A tab bar with nothing selected and a pane
    // drawing a withdrawn tab is the state this prevents.
    const { rerender } = drawFor({ terminal: true });
    fireEvent.click(q<HTMLButtonElement>('[data-tab="terminal"]') as HTMLButtonElement);
    expect(q('[data-terminal]')).not.toBeNull();
    rerender({ terminal: false });
    expect(q('[data-terminal]')).toBeNull();
    expect(q<HTMLElement>('[data-tab="response"]')?.getAttribute('aria-selected')).toBe('true');
  });
});

/**
 * The composer belongs to the Response tab, and to no other.
 *
 * A terminal pane is not something you answer through the prompt box: the box
 * DELIVERS now -- Enter on it sends a real reply into the session -- so leaving
 * it under a screenful of tmux output invites sending a prompt to the place it
 * was not meant for, with nothing on screen to say so. The whole footer goes,
 * not only the textarea: the mode row and the `!` typeahead write into that
 * same draft, and a mode pill above a terminal is a control with nothing to
 * act on.
 */
describe('the composer is hidden while the Terminal tab is open', () => {
  const withBridge = () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        terminal: {
          read: async (): Promise<PaneView> => ({ kind: 'not-vam' }),
          resize: async () => false,
        },
      },
    });
  };

  afterEach(() => {
    Reflect.deleteProperty(window, 'api');
  });

  const openTerminal = () =>
    fireEvent.click(q<HTMLButtonElement>('[data-tab="terminal"]') as HTMLButtonElement);

  it('draws the prompt box, the mode row and the attach button on Response', () => {
    withBridge();
    draw();
    expect(q('[data-prompt-box]')).not.toBeNull();
    expect(q('[data-mode-row]')).not.toBeNull();
    expect(q('[data-attach]')).not.toBeNull();
    expect(q('[data-model-request]')).not.toBeNull();
  });

  it('removes every one of them on Terminal, rather than hiding them with a style', async () => {
    // REMOVED, not `display:none`. A composer that is still in the document is
    // still reachable by Tab and still submits on Enter, which is the exact
    // accident this prevents.
    withBridge();
    draw();
    await act(async () => {
      openTerminal();
      await Promise.resolve();
    });
    expect(q('[data-terminal]')).not.toBeNull();
    expect(q('[data-prompt-box]')).toBeNull();
    expect(q('[data-mode-row]')).toBeNull();
    expect(q('[data-attach]')).toBeNull();
    expect(q('[data-model-request]')).toBeNull();
    expect(q('textarea')).toBeNull();
  });

  it('brings it back on the way out, with the draft untouched', async () => {
    withBridge();
    draw({ draft: 'half a sentence' });
    await act(async () => {
      openTerminal();
      await Promise.resolve();
    });
    fireEvent.click(q<HTMLButtonElement>('[data-tab="response"]') as HTMLButtonElement);
    // The draft lives above this pane, so leaving the tab cannot have eaten
    // it: hiding the box may not cost the operator what they had typed.
    expect(q<HTMLTextAreaElement>('textarea')?.value).toBe('half a sentence');
  });

  it('keeps the composer on the other tabs, which are still about the answer', () => {
    // Only Terminal. PRs and Agents are read alongside a reply being written,
    // and nothing about them makes the prompt box the wrong place to type.
    withBridge();
    draw();
    fireEvent.click(q<HTMLButtonElement>('[data-tab="prs"]') as HTMLButtonElement);
    expect(q('[data-prompt-box]')).not.toBeNull();
    fireEvent.click(q<HTMLButtonElement>('[data-tab="agents"]') as HTMLButtonElement);
    expect(q('[data-prompt-box]')).not.toBeNull();
/** The `out` text size is a pref, put on the document root and consumed as
 *  the ROOT of `out`'s `em` scale (`out-font-size.test.tsx` pins the scale).
 *  What matters here is that exactly one element reads it: a second would make
 *  part of `out` scale twice, and none would make the setting inert. */
describe('the out text size roots on the out container and nowhere else', () => {
  it('is worn by the out scroll container alone', () => {
    draw();
    const wearing = all('*').filter((el) => el.className.toString().includes(OUT_FONT_SIZE_VAR));
    expect(wearing).toHaveLength(1);
    expect(wearing[0]?.getAttribute('data-detail-scroll')).toBe('out');
    // The pane above `out` keeps the sizes it was drawn with.
    expect(q('[data-detail-block="in"]')?.className ?? '').not.toContain(OUT_FONT_SIZE_VAR);
  });
});
