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

describe('the typed prompt survives the marker', () => {
  it('(i) keeps four lines and both bullet styles when the marker follows the user line', () => {
    const text = jsonl(typed(TYPED), marker(MARKER), reply('on it'));
    expect(inputsOf(text)).toEqual([TYPED]);
    expect(TYPED.split('\n')).toHaveLength(4);
  });

  it('(ii) keeps a prompt over 200 characters whole while the marker is cut with an ellipsis', () => {
    const body = Array.from({ length: 12 }, (_, i) => `- item number ${i} with some padding`);
    const long = `Fix these:\n${body.join('\n')}\n• last`;
    expect(long.length).toBeGreaterThan(200);
    const flat = long.replace(/\s+/g, ' ');
    const cut = `${flat.slice(0, 200)}…`;
    const text = jsonl(typed(long), marker(cut), reply('on it'));
    expect(inputsOf(text)).toEqual([long]);
  });

  it('(iii) keeps it when the marker is re-emitted after the answer', () => {
    const text = jsonl(typed(TYPED), marker(MARKER), reply('on it'), marker(MARKER));
    expect(inputsOf(text)).toEqual([TYPED]);
  });

  it('(iii) keeps it when the marker is only flushed after the answer', () => {
    const text = jsonl(typed(TYPED), reply('on it'), marker(MARKER), marker(MARKER));
    expect(inputsOf(text)).toEqual([TYPED]);
  });

  it('(iv) falls back to the marker, the only text the file holds, when the window starts after the user line', () => {
    const whole = jsonl(typed(TYPED), marker(MARKER), reply('on it'));
    const at = whole.indexOf(JSON.stringify(marker(MARKER)));
    const start = Buffer.byteLength(whole.slice(0, at));
    expect(inputsOf(whole.slice(at), start)).toEqual([MARKER]);
  });

  it('keeps a typed prompt held as text parts, not a bare string', () => {
    const parts = {
      ...typed(''),
      message: { role: 'user', content: [{ type: 'text', text: TYPED }] },
    };
    expect(inputsOf(jsonl(parts, marker(MARKER), reply('ok')))).toEqual([TYPED]);
  });
});
