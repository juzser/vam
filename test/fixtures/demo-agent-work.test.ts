/**
 * The demo's own `agentWork` answer, and what it is for.
 *
 * `?demo=1` is the only session vam may drive from a guard or put in a
 * screenshot, and its Agents tab lists `agent-coder`, `agent-tester` and
 * `agent-reviewer` as running (`fixtures/demo.ts`). Before this file existed
 * `App.tsx`'s `DemoCanvas` published no agent reader at all, so picking any of
 * them drew "this source cannot report what a session's agents are doing" —
 * the sentence reserved for a source with NO agent surface, which is false of
 * the demo. This file pins that picking a real agent now answers with real
 * (fabricated) work, in the exact `AgentWork` shape the real source returns,
 * and that the `unavailable` arm stays reachable through `agent-scribe`.
 */

import { describe, expect, it } from 'vitest';
import { demoAgentWork } from '../../src/renderer/fixtures/demo-agent-work.js';

describe('the demo agent-work reader', () => {
  it('answers work, not a refusal, for every agent the demo roster marks running', async () => {
    for (const agentId of ['agent-coder', 'agent-tester', 'agent-reviewer']) {
      const work = await demoAgentWork('factory-sse-1', agentId);
      expect(work.kind).toBe('work');
    }
  });

  it('the work it answers actually has turns to draw', async () => {
    const work = await demoAgentWork('factory-sse-1', 'agent-coder');
    expect(work.kind === 'work' && work.turns.length > 0).toBe(true);
  });

  it('is honest about the middle it did not read, like the real source', async () => {
    // `agent-tester`'s transcript is fabricated long enough that only the two
    // ends were read: `whole: false` and a real `brief`, the ordinary case
    // `agent-work.ts` measures at 94 of every 100 real transcripts.
    const work = await demoAgentWork('factory-sse-1', 'agent-tester');
    expect(work.kind).toBe('work');
    if (work.kind !== 'work') return;
    expect(work.whole).toBe(false);
    expect(work.brief).not.toBeNull();
  });

  it('keeps the unavailable arm reachable, through the one agent with nothing to report', async () => {
    const work = await demoAgentWork('factory-sse-1', 'agent-scribe');
    expect(work.kind).toBe('unavailable');
    if (work.kind !== 'unavailable') return;
    // The real source's own words for a transcript that exists and says
    // nothing (`agent-work.ts`) — reused rather than invented, so this is the
    // same sentence the shipped app would give for the same state.
    expect(work.error.code).toBe('agent:empty');
  });

  it('refuses honestly for a session the demo has no roster for', async () => {
    const work = await demoAgentWork('crosscheck-2', 'agent-coder');
    expect(work.kind).toBe('unavailable');
    if (work.kind !== 'unavailable') return;
    expect(work.error.message.length).toBeGreaterThan(10);
  });

  it('refuses honestly for an agent id it has no work fabricated for', async () => {
    const work = await demoAgentWork('factory-sse-1', 'agent-does-not-exist');
    expect(work.kind).toBe('unavailable');
  });

  it('never rejects', async () => {
    await expect(demoAgentWork('factory-sse-1', 'agent-coder')).resolves.toBeDefined();
    await expect(demoAgentWork('nope', 'nope')).resolves.toBeDefined();
  });
});
