// @vitest-environment happy-dom

/**
 * The right-hand detail pane: what it collapses, what it colours, and what it
 * refuses to claim.
 *
 * Every assertion here is one of five operator requests read off the ADE
 * mockup's right pane (artboards 1a/1b, the `width:408px` column). The one that
 * is NOT a fidelity question is the composer's button: the mockup draws a send
 * arrow, factory has no channel into a running agent session, and the whole
 * point of the tests below is that the button says `record` in every place a
 * reader or a screen reader can find it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// The real parser, not a hand-picked id -- see "a selected historical turn
// survives a poll" below for why this crosses from a renderer test into
// `main/`: `test/canvas/Canvas.new-project.test.tsx` already does the same
// for `whyNotARepository`, which is the precedent this follows.
import { summarizeTranscript } from '../../src/main/sources/claude-code/transcript.js';
import type { Command, Decision, Project, Session } from '../../src/renderer/domain/model.js';
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
import {
  DEFAULT_PROMPT_SUBMIT_KEY,
  setActivePromptSubmitKey,
} from '../../src/renderer/prefs/submit-key.js';
import type { PaneSendResult, PaneView } from '../../src/shared/terminal.js';

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
  // A session VAM STARTED -- the ordinary case for this pane, and the one the
  // mode row exists for. On the shared fixture rather than on the tests that
  // care, because the tests that pin the row's ABSENCE are the ones that say
  // so, by taking the flag away.
  vamControlled: true,
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ENTRY: SessionEntry = { project: PROJECT, session: SESSION };

/**
 * RETIRED (A12.2): `describe('the pane header names the session status it
 * actually has', ...)` — three cases ("paints each of the four statuses with
 * its own token", "breathes only for the status that is asking for
 * something", "shows no status colour at all when no session is selected").
 *
 * The header, and the `[data-pane-status]` dot it drew, are gone. This pane
 * no longer has a status channel of its own to test — `SessionList.tsx`'s own
 * `STATUS_DOT` (unchanged by this commit) is the map that used to be
 * duplicated here, per the removed constant's own doc ("the same tokens, so
 * the two panes cannot disagree"); this file does not re-assert a fact that
 * was never this pane's to own. What is genuinely new here — whether the
 * turn on screen is still being worked — is the `out` rule's `outIsLive`,
 * covered at length below ("the out region shows live work while the
 * session is running", "the live line stands beside the answer").
 * The third case was already vacuous before this change: `dotClass()`
 * returns `''` for a missing element exactly as it does for a colourless
 * one, so "shows no status colour" was passing whether or not the dot
 * existed at all — it proved nothing, on its own terms, well before this
 * commit removed the element it was written against.
 */

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
 * TWO OUTCOMES MUST NOT SHARE A FACE.
 *
 * `main/sources/claude-code/deliver.ts` runs `claude --resume <id> -p
 * "<prompt>"` and genuinely appends a turn to a running session; the factory
 * source appends to a log nothing reads back. "Sent to the agent" and "filed
 * for later" are different things to have done, and the button painted one
 * `ArrowUp` for both -- the whole distinction lived in an `aria-label` and a
 * native `title`, neither of which is on screen.
 *
 * MOUNTED HERE RATHER THAN MEASURED IN A BROWSER, and that split is the
 * point: `?demo=1` is a `'demo'` source, so `delivers` is false on every row
 * a Playwright run can reach and only one of these two faces is ever painted
 * there. `e2e/composer-bar-shots.mjs` holds everything that needs layout,
 * focus or paint (the word has a box, the name contains it, the `title` is
 * gone, Tab opens the tip); this holds the PAIRING, which is a pure
 * prop-driven render with no layout in it.
 */
describe('the composer submit paints which outcome it will produce', () => {
  const submit = () => document.querySelector('[data-prompt-record]');
  /** The glyph's own identity, whatever lucide happens to call it. */
  const glyph = () => submit()?.querySelector('svg')?.getAttribute('class') ?? null;
  const word = () => (submit()?.textContent ?? '').trim();

  it('says one thing for a source that delivers and another for one that records', () => {
    draw({ draft: 'ship it', delivers: true });
    const delivering = { word: word(), glyph: glyph(), name: submit()?.getAttribute('aria-label') };
    // `render` APPENDS a container; without this the second panel is mounted
    // beside the first and every `document.querySelector` below reads the
    // one already measured -- which is how a comparison passes against
    // itself.
    cleanup();
    draw({ draft: 'ship it', delivers: false });
    const recording = { word: word(), glyph: glyph(), name: submit()?.getAttribute('aria-label') };

    // FIRST, THAT THERE IS ANYTHING TO COMPARE. Both halves of every check
    // below are relative, and two nulls are equal to each other forever --
    // which is how a guard passes on an absence.
    expect(delivering.glyph).not.toBeNull();
    expect(recording.glyph).not.toBeNull();
    expect(delivering.name).not.toBe('');
    expect(recording.name).not.toBe('');

    // THE WORD IS GONE AND THE DISTINCTION IS NOT. Operator: "drop the Send
    // label from the button, the icon is enough." What carried the
    // delivers/records difference was the word, so with the word gone this is
    // the assertion that keeps the difference somewhere: a different GLYPH,
    // and a different accessible NAME. Which icon is a design choice and is
    // not asserted; that the two do not share one is the claim.
    expect(delivering.word).toBe('');
    expect(recording.word).toBe('');
    expect(delivering.glyph).not.toBe(recording.glyph);
    expect(delivering.name).not.toBe(recording.name);
    expect({ delivering: delivering.name, recording: recording.name }).toEqual({
      delivering: 'send prompt',
      recording: 'record prompt',
    });
  });

  it('names the act in every state, now that nothing is painted to read', () => {
    // WCAG 2.5.3 (label in name) STOPS APPLYING when there is no visible
    // label, and what replaces it is 1.1.1: an icon-only control has to carry
    // its own name, in every state -- including mid-flight, which is the
    // pairing that went wrong first when the in-flight wording was last
    // edited, and the reason both states are still read here.
    for (const delivers of [true, false]) {
      for (const sending of [true, false]) {
        cleanup();
        draw({ draft: 'ship it', delivers, sending });
        const name = submit()?.getAttribute('aria-label') ?? '';
        const where = `delivers=${delivers} sending=${sending}`;
        expect(name, where).not.toBe('');
        expect(name.toLowerCase(), where).toContain(delivers ? 'send' : 'record');
        // And nothing is painted inside it but the glyph.
        expect(word(), where).toBe('');
        expect(submit()?.querySelectorAll('svg').length, where).toBe(1);
      }
    }
  });

  it('carries no native `title` — the tooltip no keyboard can open', () => {
    // The sentence moved into `Note`, which opens on focus. A `title` left
    // beside it would announce the same string a second time and go on being
    // unopenable from the keyboard.
    draw({ draft: 'ship it', delivers: true });
    expect(submit()?.hasAttribute('title')).toBe(false);
    expect(submit()?.getAttribute('data-note')).toMatch(/running agent session/i);
    cleanup();
    draw({ draft: 'ship it', delivers: false });
    expect(submit()?.hasAttribute('title')).toBe(false);
    expect(submit()?.getAttribute('data-note')).toMatch(/log/i);
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
  // The three rules are gone (`DetailPanel.transcript-flow.test.tsx`), and so
  // now is the identity line their `in` half moved onto -- the operator asked
  // for that too. The PROPERTY is untouched and is what this reads: a
  // session-level fact must not be captioned as a turn-level one. So the
  // whole `in` block is the subject now, and `out`'s meta is still read off
  // the condensed progress line.
  const inBlock = () => q<HTMLElement>('[data-detail-block="in"]')?.textContent ?? '';
  /**
   * THE ACTIVITY ON THE TURN THE PANE IS MARKING. The column draws every turn
   * and the NEWEST one carries the activity whatever the pane is marking, so
   * an unqualified lookup would find that line and report the present tense on
   * a case about reading the past.
   */
  const activity = () =>
    q<HTMLElement>('[data-column-turn][data-turn-current="true"] [data-progress-activity]')
      ?.textContent ?? '';

  it('the in block claims no per-turn time, and no longer says who', () => {
    draw({ entry: ENTRY, decision: DECISIONS[2] as Decision });
    // 12m is SESSION.age. It must not appear against a turn three back.
    expect(inBlock()).not.toContain('12m');
    expect(q('[data-detail-identity]')).toBeNull();
  });

  it('the progress line shows current activity only on the turn being worked', () => {
    // Newest turn of a running session: the activity genuinely belongs to it.
    cleanup();
    draw({
      entry: { project: PROJECT, session: { ...SESSION, status: 'running' } },
      decision: DECISIONS[0] as Decision,
    });
    expect(activity()).toContain('just now');

    // An older turn: the same activity line would be describing the present
    // while the operator reads the past.
    cleanup();
    draw({
      entry: { project: PROJECT, session: { ...SESSION, status: 'running' } },
      decision: DECISIONS[2] as Decision,
    });
    expect(activity()).not.toContain('just now');
  });

  it('never claims a session that does not exist has no steps', () => {
    // With nothing focused the pane read "This session has no steps yet",
    // which names a session that does not exist. That is still refused.
    draw({ entry: null, decision: null });
    expect(document.body.textContent ?? '').not.toContain('This session has no steps yet');
  });

  it('leaves the sentence to the tab strip on a desktop pane, and says it on a phone', () => {
    // Audit F9: the empty pane stacked "no sessions open — pick one from the
    // sidebar" (the strip, always drawn above a desktop pane) and "No session
    // selected — pick one in the sidebar." (here) 40px apart in otherwise
    // empty space. One sentence, said once, by the surface that is always
    // there. A PHONE has no tab strip, so there this is that surface.
    draw({ entry: null, decision: null });
    expect(document.body.textContent ?? '').not.toMatch(/no session selected/i);
    cleanup();
    draw({ entry: null, decision: null, phone: true });
    expect(document.body.textContent ?? '').toMatch(/no session selected/i);
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

/**
 * THE PANE DRAWS THE SESSION, NOT THE `decision` PROP -- so a fixture whose two
 * halves disagree describes nothing.
 *
 * The pane used to render whichever single turn `decision` pointed at, which
 * let a case hand it a turn that was not in `entry.session.decisions` at all
 * and still see it on screen. It is a column of every turn the SESSION carries
 * now (`Canvas.tsx` builds `decision` out of that same list, so the two never
 * disagree in the app), and such a fixture would draw seven turns that have
 * nothing to do with the assertion below it.
 *
 * So the two are reconciled here, once, rather than in thirty cases: a
 * `decision` the entry already carries is left alone -- that is a case about
 * WHICH of several turns is picked, and the seven-turn fixture is the whole
 * point of it -- and an ad-hoc one becomes the session's only turn, which is
 * what a case about how one turn RENDERS meant all along. A caller that passes
 * its own `entry` has said what it wants and is never touched.
 */
function reconcile(over: Partial<DetailPanelProps>): Partial<DetailPanelProps> {
  const picked = over.decision;
  if (picked === undefined || picked === null) return over;
  if ('entry' in over) return over;
  // BY IDENTITY, not by id. The shared fixture's newest turn IS `d5`, so an
  // id test would leave `{ id: 'd5', output: '## heading' }` sitting beside a
  // seven-turn session that carries a DIFFERENT d5 -- the fixture disagreeing
  // with itself in the one way that is invisible from the assertion.
  if (ENTRY.session.decisions.includes(picked)) return over;
  return { ...over, entry: { ...ENTRY, session: { ...ENTRY.session, decisions: [picked] } } };
}

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
    ...reconcile(over),
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
    ...reconcile({ ...over, ...extra }),
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
/**
 * THE PICKER IS GONE, THE PICK IS NOT — and these three helpers are where
 * that distinction lives for this whole file.
 *
 * A12.2 collapsed `progress` from a toggle-and-list into a single `<select>`;
 * the operator has now had the bar that `<select>` sat in removed altogether
 * (`DetailPanel.tsx`), because the pane draws EVERY turn and a jump-to-turn
 * control is a second way to do what the scrollbar does. So there is no
 * in-pane control to drive any more.
 *
 * What survives is the model the control drove: `selectedId`/`markedId`, which
 * the CANVAS's step focus moves. `navigateTo` is that door -- a new
 * `focusNodeId` alongside the turn the canvas landed on, exactly what
 * `Canvas.tsx` hands over when `h`/`l` walks onto a step. `markedTurnId` and
 * `turnLabels` read the same facts off the column, which is where they are
 * painted now: `data-turn-current` on the turn being read, and one
 * `[data-progress-turn-label]` per turn, oldest first -- the ordering the
 * options had.
 */
type PanelView = { readonly rerender: (extra: Partial<DetailPanelProps>) => void };
/**
 * PUT THE PANEL ON AN OLDER TURN, THE WAY THE RUNNING APP DOES.
 *
 * There is no control to click any more, and there does not need to be.
 * `Canvas.tsx` hands this panel `decisions[0]` as the canvas's pick and the
 * pane's SESSION as `focusNodeId`, so the turn the panel considers itself to
 * be reading is whichever was newest WHEN THE PANE ARRIVED -- and it stays
 * there as later turns land, because `focusNodeId` does not change and nothing
 * tells the panel to follow. That is the state every case below wants.
 *
 * So: land on the session as it was when `index` turns ago was the newest one,
 * then let the turns that have arrived since arrive. `index` counts from the
 * newest end, the order `decisions` is in.
 */
function arriveOn(view: PanelView, entry: SessionEntry, index: number) {
  const asOfThen = entry.session.decisions.slice(index);
  const focusNodeId = entry.session.id;
  act(() =>
    view.rerender({
      entry: { ...entry, session: { ...entry.session, decisions: asOfThen } },
      decision: asOfThen[0] as Decision,
      focusNodeId,
    }),
  );
  act(() =>
    view.rerender({ entry, decision: entry.session.decisions[0] as Decision, focusNodeId }),
  );
}
const markedTurnId = () =>
  q<HTMLElement>('[data-column-turn][data-turn-current="true"]')?.getAttribute(
    'data-column-turn',
  ) ?? null;
const turnLabels = () =>
  all('[data-column-turn] [data-progress-turn-label]').map((el) => el.textContent);

afterEach(cleanup);

describe('the progress region is a single step, not a list of rows (A12.2)', () => {
  // Seven turns, so "the newest five" and "all of them" are different lists.
  const MANY = ['d7', 'd6', 'd5', 'd4', 'd3', 'd2', 'd1'].map((id) => decision(id));
  const manyEntry: SessionEntry = {
    project: PROJECT,
    session: { ...SESSION, decisions: MANY },
  };

  /**
   * RETIRED TWICE, and the subject outlived both shapes.
   *
   * First it was `'draws no turn collapsed, every turn expanded, and says
   * which it is'` — a toggle and a `<ul>` of rows. A12.2 collapsed that into
   * a single `<select>` and this case was rewritten against it. The
   * `<select>` has now gone too, with the column's bar: every turn is DRAWN,
   * so a control listing them is a second way to reach what is already on
   * screen.
   *
   * The facts underneath never changed — all seven turns reachable, oldest
   * first, the newest one included, and the pane saying which one it is
   * reading — so the case follows them onto the column itself.
   */
  it('draws every turn, oldest first, and marks the one being read', () => {
    draw({ entry: manyEntry, decision: MANY[0] as Decision });
    // No list of rows and no picker exists at all: the column IS the list.
    expect(all('[data-progress-turn]')).toHaveLength(0);
    expect(all('[data-progress-jump]')).toHaveLength(0);
    expect(progress()?.querySelector('ul')).toBeNull();
    // ALL SEVEN, not the newest five: `PROGRESS_LINES` used to slice the
    // data itself at the parser, which was the defect this whole change
    // fixes. The oldest turn (d1) has to be REACHABLE, or the fix one file
    // over bought nothing an operator can actually use. Oldest first, same
    // ordering the old list used.
    const labels = turnLabels();
    expect(labels).toHaveLength(7);
    expect(labels[0]).toContain('step d1');
    expect(labels[6]).toContain('step d7');
    // The canvas's own pick (the newest turn) is the one marked.
    expect(markedTurnId()).toBe('d7');
  });

  /**
   * RETIRED: `'keeps the three-region structure the pane already earned'`
   * — it asserted `toggle()?.tagName === 'BUTTON'` and that the OPENED list
   * carried its own `overflow-y-auto` scroller. Neither survives: there is
   * no toggle button any more (a `<select>` is the whole control, native
   * and unstyled by this file), and there is no separate scroller for
   * `progress` either — it is a flow child of the merged column now (see
   * `describe('`in` still caps its own text, ...')` above for that
   * region's own coverage). The one fact worth restating here is that
   * `progress` is still `flex-none`: it must not stretch to fill the
   * column the way `out` is allowed to.
   */
  it('is still flex-none — it does not stretch to fill the column', () => {
    draw();
    expect(progress()?.className).toContain('flex-none');
  });

  /**
   * FOLLOWED TO THE CONTROL THAT IS LEFT. This case pinned that the region's
   * one control was a real, labelled, keyboard-reachable element rather than
   * a styled row -- first of a `<li>` toggle, then of the `<select>`. Neither
   * exists; what the region has now is the pair of jumps floating over the
   * column, and the claim is worth exactly as much about them.
   */
  it('offers its jumps as real, labelled controls reachable by keyboard', () => {
    draw({ entry: manyEntry, decision: MANY[0] as Decision });
    const column = q<HTMLElement>('[data-detail-column]') as HTMLElement;
    // happy-dom lays nothing out, so the metrics the jump rule reads are
    // faked: a tall content resting in the middle has both edges to offer.
    Object.defineProperty(column, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(column, 'clientHeight', { value: 100, configurable: true });
    column.scrollTop = 500;
    fireEvent.scroll(column);
    for (const [sel, label] of [
      ['[data-out-to-top]', 'scroll to the oldest turn read'],
      ['[data-out-to-bottom]', 'scroll to the newest turn'],
    ]) {
      const button = q<HTMLElement>(sel as string);
      expect(button?.tagName, sel).toBe('BUTTON');
      expect(button?.getAttribute('aria-label'), sel).toBe(label);
    }
  });

  /**
   * A CONTROL THAT CAN DO NOTHING COSTS NO DOM — the rule this case has
   * always been about, moved from the picker (absent with one turn, since
   * there was nothing to jump between) to the jumps that replaced it (absent
   * while the column has no room to move).
   */
  it('draws no jump at all while neither would move the column', () => {
    const one: SessionEntry = {
      project: PROJECT,
      session: { ...SESSION, decisions: [DECISIONS[0] as Decision] },
    };
    draw({ entry: one, decision: DECISIONS[0] as Decision });
    // happy-dom reports 0 for every metric, which is exactly the state being
    // asserted: a column resting at its own bottom with nothing above it.
    expect(all('[data-out-to-top]')).toHaveLength(0);
    expect(all('[data-out-to-bottom]')).toHaveLength(0);
    expect(all('[data-progress-jump]')).toHaveLength(0);
  });

  it('says how many turns vam read, not a bare total it cannot prove', () => {
    draw({ entry: manyEntry, decision: MANY[0] as Decision });
    const text = q<HTMLElement>('[data-progress-count]')?.textContent ?? '';
    // Not the bare "N turns" the operator's bug report was about: on a
    // session whose transcript outgrows the tail window vam reads
    // (`source.ts`'s `TAIL_BYTES`), `decisions.length` is what vam FOUND in
    // that window, not a provable lifetime total -- so the word here has to
    // be about what vam did, never a claim about the session's whole history.
    expect(text).not.toBe('7 turns');
    // Pinned as a COUNT with its qualifier trailing, not as an imperative:
    // "read 7 turns" reads as an instruction this button does not carry
    // out. "7 turns read" is the count, honestly labelled.
    expect(text).toBe('7 turns read');
    expect(text.toLowerCase()).not.toMatch(/^read/);
  });
});

/**
 * `DetailPanel` used to have no memory of its own: every render drew exactly
 * the `decision` prop the canvas handed over, which is at most one of the
 * canvas's own three visible slots (`grid.ts`'s `STEP_SLOTS`). The progress
 * list can now show every turn a session has, so it has to be able to put one
 * of THOSE on screen too -- reading history was the whole point of keeping it.
 */
describe('the panel remembers which turn you are reading, independent of the canvas', () => {
  // Seven turns; the canvas would only ever focus one of the newest three, so
  // `d1`, the oldest, is a turn the canvas's DEFAULT pick never lands on.
  const MANY = ['d7', 'd6', 'd5', 'd4', 'd3', 'd2', 'd1'].map((id) => decision(id));
  const manyEntry: SessionEntry = { project: PROJECT, session: { ...SESSION, decisions: MANY } };

  /**
   * THE MARKED TURN'S PROMPT, not "the first prompt on screen".
   *
   * The pane draws every turn now, oldest first, so an unqualified
   * `[data-detail-scroll="in"]` is the OLDEST turn's prompt whatever the panel
   * remembers -- which would have made every case in this block assert `d1`
   * and pass for the wrong reason on the two that expect it. What the block is
   * about is unchanged: which turn the panel considers itself to be reading.
   * That is `data-turn-current` now, because picking one no longer hides the
   * other six.
   */
  const markedTurn = () => q<HTMLElement>('[data-column-turn][data-turn-current="true"]');
  const inText = () => markedTurn()?.querySelector('[data-detail-scroll="in"]')?.textContent ?? '';
  // A12.2 moved the removed header's `[data-detail-step]` chip into the `in`
  // rule's meta beside "you", then onto the identity line -- and the operator
  // has now had that line removed as well, and the picker that printed the
  // labels after it. The label's home is the turn's OWN condensed line, one
  // per turn; read off the MARKED one, it is the same fact in the same words.
  const stepLabel = () =>
    markedTurn()?.querySelector('[data-progress-turn-label]')?.textContent ?? '';

  it('shows the canvas’s own pick by default', () => {
    draw({ entry: manyEntry, decision: MANY[0] as Decision });
    expect(inText()).toContain('ask d7');
    expect(stepLabel()).toContain('step d7');
  });

  /**
   * RE-POINTED, AND THE HALF THAT CANNOT BE RE-POINTED IS NAMED.
   *
   * "once picked from the jump control" was the point of this case: the panel
   * could put a turn on screen that the canvas never focuses. The control is
   * gone, and with it the panel's ability to MARK such a turn -- nothing in
   * the pane can now select `d1` if the canvas cannot reach it. What survives,
   * and is the thing an operator actually wanted, is that the turn is DRAWN
   * and readable without the canvas: the column holds all seven, `d1`'s prompt
   * and answer included, which is why the picker could go at all.
   */
  it('draws every turn the canvas never focuses, prompt and answer alike', () => {
    draw({ entry: manyEntry, decision: MANY[0] as Decision });
    const oldest = q<HTMLElement>('[data-column-turn="d1"]');
    expect(oldest).not.toBeNull();
    expect(oldest?.querySelector('[data-detail-scroll="in"]')?.textContent).toContain('ask d1');
    expect(oldest?.querySelector('[data-detail-scroll="out"]')?.textContent).toContain('answered');
    // And the canvas's own pick is still the one MARKED -- drawing every turn
    // is not the same as claiming to be reading each of them.
    expect(markedTurnId()).toBe('d7');
  });

  it('keeps the turn it was reading across a re-render the canvas did not cause', () => {
    // `focusNodeId` HELD CONSTANT -- the canvas's own cursor did not move,
    // which is the real-world shape of "something unrelated refreshed":
    // `Canvas.tsx` always reports a `focusedId`, it just did not change.
    const view = drawFor({
      entry: manyEntry,
      decision: MANY[0] as Decision,
      focusNodeId: 'info:s1',
    });
    arriveOn(view, manyEntry, 6);
    expect(inText()).toContain('ask d1');
    // The canvas's OWN cursor is unchanged (still on `d1`) -- only something
    // unrelated moved, e.g. the session's activity line on a poll, or -- the
    // case that matters most -- `decision` itself, because turn ids are now
    // content-derived (`transcript.ts`) and the canvas's DEFAULT pick
    // (`decisions[0]`) genuinely gets a new id every time a new turn really
    // arrives. Neither must yank the operator back to the newest turn.
    view.rerender({
      entry: { project: PROJECT, session: { ...manyEntry.session, activity: 'still going' } },
      decision: MANY[0] as Decision,
      focusNodeId: 's1',
    });
    expect(inText()).toContain('ask d1');
    expect(stepLabel()).toContain('step d1');
  });

  it('defers back to the canvas the moment the canvas’s own cursor moves again', () => {
    const view = drawFor({
      entry: manyEntry,
      decision: MANY[0] as Decision,
      focusNodeId: 'info:s1',
    });
    arriveOn(view, manyEntry, 6);
    expect(inText()).toContain('ask d1');
    // THE PROP'S CONTRACT, which is broader than any chord bound today: a
    // `focusNodeId` that CHANGES alongside `decision` is a navigation and the
    // panel follows it, rather than the default pick's id merely drifting
    // under a poll. `Canvas.tsx` currently only ever reports the pane's
    // session here (the graph's step cursor went with the graph), so the case
    // below is the shape that actually reaches this today -- but the rule is
    // the prop's, not that one caller's, and the panel's memory is a default
    // rather than a lock either way.
    view.rerender({
      entry: manyEntry,
      decision: MANY[1] as Decision,
      focusNodeId: 'step:s1:d6',
    });
    expect(inText()).toContain('ask d6');
    expect(stepLabel()).toContain('step d6');
  });

  it('defers back to the canvas on a plain session refocus too, with no step cursor at all', () => {
    // The OTHER real navigation: a different session gets focused (`j`/`k`,
    // or a sidebar click), landing on its info node -- no step cursor,
    // `focusNodeId` still changes because the SESSION changed. Session
    // identity alone already covered this before turn ids were stabilised;
    // this pins that it still does now that `focusNodeId` is the mechanism
    // doing most of the work.
    const view = drawFor({
      entry: manyEntry,
      decision: MANY[0] as Decision,
      focusNodeId: 'info:s1',
    });
    arriveOn(view, manyEntry, 6);
    expect(inText()).toContain('ask d1');
    const otherSession: Session = { ...manyEntry.session, id: 's2' };
    view.rerender({
      entry: { project: PROJECT, session: otherSession },
      decision: otherSession.decisions[0] as Decision,
      focusNodeId: 's2',
    });
    expect(inText()).toContain('ask d7');
    expect(stepLabel()).toContain('step d7');
  });

  it('turns off the live turn markers for the older turn it is reading', () => {
    // Companion to "does not animate an older turn of a running session"
    // above, which reaches the same state on FIRST RENDER through the
    // `decision` prop. This reaches it mid-life, the way the app does: land on
    // the session, then let newer turns arrive under it -- a different path
    // (`followCanvas` during render, plus the layout effect that scrolls) that
    // has to feed the same `isNewestTurn`/`outIsLive` rule rather than a
    // second one that could disagree with it.
    // It used to come in through a progress-row click; that door went with
    // the column's bar, and arriving-then-polling is the one that is left.
    const running: SessionEntry = {
      project: PROJECT,
      session: { ...manyEntry.session, status: 'running' },
    };
    const view = drawFor({ entry: running, decision: MANY[0] as Decision });
    arriveOn(view, running, 6);
    // `data-out-live` is `outIsLive` rendered, and it is not gated on empty
    // output the way `data-out-empty` is -- asserting on it (rather than
    // `data-out-empty`) is what keeps this test from passing vacuously
    // against a fixture whose every turn already has an answer.
    // ON THE PICKED TURN. The column draws the newest turn too, and that one
    // IS the live one and rightly carries the marker; the claim was never that
    // a running session stops saying so, only that the turn being read out of
    // history does not pretend to be it.
    const picked = q<HTMLElement>('[data-column-turn][data-turn-current="true"]') as HTMLElement;
    expect(picked?.getAttribute('data-column-turn')).toBe('d1');
    expect([...picked.querySelectorAll('[data-out-live]')]).toHaveLength(0);
    expect(all('[data-out-live]')).toHaveLength(1);
  });
});

/**
 * THE FOLLOW-UP DEFECT, end to end. Turn ids used to be positional
 * (`${prefix}:${index}`, counted from the newest end), so a poll that
 * delivered a new turn shifted every earlier turn's index -- the SAME id
 * string named a DIFFERENT turn on the next parse, and this panel's own
 * `selectedId` lookup would silently swap the content under an operator
 * still reading it. `transcript.ts` now derives ids from a turn's own input
 * (plus a same-input rank, for the operator resending identical words), so a
 * turn keeps its id across a poll that adds another one.
 *
 * THE REAL PARSER, NOT A HAND-PICKED ID: every other test in this file
 * builds `Decision`s by hand, which cannot prove id STABILITY -- a literal
 * never drifts. This drives `DetailPanel` with `summarizeTranscript`'s own
 * output, parsed twice, to prove the actual promise: select a historical
 * turn, have the SOURCE deliver a new one, and the panel is still showing
 * the turn it was.
 */
describe('a selected historical turn survives a poll that delivers a new one', () => {
  const jsonl = (...lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n');
  const turnsFor = (prompts: readonly string[]) => {
    const lines: unknown[] = [];
    for (const [i, prompt] of prompts.entries()) {
      lines.push(
        { type: 'last-prompt', lastPrompt: prompt },
        {
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: `answer ${i}` }] },
        },
      );
    }
    return summarizeTranscript(jsonl(...lines), 'sess-1').decisions;
  };
  const entryWith = (decisions: readonly Decision[]): SessionEntry => ({
    project: PROJECT,
    session: { ...SESSION, id: 'sess-1', decisions },
  });
  /** The MARKED turn's prompt -- the column draws every turn, so an
   *  unqualified lookup reads the oldest one whatever was picked. */
  const marked = () => q<HTMLElement>('[data-column-turn][data-turn-current="true"]');
  const inText = () => marked()?.querySelector('[data-detail-scroll="in"]')?.textContent ?? '';
  /**
   * The turn at oldest-first position `index`. It used to be the `<option>` at
   * that position in the jump control; the control went with the column's bar,
   * so the same turn is taken from the parser's own list -- which is newest
   * first (`model.ts`), hence the reversal.
   */
  const oldestFirst = (turns: readonly Decision[]) => [...turns].reverse();

  it('keeps the same turn on screen after the source delivers one more turn', () => {
    // A real parse: two turns, oldest-first "ask 0" then "ask 1".
    const before = turnsFor(['ask 0', 'ask 1']);
    const view = drawFor({ entry: entryWith(before), decision: before[0] as Decision });

    // Read the OLDEST turn, which the canvas never focuses by default.
    const oldest = oldestFirst(before)[0];
    expect(oldest, 'fixture has no oldest turn to navigate to').not.toBeUndefined();
    arriveOn(view, entryWith(before), 1);
    expect(inText()).toContain('ask 0');

    // The poll: the source is asked again and now reports THREE turns --
    // one more request landed while "ask 0" was on screen. Exactly the
    // operator's own bug report. `focusNodeId` is held where the navigation
    // left it: the canvas's cursor did not move, only the model refreshed.
    const after = turnsFor(['ask 0', 'ask 1', 'ask 2']);
    view.rerender({
      entry: entryWith(after),
      decision: after[0] as Decision,
      focusNodeId: 'sess-1',
    });

    // Still "ask 0" -- the same real, content-derived id survived the poll.
    expect(inText()).toContain('ask 0');
  });

  it('keeps a REPEATED prompt’s own turn on screen too, not its earlier twin', () => {
    // The duplicate-input case `transcript.ts`'s `turnFingerprint` reasons
    // through: "continue" sent twice, non-adjacently. `in` shows the PROMPT,
    // identical for both occurrences by construction, so `out` -- each
    // turn's own distinct reply -- is what has to be read here.
    const outText = () => marked()?.querySelector('[data-detail-scroll="out"]')?.textContent ?? '';
    const before = turnsFor(['continue', 'something else', 'continue']);
    const view = drawFor({ entry: entryWith(before), decision: before[0] as Decision });

    // Both "continue" turns exist; the SECOND occurrence (newer) is what is
    // navigated to here, oldest-first so it is the last of the three.
    const secondContinue = oldestFirst(before)[2];
    expect(secondContinue, 'fixture has no second "continue" turn').not.toBeUndefined();
    arriveOn(view, entryWith(before), 0);
    expect(inText()).toContain('continue');
    expect(outText()).toContain('answer 2'); // the third turn's own reply

    const after = turnsFor(['continue', 'something else', 'continue', 'a fourth ask']);
    view.rerender({
      entry: entryWith(after),
      decision: after[0] as Decision,
      focusNodeId: 'sess-1',
    });

    // Still the SECOND "continue" turn's own answer -- not the first
    // occurrence's, which a rank collision would have resolved to instead.
    expect(outText()).toContain('answer 2');
  });
});

/**
 * WHAT VAM CANNOT PROMISE: a turn old enough to fall out of the byte window
 * entirely (`source.ts`'s `TAIL_BYTES`) is not just off the newest slice any
 * more -- it is gone from what vam read, the same way an old-enough question
 * already reads as "none asked" rather than as stale (`source.ts`'s own note
 * on `questions`). Silently substituting a different turn there would be
 * exactly the failure this whole change exists to remove, just moved one
 * level up: "the turn you were reading has scrolled out of view" and "here
 * is your turn" must not look the same.
 */
describe('a turn that has genuinely scrolled out of the window', () => {
  const MANY = ['d3', 'd2', 'd1'].map((id) => decision(id));
  const manyEntry: SessionEntry = { project: PROJECT, session: { ...SESSION, decisions: MANY } };

  it('says so, rather than silently drawing a different turn', () => {
    const view = drawFor({
      entry: manyEntry,
      decision: MANY[0] as Decision,
      focusNodeId: 'info:s1',
    });
    arriveOn(view, manyEntry, 2);
    expect(
      q<HTMLElement>('[data-column-turn][data-turn-current="true"]')?.textContent ?? '',
    ).toContain('ask d1');

    // The window no longer carries `d1` at all -- every id in the new
    // decisions list is one the panel has never seen, simulating it having
    // fallen out of `TAIL_BYTES` rather than merely off a slice. The canvas's
    // own cursor is HELD where it was: the poll is what moved, not the
    // operator, which is the whole shape of this failure.
    const REPLACED = ['d5', 'd4'].map((id) => decision(id));
    view.rerender({
      entry: { project: PROJECT, session: { ...manyEntry.session, decisions: REPLACED } },
      decision: REPLACED[0] as Decision,
      focusNodeId: 's1',
    });

    expect(document.body.textContent ?? '').toContain('scrolled out');
    // NOT MARKED AS THE ONE BEING READ. `d5` is on screen -- it is a turn of
    // this session and the column draws every turn it has, which is not a
    // substitution. The substitution this refuses is the pane pointing at
    // `d5` and calling it the turn the operator was reading, so what is
    // asserted is that NOTHING is marked while the pick is missing, that the
    // pane says so in words, and that it hid nothing to say it.
    expect(all('[data-column-turn][data-turn-current="true"]')).toHaveLength(0);
    expect(markedTurnId()).toBeNull();
    expect(all('[data-progress-turn-missing]')).toHaveLength(1);
    expect(all('[data-column-turn]')).toHaveLength(2);
  });

  it('offers a way back to the turn the canvas is actually showing', () => {
    const view = drawFor({
      entry: manyEntry,
      decision: MANY[0] as Decision,
      focusNodeId: 'info:s1',
    });
    arriveOn(view, manyEntry, 2);

    const REPLACED = ['d5', 'd4'].map((id) => decision(id));
    view.rerender({
      entry: { project: PROJECT, session: { ...manyEntry.session, decisions: REPLACED } },
      decision: REPLACED[0] as Decision,
      focusNodeId: 's1',
    });

    const back = q<HTMLButtonElement>('[data-progress-turn-return]');
    expect(back).not.toBeNull();
    act(() => back?.click());
    expect(
      q<HTMLElement>('[data-column-turn][data-turn-current="true"]')?.textContent ?? '',
    ).toContain('ask d5');
    expect(all('[data-progress-turn-missing]')).toHaveLength(0);
  });
});

describe('the pane drops the status line under the tab bar', () => {
  it('says nothing in prose', () => {
    // The operator asked for the banner under the tabs to go, and it stays
    // gone. What USED to follow -- "and still says it with the status dot,
    // two lines above where the sentence used to be" -- no longer applies:
    // A12.2 removed that dot along with the rest of the header. See the
    // retirement note near the top of this file (where `describe('the pane
    // header names the session status it actually has', ...)` used to be)
    // for where the status fact went instead.
    draw();
    expect(document.body.textContent).not.toContain('waiting on you');
  });
});

describe('the pane wears the mockup’s own background', () => {
  /**
   * RE-POINTED, and the colour did not move.
   *
   * This asserted `bg-sidebar`: the mockup paints the pane and the sidebar the
   * same value, so the pane borrowed the sidebar's token -- and with it the
   * sidebar's SWATCH, which is what the operator asked to have split ("split
   * the pane's colour setting from the sidebar"). `--vam-pane` starts on that
   * same measured value in both themes, so what this case was protecting (the
   * pane wears the artboard's fill, not some other rung of the ladder) is
   * unchanged; what it can no longer do is pass while one swatch drives two
   * surfaces.
   */
  it('uses the pane token, whose value is the pane colour off both artboards', () => {
    draw();
    const aside = q<HTMLElement>('[data-action-pane]');
    expect(aside?.className).toContain('bg-pane');
    expect(aside?.className).not.toContain('bg-sidebar');
    expect(aside?.className).not.toContain('bg-sunken');
  });

  /**
   * THE BLACK BANDS THE OPERATOR REPORTED. "There are some black background
   * areas below the prompt input and the In block" -- three blocks inside the
   * pane painted a DARKER rung than the pane itself: the sticky prompt band on
   * `ground`, the deepest value there is, and the question and composer blocks
   * on `header`. All three take the pane's own fill now; the seams that
   * matter are borders, which the two bars still carry.
   *
   * Class-level here and MEASURED in the browser by
   * `e2e/pane-colour-shots.mjs`: a Tailwind utility whose token does not
   * resolve emits nothing and reads back perfectly from `className`.
   */
  it('paints no band inside itself darker than the pane', () => {
    draw();
    for (const selector of [
      '[data-detail-block="in"]',
      '[data-composer-bar]',
      '[data-question-bar]',
    ]) {
      const band = q<HTMLElement>(selector);
      if (band === null) continue;
      expect(band.className, selector).not.toContain('bg-ground');
      expect(band.className, selector).not.toContain('bg-header');
      expect(band.className, selector).toContain('bg-pane');
    }
    // The sticky band is the one that must be there to be opaque, so its
    // absence would make this pass for the wrong reason.
    expect(q('[data-detail-block="in"]')).not.toBeNull();
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

    // The button exists and never uses the word `send`: factory records a
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

/**
 * RETIRED (the mode control moved into the prompt block, as one icon):
 *   - 'replaces the slash tags with mode pills' — there are no pills to
 *     count; the icon shows the CURRENT mode only, pinned in
 *     `DetailPanel.mode-icon.test.tsx`.
 *   - 'advertises the chord now that one is bound, at the right-hand end' —
 *     the resting caption is gone from the DOM by design (it cost width for a
 *     sentence nobody reads) and now lives in the icon's accessible name,
 *     asserted there. What that test really guarded — the chord being NAMED
 *     somewhere a person can find it — survives in the new file.
 * The one assertion that was about neither is kept below.
 */
describe('the slash tags the mode control replaced are still gone', () => {
  it('draws no /diff placeholder under the composer', () => {
    draw();
    expect(document.querySelector('[data-placeholder="slash-diff"]')).toBeNull();
    expect(q<HTMLElement>('[data-composer-bar]')?.textContent).not.toContain('/diff');
  });
});

/**
 * WHO MAY SEE A MODE SWITCHER -- the operator's request in their own words:
 * hidden where the factory has already chosen and vam cannot change anything,
 * shown only where a choice is really possible. TWO CONDITIONS, NEITHER
 * SUFFICIENT ALONE: `vamControlled`, the per-session fact that vam started
 * this pane, and the source's `terminal` capability, which is what says there
 * is a pane surface at all. ABSENT, NOT DISABLED -- a dimmed switcher still
 * says a mode is choosable here, which is what the row went for once already.
 */
describe('the mode control is drawn only where a mode can actually be chosen', () => {
  const withBridge = (send: (...args: unknown[]) => Promise<PaneSendResult>) => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { terminal: { send } },
    });
  };

  afterEach(() => {
    Reflect.deleteProperty(window, 'api');
  });

  /** Shift+Tab (or a plain Tab) in the prompt box, where the chord is bound. */
  const press = async (shiftKey: boolean) => {
    const box = q<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Tab', shiftKey });
      await Promise.resolve();
    });
  };

  it('hides the whole row for a session vam did not start', () => {
    draw({ entry: { project: PROJECT, session: { ...SESSION, vamControlled: false } } });
    expect(q('[data-mode-toggle]')).toBeNull();
    expect(q('[data-mode-picker]')).toBeNull();
    expect(q('[data-mode-cycle]')).toBeNull();
  });

  it('hides it when nobody has said whether vam owns the pane', () => {
    // Three-state on purpose: `undefined` is "not established", and a
    // switcher drawn on an unstated fact is the same lie as one drawn on a
    // false one.
    const { vamControlled: _dropped, ...unowned } = SESSION;
    draw({ entry: { project: PROJECT, session: unowned } });
    expect(q('[data-mode-toggle]')).toBeNull();
  });

  it('hides it where the source has no terminal surface at all', () => {
    draw({ terminal: false });
    expect(q('[data-mode-toggle]')).toBeNull();
  });

  it('draws it for a session vam started, on a source that has a terminal', () => {
    draw({ terminal: true });
    expect(q('[data-mode-toggle]')).not.toBeNull();
    // ONE control, and all three modes behind it -- see
    // `DetailPanel.mode-icon.test.tsx` for the popover itself.
    expect(all('[data-mode-toggle]')).toHaveLength(1);
  });

  it('presses the session’s own Shift-Tab, and does not submit the draft', async () => {
    const sent: unknown[][] = [];
    withBridge(async (...args) => {
      sent.push(args);
      return 'sent';
    });
    let submitted = 0;
    draw({
      onSubmit: () => {
        submitted += 1;
      },
    });
    // A PLAIN Tab first, and it must send nothing: it is how a keyboard gets
    // out of a textarea, and a mode cycled by it would be one the operator
    // never asked for.
    await press(false);
    expect(sent).toEqual([]);
    await press(true);
    // The kind, the project and the ROW: aimed at the session on screen, not
    // at whatever pane the project alone resolves to.
    expect(sent).toEqual([[PROJECT.id, { kind: 'back-tab' }, SESSION.id]]);
    expect(submitted).toBe(0);
  });

  /**
   * Every outcome of the press is DRAWN. `unaimed` is main declining to guess
   * which pane this row is in and `refused` is tmux turning the delivery
   * down: different sentences, because they send a person to different
   * places. Saying nothing for either leaves the operator believing a mode
   * moved that did not.
   */
  it.each([
    ['unaimed' as PaneSendResult, 'not sent', 'tmux'],
    ['refused' as PaneSendResult, 'tmux', 'could not name'],
  ])('draws the refusal for %s, in its own words', async (result, says, notSays) => {
    withBridge(async () => result);
    draw();
    await press(true);
    const said = q<HTMLElement>('[data-mode-refusal]');
    expect(said?.textContent).toContain(says);
    expect(said?.textContent).not.toContain(notSays);
  });

  it('draws no refusal when the key landed', async () => {
    withBridge(async () => 'sent');
    draw();
    await press(true);
    expect(q('[data-mode-refusal]')).toBeNull();
  });

  /**
   * WHAT THE PRESS ITSELF SAYS, at the keystroke and at the answer.
   *
   * Every other channel that could report a mode cycle is absent by
   * construction: the composer is drawn only while the tab is not Terminal, so
   * the pane is not on screen, and the MODE pills read the draft rather than
   * the pane. The caption is the whole of the feedback, and it used to go back
   * to its resting text on success -- pixel-identical to a chord nothing was
   * bound to.
   *
   * `deferred` is the point of these tests: a caption asserted only after the
   * promise settles cannot tell an immediate indicator from a late one.
   */
  it('says the chord is in flight before the pane has answered', async () => {
    let land: (result: PaneSendResult) => void = () => {};
    withBridge(
      () =>
        new Promise<PaneSendResult>((resolve) => {
          land = resolve;
        }),
    );
    draw();
    // Nothing at rest: the caption exists only while it has something to say.
    expect(q('[data-mode-cycle]')).toBeNull();
    await press(true);
    // NOT resolved yet: this is the state the operator sees while three tmux
    // spawns at ten seconds apiece are still out.
    const inFlight = q<HTMLElement>('[data-mode-cycle]');
    expect(inFlight?.getAttribute('data-mode-cycle-state')).toBe('busy');
    expect(inFlight?.textContent).toContain('sending');
    expect(q('[data-mode-refusal]')).toBeNull();
    await act(async () => {
      land('sent');
      await Promise.resolve();
    });
  });

  it('reports the delivery on success, and claims only what vam knows', async () => {
    withBridge(async () => 'sent');
    draw();
    expect(q('[data-mode-cycle]')).toBeNull();
    await press(true);
    const said = q<HTMLElement>('[data-mode-cycle]');
    expect(said?.getAttribute('data-mode-cycle-state')).toBe('sent');
    expect(said?.textContent).toContain('sent');
    // WHAT IT MAY NOT SAY: vam presses a key into the pane and never reads
    // back which mode resulted, so the delivery is the only true claim here.
    expect(said?.textContent).not.toContain('mode is');
    expect(said?.textContent).toContain('does not read the mode back');
  });

  it('does not queue a second press into the agent while one is out', async () => {
    let sends = 0;
    let land: (result: PaneSendResult) => void = () => {};
    withBridge(() => {
      sends += 1;
      return new Promise<PaneSendResult>((resolve) => {
        land = resolve;
      });
    });
    draw();
    await press(true);
    await press(true);
    expect(sends).toBe(1);
    // And the second press is not swallowed in silence: the caption raised by
    // the first is still on screen saying the chord is out.
    expect(q<HTMLElement>('[data-mode-cycle]')?.getAttribute('data-mode-cycle-state')).toBe('busy');
    await act(async () => {
      land('sent');
      await Promise.resolve();
    });
  });

  /**
   * A REFUSAL BELONGS TO THE SESSION IT WAS RAISED FOR. `DetailPanel` is not
   * remounted when `entry` changes, so A's amber "tmux would not deliver to
   * that session", still drawn over B's mode row, is a statement about B that
   * nothing ever made. `TerminalTab` holds the same three lines for the same
   * reason, and this follows it rather than inventing a second pattern.
   */
  it('drops the note when the pane starts being about another session', async () => {
    withBridge(async () => 'refused');
    const { rerender } = drawFor();
    await press(true);
    expect(q('[data-mode-refusal]')).not.toBeNull();
    act(() => {
      rerender({ entry: { project: PROJECT, session: { ...SESSION, id: 's2', title: 'Other' } } });
    });
    // GONE, not reset to a resting caption: the note is drawn only when it
    // has something to say, so "dropped" is now "absent from the document".
    expect(q('[data-mode-cycle]')).toBeNull();
  });

  it('does not land A’s late answer on the session that replaced it', async () => {
    let land: (result: PaneSendResult) => void = () => {};
    withBridge(
      () =>
        new Promise<PaneSendResult>((resolve) => {
          land = resolve;
        }),
    );
    const { rerender } = drawFor();
    await press(true);
    act(() => {
      rerender({ entry: { project: PROJECT, session: { ...SESSION, id: 's2', title: 'Other' } } });
    });
    await act(async () => {
      land('refused');
      await Promise.resolve();
    });
    expect(q('[data-mode-cycle]')).toBeNull();
  });

  it('says so when there is no bridge to press the key with', async () => {
    // The browser build has no `window.api`. The row is drawn from the
    // session's own facts, so this is the one case where it can be on screen
    // with nothing behind it -- and it says so instead of doing nothing.
    draw();
    await press(true);
    expect(q('[data-mode-refusal]')).not.toBeNull();
  });
});

describe('there is a way out of the prompt box without a mouse', () => {
  it('Mod-[ gives the keyboard back, and does not leave DOM focus behind', () => {
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

    // `Mod-[` since Escape in this box became the agent's interrupt. `Mod`
    // folds Ctrl and Cmd, and `cancelable` is what makes the handler's
    // `preventDefault()` mean anything at all -- without it a hand-built event
    // reports `defaultPrevented: false` whatever the handler does.
    act(() => {
      box.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '[',
          code: 'BracketLeft',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(left).toBe(1);
    // Clearing `composing` alone is not enough: it only makes the box
    // read-only. Until it is blurred the keys still land on it and vanish.
    expect(document.activeElement).not.toBe(box);
  });

  it('retires the caption that promised Escape went to the sidebar', () => {
    // It no longer does -- Escape interrupts the agent from in here -- and a
    // hint that outlives the behaviour it described is worse than no hint: it
    // sends the operator to press a key expecting to leave and stops their
    // agent instead. The replacement caption (`Mod-[ → leave`) is gone too,
    // at the operator's later ask; `DetailPanel.composer-escape.test.tsx`
    // holds the key still working.
    draw({ composing: true });
    expect(q<HTMLElement>('[data-prompt-keys]')?.textContent).not.toContain('sidebar');
    expect(q<HTMLElement>('[data-prompt-escape]')).toBeNull();
    // The row itself is still only drawn while the box is open for typing --
    // it costs no width the rest of the time.
    cleanup();
    draw({ composing: false });
    expect(q<HTMLElement>('[data-prompt-keys]')).toBeNull();
  });

  it("names no leave key at all, on the operator's second look", () => {
    // Operator, first: "of Enter-to-send and Mod-[-to-leave, only the leave
    // one needs showing." Then, having lived with it: "drop the leave shortcut
    // from under the prompt box."
    //
    // THE KEY STILL WORKS. `Mod-[` is bound in the composer's own `onKeyDown`
    // and reserved in `chords.ts`, `Mod-0` still gets out from here, and the
    // `?` sheet still names both. What is gone is the CAPTION, which is the
    // operator's call to make: they are the one reading this row on every
    // prompt they type.
    draw({ composing: true });
    expect(q<HTMLElement>('[data-prompt-leave-key]')).toBeNull();
    expect(q<HTMLElement>('[data-prompt-keys]')?.textContent ?? '').not.toContain('leave');
    // And the send key stays where it was left -- silent on the shipped key,
    // which is what makes the row EMPTY here rather than merely shorter.
    expect(q<HTMLElement>('[data-prompt-send-key]')).toBeNull();
  });

  it('brings the send caption back when the operator is not on the shipped key', () => {
    // THE OTHER HALF, and the reason the rule is not "never draw it". Once
    // this row stopped naming the send key, nothing on a desktop did: the
    // submit button's `Note` names the OUTCOME, never the keystroke, and the
    // picker is two dialogs away. A caption for a convention is clutter; a
    // caption for a deviation is the only report there is -- and
    // `Shift-Enter` is the state where Return does something the operator did
    // not ask it to.
    setActivePromptSubmitKey('shift-enter');
    try {
      draw({ composing: true });
      expect(q<HTMLElement>('[data-prompt-send-key]')?.textContent).toContain('Shift-Enter');
    } finally {
      setActivePromptSubmitKey(DEFAULT_PROMPT_SUBMIT_KEY);
    }
  });

  it('keeps the send key on a phone, where it is the only key there is', () => {
    // The phone names no `Mod-[` and no `Esc` -- a soft keyboard has neither
    // -- so dropping the send hint there would not simplify the row, it would
    // empty it. The return key is real on a phone, and it is the one key whose
    // behaviour is a PREFERENCE rather than a convention.
    draw({ composing: true, phone: true });
    expect(q<HTMLElement>('[data-prompt-send-key]')).not.toBeNull();
    expect(q<HTMLElement>('[data-prompt-leave-key]')).toBeNull();
  });
});

describe('the merged column scrolls the whole turn, `in` pinned to its top', () => {
  /**
   * RETIRED: `'caps `in` at two rendered lines of its own body text'` — it
   * asserted `[data-detail-scroll="in"]` carried `style.maxHeight: 59px` and
   * its own `overflow-y-auto`. Both are gone on the operator's follow-up:
   * a boxed, separately scrolling prompt is what still read as a separate
   * panel once the band labels came off, so the prompt runs out in full
   * inside the one column now. Not a coverage loss — the replacement guards
   * live in `DetailPanel.transcript-flow.test.tsx` (`'gives `in` no box, no
   * height cap and no scrollbar of its own'` and `'keeps exactly one
   * scroller for the turn'`), and the sticky paint itself is measured in a
   * real browser by `e2e/transcript-flow-shots.mjs`.
   */

  /**
   * RETIRED: `'gives `out` the height the other two gave up'` — it asserted
   * `[data-detail-block="out"]` carries `flex-1`, the fact that made `out`
   * the one region with its OWN scrollbar under the old three-fixed-pane
   * layout. A12.2 removes that layout outright: `in`, `progress` and `out`
   * are now flow children of ONE scrolling column
   * (`[data-detail-column]`, asserted below), and `out` no longer needs or
   * carries `flex-1` — it just grows with its content like any other block.
   * Not a coverage loss with nothing to show for it: the replacement test
   * below asserts the column that took over the job.
   */
  it('scrolls `in`, `progress` and `out` together as one column, not `out` alone', () => {
    draw();
    const column = q<HTMLElement>('[data-detail-column]');
    expect(column).not.toBeNull();
    expect(column?.className).toContain('overflow-y-auto');
    expect(column?.className).toContain('flex-1');
    // All three sections live INSIDE the one scrolling column now.
    for (const block of ['in', 'progress', 'out']) {
      expect(column?.querySelector(`[data-detail-block="${block}"]`), block).not.toBeNull();
    }
    // `out` itself no longer claims its own scroller or its own share of the
    // pane's height — the column does both for it now.
    const out = q<HTMLElement>('[data-detail-block="out"]');
    expect(out?.className).not.toContain('flex-1');
    expect(q<HTMLElement>('[data-detail-scroll="out"]')?.className ?? '').not.toContain(
      'overflow-y-auto',
    );
  });

  it('pins `in` to the top of the column with `position: sticky`', () => {
    draw();
    const inBlock = q<HTMLElement>('[data-detail-block="in"]');
    expect(inBlock?.className).toContain('sticky');
    expect(inBlock?.className).toContain('top-0');
    // Opaque, or `out` text scrolling underneath would show through the two
    // pinned lines of `in` -- and the PANE's own fill since the prompt got a
    // bubble of its own, so the backing stops bleed-through without painting a
    // band. It named `ground` for that job while the pane wore `sidebar`,
    // which is how the band the operator reported got there.
    expect(inBlock?.className).toContain('bg-pane');
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

/**
 * RETIRED: two whole describes, five tests, all about the three section
 * rules' glyphs — `'the in and out rules wear the mockup’s own glyphs'`
 * (`'is a user for in and a bot for out, announced rather than drawn only'`)
 * and `'the three section rules are told apart by colour as well as by
 * glyph'` (`'paints each icon with its own token, pairwise distinct'`,
 * `'keeps every icon announced, so colour is never the only channel'`,
 * `'draws three different glyphs, which is the distinction without
 * colour'`).
 *
 * Every one of them asserted a property of the `Rule` component: its icon,
 * that icon's `role="img"` label, and the three distinct `text-rule-*`
 * colour tokens it wore. The operator asked for the three bands to go, so
 * `Rule` is deleted and there is no icon left to colour, announce or tell
 * apart. These are not rewritten against the new shape because the shape has
 * no counterpart: nothing labels a region visually any more. What DOES
 * replace the announcement — the `sr-only` region names, which are the only
 * channel a screen reader has left — is asserted in
 * `DetailPanel.transcript-flow.test.tsx` (`'keeps each region named for a
 * screen reader, and only for one'`).
 */

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

/**
 * WHAT THE PICKER DOES BEFORE IT DECODES ANYTHING.
 *
 * `File.size` is known without reading the file, and `File.text()` on a file
 * of any size decodes the WHOLE of it into one JS string -- past V8's string
 * cap that rejects, past the machine's memory the renderer dies, and a dead
 * renderer takes the composed draft with it. So the refusals that a name and
 * a size already settle are settled here, before the read, and the read that
 * does happen has somewhere to put a failure.
 *
 * Each test hands the picker a `text()` that never resolves or always
 * rejects: a sentence drawn while the decode is still pending is the only
 * proof that the size was tested first.
 */
describe('the attachment picker decides what it can before it reads the file', () => {
  type PickedFile = {
    readonly name: string;
    readonly size: number;
    readonly text: () => Promise<string>;
  };

  const picker = () => q<HTMLInputElement>('input[type="file"]') as HTMLInputElement;

  const choose = (file: PickedFile) => {
    const input = picker();
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    fireEvent.change(input);
  };

  it('refuses an oversized file from its size alone, with nothing decoded', () => {
    let decodes = 0;
    draw();
    act(() => {
      choose({
        name: 'huge.log',
        size: ATTACH_LIMIT_BYTES + 1,
        text: () => {
          decodes += 1;
          // Never resolves: if the guard moved back behind the decode, this
          // is where the test would sit and the sentence below never appear.
          return new Promise<string>(() => {});
        },
      });
    });
    expect(decodes).toBe(0);
    const said = q<HTMLElement>('[data-attach-error]');
    expect(said?.textContent).toContain('64 KB');
    expect(said?.textContent).toContain('huge.log');
  });

  it('refuses a second file the same way, naming the one already in the draft', () => {
    let decodes = 0;
    draw({ draft: attachOk('ask', { name: 'plan.md', size: 4, text: 'x' }) });
    act(() => {
      choose({
        name: 'other.txt',
        size: 4,
        text: () => {
          decodes += 1;
          return new Promise<string>(() => {});
        },
      });
    });
    expect(decodes).toBe(0);
    expect(q<HTMLElement>('[data-attach-error]')?.textContent).toContain('plan.md');
  });

  it('says so when the read itself fails, rather than dropping the rejection', async () => {
    draw();
    await act(async () => {
      choose({ name: 'gone.txt', size: 10, text: () => Promise.reject(new Error('ENOENT')) });
      await Promise.resolve();
      await Promise.resolve();
    });
    const said = q<HTMLElement>('[data-attach-error]');
    expect(said?.textContent).toContain('gone.txt');
    expect(said?.textContent).toContain('nothing was attached');
  });

  it('still inlines a file that is small enough to read', async () => {
    let draft = 'ask';
    draw({
      draft,
      onDraftChange: (value: string) => {
        draft = value;
      },
    });
    await act(async () => {
      choose({ name: 'notes.md', size: 11, text: () => Promise.resolve('hello there') });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(draft).toContain('--- attached: notes.md ---');
    expect(draft).toContain('hello there');
    expect(q('[data-attach-error]')).toBeNull();
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

/**
 * A15.4: the default-provider CHOICE moves into the prompt input, beside the
 * model field it used to be merely named next to. ABSENT, NOT DISABLED
 * (`pickImageAttachment`'s own rule) governs whether it draws at all —
 * `onSetDefaultProvider` undefined means the caller has nowhere to put a
 * change, so no button pretends otherwise.
 */
describe('A15.4: the default-provider picker lives beside the model field', () => {
  it('is absent when the caller has no way to persist a change', () => {
    draw();
    expect(q('[data-provider-picker-toggle]')).toBeNull();
  });

  it('names the current default with a real accessible name, immediately beside the model field', () => {
    draw({ defaultProvider: 'claude-code', onSetDefaultProvider: () => {} });
    const toggle = q<HTMLButtonElement>('[data-provider-picker-toggle]');
    const model = q<HTMLElement>('[data-model-request]');
    expect(toggle?.tagName).toBe('BUTTON');
    expect(toggle?.getAttribute('aria-label')).toContain('Claude Code');
    expect(model).not.toBeNull();
    // "Beside": immediately before the model field in document order, not
    // merely somewhere in the same pane.
    expect(toggle !== null && model !== null).toBe(true);
    if (toggle !== null && model !== null) {
      expect(
        Boolean(toggle.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).toBe(true);
    }
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
    const option = q<HTMLButtonElement>('[data-provider-option="claude-code"]');
    expect(option?.getAttribute('role')).toBe('option');
    expect(option?.getAttribute('aria-selected')).toBe('true');
    act(() => {
      option?.click();
    });
    expect(seen).toEqual(['claude-code']);
    expect(q('[data-provider-picker]'), 'closes once a pick lands').toBeNull();
  });

  it('reads the default provider from a fresh vam the same way resolveProvider does', () => {
    // No `defaultProvider` passed at all -- the honest "nothing chosen yet"
    // case, which must not render a blank or a crash.
    draw({ onSetDefaultProvider: () => {} });
    const toggle = q<HTMLButtonElement>('[data-provider-picker-toggle]');
    expect(toggle?.getAttribute('aria-label')).toContain('Claude Code');
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
 * is the prompt text — factory has no per-session mode to switch, so a
 * control that only moved vam's own highlight would look like it worked and
 * do nothing.
 */
describe('the mode control selects, and what it selects gets recorded', () => {
  /** Open the popover -- the icon shows only the current mode until you do. */
  const open = () => act(() => q<HTMLButtonElement>('[data-mode-toggle]')?.click());
  /** One of the three options, with the popover already open. */
  const pill = (name: string) => {
    if (q('[data-mode-picker]') === null) open();
    return q<HTMLButtonElement>(`[data-mode-option="${name}"]`);
  };

  it('writes the chosen mode into the draft as a leading line', () => {
    const seen: string[] = [];
    draw({ draft: 'ship it', onDraftChange: (next) => seen.push(next) });
    open();
    act(() => {
      pill('plan')?.click();
    });
    expect(seen).toEqual(['mode: Plan\nship it']);
  });

  it('clears the line when the default mode is chosen, rather than writing "unchanged"', () => {
    const seen: string[] = [];
    draw({ draft: 'mode: Plan\nship it', onDraftChange: (next) => seen.push(next) });
    open();
    act(() => {
      pill('auto')?.click();
    });
    expect(seen).toEqual(['ship it']);
  });

  it('shows the selection from the draft, not from a copy of it', () => {
    draw({ draft: 'mode: Manual\nship it' });
    expect(pill('manual')?.getAttribute('aria-selected')).toBe('true');
    expect(pill('auto')?.getAttribute('aria-selected')).toBe('false');
  });

  it('reads Auto for a draft with no mode line at all', () => {
    draw({ draft: 'ship it' });
    expect(pill('auto')?.getAttribute('aria-selected')).toBe('true');
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
    for (const tab of all('[data-view]')) {
      expect(tab.closest('[data-note]')).toBeNull();
    }
    // The three the operator asked to KEEP.
    expect(q<HTMLElement>('[data-attach]')?.getAttribute('data-note')).not.toBeNull();
    expect(q<HTMLElement>('[data-model-request]')?.getAttribute('data-note')).not.toBeNull();
    expect(q<HTMLElement>('[data-mode-toggle]')?.getAttribute('data-note')).not.toBeNull();
  });
});

/**
 * `paneFocused` is what an unfocused pane must stay quiet about, because
 * A15.1 mounts one `DetailPanel` PER PANE and this component was written
 * when exactly one existed.
 *
 * ONE of the two behaviours it used to gate is no longer this file's:
 * `Alt+<digit>` was a `window` listener here, and answering it in every
 * mounted panel at once was the defect `paneFocused` was added for. It is a
 * real binding now (`pickView`), so the canvas's own chord listener owns the
 * keystroke and delivers it to one pane through `tabRequest` — there is no
 * second listener left to gate. Those two cases moved to
 * `test/canvas/Canvas.view-shortcut.test.tsx`, where the key now lives, and
 * `test/canvas/Canvas.view-icons-focus.test.tsx` still presses it across a
 * real split.
 *
 * What is still THIS file's is reporting the tab back for `prefs`. `prefs`
 * remembers ONE tab and `onTabChange` is a fresh closure every render, so
 * two panes showing two different tabs wrote over each other on every
 * render, forever: measured on the head this fixes, clicking one pane's PRs
 * icon in a split hangs the shell. This case fails FAST rather than hanging,
 * which is the point of pinning it at this level.
 */
describe('an unfocused pane does not persist its tab — one pane holds the pen', () => {
  it('does not write the remembered tab — one pane holds the pen', () => {
    const reported: string[] = [];
    draw({ paneFocused: false, onTabChange: (next) => reported.push(next) });
    expect(reported).toEqual([]);
  });

  it('the focused pane reports its tab, as it always did', () => {
    const reported: string[] = [];
    draw({ paneFocused: true, onTabChange: (next) => reported.push(next) });
    expect(reported).toEqual(['Response']);
  });
});

/**
 * A12.2, A2.5, A5.4: the four views are icons, and each has a digit.
 *
 * WHAT THE KEY DOES IS NO LONGER MEASURED HERE. `Alt+<digit>` was a `window`
 * listener inside this component; it is a real binding now (`pickView`), so
 * the canvas's chord machine answers it and this panel only draws the
 * outcome. The six press-a-key cases that used to live in this describe —
 * by-name resolution with all four views drawn, the aloud refusal for a
 * withdrawn Terminal, Agents keeping digit 4, the refusal past the last
 * named view, and the two decline cases (a differently-modified digit, a
 * digit typed into the composer) — moved verbatim in intent to
 * `test/canvas/Canvas.view-shortcut.test.tsx`, which drives the listener
 * where it now is. Left here, they would have pressed a key nothing in this
 * file listens for and passed only while some other route happened to work.
 *
 * What stays is what this file can still see: an icon-only control needs a
 * REAL accessible name, and each icon must be named for its own fixed slot
 * in `TABS`, never its position in the drawn bar.
 */
describe('the view icons are named controls, each for its own fixed slot in TABS', () => {
  it('every icon is a real <button>, in the tab order, and carries its own name', () => {
    draw();
    for (const icon of all('[data-view]') as HTMLButtonElement[]) {
      expect(icon.tagName).toBe('BUTTON');
      // Reachable by Tab: no explicit removal from the tab order.
      expect(icon.getAttribute('tabindex')).not.toBe('-1');
      // ICON-ONLY DOES NOT MEAN UNLABELLED. The accessible name is
      // `aria-label` — a screen reader is not required to read a `title`, and
      // a `title` never opens on keyboard focus at all, which is the defect
      // this file already refused once for the old pill row.
      const label = icon.getAttribute('aria-label');
      expect(label, 'icon must carry its own aria-label').not.toBeNull();
      expect(label).not.toBe('');
    }
  });

  /**
   * AND THE NAME IS NOT WHERE THE SHORTCUT GOES.
   *
   * Each label used to end `— Alt+N`, and a `title` repeated it byte for
   * byte. That is a chord welded into the accessible name: a screen reader
   * says it on every focus of all four buttons and the operator has no way to
   * dismiss it, and it is a LITERAL — the operator can rebind `pickView` now,
   * after which the name would be announcing a key that does nothing.
   *
   * The shortcut has two honest homes instead, both derived from the binding
   * table: the tooltip (`ShortcutTip`, covered in
   * `test/keyboard/shortcut-tip.test.tsx`) and the generated key sheet. The
   * `title` is gone outright — it was identical to the `aria-label`, so it
   * added a second, worse copy of the same string.
   */
  it('keeps the shortcut OUT of the accessible name, and drops the title entirely', () => {
    draw({ terminal: false });
    for (const icon of all('[data-view]') as HTMLButtonElement[]) {
      const label = icon.getAttribute('aria-label') ?? '';
      expect(label, 'no chord welded into the name').not.toMatch(/Alt[+-]/);
      expect(icon.getAttribute('title'), 'the title was a worse copy of the label').toBeNull();
    }
    // The name itself survives, and so does the running-agent count, which is
    // the only place this pane still reports it.
    expect(q<HTMLElement>('[data-view="response"]')?.getAttribute('aria-label')).toBe(
      'Response view',
    );
    expect(q<HTMLElement>('[data-view="agents"]')?.getAttribute('aria-label')).toBe(
      'Agents view, 2 running',
    );
  });
});

/**
 * A15.5: the view icons stop drawing their own row and become a corner
 * overlay instead — a dedicated `border-line border-b` strip cost a full
 * line of height on every render whether or not the operator ever pressed
 * one. What survives is everything the row already guaranteed (real
 * `<button>`s, `aria-pressed`, `aria-label`, reachable by Tab — covered
 * above) plus two new properties an overlay specifically owes: it must not
 * steal clicks or hover off the content it floats above, and it must not be
 * able to balloon wide enough to cover a narrow pane's whole width.
 */
describe('A15.5: the view icons are a corner overlay, not a reserved row', () => {
  it('positions the icon cluster out of flow, so it reserves no row of its own', () => {
    draw();
    const overlay = q<HTMLElement>('[data-view-overlay]');
    expect(overlay, 'the overlay wrapper').not.toBeNull();
    expect(overlay?.className).toContain('absolute');
    // The dedicated row this replaces drew a full-width bottom border to
    // separate itself from the scrolling column below it -- exactly the
    // reserved space A15.5 asks to stop paying for.
    expect(overlay?.className ?? '').not.toContain('border-b');
  });

  it('lets clicks and hover fall through its own empty area to the content underneath', () => {
    draw();
    // The wrapper is inert everywhere except where the icons themselves
    // paint: `pointer-events-none` on the corner box, opted back into on the
    // nav that actually draws the buttons.
    expect(q<HTMLElement>('[data-view-overlay]')?.className).toContain('pointer-events-none');
    expect(q<HTMLElement>('[data-view-tabs]')?.className).toContain('pointer-events-auto');
  });

  it('caps its own width, so it cannot cover a narrow pane edge to edge', () => {
    draw();
    // A corner cluster, not a bar: bounded to its own content plus a fixed
    // margin from the pane's edge, never `inset-x-0`/`w-full`, which is what
    // let the old row span the whole pane on purpose.
    const className = q<HTMLElement>('[data-view-overlay]')?.className ?? '';
    expect(className).not.toContain('inset-x-0');
    expect(className).not.toContain('w-full');
    expect(className).toMatch(/max-w-/);
  });

  it('still truncates a long refusal instead of growing the overlay past its cap', () => {
    // The refusal ARRIVES AS A PROP now — the canvas owns the keystroke that
    // raises it, since `Alt+<digit>` became a real binding. The wording is
    // the canvas's own, longest form, which is the case this cap is for.
    draw({ terminal: false, viewNote: 'no view 5 — only 3 shown (Response, PRs, Agents)' });
    const note = q<HTMLElement>('[data-view-note]');
    expect(note).not.toBeNull();
    expect(note?.className ?? '').toMatch(/max-w-/);
    expect(note?.className ?? '').toContain('truncate');
  });

  it('still switches views by click once overlaid — the move did not break the control', () => {
    draw({ terminal: true });
    fireEvent.click(q<HTMLButtonElement>('[data-view="terminal"]') as HTMLButtonElement);
    expect(q<HTMLElement>('[data-view="terminal"]')?.getAttribute('aria-pressed')).toBe('true');
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

  const agentsTab = () => q<HTMLButtonElement>('[data-view="agents"]');
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
    expect(all('[data-view]').map((t) => t.tagName)).toEqual([
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
    expect(agentsTab()?.getAttribute('aria-pressed')).toBe('false');

    openAgents();

    expect(q('[data-agents]')).not.toBeNull();
    expect(q('[data-detail-block="out"]')).toBeNull();
    expect(q('[data-detail-block="in"]')).toBeNull();
    expect(agentsTab()?.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(q<HTMLButtonElement>('[data-view="response"]') as HTMLButtonElement);
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
    // `agents` absent, per model.ts: factory reports a live count and
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

/**
 * WHICH TURNS THE `!` LIST DRAWS FROM.
 *
 * The operator reported that typing `!` showed nothing. It was not missing:
 * the list was sourced from the FOCUSED turn alone, and the focused turn is
 * the newest one unless `h`/`l` moved -- the turn that has just answered,
 * which is exactly the turn least likely to have proposed a command yet. So
 * the feature was invisible on the ordinary session while working perfectly on
 * the one turn in twenty that happened to carry one.
 *
 * The column draws the whole session now, so the source is the whole column:
 * the focused turn first (it is the one being read, so it is the one being
 * reached for), then every other turn newest-first. Everything the operator
 * can scroll to, they can complete.
 */
describe('the ! list is drawn from every turn in the column, not the focused one alone', () => {
  const withCommands = (id: string, commands: Command[]): Decision => ({
    id,
    label: `step ${id}`,
    input: `ask ${id}`,
    output: 'answered',
    commands,
  });

  const suggested = () =>
    all('[data-bang-suggestion]').map((row) =>
      (row.querySelector('[data-bang-command]')?.textContent ?? '').trim(),
    );
  const box = () =>
    q<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]') as HTMLTextAreaElement;

  /** A session whose turns are newest-first, like the real source's. */
  const sessionOf = (decisions: readonly Decision[]): SessionEntry => ({
    project: PROJECT,
    session: { ...SESSION, decisions },
  });

  function Composer(props: { readonly entry: SessionEntry; readonly decision: Decision | null }) {
    const [draft, setDraft] = useState('');
    return (
      <DetailPanel
        entry={props.entry}
        decision={props.decision}
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

  function type(text: string) {
    fireEvent.change(box(), { target: { value: text } });
  }

  it('offers an older turn’s command while the focused turn has none', () => {
    // THE REPORTED BUG, as a test. `d5` is newest and proposes nothing, which
    // is the ordinary shape of a session that has just answered.
    const decisions = [
      withCommands('d5', []),
      withCommands('d4', [{ id: 'c1', label: 'push', command: 'git push -u origin work' }]),
    ];
    render(<Composer entry={sessionOf(decisions)} decision={decisions[0] as Decision} />);
    type('!');
    expect(suggested()).toEqual(['git push -u origin work']);
  });

  it('puts the focused turn first and the rest newest-first behind it', () => {
    const decisions = [
      withCommands('d5', [{ id: 'a', label: 'newest', command: 'echo newest' }]),
      withCommands('d4', [{ id: 'b', label: 'focused', command: 'echo focused' }]),
      withCommands('d3', [{ id: 'c', label: 'oldest', command: 'echo oldest' }]),
    ];
    render(<Composer entry={sessionOf(decisions)} decision={decisions[1] as Decision} />);
    type('!echo');
    expect(suggested()).toEqual(['echo focused', 'echo newest', 'echo oldest']);
  });

  it('shows a command proposed by two turns once, not twice', () => {
    // Agents repeat "run the gate" every round. A list that repeated with them
    // would push the rest of the session off the bottom of the popover.
    const repeated = { id: 'gate', label: 'rerun the gate', command: 'pnpm -s test' };
    const decisions = [
      withCommands('d5', [repeated]),
      withCommands('d4', [{ ...repeated, id: 'gate-again', label: 'run the gate again' }]),
    ];
    render(<Composer entry={sessionOf(decisions)} decision={null} />);
    type('!');
    expect(suggested()).toEqual(['pnpm -s test']);
  });

  it('caps the list and says how many it is not drawing', () => {
    // TRUNCATION IS DISCLOSED, NEVER SILENT. A long session can propose
    // dozens; a popover that showed a cropped list with no sign of it would
    // teach the operator that what they see is all there is.
    const decisions = Array.from({ length: 12 }, (_, i) =>
      withCommands(`d${i}`, [{ id: `c${i}`, label: `step ${i}`, command: `echo ${i}` }]),
    );
    render(<Composer entry={sessionOf(decisions)} decision={null} />);
    type('!');
    expect(suggested()).toHaveLength(8);
    expect(q('[data-bang-more]')?.textContent ?? '').toContain('4 more');
    // And narrowing gets rid of the note rather than leaving it standing.
    // (No space in the query: `bangQuery` stops the list at the first one.)
    type('!11');
    expect(suggested()).toEqual(['echo 11']);
    expect(q('[data-bang-more]')).toBeNull();
  });

  /**
   * WHAT GOES IN IS WHAT WAS SHOWN, character for character.
   *
   * This is the one assertion in the file that is about SAFETY rather than
   * about a list. Since `deliver.ts`, a recorded prompt really is appended to
   * a live session, so a completed `!` line is a bash command a running agent
   * will run. The operator reads the row and presses Enter; if the row and the
   * insertion could ever differ -- a clip for the column's width, a shell
   * escape, a normalised quote -- they would be approving one command and
   * sending another.
   *
   * Written against the RENDERED row rather than against the fixture, which is
   * what makes it more than a restatement: a change that cropped the row would
   * pass a fixture comparison and fail this one.
   */
  it('inserts exactly the characters the row displayed, however long they are', () => {
    const long =
      'osascript -e \'tell application "Terminal" to do script "cd /w/x && pnpm -s test"\'';
    const decisions = [withCommands('d5', [{ id: 'c1', label: 'open a terminal', command: long }])];
    render(<Composer entry={sessionOf(decisions)} decision={null} />);
    type('!osa');
    const shown = (
      all('[data-bang-suggestion]')[0]?.querySelector('[data-bang-command]')?.textContent ?? ''
    ).trim();
    expect(shown).toBe(long);
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(box().value).toBe(`!${shown}`);
  });
});

/** The `/` typeahead: `session.slashCommands`, built like `!` above. */
describe('the / typeahead offers the provider’s own commands', () => {
  const SLASH_COMMANDS = [
    { id: 'compact', name: 'compact', description: 'summarise the conversation so far' },
    { id: 'notify', name: 'notify', description: 'toggle a push notification' },
    { id: 'review', name: 'review', description: null },
  ];
  const ENTRY_WITH_SLASH: SessionEntry = {
    project: PROJECT,
    session: { ...SESSION, slashCommands: SLASH_COMMANDS },
  };

  const suggestedNames = () =>
    all('[data-slash-suggestion]').map((row) =>
      (row.querySelector('[data-slash-command]')?.textContent ?? '').trim().replace(/^\//, ''),
    );
  const selectedNames = () =>
    all('[data-slash-suggestion]')
      .filter((row) => row.getAttribute('data-selected') === 'true')
      .map((row) =>
        (row.querySelector('[data-slash-command]')?.textContent ?? '').trim().replace(/^\//, ''),
      );
  const box = () =>
    q<HTMLTextAreaElement>('textarea[aria-label="prompt to session"]') as HTMLTextAreaElement;

  function Composer(props: { readonly onSubmit: () => void; readonly entry?: SessionEntry }) {
    const [draft, setDraft] = useState('');
    return (
      <DetailPanel
        entry={props.entry ?? ENTRY_WITH_SLASH}
        decision={null}
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

  function type(text: string) {
    fireEvent.change(box(), { target: { value: text } });
  }

  function composer(entry?: SessionEntry) {
    const sent: string[] = [];
    render(<Composer onSubmit={() => sent.push('sent')} entry={entry} />);
    return sent;
  }

  it('draws nothing for a source with no configured commands', () => {
    // `ENTRY` carries no `slashCommands` at all -- constraint 2: never invent
    // a list the source did not hand over.
    composer(ENTRY);
    type('/');
    expect(q('[data-slash-suggest]')).toBeNull();
  });

  it('opens only at line start, and narrows on the name or description typed after', () => {
    composer();
    type('ship it');
    expect(q('[data-slash-suggest]')).toBeNull();
    type('run this /'); // mid-word, same rule `!` follows
    expect(q('[data-slash-suggest]')).toBeNull();
    type('run this\n/');
    expect(suggestedNames()).toEqual(['compact', 'notify', 'review']);
    type('run this\n/push');
    expect(suggestedNames()).toEqual(['notify']);
    type('run this\n/zzz');
    expect(q('[data-slash-suggest]')).toBeNull();
  });

  it('writes the picked command into the prompt, keeping the / and the caret after it', () => {
    composer();
    type('/comp');
    fireEvent.click(all('[data-slash-suggestion]')[0] as HTMLElement);
    expect(box().value).toBe('/compact');
    expect(q('[data-slash-suggest]')).toBeNull();
  });

  it('accepts on Enter, sending nothing, and walks the list with arrow keys', () => {
    const sent = composer();
    type('/');
    expect(selectedNames()).toEqual(['compact']);
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(selectedNames()).toEqual(['notify']);
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(sent).toEqual([]);
    expect(box().value).toBe('/notify');
  });

  it('never opens both lists at once, since a token cannot start with ! and / together', () => {
    composer();
    type('!');
    expect(q('[data-bang-suggest]')).toBeNull(); // no decision commands on this fixture
    type('/');
    expect(q('[data-slash-suggest]')).not.toBeNull();
    expect(q('[data-bang-suggest]')).toBeNull();
  });

  /**
   * THE TWO UNKNOWNS, ON SCREEN. `pull-requests.ts:12-14` states the rule and
   * this is the place it is either kept or broken: the `/` list has tiers that
   * fail differently, and the one made of BUILT-INS is not files -- vam has to
   * ask the installed CLI for it, and that question can fail. A list fifty
   * entries short with nothing said about it is "vam could not read the
   * commands" wearing "no commands match"'s clothes.
   */
  describe('a list vam could not fully read says so', () => {
    const GAP = { code: 'cli-missing', message: 'no `claude` on PATH, so vam cannot list its own' };
    const withGap = (commands = SLASH_COMMANDS): SessionEntry => ({
      project: PROJECT,
      session: { ...SESSION, slashCommands: commands, slashCommandGap: GAP },
    });

    it('draws nothing at all when nothing matches and nothing failed', () => {
      // THE OTHER UNKNOWN, pinned so the two cannot converge: a query with no
      // answer closes the box, and says nothing, because there is nothing to
      // say.
      composer();
      type('/zzz');
      expect(q('[data-slash-suggest]')).toBeNull();
      expect(q('[data-slash-gap]')).toBeNull();
    });

    it('says why the list is short when a query finds nothing and a tier failed', () => {
      composer(withGap());
      type('/zzz');
      expect(q('[data-slash-suggest]')).toBeNull();
      expect(q('[data-slash-gap]')?.textContent ?? '').toContain('no `claude` on PATH');
    });

    it('still says it while the list has matches to offer', () => {
      // A short list that works is the dangerous case: it looks complete.
      composer(withGap());
      type('/');
      expect(suggestedNames()).toEqual(['compact', 'notify', 'review']);
      expect(q('[data-slash-gap]')?.textContent ?? '').toContain('no `claude` on PATH');
    });

    it('says nothing when the source read every tier it has', () => {
      composer();
      type('/');
      expect(suggestedNames()).toHaveLength(3);
      expect(q('[data-slash-gap]')).toBeNull();
    });

    it('caps the list and counts what it is not drawing', () => {
      // The CLI's own list runs to fifty-odd commands. Unbounded, the popover
      // becomes a page floating over the composer, and a page cropped without
      // saying so is a page that lies about its own length.
      const many = Array.from({ length: 12 }, (_, i) => ({
        id: `builtin:c${i}`,
        name: `wombat${i}`,
        description: null,
      }));
      composer({ project: PROJECT, session: { ...SESSION, slashCommands: many } });
      type('/wombat');
      expect(suggestedNames()).toHaveLength(8);
      expect(q('[data-slash-more]')?.textContent ?? '').toContain('4 more');
      type('/wombat11');
      expect(suggestedNames()).toEqual(['wombat11']);
      expect(q('[data-slash-more]')).toBeNull();
    });
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
  /**
   * ONE TURN, AND IT IS THIS ONE. The pane draws every turn the SESSION
   * carries, so an ad-hoc `decision` beside the five-turn shared fixture put
   * five other turns on screen and none of them was the one under test.
   *
   * ACTIVITY WITHHELD, because this block is about `noAnswerNote`. Now that the
   * turn under test IS the session's newest, a running session draws its live
   * caption on it -- and that caption prefers the session's own `activity`,
   * which the shared fixture has. Leaving it in would have measured the caption
   * instead of the sentence underneath it.
   */
  const show = (output: string | null, s: Session['status'] = SESSION.status) => {
    const only = withOutput(output);
    draw({
      decision: only,
      entry: {
        project: PROJECT,
        session: { ...SESSION, status: s, activity: null, decisions: [only] },
      },
    });
  };

  it('renders an explicit line for an empty answer rather than blank space', () => {
    // `''` is a distinct state: a turn that resolved to nothing. But `'' !==
    // null`, so `OutText` ran, `splitAnswers('')` filtered every block out as
    // empty, and the operator got an `OUT` rule over blank space --
    // indistinguishable from a failed render.
    expect(splitAnswers('')).toEqual([]);
    show('');
    expect(all('[data-out-line]')).toHaveLength(0);
    const note = q<HTMLElement>('[data-out-empty]');
    expect(note?.textContent ?? '').toContain('nothing');
  });

  it('says "still running" only for a session that is running', () => {
    show(null, 'running');
    expect(q<HTMLElement>('[data-out-empty]')?.textContent ?? '').toContain('still running');
  });

  it('tells a done or failed session the turn ended without an answer', () => {
    // `to-canvas.ts` sets `null` whenever a turn collected zero answer events,
    // whatever the status -- so a finished session was told to keep waiting
    // for something that will never arrive.
    for (const s of ['done', 'failed'] as const) {
      cleanup();
      show(null, s);
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
    // WITHIN THAT TURN. The column draws the newest turn as well, and it is
    // the one the caption belongs to -- scoping to the document would now be
    // asserting that a running session never animates at all.
    const older = q<HTMLElement>('[data-column-turn][data-turn-current="true"]') as HTMLElement;
    expect(older).not.toBeNull();
    expect([...older.querySelectorAll('[data-out-empty]')]).toHaveLength(0);
    expect(older.querySelector('[data-out-empty] [data-out-running]')).toBeNull();
    expect(older.textContent ?? '').not.toContain('editing transcript.ts');
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
  ) => {
    // ONE TURN, AND IT IS THE ONE ON TRIAL. The pane draws every turn the
    // SESSION carries now, so handing it an ad-hoc `decision` beside the
    // five-turn shared fixture drew five turns none of which had this output.
    const only = turn(output);
    draw({
      entry: {
        project: PROJECT,
        session: { ...SESSION, status, activity, decisions: [only] },
      },
      decision: only,
    });
  };
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
    // ON THIS TURN, which is the whole claim. The column draws the newest turn
    // too, and that one IS live and correctly carries the line -- asserting
    // over the whole document would now be asserting that a running session
    // never says it is running.
    const older = q<HTMLElement>('[data-column-turn][data-turn-current="true"]') as HTMLElement;
    expect(older).not.toBeNull();
    expect([...older.querySelectorAll('[data-out-live]')]).toHaveLength(0);
    expect([...older.querySelectorAll('[data-out-running]')]).toHaveLength(0);
    expect(older.textContent ?? '').not.toContain('editing transcript.ts');
    // And the live line is where it belongs: on the newest turn, once.
    expect(all('[data-out-live]')).toHaveLength(1);
    expect(q<HTMLElement>('[data-column-turn][data-turn-newest] [data-out-live]')).not.toBeNull();
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

  const prsTab = () => q<HTMLButtonElement>('[data-view="prs"]');
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
    expect(prsTab()?.getAttribute('aria-pressed')).toBe('false');

    openPrs();

    expect(q('[data-prs]')).not.toBeNull();
    expect(q('[data-detail-block="out"]')).toBeNull();
    expect(q('[data-agents]')).toBeNull();
    expect(prsTab()?.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(q<HTMLButtonElement>('[data-view="response"]') as HTMLButtonElement);
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
    fireEvent.click(q<HTMLButtonElement>('[data-view="agents"]') as HTMLButtonElement);
    fireEvent.click(q<HTMLButtonElement>('[data-view="prs"]') as HTMLButtonElement);
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
        // This stub never asked tmux, and `unreadable` is what that is.
        cursor: { kind: 'unreadable' },
      }),
    );
    withBridge(read);
    draw();

    await act(async () => {
      fireEvent.click(q<HTMLButtonElement>('[data-view="terminal"]') as HTMLButtonElement);
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
    fireEvent.click(q<HTMLButtonElement>('[data-view="response"]') as HTMLButtonElement);
    await act(async () => {
      await Promise.resolve();
    });
    // Unmounted, so the interval is cleared with it: leaving the tab stops the
    // spawning, exactly as closing it never started any.
    expect(q('[data-terminal]')).toBeNull();
    expect(read).toHaveBeenCalledTimes(whileOpen);
  });

  it('hands the tab the SEND half of the bridge, not just the read half', async () => {
    // The wiring, pinned where it is done. `send` is passed at this call site
    // beside `read` and `resize` rather than reached for inside the tab, and
    // an invisible prop is one a later edit drops in silence: without this
    // test, deleting it would leave a pane that takes focus, accepts every
    // keystroke and delivers none of them, with every other test still green.
    const read = vi.fn(
      async (): Promise<PaneView> => ({
        kind: 'ok',
        name: 'vam-sprint-board-reorder-a1b2c3',
        text: 'the pane',
        // This stub never asked tmux, and `unreadable` is what that is.
        cursor: { kind: 'unreadable' },
      }),
    );
    const send = vi.fn(async () => 'sent' as const);
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { terminal: { read, send } },
    });
    draw();

    await act(async () => {
      fireEvent.click(q<HTMLButtonElement>('[data-view="terminal"]') as HTMLButtonElement);
      await Promise.resolve();
    });
    const pane = q<HTMLElement>('[data-terminal-pane]');
    await act(async () => {
      fireEvent.keyDown(pane as HTMLElement, { key: 'h' });
      await Promise.resolve();
    });
    // The row travels with it, as it does for the read: the session typed
    // into has to be the session whose screen is on the tab.
    expect(send).toHaveBeenCalledWith(PROJECT.id, { kind: 'text', text: 'h' }, SESSION.id);
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
    expect(q('[data-view="terminal"]')).toBeNull();
    expect(all('[data-view]').map((t) => t.getAttribute('data-view'))).not.toContain('terminal');
  });

  it('keeps it for a source that has one', () => {
    draw({ terminal: true });
    expect(q('[data-view="terminal"]')).not.toBeNull();
  });

  it('falls back to Response when the showing tab is withdrawn', () => {
    // Reachable: the operator opens Terminal, then focus moves to a session
    // from a source without one. A tab bar with nothing selected and a pane
    // drawing a withdrawn tab is the state this prevents.
    const { rerender } = drawFor({ terminal: true });
    fireEvent.click(q<HTMLButtonElement>('[data-view="terminal"]') as HTMLButtonElement);
    expect(q('[data-terminal]')).not.toBeNull();
    rerender({ terminal: false });
    expect(q('[data-terminal]')).toBeNull();
    expect(q<HTMLElement>('[data-view="response"]')?.getAttribute('aria-pressed')).toBe('true');
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
    fireEvent.click(q<HTMLButtonElement>('[data-view="terminal"]') as HTMLButtonElement);

  it('draws the prompt box, the mode row and the attach button on Response', () => {
    withBridge();
    draw();
    expect(q('[data-prompt-box]')).not.toBeNull();
    expect(q('[data-mode-toggle]')).not.toBeNull();
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
    expect(q('[data-mode-toggle]')).toBeNull();
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
    fireEvent.click(q<HTMLButtonElement>('[data-view="response"]') as HTMLButtonElement);
    // The draft lives above this pane, so leaving the tab cannot have eaten
    // it: hiding the box may not cost the operator what they had typed.
    expect(q<HTMLTextAreaElement>('textarea')?.value).toBe('half a sentence');
  });

  it('keeps the composer on the other tabs, which are still about the answer', () => {
    // Only Terminal. PRs and Agents are read alongside a reply being written,
    // and nothing about them makes the prompt box the wrong place to type.
    withBridge();
    draw();
    fireEvent.click(q<HTMLButtonElement>('[data-view="prs"]') as HTMLButtonElement);
    expect(q('[data-prompt-box]')).not.toBeNull();
    fireEvent.click(q<HTMLButtonElement>('[data-view="agents"]') as HTMLButtonElement);
    expect(q('[data-prompt-box]')).not.toBeNull();
  });
});

/** The `out` text size is a pref, put on the document root and consumed as
 *  the ROOT of `out`'s `em` scale (`out-font-size.test.tsx` pins the scale).
 *  What matters here is that exactly one element PER TURN reads it: a second
 *  inside one turn would make part of that answer scale twice, and none would
 *  make the setting inert. One per turn rather than one per pane since the
 *  column draws them all -- what would be wrong is a count that does not match
 *  the turns, which is what this compares. */
describe('the out text size roots on the out container and nowhere else', () => {
  it('is worn by the out scroll containers alone, one per turn', () => {
    draw();
    const turns = all('[data-column-turn]');
    expect(turns.length).toBeGreaterThan(1);
    const wearing = all('*').filter((el) => el.className.toString().includes(OUT_FONT_SIZE_VAR));
    expect(wearing).toHaveLength(turns.length);
    for (const el of wearing) expect(el.getAttribute('data-detail-scroll')).toBe('out');
    // The prompt above each answer keeps the sizes it was drawn with.
    for (const block of all('[data-detail-block="in"]')) {
      expect(block.className.toString()).not.toContain(OUT_FONT_SIZE_VAR);
    }
  });
});

/**
 * THE SIXTH OPERATOR REQUEST ON THIS PANE, AND THE LAST ONE THAT SHOULD NEED A
 * TEST HERE.
 *
 * This block used to hold `EXPECTED_SIZE_COUNTS`: a per-size ledger of every
 * literal `text-[Npx]` in `DetailPanel.tsx`, kept exact so that a missed call
 * site reddened. It was the right shape for a one-file sweep and it is the
 * wrong shape now — the file has no literal sizes left. Every one of its sixty
 * is a role on the named scale (`styles.css`, `--text-meta` / `--text-control`
 * / `--text-body` / `--text-heading`), and the ledger has moved to
 * `test/renderer/type-scale.test.ts`, which asks the same question of the
 * WHOLE renderer rather than of this file: no raw `text-[Npx]` outside four
 * named exceptions, and nothing under the 11px floor.
 *
 * What stays here is the half that ledger could never do, because it is about
 * `out` and `out` is not a class in this file at all: the answer text is sized
 * by the operator's own pref (`DEFAULT_OUT_FONT_SIZE`, `OUT_FONT_SIZE_VAR`)
 * and must not move a pixel because of a change to the type around it. A
 * check that only asserted a sibling moved would still pass with `out`
 * dragged along, so both halves are asserted together.
 */
describe('the scale reaches this pane, and out is still the operator’s to set', () => {
  it('RENDERED: a representative sibling is on the scale, and carries no literal size', () => {
    draw();
    // `data-model-request` sat beside the composer at 11px — a literal, and
    // the thing the previous ledger pinned. It is `control` now, which is the
    // step a text input takes. Reverting it in `DetailPanel.tsx` alone must
    // redden this line.
    const model = q<HTMLElement>('[data-model-request]');
    expect(model?.className).toContain('text-control');
    expect(model?.className).not.toMatch(/text-\[\d/);
  });

  it('RENDERED: the out container is byte-for-byte the var()-driven class it was', () => {
    draw();
    // Unchanged by anything above, because it was never a literal px class to
    // convert: the pref writes `--vam-out-font-size` and this reads it. The
    // `12px` fallback is the value a document with no pref applied resolves
    // to, and it is deliberately NOT the scale's `body` — `prefs.ts` owns that
    // default (`DEFAULT_OUT_FONT_SIZE`) and a second spelling of it here would
    // be a second answer.
    const out = q<HTMLElement>('[data-detail-scroll="out"]');
    expect(out?.className).toContain('text-[length:var(--vam-out-font-size,12px)]');
  });

  it('SOURCE: no literal text-[Npx] is left in this file at all', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/renderer/panels/DetailPanel.tsx'),
      'utf8',
    );
    // The out container's own `text-[length:var(...)]` and `OUT_MARKDOWN`'s
    // `em`-scaled classes both fail this pattern by construction — neither is
    // a bare `text-[<digits>px]` — so nothing has to be excluded by hand.
    const found = [...source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].map((m) => m[1] as string);
    expect(found).toEqual([]);
    // And the file really did reach for the scale, rather than losing its type
    // classes: a count, so that deleting sixty classes cannot pass as
    // converting them.
    const roles = [...source.matchAll(/text-(meta|control|body|heading)\b/g)];
    expect(roles.length).toBeGreaterThanOrEqual(60);
  });
});
