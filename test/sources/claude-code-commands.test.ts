/**
 * The command extractor: which fenced blocks in a Claude Code answer hold
 * something the operator could paste into a shell, and which only look like it.
 *
 * Every fixture here is invented. The rule was developed against a real
 * transcript corpus, but nothing measured from the operator's machine -- no
 * home path, no host name, no project name -- is reproduced in this file.
 */

import { describe, expect, it } from 'vitest';
import { extractCommands } from '../../src/main/sources/claude-code/commands.js';
import { summarizeTranscript } from '../../src/main/sources/claude-code/transcript.js';

/** A fenced block, built without a literal backtick run in the source. */
const TICKS = '`'.repeat(3);
const block = (tag: string, ...lines: string[]) => [`${TICKS}${tag}`, ...lines, TICKS].join('\n');

const texts = (text: string) => extractCommands(text, 'd:0').map((c) => c.command);

describe('extractCommands', () => {
  it('returns nothing for text with no fences', () => {
    expect(extractCommands('run pnpm install and then git status --short', 'd:0')).toEqual([]);
  });

  it('takes commands out of an untagged fence', () => {
    expect(texts(block('', 'pnpm install', 'git status --short'))).toEqual([
      'pnpm install',
      'git status --short',
    ]);
  });

  it('takes commands out of a bash-tagged fence', () => {
    expect(texts(block('bash', 'pnpm run build'))).toEqual(['pnpm run build']);
  });

  it.each(['ts', 'toml', 'json', 'swift'])('ignores a %s-tagged fence', (tag) => {
    expect(texts(block(tag, 'pnpm install', 'git status --short'))).toEqual([]);
  });

  it('ignores an ASCII box-drawing diagram', () => {
    expect(
      texts(block('', 'src/', '├── main/ sources here', '│   └── renderer/ and here')),
    ).toEqual([]);
  });

  it('ignores a numbered prose list', () => {
    expect(texts(block('', '1. Chạy lệnh cài đặt', '2. Then open the app'))).toEqual([]);
  });

  it('ignores a git-log block', () => {
    expect(
      texts(block('', 'f97b84b feat(ui): rebuild the canvas', 'a1b2c3d fix(main): drop the guess')),
    ).toEqual([]);
  });

  it('ignores a results table aligned with columns', () => {
    expect(
      texts(block('', 'yarn lint       clean  5.72s', 'yarn test       ok     11.03s')),
    ).toEqual([]);
  });

  it('ignores a bare word, which is a filename and not a command', () => {
    expect(texts(block('', 'package.json'))).toEqual([]);
  });

  it('ignores a line that opens a block or ends a statement', () => {
    expect(texts(block('', 'steps to run:', 'export const x = {', 'echo done;'))).toEqual([]);
  });

  it('ignores a commented-out C-style line', () => {
    expect(texts(block('', '// pnpm install first'))).toEqual([]);
  });

  it('ignores a line whose head is not lowercase', () => {
    expect(texts(block('', 'Run the installer'))).toEqual([]);
  });

  it('joins a multi-line quoted command into one copyable unit', () => {
    const commands = extractCommands(
      block(
        '',
        `osascript -e 'tell application "Terminal"`,
        'do script "pnpm run dev"',
        `end tell'`,
      ),
      'd:0',
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]?.command).toBe(
      `osascript -e 'tell application "Terminal"\ndo script "pnpm run dev"\nend tell'`,
    );
  });

  it('does not let an unterminated quote swallow the rest of the block', () => {
    expect(texts(block('', `echo 'oops`, 'pnpm install', 'git status --short'))).toEqual([
      `echo 'oops`,
      'pnpm install',
      'git status --short',
    ]);
  });

  it('strips a trailing comment, including a non-ASCII one', () => {
    expect(texts(block('', 'make dev.up        # build dev image → fast'))).toEqual([
      'make dev.up',
    ]);
  });

  it('keeps a # that is not a comment', () => {
    expect(texts(block('', `echo 'tag #1 shipped'`, 'curl http://x#y --silent'))).toEqual([
      `echo 'tag #1 shipped'`,
      'curl http://x#y --silent',
    ]);
  });

  it('strips prompt markers', () => {
    expect(texts(block('', '$ pnpm run dev', '! ls -la'))).toEqual(['pnpm run dev', 'ls -la']);
  });

  // `#` is NOT a prompt marker. A root-shell `# apt install curl` is rare in
  // agent output; `# a note about the next line` is everywhere inside a bash
  // block, and offering a comment to the operator as something to run is the
  // worst thing this feature can do. Precision wins, and the root prompt loses.
  it('rejects a whole-line comment, spaced or not', () => {
    expect(
      texts(block('bash', '# just a note about the build', '#31 A merge lands where it must')),
    ).toEqual([]);
  });

  it('lets a comment line above a real command through untouched', () => {
    expect(
      texts(block('bash', '# install first', 'pnpm install', '  # then build', 'pnpm run build')),
    ).toEqual(['pnpm install', 'pnpm run build']);
  });

  it('rejects a line longer than 400 characters', () => {
    expect(texts(block('', `echo ${'x'.repeat(400)}`))).toEqual([]);
  });

  it('dedupes by exact command text, keeping first-seen order', () => {
    expect(texts(block('', 'pnpm install', 'git status --short', 'pnpm install'))).toEqual([
      'pnpm install',
      'git status --short',
    ]);
  });

  it('caps a decision at six commands', () => {
    const lines = Array.from({ length: 9 }, (_, i) => `pnpm run task-${i}`);
    expect(texts(block('', ...lines))).toHaveLength(6);
  });

  it('collects across several eligible blocks', () => {
    const text = `${block('', 'pnpm install')}\nprose\n${block('sh', 'git push --dry-run')}`;
    expect(texts(text)).toEqual(['pnpm install', 'git push --dry-run']);
  });

  it.each([
    ['gh pr merge 332 --squash', 'gh pr'],
    ['git merge origin/main --no-edit', 'git merge'],
    ['pnpm install', 'pnpm install'],
    ['cd /tmp/x && git merge', 'cd'],
    ['./build.sh --check', './build.sh'],
    ['cat ~/notes.txt', 'cat'],
    ['cat ./notes.txt', 'cat'],
    ['flutter create myapp', 'flutter create'],
    ['wrangler secret put TOKEN', 'wrangler secret'],
    ['git worktree add ../wt', 'git worktree'],
    ['curl -sS https://example.test/x', 'curl'],
    [`osascript -e 'tell app "x" to quit'`, 'osascript'],
    // A quoted argument is an argument, not part of the name. Without this the
    // whole quoted path is adopted and the label runs past 100 characters.
    ['open "/tmp/x/Dracula Theme.terminal"', 'open'],
    [`open '/tmp/x/notes.txt'`, 'open'],
  ])('labels %s as %s', (command, label) => {
    expect(extractCommands(block('', command), 'd:0')[0]?.label).toBe(label);
  });

  // The exclusion list is a guess about token shapes; the cap is a guarantee.
  // `Canvas.tsx` shows the label as `copied: {label}`, which is useless if it
  // is the whole command.
  it('caps a runaway label with an ellipsis', () => {
    const head = `./${'a'.repeat(60)}.sh`;
    const label = extractCommands(block('', `${head} --check`), 'd:0')[0]?.label;
    expect(label).toHaveLength(32);
    expect(label?.endsWith('…')).toBe(true);
    expect(label?.startsWith('./aaa')).toBe(true);
  });

  // Not hex: a 32-character run of hex letters is a sha to the rule above, and
  // would be rejected as a git-log line before it ever reached the label.
  it('leaves a label that fits exactly as it is', () => {
    const command = `${'z'.repeat(32)} --check`;
    expect(extractCommands(block('', command), 'd:0')[0]?.label).toBe('z'.repeat(32));
  });

  it('gives every command an id under the prefix it was handed', () => {
    expect(
      extractCommands(block('', 'pnpm install', 'ls -la'), 'sess-1:2').map((c) => c.id),
    ).toEqual(['sess-1:2:cmd:0', 'sess-1:2:cmd:1']);
  });
});

describe('summarizeTranscript commands', () => {
  it('carries the commands of a decision, with ids unique across decisions', () => {
    const answer = ['Run these:', block('', 'pnpm install', 'pnpm run build')].join('\n\n');
    const tail = [
      { type: 'last-prompt', lastPrompt: 'first' },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: answer }] },
      },
      { type: 'last-prompt', lastPrompt: 'second' },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: answer }] },
      },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n');

    const { decisions } = summarizeTranscript(tail, 'sess-1');
    expect(decisions.map((d) => d.commands.map((c) => c.command))).toEqual([
      ['pnpm install', 'pnpm run build'],
      ['pnpm install', 'pnpm run build'],
    ]);
    const ids = decisions.flatMap((d) => d.commands.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves commands empty when the answer holds none', () => {
    const tail = [
      { type: 'last-prompt', lastPrompt: 'hi' },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'no fences here' }] },
      },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n');
    expect(summarizeTranscript(tail, 'sess-1').decisions[0]?.commands).toEqual([]);
  });
});
