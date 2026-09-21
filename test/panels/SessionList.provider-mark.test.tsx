// @vitest-environment happy-dom

/**
 * THE PROVIDER MARK ON A SIDEBAR ROW: which agent ran this session.
 *
 * vam has two sources now -- Claude Code and Codex -- and until this mark
 * existed a row said nothing about which one it came from. Two projects can
 * carry the same directory basename (`vam` read by Claude Code and `vam` read
 * by Codex are two project rows with one name), so the heading does not answer
 * it either.
 *
 * THIS IS NOT THE SESSION ICON COMING BACK. `SessionList.icon.test.tsx` pins
 * the operator's own removal of that one -- a per-session emoji that repeated
 * the project's mark down a narrow column and said nothing the heading had not
 * said already. This mark says something no other part of the row says, and it
 * says it in a lane whose width does not depend on which source answered.
 *
 * ── IT MOVED DOWN A LINE ──────────────────────────────────────────────────
 * It was drawn on the TITLE line, paired with the status mark. The operator
 * moved it: "in the sidebar, put the provider glyph before the branch name,
 * under the session name." So the title line is the status mark and the title,
 * and the meta line below it opens with the provider and then names the
 * branch -- two facts about where the work came from, read together. The
 * title gets its 18px back at the 200px sidebar minimum, which is the width
 * `e2e/provider-mark-shots.mjs` had measured the ornament costing it.
 *
 * WHAT IS ASSERTED HERE, and why each is the assertion and not a proxy:
 *   - the mark is on the META line and NOT on the title line, and it is the
 *     first thing on it -- ahead of the branch glyph and the branch name.
 *     Asserted as DOM ORDER against the branch, not as mere presence
 *     somewhere in the row, because "before the branch name" is the whole of
 *     what was asked for;
 *   - on BOTH rows. The phone draws its own meta line (`data-row-meta`) and
 *     the desktop another (`data-row-meta-line`), so either could have been
 *     moved alone and looked right in the surface its author was watching;
 *   - two sources draw two DIFFERENT shapes -- the operator's whole ask is
 *     telling them apart, and a test that only checked "a mark is present"
 *     would pass with one glyph drawn twice;
 *   - a source vam has no mark for still draws the neutral one, present and
 *     non-blank: the honest answer to a third source that has not arrived yet;
 *   - the lane is a constant, so the branch name starts in the same place on a
 *     Claude row and on a Codex row and on an unknown one;
 *   - the mark is DECORATIVE. It is the same fact on every row of a project,
 *     and a screen reader reading "claude-code" before each of twelve titles
 *     is the row ornament that costs the most and says the least.
 *
 * WHAT THIS FILE STILL CANNOT SAY is that the mark PAINTS before the branch:
 * `order-last` moves a flex item and leaves the DOM alone, and this file was
 * falsified that way once already. `e2e/provider-mark-shots.mjs` compares
 * rectangles in Chromium, which is the only answer to "before".
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project, Session, SourceId } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { PROVIDER_LANE_PX, SessionList } from '../../src/renderer/panels/SessionList.js';
import { baseProps, makeProject, makeSession } from './session-list-props.js';

afterEach(cleanup);

function entry(source: string | undefined, over: Partial<Session> = {}): SessionEntry {
  // The shared fixture stamps `factory` by default, so a sourceless entry has
  // to have the key REMOVED rather than merely not passed -- otherwise the
  // "reserves the lane for an entry that names no source" test below would be
  // asserting about a factory row and would pass for the wrong reason.
  const { source: _stamped, ...bare } = makeProject({
    id: `p-${source ?? 'none'}`,
    name: `repo-${source ?? 'none'}`,
  });
  const project: Project = source === undefined ? bare : { ...bare, source: source as SourceId };
  return { project, session: makeSession({ id: `s-${source ?? 'none'}`, ...over }) };
}

function mount(entries: readonly SessionEntry[], over: Record<string, unknown> = {}) {
  return render(<SessionList {...baseProps(entries)} {...over} />);
}

const markIn = (container: HTMLElement, sessionId: string) =>
  container
    .querySelector(`[data-session-row="${sessionId}"]`)
    ?.querySelector('[data-row-source]') ?? null;

describe('the provider mark on a session row', () => {
  it('draws a mark for every source, first on the meta line and ahead of the branch', () => {
    const { container } = mount([entry('claude-code'), entry('codex'), entry('a-third-thing')]);
    for (const id of ['s-claude-code', 's-codex', 's-a-third-thing']) {
      const row = container.querySelector(`[data-session-row="${id}"]`);
      expect(row, `no row for ${id}; every assertion below would be vacuous`).not.toBe(null);
      const line = row?.querySelector('[data-row-meta-line]');
      const mark = row?.querySelector('[data-row-source]');
      const branch = row?.querySelector('[data-session-branch]');
      expect(line, `${id} draws no meta line`).not.toBe(null);
      expect(mark, `${id} draws no provider mark`).not.toBe(null);
      expect(branch, `${id} draws no branch cell`).not.toBe(null);
      expect(line?.contains(mark as Node), `${id} draws its mark off the meta line`).toBe(true);
      // DOCUMENT_POSITION_FOLLOWING: the branch comes after the mark. The
      // operator asked for the glyph "before the branch name", and "before"
      // is a fact about order, not about the mark existing somewhere on the
      // line.
      expect(
        (mark as Element).compareDocumentPosition(branch as Element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        `${id} draws its mark after the branch name`,
      ).toBeTruthy();
      // FIRST on the line, not merely somewhere before the branch: the branch
      // cell is the line's own first child, and the mark opens it.
      expect(line?.firstElementChild?.firstElementChild, `${id} does not open its meta line`).toBe(
        mark,
      );
      expect((mark as Element).querySelector('svg'), `${id} draws an empty lane`).not.toBe(null);
    }
  });

  it('has left the title line entirely -- the status mark is alone up there now', () => {
    // The move, stated as the thing that must NOT be true any more. Drawing
    // the mark in both places would satisfy every "it is on the meta line"
    // assertion above and give the operator two glyphs per row.
    const { container } = mount([entry('claude-code')]);
    const title = container.querySelector('[data-row-title]');
    const titleLine = title?.parentElement ?? null;
    expect(titleLine, 'no title line').not.toBe(null);
    expect(
      titleLine?.querySelector('[data-row-source]'),
      'the mark is still on the title line',
    ).toBe(null);
    expect(container.querySelectorAll('[data-row-source]').length, 'the row drew two marks').toBe(
      1,
    );
    // And the status mark stayed: the pairing wrapper collapsed around it
    // rather than taking it along.
    expect(titleLine?.querySelector('[data-status-mark]')).not.toBe(null);
  });

  it('gives Claude Code and Codex two different shapes, not one glyph twice', () => {
    const { container } = mount([entry('claude-code'), entry('codex')]);
    const claude = markIn(container, 's-claude-code');
    const codex = markIn(container, 's-codex');
    expect(claude?.getAttribute('data-source-mark')).toBe('brand');
    expect(codex?.getAttribute('data-source-mark')).toBe('native');
    // The registers differing is not enough: the whole ask is that the two
    // rows LOOK different, so the drawn geometry is what is compared.
    const drawn = (node: Element | null) => node?.querySelector('svg')?.innerHTML ?? '';
    expect(drawn(claude).length, 'the claude-code row drew nothing').toBeGreaterThan(0);
    expect(drawn(codex).length, 'the codex row drew nothing').toBeGreaterThan(0);
    expect(drawn(claude)).not.toBe(drawn(codex));
  });

  it('draws the neutral mark -- not another provider’s -- for a source it has never heard of', () => {
    const { container } = mount([entry('claude-code'), entry('some-agent-from-2027')]);
    const unknown = markIn(container, 's-some-agent-from-2027');
    expect(unknown?.getAttribute('data-source-mark')).toBe('neutral');
    // Present and non-blank. "It did not crash" is not the property; "it said
    // I do not know this one, with a shape that claims nothing" is.
    expect(unknown?.querySelector('svg')).not.toBe(null);
    const drawn = (node: Element | null) => node?.querySelector('svg')?.innerHTML ?? '';
    expect(drawn(unknown)).not.toBe(drawn(markIn(container, 's-claude-code')));
  });

  it('keeps one lane whatever answered, so the branch name starts in the same place', () => {
    const { container } = mount([entry('claude-code'), entry('codex'), entry(undefined)]);
    const lanes = [...container.querySelectorAll('[data-row-source]')];
    expect(lanes.length, 'no lanes found; the widths below would be vacuous').toBe(3);
    for (const lane of lanes) {
      expect((lane as HTMLElement).style.width).toBe(`${PROVIDER_LANE_PX}px`);
    }
  });

  it('draws a lane sized for the meta line, not for the title line it came from', () => {
    // 10, beside a 10px `GitBranch` and 11px mono text -- not the 12 it wore
    // next to the status mark and a 13px title. The number is asserted rather
    // than only compared with itself, because "every lane is the same width"
    // is just as true of a lane that is still the old size.
    expect(PROVIDER_LANE_PX).toBe(10);
  });

  it('reserves the lane for an entry that names no source at all', () => {
    const { container } = mount([entry(undefined)]);
    const lane = markIn(container, 's-none');
    expect(lane, 'a sourceless row skipped the lane and moved its branch name').not.toBe(null);
    // Nothing is drawn in it: vam does not know, and a glyph here would be a
    // claim. The WIDTH is what the row owes its neighbours, not a mark.
    expect(lane?.querySelector('svg')).toBe(null);
  });

  it('is decorative: it never reads the provider aloud on the row', () => {
    const { container } = mount([entry('claude-code')]);
    const lane = markIn(container, 's-claude-code');
    expect(lane?.getAttribute('aria-hidden')).toBe('true');
    const row = container.querySelector('[data-session-row="s-claude-code"]');
    // The row is a button; its accessible name is its text. The source id must
    // not be in it, on any of the twelve rows a project can hold.
    expect(row?.textContent ?? '').not.toContain('claude-code');
  });

  it('draws on the phone too -- a provider is a fact a 390px row has as much as a desktop one', () => {
    const { container } = mount([entry('codex')], { phone: true });
    const lane = markIn(container, 's-codex');
    expect(lane, 'the phone row dropped the provider mark').not.toBe(null);
    expect(lane?.getAttribute('data-source-mark')).toBe('native');
  });

  it('opens the phone’s own meta line with it, ahead of the branch there too', () => {
    // The phone draws a DIFFERENT line (`data-row-meta`, with the status word
    // and the age on it); moving only the desktop's would have looked right
    // in whichever surface its author had open.
    const { container } = mount([entry('codex')], { phone: true });
    const row = container.querySelector('[data-session-row="s-codex"]');
    const line = row?.querySelector('[data-row-meta]');
    const lane = markIn(container, 's-codex');
    const branch = row?.querySelector('[data-session-branch]');
    expect(line, 'no phone meta line').not.toBe(null);
    expect(branch, 'no branch on the phone row; the order below would be vacuous').not.toBe(null);
    expect(line?.firstElementChild, 'the mark does not open the phone meta line').toBe(lane);
    expect(
      (lane as Element).compareDocumentPosition(branch as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      'the phone draws its mark after the branch name',
    ).toBeTruthy();
    // And not on the phone's title line either.
    expect(
      row?.querySelector('[data-row-title]')?.parentElement?.querySelector('[data-row-source]'),
    ).toBe(null);
  });

  it('reads the session’s own source ahead of its project’s', () => {
    // `Session.source` and `Project.source` are stamped by different readers
    // and the row must prefer the narrower one -- the same order the status
    // bar's glyph already reads them in.
    const project = makeProject({ id: 'p-mixed', name: 'mixed', source: 'codex' as SourceId });
    const session = makeSession({ id: 's-mixed', source: 'claude-code' as SourceId });
    const { container } = mount([{ project, session }]);
    expect(markIn(container, 's-mixed')?.getAttribute('data-source-mark')).toBe('brand');
  });
});
