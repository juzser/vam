// @vitest-environment happy-dom

/**
 * EC-41/42/43, operator event #32: the provider, model and mode menus open
 * right above their own trigger, the provider menu draws each provider's icon,
 * and each mode option carries a one-line description.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Decision, Project, Session } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';
import { DetailPanel, MODE_DESCRIPTIONS } from '../../src/renderer/panels/DetailPanel.js';
import { PROVIDERS } from '../../src/shared/providers.js';

const DECISION: Decision = {
  id: 'd1',
  label: 'plan',
  input: 'ask',
  output: 'answered',
  commands: [],
};

const SESSION: Session = {
  id: 's1',
  title: 'Sprint board reorder',
  epic: null,
  branch: null,
  status: 'idle',
  runningAgents: 0,
  activity: null,
  age: '12m',
  decisions: [DECISION],
  vamControlled: true,
};

const PROJECT: Project = { id: 'p1', name: 'atlas', sessions: [SESSION] };
const ENTRY: SessionEntry = { project: PROJECT, session: SESSION };

function draw() {
  render(
    <DetailPanel
      entry={ENTRY}
      decision={DECISION}
      draft=""
      onDraftChange={() => {}}
      onSubmit={() => {}}
      composing={false}
      onCompose={() => {}}
      onStopComposing={() => {}}
      active={false}
      actionIndex={0}
      width={408}
      resizeHandle={null}
      delivers={true}
      terminal={true}
      defaultProvider="claude-code"
      onSetDefaultProvider={() => {}}
    />,
  );
}

const q = <T extends Element>(selector: string) => document.querySelector<T>(selector);
const all = (selector: string) => [...document.querySelectorAll(selector)];

afterEach(cleanup);

const TRIGGERS = [
  ['provider', '[data-provider-picker-toggle]', '[data-provider-picker]'],
  ['model', '[data-model-picker]', '[data-model-picker-menu]'],
  ['mode', '[data-mode-toggle]', '[data-mode-picker]'],
] as const;

const TRIGGER_SELECTOR = TRIGGERS.map(([, trigger]) => trigger).join(', ');

function openMenu(trigger: string, menu: string) {
  act(() => q<HTMLButtonElement>(trigger)?.click());
  return q<HTMLElement>(menu) as HTMLElement;
}

describe('each composer menu is anchored to its own trigger', () => {
  for (const [name, trigger, menu] of TRIGGERS) {
    it(`the ${name} menu hangs off a wrapper holding only the ${name} trigger`, () => {
      draw();
      const popover = openMenu(trigger, menu);
      expect(popover).not.toBeNull();
      const anchor = popover.parentElement?.closest('[data-popover-anchor]') ?? null;
      expect(anchor).not.toBeNull();
      expect(anchor?.contains(q(trigger))).toBe(true);
      expect(anchor?.querySelectorAll(TRIGGER_SELECTOR)).toHaveLength(1);
      const classes = popover.className.split(/\s+/);
      expect(classes).toContain('bottom-full');
      expect(classes).not.toContain('inset-x-0');
      expect(classes).not.toContain('w-full');
    });
  }
});

describe('the provider menu draws each provider icon', () => {
  const iconOf = (el: Element | null) => el?.querySelector('svg[data-provider-icon]') ?? null;

  it('puts an aria-hidden currentColor svg first in every option', () => {
    draw();
    const options = [
      ...openMenu('[data-provider-picker-toggle]', '[data-provider-picker]').querySelectorAll(
        '[role=option]',
      ),
    ];
    expect(options.map((o) => o.getAttribute('data-provider-option'))).toEqual(
      PROVIDERS.map((p) => p.id),
    );
    for (const option of options) {
      const icon = option.firstElementChild as SVGElement;
      expect(icon.matches('svg[data-provider-icon]')).toBe(true);
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      const paint = [icon, ...icon.querySelectorAll('*')].flatMap((el) =>
        ['fill', 'stroke'].map((a) => el.getAttribute(a)),
      );
      expect(paint.filter((v) => v !== null && v !== 'none')).not.toHaveLength(0);
      for (const value of paint) {
        if (value !== null) expect(['currentColor', 'none']).toContain(value);
      }
      expect(icon.outerHTML).not.toMatch(/#[0-9a-f]{3,8}|rgb\(|hsl\(/i);
    }
  });

  it('draws the current provider icon on the trigger too', () => {
    draw();
    expect(iconOf(q('[data-provider-picker-toggle]'))).not.toBeNull();
  });

  it('has an icon for every provider the picker lists', () => {
    draw();
    const menu = openMenu('[data-provider-picker-toggle]', '[data-provider-picker]');
    for (const provider of PROVIDERS) {
      const option = menu.querySelector(`[data-provider-option="${provider.id}"]`);
      expect(iconOf(option)?.getAttribute('data-provider-icon')).toBe(provider.id);
    }
  });
});

describe('each mode option carries a one-line description', () => {
  it('sits directly under the label, truncated, quiet, and equals MODE_DESCRIPTIONS', () => {
    draw();
    const menu = openMenu('[data-mode-toggle]', '[data-mode-picker]');
    const options = [...menu.querySelectorAll<HTMLElement>('[data-mode-option]')];
    expect(options).toHaveLength(Object.keys(MODE_DESCRIPTIONS).length);
    const seen = new Set<string>();
    for (const [mode, text] of Object.entries(MODE_DESCRIPTIONS)) {
      const option = menu.querySelector(
        `[data-mode-option="${mode.toLowerCase()}"]`,
      ) as HTMLElement;
      const description = option.querySelector<HTMLElement>('[data-mode-description]');
      expect(description?.textContent).toBe(text);
      expect(text.trim()).not.toBe('');
      expect(text).toMatch(/^[\x20-\x7e]+$/);
      const classes = (description?.className ?? '').split(/\s+/);
      for (const c of ['truncate', 'text-meta', 'text-ink-faint']) expect(classes).toContain(c);
      expect(description?.previousElementSibling?.textContent).toBe(mode);
      seen.add(text);
    }
    expect(seen.size).toBe(options.length);
    expect(all('[data-mode-description]')).toHaveLength(options.length);
  });
});
