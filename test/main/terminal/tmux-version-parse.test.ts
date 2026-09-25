/**
 * `tmux -V`'s TEXT, parsed against the streaming floor (`stream-ipc.ts`'s own
 * `MIN_TMUX_MAJOR`/`MIN_TMUX_MINOR`, major.minor >= 3.2).
 *
 * Real `-V` output is not always `tmux <major>.<minor>\n`: a distro can
 * suffix a letter onto a release (`3.2a`, `3.7b` -- both real upstream
 * point-release names) or prefix the number with its own build tag instead
 * of tmux's own (`next-3.4`, tmux's own development-branch naming; `openbsd-
 * 7.4`, OpenBSD's own long-standing habit of tagging its bundled tmux with
 * the OS release rather than upstream's version). `meetsMinimumTmuxVersion`
 * has to find the trailing `major.minor` in all four shapes, or every
 * operator on one of them is silently, permanently pushed onto the fallback
 * renderer for a tmux that was never too old.
 */

import { describe, expect, it } from 'vitest';
import {
  meetsMinimumTmuxVersion,
  parseTmuxVersion,
} from '../../../src/main/terminal/stream-ipc.js';

describe('parseTmuxVersion', () => {
  it('reads a plain release', () => {
    expect(parseTmuxVersion('tmux 3.2\n')).toEqual({ major: 3, minor: 2 });
    expect(parseTmuxVersion('tmux 3.7\n')).toEqual({ major: 3, minor: 7 });
  });

  it('reads a lettered point release, the trailing letter ignored', () => {
    expect(parseTmuxVersion('tmux 3.2a\n')).toEqual({ major: 3, minor: 2 });
    expect(parseTmuxVersion('tmux 3.7b\n')).toEqual({ major: 3, minor: 7 });
  });

  it("reads tmux's own development-branch naming", () => {
    expect(parseTmuxVersion('tmux next-3.4\n')).toEqual({ major: 3, minor: 4 });
  });

  it("reads OpenBSD's own release-tagged naming", () => {
    expect(parseTmuxVersion('tmux openbsd-7.4\n')).toEqual({ major: 7, minor: 4 });
  });

  it('refuses to guess at text with no major.minor pair at all', () => {
    expect(parseTmuxVersion('')).toBeNull();
    expect(parseTmuxVersion('command not found\n')).toBeNull();
    expect(parseTmuxVersion('tmux\n')).toBeNull();
  });
});

describe('meetsMinimumTmuxVersion', () => {
  it('accepts exactly the floor and anything above it, every shape parseTmuxVersion reads', () => {
    expect(meetsMinimumTmuxVersion('tmux 3.2\n')).toBe(true);
    expect(meetsMinimumTmuxVersion('tmux 3.2a\n')).toBe(true);
    expect(meetsMinimumTmuxVersion('tmux 3.7b\n')).toBe(true);
    expect(meetsMinimumTmuxVersion('tmux next-3.4\n')).toBe(true);
    expect(meetsMinimumTmuxVersion('tmux openbsd-7.4\n')).toBe(true);
    expect(meetsMinimumTmuxVersion('tmux 4.0\n')).toBe(true);
  });

  it('refuses below the floor', () => {
    expect(meetsMinimumTmuxVersion('tmux 3.1\n')).toBe(false);
    expect(meetsMinimumTmuxVersion('tmux 2.9\n')).toBe(false);
  });

  it('refuses text it cannot parse at all, rather than assuming it is new enough', () => {
    expect(meetsMinimumTmuxVersion('')).toBe(false);
    expect(meetsMinimumTmuxVersion('command not found\n')).toBe(false);
  });
});
