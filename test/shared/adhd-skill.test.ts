/**
 * `isAdhdSkillPartiallyInstalled`, the one predicate settings-views item E
 * added to the shared ADHD-skill vocabulary.
 *
 * Operator: "partially installed (one of ~/.claude/skills / ~/.agents/skills)
 * -> say so, label button 'Repair'." `AdhdSkillStatus.overall`'s own three
 * states (`not-installed` / `installed` / `outdated-modified`) already fold
 * "Claude has it, Codex does not" into plain `installed` -- true, and by
 * design (`adhd-skill.ts`'s own comment: "the per-agent chips carry the
 * finer-grained 'missing', which is coverage, not failure") -- but the
 * button's own label needs the sharper question `overall` alone cannot
 * answer: is EVERY agent covered, or only some.
 *
 * SCOPED TO ABSENCE, NOT TO CONTENT. An agent whose bytes differ from vam's
 * own copy (`outdated-modified`) is a content mismatch, not a missing
 * install -- `AdhdSkillCard.tsx`'s own install-label logic keeps that case
 * as "Reinstall" regardless of what this predicate says, so this file holds
 * only the predicate's own, narrower claim.
 */
import { describe, expect, it } from 'vitest';
import { isAdhdSkillPartiallyInstalled } from '../../src/shared/adhd-skill.js';

const dir = (agent: 'claude' | 'codex') =>
  agent === 'claude'
    ? '/home/op/.claude/skills/i-have-adhd'
    : '/home/op/.agents/skills/i-have-adhd';

describe('isAdhdSkillPartiallyInstalled', () => {
  it('is false when neither agent has it', () => {
    expect(
      isAdhdSkillPartiallyInstalled({
        overall: 'not-installed',
        agents: [
          { agent: 'claude', state: 'not-installed', dir: dir('claude') },
          { agent: 'codex', state: 'not-installed', dir: dir('codex') },
        ],
      }),
    ).toBe(false);
  });

  it('is false when both agents have it', () => {
    expect(
      isAdhdSkillPartiallyInstalled({
        overall: 'installed',
        agents: [
          { agent: 'claude', state: 'installed', dir: dir('claude') },
          { agent: 'codex', state: 'installed', dir: dir('codex') },
        ],
      }),
    ).toBe(false);
  });

  it('is true when Claude has it and Codex does not', () => {
    expect(
      isAdhdSkillPartiallyInstalled({
        overall: 'installed',
        agents: [
          { agent: 'claude', state: 'installed', dir: dir('claude') },
          { agent: 'codex', state: 'not-installed', dir: dir('codex') },
        ],
      }),
    ).toBe(true);
  });

  it('is true when Codex has it and Claude does not', () => {
    expect(
      isAdhdSkillPartiallyInstalled({
        overall: 'installed',
        agents: [
          { agent: 'claude', state: 'not-installed', dir: dir('claude') },
          { agent: 'codex', state: 'installed', dir: dir('codex') },
        ],
      }),
    ).toBe(true);
  });

  it('is true when one is merely outdated-modified and the other is missing entirely', () => {
    // The install ITSELF stays labelled "Reinstall" for this exact status
    // (`AdhdSkillCard.tsx`'s own priority: a content mismatch always reads
    // as "Reinstall" regardless of coverage) -- but the predicate here is
    // about ABSENCE alone, and Codex is absent, so it is still true.
    expect(
      isAdhdSkillPartiallyInstalled({
        overall: 'outdated-modified',
        agents: [
          { agent: 'claude', state: 'outdated-modified', dir: dir('claude') },
          { agent: 'codex', state: 'not-installed', dir: dir('codex') },
        ],
      }),
    ).toBe(true);
  });
});
