/**
 * `POST /api/create-session-in`, the one optional-capability case AC7 makes
 * binding rather than incidental: `MainSource#createSession` is declared
 * with a `?` (`src/main/sources/source.ts:48`), so a `MainSource` may not
 * implement it at all. That must refuse -- byte-identically with every other
 * refusal this guard produces -- and it must refuse WITHOUT reading the
 * operator's project list, because the capability check is the FIRST thing
 * the guard does, before `options.source.load()` is even awaited.
 *
 * This lives in its own file, apart from `server.test.ts`, because AC7 names
 * it as a dedicated case and because the `load` spy's zero-calls assertion is
 * the instrument for an ordering requirement that is easy to lose among the
 * rest of the route's assertions.
 *
 * The suites below it close vam-audit-5/task-12: `confineToProjectSet` must
 * do the SAME COUNT of awaited work -- exactly one `realpath` and one
 * `load()` -- on every path-dependent refusal cause and on the success path,
 * so a remote caller cannot tell "this path does not exist" from "this path
 * is not a project" by which awaits ran. `node:fs/promises` is mocked with a
 * pass-through `realpath` spy so the count can be read directly, without any
 * wall-clock measurement -- see the `SPY MADE TO REJECT` and ordering tests
 * below for how AC2 (awaited, not merely started) is proven by event order.
 */

import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceDirectory, Identity } from '../../../src/main/remote/auth.js';
import {
  createStreamRegistry,
  type RemoteServerOptions,
  startRemoteServer,
} from '../../../src/main/remote/server.js';
import { projectIdOf } from '../../../src/main/sources/claude-code/project-id.js';
import type { MainSource } from '../../../src/main/sources/source.js';
import type { Project } from '../../../src/renderer/domain/model.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  // A PASS-THROUGH spy: every other export, including this file's own
  // `mkdtemp`/`mkdir`, keeps its real behaviour. Only `realpath` calls are
  // counted.
  return { ...actual, realpath: vi.fn(actual.realpath) };
});

const realpathSpy = vi.mocked(realpath);

const PAIRED: Identity = { deviceId: 'device-1', name: 'the paired phone' };
const TOKEN = 'a-token-this-server-minted';
const devices: DeviceDirectory = { find: (token) => (token === TOKEN ? PAIRED : null) };

const descriptor = {
  id: 'claude-code',
  label: 'Claude Code',
  capabilities: { createSession: true },
  declines: {},
  viewerScope: 'operator',
} as unknown as MainSource['descriptor'];

const servers: Server[] = [];

async function start(source: MainSource, over: Partial<RemoteServerOptions> = {}): Promise<string> {
  const server = await startRemoteServer({
    port: 0,
    devices,
    allowWrites: true,
    source,
    subscribe: () => () => {},
    streams: createStreamRegistry(),
    audit: () => {},
    ...over,
  } satisfies RemoteServerOptions);
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the server did not bind a TCP port');
  }
  return `http://127.0.0.1:${address.port}`;
}

const post = (base: string, path: string, body: unknown): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** A controllable promise, for proving await order without any wall-clock read. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('create-session-in: an absent createSession capability', () => {
  beforeEach(() => {
    realpathSpy.mockClear();
  });

  it(
    'refuses at HTTP 403 with the byte-identical unauthorized-directory body, never calls ' +
      "createSessionInDirectory, never reads the operator's project list, and never " +
      'canonicalises the path',
    async () => {
      const repo = await mkdtemp(join(tmpdir(), 'vam-member-repo-'));
      await mkdir(join(repo, '.git'), { recursive: true });

      const load = vi.fn(async () => []);
      const createSessionInDirectory = vi.fn(async () => null);
      const base = await start({
        descriptor,
        load,
        // `createSession` is ABSENT -- not a stub resolving null. A
        // `MainSource` that never implements the capability at all.
        createSessionInDirectory,
      });

      const response = await post(base, '/api/create-session-in', {
        cwd: repo,
        title: 'a run',
      });

      // NOT 200 -- the optional-call idiom `s.createSession?.(...) ?? null`
      // would silently answer `{ok:true,value:null}`, a false success on the
      // one route that spawns a live shell.
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        ok: false,
        error: {
          kind: 'refused',
          code: 'unauthorized-directory',
          message: expect.any(String),
        },
      });

      // NEVER falls back to the caller-named directory -- the bypass this
      // plan version exists to close.
      expect(createSessionInDirectory).not.toHaveBeenCalled();

      // ORDERING (task-5 AC8, kept unchanged by task-12): the capability
      // check runs BEFORE `load()` or `realpath()` runs at all, so a route
      // that cannot spawn never reads the operator's project list and never
      // does the canonicalisation work every other cause now equally does.
      expect(load).not.toHaveBeenCalled();
      expect(realpathSpy).not.toHaveBeenCalled();
    },
  );
});

describe('create-session-in: the same count of awaited work on every cause (task-12)', () => {
  let memberRepo: string;
  let project: Project;

  beforeEach(async () => {
    realpathSpy.mockClear();
    memberRepo = await mkdtemp(join(tmpdir(), 'vam-task12-member-'));
    await mkdir(join(memberRepo, '.git'), { recursive: true });
    project = {
      id: projectIdOf(await realpath(memberRepo)),
      name: 'demo',
      sessions: [],
    } as unknown as Project;
    realpathSpy.mockClear();
  });

  it(
    'calls realpath and load exactly once on causes (a)-(f), and answers the ' +
      'byte-identical refusal body for every refusal, including capability-absent',
    async () => {
      const strangerRepo = await mkdtemp(join(tmpdir(), 'vam-task12-stranger-'));
      await mkdir(join(strangerRepo, '.git'), { recursive: true });
      const notARepo = await mkdtemp(join(tmpdir(), 'vam-task12-not-repo-'));
      const goneParent = await mkdtemp(join(tmpdir(), 'vam-task12-gone-'));
      const doesNotExist = join(goneParent, 'never-created');
      // `realpath` never throws synchronously -- it always returns a
      // promise -- so the override must reject one too, matching the real
      // contract `Promise.allSettled` relies on.
      const eaccess = (): Promise<never> =>
        Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));

      type Case = {
        readonly label: string;
        readonly cwd: string;
        readonly status: 200 | 403;
        readonly loadRejects?: boolean;
        readonly realpathOnce?: () => Promise<never>;
      };

      const cases: readonly Case[] = [
        { label: 'a: does not exist', cwd: doesNotExist, status: 403 },
        { label: 'b: exists, not a repo', cwd: notARepo, status: 403 },
        { label: 'c: a repo the list does not name', cwd: strangerRepo, status: 403 },
        {
          label: 'd: realpath rejects EACCES',
          cwd: memberRepo,
          status: 403,
          realpathOnce: eaccess,
        },
        { label: 'e: member path, load rejects', cwd: memberRepo, status: 403, loadRejects: true },
        { label: 'f: member path, success', cwd: memberRepo, status: 200 },
      ];

      const refusalTexts: string[] = [];
      for (const testCase of cases) {
        realpathSpy.mockClear();
        const load = vi.fn(
          testCase.loadRejects === true
            ? async () => {
                throw new Error('the project store is gone');
              }
            : async () => [project],
        );
        const createSession = vi.fn(async () => null);
        if (testCase.realpathOnce !== undefined) {
          realpathSpy.mockImplementationOnce(testCase.realpathOnce);
        }
        const base = await start({ descriptor, load, createSession });
        const response = await post(base, '/api/create-session-in', {
          cwd: testCase.cwd,
          title: 'a run',
        });
        expect(response.status, testCase.label).toBe(testCase.status);
        expect(realpathSpy, testCase.label).toHaveBeenCalledTimes(1);
        expect(load, testCase.label).toHaveBeenCalledTimes(1);
        if (testCase.status === 200) {
          expect(createSession, testCase.label).toHaveBeenCalledTimes(1);
          expect(createSession, testCase.label).toHaveBeenCalledWith(
            project.id,
            'a run',
            undefined,
          );
        } else {
          refusalTexts.push(await response.text());
        }
      }

      const capabilityAbsentBase = await start({ descriptor, load: vi.fn(async () => [project]) });
      const capabilityAbsentResponse = await post(capabilityAbsentBase, '/api/create-session-in', {
        cwd: memberRepo,
        title: 'a run',
      });
      expect(capabilityAbsentResponse.status).toBe(403);
      refusalTexts.push(await capabilityAbsentResponse.text());

      for (const text of refusalTexts) {
        expect(text).toBe(refusalTexts[0]);
        expect(text).not.toContain(memberRepo);
        expect(text).not.toContain(notARepo);
        expect(text).not.toContain(strangerRepo);
        expect(text).not.toContain(doesNotExist);
      }
      expect(refusalTexts[0]).toBe(
        JSON.stringify({
          ok: false,
          error: {
            kind: 'refused',
            code: 'unauthorized-directory',
            message: 'this device may only start a session in a project vam already lists',
          },
        }),
      );
    },
  );

  it(
    'awaits load to settlement before deciding, even once realpath has already rejected ' +
      '(AC2: awaited, not merely started)',
    async () => {
      const events: string[] = [];
      const realpathGate = deferred<string>();
      realpathSpy.mockImplementationOnce(() =>
        realpathGate.promise.finally(() => events.push('realpath-settled')),
      );
      const loadGate = deferred<readonly Project[]>();
      const load = vi.fn(() => loadGate.promise);
      const audit = vi.fn((line: string) => events.push(`audit:${line}`));
      const base = await start(
        { descriptor, load, createSession: vi.fn(async () => null) },
        { audit },
      );

      const responsePromise = post(base, '/api/create-session-in', {
        cwd: memberRepo,
        title: 'a run',
      });

      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
      realpathGate.reject(
        Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
      );
      await vi.waitFor(() => expect(events).toContain('realpath-settled'));

      events.push('release-load');
      loadGate.resolve([project]);

      const response = await responsePromise;
      expect(response.status).toBe(403);

      const releaseIndex = events.indexOf('release-load');
      const auditIndex = events.findIndex((event) => event.startsWith('audit:'));
      expect(releaseIndex).toBeGreaterThanOrEqual(0);
      expect(auditIndex).toBeGreaterThan(releaseIndex);
    },
  );

  it(
    'awaits realpath to settlement before deciding, even once load has already rejected ' +
      '(AC2: awaited, not merely started)',
    async () => {
      const events: string[] = [];
      const realpathGate = deferred<string>();
      realpathSpy.mockImplementationOnce(() => realpathGate.promise);
      const load = vi.fn(async () => {
        throw new Error('the project store is gone');
      });
      const audit = vi.fn((line: string) => events.push(`audit:${line}`));
      const base = await start(
        { descriptor, load, createSession: vi.fn(async () => null) },
        { audit },
      );

      const responsePromise = post(base, '/api/create-session-in', {
        cwd: memberRepo,
        title: 'a run',
      });

      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
      events.push('release-realpath');
      realpathGate.resolve(memberRepo);

      const response = await responsePromise;
      expect(response.status).toBe(403);

      const releaseIndex = events.indexOf('release-realpath');
      const auditIndex = events.findIndex((event) => event.startsWith('audit:'));
      expect(releaseIndex).toBeGreaterThanOrEqual(0);
      expect(auditIndex).toBeGreaterThan(releaseIndex);
    },
  );

  it('keeps task-5 AC8: capability-absent still skips both realpath and load entirely', async () => {
    const load = vi.fn(async () => [project]);
    const createSessionInDirectory = vi.fn(async () => null);
    const base = await start({ descriptor, load, createSessionInDirectory });

    const response = await post(base, '/api/create-session-in', {
      cwd: memberRepo,
      title: 'a run',
    });

    expect(response.status).toBe(403);
    expect(load).not.toHaveBeenCalled();
    expect(realpathSpy).not.toHaveBeenCalled();
    expect(createSessionInDirectory).not.toHaveBeenCalled();
  });
});
