/**
 * Claude Code's own statusLine, configured by vam for the sessions it launches.
 *
 * FIELD NAMES VERIFIED against the installed `claude` 2.1.284 binary
 * (`grep -a` of `~/.local/share/claude/versions/2.1.284`): its statusLine
 * payload builder reads `total_input_tokens:e?e.input_tokens+
 * e.cache_creation_input_tokens+e.cache_read_input_tokens:0,
 * total_output_tokens:e?.output_tokens??0,context_window_size,current_usage,
 * used_percentage`. The fixture below is that shape, invented values.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ dir: '' }));
vi.mock('electron', () => ({
  default: { app: { getPath: () => holder.dir } },
}));
vi.mock('../../src/main/sources/tmux/spawn.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/main/sources/tmux/spawn.js')>();
  return {
    ...real,
    createTmuxRunner: () => async (argv: readonly string[]) => {
      typed.push(argv);
      const listing = 'claude-code:atlas-11111111\t4242\tvam-atlas-aa11bb\tzsh\n';
      return { failure: null, stdout: argv[0] === 'list-sessions' ? listing : '', stderr: '' };
    },
  };
});

import { CLAUDE_CODE_SOURCE } from '../../src/main/sources/claude-code/source.js';
import {
  formatStatusLine,
  installStatusLine,
  withStatusLineSettings,
} from '../../src/main/sources/claude-code/statusline.js';

const typed: (readonly string[])[] = [];

const FIXTURE =
  '{"session_id":"s1","cwd":"/x/vam","model":{"id":"claude-opus-4-1","display_name":"Opus 4.1"},"workspace":{"current_dir":"/x/vam","project_dir":"/x/vam","added_dirs":[]},"context_window":{"total_input_tokens":45210,"total_output_tokens":1234,"context_window_size":200000,"current_usage":{"input_tokens":10,"output_tokens":1234,"cache_creation_input_tokens":200,"cache_read_input_tokens":45000},"used_percentage":22.6,"remaining_percentage":77.4}}';
const input = JSON.parse(FIXTURE);

const tmp = (name = 'vam-sl-') => mkdtempSync(join(tmpdir(), name));

describe('formatStatusLine', () => {
  it('renders project, branch, model, context percentage and compact tokens', () => {
    expect(formatStatusLine(input, 'main')).toBe(
      'vam git:(main) Opus 4.1 ctx:23% in:45.2k out:1.2k',
    );
  });

  it('renders "-" for every figure a missing context_window would have carried', () => {
    const { context_window: _dropped, ...rest } = input;
    expect(formatStatusLine(rest, 'main')).toBe('vam git:(main) Opus 4.1 ctx:- in:- out:-');
    const nullPct = {
      ...input,
      context_window: { ...input.context_window, used_percentage: null },
    };
    expect(formatStatusLine(nullPct, 'main')).toContain('ctx:- ');
  });

  it('omits the git segment when there is no branch', () => {
    expect(formatStatusLine(input, null)).toBe('vam Opus 4.1 ctx:23% in:45.2k out:1.2k');
  });

  it('falls back from project_dir to current_dir to cwd', () => {
    expect(formatStatusLine({ cwd: '/a/c' }, null)).toMatch(/^c /);
    expect(formatStatusLine({ cwd: '/a/c', workspace: { current_dir: '/a/d' } }, null)).toMatch(
      /^d /,
    );
  });
});

describe('formatStatusLine edge cases', () => {
  const line = (cw: object) => formatStatusLine({ cwd: '/a/p', context_window: cw }, null);

  it('compacts tokens: plain under 1k, k under 1M, M above', () => {
    expect(line({ total_input_tokens: 999, total_output_tokens: 0 })).toContain('in:999 out:0');
    expect(line({ total_input_tokens: 12300, total_output_tokens: 1000000 })).toContain(
      'in:12.3k out:1.0M',
    );
  });

  it('renders "-" for non-numeric figures and a missing model or dir', () => {
    expect(line({ total_input_tokens: 'x', total_output_tokens: null })).toContain('in:- out:-');
    expect(formatStatusLine({}, null)).toBe('- - ctx:- in:- out:-');
  });

  it('omits the segment for an empty branch string', () => {
    expect(formatStatusLine({ cwd: '/a/p' }, '')).not.toContain('git:(');
  });
});

describe('script branch resolution', () => {
  const runScript = (payload: object): string => {
    const settings = JSON.parse(readFileSync(installStatusLine(tmp()), 'utf8'));
    return execFileSync('sh', ['-c', settings.statusLine.command], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
    }).trim();
  };

  it('prints the checked-out branch of a real git repo', () => {
    const repo = tmp('vam-repo-');
    execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'feat-x']);
    expect(runScript({ workspace: { current_dir: repo } })).toMatch(/ git:\(feat-x\) /);
  });

  it('never runs a shell metacharacter directory, and omits git outside a repo', () => {
    const marker = join(tmp(), 'pwned');
    const evil = `${tmp('vam-evil-')}/$(touch ${marker});\`touch ${marker}\``;
    expect(runScript({ cwd: evil })).not.toContain('git:(');
    expect(existsSync(marker)).toBe(false);
  });

  it('survives garbage on stdin', () => {
    const settings = JSON.parse(readFileSync(installStatusLine(tmp()), 'utf8'));
    const out = execFileSync('sh', ['-c', settings.statusLine.command], {
      input: 'not json',
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('- - ctx:- in:- out:-');
  });
});

describe('installStatusLine', () => {
  it('is idempotent: one script, one settings file, identical bytes', () => {
    const dir = tmp();
    const first = installStatusLine(dir);
    const before = readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
    expect(installStatusLine(dir)).toBe(first);
    const after = readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
    expect(after).toEqual(before);
    expect(after).toHaveLength(2);
  });

  it('installs a script that prints the same line as a child process', () => {
    const dir = tmp();
    const settings = JSON.parse(readFileSync(installStatusLine(dir), 'utf8'));
    const out = execFileSync('sh', ['-c', settings.statusLine.command], {
      input: FIXTURE.replace(/\/x\/vam/g, dir),
      encoding: 'utf8',
    });
    expect(out.trim()).toMatch(/^vam-sl-\S+ Opus 4\.1 ctx:23% in:45\.2k out:1\.2k$/);
  });
});

describe('quoting through a real shell', () => {
  it('survives a userData dir with a space and a single quote', () => {
    const dir = join(tmp(), 'Application Support', "it's vam");
    mkdirSync(dir, { recursive: true });
    const text = withStatusLineSettings(['claude', '--flag'], dir).join(' ');
    const lines = execFileSync('sh', ['-c', `printf "%s\\n" ${text}`], { encoding: 'utf8' })
      .trimEnd()
      .split('\n');
    const settingsPath = installStatusLine(dir);
    expect(lines.slice(-2)).toEqual(['--settings', settingsPath]);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const git = execFileSync('sh', ['-c', settings.statusLine.command], {
      input: FIXTURE,
      encoding: 'utf8',
    });
    expect(git.trim()).toMatch(/^vam /);
  });
});

describe('recordPrompt on a pane row', () => {
  const typedText = () => typed.find((a) => a.includes('-l'))?.at(-1);
  const run = async (text: string) => {
    typed.length = 0;
    holder.dir = tmp();
    await CLAUDE_CODE_SOURCE.recordPrompt?.('pane:vam-atlas-aa11bb', text);
    return typedText();
  };

  it('appends --settings to a claude start command', async () => {
    const text = await run('claude --dangerously-skip-permissions');
    expect(text).toBe(
      `claude --dangerously-skip-permissions --settings '${holder.dir}/statusline-settings.json'`,
    );
  });

  it('leaves codex and other text untouched', async () => {
    expect(await run('codex')).toBe('codex');
    expect(await run('claudex --x')).toBe('claudex --x');
    expect(await run('ls')).toBe('ls');
  });
});
