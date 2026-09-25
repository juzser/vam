// @vitest-environment happy-dom

/**
 * `TerminalTab.tsx` is now the FALLBACK renderer too (`docs/design/terminal-
 * streaming.md`'s "Flipping the default" section, task 3): `TerminalAutoTab.tsx`
 * drops down to this tab when streaming refuses or gives up, and an operator
 * looking at a pane that just silently changed implementation deserves one
 * line saying so. This is that line, an optional prop this file draws and
 * does nothing else with -- `TerminalAutoTab.tsx`'s own tests cover WHEN it
 * is passed.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalTab } from '../../src/renderer/panels/TerminalTab.js';
import type { PaneView } from '../../src/shared/terminal.js';

afterEach(cleanup);

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);

const ATLAS = 'claude-code:atlas-11111111';

describe('the fallback notice', () => {
  it('draws nothing extra when no notice is passed', () => {
    const read = vi.fn(async () => ({ kind: 'unavailable' }) as PaneView);
    render(<TerminalTab projectId={ATLAS} read={read} resize={undefined} send={undefined} />);
    expect(q('[data-terminal-fallback-notice]')).toBeNull();
  });

  it('draws the exact sentence passed, once, as a one-line banner', () => {
    const read = vi.fn(async () => ({ kind: 'unavailable' }) as PaneView);
    render(
      <TerminalTab
        projectId={ATLAS}
        read={read}
        resize={undefined}
        send={undefined}
        notice="vam switched to the classic terminal: this tmux is older than streaming needs."
      />,
    );
    const notice = q('[data-terminal-fallback-notice]');
    expect(notice?.textContent).toBe(
      'vam switched to the classic terminal: this tmux is older than streaming needs.',
    );
  });

  it('draws nothing when the notice is explicitly null, same as omitted', () => {
    const read = vi.fn(async () => ({ kind: 'unavailable' }) as PaneView);
    render(
      <TerminalTab
        projectId={ATLAS}
        read={read}
        resize={undefined}
        send={undefined}
        notice={null}
      />,
    );
    expect(q('[data-terminal-fallback-notice]')).toBeNull();
  });
});
