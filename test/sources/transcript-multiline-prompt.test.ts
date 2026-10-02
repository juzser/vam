/**
 * THE OPERATOR'S PROMPT, AS TYPED -- operator event 67: "a multi-line prompt
 * with bullets shows as one line".
 *
 * The pane already draws `Decision.input` with `whitespace-pre-wrap`, so the
 * loss, if any, is in the DATA. The CLI's `last-prompt` marker is a precis
 * (whitespace flattened, cut at 200 characters plus an ellipsis); only the
 * `user` line carries the typed newlines. Every fixture here is written from
 * scratch, and each case asks the one question: where the window holds the
 * `user` line, is `Decision.input` the text as typed?
 *
 * THE RESIDUAL, named: where the window holds only the marker (the `user` line
 * is above the window), the file holds no other text, so the input is the
 * marker. Case (iv) pins that.
 */
import { describe, expect, it } from 'vitest';
import { summarizeTranscript } from '../../src/main/sources/claude-code/transcript.js';

const jsonl = (...lines: unknown[]) => `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;
const TYPED = 'Fix these:\n- first\n- second\n• third';
const MARKER = 'Fix these: - first - second • third';

const typed = (text: string) => ({
  type: 'user',
  promptSource: 'typed',
  timestamp: '2026-10-02T09:00:00.000Z',
  message: { role: 'user', content: text },
});
const marker = (text: string) => ({ type: 'last-prompt', lastPrompt: text });
const reply = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});

const inputsOf = (text: string, windowStart = 0) =>
  summarizeTranscript(text, 'sess-1', windowStart).decisions.map((d) => d.input);

const LONG = `Fix these:\n${Array.from({ length: 12 }, (_, i) => `- item ${i} with some padding`).join('\n')}\n• last`;
const CUT = `${LONG.replace(/\s+/g, ' ').slice(0, 200)}…`;
const parts = {
  ...typed(''),
  message: { role: 'user', content: [{ type: 'text', text: TYPED }] },
};

describe('the typed prompt survives the marker', () => {
  it('(ii) fixture is over 200 characters, and (i) is four lines', () => {
    expect(LONG.length).toBeGreaterThan(200);
    expect(TYPED.split('\n')).toHaveLength(4);
  });

  it.each([
    ['(i) the marker follows the user line', [typed(TYPED), marker(MARKER), reply('ok')], TYPED],
    [
      '(ii) a prompt over 200 characters, marker cut with an ellipsis',
      [typed(LONG), marker(CUT), reply('ok')],
      LONG,
    ],
    [
      '(iii) the marker is re-emitted after the answer',
      [typed(TYPED), marker(MARKER), reply('ok'), marker(MARKER)],
      TYPED,
    ],
    [
      '(iii) the marker is only flushed after the answer',
      [typed(TYPED), reply('ok'), marker(MARKER), marker(MARKER)],
      TYPED,
    ],
    ['the typed prompt is held as text parts', [parts, marker(MARKER), reply('ok')], TYPED],
  ])('keeps the text as typed when %s', (_name, lines, want) => {
    expect(inputsOf(jsonl(...lines))).toEqual([want]);
  });

  it('(iv) falls back to the marker, the only text the file holds, when the window starts after the user line', () => {
    const whole = jsonl(typed(TYPED), marker(MARKER), reply('on it'));
    const at = whole.indexOf(JSON.stringify(marker(MARKER)));
    const start = Buffer.byteLength(whole.slice(0, at));
    expect(inputsOf(whole.slice(at), start)).toEqual([MARKER]);
  });
});
