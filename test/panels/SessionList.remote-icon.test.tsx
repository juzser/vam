// @vitest-environment happy-dom

/**
 * The Remote surface promoted to a top-level icon, beside Settings — the
 * operator's own request. Reachable by mouse (this file) and by keystroke
 * (`test/canvas/Canvas.remote-key.test.tsx`, which asserts the keystroke
 * actually opens the overlay rather than merely existing in a table).
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionList } from '../../src/renderer/panels/SessionList.js';
import { baseProps, entriesOf } from './session-list-props.js';

afterEach(cleanup);

describe('SessionList — the Remote icon', () => {
  it('sits beside Settings in the avatar bar, with its own accessible name', () => {
    render(<SessionList {...baseProps(entriesOf([]))} />);
    const settings = screen.getByLabelText('settings');
    const remote = screen.getByLabelText('remote access');
    const bar = settings.closest('[data-avatar-bar]');
    expect(bar).not.toBeNull();
    expect(remote.closest('[data-avatar-bar]')).toBe(bar);
  });

  it('sits in the avatar bar, which already carries the phone shell’s 44px floor', () => {
    // `styles.css` enumerates `[data-avatar-bar] button` at 44px for the
    // phone shell — the same rule Settings and the theme toggle ride on — so
    // this control needs no opt-in class of its own, only the right parent.
    // `e2e/phone-shell.pw.ts` measures the real 44x44 box; this holds the
    // half that guard cannot see from a headless run without a browser.
    render(<SessionList {...baseProps(entriesOf([]))} />);
    const remote = screen.getByLabelText('remote access');
    expect(remote.closest('[data-avatar-bar]')).not.toBeNull();
    expect(remote.tagName).toBe('BUTTON');
  });

  it('calls onRemote, not onSettings, when clicked', () => {
    const onRemote = vi.fn();
    const onSettings = vi.fn();
    render(
      <SessionList {...baseProps(entriesOf([]))} onRemote={onRemote} onSettings={onSettings} />,
    );
    screen.getByLabelText('remote access').click();
    expect(onRemote).toHaveBeenCalledTimes(1);
    expect(onSettings).not.toHaveBeenCalled();
  });
});
