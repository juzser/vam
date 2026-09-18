// @vitest-environment happy-dom

/**
 * THE SEAM, END TO END: does the demo's agent-work reader actually reach a
 * pane?
 *
 * `App.history.test.tsx` proves the identical seam for `source.history` and
 * explains why it has to be an integration test rather than two units either
 * side of it: a context is exactly the kind of wiring that can be dropped in
 * silence. Nothing stops compiling when `AgentWorkReaderProvider` is deleted
 * from `DemoCanvas` -- the consumer simply reads the context's own default,
 * `null`, and the Agents pane draws "this source cannot report what a
 * session's agents are doing", the sentence reserved for a source with no
 * agent surface at all. `test/fixtures/demo-agent-work.test.ts` pins the
 * FIXTURE's answers; it cannot see this, because it calls `demoAgentWork`
 * directly and never touches `DemoCanvas` or the provider at all. This test
 * mounts the one component that owns the wiring.
 *
 * The canvas is mocked down to the one thing being asked about, the same way
 * `App.history.test.tsx` does: what a pane below `DemoCanvas` can reach, and
 * what calling it actually returns -- not merely that a function is present
 * (a reader wired to the wrong source, or a stub, would also read as
 * "present"), but that the answer is real fabricated WORK, in the exact
 * session and agent id the demo's own roster names.
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentWork } from '../../src/shared/agent-work.js';

vi.mock('../../src/renderer/canvas/Canvas.js', () => ({
  // Stands in for `DetailPanel`'s own use of the context: reach for the
  // reader, and if there is one, actually call it with the demo's own
  // session and agent id -- a provider that publishes a function nobody can
  // call, or one that answers for the wrong source, would fail an operator
  // the same way a missing one does.
  Canvas: () => {
    const read = useAgentWorkReader();
    const [work, setWork] = useState<AgentWork | null>(null);
    useEffect(() => {
      if (read === null) return;
      let live = true;
      void read('factory-sse-1', 'agent-coder').then((answer) => {
        if (live) setWork(answer);
      });
      return () => {
        live = false;
      };
    }, [read]);
    return (
      <div
        data-test-canvas
        data-has-reader={read === null ? 'no' : 'yes'}
        data-answer-kind={work?.kind ?? ''}
        data-answer-input={work?.kind === 'work' ? (work.turns[0]?.input ?? '') : ''}
        data-answer-message={work?.kind === 'unavailable' ? work.error.message : ''}
      />
    );
  },
}));

const { useAgentWorkReader } = await import('../../src/renderer/sources/agent-work-reader.js');
const { DemoCanvas } = await import('../../src/renderer/App.js');

afterEach(cleanup);

const canvas = () => document.querySelector('[data-test-canvas]');

describe('the demo canvas publishes an agent-work reader', () => {
  it('a pane below it reaches source.agentWork, and gets real fabricated work back — not the no-surface refusal', async () => {
    render(<DemoCanvas />);
    await waitFor(() => expect(canvas()?.getAttribute('data-has-reader')).toBe('yes'));
    await waitFor(() => expect(canvas()?.getAttribute('data-answer-kind')).toBe('work'));
    // Not a tautology: this is the fixture's actual sentence for
    // `agent-coder`, so a reader wired to a stub, or to the wrong session,
    // would fail this the same way a missing provider does.
    expect(canvas()?.getAttribute('data-answer-input')).toContain('stream route');
    // And never the sentence a source with NO agent surface gives — the
    // exact defect this whole feature exists to fix.
    expect(canvas()?.getAttribute('data-answer-message')).not.toMatch(/cannot report/i);
  });
});
