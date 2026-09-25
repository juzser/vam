/**
 * OPERATOR REPORT: "the terminal often turns characters into ?." AGAINST A
 * REAL TMUX, WITH THE CONTROL CHILD ITSELF SPAWNED IN A LAUNCHD-SHAPED
 * ENVIRONMENT.
 *
 * `env/utf8-ctype.ts`'s own header already names one real locale bug: a
 * GUI launch (Finder, Dock, Spotlight) has no `LANG`/`LC_*` at all, and a
 * tmux CLIENT without a UTF-8 `LC_CTYPE` rewrites `-F` FORMAT-STRING
 * expansion into underscores. This file asks a DIFFERENT question:
 * whether that same missing locale, on the CONTROL CHILD `StreamClient`
 * itself spawns (`client.ts#spawn`, `-C attach-session`), corrupts PANE
 * BYTES -- `%output`/`capture-pane` content, not a `-F` expansion.
 *
 * `decodeOutputPayload`'s own header (`control-protocol.ts`) already
 * argues no: tmux's control-mode wire only octal-escapes bytes below 32;
 * everything else, multi-byte UTF-8 included, crosses raw and is decoded by
 * THIS file's own `node:string_decoder`, never by anything that consults a
 * process locale. `e2e/terminal-stream-glitch-shots.mjs`'s own header
 * records the same conclusion, reached by hand once, with `LANG`/`LC_*`
 * stripped from that harness's whole process. THIS file is the automated,
 * falsifiable version of that same by-hand check: only the CHILD this file
 * spawns gets a stripped environment (`spawnChild`'s own `env` option,
 * `StreamClientOptions`'s existing DI seam) -- nothing else on the machine
 * is touched, and the assertion is against a REAL tmux server's REAL
 * `capture-pane` reply, not a fake.
 *
 * SAFETY: a private `-L` socket named for this process and this file, a
 * session name carrying the mandatory `vam-` prefix `StreamClient` itself
 * requires (`SAFE_TARGET_RE`), `kill-server` in `afterAll` -- the same
 * pattern every other real-tmux test in this repo uses.
 *
 * SKIPPED, LOUDLY, WHERE THERE IS NO TMUX.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StreamClient } from '../../../../src/main/terminal/stream/client.js';

const tmuxWorks = (): boolean => {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const SOCKET = `vamtest${process.pid}le`;
const SESSION = `vam-launchdutf8-${process.pid}`;

const tmux = (...argv: string[]): string =>
  execFileSync('tmux', ['-L', SOCKET, ...argv], { encoding: 'utf8' });

/** `LANG`/every `LC_*` removed -- the shape `applyUtf8Ctype`'s own header
 * says a Finder/Dock/Spotlight launch actually has (`env -i HOME PATH USER
 * SHELL`, no locale at all), applied to nothing but the ONE child this test
 * spawns via `spawnChild`. */
function launchdShapedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'LANG' || key.startsWith('LC_')) delete env[key];
  }
  return env;
}

// Vietnamese (both precomposed NFC and combining-mark NFD), CJK, box-drawing
// and an emoji -- kept short enough to stay on one 80-column row so this
// check is purely about byte DECODING, never about wrap/row alignment
// (`stream-client-seed-cursor.test.ts` owns that concern).
const TEXT = `VN:Tiếng Việt/${'Tiếng Việt'.normalize('NFD')} CJK:你好 box:╭─╮ emoji:🎉`;

const live = tmuxWorks();

describe.skipIf(!live)('a launchd-shaped environment still renders UTF-8 (real tmux)', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'vam-launchd-utf8-'));

  beforeAll(() => {
    tmux('new-session', '-d', '-s', SESSION, '-x', '80', '-y', '24', 'sh');
    // A real UTF-8 file + `cat`, never a hand-escaped `send-keys` line --
    // the SAME trap `terminal-stream-glitch-shots.mjs`'s own header names
    // (tmux's control-mode line is ALSO shell-like grammar).
    const fixturePath = join(scratch, 'fixture.txt');
    writeFileSync(fixturePath, `${TEXT}\n`, 'utf8');
    tmux('send-keys', '-t', SESSION, '-l', '--', `clear; cat ${fixturePath}`);
    tmux('send-keys', '-t', SESSION, 'Enter');
  }, 20_000);

  afterAll(() => {
    try {
      tmux('kill-server');
    } catch {
      // Already gone.
    }
    rmSync(scratch, { recursive: true, force: true });
  });

  it('decodes real pane UTF-8 correctly even when the CONTROL CHILD is spawned with LANG/LC_* stripped', async () => {
    await new Promise((r) => setTimeout(r, 300));
    const env = launchdShapedEnv();
    expect(env.LANG).toBeUndefined();
    const client = new StreamClient({
      prefix: ['-L', SOCKET],
      target: SESSION,
      spawnChild: (binary, argv) => spawn(binary, [...argv], { env }),
    });
    try {
      const seed = await client.connect();
      expect(seed).toContain(TEXT);
      expect(seed).not.toContain('�');
      // Not a real assertion on content (`TEXT` itself carries none), but
      // the operator's own words for this bug: nothing legitimate in the
      // fixture is a literal `?`, so one appearing here is corruption, not
      // content. `seedWithCursor`'s own trailing `CSI ?25h`/`CSI ?25l`
      // (`seed.ts`) carries a LEGITIMATE `?` as part of DECTCEM's own
      // syntax -- stripped first so this only ever reads the SCREEN text.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: matching the literal ESC byte is the whole point -- stripping the CSI sequences this file's own cursor fix appends.
      const withoutCursorEscapes = seed.replace(/\x1b\[[?\d;]*[Hh]|\x1b\[\?25[hl]/g, '');
      expect(withoutCursorEscapes.includes('?')).toBe(false);
    } finally {
      client.dispose();
    }
  });
});
