/**
 * ASKING FOR A SHORTER ANSWER — by typing the request, never by rewriting one.
 *
 * Operator, translated: "turn this ADHD skill into a setting that can be
 * toggled on and off in vam, so the output the agent returns is easier to
 * understand and more concise", and then, asked how it should work: "is there
 * a way that, if the skill is enabled, vam uses the skill before the input is
 * sent, or when the session starts?"
 *
 * That second question settles the whole design. VAM SENDS THE INSTRUCTION; IT
 * NEVER TOUCHES WHAT IT DRAWS. vam has no model, and the Response view is a
 * projection of a transcript somebody else wrote (`sources/claude-code/
 * reply.ts` states the rule). The only honest way to make an answer shorter is
 * to ask the agent for a shorter answer. Nothing in the renderer summarises,
 * trims or re-words a turn, and this module must never become the place that
 * starts.
 *
 * The ten rules are vam's own wording of the `ayghri/i-have-adhd` skill
 * (MIT, https://github.com/ayghri/i-have-adhd), which is the operator's
 * source for them. Not a copy: a verbatim paste would drag that licence into
 * this repository for the sake of a paragraph, and the skill's own text is
 * written for a file an agent reads rather than for a line typed into a live
 * pane. The credit is here, in a comment, where a licence check can find it.
 *
 * ── WHEN THE RULES TRAVEL ─────────────────────────────────────────────────
 * WITH THE FIRST PROMPT VAM SENDS TO A GIVEN SESSION, and with no later one.
 *
 * The alternative considered was a session-start hook: type the rules when vam
 * creates the tmux session. It was rejected for two reasons and neither is
 * about effort. It covers only the sessions VAM STARTED -- a session the
 * operator started in their own tmux is replied to through the same seam and
 * would never be primed -- and it would have to decide that the agent's TUI is
 * ready to receive a keystroke, which vam cannot observe: there is no echo
 * (`deliver.ts`), so "the REPL is listening" is not a fact any code here has.
 * Riding on a real prompt needs neither. It also costs the tokens exactly
 * once, and it is VISIBLE: the rules are in the prompt, so the transcript
 * shows the operator what was asked on their behalf.
 *
 * ── THE LIMIT VAM CANNOT SEE, NAMED RATHER THAN PAPERED OVER ──────────────
 * A `/clear` or a context compaction takes the rules out of the agent's
 * context, and NOTHING TELLS VAM. There is no signal in the transcript vam
 * reads that says "this session has forgotten what it was told", so this
 * module will go on treating that session as primed and every later prompt
 * will go clean. That is a real limit, it is not fixable from here, and the
 * honest answer is to say so rather than to invent a heuristic (re-priming
 * every N prompts, or on a gap in the transcript) that would be wrong in both
 * directions -- spending tokens on sessions that remember, and missing the
 * ones that do not.
 *
 * WHAT THE OPERATOR HAS INSTEAD is the switch itself: turning it OFF forgets
 * every priming, so off-and-on-again puts the rules on the next prompt to
 * every session. That is deliberate, it is the only re-arm vam offers, and it
 * costs the tokens a second time -- which is the operator's decision to make.
 *
 * ── WHAT TURNING IT OFF DOES, AND WHAT IT CANNOT DO ───────────────────────
 * It stops vam adding the block to any future first prompt, and it forgets the
 * ledger as above. It does NOT un-say anything: an agent that has already read
 * the rules has read them, and they stay in its context for the rest of that
 * context's life. vam will not type a retraction, because a retraction is a
 * second instruction spending more tokens to ask for the thing the agent was
 * doing before anybody asked.
 *
 * ── PER RUN OF VAM, IN MEMORY ─────────────────────────────────────────────
 * The ledger is module state and dies with the process. A vam restarted
 * against a session that is still running will prime it again, once. That is
 * the cheap direction of the two: the alternative is persisting a claim about
 * somebody else's context window across restarts, and the claim would be wrong
 * every time that session had been cleared in between.
 */

/**
 * WHAT VAM TYPES, in vam's own words.
 *
 * ONE LINE. `promptKeystrokes` turns each internal newline into a literal
 * backslash plus an interpreted Enter -- two tmux spawns into a pane an agent
 * is reading -- so a rules block written as ten lines would cost twenty. The
 * blank line between this and the operator's own text (`withConciseLead`) is
 * the one break worth paying for: it is what makes the boundary legible in the
 * transcript.
 *
 * ASCII ONLY, and that is a decision rather than an accident. A vam launched
 * from the Dock inherits no `LANG`, and tmux mangles non-ASCII for a client
 * whose `LC_CTYPE` is not UTF-8 -- so the em dash and the typographic
 * apostrophes this codebase writes everywhere else would reach somebody's
 * agent as replacement characters in the middle of an instruction. `--` and
 * `'` instead.
 *
 * MEASURED, on tmux 3.7b over a private `-L` socket, because a payload this
 * long through `send-keys -l` may not be assumed to arrive whole: the exact
 * sequence `reply.ts` produces for these rules plus `\n\n` plus `ship it` was
 * typed into a pane running `cat > file`, and 647 bytes came out -- all 635
 * characters of this constant identical, then the escape backslash, then the
 * blank line's own backslash, then the prompt. Nothing was dropped, wrapped or
 * translated at 80 columns.
 *
 * IT OPENS WITH `[vam]`, for two reasons. The transcript WILL show this text:
 * it is typed into the pane, so it is part of the operator's own turn and
 * there is no way to hide it -- what it can do is say who is speaking before
 * anything else, so a reader scrolling back does not attribute it to the
 * person. And the first character may not be `/`, `!`, `#` or `@`, each of
 * which Claude Code's input reads as a command, a shell escape, a memory write
 * or a file reference rather than as text.
 *
 * THE LAST SENTENCE IS NOT OPTIONAL. Rules that cannot be dropped turn a
 * genuine ambiguity into a confident wrong answer and a destructive step into
 * an unconfirmed one; the skill this is vam's wording of says the same, and it
 * is the half that is easiest to leave out while shortening.
 */
export const CONCISE_RULES = [
  "[vam] Answer style for this session -- a vam setting, not the operator's words.",
  'Start with what can be done now, not the background.',
  'Number multi-step work, one action per step, and say where we are ("step 2 of 4").',
  'Real estimates, not "a while".',
  'Say concretely what now works, and name a cause and a fix rather than softening either.',
  'Five items per list at most, ranked.',
  'Finish the current issue before raising another.',
  'End with one next action under two minutes.',
  'No preamble, no sign-off.',
  'Drop any of this where it would cost the answer:',
  'real ambiguity, a destructive step to confirm, a debugging dead end, or a request to be taught.',
].join(' ');

/**
 * Whether the operator has the switch on, as of the last thing the renderer
 * said. `false` until told otherwise, which is what vam did before this
 * existed -- a process that never receives the message behaves exactly as it
 * always has.
 */
let on = false;

/** The session ids vam has already typed the rules to, this run. */
const primed = new Set<string>();

/**
 * Take the renderer's word for the switch.
 *
 * TOTAL, IN THE DIRECTION THAT FORGETS. The value arrives over
 * `window.api.prefs` from the least trusted process in the app, typed
 * `unknown`; anything that is not exactly `true` lands as "off" rather than as
 * an instruction vam then types into somebody's agent.
 *
 * TURNING IT OFF CLEARS THE LEDGER, turning it on does not touch it. Both
 * halves matter and the asymmetry is the point: `activatePrefs` pushes this
 * value on every prefs read AND every prefs write, so re-arming on each `true`
 * would put the rules back on the next prompt to every open session because
 * somebody nudged a font size. Clearing on `false` is what gives the operator
 * the one re-arm this module can offer (see the header, `/clear`).
 */
export function setConciseOutput(raw: unknown): void {
  const next = raw === true;
  if (!next) primed.clear();
  on = next;
}

/**
 * The prompt to actually type, and the acknowledgement to call once it landed.
 *
 * `delivered` IS A CALLBACK RATHER THAN A SIDE EFFECT OF THIS CALL, and that
 * is the whole of the design's honesty. `replyToSession` refuses any row it
 * cannot PROVE a pane for and types nothing at all; a failure part-way through
 * the keystrokes leaves the text unsent on purpose. Marking the session primed
 * at the moment the lead was BUILT would spend the rules on a prompt that
 * never arrived, and neither vam nor the operator would ever notice -- every
 * later prompt would go clean to an agent that was never told anything.
 *
 * A session vam has no channel into therefore costs nothing: the refusal
 * happens above this, the ledger is untouched, and the next prompt that DOES
 * land carries the rules.
 */
export function withConciseLead(
  sessionId: string,
  prompt: string,
): { readonly prompt: string; readonly delivered: () => void } {
  if (!on || primed.has(sessionId)) {
    return { prompt, delivered: () => {} };
  }
  return {
    prompt: `${CONCISE_RULES}\n\n${prompt}`,
    delivered: () => {
      primed.add(sessionId);
    },
  };
}

/** For tests, and for nothing else: the ledger is process-wide. */
export function forgetConcisePriming(): void {
  primed.clear();
}
