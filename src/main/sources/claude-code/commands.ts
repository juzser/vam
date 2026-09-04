/**
 * Pulling the commands out of one Claude Code answer, so `yy` has something to
 * copy.
 *
 * Claude Code hands commands back as prose inside an answer, never as
 * structured data, so this module has to guess -- and the only acceptable
 * guess is one that never puts words in the agent's mouth. The rule below was
 * developed against a corpus of 58 real transcripts (872 assistant messages,
 * 80 fenced blocks) and tuned until it accepted 40 of 320 logical lines with
 * no false positive. Every clause kills a specific thing that corpus contained.
 *
 * The load-bearing measurement: 74 of those 80 fences carry NO language tag.
 * A rule keyed on a ```bash tag would extract nothing from real data, so
 * untagged blocks must be read -- and untagged blocks are heterogeneous. They
 * held box-drawing diagrams, numbered prose in Vietnamese, git-log output and
 * aligned results tables alongside genuine commands. Hence the rejections.
 *
 * Pure: a string in, data out. The type-only import of the renderer's model is
 * required -- main may name the renderer's types, never load its code.
 */

import type { Command } from '../../../renderer/domain/model.js';

/** The strip is a keyboard target, not a listing; more would not be readable. */
const MAX_COMMANDS = 6;

/** Past this, it is a pasted document rather than something to run. */
const MAX_LENGTH = 400;

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
const PRINTABLE = /^[\x20-\x7e\n]*$/;
const HEAD = /^(\.{0,2}\/)?[A-Za-z_][A-Za-z0-9_.-]*$/;
/** A git-log line opens with an abbreviated sha, e.g. `f97b84b feat(ui): ...`. */
const SHA = /^[0-9a-f]{7,40}$/;

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
 * ones after it. Required: one real command was a ten-line `osascript -e
 * 'tell application "Terminal" ... end tell'` that is only useful as ONE
 * copyable unit.
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

/** The runnable text of a logical line, or `null` if it is not one. */
function toCommand(line: string): string | null {
  const stripped = stripComment(line.trim());
  // A prompt marker is a transcript artefact, not part of what to run. `#` is
  // deliberately NOT one of them -- see the leading-`#` rejection below.
  const text = /^[!$] /.test(stripped) ? stripped.slice(2).trim() : stripped;

  if (text === '') return null;
  // Box-drawing rules, emoji and Vietnamese prose all die here -- and they can
  // only die here once the comment is gone, since a comment may hold any of it.
  if (!PRINTABLE.test(text)) return null;
  if (text.length > MAX_LENGTH) return null;
  if (text.startsWith('//')) return null;
  // A whole-line comment, and the reason `#` is not a prompt marker. Comment
  // cutting cannot reach this one: it needs whitespace before the `#`, so a
  // comment that starts the line survives it and would read as a command.
  // Treating `#` as a root prompt would recover `# apt install curl`, which is
  // rare in agent output, at the cost of offering `# a note about the next
  // line` -- which is everywhere inside a bash block -- to the operator as
  // something to run. That is the worst failure this feature has, so the rule
  // is precision-first: every leading `#` is a comment, spaced or not.
  if (text.startsWith('#')) return null;

  const tokens = text.split(/\s+/);
  const head = tokens[0] as string;
  if (!HEAD.test(head)) return null;
  // An uppercase head is the first word of a sentence, not a program.
  if (head !== head.toLowerCase()) return null;
  if (SHA.test(head)) return null;
  // A single bare word is a filename or a heading; a command has an argument.
  if (tokens.length < 2) return null;
  if (/[:{;]$/.test(text)) return null;
  // Aligned columns are a results table: `yarn lint       clean  5.72s`.
  if (/ {2,}/.test(text)) return null;

  return text;
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
