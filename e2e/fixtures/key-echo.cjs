/**
 * A program that ECHOES EVERY CHUNK IT READS FROM STDIN, HEX-DUMPED, and
 * nothing else -- so a guard can assert what a real program in a real pane
 * RECEIVED, not merely what vam's send path was asked to deliver.
 *
 * Built for `terminal-echo-scroll-shots.mjs`'s Shift+Enter phase
 * (vam/shift-enter): the operator's report was that Shift+Enter submits
 * instead of inserting a newline, and the fix picks a byte sequence to send
 * for it. Asserting against `sendToPane`'s argv alone would only prove vam
 * BUILT the right tmux command, not that the program on the other end of the
 * pty read the byte the fix intended -- tmux declining a key, `-l` typing a
 * name instead of a key, or a pty translating a byte are all real ways for
 * that gap to open. This fixture closes it: raw mode, one line of hex per
 * `data` event, so a single `\n` keystroke shows as `chunk N: 0a` and a real
 * Enter shows as `chunk N: 0d`, distinguishable at a glance and by an exact
 * string match.
 *
 * `\r\n` terminates each line because stdout is a raw pty here too -- a bare
 * `\n` would only carriage-return-less line-feed, which most terminals (and
 * `capture-pane`) render as a ragged left margin rather than a new line.
 */
process.stdin.setRawMode(true);
process.stdin.resume();
let n = 0;
process.stdin.on('data', (chunk) => {
  n += 1;
  const hex = Array.from(chunk, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
  process.stdout.write(`chunk ${n}: ${hex}\r\n`);
});
