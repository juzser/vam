/**
 * THE ADHD SKILL, AS DATA BOTH PROCESSES AGREE ON.
 *
 * Renderer-safe: no `electron`, no `node:` import, like `update.ts` beside it.
 * `src/main/skills/adhd-skill.ts` is where a path is actually resolved and a
 * byte actually moves; this module is the vocabulary the card and the IPC
 * envelope share so neither invents its own copy of what a state is called.
 *
 * ── WHAT THIS REPLACES ────────────────────────────────────────────────────
 * Until this feature, vam's "concise output" switch typed vam's OWN wording of
 * `ayghri/i-have-adhd`'s ten rules into the first prompt of a session
 * (`main/terminal/concise.ts`, now deleted). The operator's own words, having
 * seen that: install the REAL skill, so it works for every session --
 * including one the operator started by hand in their own terminal -- and
 * survives a `/clear`, which the old mechanism could not see past at all.
 *
 * ── PINNED, NOT FETCHED ───────────────────────────────────────────────────
 * `resources/skills/i-have-adhd/SKILL.md` and `LICENSE` are a byte-for-byte
 * copy of upstream at the commit below, bundled into vam itself
 * (`electron-builder.config.cjs`'s `files` list). Installing NEVER reaches the
 * network: it copies bytes vam already shipped. Fetching at install time would
 * make the skill's content depend on whatever ayghri/i-have-adhd happens to
 * contain the day an operator clicks a button -- a supply-chain surface this
 * repository does not need, for two files that fit in the app already.
 */
export const ADHD_SKILL_NAME = 'i-have-adhd';

/** Where the pinned copy lived, and when. See `resources/skills/i-have-adhd/NOTICE.md`. */
export const ADHD_SKILL_SOURCE_REPO = 'ayghri/i-have-adhd';
export const ADHD_SKILL_SOURCE_URL = 'https://github.com/ayghri/i-have-adhd';
export const ADHD_SKILL_PINNED_SHA = '839872f9d1cd634fed642b4589ce7226199cc15f';
export const ADHD_SKILL_LICENSE = 'MIT';

/** The exact upstream path the pinned `SKILL.md` was read from, at the pinned
 *  commit -- what "Copy install command" below reconstructs from bytes. */
export const ADHD_SKILL_UPSTREAM_PATH = 'skills/i-have-adhd/SKILL.md';

/**
 * THE TWO SURFACES VAM WRITES TO, and no others.
 *
 * `claude`: `~/.claude/skills/<name>/SKILL.md`, confirmed against Claude
 * Code's own docs (code.claude.com/docs/en/skills, "Where skills live" --
 * personal skills load in every project on this machine).
 *
 * `codex`: `~/.agents/skills/<name>/SKILL.md`, confirmed against Codex's own
 * docs (developers.openai.com/codex/skills, "Where Codex loads local skills"
 * -- the `USER` scope row). NOT `~/.codex/skills`, which does not exist in
 * that table; Codex's own per-machine config lives at `~/.codex/config.toml`
 * but its skills directory is the shared `~/.agents/skills` the open Agent
 * Skills standard uses, which is also what Zed and Cursor read without a
 * vendor prefix of their own.
 *
 * A THIRD ROW WAS CONSIDERED AND REJECTED: Codex's plugin marketplace route
 * (`codex plugin marketplace add`) installs the WHOLE upstream repository,
 * including `hooks/`, `.opencode/` and every other harness's own files --
 * more trust surface than the two files this feature actually needs, and it
 * shells out to `codex` as a child process, which the design constraints rule
 * out (main writes files itself, no shell pipeline).
 */
export const ADHD_SKILL_AGENTS = ['claude', 'codex'] as const;
export type AdhdSkillAgent = (typeof ADHD_SKILL_AGENTS)[number];

/** The directory Claude/Codex scan, relative to the operator's home directory
 *  -- a display-only, `~`-rooted string. `src/main/skills/adhd-skill.ts`
 *  resolves the real absolute path with `node:path` and `node:os`; nothing
 *  here is a path a filesystem call ever receives. */
export const ADHD_SKILL_HOME_RELATIVE_DIR: Record<AdhdSkillAgent, string> = {
  claude: '.claude/skills/i-have-adhd',
  codex: '.agents/skills/i-have-adhd',
};

export const ADHD_SKILL_AGENT_LABEL: Record<AdhdSkillAgent, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

/**
 * THE THREE STATES THE STATUS CHECK CAN FIND ANY ONE AGENT IN, comparing what
 * is on disk against the bundled bytes:
 *
 * - `not-installed`: no `SKILL.md` at the target directory.
 * - `installed`: every bundled file is present and byte-identical.
 * - `outdated-modified`: the directory exists and at least one bundled file's
 *   name is present but its content differs. ONE STATE FOR TWO CAUSES, ON
 *   PURPOSE: an operator who hand-edited vam's own copy and an operator whose
 *   `i-have-adhd` folder happens to hold something else entirely look
 *   identical from a content comparison, and both deserve the same answer --
 *   "vam will not overwrite this without being told to."
 */
export const ADHD_SKILL_STATES = ['not-installed', 'installed', 'outdated-modified'] as const;
export type AdhdSkillState = (typeof ADHD_SKILL_STATES)[number];

export type AdhdSkillAgentStatus = {
  readonly agent: AdhdSkillAgent;
  readonly state: AdhdSkillState;
  /** The absolute directory vam looked at, for the operator to read -- never
   *  a path the renderer supplied; main resolved it from the fixed table
   *  above before this value ever crossed the bridge. */
  readonly dir: string;
};

export type AdhdSkillStatus = {
  /**
   * `outdated-modified` if ANY agent is; else `installed` if ANY agent is;
   * else `not-installed`. An operator with Claude installed and no Codex CLI
   * at all still reads "installed" here -- the per-agent chips carry the
   * finer-grained "missing", which is coverage, not failure.
   */
  readonly overall: AdhdSkillState;
  readonly agents: readonly AdhdSkillAgentStatus[];
};

/** One agent's outcome from an install or remove attempt. */
export type AdhdSkillAgentOutcome =
  | { readonly agent: AdhdSkillAgent; readonly kind: 'written' }
  | { readonly agent: AdhdSkillAgent; readonly kind: 'removed' }
  | { readonly agent: AdhdSkillAgent; readonly kind: 'unchanged' }
  /** Content differs and `force` was not given -- nothing was touched. */
  | { readonly agent: AdhdSkillAgent; readonly kind: 'refused' }
  /** Remove only: at least one file did not match vam's own bytes, so it was
   *  left in place and the directory (if anything remains in it) was not
   *  removed either. */
  | { readonly agent: AdhdSkillAgent; readonly kind: 'left-foreign' }
  | { readonly agent: AdhdSkillAgent; readonly kind: 'error'; readonly message: string };

export type AdhdSkillActionResult = {
  readonly status: AdhdSkillStatus;
  readonly agents: readonly AdhdSkillAgentOutcome[];
};

/**
 * THE MANUAL ROUTE, for "prefer your own terminal?" -- one `mkdir` and two
 * `curl`s PER AGENT, chained with `&&` so a failed download never leaves a
 * half-written skill directory behind, looped over both agent directories.
 *
 * NEVER A PIPE TO A SHELL. Every design alternative considered pipes bytes
 * from the network into an interpreter: `curl | sh` runs whatever the far end
 * sends; `git clone` (also considered) checks out the WHOLE upstream
 * repository, including `.opencode/plugins/i-have-adhd.mjs` and `hooks/` --
 * files other harnesses execute, which is a materially larger trust surface
 * than the two files this feature installs. `curl -o` instead writes bytes to
 * a NAMED file and nothing reads them as code; the URL is pinned to the exact
 * commit above, so pasting it into a browser first shows the operator exactly
 * what will land, byte for byte, before they run anything.
 */
export function adhdSkillInstallCommand(): string {
  const base = `https://raw.githubusercontent.com/${ADHD_SKILL_SOURCE_REPO}/${ADHD_SKILL_PINNED_SHA}`;
  const dirs = ADHD_SKILL_AGENTS.map((agent) => `"$HOME/${ADHD_SKILL_HOME_RELATIVE_DIR[agent]}"`);
  return [
    `for d in ${dirs.join(' ')}; do`,
    `  mkdir -p "$d" &&`,
    `  curl -fsSL "${base}/${ADHD_SKILL_UPSTREAM_PATH}" -o "$d/SKILL.md" &&`,
    `  curl -fsSL "${base}/LICENSE" -o "$d/LICENSE"`,
    'done',
  ].join('\n');
}
