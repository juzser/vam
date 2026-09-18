/**
 * THE PHONE CAN REACH THE PAIRING FORM.
 *
 * Operator, after scanning the QR: "refused, and an unauthenticated error."
 * The sentence they quoted back -- "check the pairing screen" -- was not an
 * instruction to anyone. It was vam's own 401 body, read off their phone.
 *
 * ── THE DEADLOCK ──────────────────────────────────────────────────────────
 * `/api/pair` was the only door an unpaired caller could knock on, and it is a
 * POST. The page that makes that POST -- the browser build -- was served ONLY
 * after the bearer-token check, so the phone could never load the app that
 * exists to obtain the token. A browser navigating to a URL cannot POST, so
 * scanning the QR could only ever produce a 401.
 *
 * IT SHIPPED PAST A CORRECT TEST. `server.test.ts` asserts 401 at `/` for a
 * caller with no identity, and that assertion is RIGHT about the piece it
 * names. No test walked the journey, so nothing noticed that the journey had
 * no first step. That is why the case below navigates, loads what the page
 * references, pairs, and only then reads an API -- and why re-closing the
 * shell must break it at step one rather than somewhere in the middle.
 *
 * ── WHY OPENING THE SHELL IS SAFE, and the condition attached to it ───────
 * The shell is the same public build that ships inside the DMG, from a public
 * repository: it is not a secret, and without a token it can do nothing but
 * draw a pairing form. Every `/api/*` path stays behind the token, which is
 * what "no data, no writes, no session access without a paired device" means
 * and what the enumeration below holds to. The outer boundary is unchanged:
 * loopback bind, tailnet-only Serve, `funnel` refused by name.
 *
 * THE ARGUMENT DEPENDS ON A CLAIM ABOUT A DIRECTORY -- that the served root
 * holds build output and never user data. A claim nothing checks is how this
 * gets quietly falsified later, so `the served root` below checks it. If a
 * future change puts anything else under `dist-web`, that test fails before
 * the route can leak it.
 */

import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceDirectory } from '../../../src/main/remote/auth.js';
import {
  type RemoteServerOptions,
  registeredRoutePaths,
  startRemoteServer,
} from '../../../src/main/remote/server.js';
import type { MainSource } from '../../../src/main/sources/source.js';

const TOKEN = 'a-token-this-server-minted';
const PAIRED = { deviceId: 'd1', name: 'the phone' };
const devices: DeviceDirectory = { find: (token) => (token === TOKEN ? PAIRED : null) };

const source = {
  descriptor: { id: 'claude-code', label: 'Claude Code', capabilities: {}, declines: {} },
  load: async () => ({ projects: [] }),
} as unknown as MainSource;

const servers: Server[] = [];

async function webRootFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vam-shell-'));
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><title>vam</title><script src="/assets/app.js"></script>',
  );
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'assets', 'app.js'), 'export const vam = 1;\n');
  await writeFile(join(root, 'favicon.png'), 'not really a png');
  return root;
}

async function start(over: Partial<RemoteServerOptions> = {}): Promise<string> {
  const server = await startRemoteServer({
    port: 0,
    devices,
    allowWrites: true,
    source,
    subscribe: () => () => {},
    audit: () => {},
    pairing: {
      // The real `PairOutcome` shape: `{ ok, identity, token }` on success.
      submit: async (code: string) =>
        code === 'RIGHTONE'
          ? { ok: true, identity: PAIRED, token: TOKEN }
          : { ok: false, reason: 'no-code' },
    } as unknown as RemoteServerOptions['pairing'],
    ...over,
  });
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
});

describe('the whole journey a phone makes', () => {
  it('navigates, loads the page’s own script, pairs, and then reads the model', async () => {
    const base = await start({ webRoot: await webRootFixture() });

    // 1. THE QR LANDS HERE. No token: the phone has never been seen before.
    const page = await fetch(`${base}/`);
    expect(page.status, 'the address the QR encodes must open').toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('<title>vam</title>');

    // 2. THE PAGE'S OWN REFERENCES, taken from the HTML rather than guessed --
    //    a page that opens and cannot fetch its script is still a blank phone.
    const src = /src="([^"]+)"/.exec(html)?.[1];
    expect(src, 'the fixture page must reference a script').toBeDefined();
    const asset = await fetch(`${base}${src}`);
    expect(asset.status, 'the app the page asks for must load').toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');

    // 3. STILL NOTHING WITHOUT A TOKEN. Opening the shell must not have opened
    //    the model with it.
    expect((await fetch(`${base}/api/load`)).status).toBe(401);

    // 4. PAIRING, which is the POST the page now exists to make.
    const paired = await fetch(`${base}/api/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'RIGHTONE', name: 'the phone' }),
    });
    expect(paired.status).toBe(200);
    // The same envelope every other route uses: `{ ok, value }`.
    const token = ((await paired.json()) as { value?: { token?: string } }).value?.token;
    expect(token, 'pairing must hand back a token').toBe(TOKEN);

    // 5. AND ONLY NOW the model answers.
    const load = await fetch(`${base}/api/load`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(load.status).toBe(200);
  });

  /**
   * THE FALSIFICATION. With no `webRoot` the server serves no page at all,
   * which is the state the deadlock was in: the journey must die at step one
   * rather than limp to step four. If this ever passes, the case above has
   * stopped testing the thing it was written for.
   */
  it('fails at the first step when the shell is closed again', async () => {
    const base = await start({ webRoot: undefined });

    const page = await fetch(`${base}/`);
    expect(page.status).toBe(401);
    expect(page.headers.get('content-type')).toContain('application/json');
  });
});

describe('what the exemption covers', () => {
  it('opens the page and its assets, and nothing else under the root', async () => {
    const base = await start({ webRoot: await webRootFixture() });

    expect((await fetch(`${base}/`)).status).toBe(200);
    expect((await fetch(`${base}/index.html`)).status).toBe(200);
    expect((await fetch(`${base}/assets/app.js`)).status).toBe(200);
    // A REAL FILE UNDER THE ROOT that the shape does not name. `favicon.png`
    // is build output and is not a secret; it stays behind the token because
    // the exemption is a SHAPE and not "whatever happens to be static". The
    // cost is a missing tab icon before pairing, and nothing else.
    expect((await fetch(`${base}/favicon.png`)).status).toBe(401);
  });

  /**
   * NORMALISATION HAPPENS FIRST, and the shape is checked against what
   * survives it. `new URL(...).pathname` collapses `.` and `..` segments
   * before this server ever sees a path, so `/assets/../index.html` arrives as
   * `/index.html` -- the page itself, which IS exempt, and nothing escaped
   * anywhere. Asserting a 401 there would be asserting a bug.
   *
   * The ENCODED form is the one normalisation leaves alone, and the one the
   * charset has to stop: `%` is not in it, so `/assets/..%2findex.html` never
   * matches. `serveAsset` would refuse to leave the root anyway; these are two
   * independent guards, which is the point of having both.
   */
  it('lets the URL parser collapse a climb, and stops the encoded form', async () => {
    const base = await start({ webRoot: await webRootFixture() });

    // Resolves to the page. Exempt, and correctly so.
    const collapsed = await fetch(`${base}/assets/../index.html`);
    expect(collapsed.status).toBe(200);
    expect(await collapsed.text()).toContain('<title>vam</title>');

    // Survives as written, and the shape refuses it.
    expect((await fetch(`${base}/assets/..%2findex.html`)).status).toBe(401);
  });

  it('does not open a nested path under assets, or anything beside it', async () => {
    const base = await start({ webRoot: await webRootFixture() });

    for (const path of ['/assets/', '/assets/nested/app.js', '/ASSETS/app.js']) {
      const response = await fetch(`${base}${path}`);
      expect(response.status, `${path} must not be exempt`).not.toBe(200);
    }
  });

  it('does not open the shell to a method other than GET', async () => {
    const base = await start({ webRoot: await webRootFixture() });
    const response = await fetch(`${base}/index.html`, { method: 'POST' });
    expect(response.status).toBe(401);
  });
});

describe('every route that is not the pairing door still refuses', () => {
  it('answers 401 without a token, on each path the server registers', async () => {
    const options = {
      port: 0,
      devices,
      allowWrites: true,
      source,
      subscribe: () => () => {},
    } as unknown as RemoteServerOptions;
    const paths = registeredRoutePaths(options).filter((path) => path !== '/api/pair');
    // THE SWEEP PROVES IT FOUND A CORPUS. A loop over an empty list is green
    // and means nothing, and this guard's whole value is that it covers the
    // routes a future change adds without anyone remembering to list them.
    expect(paths.length).toBeGreaterThanOrEqual(8);
    expect(paths.every((path) => path.startsWith('/api/'))).toBe(true);

    const base = await start({ webRoot: await webRootFixture() });
    for (const path of paths) {
      for (const method of ['GET', 'POST'] as const) {
        const response = await fetch(`${base}${path}`, {
          method,
          ...(method === 'POST'
            ? { headers: { 'content-type': 'application/json' }, body: '{}' }
            : {}),
        });
        expect(response.status, `${method} ${path} without a token`).toBe(401);
      }
    }
  });
});

describe('the served root', () => {
  /**
   * THE CONDITION THE ROUTE'S SAFETY RESTS ON, checked rather than asserted.
   *
   * Opening the shell is safe because the served directory holds BUILD OUTPUT
   * and never user data. That is a claim about a directory, and a directory is
   * exactly the kind of thing that quietly grows a log, an upload or a cache
   * later. This fails the moment `dist-web` contains anything outside the
   * shape the browser build emits.
   *
   * It reads the REAL build if one is present and says so when it is not: a
   * guard that silently examines nothing is the failure this repo has already
   * found in four of its own sweeps.
   */
  it('holds nothing but the shape the browser build emits', async () => {
    const root = 'dist-web';
    let top: string[];
    try {
      top = await readdir(root);
    } catch {
      // No build in this checkout. Say so out loud rather than pass quietly.
      expect(process.env['CI'], 'dist-web must exist in CI, where the build runs').toBeUndefined();
      return;
    }
    expect(top.length, 'an empty dist-web is not a build').toBeGreaterThan(0);

    const ALLOWED_TOP = new Set(['index.html', 'favicon.png', 'assets']);
    for (const name of top) {
      expect(ALLOWED_TOP.has(name), `unexpected file in the served root: ${name}`).toBe(true);
    }

    const ALLOWED_ASSET = new Set(['.js', '.css', '.map', '.woff2', '.svg', '.png']);
    for (const name of await readdir(join(root, 'assets'))) {
      expect(ALLOWED_ASSET.has(extname(name)), `unexpected asset: ${name}`).toBe(true);
      // No nesting: a directory under `assets` would be outside the shape the
      // route exempts, so it could never be served and should not be built.
      expect(name.includes('/')).toBe(false);
    }
  });
});
