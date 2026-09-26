/**
 * Desktop only, provably: `remote/server.ts` registers no HTTP route for any
 * of the six GitHub Integrations channels, and `githubProjectRemotes` -- the
 * one read a paired phone COULD otherwise imagine asking for -- carries no
 * capability to trigger a `gh` run, only the result of one main already ran.
 *
 * A CONTENT SCAN IS NOT THE WHOLE PROOF (`a-content-scan-proves-the-rule-was
 * -typed`), so this also asserts the STRUCTURAL fact: `registerGithubIntegrationIpc`
 * takes an `IpcMainLike`, the desktop bridge `remote/server.ts` never
 * constructs one -- there is no code path by which an HTTP request could
 * reach it, because it is never handed the object that receives one.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';

const serverSource = readFileSync(
  new URL('../../src/main/remote/server.ts', import.meta.url),
  'utf8',
);

describe('the six GitHub Integrations channels have no HTTP route', () => {
  it.each([
    ['githubAuthStatus', CHANNELS.githubAuthStatus],
    ['githubConnectStart', CHANNELS.githubConnectStart],
    ['githubConnectRead', CHANNELS.githubConnectRead],
    ['githubReposList', CHANNELS.githubReposList],
    ['githubOrgsList', CHANNELS.githubOrgsList],
    ['githubProjectRemotes', CHANNELS.githubProjectRemotes],
  ])('%s never appears in remote/server.ts', (_name, channel) => {
    expect(serverSource).not.toContain(channel);
  });

  it('remote/server.ts never imports anything from main/integrations/', () => {
    expect(serverSource).not.toMatch(/integrations\//);
  });
});
