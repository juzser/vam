/**
 * THE CONCISE-OUTPUT LEDGER, on its own — who gets the rules and who does not.
 *
 * The behaviour that matters is one file over
 * (`test/sources/claude-code-reply-concise.test.ts`): what tmux is actually
 * handed, on the first prompt and on the second. This file holds the decisions
 * that behaviour is made of, including the two nobody could see from the argv
 * — that a prompt vam FAILED to deliver does not burn the priming, and that
 * turning the switch off is the operator's only way to re-arm a session whose
 * agent has forgotten (`/clear`, a compaction).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONCISE_RULES,
  forgetConcisePriming,
  setConciseOutput,
  withConciseLead,
} from '../../../src/main/terminal/concise.js';

const A = 'aaaaaaaa-1111-2222-3333-444444444444';
const B = 'bbbbbbbb-5555-6666-7777-888888888888';

beforeEach(() => {
  // Module state is process-wide, which is what it is a projection of. Every
  // test starts from "off, nothing primed" -- the state a vam that has never
  // been told anything is in.
  setConciseOutput(false);
  forgetConcisePriming();
});

describe('the rules vam types', () => {
  it('is one line, so a prompt gains one newline escape and not several', () => {
    // `promptKeystrokes` turns every internal newline into a literal backslash
    // plus an interpreted Enter, and each of those is a separate tmux spawn
    // into a pane somebody's agent is reading. A rules block written as eight
    // lines would cost eight.
    expect(CONCISE_RULES).not.toContain('\n');
  });

  it('is ASCII, because the pane it is typed into may have no UTF-8 locale', () => {
    // MEASURED ELSEWHERE, INHERITED HERE: a vam launched from the Dock has no
    // LANG at all, and tmux mangles non-ASCII for a client whose LC_CTYPE is
    // not UTF-8. A typographic dash in this string would reach somebody's
    // agent as a replacement character in the middle of an instruction.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the point is the range, and the low end of it is where a control character would be
    expect(CONCISE_RULES).toMatch(/^[\x20-\x7e]+$/);
  });

  it('reads as an instruction from vam rather than as the operator', () => {
    // The transcript will SHOW this text: it is typed into the pane, so it is
    // part of the operator's own turn and cannot be hidden. What it can do is
    // say who is speaking, in its first characters, before anything else.
    expect(CONCISE_RULES.startsWith('[vam]')).toBe(true);
    expect(CONCISE_RULES).toMatch(/not the operator's words/i);
  });

  it('cannot be read by the REPL as a command', () => {
    // Claude Code's own input treats a leading `/`, `!`, `#` and `@` as a
    // slash command, a shell escape, a memory write and a file reference. A
    // rules block that opened with one of them would be an instruction the
    // agent never saw and an action nobody asked for.
    expect('/!#@'.includes(CONCISE_RULES[0] ?? '')).toBe(false);
  });

  it('says what to do, when to say where we are, and when to ignore it', () => {
    // The properties rather than the sentence: an exact-string check breaks on
    // a typo fix and passes a rewrite that dropped half the rules.
    expect(CONCISE_RULES).toMatch(/step 2 of 4/i);
    expect(CONCISE_RULES).toMatch(/two minutes/i);
    expect(CONCISE_RULES).toMatch(/no preamble/i);
    // THE ESCAPE HATCH IS NOT OPTIONAL. Rules that cannot be dropped turn a
    // genuine ambiguity into a confident wrong answer and a destructive step
    // into an unconfirmed one.
    expect(CONCISE_RULES).toMatch(/ambiguity/i);
    expect(CONCISE_RULES).toMatch(/destructive/i);
  });
});

describe('while the switch is off', () => {
  it('hands back the prompt it was given, unchanged', () => {
    const lead = withConciseLead(A, 'ship it');
    expect(lead.prompt).toBe('ship it');
  });

  it('stays off for anything that is not exactly true', () => {
    // The value arrives from the renderer, which is the least trusted process
    // in the app, over a bridge that carries `unknown`. Total in the direction
    // that forgets: anything unexpected is "off", never "on".
    for (const raw of ['true', 1, {}, null, undefined, [], 'on']) {
      setConciseOutput(raw);
      expect(withConciseLead(A, 'ship it').prompt, JSON.stringify(raw)).toBe('ship it');
    }
  });
});

describe('while the switch is on', () => {
  beforeEach(() => setConciseOutput(true));

  it('leads the first prompt to a session with the rules, and a blank line', () => {
    const lead = withConciseLead(A, 'ship it');
    expect(lead.prompt).toBe(`${CONCISE_RULES}\n\nship it`);
  });

  it('sends the second prompt to that session clean — once delivered', () => {
    withConciseLead(A, 'ship it').delivered();
    expect(withConciseLead(A, 'and again').prompt).toBe('and again');
  });

  it('primes each session separately', () => {
    withConciseLead(A, 'ship it').delivered();
    expect(withConciseLead(B, 'ship it').prompt).toBe(`${CONCISE_RULES}\n\nship it`);
  });

  it('does not spend the priming on a prompt that was never delivered', () => {
    // THE WHOLE REASON `delivered` IS A CALLBACK RATHER THAN A SIDE EFFECT.
    // `replyToSession` refuses a row it cannot prove a pane for, and types
    // nothing at all. Marking the session primed at the moment the lead was
    // BUILT would leave that session with the rules spent and never sent --
    // and the operator with no way to notice.
    withConciseLead(A, 'ship it');
    expect(withConciseLead(A, 'ship it').prompt).toBe(`${CONCISE_RULES}\n\nship it`);
  });

  it('keeps every session primed while the switch is switched on again', () => {
    // `activatePrefs` pushes this value on EVERY prefs read and write, not
    // only when the row is clicked. A re-arm on each of those would put the
    // rules back on the next prompt to every open session because somebody
    // changed the theme.
    withConciseLead(A, 'ship it').delivered();
    setConciseOutput(true);
    expect(withConciseLead(A, 'and again').prompt).toBe('and again');
  });
});

describe('turning the switch off', () => {
  it('un-says nothing, and re-arms every session', () => {
    // WHAT IT DOES NOT DO: take back an instruction an agent already read.
    // There is no such message, and vam would be lying if it drew one.
    //
    // WHAT IT DOES DO is the only remedy vam can offer for the limit it cannot
    // see: after a `/clear` or a context compaction the agent has forgotten
    // the rules and nothing tells vam so. Off-and-on-again puts them on the
    // next prompt to every session, at the cost of the tokens a second time --
    // which is the operator's decision to make, and is why it is spelled here
    // rather than hidden behind a timer.
    setConciseOutput(true);
    withConciseLead(A, 'ship it').delivered();
    setConciseOutput(false);
    expect(withConciseLead(A, 'and again').prompt).toBe('and again');
    setConciseOutput(true);
    expect(withConciseLead(A, 'once more').prompt).toBe(`${CONCISE_RULES}\n\nonce more`);
  });
});
