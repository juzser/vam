/**
 * ONE FLAG: does a session tab draw the title vam already derives from the
 * agent's own activity, or a neutral, content-free one instead.
 *
 * THE EXISTING LOGIC THIS GATES, found rather than invented: Claude Code
 * sessions already title themselves from `read.facts.aiTitle` -- an
 * `ai-title` event Claude Code itself writes into the transcript
 * (`main/sources/claude-code/transcript.ts`), falling back to the session id
 * -- and Codex sessions already title themselves from the first non-blank
 * line of the thread's own `preview` (`main/sources/codex/source.ts`'s
 * `titleOf`), falling back to the thread id's first eight characters. Both
 * of these run UNCONDITIONALLY today, in main, before this preference
 * existed. Main has no `prefs` to read (it is `localStorage`, per-renderer),
 * so this flag does not reach into either reader; it is applied once, in the
 * renderer, at the same seam `applyRenames` already owns
 * (`prefs.ts`'s `applyAutoTabTitles`, run BEFORE `applyRenames` so a manual
 * rename still wins over either the derived title or this flag's neutral
 * one).
 *
 * ON BY DEFAULT: both derivations above already ship unconditionally, so
 * shipping this switch ON is the only choice that changes nobody's tabs who
 * never opens Settings. OFF replaces an UN-renamed session's title with its
 * own id -- content-free, never read from the agent's activity or its first
 * prompt -- which is the plain, minimal reading of "do not auto-title from
 * activity" without inventing a second title scheme.
 */

export const DEFAULT_AUTO_TAB_TITLES = true;

export function readAutoTabTitles(raw: unknown): boolean {
  return typeof raw === 'boolean' ? raw : DEFAULT_AUTO_TAB_TITLES;
}
