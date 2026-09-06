/**
 * A SECOND, discriminating test for the argv the session-start path
 * builds (issue 166). `tmux-create-session.test.ts` covers the same code
 * (`create-session.ts`'s `spawnSessionIn`) honestly, but with `PROVIDERS`
 * (`src/shared/providers.ts`) at one row, "runs the chosen provider's
 * command" (an explicit `provider: 'claude-code'`) and "runs claude" (the
 * plain no-provider path elsewhere in that file) build the identical argv
 * either way -- neither can fail if `resolveProvider` were replaced with a
 * function that ignored its argument and always returned the default.
 *
 * A SEPARATE FILE, RATHER THAN EDITING THE ORIGINAL, for the reason
 * `prefs.provider-double.test.ts` gives: `vi.mock` here replaces the whole
 * `providers.js` module, so this file can no longer see whether the SHIPPED
 * one-entry table and its fallback are themselves correct -- the original
 * file keeps doing that. This file trades it away on purpose for a
 * two-entry table with a second, obviously fictitious provider
 * (`vam-test-second-provider`) whose command differs from the default's, so
 * a call that dispatches on `input.provider` and a call that ignores it stop
 * agreeing on what tmux runs.
 *
 * DO NOT DELETE THIS ONCE A REAL SECOND PROVIDER SHIPS -- it tests that
 * `spawnSessionIn` actually reads `input.provider` through `resolveProvider`,
 * which does not become redundant just because the shipped table grows a
 * row.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const TEST_TABLE = vi.hoisted(() => ({
  DEFAULT_PROVIDER_ID: 'claude-code',
  PROVIDERS: [
    { id: 'claude-code', label: 'Claude Code', command: ['claude'] },
    {
      id: 'vam-test-second-provider',
      label: 'Test-Only Second Provider',
      command: ['vam-test-second-provider-cmd'],
    },
  ],
}));

vi.mock('../../src/shared/providers.js', () => {
  const { DEFAULT_PROVIDER_ID, PROVIDERS } = TEST_TABLE;
  function resolveProvider(id: unknown) {
    const match = PROVIDERS.find((provider) => provider.id === id);
    return match ?? PROVIDERS.find((provider) => provider.id === DEFAULT_PROVIDER_ID);
  }
  function readProviderId(id: unknown) {
    return resolveProvider(id)?.id;
  }
  return { DEFAULT_PROVIDER_ID, PROVIDERS, resolveProvider, readProviderId };
});

import {
  createSessionInDirectory,
  createSessionInProject,
} from '../../src/main/sources/claude-code/create-session.js';
import { projectIdOf } from '../../src/main/sources/claude-code/project-id.js';
import type { TmuxRun } from '../../src/main/sources/tmux/spawn.js';
import { DEFAULT_PROVIDER_ID, resolveProvider } from '../../src/shared/providers.js';

const SECOND_PROVIDER_ID = 'vam-test-second-provider';

function recordingTmux(): TmuxRun & { calls: (readonly string[])[] } {
  const calls: (readonly string[])[] = [];
  const run = (async (argv: readonly string[]) => {
    calls.push(argv);
    return { failure: null, stdout: '', stderr: '' };
  }) as TmuxRun & { calls: (readonly string[])[] };
  run.calls = calls;
  return run;
}

const repos: string[] = [];
function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vam-create-double-'));
  mkdirSync(join(dir, '.git'));
  repos.push(dir);
  return dir;
}

afterEach(() => {
  while (repos.length > 0) {
    rmSync(repos.pop() as string, { recursive: true, force: true });
  }
});

const agent = (cwd: string) => ({
  key: `s1#101`,
  sessionId: 's1',
  name: null,
  cwd,
  status: 'waiting' as const,
  kind: 'interactive' as const,
  pid: 101,
  startedAt: null,
});

describe('the requested provider is what runs, not merely what the default already runs (issue 166)', () => {
  it('runs the SECOND provider’s command when asked for it', async () => {
    const run = recordingTmux();
    const orchard = tempRepo();
    const failure = await createSessionInDirectory({
      cwd: orchard,
      title: 'orchard',
      run,
      name: 'vam-orchard-a1b2c3',
      provider: SECOND_PROVIDER_ID,
    });

    expect(failure).toBeNull();
    expect(run.calls[0]).toEqual([
      'new-session',
      '-d',
      '-s',
      'vam-orchard-a1b2c3',
      '-c',
      orchard,
      ...resolveProvider(SECOND_PROVIDER_ID).command,
    ]);
    // The discriminator itself: the second provider's command is not the
    // default's, so this assertion cannot be satisfied by a bug that always
    // runs the default regardless of `input.provider`.
    expect(resolveProvider(SECOND_PROVIDER_ID).command).not.toEqual(
      resolveProvider(DEFAULT_PROVIDER_ID).command,
    );
  });

  it('still falls back to the default for an id nothing answers to', async () => {
    const run = recordingTmux();
    const failure = await createSessionInProject({
      agents: [agent('/w/demo')],
      projectId: projectIdOf('/w/demo'),
      title: 'new work',
      run,
      name: 'vam-new-work-a1b2c3',
      provider: 'nonesuch',
    });

    expect(failure).toBeNull();
    expect(run.calls[0]).toEqual([
      'new-session',
      '-d',
      '-s',
      'vam-new-work-a1b2c3',
      '-c',
      '/w/demo',
      ...resolveProvider(DEFAULT_PROVIDER_ID).command,
    ]);
  });
});
