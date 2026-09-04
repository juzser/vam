/**
 * AC-15 and AC-16(b): `load()` crosses the IPC boundary intact, the descriptor
 * governs which optional members exist, and no handler trusts its arguments.
 *
 * The boundary is REAL here, not stubbed away: `invokeAcross` structured-clones
 * the arguments on the way in and the result on the way out, which is exactly
 * what `ipcRenderer.invoke` does. That is the whole point of this file. The
 * epic ARGUES that `src/renderer/domain/model.ts` is structured-clone-safe --
 * pure type declarations, no Date, no class, no method, `Session.age` a
 * pre-formatted string -- and an assertion that never clones cannot test the
 * argument, only restate it.
 *
 * Shapes are checked FIELD BY FIELD against the declarations in `model.ts`
 * (`PROJECT_SHAPE` below transcribes them), never with `toBeTruthy()`: a
 * `Date` that survives the clone as a `Date`, and a class instance that
 * arrives as a plain object where a string was declared, both have to fail.
 */

import { describe, expect, it } from 'vitest';
import { CHANNELS } from '../../src/main/ipc/channels.js';
import { registerSourceIpc } from '../../src/main/ipc/handlers.js';
import { FIXTURE_SOURCE } from '../../src/main/sources/fixture-source.js';
import type { MainSource } from '../../src/main/sources/source.js';
import { createPreloadApi, type DesktopSourceApi } from '../../src/preload/api.js';
import type { Project, Session } from '../../src/renderer/domain/model.js';
import { createSourceFromPreload } from '../../src/renderer/sources/preload-factory.js';
import type { PreloadSourceApi } from '../../src/shared/preload-api.js';

/**
 * The factory's parameter type includes `subscribe`, which this task
 * deliberately does not implement (it needs `ipcRenderer.on`, not `invoke`).
 * The member is genuinely absent at runtime, and the descriptor declares
 * `liveUpdates: false`, so the factory never reads it -- were that ever untrue
 * the call would fail loudly rather than call a stub.
 */
const asFactoryApi = (api: DesktopSourceApi) => api as PreloadSourceApi;

/** A structured-clone boundary with an `ipcMain`/`ipcRenderer` pair either side. */
function createIpcPair() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const rejections: unknown[] = [];
  const ipcMain = {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
      handlers.set(channel, (...args: unknown[]) => listener({}, ...args));
    },
  };
  const ipcRenderer = {
    async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      const handler = handlers.get(channel);
      if (handler === undefined) {
        throw new Error(`no handler for ${channel}`);
      }
      // Clone in, clone out: the electron boundary copies both directions and
      // carries no prototypes.
      try {
        return structuredClone(await handler(...(structuredClone(args) as unknown[])));
      } catch (error) {
        // An unhandled rejection escaping main is itself a failure (AC-16b);
        // record it so a test can assert none happened.
        rejections.push(error);
        throw error;
      }
    },
  };
  return { ipcMain, ipcRenderer, rejections };
}

function wire(source: MainSource) {
  const pair = createIpcPair();
  registerSourceIpc(pair.ipcMain, source);
  return { api: createPreloadApi(pair.ipcRenderer), ...pair };
}

type Shape = Record<string, (value: unknown) => boolean>;

const isString = (v: unknown) => typeof v === 'string';
const nullable = (check: (v: unknown) => boolean) => (v: unknown) => v === null || check(v);
const oneOf =
  (...allowed: string[]) =>
  (v: unknown) =>
    typeof v === 'string' && allowed.includes(v);

const COMMAND_SHAPE: Shape = { id: isString, label: isString, command: isString };
const DECISION_SHAPE: Shape = {
  id: isString,
  label: isString,
  input: isString,
  output: nullable(isString),
  commands: (v) => Array.isArray(v) && v.every((c) => matches(c, COMMAND_SHAPE).length === 0),
};
/**
 * `Session.agents`, which crosses the bridge as plain data like everything
 * else. Declared here because the key set below is EXACT: a field main starts
 * sending that this file does not know about fails as "not declared in
 * model.ts", which is the failure mode a new field has.
 */
const AGENT_SHAPE: Shape = {
  id: isString,
  type: nullable(isString),
  description: nullable(isString),
  running: (v) => typeof v === 'boolean',
};
const SESSION_SHAPE: Shape = {
  id: isString,
  title: isString,
  icon: nullable(isString),
  epic: nullable(isString),
  branch: nullable(isString),
  status: oneOf('running', 'waiting', 'done', 'failed'),
  runningAgents: (v) => typeof v === 'number' && Number.isInteger(v),
  activity: nullable(isString),
  age: nullable(isString),
  decisions: (v) => Array.isArray(v) && v.every((d) => matches(d, DECISION_SHAPE).length === 0),
  agents: (v) => Array.isArray(v) && v.every((a) => matches(a, AGENT_SHAPE).length === 0),
};
const PROJECT_SHAPE: Shape = {
  id: isString,
  name: isString,
  // AC-4 said leave this as oneOf('black-smith', 'orca') and it was correct
  // until AC-1 renamed FIXTURE_SOURCE's Project.source off 'black-smith': the
  // real value this check runs against is now a third string, and SourceId
  // is `string` (task-2, PR #42) -- oneOf(...) was already stale for that,
  // this task only surfaced it. isString matches the declared type exactly.
  source: isString,
  sessions: (v) => Array.isArray(v) && v.every((s) => matches(s, SESSION_SHAPE).length === 0),
};

/**
 * Every declared field present and of its declared type, and NO field beyond
 * them. The exact key set matters: a class instance arrives as a plain object
 * and is caught by the per-field type check, and anything main invented on the
 * way out is caught by the key set.
 */
function matches(value: unknown, shape: Shape, path = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path || 'value'}: expected a plain object, got ${describeValue(value)}`];
  }
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const [key, check] of Object.entries(shape)) {
    if (!(key in record)) {
      problems.push(`${path}${key}: missing`);
    } else if (!check(record[key])) {
      problems.push(`${path}${key}: wrong type -- ${describeValue(record[key])}`);
    }
  }
  for (const key of Object.keys(record)) {
    if (!(key in shape)) {
      problems.push(`${path}${key}: not declared in model.ts`);
    }
  }
  return problems;
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object')
    return `object(${Object.getPrototypeOf(value)?.constructor?.name})`;
  return `${typeof value} ${JSON.stringify(value)}`;
}

function shapeProblems(projects: readonly Project[]): string[] {
  return projects.flatMap((project, i) => matches(project, PROJECT_SHAPE, `projects[${i}].`));
}

describe('load() crosses the IPC boundary intact', () => {
  it('delivers projects whose every field matches model.ts, field by field', async () => {
    const { api } = wire(FIXTURE_SOURCE);
    const source = await createSourceFromPreload(asFactoryApi(api));
    const projects = await source.load();

    expect(projects.length).toBeGreaterThan(0);
    expect(shapeProblems(projects)).toEqual([]);
  });

  it('delivers the same values main holds, not merely the same shape', async () => {
    const { api } = wire(FIXTURE_SOURCE);
    const source = await createSourceFromPreload(asFactoryApi(api));

    expect(await source.load()).toEqual(await FIXTURE_SOURCE.load());
  });

  it('carries the descriptor across as data', async () => {
    const { api } = wire(FIXTURE_SOURCE);
    const source = await createSourceFromPreload(asFactoryApi(api));

    expect(source.id).toBe(FIXTURE_SOURCE.descriptor.id);
    expect(source.label).toBe(FIXTURE_SOURCE.descriptor.label);
    expect(source.capabilities).toEqual(FIXTURE_SOURCE.descriptor.capabilities);
    expect(source.viewerScope).toEqual(FIXTURE_SOURCE.descriptor.viewerScope);
  });

  // The falsifiers of AC-15, run as tests rather than described: main puts a
  // Date and then a class instance inside a Session, and the field-by-field
  // check must REFUSE both. A `toBeTruthy()` assertion passes on both.
  it('refuses a Date smuggled into a declared string field', async () => {
    const withDate: MainSource = {
      descriptor: FIXTURE_SOURCE.descriptor,
      load: async () => corruptFirstSession(await FIXTURE_SOURCE.load(), { age: new Date(0) }),
    };
    const { api } = wire(withDate);
    const source = await createSourceFromPreload(asFactoryApi(api));

    expect(shapeProblems(await source.load())).toEqual([
      'projects[0].sessions: wrong type -- array',
    ]);
  });

  it('refuses a class instance where a string is declared', async () => {
    class Title {
      readonly text = 'nine';
    }
    const withClass: MainSource = {
      descriptor: FIXTURE_SOURCE.descriptor,
      load: async () => corruptFirstSession(await FIXTURE_SOURCE.load(), { title: new Title() }),
    };
    const { api } = wire(withClass);
    const source = await createSourceFromPreload(asFactoryApi(api));

    expect(shapeProblems(await source.load())).not.toEqual([]);
  });
});

function corruptFirstSession(
  projects: readonly Project[],
  patch: Record<string, unknown>,
): readonly Project[] {
  const [first, ...rest] = projects;
  if (first === undefined) {
    throw new Error('the fixture has no project to corrupt');
  }
  const [session, ...others] = first.sessions;
  const corrupted = { ...session, ...patch } as unknown as Session;
  return [{ ...first, sessions: [corrupted, ...others] }, ...rest];
}

describe('the descriptor governs which optional members exist', () => {
  it('has no subscribe, write or governance member when every flag is false', async () => {
    const { api } = wire(FIXTURE_SOURCE);
    const source = await createSourceFromPreload(asFactoryApi(api));

    // `in`, not `=== undefined`: an assigned `undefined` would satisfy the
    // latter while still showing a consumer an affordance it must not draw.
    expect('subscribe' in source).toBe(false);
    expect('write' in source).toBe(false);
    expect('governance' in source).toBe(false);
  });

  it('declares liveUpdates false and says why', async () => {
    const { api } = wire(FIXTURE_SOURCE);
    const source = await createSourceFromPreload(asFactoryApi(api));

    expect(source.capabilities.liveUpdates).toBe(false);
    expect(source.declines.liveUpdates).toBeTruthy();
  });

  it('carries a decline for every capability it lacks', async () => {
    const { api } = wire(FIXTURE_SOURCE);
    const source = await createSourceFromPreload(asFactoryApi(api));

    const undeclined = Object.entries(source.capabilities)
      .filter(([key, able]) => !able && !source.declines[key as keyof typeof source.capabilities])
      .map(([key]) => key);
    expect(undeclined).toEqual([]);
  });
});

describe('main validates every IPC payload (AC-16b)', () => {
  const ARGUMENTFUL: { channel: string; wrong: unknown[] }[] = [
    { channel: CHANNELS.recordPrompt, wrong: [1, {}] },
    { channel: CHANNELS.renameSession, wrong: [{ sessionId: 's' }, null] },
    { channel: CHANNELS.closeSession, wrong: [{}] },
    { channel: CHANNELS.createSession, wrong: [[], 7] },
    { channel: CHANNELS.applyWaivers, wrong: ['s', 'not-an-array'] },
    { channel: CHANNELS.transitionLesson, wrong: ['s', 'l', 9] },
  ];

  it.each(ARGUMENTFUL)('refuses $channel when arguments are missing', async ({ channel }) => {
    const { ipcRenderer, rejections } = wire(FIXTURE_SOURCE);

    const result = await ipcRenderer.invoke(channel, undefined);
    expect(isRefusal(result), `${channel} answered ${JSON.stringify(result)}`).toBe(true);
    expect(rejections).toEqual([]);
  });

  it.each(ARGUMENTFUL)(
    'refuses $channel when arguments are wrong-typed',
    async ({ channel, wrong }) => {
      const { ipcRenderer, rejections } = wire(FIXTURE_SOURCE);

      const result = await ipcRenderer.invoke(channel, ...wrong);
      expect(isRefusal(result), `${channel} answered ${JSON.stringify(result)}`).toBe(true);
      expect(rejections).toEqual([]);
    },
  );

  it('never reaches a write or governance surface, because there is none', async () => {
    const { api } = wire(FIXTURE_SOURCE);

    await expect(api.recordPrompt('s', 'p')).rejects.toMatchObject({ kind: 'refused' });
    await expect(api.applyWaivers('s', ['f'])).rejects.toMatchObject({ kind: 'refused' });
  });

  it('rejects preload-side with the SourceError main returned', async () => {
    const { api } = wire(FIXTURE_SOURCE);

    await expect(api.closeSession(undefined as unknown as string)).rejects.toMatchObject({
      kind: 'refused',
      code: expect.any(String),
      message: expect.any(String),
    });
  });

  // A compromised renderer can pass a type-correct, non-empty string or array
  // that is simply enormous. `isText`/`isTextList` must refuse it as
  // `invalid-payload` -- the same refusal any other bad shape gets -- and
  // must do so BEFORE anything walks the array, not merely eventually.
  it('refuses recordPrompt when the prompt text exceeds the PROMPT length bound', async () => {
    const { ipcRenderer, rejections } = wire(FIXTURE_SOURCE);
    const overLong = 'a'.repeat(1_000_001);

    const result = await ipcRenderer.invoke(CHANNELS.recordPrompt, 's', overLong);
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-payload' } });
    expect(rejections).toEqual([]);
  });

  // f-vam-electron-shell/task-4-load-ipc-c7bf7335: the identifier bound
  // (10,000) must NOT apply to the prompt body -- a real, pasted prompt
  // routinely exceeds it. This is the regression the finding is about:
  // without a separate, larger bound for the prompt body, this case is
  // wrongly refused as invalid-payload.
  it('accepts a recordPrompt body above the identifier bound but within the prompt bound', async () => {
    const { ipcRenderer, rejections } = wire(FIXTURE_SOURCE);
    const longButReal = 'a'.repeat(60_268); // roughly the measured p99

    const result = await ipcRenderer.invoke(CHANNELS.recordPrompt, 's', longButReal);
    // Validation passes the length check; refusal here is for lack of the
    // capability, not invalid-payload -- the FIXTURE_SOURCE advertises none.
    expect(result).toMatchObject({
      ok: false,
      error: { code: expect.stringMatching(/^unsupported:/) },
    });
    expect(rejections).toEqual([]);
  });

  it('refuses applyWaivers when the waiver list exceeds the count bound', async () => {
    const { ipcRenderer, rejections } = wire(FIXTURE_SOURCE);
    const overCount = Array.from({ length: 1001 }, (_, i) => `f-${i}`);

    const result = await ipcRenderer.invoke(CHANNELS.applyWaivers, 's', overCount);
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-payload' } });
    expect(rejections).toEqual([]);
  });

  it('still validates a normal-sized prompt and waiver list past the length/count check', async () => {
    const { ipcRenderer, rejections } = wire(FIXTURE_SOURCE);

    const promptResult = await ipcRenderer.invoke(CHANNELS.recordPrompt, 's', 'a normal prompt');
    expect(promptResult).toMatchObject({
      ok: false,
      error: { code: expect.stringMatching(/^unsupported:/) },
    });

    const waiversResult = await ipcRenderer.invoke(CHANNELS.applyWaivers, 's', ['f1', 'f2']);
    expect(waiversResult).toMatchObject({
      ok: false,
      error: { code: expect.stringMatching(/^unsupported:/) },
    });
    expect(rejections).toEqual([]);
  });
});

function isRefusal(result: unknown): boolean {
  if (result === null || typeof result !== 'object') return false;
  const envelope = result as {
    ok?: unknown;
    error?: { kind?: unknown; code?: unknown; message?: unknown };
  };
  return (
    envelope.ok === false &&
    (envelope.error?.kind === 'refused' || envelope.error?.kind === 'unreachable') &&
    typeof envelope.error?.code === 'string' &&
    typeof envelope.error?.message === 'string'
  );
}
