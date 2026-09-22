// @vitest-environment happy-dom

/**
 * Fetching what ONE subagent is doing, for the Agents pane's detail side.
 *
 * THREE THINGS THIS HAS TO KEEP APART, which is the whole reason it is a hook
 * and not a `useEffect` at the call site:
 *
 *  - nothing is picked (draw the invitation, ask nobody),
 *  - something is picked and vam is still asking (say so),
 *  - vam has an answer, which may itself be `unavailable`.
 *
 * The second and third are what a naive version collapses: an empty `turns`
 * while a request is in flight draws "this agent has done nothing", which is a
 * claim about the agent made out of vam's own latency.
 *
 * AND IT POLLS, because an agent that is running changes while you watch it.
 * A static snapshot of a live agent is exactly the staleness this pane exists
 * to end.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_WORK_POLL_MS, useAgentWork } from '../../src/renderer/sources/useAgentWork.js';
import type { AgentWork } from '../../src/shared/agent-work.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const work = (input: string): AgentWork => ({
  kind: 'work',
  turns: [{ id: 't1', label: 'a', input, output: null, commands: [] }],
  brief: null,
  whole: true,
});

/** Renders the hook and records every state it passed through. */
function harness(agentId: string | null, read: (s: string, a: string) => Promise<AgentWork>) {
  const seen: ReturnType<typeof useAgentWork>[] = [];
  function Probe({ picked }: { picked: string | null }) {
    seen.push(useAgentWork('sess-1', picked, read));
    return null;
  }
  const view = render(<Probe picked={agentId} />);
  return { seen, view, last: () => seen[seen.length - 1] };
}

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useAgentWork', () => {
  it('asks nobody at all while nothing is picked', async () => {
    const read = vi.fn(async () => work('x'));
    const { last } = harness(null, read);
    await settle();
    expect(read).not.toHaveBeenCalled();
    expect(last()?.state).toBe('idle');
  });

  it('asks about the agent that was picked, for this session', async () => {
    const read = vi.fn(async () => work('the brief'));
    harness('agent-a', read);
    await settle();
    expect(read).toHaveBeenCalledWith('sess-1', 'agent-a');
  });

  /**
   * LOADING IS ITS OWN STATE, not an empty answer. Drawing "this agent has
   * done nothing yet" out of vam's own latency is a claim about the agent that
   * vam has no evidence for.
   */
  it('says it is still asking, rather than answering emptily', async () => {
    const { last } = harness('agent-a', () => new Promise<AgentWork>(() => {}));
    expect(last()?.state).toBe('loading');
    expect(last()?.work).toBeNull();
  });

  it('carries the answer once it arrives', async () => {
    const { last } = harness('agent-a', async () => work('the brief'));
    await settle();
    expect(last()?.state).toBe('ready');
    expect(last()?.work?.kind === 'work' && last()?.work).toMatchObject({ whole: true });
  });

  /**
   * A REJECTION IS STILL AN ANSWER. The port promises this never rejects, but
   * a hook that trusted that promise would white-screen the pane the day a
   * source breaks it -- and `port.ts` cannot enforce it on an adapter written
   * later.
   */
  it('turns a rejection into the unavailable arm rather than throwing', async () => {
    const { last } = harness('agent-a', async () => {
      throw new Error('the bridge is gone');
    });
    await settle();
    expect(last()?.state).toBe('ready');
    expect(last()?.work?.kind).toBe('unavailable');
  });

  it('says so when the source has no agent surface at all', async () => {
    const seen: ReturnType<typeof useAgentWork>[] = [];
    function Probe() {
      seen.push(useAgentWork('sess-1', 'agent-a', undefined));
      return null;
    }
    render(<Probe />);
    await settle();
    expect(seen[seen.length - 1]?.state).toBe('ready');
    expect(seen[seen.length - 1]?.work?.kind).toBe('unavailable');
  });

  describe('while the pane stays open', () => {
    it('asks again on the poll, because a running agent changes as you watch', async () => {
      vi.useFakeTimers();
      const read = vi.fn(async () => work('the brief'));
      harness('agent-a', read);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AGENT_WORK_POLL_MS + 10);
      });
      expect(read.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('stops asking once the pane no longer has an agent picked', async () => {
      vi.useFakeTimers();
      const read = vi.fn(async () => work('the brief'));
      const { view } = harness('agent-a', read);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AGENT_WORK_POLL_MS + 10);
      });
      const before = read.mock.calls.length;
      view.unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(AGENT_WORK_POLL_MS * 3);
      });
      expect(read.mock.calls.length).toBe(before);
    });

    /**
     * THE ANSWER TO THE QUESTION THAT WAS ASKED LAST. Switching agents while a
     * read is in flight must never paint the previous agent's work under the
     * new agent's name -- the same rule `useSourceModel` keeps for its own
     * out-of-order loads, and the worst outcome available in a pane whose
     * whole job is saying what a particular agent is doing.
     */
    it('never paints a slow answer for an agent that is no longer picked', async () => {
      const pending = new Map<string, (w: AgentWork) => void>();
      const read = (_s: string, agentId: string) =>
        new Promise<AgentWork>((resolve) => pending.set(agentId, resolve));
      const seen: ReturnType<typeof useAgentWork>[] = [];
      function Probe({ picked }: { picked: string }) {
        seen.push(useAgentWork('sess-1', picked, read));
        return null;
      }
      const view = render(<Probe picked="agent-slow" />);
      view.rerender(<Probe picked="agent-fast" />);
      await act(async () => {
        pending.get('agent-fast')?.(work('the fast one'));
        await Promise.resolve();
      });
      await act(async () => {
        pending.get('agent-slow')?.(work('the slow one'));
        await Promise.resolve();
      });
      const last = seen[seen.length - 1];
      expect(last?.work?.kind === 'work' && last.work.turns[0]?.input).toBe('the fast one');
    });
  });

  /**
   * VISIBILITY GATING -- `hidden: 'pause'`, unlike `useSourceModel`'s own
   * `slowBy`. This pane's `agentId !== null` gate already withdraws the
   * poll once nobody has it open, and `notify/waiting.ts` never reads this
   * hook's answer (its own header names `useSourceModel` as the app's one
   * transition-detection loop) -- so a hidden window may stop this poll
   * outright with nothing lost. See this file's own header for why the
   * IMMEDIATE ask on a newly picked agent stays independent of this.
   */
  describe('visibility gating', () => {
    const visibilitySpy = () =>
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');

    const changeVisibility = async () => {
      await act(async () => {
        fireEvent(document, new Event('visibilitychange'));
      });
    };

    it('stops polling outright once the window is hidden', async () => {
      vi.useFakeTimers();
      const visibility = visibilitySpy();
      const read = vi.fn(async () => work('the brief'));
      harness('agent-a', read);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const before = read.mock.calls.length;

      visibility.mockReturnValue('hidden');
      await changeVisibility();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(AGENT_WORK_POLL_MS * 3);
      });
      expect(read.mock.calls.length).toBe(before);
      visibility.mockRestore();
    });

    it('resumes with one immediate tick the moment the window is visible again', async () => {
      vi.useFakeTimers();
      const visibility = visibilitySpy();
      const read = vi.fn(async () => work('the brief'));
      harness('agent-a', read);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      visibility.mockReturnValue('hidden');
      await changeVisibility();
      const beforeReturn = read.mock.calls.length;

      visibility.mockReturnValue('visible');
      await changeVisibility();
      expect(read.mock.calls.length).toBeGreaterThan(beforeReturn);
      visibility.mockRestore();
    });
  });
});
