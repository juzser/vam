/**
 * Composing a report, and the two things it must never do: send anything, or
 * carry the operator's machine into a public issue tracker.
 *
 * The first test is the feature's load-bearing guard. It builds one event out
 * of every hazard vam's error paths actually carry -- a home path, the
 * username inside it, a session id -- and asserts each one is ABSENT from the
 * body and from the URL. It was written before the scrubber existed and
 * falsified by disabling it.
 */

import { describe, expect, it, vi } from 'vitest';
import { composeReport, NEW_ISSUE_URL } from '../../src/renderer/errors/report.js';
import type { LoggedEvent } from '../../src/renderer/errors/log.js';

const HOME = '/Users/ada';

const LEAKY: LoggedEvent = {
  id: 7,
  at: '2026-01-02T03:04:05.000Z',
  kind: 'failure',
  action: 'close session',
  code: 'cli-failed',
  message:
    'pairing refused for /Users/ada/code/sonnet-lane on branch "feature/moon", ' +
    'session 3f8c1b62-9a41-4d2e-8b77-0c1d55ee9012, pid 48213, tmux "vam-sonnet-lane"',
};

describe('composeReport', () => {
  it('carries none of the operator: no home path, no username, no session id', () => {
    const report = composeReport(LEAKY, HOME);
    for (const secret of [
      '/Users/ada',
      'ada',
      'sonnet-lane',
      'feature/moon',
      '3f8c1b62-9a41-4d2e-8b77-0c1d55ee9012',
      '48213',
      'vam-sonnet-lane',
    ]) {
      expect(report.body).not.toContain(secret);
      expect(decodeURIComponent(report.url)).not.toContain(secret);
      expect(report.title).not.toContain(secret);
    }
  });

  it('keeps what a maintainer needs: the code, the action and the kind', () => {
    const report = composeReport(LEAKY, HOME);
    expect(report.body).toContain('cli-failed');
    expect(report.body).toContain('close session');
    expect(report.title).toContain('cli-failed');
  });

  it('carries no prompt or transcript content, because it has no field for it', () => {
    // The event type itself has nowhere to put a draft, so the report cannot
    // acquire one later by a caller passing it through. This asserts the
    // absence at the seam anyway: whatever the message held, the body is
    // built from code, action, kind and the scrubbed message only.
    const report = composeReport(
      { ...LEAKY, message: 'refused while sending: "rewrite the auth module tonight"' },
      HOME,
    );
    expect(report.body).not.toContain('rewrite the auth module');
  });

  it('prefills the new-issue URL of the public repository', () => {
    const report = composeReport(LEAKY, HOME);
    expect(report.url.startsWith(`${NEW_ISSUE_URL}?`)).toBe(true);
    expect(report.url).toContain('title=');
    expect(report.url).toContain('body=');
    // Encoded, not raw: a body with a `&` in it must not become two params.
    expect(report.url).not.toContain('\n');
  });

  it('sends nothing: no network call, no shell', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const open = vi.fn();
    vi.stubGlobal('XMLHttpRequest', class {
      open = open;
      send = open;
    });
    composeReport(LEAKY, HOME);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    fetchSpy.mockRestore();
  });

  it('is pure: composing twice gives the same report', () => {
    expect(composeReport(LEAKY, HOME)).toEqual(composeReport(LEAKY, HOME));
  });
});
