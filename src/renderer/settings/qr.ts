/**
 * A QR encoder, cut to exactly one job: a short https URL on the pairing panel.
 *
 * Operator: "put a QR on the desktop so the remote link opens straight from
 * the phone." The address is a MagicDNS name -- 30 to 90 characters that
 * nobody wants to retype on a phone keyboard, where a typo reads as "vam is
 * broken" rather than as a typo.
 *
 * ── WHY THIS IS WRITTEN AND NOT INSTALLED ─────────────────────────────────
 * There is no QR encoder in this tree, and `node_modules` here is a store
 * shared with other checkouts of this repo -- an install is a known way to
 * prune the Electron binary out from under one of them. Beyond that, it is the
 * argument `i18n/strings.ts` already makes about `i18next`: `qrcode` carries
 * canvas and PNG renderers, logo compositing, a CLI and eight symbologies, for
 * ONE payload drawn on ONE panel.
 *
 * ── THE CUTS, EACH WITH ITS REASON ────────────────────────────────────────
 *  - BYTE MODE ONLY. A URL is not alphanumeric-mode material (lower case and
 *    `/` are outside that charset), so the other three modes would be dead
 *    code the day they were written.
 *  - LEVEL M ONLY. ~15% recovery, the level every QR generator defaults to.
 *    L would buy a smaller symbol on a screen that has room; Q and H buy
 *    recovery from damage a screen cannot suffer.
 *  - VERSIONS 1 TO 7, ending at 122 bytes. The ceiling was 6 (106 bytes)
 *    until the decode check was written and the worst case was actually
 *    counted: `https://` + a machine name (the RFC caps it at 63) + `.` + a
 *    tailnet name comes to 109 bytes with a 30-character tailnet, and
 *    Tailscale's older MagicDNS suffixes are longer than that again. Version
 *    7 is where a symbol starts carrying its own 18-bit version block, so
 *    that block is here; version 8 is where the data blocks stop being equal
 *    sized, and THAT is the line this stops at. Over the ceiling `encodeQr`
 *    returns `null` and the panel keeps the address as text.
 *
 * Everything here is ISO/IEC 18004. The parts that are tables -- capacities,
 * block counts, alignment centres -- are the standard's, and
 * `test/settings/qr.test.ts` checks them against the published byte
 * capacities, which is where a typo in one of them shows up. What no unit
 * test can prove is that a CAMERA reads the result: `e2e/qr-decode-check.mjs`
 * hands the rendered symbol to macOS's own Vision barcode detector for that.
 */

/** The most a version-7 symbol at level M can carry, in bytes. */
export const QR_MAX_BYTES = 122;

export type QrSymbol = {
  /** Modules per side, `4 * version + 17`. */
  readonly size: number;
  /** `modules[y][x]`, true where the module is dark. No quiet zone. */
  readonly modules: readonly (readonly boolean[])[];
};

/**
 * Versions 1-7 at level M.
 *
 * `total` is every codeword in the symbol, `ecPerBlock` the error-correction
 * codewords each block carries, `blocks` how many the data is split into. Data
 * capacity is `total - ecPerBlock * blocks`, derived rather than written out
 * so the two cannot disagree.
 */
const VERSIONS: readonly {
  readonly total: number;
  readonly ecPerBlock: number;
  readonly blocks: number;
}[] = [
  { total: 26, ecPerBlock: 10, blocks: 1 },
  { total: 44, ecPerBlock: 16, blocks: 1 },
  { total: 70, ecPerBlock: 26, blocks: 1 },
  { total: 100, ecPerBlock: 18, blocks: 2 },
  { total: 134, ecPerBlock: 24, blocks: 2 },
  { total: 172, ecPerBlock: 16, blocks: 4 },
  { total: 196, ecPerBlock: 18, blocks: 4 },
];

/**
 * Alignment-pattern centres per version. Version 1 has none; 2-6 have one
 * extra pattern, at the coordinate paired with itself.
 */
const ALIGNMENT: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
];

/** Bits of padding after the last codeword, per version (ISO table 1). */
const REMAINDER_BITS: readonly number[] = [0, 7, 7, 7, 7, 7, 0];

// ── GF(256), the field Reed-Solomon works in ────────────────────────────────
// Built once, from the primitive polynomial the standard names (0x11d).
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255] ?? 0;
}

const mul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : (EXP[((LOG[a] ?? 0) + (LOG[b] ?? 0)) % 255] ?? 0);

/** The generator polynomial for `degree` error-correction codewords. */
function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j] ?? 0) ^ mul(poly[j] ?? 0, 1);
      next[j + 1] = (next[j + 1] ?? 0) ^ mul(poly[j] ?? 0, EXP[i] ?? 0);
    }
    poly = next;
  }
  return poly;
}

/** The remainder of `data` divided by the generator -- the EC codewords. */
function remainder(data: readonly number[], degree: number): number[] {
  const gen = generator(degree);
  const out = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (out.shift() ?? 0);
    out.push(0);
    for (let i = 0; i < degree; i += 1) {
      out[i] = (out[i] ?? 0) ^ mul(gen[i + 1] ?? 0, factor);
    }
  }
  return out;
}

// ── The bitstream ───────────────────────────────────────────────────────────

class Bits {
  readonly bits: number[] = [];
  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }
}

/**
 * The data codewords for `bytes` at `version`: mode, length, payload,
 * terminator, and the two alternating pad bytes the standard names.
 */
function codewords(bytes: Uint8Array, version: number): number[] {
  const spec = VERSIONS[version - 1];
  if (spec === undefined) throw new Error(`no such version: ${version}`);
  const capacity = spec.total - spec.ecPerBlock * spec.blocks;
  const bits = new Bits();
  bits.push(0b0100, 4); // byte mode
  bits.push(bytes.length, 8); // versions 1-9 count length in 8 bits
  for (const byte of bytes) bits.push(byte, 8);
  // The terminator is up to four zeroes, and only as many as fit.
  const room = capacity * 8 - bits.bits.length;
  bits.push(0, Math.min(4, room));
  while (bits.bits.length % 8 !== 0) bits.bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (bits.bits[i + j] ?? 0);
    out.push(byte);
  }
  // 0xEC / 0x11, alternating, until the block is full.
  for (let i = 0; out.length < capacity; i += 1) out.push(i % 2 === 0 ? 0xec : 0x11);
  return out;
}

/**
 * Split into blocks, error-correct each, and interleave -- the order a
 * decoder reads them back in. With equal-sized blocks (every version here has
 * them) the interleave is a plain column walk.
 */
function interleave(data: readonly number[], version: number): number[] {
  const spec = VERSIONS[version - 1];
  if (spec === undefined) throw new Error(`no such version: ${version}`);
  const per = data.length / spec.blocks;
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  for (let i = 0; i < spec.blocks; i += 1) {
    const block = data.slice(i * per, (i + 1) * per);
    blocks.push(block);
    ecBlocks.push(remainder(block, spec.ecPerBlock));
  }
  const out: number[] = [];
  for (let i = 0; i < per; i += 1) for (const block of blocks) out.push(block[i] ?? 0);
  for (let i = 0; i < spec.ecPerBlock; i += 1)
    for (const block of ecBlocks) out.push(block[i] ?? 0);
  return out;
}

// ── The matrix ──────────────────────────────────────────────────────────────

type Grid = {
  readonly modules: boolean[][];
  readonly reserved: boolean[][];
  readonly size: number;
};

function blank(size: number): Grid {
  return {
    size,
    modules: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
}

function put(grid: Grid, y: number, x: number, dark: boolean, reserve = true): void {
  const row = grid.modules[y];
  const res = grid.reserved[y];
  if (row === undefined || res === undefined) return;
  row[x] = dark;
  if (reserve) res[x] = true;
}

/** Finder, separator, timing, alignment, the dark module and the format area. */
function drawFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.size;
  for (const [oy, ox] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const yy = oy + y;
        const xx = ox + x;
        if (yy < 0 || yy >= size || xx < 0 || xx >= size) continue;
        const inside = y >= 0 && y <= 6 && x >= 0 && x <= 6;
        const ring = y === 0 || y === 6 || x === 0 || x === 6;
        const core = y >= 2 && y <= 4 && x >= 2 && x <= 4;
        put(grid, yy, xx, inside && (ring || core));
      }
    }
  }
  for (let i = 8; i < size - 8; i += 1) {
    put(grid, 6, i, i % 2 === 0);
    put(grid, i, 6, i % 2 === 0);
  }
  const centres = ALIGNMENT[version - 1] ?? [];
  for (const cy of centres) {
    for (const cx of centres) {
      // Not over a finder: the three corners already own those cells.
      if (
        (cy === 6 && cx === 6) ||
        (cy === 6 && cx === size - 7) ||
        (cy === size - 7 && cx === 6)
      ) {
        continue;
      }
      for (let y = -2; y <= 2; y += 1) {
        for (let x = -2; x <= 2; x += 1) {
          const edge = Math.max(Math.abs(y), Math.abs(x));
          put(grid, cy + y, cx + x, edge !== 1);
        }
      }
    }
  }
  // The dark module, and the format area around it -- reserved now, written
  // once the mask is chosen.
  put(grid, size - 8, 8, true);
  writeVersion(grid, version);
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      put(grid, 8, i, false);
      put(grid, i, 8, false);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    put(grid, 8, size - 1 - i, false);
    if (size - 1 - i !== size - 8) put(grid, size - 1 - i, 8, false);
  }
}

/** The zig-zag: two-module columns, right to left, alternating direction. */
function placeData(grid: Grid, bytes: readonly number[], remainderBits: number): void {
  const size = grid.size;
  const stream: number[] = [];
  for (const byte of bytes) for (let i = 7; i >= 0; i -= 1) stream.push((byte >>> i) & 1);
  for (let i = 0; i < remainderBits; i += 1) stream.push(0);
  let at = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    // THE TIMING COLUMN IS SKIPPED, NOT PAIRED THROUGH. Column 6 is the
    // vertical timing pattern, and the walk steps OVER it: past it the pairs
    // are (5,4), (3,2), (1,0), not (5,4) after a stray (7,6). Written the
    // second way the reserved check still skipped every timing cell, so the
    // matrix looked perfect and every structural test passed -- and nothing
    // decoded it, because from column 8 leftwards every bit was one column
    // out. `e2e/qr-decode-check.mjs` is what caught it.
    const col = right <= 6 ? right - 1 : right;
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step;
      for (const x of [col, col - 1]) {
        if (grid.reserved[y]?.[x]) continue;
        put(grid, y, x, (stream[at] ?? 0) === 1, false);
        at += 1;
      }
    }
    upward = !upward;
  }
}

const MASKS: readonly ((y: number, x: number) => boolean)[] = [
  (y, x) => (y + x) % 2 === 0,
  (y) => y % 2 === 0,
  (_y, x) => x % 3 === 0,
  (y, x) => (y + x) % 3 === 0,
  (y, x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (y, x) => ((y * x) % 2) + ((y * x) % 3) === 0,
  (y, x) => (((y * x) % 2) + ((y * x) % 3)) % 2 === 0,
  (y, x) => (((y + x) % 2) + ((y * x) % 3)) % 2 === 0,
];

/** ISO 18004's four penalty rules, summed. Lower is better. */
function penalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  let score = 0;
  // Rule 1: runs of five or more.
  for (const line of [
    ...modules,
    ...modules.map((_, x) => modules.map((row) => row[x] ?? false)),
  ]) {
    let run = 1;
    for (let i = 1; i < size; i += 1) {
      if (line[i] === line[i - 1]) {
        run += 1;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else {
        run = 1;
      }
    }
  }
  // Rule 2: 2x2 blocks of one colour.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const a = modules[y]?.[x];
      if (a === modules[y]?.[x + 1] && a === modules[y + 1]?.[x] && a === modules[y + 1]?.[x + 1]) {
        score += 3;
      }
    }
  }
  // Rule 3: the finder-like 1:1:3:1:1 run, with four light modules either side.
  const pattern = [true, false, true, true, true, false, true];
  const light = [false, false, false, false];
  const hasAt = (line: readonly boolean[], i: number, seq: readonly boolean[]): boolean =>
    seq.every((v, j) => line[i + j] === v);
  for (const line of [
    ...modules,
    ...modules.map((_, x) => modules.map((row) => row[x] ?? false)),
  ]) {
    for (let i = 0; i < size; i += 1) {
      if (hasAt(line, i, pattern) && (hasAt(line, i + 7, light) || hasAt(line, i - 4, light))) {
        score += 40;
      }
    }
  }
  // Rule 4: how far the dark proportion strays from half.
  const dark = modules.reduce((n, row) => n + row.filter(Boolean).length, 0);
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/** The 15-bit format code: level M, the mask, BCH(15,5), XOR 0x5412. */
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // 00 is level M
  let rem = data;
  for (let i = 0; i < 10; i += 1) {
    rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

/**
 * The 18-bit version block: 6 bits of version, 12 of BCH(18,6).
 *
 * Versions 7 and up carry it, twice -- a 3x6 block above the bottom-left
 * finder and its transpose left of the top-right one. A decoder can infer the
 * version from the symbol's size, but the standard says to write it and the
 * detectors that read it are the ones that would otherwise mis-size a
 * photograph taken at an angle.
 */
function writeVersion(grid: Grid, version: number): void {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  const size = grid.size;
  for (let i = 0; i < 18; i += 1) {
    const bit = ((bits >>> i) & 1) === 1;
    const a = Math.floor(i / 3);
    const b = size - 11 + (i % 3);
    put(grid, b, a, bit);
    put(grid, a, b, bit);
  }
}

function writeFormat(grid: Grid, mask: number): void {
  const bits = formatBits(mask);
  const size = grid.size;
  for (let i = 0; i < 15; i += 1) {
    // MOST SIGNIFICANT BIT FIRST. The cell beside the top-left finder takes
    // bit 14, not bit 0 -- written the other way round the symbol is perfect
    // everywhere a structural test looks and decodes as nothing, because the
    // format field is the first thing a reader parses. Settled against the
    // matrix macOS's own `CIQRCodeGenerator` produces for the same payload:
    // 605 of 625 modules already agreed, and all 20 that did not were format
    // cells.
    const bit = ((bits >>> (14 - i)) & 1) === 1;
    // The copy beside the top-left finder.
    if (i < 6) put(grid, 8, i, bit);
    else if (i === 6) put(grid, 8, 7, bit);
    else if (i === 7) put(grid, 8, 8, bit);
    else if (i === 8) put(grid, 7, 8, bit);
    else put(grid, 14 - i, 8, bit);
    // And the split copy along the other two: seven bits up the bottom-left,
    // then eight along the top-right. SEVEN, not eight -- the eighth cell up
    // that column is the dark module, the one fixed black cell in every
    // symbol, and a format bit written over it makes the symbol unreadable
    // about a third of the time (whenever that bit is 0).
    if (i < 7) put(grid, size - 1 - i, 8, bit);
    else put(grid, 8, size - 15 + i, bit);
  }
}

/**
 * The symbol for `text`, or `null` when it does not fit versions 1-6 at level
 * M -- which is the only refusal this returns, and the panel's cue to keep the
 * address as text rather than draw something that will not scan.
 */
export function encodeQr(text: string): QrSymbol | null {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0 || bytes.length > QR_MAX_BYTES) return null;
  const version = VERSIONS.findIndex(
    (spec) => spec.total - spec.ecPerBlock * spec.blocks - 2 >= bytes.length,
  );
  if (version < 0) return null;
  const v = version + 1;
  const size = 4 * v + 17;
  const stream = interleave(codewords(bytes, v), v);

  let best: { readonly modules: boolean[][]; readonly score: number } | null = null;
  for (let mask = 0; mask < MASKS.length; mask += 1) {
    const grid = blank(size);
    drawFunctionPatterns(grid, v);
    placeData(grid, stream, REMAINDER_BITS[version] ?? 0);
    const apply = MASKS[mask];
    if (apply === undefined) continue;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (grid.reserved[y]?.[x]) continue;
        if (apply(y, x)) put(grid, y, x, !(grid.modules[y]?.[x] ?? false), false);
      }
    }
    writeFormat(grid, mask);
    const score = penalty(grid.modules);
    if (best === null || score < best.score) best = { modules: grid.modules, score };
  }
  return best === null ? null : { size, modules: best.modules };
}
