/**
 * CLAUDE CODE'S OWN statusLine, configured by vam for the sessions it launches
 * (not a vam-drawn overlay). Claude Code runs the configured command with a
 * JSON payload on stdin and shows its stdout under the prompt.
 *
 * FIELD NAMES were verified against the installed `claude` 2.1.284 binary: its
 * payload builder computes `total_input_tokens` as
 * `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` and
 * `total_output_tokens` as `output_tokens` of `current_usage`, beside
 * `context_window_size` and `used_percentage`. So `in`/`out` are the CURRENT
 * context and turn figures, not session-cumulative totals.
 *
 * THE SCRIPT IS GENERATED FROM `formatStatusLine` (its own source text is
 * embedded), so the pure function the tests exercise and the program Claude
 * Code runs cannot drift. For that reason `formatStatusLine` is self-contained:
 * it references nothing outside its own body.
 *
 * INJECTION. The directory in Claude Code's JSON is untrusted text. It reaches
 * `git` only as one element of an argv array (`execFileSync`, no shell), and
 * every path vam types into a shell or embeds in the settings `command` is
 * single-quote escaped by `shellQuote`.
 *
 * The install is LAZY and memoised: the first `withStatusLineSettings` call
 * asks Electron for `userData` and writes the files, so `main/index.ts` is
 * not involved. Where Electron is not there to ask (a unit test without a
 * mock), the argv comes back unchanged: a status line is never worth a launch.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import electron from 'electron';
import { resolveProvider } from '../../../shared/providers.js';

export interface StatusLineInput {
  readonly cwd?: unknown;
  readonly model?: { readonly display_name?: unknown } | null;
  readonly workspace?: { readonly project_dir?: unknown; readonly current_dir?: unknown } | null;
  readonly context_window?: {
    readonly total_input_tokens?: unknown;
    readonly total_output_tokens?: unknown;
    readonly used_percentage?: unknown;
  } | null;
}

/** SELF-CONTAINED on purpose: its source text is embedded in the script. */
export function formatStatusLine(input: StatusLineInput, branch: string | null): string {
  // C0, C1 and DEL: drops ESC and BEL, so no OSC or CSI sequence survives.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
  const clean = (v: string): string => v.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  const text = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const c = clean(v);
    return c === '' ? null : c;
  };
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const tokens = (v: unknown): string => {
    const n = num(v);
    if (n === null) return '-';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
  };
  const dir =
    text(input.workspace?.project_dir) ?? text(input.workspace?.current_dir) ?? text(input.cwd);
  const project =
    dir === null
      ? '-'
      : (dir
          .split('/')
          .filter((s) => s !== '')
          .pop() ?? '-');
  const pct = num(input.context_window?.used_percentage);
  return [
    project,
    ...(branch === null || clean(branch) === '' ? [] : [`git:(${clean(branch)})`]),
    text(input.model?.display_name) ?? '-',
    `ctx:${pct === null ? '-' : `${Math.round(pct)}%`}`,
    `in:${tokens(input.context_window?.total_input_tokens)}`,
    `out:${tokens(input.context_window?.total_output_tokens)}`,
  ].join(' ');
}

/** The Node program Claude Code runs: read stdin, ask git for the branch, print. */
export function statusLineScriptSource(): string {
  return `'use strict';
const { execFileSync } = require('node:child_process');
const format = ${formatStatusLine.toString()};
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw); } catch {}
  const w = input.workspace || {};
  const dir = [w.current_dir, w.project_dir, input.cwd].find((d) => typeof d === 'string' && d !== '');
  let branch = null;
  if (dir !== undefined) {
    try {
      branch = execFileSync('git', ['-C', dir, 'branch', '--show-current'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
      }).trim() || null;
    } catch {}
  }
  process.stdout.write(format(input, branch) + '\\n');
});
`;
}

/** POSIX single-quote escaping: safe for any path, including `'` and spaces. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Write only when the bytes differ, so a second install changes nothing. */
function writeIfChanged(path: string, content: string): void {
  try {
    if (readFileSync(path, 'utf8') === content) return;
  } catch {}
  writeFileSync(path, content);
}

/** Idempotently write the script and the settings file; returns the settings path. */
export function installStatusLine(userDataDir: string): string {
  mkdirSync(userDataDir, { recursive: true });
  const script = join(userDataDir, 'statusline.cjs');
  const settings = join(userDataDir, 'statusline-settings.json');
  writeIfChanged(script, statusLineScriptSource());
  writeIfChanged(
    settings,
    JSON.stringify({
      statusLine: {
        type: 'command',
        command: `ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} ${shellQuote(script)}`,
        padding: 0,
      },
    }),
  );
  return settings;
}

const installed = new Map<string, string>();

function userDataDirOrNull(): string | null {
  try {
    return electron.app.getPath('userData');
  } catch {
    return null;
  }
}

/**
 * `argv` plus `--settings <path>` (the path shell-quoted, because the result
 * is joined and typed into a shell). Unchanged when there is no userData.
 */
export function withStatusLineSettings(
  argv: readonly string[],
  userDataDir: string | null = userDataDirOrNull(),
): readonly string[] {
  if (userDataDir === null) return argv;
  let settings = installed.get(userDataDir);
  if (settings === undefined) {
    try {
      settings = installStatusLine(userDataDir);
    } catch {
      return argv;
    }
    installed.set(userDataDir, settings);
  }
  return [...argv, '--settings', shellQuote(settings)];
}

/**
 * Start-session text. Only a LAUNCH LINE is rewritten: one line, no shell
 * control or substitution characters, the claude-code command first, and
 * every later token a flag or the value of the flag right before it. A prompt
 * ('claude fix the bug') or a compound line ('claude && x') is returned as is.
 * The settings pair goes directly after `claude`.
 */
export function startTextWithStatusLine(text: string): string {
  if (/[;&|<>`\r\n\u2028\u2029]|\$\(/.test(text.trim())) return text;
  const [first, ...rest] = text.trim().split(/\s+/);
  if (first === undefined || first !== resolveProvider('claude-code').command[0]) return text;
  let afterFlag = false;
  for (const token of rest) {
    if (token.startsWith('-')) afterFlag = !token.includes('=');
    else if (afterFlag) afterFlag = false;
    else return text;
  }
  return [...withStatusLineSettings([first]), ...rest].join(' ');
}
