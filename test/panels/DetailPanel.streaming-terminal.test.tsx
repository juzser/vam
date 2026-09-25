// @vitest-environment happy-dom

/**
 * WHICH TERMINAL TAB `DetailPanel` DRAWS, through the ONE call it now makes
 * (`TerminalAutoTab`, `docs/design/terminal-streaming.md`'s "Flipping the
 * default"): `TerminalStreamTab`'s xterm.js stream is the default now, gated
 * live on `prefs/streaming-terminal.ts`'s `streamingTerminal` flag, with
 * `TerminalTab`'s poll as the explicit opt-out and the runtime fallback.
 * `TerminalAutoTab.test.tsx` covers the fallback itself in depth; this file
 * only needs to prove `DetailPanel` still reaches it correctly through the
 * one prop it owns (`entry`) and the pref DetailPanel no longer reads
 * directly.
 *
 * `@xterm/xterm` and `@xterm/addon-fit` are mocked exactly as
 * `TerminalStreamTab.test.tsx` mocks them -- the SUBJECT here is which
 * component mounts, not xterm.js's own rendering.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, type DetailPanelProps } from '../../src/renderer/panels/DetailPanel.js';
import {
  DEFAULT_STREAMING_TERMINAL,
  setActiveStreamingTerminal,
} from '../../src/renderer/prefs/streaming-terminal.js';

class FakeTerminal {
  cols = 80;
  rows = 24;
  options: Record<string, unknown> = {};
  // `TerminalStreamTab.tsx`'s own `connect()` reads AND writes this (loading
  // `Unicode11Addon`, then `term.unicode.activeVersion = '11'`) -- a CI
  // finding: without it, that assignment threw `Cannot set properties of
  // undefined (setting 'activeVersion')`, swallowed by `connect()`'s own
  // `.catch()`, so this file's own tests were passing without that whole
  // code path ever completing. Fixing that alone then surfaced the IDENTICAL
  // failure mode one line further down (`attachCustomKeyEventHandler is not
  // a function`) -- this stub is now complete enough for `connect()` to run
  // to the end without throwing, matching the level `TerminalStreamTab.
  // test.tsx`'s own (fuller) `FakeTerminal` already keeps for the same
  // reason.
  unicode: { activeVersion: string } = { activeVersion: '6' };
  // A REAL element, the same reason `TerminalStreamTab.test.tsx`'s own
  // `FakeTerminal` uses one: the paste listener below calls
  // `.addEventListener` on it directly.
  textarea: HTMLTextAreaElement = document.createElement('textarea');
  modes: { bracketedPasteMode: boolean } = { bracketedPasteMode: false };
  loadAddon() {}
  open() {}
  write() {}
  reset() {}
  onData() {}
  attachCustomKeyEventHandler() {}
  scrollPages() {}
  scrollToTop() {}
  scrollToBottom() {}
  dispose() {}
}

class FakeFitAddon {
  fit() {}
  proposeDimensions() {
    return undefined;
  }
}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);

const DECISION: Decision = {
  id: 'd1',
  label: 'step 1',
  input: 'ask',
  output: 'answered',
  commands: [],
};

const SESSION: Session = {
  id: 's1',
  title: 'atlas work',
  epic: null,
  branch: null,
  status: 'waiting',
  runningAgents: 0,
  activity: null,
  age: '12m',
  decisions: [DECISION],
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ENTRY: SessionEntry = { project: PROJECT, session: SESSION };

function draw(over: Partial<DetailPanelProps> = {}) {
  const props: DetailPanelProps = {
    entry: ENTRY,
    decision: DECISION,
    draft: '',
    onDraftChange: () => {},
    onSubmit: () => {},
    composing: false,
    onCompose: () => {},
    onStopComposing: () => {},
    active: false,
    actionIndex: 0,
    width: 408,
    resizeHandle: null,
    ...over,
  };
  render(<DetailPanel {...props} />);
}

const openTerminal = () => {
  act(() => {
    q<HTMLButtonElement>('[data-view="terminal"]')?.click();
  });
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'api');
  setActiveStreamingTerminal(false);
});

describe('the streaming setting is on by default now', () => {
  it('draws the streaming tab, opening with (projectId, rowId), no explicit opt-in needed', async () => {
    const open = vi.fn(async () => ({ ok: true as const, streamId: 'x', seed: '', name: 'n' }));
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        terminalStream: {
          open,
          close: vi.fn(),
          write: vi.fn(),
          onData: () => () => {},
          onSeed: () => () => {},
          onDown: () => () => {},
        },
      },
    });
    setActiveStreamingTerminal(DEFAULT_STREAMING_TERMINAL);
    draw();
    openTerminal();
    await waitFor(() => {
      if (!document.querySelector('[data-terminal-stream]')) throw new Error('still pending');
    });
    expect(q('[data-terminal]')).toBeNull();
    expect(open).toHaveBeenCalledWith('p1', 's1');
  });
});

describe('the streaming setting turned off', () => {
  it('draws TerminalTab instead, and never opens a stream', () => {
    const open = vi.fn(async () => ({ ok: true as const, streamId: 'x', seed: '', name: 'n' }));
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        terminalStream: {
          open,
          close: vi.fn(),
          write: vi.fn(),
          onData: () => () => {},
          onSeed: () => () => {},
          onDown: () => () => {},
        },
      },
    });
    setActiveStreamingTerminal(false);
    draw();
    openTerminal();
    expect(q('[data-terminal]')).not.toBeNull();
    expect(q('[data-terminal-stream]')).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});
