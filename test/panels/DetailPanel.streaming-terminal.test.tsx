// @vitest-environment happy-dom

/**
 * WHICH TERMINAL TAB `DetailPanel` DRAWS: `TerminalTab`'s poll (default) or
 * `TerminalStreamTab`'s xterm.js stream, gated on `prefs/streaming-
 * terminal.ts`'s `streamingTerminal` flag.
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
import { setActiveStreamingTerminal } from '../../src/renderer/prefs/streaming-terminal.js';

class FakeTerminal {
  cols = 80;
  rows = 24;
  options: Record<string, unknown> = {};
  loadAddon() {}
  open() {}
  write() {}
  reset() {}
  onData() {}
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

describe('the streaming setting is off by default', () => {
  it('draws TerminalTab, and never opens a stream', () => {
    const open = vi.fn(async () => ({ ok: true as const, streamId: 'x', seed: '' }));
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
    draw();
    openTerminal();
    expect(q('[data-terminal]')).not.toBeNull();
    expect(q('[data-terminal-stream]')).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('the streaming setting on', () => {
  it('draws the streaming tab instead, opening with (projectId, rowId)', async () => {
    const open = vi.fn(async () => ({ ok: true as const, streamId: 'x', seed: '' }));
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
    setActiveStreamingTerminal(true);
    draw();
    openTerminal();
    await waitFor(() => {
      if (!document.querySelector('[data-terminal-stream]')) throw new Error('still pending');
    });
    expect(q('[data-terminal]')).toBeNull();
    expect(open).toHaveBeenCalledWith('p1', 's1');
  });
});
