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
        {...({} as never)}
      />
    </ReactFlowProvider>,
  );
  return nodeRoot(container, '[data-session-card]');
}

function renderStep(status: Session['status'], focused: boolean) {
  const entry = entryOf({ status });
  const { container } = render(
    <ReactFlowProvider>
      <StepNode
        id="step"
        data={{
          entry,
          // The newest decision, so a `waiting` session makes this the ask.
          decision: entry.session.decisions[0] as Decision,
          focused,
          jumpLabel: null,
        }}
        {...({} as never)}
      />
    </ReactFlowProvider>,
  );
  return nodeRoot(container, '[data-step-kind]');
}

describe('the amber call halo is the mockup’s, and it is built from a token', () => {
  it('defines the ring colour as a token with a value in both themes', () => {
    expect(ruleBody(CSS, ':root')).toMatch(/--vam-call-ring:/);
    expect(ruleBody(CSS, 'html.light')).toMatch(/--vam-call-ring:/);
  });

  it('carries no ad-hoc rgb() amber outside the token definitions', () => {
    // The halo used to be `rgb(255 159 10 / …)` — an orange nobody picked,
    // one channel off the design's #f59e0b and invisible to the hex guard.
    expect(CSS).not.toMatch(/rgb\(\s*255\s+159\s+10/);
  });

  it('leaves a visible ring at rest, not only mid-animation', () => {
    // The mockup's card wears a 1px amber ring the whole time and breathes a
    // halo around it. A rule that only animates leaves the card border-less
    // between pulses, which is how it lost its edge.
    const call = ruleBody(CSS, '.vam-call');
    expect(call).toMatch(/box-shadow:/);
    expect(call).toMatch(/--vam-call-ring/);
    expect(call).toMatch(/animation:\s*vam-call/);
  });

  it('builds both keyframe stops from the same token', () => {
    const frames = ruleBody(CSS, '@keyframes vam-call');
    expect(frames).toMatch(/--vam-call-ring/);
    expect(frames.match(/box-shadow:/g)?.length).toBe(2);
  });
});

describe('reduced motion keeps a static ring, inside the media block', () => {
  const reduced = ruleBody(CSS, '@media (prefers-reduced-motion: reduce)');

  it('stops the halo animation there', () => {
    expect(reduced).toMatch(/\.vam-call/);
    expect(reduced).toMatch(/animation:\s*none/);
  });

  it('replaces it with a static token-built ring, inside that same block', () => {
    // Asserted on the media block's own text, so a fallback that drifts out of
    // the block cannot pass by living somewhere else in the file.
    const staticRing = reduced.slice(reduced.indexOf('animation: none'));
    expect(staticRing).toMatch(/box-shadow:[^;]*--vam-call-ring/s);
  });
});

describe('which treatment each node wears', () => {
  it('gives a waiting session card the halo and no border', () => {
    const el = renderInfo({ status: 'waiting' }, false);
    expect(el.className).toContain('vam-call');
    expect(el.className).not.toMatch(/\bborder\b/);
  });

  it('gives a focused, non-waiting session card the focus ring, not an ink border', () => {
    const el = renderInfo({ status: 'running' }, true);
    expect(el.className).toContain('vam-focus-ring');
    expect(el.className).not.toContain('border-ink-dim');
  });

  it('leaves an unfocused, non-waiting session card the plain line border', () => {
    const el = renderInfo({ status: 'running' }, false);
    expect(el.className).toContain('border-line');
    expect(el.className).not.toContain('vam-focus-ring');
    expect(el.className).not.toContain('vam-call');
  });

  it('gives an asking step the halo and a focused step the focus ring', () => {
    expect(renderStep('waiting', false).className).toContain('vam-call');
    const focused = renderStep('running', true);
    expect(focused.className).toContain('vam-focus-ring');
    expect(focused.className).not.toContain('border-ink-dim');
  });

  it('defines the focus ring as a ring rather than a border colour', () => {
    const ring = ruleBody(CSS, '.vam-focus-ring');
    expect(ring).toMatch(/box-shadow:[^;]*var\(--color-line-loudest\)/);
  });
});
