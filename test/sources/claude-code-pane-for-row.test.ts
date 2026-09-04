/**
 * Which pane a row is, when two of them are in one project.
 *
 * The rule under test is the whole safety argument of three write paths --
 * reply, close, and the `vamControlled` flag the canvas draws from -- so it is
 * pinned here directly rather than only through the spawns.
 *
 * WHAT WAS BROKEN. The pairing was per PROJECT: one tagged tmux session in the
 * project, one live row in it. Start a second session in the same project and
 * both conditions fail, so both rows became "vam cannot prove it started
 * this": no Terminal screen, and close refused. The published `tmux` field is
 * per SESSION and answers exactly that case.
 *
 * Every id and name below is invented.
 */

import { describe, expect, it } from 'vitest';
import { projectIdOf } from '../../src/main/sources/claude-code/project-id.js';
import { paneForRow } from '../../src/main/sources/claude-code/reply.js';
import type { TmuxSession } from '../../src/main/sources/tmux/spawn.js';

const CWD = '/work/atlas';
const ALPHA = { key: 'sess-alpha#7', sessionId: 'sess-alpha', cwd: CWD };
const BETA = { key: 'sess-beta#8', sessionId: 'sess-beta', cwd: CWD };

const project = projectIdOf(CWD);
/** Two sessions vam started for ONE project -- the case that used to collapse. */
const two: readonly TmuxSession[] = [
  { project, name: 'vam-atlas-aa11bb' },
  { project, name: 'vam-atlas-cc22dd' },
];
const one: readonly TmuxSession[] = [{ project, name: 'vam-atlas-aa11bb' }];

describe('paneForRow with published panes', () => {
  it('gives each of two sessions in one project its own pane', () => {
    const panes = new Map([
      ['sess-alpha', 'vam-atlas-aa11bb'],
      ['sess-beta', 'vam-atlas-cc22dd'],
    ]);
    expect(paneForRow(two, [ALPHA, BETA], ALPHA, panes)).toBe('vam-atlas-aa11bb');
    expect(paneForRow(two, [ALPHA, BETA], BETA, panes)).toBe('vam-atlas-cc22dd');
  });

  it('is null for both of them without the published pairing -- the old behaviour', () => {
    expect(paneForRow(two, [ALPHA, BETA], ALPHA)).toBeNull();
    expect(paneForRow(two, [ALPHA, BETA], BETA)).toBeNull();
  });

  it('falls back to the project tag for a session that published nothing', () => {
    // An older Claude Code, or a session not under tmux at all: its file has
    // no `tmux` field, so it is absent from the map and the tag still answers.
    expect(paneForRow(one, [ALPHA], ALPHA, new Map())).toBe('vam-atlas-aa11bb');
  });

  it('prefers the published pane over the tag when the two disagree', () => {
    // The tag is set at creation and never updated; the session itself reports
    // where it is now. Where they differ the session wins.
    const panes = new Map([['sess-alpha', 'vam-atlas-cc22dd']]);
    expect(paneForRow(two, [ALPHA], ALPHA, panes)).toBe('vam-atlas-cc22dd');
  });

  it('ignores a published pane that is not a session vam started', () => {
    // The operator's own sessions publish their panes too. vam may not type
    // into, kill, or draw one, so a name absent from vam's own listing is not
    // a pairing -- and here there is no tag either, so the answer is null.
    const panes = new Map([['sess-alpha', 'notes']]);
    expect(paneForRow([], [ALPHA], ALPHA, panes)).toBeNull();
  });

  it('REFUSES rather than falling back when the published pane has ended', () => {
    // CHANGED, DELIBERATELY, from falling back to the tag. A row that says it
    // is in a pane which no longer exists is a row vam cannot place: the tag
    // path answers a different question -- one agent here, one session tagged
    // here -- and the session it names is a DIFFERENT, live one that this row
    // was never in. Falling back meant replying into it, and killing it.
    const panes = new Map([['sess-alpha', 'vam-atlas-zz99zz']]);
    expect(paneForRow(one, [ALPHA], ALPHA, panes)).toBeNull();
  });
});

/**
 * The shape actually on the operator's machine, measured: THREE live sessions
 * sharing one cwd against ONE tmux pane vam started for that project.
 *
 * The project-id route requires exactly one live row in the project, so with
 * three it can prove nothing -- correctly, since nothing in that scheme says
 * which of the three is in the pane. It is not merely strict, it is
 * unsatisfiable for an operator who runs several sessions per project, which
 * is why `vamControlled` was false everywhere and close refused every row.
 * The published field settles it per session, and the counts stop mattering.
 */
describe('a published pane is checked against the row’s OWN project', () => {
  /**
   * THE HOLE THIS PINS. The published fast path asked only whether the name
   * appeared anywhere in vam's listing, while the fallback below it filtered
   * on the project -- so the path added to BYPASS the slow one was strictly
   * weaker than it. A row in Atlas whose published value is stale, or simply
   * wrong, and happens to name a vam session belonging to BEACON resolved as
   * a confident single match: a reply typed into another project's agent, and
   * a close aimed at its session.
   */
  const BEACON = '/work/beacon';
  const elsewhere: readonly TmuxSession[] = [
    { project: projectIdOf(BEACON), name: 'vam-beacon-ee33ff' },
  ];

  it('refuses a published pane that belongs to another project', () => {
    const panes = new Map([['sess-alpha', 'vam-beacon-ee33ff']]);
    expect(paneForRow(elsewhere, [ALPHA], ALPHA, panes)).toBeNull();
  });

  it('does NOT substitute the project’s own session for the one that disagrees', () => {
    // THE TEST THIS REPLACES ASSERTED THE DEFECT. It read `toBe(...aa11bb)`:
    // the published value was rejected for naming beacon's session, and then
    // the tag path resolved alpha's own healthy session and it was used --
    // typed into, and killed. Two independently correct fixes at two call
    // sites combined into a worse third defect, and the fixture that caught
    // it lives in remove-project's suite.
    const panes = new Map([['sess-alpha', 'vam-beacon-ee33ff']]);
    expect(paneForRow([...one, ...elsewhere], [ALPHA], ALPHA, panes)).toBeNull();
  });

  it('distinguishes all three cases, because only two of them are the same', () => {
    // 1. NOBODY SAID: no published value, and the tag path is unambiguous.
    //    That is the fallback's whole purpose and it still works.
    expect(paneForRow(one, [ALPHA], ALPHA, new Map())).toBe('vam-atlas-aa11bb');
    // 2. IT AGREES: the published value names a session tagged for this
    //    project. Resolved, and it bypasses the counts by design.
    const agrees = new Map([['sess-alpha', 'vam-atlas-aa11bb']]);
    expect(paneForRow(one, [ALPHA], ALPHA, agrees)).toBe('vam-atlas-aa11bb');
    // 3. IT DISAGREES: something about this row is wrong. Absence of evidence
    //    is not the same as evidence of a corrupt pairing, and only the first
    //    of the two may fall back.
    const disagrees = new Map([['sess-alpha', 'vam-beacon-ee33ff']]);
    expect(paneForRow([...one, ...elsewhere], [ALPHA], ALPHA, disagrees)).toBeNull();
  });

  it('never matches a session no one tagged, whose project reads back empty', () => {
    const untagged: readonly TmuxSession[] = [{ project: '', name: 'someone-elses' }];
    const panes = new Map([['sess-alpha', 'someone-elses']]);
    expect(paneForRow(untagged, [ALPHA], ALPHA, panes)).toBeNull();
  });
});

describe('paneForRow with three live sessions in one cwd', () => {
  const GAMMA = { key: 'sess-gamma#9', sessionId: 'sess-gamma', cwd: CWD };
  const all = [ALPHA, BETA, GAMMA];

  it('pairs the session that published a pane and neither of the other two', () => {
    const panes = new Map([['sess-beta', 'vam-atlas-aa11bb']]);
    expect(paneForRow(one, all, BETA, panes)).toBe('vam-atlas-aa11bb');
    expect(paneForRow(one, all, ALPHA, panes)).toBeNull();
    expect(paneForRow(one, all, GAMMA, panes)).toBeNull();
  });

  it('proves nothing for any of the three without a published pane', () => {
    for (const row of all) expect(paneForRow(one, all, row)).toBeNull();
  });
});
