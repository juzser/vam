/**
 * THE ONE CHECK THAT MATTERS FOR A QR CODE: can a decoder read it?
 *
 * `test/settings/qr.test.ts` holds the structure -- finder patterns, timing
 * runs, the capacity table, the dark module. All of it can pass on a symbol
 * that scans as nothing: a format field whose BCH is wrong, a mask applied but
 * not declared, an interleave in the wrong order and a capacity table off by
 * one all produce a matrix that LOOKS exactly like a QR code.
 *
 * So this renders the encoder's own output to a PNG and hands it to macOS's
 * Vision barcode detector (`e2e/qr-decode.swift`) -- the same class of decoder
 * a phone camera runs -- and asserts the payload comes back byte for byte.
 *
 * NOT IN `run-web-guards.mjs`, and not in CI: it needs `swift` and the Vision
 * framework, which exist on macOS and nowhere else, and the compile alone
 * takes the best part of twenty seconds. It is the check to run after touching
 * `src/renderer/settings/qr.ts`, and it says so in that file's header.
 *
 *   node e2e/qr-decode-check.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { encodeQr, QR_MAX_BYTES } from '../src/renderer/settings/qr.ts';

const outDir = process.argv[2] ?? 'e2e/test-results/qr';
mkdirSync(outDir, { recursive: true });

/** CRC-32, for the PNG chunks. */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

/**
 * An 8-bit greyscale PNG of the symbol.
 *
 * `scale` and the four-module quiet zone are not decoration: ISO 18004 asks
 * for the quiet zone, and a detector handed a symbol flush to the image edge
 * is the classic "my QR does not scan" report. 8px a module is roughly what a
 * 200px symbol on a laptop screen gives a phone at arm's length.
 */
function png(symbol, scale = 8, quiet = 4) {
  const side = (symbol.size + quiet * 2) * scale;
  const raw = Buffer.alloc((side + 1) * side, 0xff);
  for (let y = 0; y < side; y += 1) raw[y * (side + 1)] = 0; // filter: none
  for (let y = 0; y < symbol.size; y += 1) {
    for (let x = 0; x < symbol.size; x += 1) {
      if (!symbol.modules[y][x]) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        const row = (y + quiet) * scale + dy;
        const start = row * (side + 1) + 1 + (x + quiet) * scale;
        raw.fill(0x00, start, start + scale);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The payloads, each one a case that would fail differently.
 *
 * The long one is the point of the ceiling: `https://` + a 63-character
 * machine name (the RFC cap) + a tailnet, which is the worst address Tailscale
 * can hand this panel.
 */
const LONGEST_MACHINE = 'a'.repeat(63);
const cases = [
  ['typical', 'https://ser-mac.tail1e1526.ts.net'],
  ['short', 'https://a.b.ts.net'],
  ['longest-address', `https://${LONGEST_MACHINE}.tailnet-name-of-plausible-size.ts.net`],
  ['at-the-ceiling', `https://${'x'.repeat(QR_MAX_BYTES - 8)}`],
];

/**
 * TWO SIZES, and the second one is the one that ships.
 *
 * 8px a module is a comfortable render. `QrAddress` draws into a 148px box,
 * and at the largest symbol this encoder makes -- 45 modules plus the 8 of
 * quiet zone -- that is THREE pixels a module. A symbol that decodes at 8 and
 * not at 3 would scan on this machine's own screenshots and not on the panel
 * the operator is looking at, which is the whole point of the feature.
 */
const SCALES = [
  { suffix: '', scale: 8 },
  { suffix: '-as-drawn', scale: 3 },
];

const files = [];
for (const [name, payload] of cases) {
  const symbol = encodeQr(payload);
  if (symbol === null) throw new Error(`${name}: the encoder refused ${payload.length} bytes`);
  console.log(`  ${name}: ${payload.length} bytes -> ${symbol.size}x${symbol.size} modules`);
  for (const { suffix, scale } of SCALES) {
    const path = `${outDir}/${name}${suffix}.png`;
    writeFileSync(path, png(symbol, scale));
    files.push({ name: `${name}${suffix}`, payload, path, size: symbol.size });
  }
}

let decoded;
try {
  decoded = execFileSync('swift', ['e2e/qr-decode.swift', ...files.map((f) => f.path)], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
} catch (error) {
  // A non-zero exit is a decode failure, and its stdout is the report.
  decoded = error.stdout ?? '';
  if (decoded === '') {
    console.error('swift could not run -- this check needs macOS and the Vision framework.');
    console.error(String(error.message ?? error));
    process.exit(2);
  }
}

const read = new Map(
  decoded
    .split('\n')
    .filter((line) => line.includes('\t'))
    .map((line) => {
      const [path, ...rest] = line.split('\t');
      return [path, rest.join('\t')];
    }),
);

let failed = 0;
for (const file of files) {
  const got = read.get(file.path);
  if (got === file.payload) {
    console.log(`  ok  ${file.name}: Vision read it back byte for byte`);
    continue;
  }
  failed += 1;
  console.error(`FAIL  ${file.name}: expected ${JSON.stringify(file.payload)}`);
  console.error(`      Vision said ${JSON.stringify(got ?? '(nothing)')}`);
}

if (failed > 0) {
  console.error(`\n${failed} of ${files.length} symbols did not decode.`);
  process.exit(1);
}
console.log(`\nqr-decode: all ${files.length} symbols decoded. PNGs in ${outDir}.`);
