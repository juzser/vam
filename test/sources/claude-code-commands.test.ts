/**
 * The command extractor: a line the agent marked with a leading `!` is a
 * command it is asking the operator to run, and nothing else is.
 *
 * Every fixture here is invented. The convention was measured against a real
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

  it('takes a marked line out of an untagged fence, without the marker', () => {
    expect(texts(block('', '! pnpm install', '! git status --short'))).toEqual([
      'pnpm install',
      'git status --short',
    ]);
  });

  it('takes a marked line out of a bash-tagged fence', () => {
    expect(texts(block('bash', '! pnpm run build'))).toEqual(['pnpm run build']);
  });

  it('accepts a marker indented inside the block', () => {
    expect(texts(block('bash', '    !   pnpm run build'))).toEqual(['pnpm run build']);
  });

  it.each(['ts', 'toml', 'json', 'swift'])('ignores a %s-tagged fence', (tag) => {
    expect(texts(block(tag, '! pnpm install'))).toEqual([]);
  });

  // The headline behaviour change: what a line looks like no longer matters.
  it('does NOT extract an unmarked command line', () => {
    expect(
      texts(block('bash', 'pnpm install', 'git status --short', './build.sh --check')),
    ).toEqual([]);
  });

  it('does not treat a shell prompt marker as a request', () => {
    expect(texts(block('', '$ pnpm run dev', '# apt install curl'))).toEqual([]);
  });

  it('rejects a bare marker with nothing after it', () => {
    expect(texts(block('', '!', '!   '))).toEqual([]);
  });

  it('rejects a marker glued to its text, which is history expansion or negation', () => {
    expect(texts(block('', '!pnpm install', '!!'))).toEqual([]);
  });

  // Fence-scoped by decision, and the test that pins it.
  it('ignores a marked line outside any fence', () => {
    expect(texts('Then run this:\n! pnpm install\nand you are done')).toEqual([]);
  });

  it('joins a multi-line quoted command into one copyable unit', () => {
    const commands = extractCommands(
      block(
        '',
        `! osascript -e 'tell application "Terminal"`,
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
    expect(texts(block('', `! echo 'oops`, '! pnpm install', '! git status --short'))).toEqual([
      `echo 'oops`,
      'pnpm install',
      'git status --short',
    ]);
  });

  it('strips a trailing comment, including a non-ASCII one', () => {
    expect(texts(block('', '! make dev.up        # build dev image → fast'))).toEqual([
      'make dev.up',
    ]);
  });

  it('keeps a # that is not a comment', () => {
    expect(texts(block('', `! echo 'tag #1 shipped'`, '! curl http://x#y --silent'))).toEqual([
      `echo 'tag #1 shipped'`,
      'curl http://x#y --silent',
    ]);
  });

  it('dedupes by exact command text, keeping first-seen order', () => {
    expect(texts(block('', '! pnpm install', '! git status --short', '! pnpm install'))).toEqual([
      'pnpm install',
      'git status --short',
    ]);
  });

  it('caps a decision at six commands', () => {
    const lines = Array.from({ length: 9 }, (_, i) => `! pnpm run task-${i}`);
    expect(texts(block('', ...lines))).toHaveLength(6);
  });

  it('collects across several eligible blocks', () => {
    const text = `${block('', '! pnpm install')}\nprose\n${block('sh', '! git push --dry-run')}`;
    expect(texts(text)).toEqual(['pnpm install', 'git push --dry-run']);
  });

  it.each([
    ['gh pr merge 332 --squash', 'gh pr'],
    ['git merge origin/main --no-edit', 'git merge'],
    ['pnpm install', 'pnpm install'],
    ['cd /tmp/x && git merge', 'cd'],
    ['./build.sh --check', './build.sh'],
    ['cat ~/notes.txt', 'cat'],
    ['flutter create myapp', 'flutter create'],
    ['curl -sS https://example.test/x', 'curl'],
    [`osascript -e 'tell app "x" to quit'`, 'osascript'],
    // A quoted argument is an argument, not part of the name. Without this the
    // whole quoted path is adopted and the label runs past 100 characters.
    ['open "/tmp/x/Dracula Theme.terminal"', 'open'],
    [`open '/tmp/x/notes.txt'`, 'open'],
  ])('labels %s as %s', (command, label) => {
    expect(extractCommands(block('', `! ${command}`), 'd:0')[0]?.label).toBe(label);
  });

  // The exclusion list is a guess about token shapes; the cap is a guarantee.
  // `Canvas.tsx` shows the label as `copied: {label}`, which is useless if it
  // is the whole command.
  it('caps a runaway label with an ellipsis', () => {
    const head = `./${'a'.repeat(60)}.sh`;
    const label = extractCommands(block('', `! ${head} --check`), 'd:0')[0]?.label;
    expect(label).toHaveLength(32);
    expect(label?.endsWith('…')).toBe(true);
    expect(label?.startsWith('./aaa')).toBe(true);
  });

  it('leaves a label that fits exactly as it is', () => {
    const command = `${'z'.repeat(32)} --check`;
    expect(extractCommands(block('', `! ${command}`), 'd:0')[0]?.label).toBe('z'.repeat(32));
  });

  it('gives every command an id under the prefix it was handed', () => {
    expect(
      extractCommands(block('', '! pnpm install', '! ls -la'), 'sess-1:2').map((c) => c.id),
    ).toEqual(['sess-1:2:cmd:0', 'sess-1:2:cmd:1']);
  });
});

describe('summarizeTranscript commands', () => {
  it('carries the commands of a decision, with ids unique across decisions', () => {
    const answer = ['Run these:', block('', '! pnpm install', '! pnpm run build')].join('\n\n');
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
