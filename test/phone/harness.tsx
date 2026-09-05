/**
 * One phone-width harness for the four files below it.
 *
 * The only thing that makes these tests phone tests is `matchMedia`: it
 * answers the shell's own `PHONE_QUERY` and nothing else, which is exactly how
 * a 390px browser answers and exactly why every OTHER test in this repo still
 * renders the columns -- their environment answers that query with `false`.
 */

import type { CanvasSource } from '../../src/renderer/canvas/source.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';
import { PHONE_QUERY } from '../../src/renderer/phone/viewport.js';
import type { SessionSource, SourceDeclines } from '../../src/renderer/sources/port.js';

export function step(id: string, label: string, output: string): Decision {
  return { id, label, input: `run ${label}`, output, commands: [] };
}

export function session(id: string, over: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    icon: null,
    epic: null,
    branch: null,
    status: 'done',
    runningAgents: 0,
    activity: null,
    age: null,
    decisions: [],
    ...over,
  };
}

/** Five steps, so the canvas's three-card cap would show if it applied here. */
export const FIVE_STEPS: readonly Decision[] = [
  step('d5', 'gate', 'the gate said yes'),
  step('d4', 'verifier', 'the verifier said maybe'),
  step('d3', 'reviewer', 'the reviewer said no'),
  step('d2', 'planner', 'the planner planned'),
  step('d1', 'researcher', 'the researcher read'),
];

export const MODEL: CanvasModel = {
  projects: [
    {
      id: 'p1',
      name: 'alpha',
      source: 'claude-code',
      sessions: [
        session('a1', { title: 'nightly sweep', status: 'waiting', decisions: FIVE_STEPS }),
        session('a2', { title: 'second thing' }),
      ],
    },
  ],
};

/** A `session` source, with whatever capabilities and words the test needs. */
export function phoneSource(
  over: {
    capabilities?: Record<string, boolean>;
    declines?: SourceDeclines;
    /** Present makes the source able to close, and records what it was asked. */
    closeSession?: (sessionId: string) => Promise<void>;
  } = {},
): CanvasSource {
  const inner = {
    id: 'claude-code',
    label: 'Claude Code',
    capabilities: {
      liveUpdates: false,
      recordPrompt: true,
      deliverPrompt: false,
      promptAttachments: false,
      slashCommands: false,
      renameSession: false,
      closeSession: over.closeSession !== undefined,
      createSession: false,
      governance: false,
      pullRequests: false,
      terminal: false,
      agentRoster: false,
      ...over.capabilities,
    },
    declines: over.declines ?? {},
    viewerScope: { kind: 'connection', note: 'one local process' },
    load: async () => [],
    write: {
      recordPrompt: async () => {},
      ...(over.closeSession === undefined ? {} : { closeSession: over.closeSession }),
    },
  };
  return { kind: 'session', source: inner as unknown as SessionSource, onWrote: () => {} };
}

/** The globals a rendering Canvas test installs, plus a phone-width screen. */
export function installPhoneGlobals(): void {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.DOMMatrixReadOnly ??= class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
  globalThis.localStorage ??= (() => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, String(value)),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
      key: (index: number) => [...map.keys()][index] ?? null,
      get length() {
        return map.size;
      },
    };
  })() as unknown as Storage;

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      media: query,
      matches: query === PHONE_QUERY,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

export const shell = (which: 'list' | 'session') =>
  document.querySelector(`[data-phone-shell="${which}"]`);
export const rows = () => [...document.querySelectorAll('[data-session-row]')];
export const chips = () => [...document.querySelectorAll('[data-step-chip]')];
