// @vitest-environment happy-dom

/**
 * The canvas node's glow and border, measured against the ADE mockup.
 *
 * Two surfaces, tested two ways, because the truth lives in two places:
 *
 *  - the COMPONENTS decide which treatment a node wears (halo, plain border,
 *    focus ring), and that is a class-name assertion on rendered output;
 *  - `styles.css` decides what each treatment IS, and no DOM here loads a
 *    stylesheet, so that half is asserted over the file's text.
 *
 * The text half is a content scan and claims no more than one: it proves the
 * declarations exist and sit inside the block they must sit inside — in
 * particular that the reduced-motion fallback really is inside the
 * `prefers-reduced-motion` media block, which a comment once claimed while the
 * rule sat outside it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionInfoNode } from '../../src/renderer/canvas/SessionInfoNode.js';
import { StepNode } from '../../src/renderer/canvas/StepNode.js';
import type { Decision, Project, Session, SourceId } from '../../src/renderer/domain/model.js';
import type { SessionEntry } from '../../src/renderer/domain/selectors.js';

afterEach(cleanup);

// Resolved from the working directory, not from `import.meta.url`: under the
// happy-dom environment that URL is an http one and `fileURLToPath` rejects it.
const CSS = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');

/**
 * The text between the braces of the first rule whose selector text starts at
 * `selector`, brace-matched so a nested block (a media query) comes back whole.
 */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `no rule for \`${selector}\` in styles.css`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after \`${selector}\``);
}

function decision(id: string, output: string | null): Decision {
  return { id, label: `label-${id}`, input: 'in', output, commands: [] };
}

function entryOf(over: Partial<Session> = {}): SessionEntry {
  const session: Session = {
    id: 's1',
    title: 'alpha-refactor',
    icon: null,
    epic: null,
    status: 'running',
    runningAgents: 1,
    activity: null,
    age: '12m',
    decisions: [decision('d0', null), decision('d1', 'done')],
    ...over,
  };
  const project: Project = {
    id: 'p1',
    name: 'vam',
    source: 'black-smith' as SourceId,
    sessions: [session],
  };
  return { project, session };
}

/**
 * The rest of ReactFlow's `NodeProps`, which these components never read.
 *
 * Spelled out rather than cast away. `{...({} as never)}` typechecked under
 * the app config and failed under `tsconfig.test.json`, which is stricter —
 * and a cast would have gone on hiding whichever of these ReactFlow adds next.
 */
const FLOW_PROPS = {
  selected: false,
  dragging: false,
  draggable: false,
  selectable: false,
  deletable: false,
  type: 'info',
  zIndex: 0,
  isConnectable: false,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
} as const;

/** The rendered node's own element — never a fallback, so a miss fails loudly. */
function nodeRoot(container: HTMLElement, selector: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(selector);
  expect(el, `nothing matched \`${selector}\`; the assertions below would be vacuous`).not.toBe(
    null,
  );
  return el as HTMLElement;
}

function renderInfo(over: Partial<Session>, focused: boolean) {
  const { container } = render(
    <ReactFlowProvider>
      <SessionInfoNode
        id="info"
        data={{ entry: entryOf(over), focused, jumpLabel: null }}
        {...FLOW_PROPS}
      />
    </ReactFlowProvider>,
  );
  return nodeRoot(container, '[data-session-card]');
}

describe('the glow marks the keyboard cursor', () => {
  it('gives the focused card the glow and nothing else', () => {
    const el = renderInfo({ status: 'running' }, true);
    expect(el.className).toContain('vam-cursor-glow');
    // No louder border underneath it. The halo IS the mark; a second edge
    // would be a second thing to read for one fact.
    expect(el.className).not.toContain('border-line-loudest');
    expect(el.className).toContain('border-line');
  });

  it('gives an unfocused needs-you card the same grey edge as any inactive node', () => {
    // Its amber lives in the breathing dot and the word, not in an edge. Two
    // amber edges on one canvas — one for needs-you, one for the cursor —
    // would make the halo ambiguous, which is the whole reason it moved.
    const el = renderInfo({ status: 'waiting' }, false);
    expect(el.className).not.toContain('vam-cursor-glow');
    expect(el.className).not.toContain('border-waiting');
    expect(el.className).toContain('border-line');
  });

  it('marks a focused needs-you card exactly like any other focused card', () => {
    const el = renderInfo({ status: 'waiting' }, true);
    expect(el.className).toContain('vam-cursor-glow');
    expect(el.className).not.toContain('border-waiting');
    expect(el.className).not.toContain('border-line-loudest');
  });

  it('leaves an ordinary card the plain line border and no glow', () => {
    const el = renderInfo({ status: 'done' }, false);
    expect(el.className).toContain('border-line');
    expect(el.className).not.toContain('vam-cursor-glow');
    expect(el.className).not.toContain('border-waiting');
  });

  it('retires the needs-you halo and its ring token, which now have no caller', () => {
    expect(CSS).not.toMatch(/\.vam-call\b/);
    expect(CSS).not.toMatch(/--vam-call-ring/);
    expect(CSS).not.toMatch(/\.vam-focus-ring\b/);
  });

  it('builds the glow from the theme-stable cursor amber, not from --color-waiting', () => {
    const glow = ruleBody(CSS, '.vam-cursor-glow');
    expect(glow).toMatch(/box-shadow:/);
    expect(glow).toMatch(/var\(--color-cursor-ring\)/);
    expect(glow).toMatch(/animation:\s*vam-cursor-glow/);
    const frames = ruleBody(CSS, '@keyframes vam-cursor-glow');
    expect(frames.match(/box-shadow:/g)?.length).toBe(2);
    expect(frames).toMatch(/var\(--color-cursor-ring\)/);
    // NOT --color-waiting: that token darkens in the light theme, and the
    // mockup's light artboard keeps the identical amber in its halo. Binding
    // the glow to the status hue would quietly change it with the theme.
    expect(frames).not.toMatch(/var\(--color-waiting\)/);
  });

  it('defines the cursor amber in both themes, with the same value', () => {
    const dark = ruleBody(CSS, ':root');
    const light = ruleBody(CSS, 'html.light');
    const read = (block: string) => block.match(/--vam-cursor-ring:\s*([^;]+);/)?.[1]?.trim();
    expect(read(dark), 'no cursor ring in the dark block').toBeDefined();
    expect(read(light), 'no cursor ring in the light block').toBeDefined();
    expect(read(light)).toBe(read(dark));
  });
});

describe('the running light sweep, measured off the mockup', () => {
  it('renders exactly one edge on a running session card', () => {
    const el = renderInfo({ status: 'running' }, false);
    expect(el.querySelectorAll('.vam-running-edge').length).toBe(1);
  });

  it('renders none on a card that is not running', () => {
    for (const status of ['waiting', 'done', 'failed'] as const) {
      const el = renderInfo({ status }, false);
      expect(el.querySelectorAll('.vam-running-edge').length, status).toBe(0);
    }
  });

  it('hides the edge from the accessibility tree — it is a restatement of the status word', () => {
    const el = renderInfo({ status: 'running' }, false);
    expect(el.querySelector('.vam-running-edge')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is a 1px strip at the top of the card, clipping a travelling bar', () => {
    // Mockup: `left:0;right:0;top:0;height:1px;overflow:hidden` wrapping a
    // `width:34%` gradient bar. The old rule was 3px tall at `top:-3px`, i.e.
    // OUTSIDE the card, sweeping a background-position instead.
    const strip = ruleBody(CSS, '.vam-running-edge');
    expect(strip).toMatch(/height:\s*1px/);
    expect(strip).toMatch(/top:\s*0/);
    expect(strip).not.toMatch(/top:\s*-/);
    expect(strip).toMatch(/overflow:\s*hidden/);

    const bar = ruleBody(CSS, '.vam-running-edge::after');
    expect(bar).toMatch(/width:\s*34%/);
    expect(bar).toMatch(
      /linear-gradient\(\s*90deg,\s*transparent,\s*var\(--color-running\),\s*transparent\s*\)/s,
    );
    expect(bar).toMatch(/animation:\s*vam-sweep/);
  });

  it('travels by transform, from -110% to 420%', () => {
    const frames = ruleBody(CSS, '@keyframes vam-sweep');
    expect(frames).toMatch(/translateX\(-110%\)/);
    expect(frames).toMatch(/translateX\(420%\)/);
    expect(frames).not.toMatch(/background-position/);
  });
});

describe('reduced motion: every glow stops, and each leaves a static stand-in', () => {
  const reduced = ruleBody(CSS, '@media (prefers-reduced-motion: reduce)');

  it('stops both the cursor glow and the sweep, inside that block', () => {
    expect(reduced).toMatch(/\.vam-cursor-glow/);
    expect(reduced).toMatch(/\.vam-running-edge::after/);
    expect(reduced).toMatch(/animation:\s*none/);
  });

  it('leaves the focused card a static ring, inside that same block', () => {
    // Asserted on the media block's own text, so a fallback that drifts out of
    // the block cannot pass by living somewhere else in the file.
    const after = reduced.slice(reduced.indexOf('animation: none'));
    expect(after).toMatch(/\.vam-cursor-glow\s*\{[^}]*box-shadow:[^}]*var\(--color-cursor-ring\)/s);
  });

  it('leaves the running edge a full-width bar rather than a blank line', () => {
    const after = reduced.slice(reduced.indexOf('animation: none'));
    expect(after).toMatch(/\.vam-running-edge::after\s*\{[^}]*width:\s*100%/s);
  });
});

/**
 * The step card wears the same two treatments, and it was the half left
 * unwired: `StepNode` still named `vam-call` and `vam-focus-ring` after both
 * were deleted from styles.css, so the asking step had no halo and the focused
 * step no ring — dead class names rather than a crash, which is why nothing
 * caught it.
 */
describe('StepNode wears the cursor glow and the running edge', () => {
  function renderStep(over: Partial<Session>, decisionIndex: number, focused: boolean) {
    const entry = entryOf(over);
    const target = entry.session.decisions[decisionIndex];
    expect(target, 'the fixture has no decision at that index').toBeDefined();
    const { container } = render(
      <ReactFlowProvider>
        <StepNode
          id="step"
          data={{ entry, decision: target as Decision, focused, jumpLabel: null }}
          {...FLOW_PROPS}
        />
      </ReactFlowProvider>,
    );
    return nodeRoot(container, '[data-step-kind]');
  }

  it('gives the focused step the cursor glow and the ordinary border', () => {
    const card = renderStep({ status: 'done' }, 1, true);
    expect(card.className).toContain('vam-cursor-glow');
    expect(card.className).toContain('border-line');
    expect(card.className).not.toContain('border-line-loudest');
    // The classes deleted from styles.css must not come back by habit.
    expect(card.className).not.toContain('vam-call');
    expect(card.className).not.toContain('vam-focus-ring');
  });

  it('gives an asking step no edge of its own, focused or not', () => {
    // The asking step says what it wants through its kind word and its amber
    // header, not through a border. Only the cursor gets a treatment.
    const focusedAsk = renderStep({ status: 'waiting' }, 0, true);
    expect(focusedAsk.className).toContain('vam-cursor-glow');
    expect(focusedAsk.className).not.toContain('border-waiting');
    const restingAsk = renderStep({ status: 'waiting' }, 0, false);
    expect(restingAsk.className).not.toContain('vam-cursor-glow');
    expect(restingAsk.className).not.toContain('border-waiting');
  });

  it('sweeps only the newest step of a running session', () => {
    const edge = (card: HTMLElement) => card.querySelectorAll('.vam-running-edge').length;
    // decisions[0] is the newest — that one sweeps.
    expect(edge(renderStep({ status: 'running' }, 0, false))).toBe(1);
    // Its predecessor does not, or every step of a running session would.
    expect(edge(renderStep({ status: 'running' }, 1, false))).toBe(0);
    // And a session that is not running has no sweep at all.
    expect(edge(renderStep({ status: 'waiting' }, 0, false))).toBe(0);
  });

  it('hides the sweep from screen readers — it restates the kind beside it', () => {
    const card = renderStep({ status: 'running' }, 0, false);
    expect(card.querySelector('.vam-running-edge')?.getAttribute('aria-hidden')).toBe('true');
  });
});
