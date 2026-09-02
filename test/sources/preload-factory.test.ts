import { describe, expect, it, vi } from 'vitest';
import type { SourceCapabilities, SourceDeclines } from '../../src/renderer/sources/port.js';
import { canGovernWith, canSubscribeTo, canWriteTo } from '../../src/renderer/sources/port.js';
import { createSourceFromPreload } from '../../src/renderer/sources/preload-factory.js';
import type { PreloadSourceApi, SourceDescriptor } from '../../src/shared/preload-api.js';

const NO_CAPABILITIES: SourceCapabilities = {
  liveUpdates: false,
  recordPrompt: false,
  deliverPrompt: false,
  promptAttachments: false,
  slashCommands: false,
  renameSession: false,
  closeSession: false,
  createSession: false,
  governance: false,
  pullRequests: false,
  terminal: false,
  agentRoster: false,
};

const ALL_CAPABILITIES: SourceCapabilities = {
  liveUpdates: true,
  recordPrompt: true,
  deliverPrompt: true,
  promptAttachments: true,
  slashCommands: true,
  renameSession: true,
  closeSession: true,
  createSession: true,
  governance: true,
  pullRequests: true,
  terminal: true,
  agentRoster: true,
};

/**
 * A decline for every false capability. The port's own rule is that a refusal
 * is written by the source that lacks the thing, so a fixture shipping twelve
 * `false` flags with `declines: {}` teaches the next adapter that empty
 * declines are acceptable -- while its tests stay green.
 */
function declinesFor(capabilities: SourceCapabilities): SourceDeclines {
  return Object.fromEntries(
    Object.entries(capabilities)
      .filter(([, on]) => !on)
      .map(([k]) => [k, `the fixture source does not implement ${k}`]),
  );
}

function makeDescriptor(
  capabilities: SourceCapabilities,
  overrides: Partial<SourceDescriptor> = {},
): SourceDescriptor {
  return {
    id: 'black-smith',
    label: 'Bridged fixture',
    capabilities,
    declines: declinesFor(capabilities),
    viewerScope: { kind: 'connection', note: 'the connection is the identity' },
    ...overrides,
  };
}

/**
 * A stand-in for what `contextBridge.exposeInMainWorld` puts on `window`: every
 * member present unconditionally, whatever the source turns out to be able to
 * do. No electron is imported anywhere in this test, by design.
 */
function makeApi(descriptor: SourceDescriptor): PreloadSourceApi {
  const unsubscribe = vi.fn();
  return {
    describe: vi.fn(async () => descriptor),
    load: vi.fn(async () => []),
    subscribe: vi.fn(() => unsubscribe),
    recordPrompt: vi.fn(async () => undefined),
    renameSession: vi.fn(async () => undefined),
    closeSession: vi.fn(async () => undefined),
    createSession: vi.fn(async () => undefined),
    applyWaivers: vi.fn(async () => undefined),
    transitionLesson: vi.fn(async () => undefined),
  };
}

describe('createSourceFromPreload', () => {
  it('carries the descriptor data through onto the source', async () => {
    const descriptor = makeDescriptor(NO_CAPABILITIES, {
      label: 'Named by the source',
      declines: { liveUpdates: 'this backend has no event stream' },
      viewerScope: { kind: 'unscoped', warning: 'cannot promise scoping' },
    });
    const source = await createSourceFromPreload(makeApi(descriptor));

    expect(source.id).toBe('black-smith');
    expect(source.label).toBe('Named by the source');
    expect(source.capabilities).toEqual(NO_CAPABILITIES);
    expect(source.declines).toEqual({ liveUpdates: 'this backend has no event stream' });
    expect(source.viewerScope).toEqual({ kind: 'unscoped', warning: 'cannot promise scoping' });
  });

  it('omits every optional member when no capability is claimed', async () => {
    const source = await createSourceFromPreload(makeApi(makeDescriptor(NO_CAPABILITIES)));

    // `in`, never `=== undefined`: a stub and an explicitly-undefined property
    // both pass `=== undefined`, and both are exactly what the port forbids.
    expect('subscribe' in source).toBe(false);
    expect('write' in source).toBe(false);
    expect('governance' in source).toBe(false);
    expect(Object.keys(source)).not.toContain('subscribe');
    expect(Object.keys(source)).not.toContain('write');
    expect(Object.keys(source)).not.toContain('governance');
  });

  it('assigns every optional member when every capability is claimed', async () => {
    const source = await createSourceFromPreload(makeApi(makeDescriptor(ALL_CAPABILITIES)));

    expect('subscribe' in source).toBe(true);
    expect('write' in source).toBe(true);
    expect('governance' in source).toBe(true);
    expect(canSubscribeTo(source)).toBe(true);
    expect(canWriteTo(source)).toBe(true);
    expect(canGovernWith(source)).toBe(true);
  });

  it('omits each write lifecycle member independently of recordPrompt', async () => {
    const source = await createSourceFromPreload(
      makeApi(
        makeDescriptor({
          ...NO_CAPABILITIES,
          recordPrompt: true,
          renameSession: true,
        }),
      ),
    );

    if (!canWriteTo(source)) throw new Error('expected a writable source');
    expect('recordPrompt' in source.write).toBe(true);
    expect('renameSession' in source.write).toBe(true);
    expect('closeSession' in source.write).toBe(false);
    expect('createSession' in source.write).toBe(false);
  });

  it('refuses a lifecycle capability that no member could ever reach', async () => {
    // `SourceWrites.recordPrompt` is required by the port, so there is no way
    // to expose `renameSession` without it. Silently dropping the write surface
    // -- which is what this factory used to do -- leaves `capabilities
    // .renameSession` true with nothing behind it and no decline explaining the
    // gap: a source that lies about itself, and the lie only surfaces wherever
    // someone reads the flag. Refuse it instead.
    await expect(
      createSourceFromPreload(
        makeApi(makeDescriptor({ ...NO_CAPABILITIES, renameSession: true, closeSession: true })),
      ),
    ).rejects.toThrow(/claims renameSession, closeSession but not recordPrompt/);
  });

  it('drops the write surface when NO write capability is claimed at all', async () => {
    const source = await createSourceFromPreload(makeApi(makeDescriptor(NO_CAPABILITIES)));

    expect('write' in source).toBe(false);
    expect(canWriteTo(source)).toBe(false);
  });

  it('forwards load, subscribe and the unsubscribe handle to the api', async () => {
    const api = makeApi(makeDescriptor(ALL_CAPABILITIES));
    const source = await createSourceFromPreload(api);

    await source.load();
    expect(api.load).toHaveBeenCalledTimes(1);

    if (!canSubscribeTo(source)) throw new Error('expected a live source');
    const onChange = () => undefined;
    const stop = source.subscribe(onChange);
    expect(api.subscribe).toHaveBeenCalledWith(onChange);
    stop();
  });

  it('forwards every write and governance call to the api', async () => {
    const api = makeApi(makeDescriptor(ALL_CAPABILITIES));
    const source = await createSourceFromPreload(api);

    if (!canWriteTo(source)) throw new Error('expected a writable source');
    await source.write.recordPrompt('s1', 'hello');
    await source.write.renameSession?.('s1', 'new title');
    await source.write.closeSession?.('s1');
    await source.write.createSession?.('p1', 'fresh');
    expect(api.recordPrompt).toHaveBeenCalledWith('s1', 'hello');
    expect(api.renameSession).toHaveBeenCalledWith('s1', 'new title');
    expect(api.closeSession).toHaveBeenCalledWith('s1');
    expect(api.createSession).toHaveBeenCalledWith('p1', 'fresh');

    if (!canGovernWith(source)) throw new Error('expected a governing source');
    await source.governance.applyWaivers('s1', ['f1']);
    await source.governance.transitionLesson('s1', 'l1', 'approved');
    expect(api.applyWaivers).toHaveBeenCalledWith('s1', ['f1']);
    expect(api.transitionLesson).toHaveBeenCalledWith('s1', 'l1', 'approved');
  });
});
