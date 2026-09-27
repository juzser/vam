/**
 * SECURITY-SENSITIVE: the ONE table naming which extra argv element each
 * provider takes to skip its own permission prompts, and the ONE function
 * that appends it -- verified against each provider's real `--help` output
 * (2026-09-27, `claude` 2.1.283, `codex-cli` 0.157.0) rather than guessed:
 *
 *   claude --help  | --dangerously-skip-permissions        Bypass all permission checks.
 *   codex --help   | --dangerously-bypass-approvals-and-sandbox
 *                    Skip all confirmation prompts and execute commands without
 *                    sandboxing. EXTREMELY DANGEROUS.
 *
 * `sessionArgv` is the ONLY function that may append either flag, and it
 * appends it as a separate ARRAY ELEMENT, never by concatenating a string --
 * `command.join(' ')` (the shape `Canvas.tsx`'s `startSessionIn` has always
 * typed into a pane) runs on the array THIS function returns, not on a
 * string this function builds.
 */

import { describe, expect, it } from 'vitest';
import { PROVIDERS, sessionArgv, yoloFlagFor } from '../../src/shared/providers.js';

describe('yoloFlagFor', () => {
  it('names the exact flag verified against each provider’s own --help', () => {
    expect(yoloFlagFor('claude-code')).toBe('--dangerously-skip-permissions');
    expect(yoloFlagFor('codex')).toBe('--dangerously-bypass-approvals-and-sandbox');
  });

  it('has an entry for every provider in the table -- no silent gap', () => {
    for (const provider of PROVIDERS) {
      expect(typeof yoloFlagFor(provider.id)).toBe('string');
    }
  });
});

describe('sessionArgv', () => {
  it('manual mode returns the bare command, one element, untouched', () => {
    expect(sessionArgv('claude-code', 'manual')).toEqual(['claude']);
    expect(sessionArgv('codex', 'manual')).toEqual(['codex']);
  });

  it('yolo mode appends exactly the right flag, per provider, as its own element', () => {
    expect(sessionArgv('claude-code', 'yolo')).toEqual([
      'claude',
      '--dangerously-skip-permissions',
    ]);
    expect(sessionArgv('codex', 'yolo')).toEqual([
      'codex',
      '--dangerously-bypass-approvals-and-sandbox',
    ]);
  });

  it('never string-concatenates: the flag is always its own array element', () => {
    const argv = sessionArgv('claude-code', 'yolo');
    expect(argv).toHaveLength(2);
    expect(argv[0]).toBe('claude');
    expect(argv[0]).not.toContain('--dangerously');
  });

  it('returns a fresh array -- never the provider table’s own command array, mutated', () => {
    const before = PROVIDERS.find((p) => p.id === 'claude-code')?.command;
    sessionArgv('claude-code', 'yolo');
    expect(PROVIDERS.find((p) => p.id === 'claude-code')?.command).toEqual(before);
  });
});
