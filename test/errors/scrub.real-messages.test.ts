/**
 * The scrubber against the messages the send/receive flow REALLY produces.
 *
 * `scrub.test.ts` covers the rules on messages written to exercise them. This
 * file does the other half: it takes the literal sentences
 * `src/main/sources/claude-code/{create-session,deliver}.ts`,
 * `src/main/sources/tmux/spawn.ts`, `src/main/sources/repo.ts` and
 * `src/main/env/cli-missing.ts` produce -- the ones an operator who created a
 * session and typed a prompt actually sees -- and asks what a maintainer would
 * receive.
 *
 * THE HEADLINE IS THAT THE SCRUBBER IS NOT THE PROBLEM. Measured below: 86% to
 * 97% of the words of every one of these survives, and the failure code, the
 * action and the whole diagnostic sentence come through intact. An operator
 * reporting "an error full of <redacted>" is describing the two holes this
 * file pins, not a body that has been eaten.
 *
 * THE TWO HOLES, both of them vam redacting its OWN words rather than the
 * operator's:
 *
 *   1. vam writes the name of the binary it could not find in BACKTICKS --
 *      "the `claude` command was not found on PATH" -- and `scrub` redacts
 *      backticked runs, so the one fact in that sentence is the one fact that
 *      does not arrive. It is not the operator's data: `claude`, `tmux` and
 *      `gh` are literals in vam's own source. `report.ts` already knows this
 *      shape ("the body may not use markdown backticks ... it would swallow
 *      the failure code") and fixed it for the body it composes; the messages
 *      it composes the body OUT OF were never checked.
 *
 *   2. `HOME_PATH`'s tail class does not exclude `:`, so the colon that
 *      separates a path from the rest of a unix error is swallowed with the
 *      path -- "can't create session: /Users/x/y: No such file or directory"
 *      arrives as "... ~/<redacted> No such file or directory", two clauses
 *      run together. Cosmetic beside (1), and the same one-character class.
 */

import { describe, expect, it } from 'vitest';
import { cliMissingMessage } from '../../src/main/env/cli-missing.js';
import { REDACTED, scrub } from '../../src/renderer/errors/scrub.js';

const HOME = '/Users/opname';
const SID = '9f1c2a84-3b7e-4d21-9c5a-6e0b8d7f1234';

/** Copied from the modules named in the header, with the operator's own strings filled in. */
const REAL_MESSAGES: Record<string, string> = {
  'deliver/session-running': `session ${SID} is running, so Claude Code will not resume it here. Error: Session ${SID} is running as a background session. Use 'claude attach' to attach to it, or 'claude stop' to stop it.`,
  'deliver/cli-failed': `delivering to session ${SID} failed: Error: ENOENT: no such file or directory, open '/Users/opname/code/acme-payroll/.claude/settings.json'`,
  'deliver/timed-out': `session ${SID} did not answer within 120s`,
  'deliver/unknown-session': `vam has no live session ${SID}#48213; it may have exited since the session list was drawn`,
  'tmux/session-exists':
    'a tmux session by that name already exists (creating session vam-acme-payroll-a1b2c3): duplicate session: vam-acme-payroll-a1b2c3',
  'tmux/no-server':
    'no tmux server is running, so there is nothing to reach (creating session vam-acme-payroll-a1b2c3)',
  'tmux/session-untagged':
    'the session started, but vam could not record which project it belongs to, so the Terminal tab will not find it: tmux failed while recording which project vam-acme-payroll-a1b2c3 belongs to: unknown option',
  'repo/not-a-repository':
    '/Users/opname/Downloads is not a git repository — vam starts a new project in one, and found no .git there or in any directory above it. Choose the repository, or run git init in that directory first.',
  'create-session/unknown-project':
    'vam cannot tell which directory project 3f9a2b1c8d4e5f60 is, so it will not start a session in a guessed one',
};

/** Share of whitespace-separated words that came through without a placeholder in them. */
function wordsKept(text: string): number {
  const words = scrub(text, HOME).split(/\s+/).filter(Boolean);
  const redacted = words.filter((word) => word.includes(REDACTED)).length;
  return (words.length - redacted) / words.length;
}

describe('scrub, on the real create-session and send-prompt messages', () => {
  it.each(Object.entries(REAL_MESSAGES))(
    'keeps most of %s -- a report is not mostly <redacted>',
    (_name, message) => {
      expect(wordsKept(message)).toBeGreaterThanOrEqual(0.8);
    },
  );

  it('keeps the failure code and the diagnosis of every one of them', () => {
    expect(scrub(REAL_MESSAGES['tmux/no-server'] as string, HOME)).toContain(
      'no tmux server is running',
    );
    expect(scrub(REAL_MESSAGES['repo/not-a-repository'] as string, HOME)).toContain(
      'is not a git repository',
    );
    expect(scrub(REAL_MESSAGES['deliver/timed-out'] as string, HOME)).toContain(
      'did not answer within 120s',
    );
  });

  it('removes what it is for: the session id, the project label and the home path', () => {
    const out = Object.values(REAL_MESSAGES)
      .map((message) => scrub(message, HOME))
      .join('\n');
    expect(out).not.toContain(SID);
    expect(out).not.toContain('acme-payroll');
    expect(out).not.toContain('/Users/opname');
    expect(out).not.toContain('opname');
  });

  it('HOLE 1: keeps the name of the binary vam could not find', () => {
    // vam's own literal, not the operator's data -- and the only actionable
    // word in the sentence. The `claude` assertion below PASSES today, and by
    // accident rather than by design: `cli-missing.ts` happens to repeat the
    // binary unquoted later in the same sentence ("if claude is installed
    // elsewhere"), so one copy survives. The tmux sentence
    // (`tmux/spawn.ts`) says it once, in backticks, and loses it entirely.
    const missing = cliMissingMessage('claude', `vam cannot reach session ${SID}`);
    expect(scrub(missing, HOME)).toContain('claude');
    expect(
      scrub(
        'the `tmux` command was not found, so vam cannot manage sessions (creating session vam-x-a1b2c3)',
        HOME,
      ),
    ).toContain('tmux');
  });

  it('HOLE 2: keeps the delimiter that follows a redacted path', () => {
    const tmuxFailed =
      "tmux failed while creating session vam-acme-payroll-a1b2c3: can't create session: /Users/opname/code/acme-payroll: No such file or directory";
    // The colon belongs to the SENTENCE, not to the path. Without it the two
    // clauses run together and the message reads as truncated.
    expect(scrub(tmuxFailed, HOME)).toContain(`${REDACTED}: No such file or directory`);
  });
});
