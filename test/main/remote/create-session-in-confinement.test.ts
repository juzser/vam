/**
 * `POST /api/create-session-in`, the one optional-capability case AC7 makes
 * binding rather than incidental: `MainSource#createSession` is declared
 * with a `?` (`src/main/sources/source.ts:48`), so a `MainSource` may not
 * implement it at all. That must refuse -- byte-identically with every other
 * refusal this guard produces -- and it must refuse WITHOUT reading the
 * operator's project list, because the capability check is the FIRST thing
 * the guard does, before the combined source's own `load()` is even awaited.
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

import { mkdir, mkdtemp, realpath, symlink } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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
    sources: [source],
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
  // Restores the pass-through implementation, so a `mockImplementationOnce`
  // a case queued but never consumed cannot leak into the next test.
  realpathSpy.mockReset();
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
  // A symlink named like the member, so its lexical spelling is never the
  // member's canonical path -- on any host, whether or not tmpdir() is itself
  // canonical (it is on Linux, it is not on macOS). Reaching the member
  // through it is what makes the server run `realpath`.
  let memberAlias: string;
  let project: Project;

  beforeEach(async () => {
    realpathSpy.mockClear();
    memberRepo = await mkdtemp(join(tmpdir(), 'vam-task12-member-'));
    await mkdir(join(memberRepo, '.git'), { recursive: true });
    const aliasParent = await mkdtemp(join(tmpdir(), 'vam-task12-alias-'));
    memberAlias = join(aliasParent, basename(memberRepo));
    await symlink(memberRepo, memberAlias);
    project = {
      id: projectIdOf(await realpath(memberRepo)),
      name: 'demo',
      sessions: [],
    } as unknown as Project;
    realpathSpy.mockClear();
  });

  it(
    'REWRITTEN from "calls realpath and load exactly once on causes (a)-(f)": calls load ' +
      'exactly once on every cause past the capability check, and realpath 0 times when the ' +
      "cwd's final segment names no listed project (a, b, c, e) versus exactly once when it " +
      'does (d, f) -- FINDING 3a9f9e70. Every refusal still answers the byte-identical body.',
    async () => {
      const strangerRepo = await mkdtemp(join(tmpdir(), 'vam-task12-stranger-'));
      await mkdir(join(strangerRepo, '.git'), { recursive: true });
      const notARepo = await mkdtemp(join(tmpdir(), 'vam-task12-not-repo-'));
      const goneParent = await mkdtemp(join(tmpdir(), 'vam-task12-gone-'));
      const doesNotExist = join(goneParent, 'never-created');
      // `realpath` never throws synchronously -- it always returns a
      // promise -- so the override must reject one too.
      const eaccess = (): Promise<never> =>
        Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }));

      type Case = {
        readonly label: string;
        readonly cwd: string;
        readonly status: 200 | 403;
        readonly loadRejects?: boolean;
        readonly realpathOnce?: () => Promise<never>;
        readonly realpathCalls: 0 | 1;
      };

      const cases: readonly Case[] = [
        // a-c: the final segment names no listed project, so the basename
        // gate refuses before any `realpath` call runs.
        { label: 'a: does not exist', cwd: doesNotExist, status: 403, realpathCalls: 0 },
        { label: 'b: exists, not a repo', cwd: notARepo, status: 403, realpathCalls: 0 },
        {
          label: 'c: a repo the list does not name',
          cwd: strangerRepo,
          status: 403,
          realpathCalls: 0,
        },
        // d, f: the final segment names the member, so `realpath` runs once.
        {
          label: 'd: realpath rejects EACCES',
          cwd: memberAlias,
          status: 403,
          realpathOnce: eaccess,
          realpathCalls: 1,
        },
        // e: `load()` rejects before the basename gate is even reached, so
        // `realpath` never starts -- unlike under HEAD's concurrent await.
        {
          label: 'e: member path, load rejects',
          cwd: memberRepo,
          status: 403,
          loadRejects: true,
          realpathCalls: 0,
        },
        { label: 'f: member path, success', cwd: memberAlias, status: 200, realpathCalls: 1 },
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
        expect(realpathSpy, testCase.label).toHaveBeenCalledTimes(testCase.realpathCalls);
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
    'REWRITTEN from "awaits load to settlement before deciding, even once realpath has ' +
      'already rejected (AC2: awaited, not merely started)": realpath never starts before ' +
      'load() has settled (AC3: the order is the contract) -- old assertion was that a ' +
      'realpath rejection racing an unsettled load does not decide early; new assertion is ' +
      'that realpath has not even been called while load is still pending',
    async () => {
      const loadGate = deferred<readonly Project[]>();
      const load = vi.fn(() => loadGate.promise);
      const base = await start({ descriptor, load, createSession: vi.fn(async () => null) });

      const responsePromise = post(base, '/api/create-session-in', {
        cwd: memberAlias,
        title: 'a run',
      });

      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
      // Past the capability check, `load()` is the very first await:
      // `realpath` must not have started while it is still pending.
      expect(realpathSpy).not.toHaveBeenCalled();

      loadGate.resolve([project]);
      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(realpathSpy).toHaveBeenCalledTimes(1);
    },
  );

  it(
    'REWRITTEN from "awaits realpath to settlement before deciding, even once load has ' +
      'already rejected (AC2: awaited, not merely started)": a rejecting load() refuses with ' +
      'zero realpath calls -- old assertion was that a realpath resolution racing an already- ' +
      'rejected load does not decide early; new assertion is that realpath never starts at all',
    async () => {
      const load = vi.fn(async () => {
        throw new Error('the project store is gone');
      });
      const audit = vi.fn();
      const base = await start(
        { descriptor, load, createSession: vi.fn(async () => null) },
        { audit },
      );

      const response = await post(base, '/api/create-session-in', {
        cwd: memberRepo,
        title: 'a run',
      });

      expect(response.status).toBe(403);
      expect(realpathSpy).not.toHaveBeenCalled();
      expect(audit).toHaveBeenCalledTimes(1);
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

/**
 * #486 added a PANE-ONLY fallback to `createSessionInProject` -- a project
 * right after Start is all pane rows and no live agent yet, so
 * `loadClaudeCodeProjects` lists it from `tmuxSessions` alone
 * (`docs/design/vam-owns-the-session.md` Stage 1). `confineToProjectSet`
 * reads only the id out of whatever `load()` returns; it has no notion of
 * "live" vs "pane-only" at all. These two cases prove that is true in both
 * directions: a real, readable repository that `load()` simply does not name
 * is refused exactly like a non-repository, and a project that exists ONLY
 * as a tagged pane -- zero sessions -- is admitted exactly like one with a
 * live agent, because membership is checked by id, never by how the project
 * came to be listed.
 */
describe('create-session-in: membership is by id, live agent or pane-only alike', () => {
  beforeEach(() => {
    realpathSpy.mockClear();
  });

  it('refuses a real, readable repository that exists but names no project vam lists', async () => {
    const strangerRepo = await mkdtemp(join(tmpdir(), 'vam-outside-set-'));
    await mkdir(join(strangerRepo, '.git'), { recursive: true });
    const createSession = vi.fn(async () => null);
    const base = await start({ descriptor, load: vi.fn(async () => []), createSession });

    const response = await post(base, '/api/create-session-in', {
      cwd: strangerRepo,
      title: 'a run',
    });

    expect(response.status).toBe(403);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('admits a pane-only project -- one load() lists with no live agent behind it', async () => {
    const paneOnlyRepo = await mkdtemp(join(tmpdir(), 'vam-pane-only-'));
    await mkdir(join(paneOnlyRepo, '.git'), { recursive: true });
    // Shaped exactly like `loadClaudeCodeProjects`'s entry for a tmux pane
    // that has never had a live agent: the id vam's own digest derives from
    // the pane's cwd, and `sessions: []` -- there is no conversation yet, only
    // the pane.
    const paneOnlyProject = {
      id: projectIdOf(await realpath(paneOnlyRepo)),
      name: 'pane-only',
      sessions: [],
    } as unknown as Project;
    const createSession = vi.fn(async () => null);
    const base = await start({
      descriptor,
      load: vi.fn(async () => [paneOnlyProject]),
      createSession,
    });

    const response = await post(base, '/api/create-session-in', {
      cwd: paneOnlyRepo,
      title: 'a run',
    });

    expect(response.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith(paneOnlyProject.id, 'a run', undefined);
  });
});

/**
 * FINDING 3a9f9e70 (S3-minor): `confineToProjectSet` ran `realpath(body.cwd)`
 * for EVERY caller-named path, so its duration -- fast `ENOENT` versus a real
 * walk -- was a timing oracle for which directories exist on the host outside
 * vam's project set. The fix decides membership from data vam already holds
 * (the listed projects' own basenames) BEFORE the caller's path ever touches
 * the filesystem: a `cwd` whose final segment names no listed project is
 * refused with ZERO filesystem calls.
 */
describe('create-session-in: FINDING 3a9f9e70 -- refusal never touches the filesystem', () => {
  beforeEach(() => {
    realpathSpy.mockClear();
  });

  it(
    'refuses an existing stranger directory and a nonexistent path with zero realpath calls, ' +
      'byte-identical 403 bodies',
    async () => {
      const member = await mkdtemp(join(tmpdir(), 'vam-3a9f-member-'));
      await mkdir(join(member, '.git'), { recursive: true });
      const project = {
        id: projectIdOf(await realpath(member)),
        name: 'demo',
        sessions: [],
      } as unknown as Project;

      const strangerRepo = await mkdtemp(join(tmpdir(), 'vam-3a9f-stranger-'));
      await mkdir(join(strangerRepo, '.git'), { recursive: true });
      const goneParent = await mkdtemp(join(tmpdir(), 'vam-3a9f-gone-'));
      const doesNotExist = join(goneParent, 'never-created');

      const createSession = vi.fn(async () => null);
      const base = await start({ descriptor, load: vi.fn(async () => [project]), createSession });

      realpathSpy.mockClear();
      const strangerResponse = await post(base, '/api/create-session-in', {
        cwd: strangerRepo,
        title: 'a run',
      });
      const strangerRealpathCalls = realpathSpy.mock.calls.length;
      const strangerBody = await strangerResponse.text();

      realpathSpy.mockClear();
      const missingResponse = await post(base, '/api/create-session-in', {
        cwd: doesNotExist,
        title: 'a run',
      });
      const missingRealpathCalls = realpathSpy.mock.calls.length;
      const missingBody = await missingResponse.text();

      expect(strangerResponse.status).toBe(403);
      expect(missingResponse.status).toBe(403);
      expect(strangerBody).toBe(missingBody);
      expect(strangerBody).toBe(
        JSON.stringify({
          ok: false,
          error: {
            kind: 'refused',
            code: 'unauthorized-directory',
            message: 'this device may only start a session in a project vam already lists',
          },
        }),
      );
      // FINDING 3a9f9e70: under HEAD this was 1 `realpath` call per request
      // (2 total); the basename gate brings both to 0.
      expect(strangerRealpathCalls).toBe(0);
      expect(missingRealpathCalls).toBe(0);
      expect(createSession).not.toHaveBeenCalled();
    },
  );
});

/**
 * The residual this task accepts, and the property it must not lose:
 * symlinked SPELLINGS of a member root -- a symlinked ancestor directory --
 * still resolve and admit, exactly as before the fix.
 */
describe('create-session-in: symlinked spellings of a member root still admit', () => {
  beforeEach(() => {
    realpathSpy.mockClear();
  });

  it('admits a member reached through a symlinked ancestor directory, with exactly one realpath call', async () => {
    const realParent = await mkdtemp(join(tmpdir(), 'vam-real-parent-'));
    const repoName = 'a-member-repo';
    const repo = join(realParent, repoName);
    await mkdir(join(repo, '.git'), { recursive: true });
    const linkParent = join(tmpdir(), `vam-link-parent-${Date.now()}`);
    await symlink(realParent, linkParent);

    const project = {
      id: projectIdOf(await realpath(repo)),
      name: 'demo',
      sessions: [],
    } as unknown as Project;
    const createSession = vi.fn(async () => null);
    const base = await start({ descriptor, load: vi.fn(async () => [project]), createSession });

    realpathSpy.mockClear();
    const response = await post(base, '/api/create-session-in', {
      cwd: join(linkParent, repoName),
      title: 'a run',
    });

    expect(response.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith(project.id, 'a run', undefined);
    expect(realpathSpy).toHaveBeenCalledTimes(1);
  });

  it('admits a cwd whose lexical path.resolve already equals a member’s canonical path, with zero realpath calls', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'vam-lexical-member-'));
    await mkdir(join(repo, '.git'), { recursive: true });
    const canonical = await realpath(repo);
    const project = {
      id: projectIdOf(canonical),
      name: 'demo',
      sessions: [],
    } as unknown as Project;
    const createSession = vi.fn(async () => null);
    const base = await start({ descriptor, load: vi.fn(async () => [project]), createSession });

    realpathSpy.mockClear();
    const response = await post(base, '/api/create-session-in', {
      cwd: canonical,
      title: 'a run',
    });

    expect(response.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith(project.id, 'a run', undefined);
    expect(realpathSpy).not.toHaveBeenCalled();
  });
});

/** ADMISSION NEVER WIDENS: the guard returns only a listed project's own id. */
describe('create-session-in: admission never widens beyond a listed project id', () => {
  let member: string;
  let project: Project;

  beforeEach(async () => {
    member = await mkdtemp(join(tmpdir(), 'vam-widen-member-'));
    await mkdir(join(member, '.git'), { recursive: true });
    project = {
      id: projectIdOf(await realpath(member)),
      name: 'demo',
      sessions: [],
    } as unknown as Project;
    realpathSpy.mockClear();
  });

  it('admits a lexical path with ".." segments that resolves to the member, returning only the member id', async () => {
    const createSession = vi.fn(async () => null);
    const base = await start({ descriptor, load: vi.fn(async () => [project]), createSession });

    // Built from the member's OWN canonical spelling so `path.resolve`
    // strips the ".." back down to exactly that spelling -- proving the
    // lexical fast path (step 3) handles ".." segments safely, admitting
    // with zero `realpath` calls, and returning only the member's own id.
    const canonicalMember = await realpath(member);
    const cwd = join(canonicalMember, 'no-such-child', '..');
    realpathSpy.mockClear();
    const response = await post(base, '/api/create-session-in', { cwd, title: 'a run' });

    expect(response.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith(project.id, 'a run', undefined);
    expect(realpathSpy).not.toHaveBeenCalled();
  });

  it('realpaths once and refuses a stranger path whose final segment merely equals a member’s basename', async () => {
    const decoyParent = await mkdtemp(join(tmpdir(), 'vam-decoy-parent-'));
    const decoy = join(decoyParent, basename(member));
    await mkdir(join(decoy, '.git'), { recursive: true });

    const createSession = vi.fn(async () => null);
    const base = await start({ descriptor, load: vi.fn(async () => [project]), createSession });

    realpathSpy.mockClear();
    const response = await post(base, '/api/create-session-in', { cwd: decoy, title: 'a run' });

    expect(response.status).toBe(403);
    expect(createSession).not.toHaveBeenCalled();
    expect(realpathSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * `namesAListedProject`'s own doc comment (`server.ts`) claims a project id
 * of any shape OTHER than `claude-code:<basename>-<8 hex>` "contributes no
 * basename -- it cannot be a false admission, only a false negative that
 * `realpath` never gets the chance to correct". Pinned directly: a listed
 * project whose id does not match `PROJECT_ID_SHAPE` never crashes the
 * regex exec (`?.[1]` on a `null` match), and never lets a stranger cwd
 * whose final segment happens to equal that project's own directory name
 * slip past the basename gate -- with zero filesystem calls either way,
 * because `projectIdOf` (both the lexical and the canonical id this guard
 * computes from `body.cwd`) always mints a `claude-code:`-shaped id, so an
 * odd-shaped listed id can never be matched at any of the guard's steps,
 * not merely the basename pre-filter -- a false negative throughout, by
 * construction, never a crash and never a false admission.
 */
describe('create-session-in: a project id of a shape other than claude-code:<basename>-<hex> contributes no basename', () => {
  beforeEach(() => {
    realpathSpy.mockClear();
  });

  it('never crashes the basename gate and never admits by a merely-matching basename', async () => {
    const member = await mkdtemp(join(tmpdir(), 'vam-oddshape-member-'));
    await mkdir(join(member, '.git'), { recursive: true });
    const canonical = await realpath(member);
    // Deliberately NOT `claude-code:<basename>-<8 hex>` -- a plausible id
    // from a differently-shaped source.
    const oddProject = {
      id: `codex:${projectIdOf(canonical)}`,
      name: 'odd-source',
      sessions: [],
    } as unknown as Project;

    const createSession = vi.fn(async () => null);
    const base = await start({
      descriptor,
      load: vi.fn(async () => [oddProject]),
      createSession,
    });

    // A cwd whose final segment names the member (basename gate would admit
    // a claude-code-shaped id here) is refused: the odd-shaped id never
    // contributed a basename, so this is a false negative, not a crash and
    // not a false admission.
    realpathSpy.mockClear();
    const response = await post(base, '/api/create-session-in', {
      cwd: member,
      title: 'a run',
    });
    expect(response.status).toBe(403);
    expect(createSession).not.toHaveBeenCalled();
    // The pre-filter still runs synchronously and refuses before any
    // realpath call -- the odd shape costs zero filesystem calls too.
    expect(realpathSpy).not.toHaveBeenCalled();
  });

  it("is refused even by the project's own lexically-exact canonical spelling, because projectIdOf never mints this shape", async () => {
    const member = await mkdtemp(join(tmpdir(), 'vam-oddshape-lexical-'));
    await mkdir(join(member, '.git'), { recursive: true });
    const canonical = await realpath(member);
    const oddProject = {
      id: `codex:${projectIdOf(canonical)}`,
      name: 'odd-source',
      sessions: [],
    } as unknown as Project;
    const createSession = vi.fn(async () => null);
    const base = await start({
      descriptor,
      load: vi.fn(async () => [oddProject]),
      createSession,
    });

    // Step 3 (lexical) computes `projectIdOf(resolve(body.cwd))`, which is
    // ALWAYS `claude-code:`-shaped -- it can never equal `oddProject.id`,
    // so even the caller's exact canonical spelling is refused. This is not
    // a defect this task introduces: it holds on HEAD too, and is pinned
    // here so a future change to the id-matching steps cannot silently
    // widen admission to an id shape `projectIdOf` itself never produces.
    realpathSpy.mockClear();
    const response = await post(base, '/api/create-session-in', {
      cwd: canonical,
      title: 'a run',
    });

    expect(response.status).toBe(403);
    expect(createSession).not.toHaveBeenCalled();
  });
});

/**
 * THE ALIAS TRADE-OFF, PINNED: a symlink whose OWN name differs from its
 * target's basename is refused with zero filesystem calls. This is the
 * accepted cost of the basename gate -- `realpath(linkPath)` would resolve to
 * the member, but the gate never runs it because `linkPath`'s own spelling
 * does not name a listed project. Renaming the symlink to match the member's
 * basename opts back into admission (see the ancestor-symlink test above).
 */
describe('create-session-in: a differently-named symlink alias is refused, cheaply', () => {
  beforeEach(() => {
    realpathSpy.mockClear();
  });

  it('refuses a symlink whose own name differs from its target’s basename, with zero realpath calls', async () => {
    const member = await mkdtemp(join(tmpdir(), 'vam-alias-member-'));
    await mkdir(join(member, '.git'), { recursive: true });
    const project = {
      id: projectIdOf(await realpath(member)),
      name: 'demo',
      sessions: [],
    } as unknown as Project;
    const linkPath = join(tmpdir(), `vam-alias-differently-named-${Date.now()}`);
    await symlink(member, linkPath);

    const createSession = vi.fn(async () => null);
    const base = await start({ descriptor, load: vi.fn(async () => [project]), createSession });

    realpathSpy.mockClear();
    const response = await post(base, '/api/create-session-in', {
      cwd: linkPath,
      title: 'a run',
    });

    expect(response.status).toBe(403);
    expect(createSession).not.toHaveBeenCalled();
    expect(realpathSpy).not.toHaveBeenCalled();
  });
});
