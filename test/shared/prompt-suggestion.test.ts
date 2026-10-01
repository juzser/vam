/** EC-38: the greyed suggestion, read off RECORDED `capture-pane -e -p` screens. */
import { describe, expect, it } from 'vitest';
import { readPromptSuggestion } from '../../src/shared/prompt-suggestion.js';
import {
  FRESH_HINT,
  MID_TURN,
  ONE_CHAR,
  SUGGESTION,
} from '../fixtures/prompt-suggestion-screens.js';
import { REVIEW, SINGLE, STEP2_OF_3 } from '../main/terminal/answer-ux3-screens.js';

const ESC = String.fromCharCode(27);

describe('readPromptSuggestion (EC-38)', () => {
  it('returns the ghost text of the standing suggestion screen', () => {
    expect(readPromptSuggestion(SUGGESTION)).toBe('run the test');
  });

  it('returns null once a character is typed, and mid-turn', () => {
    expect(readPromptSuggestion(ONE_CHAR)).toBeNull();
    expect(readPromptSuggestion(MID_TURN)).toBeNull();
  });

  it("returns null for the fresh session's example hint, which is dim too", () => {
    expect(FRESH_HINT).toContain(`${ESC}[2mTry "`);
    expect(readPromptSuggestion(FRESH_HINT)).toBeNull();
  });

  it('returns null for an open picker screen', () => {
    expect(readPromptSuggestion(SINGLE)).toBeNull();
    expect(readPromptSuggestion(STEP2_OF_3)).toBeNull();
    expect(readPromptSuggestion(REVIEW)).toBeNull();
  });

  it('returns null for an empty screen and for a plain, uncoloured input row', () => {
    expect(readPromptSuggestion('')).toBeNull();
    const rule = '─'.repeat(40);
    expect(readPromptSuggestion(`${rule}\n❯ run the test\n${rule}`)).toBeNull();
  });

  it('does not take a half-dim row, where typed text stands beside a dim tail', () => {
    const rule = '─'.repeat(40);
    expect(readPromptSuggestion(`${rule}\n❯ ru${ESC}[2mn it${ESC}[0m\n${rule}`)).toBeNull();
  });
});
