/**
 * Pulling the commands out of one Claude Code answer, so `yy` has something to
 * copy.
 *
 * The rule is a convention, not a guess: a line the agent opens with `!` and a
 * space is a command it is asking the operator to run. Nothing else is one.
 *
 * That distinction is the whole point. An earlier version inferred which lines
 * *looked* runnable -- head-token shape, argument count, column alignment, sha
 * detection -- and measured 100% precision on a 320-line corpus. It was still
 * inference, and this strip sits directly above the prompt box: a line offered
 * there is a line the operator may run without reading it twice. An explicit
 * marker moves the decision to the only party that knows the answer. The agent
 * says "run this"; vam does not decide what looked like it.
 *
 * Two findings of that older measurement still justify code here, so they
 * survive:
 *
 * - 74 of 80 fenced blocks in the corpus carry NO language tag. A rule keyed
 *   on a ```bash tag would extract nothing from real data, so untagged blocks
 *   are read too, and only a non-shell tag excludes a block.
 * - A real request was a ten-line `osascript -e 'tell application "Terminal"
 *   ... end tell'`, useful only as ONE copyable unit. Hence the bounded
 *   quote-joining below.
 *
 * Scope: marked lines are taken from fenced blocks only. Measured across every
 * transcript on the operator's machine, both real `!` lines were inside
 * fences and none appeared outside one, so accepting prose lines would widen
 * the rule for no observed gain -- and prose is where a rhetorical `! ` is
 * likeliest to be something other than a request. The fence is also the
 * agent's own signal that the text is verbatim rather than discussed.
 *
 * Pure: a string in, data out. The type-only import of the renderer's model is
 * required -- main may name the renderer's types, never load its code.
 */

import type { Command } from '../../../renderer/domain/model.js';

/** The strip is a keyboard target, not a listing; more would not be readable. */
const MAX_COMMANDS = 6;

/** A row header and a `copied: ...` line; longer is not readable in either. */
const MAX_LABEL = 32;

/**
 * How many lines one unbalanced quote may join.
 *
 * Not hypothetical: unbounded, a single stray apostrophe swallowed every
 * following line of a block and silently dropped the real commands under it.
 */
const MAX_JOIN_LINES = 20;

const FENCE = /```([A-Za-z0-9_+#.-]*)[ \t]*\n([\s\S]*?)```/g;
const SHELL_TAG = /^(bash|sh|shell|zsh|console|shellsession)$/i;
/** The agent's request marker: `!`, whitespace, then something to run. */
const MARKER = /^!\s+(?=\S)/;

/** Where the scan stands with respect to quoting, character by character. */
type Quote = null | "'" | '"';

function nextQuote(state: Quote, char: string): Quote {
  if (state === null) return char === "'" || char === '"' ? char : null;
  return char === state ? null : state;
}

/** Whether every quote a line opens, it also closes. */
function balanced(text: string): boolean {
  let quote: Quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (char === '\\') {
      i += 1;
      continue;
    }
    quote = nextQuote(quote, char);
  }
  return quote === null;
}

/**
 * Cut a trailing shell comment: a `#` outside quotes and preceded by
 * whitespace. Both halves matter -- the first keeps a `#` inside `'...'`, the
 * second keeps the fragment in `http://x#y`.
 */
function stripComment(text: string): string {
  let quote: Quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (quote === null && char === '#' && i > 0 && /\s/.test(text[i - 1] as string)) {
      return text.slice(0, i).trimEnd();
    }
    quote = nextQuote(quote, char);
  }
  return text;
}

/**
 * The lines of a block, with a line whose quotes are unbalanced joined to the
 * ones after it. Required for the `osascript` request described above.
 *
 * An accumulation that never balances -- or that runs past `MAX_JOIN_LINES` --
 * is given back line by line rather than dropped, because the far likelier
 * cause is an apostrophe in prose, not a twenty-line command.
 */
function logicalLines(body: string): string[] {
  const out: string[] = [];
  let pending: string[] = [];

  const flushIndividually = () => {
    out.push(...pending);
    pending = [];
  };

  for (const raw of body.split('\n')) {
    pending.push(raw);
    const joined = pending.join('\n');
    if (balanced(joined)) {
      out.push(joined);
      pending = [];
    } else if (pending.length >= MAX_JOIN_LINES) {
      flushIndividually();
    }
  }
  flushIndividually();
  return out;
}

/**
 * The runnable text of a marked logical line, or `null` if it carries no
 * marker. The marker is an instruction to vam, not part of the command, so it
 * and its whitespace are cut: the operator copies `gh pr merge 51`, not
 * `! gh pr merge 51`.
 *
 * The whitespace is required. `!pnpm` glued to its text is shell history
 * expansion or a negation, never a request written for a human to read.
 */
function toCommand(line: string): string | null {
  const stripped = stripComment(line.trim());
  if (!MARKER.test(stripped)) return null;
  return stripped.replace(MARKER, '');
}

/**
 * The short name of a row: `gh pr merge 332 --squash` -> `gh pr`;
 * `./build.sh --check` -> `./build.sh`; `open "/tmp/x/a b"` -> `open`.
 *
 * A second word is adopted only when it reads as a subcommand. A quote counts
 * as an argument opener alongside `-`, `/`, `~` and `.`: a quoted path is
 * split on its inner spaces, so without that test `open "/tmp/...` was adopted
 * whole and produced a label over 100 characters.
 *
 * The cap is the other half, and it is the half that holds. The exclusion list
 * is a guess about which token shapes are arguments, and the next unanticipated
 * shape would run away again; a length bound cannot. `Canvas.tsx` renders this
 * as `copied: {label}` the moment `yy` fires, which is exactly when the
 * operator needs a name they can read -- and the full command is drawn under
 * it in the strip either way, so the cut costs nothing.
 */
function labelOf(command: string): string {
  const [head, next] = command.split(/\s+/);
  if (head === undefined) return command;
  const label = next === undefined || /^[-/~."']/.test(next) ? head : `${head} ${next}`;
  return label.length <= MAX_LABEL ? label : `${label.slice(0, MAX_LABEL - 1)}…`;
}

export function extractCommands(text: string, idPrefix: string): readonly Command[] {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(FENCE)) {
    const tag = match[1] ?? '';
    if (tag !== '' && !SHELL_TAG.test(tag)) continue;
    for (const line of logicalLines(match[2] ?? '')) {
      const command = toCommand(line);
      if (command === null || seen.has(command)) continue;
      seen.add(command);
      found.push(command);
      if (found.length >= MAX_COMMANDS) break;
    }
    if (found.length >= MAX_COMMANDS) break;
  }

  return found.map((command, index) => ({
    id: `${idPrefix}:cmd:${index}`,
    label: labelOf(command),
    command,
  }));
}
