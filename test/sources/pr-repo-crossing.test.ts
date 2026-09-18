/**
 * THE CROSSING: a preference stored in the renderer, consulted where `gh` runs.
 *
 * The override is a preference, so it lives in the renderer's `localStorage`
 * with every other one. The read it changes happens in MAIN, inside
 * `source.ts`'s `load()`. This file is about the seam between those two facts,
 * and about the one property that makes the seam safe.
 *
 * ── WHY NOT THROUGH `load()` ──────────────────────────────────────────────
 * The obvious design passes the override into `load()`. It was rejected, and
 * not for the churn: `load()` is the shared `PreloadSourceApi` contract, and
 * `renderer/sources/http-factory.ts` implements that same contract for a
 * PAIRED PHONE over Tailscale. Threading a directory through it would make "a
 * directory this machine then spawns a process in" something a remote device
 * names -- buying a convenience about which repository's pull requests to look
 * at, and paying for it with a new remote capability.
 *
 * So the map arrives on a desktop-only channel and main owns it, and the
 * remote surface is unchanged. The tests below are about what that module must
 * guarantee, because it is now the last gate before a spawn and the renderer
 * is the least trusted process here.
 *
 * ── AND THE PHONE STILL SEES THE OVERRIDE ─────────────────────────────────
 * Measured rather than assumed, and it is why there is no "the desktop is
 * pointed elsewhere" caveat anywhere in this feature: `main/index.ts` builds
 * ONE `DESKTOP_SOURCE` and hands the same object to `registerSourceIpc` and to
 * `startRemoteServer`. Both surfaces read that source's own `load()`, so an
 * override applied in main reaches both identically. A warning about a
 * disagreement would be a caveat about a state that cannot happen.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPrRepoOverrides,
  prRepoOverride,
  setPrRepoOverrides,
} from '../../src/main/sources/claude-code/pr-repos.js';

const DIR = '/Users/someone/code/other-repo';

afterEach(() => clearPrRepoOverrides());

describe('main’s copy of the override map', () => {
  it('is empty until the renderer says otherwise, which is what vam always did', () => {
    expect(prRepoOverride('claude-code', 'p1')).toBeNull();
  });

  it('takes a map and answers per source and per project', () => {
    setPrRepoOverrides({ 'claude-code': { p1: DIR } });
    expect(prRepoOverride('claude-code', 'p1')).toBe(DIR);
    expect(prRepoOverride('claude-code', 'p2')).toBeNull();
    expect(prRepoOverride('other', 'p1')).toBeNull();
  });

  it('REPLACES rather than merges, so a cleared override really clears', () => {
    // The renderer's prefs are the truth, and a merge could not express a
    // removal: an operator who points a project back at its own directory
    // deletes the entry, and a merge would keep the old one forever -- the
    // pane would go on reporting a repository they had stopped choosing.
    setPrRepoOverrides({ 'claude-code': { p1: DIR, p2: '/elsewhere' } });
    setPrRepoOverrides({ 'claude-code': { p2: '/elsewhere' } });
    expect(prRepoOverride('claude-code', 'p1')).toBeNull();
    expect(prRepoOverride('claude-code', 'p2')).toBe('/elsewhere');
    setPrRepoOverrides({});
    expect(prRepoOverride('claude-code', 'p2')).toBeNull();
  });

  it('forgets rather than invents, for anything that is not the shape', () => {
    // THE LAST GATE BEFORE A SPAWN. Total in one direction only: a payload
    // this cannot read lands as "no overrides" -- today's behaviour -- never
    // as a directory nobody chose.
    setPrRepoOverrides({ 'claude-code': { p1: DIR } });
    for (const junk of [null, undefined, 7, 'x', [], [{ p1: DIR }]]) {
      setPrRepoOverrides(junk);
      expect(prRepoOverride('claude-code', 'p1'), JSON.stringify(junk ?? null)).toBeNull();
    }
  });

  it('drops an entry that is not a string, keeping its neighbours', () => {
    setPrRepoOverrides({ 'claude-code': { p1: 9, p2: DIR, p3: null } });
    expect(prRepoOverride('claude-code', 'p1')).toBeNull();
    expect(prRepoOverride('claude-code', 'p2')).toBe(DIR);
    expect(prRepoOverride('claude-code', 'p3')).toBeNull();
  });

  it('drops an empty directory, because `execFile` would read it as the app’s own', () => {
    // A `cwd` of '' is `process.cwd()` -- wherever vam was launched from --
    // which is an answer about a repository nobody chose. Dropped here as well
    // as in `prefs.ts`: this side does not get to assume the other validated.
    setPrRepoOverrides({ 'claude-code': { p1: '', p2: '   ' } });
    expect(prRepoOverride('claude-code', 'p1')).toBeNull();
    expect(prRepoOverride('claude-code', 'p2')).toBeNull();
  });

  it('trims, so a path with a stray space is the same path', () => {
    setPrRepoOverrides({ 'claude-code': { p1: `  ${DIR}  ` } });
    expect(prRepoOverride('claude-code', 'p1')).toBe(DIR);
  });

  it('keeps a directory whose name contains spaces intact', () => {
    const spaced = '/Users/someone/My Code/other repo';
    setPrRepoOverrides({ 'claude-code': { p1: spaced } });
    expect(prRepoOverride('claude-code', 'p1')).toBe(spaced);
  });
});
