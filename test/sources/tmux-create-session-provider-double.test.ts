/**
 * A SECOND, discriminating test for the argv `create-session.ts` builds
 * (issue 166) -- REPURPOSED for the fix that removed `createSessionInDirectory`'s
 * own dispatch on `input.provider` entirely (the operator's second report:
 * a start-session flow racing the getting-started screen, `create-session.ts`'s
 * own header carries the full account). Before that fix this file proved
 * `spawnSessionIn`'s caller actually read `input.provider` through
 * `resolveProvider` rather than silently always running the default; there
 * is no such read left in `create-session.ts` to prove ANYTHING about now --
 * `createSessionInDirectory` types nothing, for any provider, exactly like
 * `createSessionInProject` beside it always has. What this file still earns
 * its keep proving: that remains true with a SECOND provider in the table
 * too, so a regression that special-cased the two-row case (typing the
 * NON-default entry while still leaving the one-row case alone) cannot pass
 * `tmux-create-session.test.ts` alone, which only ever sees one row.
 *
 * A SEPARATE FILE, RATHER THAN EDITING THE ORIGINAL, for the reason
 * `prefs.provider-double.test.ts` gives: `vi.mock` here replaces the whole
 * `providers.js` module, so this file can no longer see whether the SHIPPED
 * one-entry table and its fallback are themselves correct -- the original
 * file keeps doing that. This file trades it away on purpose for a
 * two-entry table with a second, obviously fictitious provider
 * (`vam-test-second-provider`) whose command differs from the default's.
 *
 * WHERE THE REAL DISPATCH LIVES NOW: the renderer's `startSessionIn`
 * (`Canvas.tsx`) resolves the chosen id through this same table and sends
 * the command as `recordPrompt`'s text -- main types verbatim what it is
 * handed (`start-in-pane.ts`'s `typeIntoOwnPane`), with no id-to-command
 * resolution of its own left to get wrong. `DetailPanel.provider-double.test.tsx`
 * is the double for the PICKER that produces the id; nothing between the
 * picker and `recordPrompt` resolves anything a discriminating double could
 * catch failing.
 *
 * DO NOT DELETE THIS ONCE A REAL SECOND PROVIDER SHIPS, on the same rule the
 * header above always gave: a real table makes it strictly better evidence,
 * not redundant evidence.
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
import { loginShellCommand } from '../../src/main/sources/tmux/shell.js';
import type { TmuxRun } from '../../src/main/sources/tmux/spawn.js';
import { DEFAULT_PROVIDER_ID, resolveProvider } from '../../src/shared/providers.js';

const SECOND_PROVIDER_ID = 'vam-test-second-provider';
const SECOND_PROVIDER_COMMAND = 'vam-test-second-provider-cmd';

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

describe('neither creation path runs the requested provider any more, even with a real choice to dispatch on', () => {
  it('the chosen-directory path types NOTHING for the second provider -- a shell, exactly as for the default', async () => {
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
    // The spawn is a shell, and NOTHING follows it -- pinned by value so a
    // regression that typed the second provider (while still leaving the
    // default case alone) reddens here even though it would pass a
    // one-row table.
    expect(run.calls).toEqual([
      [
        'new-session',
        '-d',
        '-P',
        '-F',
        '#{pane_pid}',
        '-s',
        'vam-orchard-a1b2c3',
        '-c',
        orchard,
        ...loginShellCommand(),
      ],
      ['set-option', '-t', 'vam-orchard-a1b2c3', '@vam-project', projectIdOf(orchard)],
    ]);
    expect(run.calls.flat()).not.toContain(SECOND_PROVIDER_COMMAND);
    // The discriminator itself, kept: the second provider's command really
    // differs from the default's, so "nothing was typed" is not vacuously
    // true because the two providers happen to agree.
    expect(resolveProvider(SECOND_PROVIDER_ID).command).not.toEqual(
      resolveProvider(DEFAULT_PROVIDER_ID).command,
    );
  });

  it('still types nothing for an id nothing answers to', async () => {
    const run = recordingTmux();
    const orchard = tempRepo();
    const failure = await createSessionInDirectory({
      cwd: orchard,
      title: 'orchard',
      run,
      name: 'vam-orchard-a1b2c3',
      provider: 'nonesuch',
    });

    expect(failure).toBeNull();
    expect(run.calls).toHaveLength(2); // spawn + @vam-project, never a type
    expect(run.calls.flat()).not.toContain(SECOND_PROVIDER_COMMAND);
  });

  it('is NOT what the project path runs either: a shell there, whichever provider is named', async () => {
    const run = recordingTmux();
    await createSessionInProject({
      agents: [agent('/w/demo')],
      projectId: projectIdOf('/w/demo'),
      title: 'new work',
      run,
      name: 'vam-new-work-a1b2c3',
      provider: SECOND_PROVIDER_ID,
      shell: ['/bin/zsh', '-l'],
    });
    expect(run.calls[0]?.slice(-2)).toEqual(['/bin/zsh', '-l']);
    expect(run.calls.flat()).not.toContain(SECOND_PROVIDER_COMMAND);
  });
});
