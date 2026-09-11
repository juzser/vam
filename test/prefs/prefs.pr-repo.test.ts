/**
 * WHICH DIRECTORY A PROJECT'S PULL REQUESTS COME FROM, stored.
 *
 * Operator: "a session started from an orchestrator or a factory often works
 * on a different repo than the one its directory is in — there needs to be a
 * way to switch repo."
 *
 * PER PROJECT, NOT PER SESSION, and the argument is stronger than "you set it
 * once". The README states what a project IS: "there is no stored project in
 * vam: a project is live sessions grouped by their cwd". A project is a cwd
 * grouping — and the thing being corrected here is the cwd. A per-session
 * override would let two sessions with an IDENTICAL cwd disagree about which
 * repository that cwd is, which is not inconvenient, it is incoherent: one
 * directory cannot be two repositories.
 *
 * A DIRECTORY, NOT AN `owner/name`. `pull-requests.ts` runs `gh` with no
 * `--repo` on purpose -- "naming a repository here would let a session's pane
 * describe a repository the session is not in" -- and a directory keeps that
 * true, because `gh` still resolves the remote itself. All that changes is
 * where vam stands to ask.
 *
 * UNSET MEANS TODAY'S BEHAVIOUR EXACTLY. Not a new default, not an empty
 * string that some reader turns into a cwd: absent, and the session's own
 * directory is used, which is what vam did before anyone could choose.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREFS,
  prRepoFor,
  readPrefs,
  type StorageLike,
  setProjectPrRepo,
  writePrefs,
} from '../../src/renderer/prefs/prefs.js';

const KEY = 'vam.prefs.v1';

function fake(initial: string | null = null): StorageLike & { value: string | null } {
  return {
    value: initial,
    getItem(key) {
      return key === KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === KEY) this.value = value;
    },
  };
}

const stored = (payload: object) => readPrefs(fake(JSON.stringify(payload)));
const DIR = '/Users/someone/code/other-repo';

describe('the per-project repository override', () => {
  it('is absent by default, which is the behaviour vam already had', () => {
    expect(EMPTY_PREFS.prRepos).toEqual({});
    expect(prRepoFor(EMPTY_PREFS, 'claude-code', 'p1')).toBeNull();
  });

  it('writes and reads back, per source and per project', () => {
    const next = setProjectPrRepo(EMPTY_PREFS, 'claude-code', 'p1', DIR);
    expect(prRepoFor(next, 'claude-code', 'p1')).toBe(DIR);
    // A PROJECT ID IS UNIQUE ONLY WITHIN ITS SOURCE, which is why there are
    // two levels here and in `projectNames`: a flat map would let one source's
    // override answer for another source's project.
    expect(prRepoFor(next, 'other-source', 'p1')).toBeNull();
    expect(prRepoFor(next, 'claude-code', 'p2')).toBeNull();
  });

  it('clears on an empty value rather than storing one', () => {
    // An empty string reaching `gh` as a `cwd` is `process.cwd()`, which is
    // wherever the app was launched from -- an answer about a directory nobody
    // chose. Clearing is the only safe reading of "".
    const set = setProjectPrRepo(EMPTY_PREFS, 'claude-code', 'p1', DIR);
    const cleared = setProjectPrRepo(set, 'claude-code', 'p1', '   ');
    expect(prRepoFor(cleared, 'claude-code', 'p1')).toBeNull();
    // And the bucket goes with it, so the store does not accumulate an empty
    // object per source the operator once touched.
    expect(cleared.prRepos).toEqual({});
  });

  it('trims, because a trailing space is not a different directory', () => {
    const next = setProjectPrRepo(EMPTY_PREFS, 'claude-code', 'p1', `  ${DIR}  `);
    expect(prRepoFor(next, 'claude-code', 'p1')).toBe(DIR);
  });

  it('disturbs no neighbour, and no other project', () => {
    const two = setProjectPrRepo(
      setProjectPrRepo(EMPTY_PREFS, 'claude-code', 'p1', DIR),
      'claude-code',
      'p2',
      '/elsewhere',
    );
    expect(prRepoFor(two, 'claude-code', 'p1')).toBe(DIR);
    expect(prRepoFor(two, 'claude-code', 'p2')).toBe('/elsewhere');
    const cleared = setProjectPrRepo(two, 'claude-code', 'p1', '');
    expect(prRepoFor(cleared, 'claude-code', 'p2')).toBe('/elsewhere');
  });

  it('survives a write and a read', () => {
    const store = fake();
    writePrefs(store, setProjectPrRepo(EMPTY_PREFS, 'claude-code', 'p1', DIR));
    expect(prRepoFor(readPrefs(store), 'claude-code', 'p1')).toBe(DIR);
  });

  it('defaults when the payload predates the field — which every payload does', () => {
    const back = stored({ theme: 'light' });
    expect(back.prRepos).toEqual({});
    expect(back.theme).toBe('light');
  });

  it('survives garbage in the field without taking a neighbour down', () => {
    for (const junk of [7, 'yes', [], null, { 'claude-code': 3 }, { 'claude-code': { p1: 9 } }]) {
      const back = stored({ prRepos: junk, theme: 'light' });
      expect(prRepoFor(back, 'claude-code', 'p1'), JSON.stringify(junk)).toBeNull();
      expect(back.theme).toBe('light');
    }
  });

  it('reads a stored path back exactly, including spaces in it', () => {
    // `execFile` runs no shell, so a directory with a space is a directory
    // with a space -- but only if nothing on the way here decided to split it.
    const spaced = '/Users/someone/My Code/other repo';
    const back = stored({ prRepos: { 'claude-code': { p1: spaced } } });
    expect(prRepoFor(back, 'claude-code', 'p1')).toBe(spaced);
  });
});
