/**
 * A COMMENT NAMES A PLACE IN ITS OWN FILE BY SYMBOL, NEVER BY LINE NUMBER.
 *
 * Rule (f-vam-ux-2/integration-38e02358, S3): a line number cited inside the
 * file it points into goes stale on the next edit above it, and task-3's
 * `defined at :4553` did exactly that once task-5 moved the code. A place in
 * the same file is named by its symbol (`KEY_STRIP`, `STRIP_PILL`,
 * `canSendKeys`, `DEFAULT_SESSION_FILTERS`, `onlyPrompted`). Only a citation
 * into ANOTHER file may carry a path and a line. f-vam-ux-2/integration-50e766b0
 * (S4) is the sibling finding: the epic's figures were pinned to a moving sha.
 *
 * Scanned: DetailPanel.tsx and session-filter.ts, comment text only. A
 * citation is `<prefix>:<digits>`; it is a VIOLATION when the prefix is empty
 * (bare `:4553`) or its last '/'-segment is this file's own basename or stem.
 * `DetailPanel.keystroke-strip.test.tsx:496-521` only STARTS with the stem, so
 * it is legal, as are `width:408px` and contrast ratios such as `4.5:1`.
 * docs/design/phone-core-loop.md is deliberately not scanned.
 *
 * CORPUS FLOOR and CANARY below keep an extractor that regressed to finding
 * nothing from passing.
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILES = [
  'src/renderer/panels/DetailPanel.tsx',
  'src/renderer/domain/session-filter.ts',
] as const;

const COMMENT = /\/\*[\s\S]*?\*\/|\/\/.*$/gm;
const CITATION = /([A-Za-z0-9_./-]*):(\d+)/g;

interface Scan {
  comments: number;
  legalCross: number;
  violations: string[];
}

function scan(path: string, source: string): Scan {
  const file = basename(path);
  const stem = file.replace(/\.[^.]+$/, '');
  const out: Scan = { comments: 0, legalCross: 0, violations: [] };
  for (const c of source.matchAll(COMMENT)) {
    out.comments += 1;
    const startLine = source.slice(0, c.index).split('\n').length;
    for (const m of c[0].matchAll(CITATION)) {
      const prefix = m[1] ?? '';
      const last = prefix.split('/').pop() ?? '';
      const own = prefix === '' || last === file || last === stem;
      if (own) {
        const line = startLine + c[0].slice(0, m.index).split('\n').length - 1;
        out.violations.push(`${path}:${line} ${m[0]}`);
      } else if (/\.[a-z]+$/.test(last)) {
        out.legalCross += 1;
      }
    }
  }
  return out;
}

describe('no comment cites its own file by line number', () => {
  const scans = FILES.map((f) => scan(f, readFileSync(resolve(process.cwd(), f), 'utf8')));

  it('reports zero intra-file line citations', () => {
    expect(scans.flatMap((s) => s.violations)).toEqual([]);
  });

  it('corpus floor: every file yields comments and the sweep sees a legal cross-file citation', () => {
    for (const s of scans) expect(s.comments).toBeGreaterThan(0);
    expect(scans.reduce((n, s) => n + s.legalCross, 0)).toBeGreaterThan(0);
  });

  it('canary: flags own-file citations and spares cross-file ones and plain numbers', () => {
    const p = 'src/renderer/panels/DetailPanel.tsx';
    expect(scan(p, '// see :4553').violations).toHaveLength(1);
    expect(scan(p, '/* DetailPanel.tsx:4553 */').violations).toHaveLength(1);
    for (const ok of [
      '// shared/remote-key.ts:128',
      '// DetailPanel.keystroke-strip.test.tsx:496-521',
      '// width:408px',
      '// 4.5:1',
    ]) {
      expect(scan(p, ok).violations).toEqual([]);
    }
  });
});
