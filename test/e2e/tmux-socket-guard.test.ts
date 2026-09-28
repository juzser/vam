import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { privateTmuxSocket } from '../../e2e/support/tmux-socket.mjs';

/**
 * ONE HELPER, AND NOTHING ELSE MAY SPELL A TMUX SOCKET NAME BY HAND.
 *
 * Two agents running the web-guard suite concurrently on one machine both
 * spawned `tmux -L vam-e2e-latency` (a bare literal every guard used to
 * hard-code): the second run's own `kill-server` tore down the first run's
 * session mid-guard, which read as a flaky guard rather than what it was --
 * a shared socket FILE, not a shared bug. `privateTmuxSocket()` suffixes the
 * base name with this process's own pid, so two concurrent runs of the exact
 * same guard get two different sockets and never share a tmux server, with
 * no coordination between callers required.
 *
 * THE SWEEP BELOW IS THE GUARD FOR THE GUARD: it does not merely trust that
 * every caller remembered to route through `privateTmuxSocket()` once -- it
 * greps every `e2e/*.mjs` file for a bare string literal fed straight to
 * `-L`, which is exactly the shape the original defect had and exactly the
 * shape a new guard script would reintroduce it in. `['-L', SOCKET]` (an
 * identifier) is fine; `['-L', 'some-name']` (a literal) is not, whichever
 * file adds it.
 *
 * A CORPUS FLOOR, OR THIS PROVES NOTHING (`a sweep must prove it found a
 * corpus`): the sweep below asserts it actually walked more than a handful
 * of files before trusting a clean result from it.
 */

const E2E_ROOT = join(__dirname, '..', '..', 'e2e');

/** The helper module itself is the one place allowed to accept a bare base
 *  name and turn it into a socket -- everything else must call it. */
const ALLOWED = new Set(['e2e/support/tmux-socket.mjs']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (/\.mjs$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Block comments, then line comments -- same order `no-stray-glyphs.test.ts`
 *  uses and for the same reason: a `//` inside a `/* ... *\/` block would cut
 *  the block comment short if line comments were stripped first. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** A bare string literal immediately following a `-L` literal in an argument
 *  list -- the DIRECT shape a private socket name can leak into hard-coded
 *  again. `['-L', SOCKET]` does not match: `SOCKET` is an identifier, not a
 *  quoted literal. */
const HARDCODED_DASH_L = /['"]-L['"]\s*,\s*(['"`])(?:(?!\1)[^\\]|\\.)*\1/g;

/** The INDIRECT shape every real guard actually had: `-L` reads a `SOCKET`
 *  variable, but `SOCKET` itself was assigned a bare literal rather than
 *  routed through `privateTmuxSocket()`. Every guard in this tree names its
 *  own socket variable `SOCKET` -- this is the repo-wide convention the fix
 *  follows, not an assumption the sweep invents. */
const HARDCODED_SOCKET_ASSIGNMENT =
  /\b(?:const|let|var)\s+SOCKET\s*=\s*(['"`])(?:(?!\1)[^\\]|\\.)*\1/g;

describe('privateTmuxSocket', () => {
  it("suffixes the base name with this process's own pid", () => {
    const socket = privateTmuxSocket('vam-e2e-example');
    expect(socket).toBe(`vam-e2e-example-${process.pid}`);
  });

  it('gives two different bases two different sockets, never colliding', () => {
    expect(privateTmuxSocket('vam-e2e-a')).not.toBe(privateTmuxSocket('vam-e2e-b'));
  });

  it('requires a base name -- an empty socket is not a private one', () => {
    expect(() => privateTmuxSocket('')).toThrow();
  });
});

describe('no hand-written tmux socket escapes privateTmuxSocket()', () => {
  it('sweeps a real corpus and finds every -L argument routed through the helper', () => {
    const files = walk(E2E_ROOT);
    expect(files.length, 'the sweep must examine a real corpus').toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(join(E2E_ROOT, '..'), file).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      const hits = [
        ...(code.match(HARDCODED_DASH_L) ?? []),
        ...(code.match(HARDCODED_SOCKET_ASSIGNMENT) ?? []),
      ];
      for (const hit of hits) {
        offenders.push(`${rel}: ${hit.trim()}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('the six real-tmux guards all import the shared helper', () => {
    const expected = [
      'e2e/shell-first-ctrlc-survives.mjs',
      'e2e/terminal-echo-scroll-shots.mjs',
      'e2e/terminal-stream-glitch-shots.mjs',
      'e2e/terminal-stream-latency-shots.mjs',
      'e2e/terminal-stream-resource-shots.mjs',
      'e2e/terminal-typing-latency-shots.mjs',
    ];
    for (const rel of expected) {
      const code = readFileSync(join(E2E_ROOT, '..', rel), 'utf8');
      expect(code, `${rel} must import privateTmuxSocket`).toMatch(
        /from ['"].*support\/tmux-socket\.mjs['"]/,
      );
      expect(code, `${rel} must call privateTmuxSocket(...)`).toMatch(
        /const SOCKET = privateTmuxSocket\(/,
      );
    }
  });
});
