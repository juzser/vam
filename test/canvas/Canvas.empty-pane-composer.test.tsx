// @vitest-environment happy-dom

/**
 * An empty pane must not draw controls that cannot act.
 *
 * Audit F8 (S2). Since PR 268 `zv` MOVES the active tab, so a split of a
 * single-tab pane routinely leaves the source pane empty — and that pane went
 * on drawing a complete composer: a `readOnly` textarea, attach, the provider
 * picker, the model field and an ENABLED record button. Pressing record did
 * nothing and the status bar did not change; attach did the same; the `PRs`
 * icon answered "this source does not report pull requests for a session"
 * about a session that does not exist. Six controls against this codebase's
 * first rule — absent, not dimmed; a control that cannot act is withdrawn or
 * refuses aloud. The `+` in the same strip already gets it right, and
 * `DetailPanel` already had the withdrawal path (`composerHidden`); the
 * no-session case simply did not use it.
 *
 * Audit F9 rides along: the same empty pane said "no sessions open — pick one
 * from the sidebar" in the strip and "No session selected — pick one in the
 * sidebar." in the body, 40px apart, in otherwise empty space. One sentence,
 * said once, in the strip that is always there.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Canvas } from '../../src/renderer/canvas/Canvas.js';
import type { CanvasModel, Decision, Session } from '../../src/renderer/domain/model.js';

function decision(id: string): Decision {
  return { id, label: id, input: `in-${id}`, output: `out-${id}`, commands: [] };
}

function session(id: string): Session {
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
    decisions: [decision(`d-${id}`)],
  };
}

const MODEL: CanvasModel = {
  projects: [{ id: 'p1', name: 'alpha', source: 'claude-code', sessions: [session('a1')] }],
};

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

const paneFor = (id: string) => document.querySelector(`[data-split-pane="${id}"]`);

/** Split the one tab out of pane-1, which leaves pane-1 holding nothing. */
function emptyPane() {
  render(<Canvas model={MODEL} />);
  press('z');
  press('v');
  const pane = paneFor('pane-1');
  expect(pane?.querySelectorAll('[data-tab-select]')).toHaveLength(0);
  return pane as Element;
}

afterEach(cleanup);

describe('a pane holding no session draws no composer', () => {
  it('draws no box to type in — it could only ever be readOnly', () => {
    expect(emptyPane().querySelectorAll('textarea')).toHaveLength(0);
  });

  it('withdraws the record button rather than leaving it enabled and silent', () => {
    const pane = emptyPane();
    expect(pane.querySelector('[data-prompt-record]')).toBeNull();
  });

  it('withdraws attach, the provider picker and the model field with it', () => {
    const pane = emptyPane();
    for (const hook of [
      '[data-attach]',
      '[data-prompt-tools]',
      '[data-provider-picker-toggle]',
      '[data-model-request]',
    ]) {
      expect(pane.querySelector(hook), hook).toBeNull();
    }
  });

  it('leaves the pane that RECEIVED the tab with its composer intact', () => {
    // The withdrawal is about having no session, not about splitting: the
    // half that holds the tab must be untouched, or this "fix" is a
    // regression wearing a finding's clothes.
    emptyPane();
    const busy = paneFor('pane-2') as Element;
    expect(busy.querySelectorAll('textarea').length).toBeGreaterThan(0);
    expect(busy.querySelector('[data-prompt-record]')).not.toBeNull();
    expect(busy.querySelector('[data-attach]')).not.toBeNull();
  });
});

describe('the empty pane says it once', () => {
  it('does not stack the strip’s sentence and the body’s 40px apart', () => {
    const pane = emptyPane();
    const text = pane.textContent ?? '';
    expect(text).toContain('no sessions open');
    // WAS: "No session selected — pick one in the sidebar." directly below.
    expect(text).not.toContain('No session selected');
  });
});
