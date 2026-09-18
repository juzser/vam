/**
 * The report path's public-repo guarantees, pressed end to end.
 *
 * vam is a PUBLIC repository and the footer under every composed body tells
 * the operator, at the moment they are about to submit it, that no prompt
 * content is ever included. That sentence is only true if no failure message
 * can carry one, and node's `ExecException.message` is
 * `Command failed: <file> <args joined>` -- measured on node 26.5, not
 * assumed.
 *
 * THE PROMPT NOW TRAVELS THE TMUX ARGV. The `claude --resume -p` channel that
 * used to carry a prompt is retired; vam types the prompt into the pane with
 * `send-keys -l -- "<prompt>"` (`tmux/argv.ts`), so it is THAT argv node puts
 * in `failure.message` when a keystroke fails. `classifyTmuxFailure` never
 * reads `failure.message` -- it reads the exit code, the signal, and the
 * clipped stderr -- so the guarantee holds by construction, and this file
 * proves it end to end: classify -> record -> compose, with the prompt in the
 * failure the whole way.
 *
 * No spawn, no tmux, no network. Every identifier here is invented.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { promptKeystrokes, sendTextArgv } from '../../src/main/sources/tmux/argv.js';
import { classifyTmuxFailure } from '../../src/main/sources/tmux/spawn.js';
import { clearEvents, recordFailure } from '../../src/renderer/errors/log.js';
import { composeReport } from '../../src/renderer/errors/report.js';

/** Invented: a home directory, a pane name and a telling prompt. */
const HOME = '/Users/ada';
const PANE = 'vam-atlas-a1b2c3';
const ACTION = `typing a reply into session ${PANE}`;
const SECRET_PROMPT =
  'refactor the billing secret rotation for acme-corp, the API key is sk-live-DO-NOT-SHARE';

/** The send-keys argv reply.ts hands tmux for this prompt -- the prompt is in it. */
const promptArgv = (prompt: string): readonly string[] => sendTextArgv(PANE, prompt);

/**
 * A plain non-zero exit with the argv in `message` -- what node builds when
 * tmux complains and exits non-zero. This is the shape that would leak if the
 * classifier ever printed `failure.message`.
 */
function exitedQuietly(argv: readonly string[]): Error & { code: number } {
  return Object.assign(new Error(`Command failed: tmux ${argv.join(' ')}\n`), { code: 1 });
}

/** An external `kill -9`, node reporting the signal that really ended it. */
function externallyKilled(argv: readonly string[]): Error & {
  code: number | null;
  killed: boolean;
  signal: string;
} {
  return Object.assign(new Error(`Command failed: tmux ${argv.join(' ')}\n`), {
    code: null,
    killed: false,
    signal: 'SIGKILL',
  });
}

describe('the prompt never reaches a composed report', () => {
  beforeEach(() => {
    clearEvents();
  });

  it.each([
    ['a quiet non-zero exit', exitedQuietly],
    ['a kill from outside vam', externallyKilled],
  ])(
    'keeps the typed prompt out of the failure, the log and the issue body (%s)',
    (_name, shape) => {
      const error = classifyTmuxFailure({
        failure: shape(promptArgv(SECRET_PROMPT)),
        stderr: '',
        action: ACTION,
      });

      expect(error.message).not.toContain('sk-live-DO-NOT-SHARE');
      expect(error.message).not.toContain('acme-corp');
      expect(error.message).not.toContain('Command failed');

      const event = recordFailure('send prompt', error);
      const report = composeReport(event, HOME);
      for (const secret of ['sk-live-DO-NOT-SHARE', 'acme-corp', 'billing secret rotation']) {
        expect(report.body).not.toContain(secret);
        expect(decodeURIComponent(report.url)).not.toContain(secret);
      }
    },
  );

  it('leaks nothing even from a MULTI-LINE prompt, whose every line is in an argv', () => {
    // Each line of a multi-line prompt is its own `send-keys -l -- <line>`
    // (`promptKeystrokes`), so a leak would need only one of them printed.
    const multiline = `${SECRET_PROMPT}\nand also delete acme-corp/prod`;
    for (const argv of promptKeystrokes(PANE, multiline)) {
      const error = classifyTmuxFailure({
        failure: exitedQuietly(argv),
        stderr: '',
        action: ACTION,
      });
      expect(error.message).not.toContain('sk-live-DO-NOT-SHARE');
      expect(error.message).not.toContain('acme-corp');
      const report = composeReport(recordFailure('send prompt', error), HOME);
      expect(report.body).not.toContain('acme-corp');
    }
  });

  it('bounds the body: a one-million-character prompt cannot become a one-million-character issue', () => {
    const huge = 'x'.repeat(1_000_000);
    const failure = exitedQuietly(promptArgv(huge));
    const error = classifyTmuxFailure({ failure, stderr: '', action: ACTION });
    expect(error.message.length).toBeLessThan(2_000);
    expect(composeReport(recordFailure('send prompt', error), HOME).body.length).toBeLessThan(
      4_000,
    );
  });

  it('still says what vam was doing, so the report stays diagnosable', () => {
    const failure = externallyKilled(promptArgv(SECRET_PROMPT));
    const error = classifyTmuxFailure({ failure, stderr: '', action: ACTION });
    // The action names the pane, which is not the prompt -- diagnosable, not leaky.
    expect(error.message).toContain(PANE);
  });

  it("keeps tmux's own stderr, which is the operator's only clue", () => {
    // A plain non-zero exit: node still put the argv in `message`, but tmux
    // said something, and what it said is what the operator gets.
    const failure = exitedQuietly(promptArgv(SECRET_PROMPT));
    const error = classifyTmuxFailure({
      failure,
      stderr: "can't find pane: =vam-atlas-a1b2c3:",
      action: ACTION,
    });
    expect(error.message).toContain("can't find pane");
    expect(error.message).not.toContain('sk-live-DO-NOT-SHARE');
  });
});

describe('an externally killed process is a kill, not a refusal', () => {
  it('does not call a SIGKILLed tmux a refusal, and does not call it a timeout', () => {
    const failure = externallyKilled(promptArgv(SECRET_PROMPT));
    const error = classifyTmuxFailure({ failure, stderr: '', action: ACTION });
    expect(error.kind).toBe('unreachable');
    expect(error.code).toBe('killed');
    expect(error.message).not.toMatch(/did not answer|timed out/i);
    expect(error.message).not.toContain('sk-live-DO-NOT-SHARE');
  });

  it('still calls a node-enforced timeout a timeout', () => {
    const failure = Object.assign(new Error('Command failed: tmux send-keys'), {
      code: null,
      killed: true,
      signal: 'SIGTERM',
    });
    const error = classifyTmuxFailure({ failure, stderr: '', action: ACTION });
    expect(error.code).toBe('timed-out');
  });
});

describe('the footer and the scrubber agree', () => {
  it('replaces a vam session name that carries the project label, even unquoted', () => {
    const error = classifyTmuxFailure({
      failure: { message: 'exit 1' },
      stderr: 'server exited unexpectedly',
      action: 'creating session vam-acme-corp-payroll-migrat-a1b2c3',
    });
    const report = composeReport(recordFailure('create session', error), HOME);
    expect(report.body).not.toContain('acme-corp');
    expect(report.body).not.toContain('vam-acme-corp-payroll-migrat-a1b2c3');
  });

  it('promises nothing the scrubber does not do: no unqualified claim about project names', () => {
    const report = composeReport(
      {
        id: 1,
        at: '2026-01-02T03:04:05.000Z',
        kind: 'failure',
        action: 'read pane',
        code: 'cli-failed',
        message: 'cwd-missing: /Volumes/clients/acme-corp/payroll no longer exists',
      },
      HOME,
    );
    // An absolute path outside a home directory survives the scrubber. The
    // footer must therefore not tell the operator that project names are
    // simply replaced -- it must say what is actually removed and ask them
    // to read the body.
    const footer = report.body.slice(report.body.lastIndexOf('---'));
    expect(footer).not.toMatch(/project and branch names[\s\S]*were replaced/);
    expect(footer).toMatch(/read|check|review/i);
  });
});
