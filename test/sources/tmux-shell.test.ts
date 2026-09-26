/**
 * What a NEW vam session runs: the operator's own login shell, not an agent.
 *
 * `docs/design/vam-owns-the-session.md` Stage 2: the pane is real from the
 * first frame, the Terminal view works before anything is chosen, and typing
 * `claude` by hand is a first-class path. The command that gets there is
 * built here and asserted by value, because `newSessionArgv` refuses an
 * EMPTY command on purpose (tmux would silently start a login shell where an
 * agent was expected) -- so "a shell" has to be spelled out, and this is the
 * one place that spells it.
 */

import { describe, expect, it } from 'vitest';
import { isShellCommand, loginShellCommand } from '../../src/main/sources/tmux/shell.js';

describe('telling a shell from an agent by the pane’s foreground command', () => {
  it('names every shell `loginShellCommand` can start, and the ones tmux might', () => {
    for (const shell of ['sh', 'bash', 'zsh', 'fish', 'ksh', 'dash', 'tcsh', 'csh']) {
      expect(isShellCommand(shell), shell).toBe(true);
    }
    // A login shell's `argv[0]` wears a leading `-`; some tmux builds report
    // it that way. Same shell.
    expect(isShellCommand('-zsh')).toBe(true);
  });

  it('reads an agent, or anything else, as NOT a shell', () => {
    for (const other of ['claude', 'codex', 'node', 'sleep', 'vim', 'ssh']) {
      expect(isShellCommand(other), other).toBe(false);
    }
  });

  it('reads NOTHING as not-a-shell: absence is "the listing did not say"', () => {
    // A three-field listing (an older stub, or a tmux too old for the format)
    // carries no command. That is not evidence of a shell and not evidence
    // of an agent; every caller must fall back to what it did before the
    // field existed, and this is the value that makes them.
    expect(isShellCommand(undefined)).toBe(false);
    expect(isShellCommand('')).toBe(false);
  });
});

describe('the shell a new vam session runs', () => {
  it('is $SHELL as a login shell, when $SHELL names an absolute path', () => {
    expect(loginShellCommand({ SHELL: '/bin/zsh' })).toEqual(['/bin/zsh', '-l']);
    expect(loginShellCommand({ SHELL: '/opt/homebrew/bin/fish' })).toEqual([
      '/opt/homebrew/bin/fish',
      '-l',
    ]);
  });

  it('falls back to /bin/sh when $SHELL is unset, empty, or not a path', () => {
    // A GUI-launched vam has no $SHELL at all (`env/resolve-path.ts`).
    expect(loginShellCommand({})).toEqual(['/bin/sh', '-l']);
    expect(loginShellCommand({ SHELL: '' })).toEqual(['/bin/sh', '-l']);
    // A bare word would be resolved by tmux's own PATH, which is not the
    // operator's; and a value starting with `-` is what `newSessionArgv`
    // refuses as an option. Neither is a shell vam will hand to tmux.
    expect(loginShellCommand({ SHELL: 'zsh' })).toEqual(['/bin/sh', '-l']);
    expect(loginShellCommand({ SHELL: '-zsh' })).toEqual(['/bin/sh', '-l']);
  });
});
