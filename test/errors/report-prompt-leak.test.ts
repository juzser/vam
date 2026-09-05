/**
 * The report path's public-repo guarantees, pressed end to end.
 *
 * vam is a PUBLIC repository and the footer under every composed body tells
 * the operator, at the moment they are about to submit it, that no prompt
 * content is ever included. That sentence is only true if no failure message
 * can carry one, and node's `ExecException.message` is
 * `Command failed: <file> <args joined>` -- measured on node 26.5, not
 * assumed -- while `deliverArgv` puts the whole prompt in that argv. So the
 * guarantee is a property of the WHOLE chain, and this file exercises the
 * whole chain: classify -> record -> compose.
 *
 * No spawn, no tmux, no network. Every identifier here is invented.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { classifyDeliverFailure, deliverArgv } from '../../src/main/sources/claude-code/deliver.js';
import { classifyTmuxFailure } from '../../src/main/sources/tmux/spawn.js';
import { clearEvents, recordFailure } from '../../src/renderer/errors/log.js';
import { composeReport } from '../../src/renderer/errors/report.js';

/** Invented: a session id, a home directory and a prompt that looks like what it is. */
const SESSION = '11111111-2222-4333-8444-555555555555';
const HOME = '/Users/ada';
const SECRET_PROMPT =
  'refactor the billing secret rotation for acme-corp, the API key is sk-live-DO-NOT-SHARE';

/**
 * The exact failure node hands back for a child killed from OUTSIDE --
 * measured: `{code: null, killed: false, signal: 'SIGKILL'}`, with the argv
 * inside `message`. `killed` is true only when node itself killed the child.
 */
function externallyKilled(argv: readonly string[]): Error & {
  code: number | null;
  killed: boolean;
  signal: string;
} {
  return Object.assign(new Error(`Command failed: claude ${argv.join(' ')}\n`), {
    code: null,
    killed: false,
    signal: 'SIGKILL',
  });
}

describe('the prompt never reaches a composed report', () => {
  beforeEach(() => {
    clearEvents();
  });

  it('keeps the delivered prompt out of the classified failure, the log and the issue body', () => {
    const failure = externallyKilled(deliverArgv(SESSION, SECRET_PROMPT));
    const error = classifyDeliverFailure({ failure, stderr: '', sessionId: SESSION });

    expect(error.message).not.toContain('sk-live-DO-NOT-SHARE');
    expect(error.message).not.toContain('acme-corp');
    expect(error.message).not.toContain('Command failed');

    const event = recordFailure('send prompt', error);
    const report = composeReport(event, HOME);
    for (const secret of ['sk-live-DO-NOT-SHARE', 'acme-corp', 'billing secret rotation']) {
      expect(report.body).not.toContain(secret);
      expect(decodeURIComponent(report.url)).not.toContain(secret);
    }
  });

  it('bounds the body: a one-million-character prompt cannot become a one-million-character issue', () => {
    // MAX_PROMPT_LENGTH is 1,000,000 and the fallback branch applied no clip.
    const huge = 'x'.repeat(1_000_000);
    const failure = externallyKilled(deliverArgv(SESSION, huge));
    const error = classifyDeliverFailure({ failure, stderr: '', sessionId: SESSION });
    expect(error.message.length).toBeLessThan(2_000);
    expect(composeReport(error === null ? never() : recordFailure('send prompt', error), HOME).body
      .length).toBeLessThan(4_000);
  });

  it('still says which session failed, so the report stays diagnosable', () => {
    const failure = externallyKilled(deliverArgv(SESSION, SECRET_PROMPT));
    const error = classifyDeliverFailure({ failure, stderr: '', sessionId: SESSION });
    expect(error.message).toContain(SESSION);
  });

  it("keeps the CLI's own stderr, which is the operator's only clue", () => {
    const failure = externallyKilled(deliverArgv(SESSION, SECRET_PROMPT));
    const error = classifyDeliverFailure({
      failure,
      stderr: 'Error: something else entirely',
      sessionId: SESSION,
    });
    expect(error.message).toContain('something else entirely');
    expect(error.message).not.toContain('sk-live-DO-NOT-SHARE');
  });
});

function never(): never {
  throw new Error('unreachable');
}

describe('an externally killed process is a kill, not a refusal', () => {
  it('does not call a SIGKILLed claude a refusal, and does not call it a timeout', () => {
    const failure = externallyKilled(deliverArgv(SESSION, SECRET_PROMPT));
    const error = classifyDeliverFailure({ failure, stderr: '', sessionId: SESSION });
    expect(error.kind).toBe('unreachable');
    expect(error.code).toBe('killed');
    expect(error.message).not.toMatch(/did not answer|timed out/i);
  });

  it('still calls a node-enforced timeout a timeout', () => {
    const failure = Object.assign(new Error('Command failed: claude --resume'), {
      code: null,
      killed: true,
      signal: 'SIGTERM',
    });
    const error = classifyDeliverFailure({ failure, stderr: '', sessionId: SESSION });
    expect(error.code).toBe('timed-out');
  });

  it('does not call a SIGKILLed tmux a refusal either', () => {
    const error = classifyTmuxFailure({
      failure: {
        message: 'Command failed: tmux list-sessions -F #{session_name}',
        code: null,
        killed: false,
        signal: 'SIGKILL',
      },
      stderr: '',
      action: 'listing sessions',
    });
    expect(error.kind).toBe('unreachable');
    expect(error.code).toBe('killed');
    expect(error.message).toContain('SIGKILL');
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
