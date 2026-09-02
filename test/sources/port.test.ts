import { describe, expect, it } from 'vitest';
import type {
  SessionSource,
  SourceCapabilities,
  SourceDeclines,
  SourceError,
  ViewerScope,
} from '../../src/renderer/sources/port.js';
import { canGovernWith, canSubscribeTo, canWriteTo } from '../../src/renderer/sources/port.js';

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

function makeSource(
  capabilities: SourceCapabilities,
  extra: Partial<SessionSource> = {},
): SessionSource {
  return {
    // `SourceId` is still the pre-task-2 literal union (`'black-smith' | 'orca'`);
    // task-2 opens it to a plain string. Reuse an existing member here rather
    // than widen it ourselves -- this task owns only the port.
    id: 'black-smith',
    label: 'Fixture A',
    capabilities,
    declines: {},
    viewerScope: { kind: 'connection', note: 'invented data, no other viewer' },
    load: async () => [],
    ...extra,
  };
}

describe('SourceCapabilities', () => {
  it('carries exactly twelve boolean members', () => {
    expect(Object.keys(NO_CAPABILITIES)).toHaveLength(12);
    for (const value of Object.values(NO_CAPABILITIES)) {
      expect(typeof value).toBe('boolean');
    }
  });
});

describe('ViewerScope', () => {
  it('accepts all three declared arms', () => {
    const connection: ViewerScope = { kind: 'connection', note: 'local log, no other viewer' };
    const filtered: ViewerScope = { kind: 'filtered', note: 'filtered to the authenticated user' };
    const unscoped: ViewerScope = { kind: 'unscoped', warning: 'shared backend, cannot promise' };
    expect([connection.kind, filtered.kind, unscoped.kind]).toEqual([
      'connection',
      'filtered',
      'unscoped',
    ]);
  });
});

describe('SourceError', () => {
  it('carries kind, code and message', () => {
    const refused: SourceError = { kind: 'refused', code: '403', message: 'no access' };
    const unreachable: SourceError = { kind: 'unreachable', code: 'ECONNREFUSED', message: 'down' };
    expect(refused.kind).toBe('refused');
    expect(unreachable.kind).toBe('unreachable');
  });
});

describe('SourceDeclines', () => {
  it('maps a subset of capability keys to non-empty strings', () => {
    const declines: SourceDeclines = {
      deliverPrompt: 'this log has no live agent to deliver a prompt to',
      terminal: 'no terminal surface exists for this source',
    };
    expect(declines.deliverPrompt).toBeTruthy();
    expect(declines.governance).toBeUndefined();
  });
});

describe('narrowing helpers -- runtime behaviour when capability is granted', () => {
  it('canSubscribeTo narrows to a callable subscribe member', () => {
    const source = makeSource(ALL_CAPABILITIES, {
      subscribe: (onChange: () => void) => {
        onChange();
        return () => {};
      },
    });
    if (canSubscribeTo(source)) {
      expect(typeof source.subscribe).toBe('function');
    } else {
      throw new Error('expected canSubscribeTo to narrow true when liveUpdates is granted');
    }
  });

  it('canWriteTo narrows to a callable write member', () => {
    const source = makeSource(ALL_CAPABILITIES, {
      write: { recordPrompt: async () => {} },
    });
    if (canWriteTo(source)) {
      expect(typeof source.write.recordPrompt).toBe('function');
    } else {
      throw new Error('expected canWriteTo to narrow true when recordPrompt is granted');
    }
  });

  it('canGovernWith narrows to a callable governance member', () => {
    const source = makeSource(ALL_CAPABILITIES, {
      governance: {
        applyWaivers: async () => {},
        transitionLesson: async () => {},
      },
    });
    if (canGovernWith(source)) {
      expect(typeof source.governance.applyWaivers).toBe('function');
    } else {
      throw new Error('expected canGovernWith to narrow true when governance is granted');
    }
  });
});

describe('narrowing helpers -- capability withheld', () => {
  it('a withheld source reports false from every narrowing helper', () => {
    const source = makeSource(NO_CAPABILITIES);
    expect(canSubscribeTo(source)).toBe(false);
    expect(canWriteTo(source)).toBe(false);
    expect(canGovernWith(source)).toBe(false);
  });
});

// Compile-failure fixture, not a runtime assertion -- this function is never
// invoked. `subscribe`, `write` and `governance` are typed as optional
// members, so TypeScript refuses to call through them without a narrowing
// check first ("possibly undefined"), independent of any runtime capability
// flag. If a future edit widened these to required-but-nullable members
// instead of optional ones, each `@ts-expect-error` below would itself fail
// to suppress an error and `tsc -p tsconfig.test.json` would go red, which is
// the proof this criterion asks for. `it.skip` keeps vitest from executing
// the body while still type-checking it under `tsc -p tsconfig.test.json`.
function ungatedCallsDoNotTypecheck(source: SessionSource): void {
  // @ts-expect-error -- subscribe is optional; calling it ungated must not typecheck.
  source.subscribe(() => {});

  // @ts-expect-error -- write is optional; calling through it ungated must not typecheck.
  source.write.recordPrompt('session-1', 'hello');

  // @ts-expect-error -- governance is optional; calling through it ungated must not typecheck.
  source.governance.applyWaivers('session-1', []);
}

describe('ungated calls do not typecheck (compile-time proof)', () => {
  it.skip('subscribe, write and governance require a narrowing check first (type-only)', () => {
    // Body intentionally never runs; see `ungatedCallsDoNotTypecheck` above,
    // which the typechecker still visits because it is a top-level function.
    ungatedCallsDoNotTypecheck(makeSource(NO_CAPABILITIES));
  });
});
