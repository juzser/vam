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
      ['sess-alpha#7', 'vam-atlas-aa11bb'],
      ['sess-beta#8', 'vam-atlas-cc22dd'],
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
    const panes = new Map([['sess-alpha#7', 'vam-atlas-cc22dd']]);
    expect(paneForRow(two, [ALPHA], ALPHA, panes)).toBe('vam-atlas-cc22dd');
  });

  it('ignores a published pane that is not a session vam started', () => {
    // The operator's own sessions publish their panes too. vam may not type
    // into, kill, or draw one, so a name absent from vam's own listing is not
    // a pairing -- and here there is no tag either, so the answer is null.
    const panes = new Map([['sess-alpha#7', 'notes']]);
    expect(paneForRow([], [ALPHA], ALPHA, panes)).toBeNull();
  });

  it('REFUSES rather than falling back when the published pane has ended', () => {
    // CHANGED, DELIBERATELY, from falling back to the tag. A row that says it
    // is in a pane which no longer exists is a row vam cannot place: the tag
    // path answers a different question -- one agent here, one session tagged
    // here -- and the session it names is a DIFFERENT, live one that this row
    // was never in. Falling back meant replying into it, and killing it.
    const panes = new Map([['sess-alpha#7', 'vam-atlas-zz99zz']]);
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
    const panes = new Map([['sess-alpha#7', 'vam-beacon-ee33ff']]);
    expect(paneForRow(elsewhere, [ALPHA], ALPHA, panes)).toBeNull();
  });

  it('does NOT substitute the project’s own session for the one that disagrees', () => {
    // THE TEST THIS REPLACES ASSERTED THE DEFECT. It read `toBe(...aa11bb)`:
    // the published value was rejected for naming beacon's session, and then
    // the tag path resolved alpha's own healthy session and it was used --
    // typed into, and killed. Two independently correct fixes at two call
    // sites combined into a worse third defect, and the fixture that caught
    // it lives in remove-project's suite.
    const panes = new Map([['sess-alpha#7', 'vam-beacon-ee33ff']]);
    expect(paneForRow([...one, ...elsewhere], [ALPHA], ALPHA, panes)).toBeNull();
  });

  it('distinguishes all three cases, because only two of them are the same', () => {
    // 1. NOBODY SAID: no published value, and the tag path is unambiguous.
    //    That is the fallback's whole purpose and it still works.
    expect(paneForRow(one, [ALPHA], ALPHA, new Map())).toBe('vam-atlas-aa11bb');
    // 2. IT AGREES: the published value names a session tagged for this
    //    project. Resolved, and it bypasses the counts by design.
    const agrees = new Map([['sess-alpha#7', 'vam-atlas-aa11bb']]);
    expect(paneForRow(one, [ALPHA], ALPHA, agrees)).toBe('vam-atlas-aa11bb');
    // 3. IT DISAGREES: something about this row is wrong. Absence of evidence
    //    is not the same as evidence of a corrupt pairing, and only the first
    //    of the two may fall back.
    const disagrees = new Map([['sess-alpha#7', 'vam-beacon-ee33ff']]);
    expect(paneForRow([...one, ...elsewhere], [ALPHA], ALPHA, disagrees)).toBeNull();
  });

  it('never matches a session no one tagged, whose project reads back empty', () => {
    const untagged: readonly TmuxSession[] = [{ project: '', name: 'someone-elses' }];
    const panes = new Map([['sess-alpha#7', 'someone-elses']]);
    expect(paneForRow(untagged, [ALPHA], ALPHA, panes)).toBeNull();
  });
});

describe('paneForRow with three live sessions in one cwd', () => {
  const GAMMA = { key: 'sess-gamma#9', sessionId: 'sess-gamma', cwd: CWD };
  const all = [ALPHA, BETA, GAMMA];

  it('pairs the session that published a pane and neither of the other two', () => {
    const panes = new Map([['sess-beta#8', 'vam-atlas-aa11bb']]);
    expect(paneForRow(one, all, BETA, panes)).toBe('vam-atlas-aa11bb');
    expect(paneForRow(one, all, ALPHA, panes)).toBeNull();
    expect(paneForRow(one, all, GAMMA, panes)).toBeNull();
  });

  it('proves nothing for any of the three without a published pane', () => {
    for (const row of all) expect(paneForRow(one, all, row)).toBeNull();
  });
});

/**
 * The same exclusive-claim rule as `targetSession`'s, on the keystroke and
 * close side -- and it has to be here too, or Enter is still delivered into
 * another row's running agent while the tab honestly draws nothing.
 */
describe('paneForRow and panes another row has claimed', () => {
  const GAMMA = { key: 'sess-gamma#9', sessionId: 'sess-gamma', cwd: CWD };

  it('is null when the project’s only session is the pane another row published', () => {
    // GAMMA is the only row in the list, so the count condition does not save
    // this one: the claim itself has to. The claimant is a session whose file
    // publishes this pane and which is not among the rows here -- a session
    // vam is not currently drawing, or one that has exited leaving its file.
    // vam cannot tell those apart, and the pane is spoken for either way.
    const panes = new Map([['sess-alpha#7', 'vam-atlas-aa11bb']]);
    expect(paneForRow(one, [GAMMA], GAMMA, panes)).toBeNull();
  });

  it('still answers with a session nobody published -- the legacy fallback', () => {
    expect(paneForRow(one, [GAMMA], GAMMA, new Map())).toBe('vam-atlas-aa11bb');
  });

  it('does not answer for two tagged sessions just because one is claimed', () => {
    // The same ordering rule as `matchVamSession`'s: the claim is applied
    // after the single-candidate count, so it can only ever veto. Subtracting
    // first would leave one name here and type into it.
    const panes = new Map([['sess-alpha#7', 'vam-atlas-aa11bb']]);
    expect(paneForRow(two, [GAMMA], GAMMA, panes)).toBeNull();
  });

  it('does not guess between two unpublished rows over one unclaimed session', () => {
    expect(paneForRow(one, [ALPHA, GAMMA], GAMMA, new Map())).toBeNull();
  });
});

/**
 * THE DEFECT THIS TASK EXISTS FOR, reproduced directly: two live sessions in
 * one cwd, NEITHER of which has published a `tmux` field yet -- the exact
 * condition under which the published check answers nothing for either row
 * and the project-tag counts below it (`here.length`, `tagged.length`) are
 * both greater than one, so the old code answered `null` for both.
 *
 * `createVamSession` (`tmux/spawn.ts`) now records the pid of each pane's
 * process on its tmux session, at creation, as `VAM_PID_OPTION`. `row.pid` is
 * the SAME os pid `claude agents --json` reports for that row (`agents.ts`),
 * so it resolves each row to its own pane WITHOUT counting -- see
 * `VAM_PID_OPTION`'s own doc for the argument.
 */
describe('paneForRow proves a row by its OWN pid, without counting', () => {
  const ALPHA_PID = { ...ALPHA, pid: 111 };
  const BETA_PID = { ...BETA, pid: 222 };
  /** The exact shape measured: two tagged sessions, two matching pids. */
  const twoTaggedByPid: readonly TmuxSession[] = [
    { project, pid: '111', name: 'vam-atlas-aa11bb' },
    { project, pid: '222', name: 'vam-atlas-cc22dd' },
  ];

  it('gives each of two live, unpublished sessions its own pane by pid alone', () => {
    // Neither row published anything (no `panes` map at all), and BOTH the
    // live-row count and the tagged-session count are 2 -- the old fallback
    // would refuse both. The pid tag settles it per row.
    expect(paneForRow(twoTaggedByPid, [ALPHA_PID, BETA_PID], ALPHA_PID)).toBe('vam-atlas-aa11bb');
    expect(paneForRow(twoTaggedByPid, [ALPHA_PID, BETA_PID], BETA_PID)).toBe('vam-atlas-cc22dd');
  });

  it('still resolves when only ONE of the two tagged sessions carries a pid', () => {
    // The other session is untagged for pid -- an older vam, or a pid tag
    // call that itself failed (`createVamSession` degrades silently). ALPHA
    // is still provable; BETA falls back to the old counting rule, which
    // still refuses with two live rows and two tagged sessions.
    const mixed: readonly TmuxSession[] = [
      { project, pid: '111', name: 'vam-atlas-aa11bb' },
      { project, pid: '', name: 'vam-atlas-cc22dd' },
    ];
    expect(paneForRow(mixed, [ALPHA_PID, BETA_PID], ALPHA_PID)).toBe('vam-atlas-aa11bb');
    expect(paneForRow(mixed, [ALPHA_PID, BETA_PID], BETA_PID)).toBeNull();
  });

  it('is null for a row with no pid at all -- vam did not spawn it, or the CLI reported none', () => {
    // A `LiveAgent` with `pid: null` (an older CLI, or the field genuinely
    // absent) has nothing to match against, and neither does a caller
    // (`StoppableAgent`) that never had a pid to give. Falls through to the
    // pre-existing counting rule, which refuses with two live rows present.
    const noPid = { ...ALPHA, pid: null };
    const noPidField = ALPHA;
    expect(paneForRow(twoTaggedByPid, [noPid, BETA_PID], noPid)).toBeNull();
    expect(paneForRow(twoTaggedByPid, [noPidField, BETA_PID], noPidField)).toBeNull();
  });

  it('never matches a pid tagged for a DIFFERENT project', () => {
    // Same pid, wrong project: `row.pid` alone is not the proof, the pid
    // AND the project both have to be this row's.
    const elsewhere: readonly TmuxSession[] = [
      { project: projectIdOf('/work/beacon'), pid: '111', name: 'vam-beacon-zz00zz' },
    ];
    expect(paneForRow(elsewhere, [ALPHA_PID], ALPHA_PID)).toBeNull();
  });

  it('does not answer for a session vam did not start -- pid tags never reach that far', () => {
    // `sessions` here is exactly what `listVamSessions` would hand back: only
    // vam's own, prefix-filtered names ever arrive as a `TmuxSession` at all
    // (`spawn.ts`). A `pid` coincidence with something outside that list can
    // never occur because nothing outside it is ever compared.
    expect(paneForRow([], [ALPHA_PID], ALPHA_PID)).toBeNull();
  });

  it('does not resolve a pid match to a pane another row has already published', () => {
    // Defense in depth: the pid tier is vetoed by the SAME claim rule as the
    // tag fallback below it, even though a live pid match and a conflicting
    // published claim on the identical session should not coexist under
    // normal operation.
    const panes = new Map([['sess-gamma#9', 'vam-atlas-aa11bb']]);
    expect(paneForRow(twoTaggedByPid, [ALPHA_PID, BETA_PID], ALPHA_PID, panes)).toBeNull();
  });

  it('is bypassed entirely by a published pane -- checked first, and never reached at all', () => {
    // The published check runs first and returns before the pid tier is ever
    // reached -- constraint 3: it must not be weakened. Agreeing, it answers
    // the same name the pid tag would have; a NAME published for a session
    // that does not exist is a hard veto (`REFUSES ... when the published
    // pane has ended`, above) that the pid tier never gets a chance to
    // second-guess, even though ALPHA_PID's own tag would otherwise resolve.
    const agrees = new Map([['sess-alpha#7', 'vam-atlas-aa11bb']]);
    expect(paneForRow(twoTaggedByPid, [ALPHA_PID, BETA_PID], ALPHA_PID, agrees)).toBe(
      'vam-atlas-aa11bb',
    );
    const ended = new Map([['sess-alpha#7', 'vam-atlas-zz99zz']]);
    expect(paneForRow(twoTaggedByPid, [ALPHA_PID, BETA_PID], ALPHA_PID, ended)).toBeNull();
  });
});
