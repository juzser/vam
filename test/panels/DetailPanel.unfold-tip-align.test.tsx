// @vitest-environment happy-dom

/**
 * Pins that the 'Show working' tip stays start-aligned (EC-118).
 *
 * Closes f-vam-ux-3/followup-c080bd27-c080bd27. e7a94dfa gave ShortcutTip an
 * optional `align` prop that it hands to Radix `Tooltip.Content`, and the unfold
 * toggle's tip passes "start": centred, the tip of a folded stepless toggle
 * spilled over the sidebar's filter button. Radix's `data-align` is computed
 * by floating-ui from happy-dom's zero-size rects and is not stable, so this
 * reads the `align` prop at the Radix boundary, which is what the fix changed.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type ComponentProps, forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Decision, Session } from '../../src/renderer/domain/model.js';
import { ShortcutTip } from '../../src/renderer/keyboard/ShortcutTip.js';
import { DetailPanel } from '../../src/renderer/panels/DetailPanel.js';
import { DEFAULT_FOCUS_VIEW, setActiveFocusView } from '../../src/renderer/prefs/progress.js';

const seen = vi.hoisted(() => ({ aligns: [] as unknown[] }));

vi.mock('@radix-ui/react-tooltip', async (importOriginal) => {
  const original = await importOriginal<typeof import('@radix-ui/react-tooltip')>();
  const Content = forwardRef<HTMLDivElement, ComponentProps<typeof original.Content>>(
    (props, ref) => {
      seen.aligns.push(props.align);
      return <original.Content {...props} ref={ref} />;
    },
  );
  return { ...original, Content };
});

const noop = () => {};
type Props = ComponentProps<typeof DetailPanel>;

function draw(decisions: readonly Decision[], session: Partial<Session> = {}) {
  const built = { id: 's1', title: 'T', status: 'running', activity: null, decisions, ...session };
  const entry = { project: { id: 'p1', name: 'atlas', sessions: [built] }, session: built };
  const props = {
    draft: '',
    onDraftChange: noop,
    onSubmit: noop,
    onCompose: noop,
    width: 408,
    composing: false,
    active: false,
    actionIndex: 0,
    resizeHandle: null,
    onStopComposing: noop,
    entry,
    decision: decisions[0] ?? null,
  };
  render(<DetailPanel {...(props as unknown as Props)} />);
}

afterEach(() => {
  cleanup();
  setActiveFocusView(DEFAULT_FOCUS_VIEW);
  seen.aligns.length = 0;
});

describe('tip alignment (EC-118)', () => {
  it('start-aligns the unfold toggle tip on a folded turn with no steps', async () => {
    setActiveFocusView(true);
    draw([{ id: 'a', label: 'turn-a', input: 'ask a', output: 'done a', commands: [], steps: [] }]);
    const toggle = document.querySelector<HTMLElement>('[data-turn-unfold]') as HTMLElement;
    fireEvent.focus(toggle);
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain('Show working');
    expect(seen.aligns.at(-1)).toBe('start');
  });

  it('hands Radix no align when ShortcutTip is given none', async () => {
    render(
      <ShortcutTip label="Settings">
        <button type="button">S</button>
      </ShortcutTip>,
    );
    fireEvent.focus(screen.getByRole('button'));
    await screen.findByRole('tooltip');
    expect(seen.aligns.at(-1)).toBeUndefined();
    expect(seen.aligns.length).toBeGreaterThan(0);
  });
});
