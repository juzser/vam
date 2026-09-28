import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `e2e/electron-launch.et.ts` deliberately INLINES the same small mechanism
 * `test/support/tmux-harness-env.ts` exports (see that file's own header:
 * `e2e/` keeps its own toolchain -- no shared `tsconfig`, no `vitest` of its
 * own -- exactly so a spec there never depends on the root project's test
 * tree). That means the fix for the real incident this repo measured --
 * `TMUX_TMPDIR=<a deleted dir> tmux -L default kill-server` silently falling
 * through tmux's own `"$TMUX_TMPDIR:/tmp/"` search list to the OPERATOR'S
 * REAL default socket, because the socket NAME `default` is the exact name a
 * bare, unisolated `tmux` call always uses -- has to be applied TWICE: once
 * in `test/support/tmux-harness-env.ts` (unit-tested directly, in
 * `tmux-harness-env.test.ts`, with an injected exec and no real tmux), and
 * once again here, by hand, in the copy.
 *
 * THIS IS THE GUARD FOR THAT SECOND COPY. It cannot unit-test the inlined
 * functions themselves without importing across the boundary the file's own
 * header refuses to cross, so instead -- the same discipline
 * `test/e2e/tmux-socket-guard.test.ts` and `test/electron/
 * tmux-isolation-guard.test.ts` already apply to their own corpora -- it
 * sweeps the file's SOURCE and asserts, by content:
 *  1. NO `-L` argv token appears anywhere in the file at all, and
 *  2. the safe replacement (an explicit `-S <computed path>`, guarded by a
 *     real `isSocket()` check before anything destructive runs) is present.
 *
 * A BLANKET BAN ON `-L`, NOT JUST ON `-L` PAIRED WITH THE LITERAL
 * `'default'` (a reviewer finding on this same fix): a sweep that only
 * matched `-L` next to a quoted `'default'` would miss a rewrite that
 * reintroduced the hazard through a VARIABLE instead -- `const SOCK =
 * 'default'; [...prefix, '-L', SOCK, ...]` reaches the identical operator
 * socket and would slip straight past a literal-only pattern. After this
 * fix the file has no legitimate reason to pass `-L` to tmux anywhere at
 * all -- every kill/count/list call in it addresses an explicit `-S <path>`
 * instead -- so banning the token outright is not over-broad.
 *
 * Falsified directly while writing this fix: reverting `e2e/
 * electron-launch.et.ts` to its pre-fix contents (`git show
 * origin/main:e2e/electron-launch.et.ts`) makes both assertions below fail --
 * `-L` is present, and `-S` is not.
 */

const FILE = path.resolve(__dirname, '..', '..', 'e2e', 'electron-launch.et.ts');

/** Block comments, then line comments -- `test/e2e/tmux-socket-guard.test.ts`'s
 *  own order and its own reason: a `//` inside a `/* ... *\/` block would cut
 *  the block comment short if line comments were stripped first. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** ANY `-L` argv token at all -- literal or paired with a variable. Broader
 *  than matching only `-L` next to a quoted `'default'`: see this file's
 *  own header for why a variable-paired reintroduction must be caught too. */
const HAS_DASH_L_TOKEN = /['"]-L['"]/;

/** The safe replacement: an explicit `-S` argument, so nothing here ever
 *  asks tmux to resolve a socket by NAME through its own search list for a
 *  destructive or count-bearing call again. */
const USES_DASH_S = /['"]-S['"]/;

/** The runtime guard before anything destructive runs: a real `isSocket()`
 *  check, so a missing or non-socket path means the caller does nothing. */
const CHECKS_IS_SOCKET = /\.isSocket\(\)/;

describe('e2e/electron-launch.et.ts never lets a kill/list tmux call resolve `-L default`', () => {
  const code = stripComments(readFileSync(FILE, 'utf8'));

  it('contains no `-L` argv token at all, literal or variable', () => {
    expect(code).not.toMatch(HAS_DASH_L_TOKEN);
  });

  it('addresses the isolated socket with an explicit -S path instead', () => {
    expect(code).toMatch(USES_DASH_S);
  });

  it('guards the destructive/count calls with a real isSocket() check', () => {
    expect(code).toMatch(CHECKS_IS_SOCKET);
  });
});
