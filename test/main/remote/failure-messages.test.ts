/**
 * The three sentences a remote-endpoint failure can be, and they must not
 * collapse into one another: "the port is taken and here is what to try",
 * "it did not start for some other reason", and (drawn by the CALLER, not
 * this file -- see `src/main/index.ts`) "it is simply switched off", which
 * is what a `RemoteState` fetch failing with no channels registered already
 * says on its own, with nothing recorded here at all.
 *
 * NEITHER MESSAGE NAMES A CLI COMMAND. The operator reading this is at a
 * packaged, Finder-launched app with no terminal in front of them; "set
 * VAM_REMOTE_PORT" is not a thing they can act on.
 */

import { describe, expect, it } from 'vitest';
import { bindFailureEvent, setupFailureEvent } from '../../../src/main/remote/failure-messages.js';
import { RemoteBindError } from '../../../src/main/remote/server.js';

describe('bindFailureEvent', () => {
  it('names the port and the other-copy remedy for port-in-use, under its own code', () => {
    const event = bindFailureEvent(
      new RemoteBindError(
        'the remote endpoint could not bind port 58217: it is already in use',
        'port-in-use',
      ),
      58_217,
    );
    expect(event.code).toBe('remote-port-in-use');
    expect(event.message).toContain('58217');
    expect(event.message).not.toMatch(/\bVAM_REMOTE_PORT\b/);
    expect(event.message).not.toMatch(/`[^`]*`/); // no inline command syntax
  });

  it('carries the underlying cause, under a different code, for every other bind refusal', () => {
    const event = bindFailureEvent(
      new RemoteBindError(
        'the remote endpoint could not bind port 58217: listen EACCES: permission denied 127.0.0.1:58217',
        'other',
      ),
      58_217,
    );
    expect(event.code).toBe('remote-bind-failed');
    expect(event.code).not.toBe('remote-port-in-use');
    expect(event.message).toContain('EACCES');
  });

  it('still says something useful for a rejection that was not a RemoteBindError at all', () => {
    const event = bindFailureEvent(new Error('boom'), 58_217);
    expect(event.code).toBe('remote-bind-failed');
    expect(event.message).toContain('boom');
  });

  it('does not crash on a thrown non-Error', () => {
    const event = bindFailureEvent('boom', 58_217);
    expect(event.code).toBe('remote-bind-failed');
    expect(event.message).toContain('boom');
  });
});

describe('setupFailureEvent', () => {
  it('has its own code, distinct from either bind-failure code', () => {
    const event = setupFailureEvent(new Error('ENOSPC: no space left on device'));
    expect(event.code).toBe('remote-setup-failed');
    expect(event.message).toContain('ENOSPC');
    expect(event.message).not.toMatch(/\bVAM_REMOTE_PORT\b/);
  });
});
