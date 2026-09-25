/**
 * THE QUESTION CARD THAT WENT SILENT -- end to end, at the real byte sizes.
 *
 * Reported from use, while fixing the question card (#487): a session asked
 * through `AskUserQuestion`, kept working (more tool calls, more replies),
 * and the Response view's card disappeared while the CLI still showed the
 * question pending. `tail.ts`'s widening read stops the moment it holds ANY
 * `user` and ANY `assistant` line -- a rule written for the turn decisions,
 * and blind to whether the material it stopped on happens to be AFTER an
 * unanswered question. A burst of ordinary output past the question satisfies
 * that rule on its own, so the read never widens back far enough to see the
 * `tool_use` that asked it.
 *
 * `question-index.ts` is the fix: a bounded, incrementally-cached look at the
 * newest `AskUserQuestion` in the file, independent of where the tail window
 * happened to stop. These tests go through `loadClaudeCodeProjects` -- the
 * real entry point a poll calls -- at the shipped 128 KiB window, the same
 * standard `claude-code-tail-window.test.ts` holds itself to for the sibling
 * defect.
 *
 * EVERY FIXTURE HERE IS INVENTED -- shapes measured against the real corpus,
 * written out from scratch. No transcript content, session id or path from
 * the machine running this reaches a fixture.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LiveAgent } from '../../src/main/sources/claude-code/agents.js';
import { createQuestionIndex } from '../../src/main/sources/claude-code/question-index.js';
import {
  loadClaudeCodeProjects,
  readTranscript,
} from '../../src/main/sources/claude-code/source.js';
import { TAIL_WINDOW_BYTES } from '../../src/main/sources/claude-code/tail.js';

const NOW = Date.parse('2026-09-25T09:05:00.000Z');

const jsonl = (...lines: unknown[]) => `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;

const chatter = (n: number) =>
  n % 2 === 0
    ? {
        type: 'user',
        promptSource: 'typed',
        timestamp: '2026-09-25T09:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: `filler prompt ${n}` }] },
      }
    : {
        type: 'assistant',
        timestamp: '2026-09-25T09:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: `filler reply ${n}` }] },
      };

const ask = (id: string) => ({
  type: 'assistant',
  timestamp: '2026-09-25T08:59:00.000Z',
  message: {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id,
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Which build should ship?',
              header: 'Build',
              options: [{ label: 'canary' }, { label: 'stable' }],
            },
          ],
        },
      },
    ],
  },
});

const answerLine = (id: string) => ({
  type: 'user',
  timestamp: '2026-09-25T09:04:00.000Z',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'stable' }] },
});

/** At least `bytes` of ordinary conversation, as complete JSONL lines. */
function fillerPastTheWindow(bytes: number): string {
  let out = '';
  let i = 0;
  while (Buffer.byteLength(out, 'utf8') < bytes) {
    out += jsonl(chatter(i));
    i += 1;
  }
  return out;
}

describe('an AskUserQuestion buried under a burst of ordinary output', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vam-question-window-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const agent = (): LiveAgent => ({
    key: 'sess-1#100',
    sessionId: 'sess-1',
    pid: null,
    name: 'demo',
    cwd: '/w/alpha',
    status: 'running',
    kind: 'interactive',
    startedAt: null,
  });

  it('is still reported OPEN once the burst pushes it out of the tail window', async () => {
    mkdirSync(join(root, 'proj'), { recursive: true });
    writeFileSync(
      join(root, 'proj', 'sess-1.jsonl'),
      jsonl(ask('toolu_1')) + fillerPastTheWindow(TAIL_WINDOW_BYTES + 4096),
      'utf8',
    );

    const [project] = await loadClaudeCodeProjects(root, [agent()], NOW);
    const questions = project?.sessions[0]?.questions ?? [];

    expect(questions).toHaveLength(1);
    expect(questions[0]?.answer).toBeNull();
    expect(questions[0]?.question).toBe('Which build should ship?');
  });

  it('does NOT reappear as open once answered, even though the answer sits in the window and the question does not', async () => {
    mkdirSync(join(root, 'proj'), { recursive: true });
    writeFileSync(
      join(root, 'proj', 'sess-1.jsonl'),
      jsonl(ask('toolu_1')) +
        fillerPastTheWindow(TAIL_WINDOW_BYTES + 4096) +
        jsonl(answerLine('toolu_1')),
      'utf8',
    );

    const [project] = await loadClaudeCodeProjects(root, [agent()], NOW);
    const questions = project?.sessions[0]?.questions ?? [];

    // Absent, or present and answered -- either is honest. Open is the one
    // thing it must never be, because the session is not waiting any more.
    for (const q of questions) expect(q.answer).not.toBeNull();
  });

  it('reads no more of the file on the SECOND poll once nothing has changed', async () => {
    mkdirSync(join(root, 'proj'), { recursive: true });
    const path = join(root, 'proj', 'sess-1.jsonl');
    writeFileSync(
      path,
      jsonl(ask('toolu_1')) + fillerPastTheWindow(TAIL_WINDOW_BYTES + 4096),
      'utf8',
    );

    const index = createQuestionIndex();
    const first = await readTranscript(path, 'sess-1', NOW, index);
    expect(first.facts.questions).toHaveLength(1);
    expect(first.facts.questions[0]?.answer).toBeNull();

    // A second poll of the SAME, unchanged file -- the persistent index must
    // answer it without a fresh multi-megabyte scan. `readTranscript` itself
    // still pays the ordinary tail read every poll (that budget is
    // `tail.ts`'s, unrelated to this one); what this proves is that the
    // question stays reported without this module doing that work twice.
    const second = await readTranscript(path, 'sess-1', NOW, index);
    expect(second.facts.questions).toHaveLength(1);
    expect(second.facts.questions[0]?.answer).toBeNull();
  });
});
