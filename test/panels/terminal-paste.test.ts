/**
 * PREPARING A REAL CLIPBOARD PASTE FOR A TERMINAL PANE.
 *
 * The operator's ask: paste in the Terminal tab's Insert mode was refused
 * outright (`TerminalTab.tsx`'s hidden-textarea `onInput` drops
 * `insertFromPaste`, and `TerminalStreamTab.tsx` cancels the browser's own
 * `paste` event on xterm's textarea) -- allow it. Both renderers now read the
 * clipboard text straight off the `paste` event (no permission needed; see
 * `composer-paste.ts`'s own note on why a paste event is not a clipboard
 * READ) and pass it through this one function before it ever becomes a
 * `PaneKey` or a stream write.
 *
 * WHAT IT DOES, and why each step is here rather than left to tmux/xterm:
 *
 *   - CRLF and a bare LF both become one CR, matching xterm.js's own
 *     `prepareTextForTerminal` and the byte Return sends
 *     (`sources/tmux/argv.ts`'s `sendEnterArgv`) -- so a paste is not split
 *     into more submitted lines than a real terminal paste would produce.
 *
 *   - NUL is stripped. It is the one byte C strings and tmux's own buffer
 *     handling cannot carry, and nothing a person pastes is lost by dropping
 *     it -- every other C0 control (Tab, a raw Escape, Ctrl+C) is left alone,
 *     because a real terminal paste delivers those raw.
 *
 *   - An embedded bracketed-paste END or START marker (`\x1b[201~` /
 *     `\x1b[200~`) has its ESC byte dropped, wherever it appears in the
 *     pasted text. Bracketed paste has no escaping of its own: a receiving
 *     program that is watching for the END sentinel to know the paste is
 *     over cannot tell a forged one inside the DATA from the real one this
 *     module or tmux's own `paste-buffer -p` appends -- so clipboard text
 *     that happens to contain the literal six bytes of the end marker could
 *     otherwise end the bracket early and have whatever follows read as if
 *     it had been typed. Dropping just the ESC byte turns it into inert text
 *     (`[201~`) and changes nothing else about the paste.
 *
 *   - The whole thing is capped at `MAX_PASTE_TEXT` code points before any of
 *     the above runs, so a compromised renderer cannot hand main an unbounded
 *     string; the cap is `shared/terminal.ts`'s own, so `isPaneKey` and this
 *     function are never two different numbers to drift apart.
 */

import { describe, expect, it } from 'vitest';
import { preparePastedText } from '../../src/renderer/panels/terminal-paste.js';
import { MAX_PASTE_TEXT } from '../../src/shared/terminal.js';

describe('preparePastedText', () => {
  it('passes plain text through untouched', () => {
    expect(preparePastedText('hello world')).toBe('hello world');
  });

  it('turns CRLF into a single CR, like a real terminal paste', () => {
    expect(preparePastedText('line one\r\nline two')).toBe('line one\rline two');
  });

  it('turns a bare LF into CR too, so it is not one submit short of CRLF', () => {
    expect(preparePastedText('line one\nline two')).toBe('line one\rline two');
  });

  it('does not double a lone CR into two returns', () => {
    // A CRLF pair must collapse to ONE CR, not the CR it already had plus a
    // second one for the LF that followed it.
    expect(preparePastedText('a\r\nb\r\nc')).toBe('a\rb\rc');
  });

  it('strips NUL and nothing else in the C0 range', () => {
    const withNul = 'a\u0000b\tc\u0007d';
    expect(preparePastedText(withNul)).toBe('a' + 'b\tc\u0007d');
  });

  it('passes a raw Escape through when it is not part of a bracket marker', () => {
    const withEscape = 'a\u001bb';
    expect(preparePastedText(withEscape)).toBe(withEscape);
  });

  it('drops the ESC byte of an embedded bracketed-paste END marker', () => {
    const hostile = `before\u001b[201~ echo pwned after`;
    const cleaned = preparePastedText(hostile);
    expect(cleaned).not.toContain('\u001b[201~');
    // Nothing else about the text is lost -- just the one byte that would
    // have forged the terminator.
    expect(cleaned).toBe('before[201~ echo pwned after');
  });

  it('drops the ESC byte of an embedded bracketed-paste START marker too', () => {
    const hostile = `a\u001b[200~b`;
    expect(preparePastedText(hostile)).toBe('a[200~b');
  });

  it('caps at MAX_PASTE_TEXT code points by default', () => {
    const huge = 'x'.repeat(MAX_PASTE_TEXT + 500);
    expect(preparePastedText(huge)).toHaveLength(MAX_PASTE_TEXT);
  });

  it('honours a bound it is given, so the test and the wire cap cannot drift', () => {
    expect(preparePastedText('abcdef', 3)).toBe('abc');
  });

  it('never splits a surrogate pair at the truncation boundary', () => {
    const emoji = '🙂'.repeat(5); // 10 UTF-16 code units, 2 per emoji
    // A limit of 3 code units cannot fit a second emoji (which needs 2 more,
    // totalling 4) without splitting it, so the whole second one is left out
    // rather than cut in half.
    expect(preparePastedText(emoji, 3)).toBe('🙂');
    expect(preparePastedText(emoji, 4)).toBe('🙂🙂');
  });

  it('says nothing at all for an empty paste', () => {
    expect(preparePastedText('')).toBe('');
  });
});
