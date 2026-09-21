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
 * WHAT IS ASSERTED HERE, and why each is the assertion and not a proxy:
 *   - the mark is drawn BEFORE the title, on the row, for every source;
 *   - two sources draw two DIFFERENT shapes -- the operator's whole ask is
 *     telling them apart, and a test that only checked "a mark is present"
 *     would pass with one glyph drawn twice;
 *   - a source vam has no mark for still draws the neutral one, present and
 *     non-blank: the honest answer to a third source that has not arrived yet;
 *   - the lane is a constant, so the title's left edge is the same on a Claude
 *     row and on a Codex row and on an unknown one;
 *   - the mark is DECORATIVE. It is the same fact on every row of a project,
 *     and a screen reader reading "claude-code" before each of twelve titles
 *     is the row ornament that costs the most and says the least.
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
  it('draws a mark for every source, ahead of the title', () => {
    const { container } = mount([entry('claude-code'), entry('codex'), entry('a-third-thing')]);
    for (const id of ['s-claude-code', 's-codex', 's-a-third-thing']) {
      const row = container.querySelector(`[data-session-row="${id}"]`);
      expect(row, `no row for ${id}; every assertion below would be vacuous`).not.toBe(null);
      const mark = row?.querySelector('[data-row-source]');
      const title = row?.querySelector('[data-row-title]');
      expect(mark, `${id} draws no provider mark`).not.toBe(null);
      expect(title, `${id} draws no title`).not.toBe(null);
      // DOCUMENT_POSITION_FOLLOWING: the title comes after the mark. The
      // operator asked for "an icon before each session", and "before" is a
      // fact about order, not about the mark merely existing somewhere.
      expect(
        (mark as Element).compareDocumentPosition(title as Element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        `${id} draws its mark after the title`,
      ).toBeTruthy();
      expect((mark as Element).querySelector('svg'), `${id} draws an empty lane`).not.toBe(null);
    }
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

  it('keeps one lane whatever answered, so the title starts in the same place', () => {
    const { container } = mount([entry('claude-code'), entry('codex'), entry(undefined)]);
    const lanes = [...container.querySelectorAll('[data-row-source]')];
    expect(lanes.length, 'no lanes found; the widths below would be vacuous').toBe(3);
    for (const lane of lanes) {
      expect((lane as HTMLElement).style.width).toBe(`${PROVIDER_LANE_PX}px`);
    }
  });

  it('reserves the lane for an entry that names no source at all', () => {
    const { container } = mount([entry(undefined)]);
    const lane = markIn(container, 's-none');
    expect(lane, 'a sourceless row skipped the lane and moved its title').not.toBe(null);
    // Nothing is drawn in it: vam does not know, and a glyph here would be a
    // claim. The WIDTH is what the row owes its neighbours, not a mark.
    expect(lane?.querySelector('svg')).toBe(null);
  });

  it('is decorative: it never reads the provider aloud before the title', () => {
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
