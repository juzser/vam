/**
 * A program that OWNS ITS SCREEN AND ITS MOUSE, the way Claude Code's
 * fullscreen renderer does: it enters the alternate screen (DECSET 1049),
 * asks the terminal for mouse reports in SGR form (1000 + 1006), draws a
 * viewport onto a 450-line document and scrolls that viewport on the wheel
 * reports it receives. tmux keeps no scrollback for the alternate screen, so
 * a capture of this pane is one screen whatever `-S` asks for -- which is the
 * situation `e2e/terminal-echo-scroll-shots.mjs` phase B puts the tab in.
 *
 * `q` leaves: the screen and the mouse are handed back, and the shell
 * underneath still has its history.
 */
const TOTAL = 450;
const out = process.stdout;
const rows = () => out.rows || 24;
let top = TOTAL - rows();

const draw = () => {
  const n = rows();
  top = Math.max(0, Math.min(TOTAL - n, top));
  let frame = '\u001b[H';
  for (let i = 0; i < n; i += 1) {
    const line = top + i;
    frame += `\u001b[K\u001b[3${(line % 7) + 1}mfullscreen ${String(line).padStart(4, '0')}  the program owns this screen\u001b[0m`;
    if (i < n - 1) frame += '\r\n';
  }
  out.write(frame);
};

process.stdin.setRawMode(true);
process.stdin.resume();
out.write('\u001b[?1049h\u001b[?1000h\u001b[?1006h\u001b[?25l');
out.on('resize', draw);
process.stdin.on('data', (chunk) => {
  const bytes = chunk.toString('latin1');
  if (bytes.includes('q')) {
    out.write('\u001b[?1006l\u001b[?1000l\u001b[?1049l\u001b[?25h');
    process.exit(0);
  }
  for (const report of bytes.matchAll(/\u001b\[<(64|65);\d+;\d+M/g)) {
    top += report[1] === '64' ? -1 : 1;
  }
  draw();
});
draw();
