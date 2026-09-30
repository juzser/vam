/**
 * Writes the per-platform UPDATE FRAGMENT a release ships next to its
 * installers: `dist-app/vam-update-<platform>.json`.
 *
 * WHY A FRAGMENT AND NOT electron-builder's `latest*.yml`. The self-updater
 * (`src/main/update/`) is written by hand, with no updater dependency, because
 * the app is not code-signed and Squirrel-based updaters refuse to install an
 * unsigned bundle. It needs three facts per file -- name, size, SHA-512 -- and
 * a format it can validate with a hand-written parser
 * (`src/shared/update-manifest.ts`). Each CI matrix job builds only its own
 * platform, so each writes only its own fragment; the release ends up holding
 * `vam-update-darwin.json`, `-win32.json` and `-linux.json`.
 *
 * THE FRAGMENT NAMES FILES, IT NEVER SUPPLIES A URL. The client looks each
 * `name` up in the release's own asset list, so a tampered fragment cannot aim
 * a download anywhere else. The digest protects the bytes in transit; it does
 * not protect against a compromised GitHub account, which could replace the
 * fragment and the installer together (`docs/signing.md`).
 *
 * FILES ARE CLASSIFIED BY NAME, and the names are a contract with
 * `electron-builder.config.cjs`, which sets an explicit `artifactName` per
 * target so the arch is always present. One spelling is not ours: for an
 * AppImage electron-builder writes the x64 arch as `x86_64`
 * (`builder-util/out/arch.js`, `getArtifactArchName`), so that is what the
 * AppImage pattern accepts and it maps back to the manifest's `x64`. dmg,
 * blockmaps and the win zip are not updatable and are ignored.
 *
 * A REQUIRED FILE MISSING FAILS THE JOB. A release without its fragment makes
 * every installed build report "incomplete" and quietly never update, so the
 * build says so loudly instead: mac needs both arm64 and x64 zips, Windows the
 * NSIS installer, Linux the AppImage.
 */

const { createHash } = require('node:crypto');
const { readdirSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const SCHEMA = 1;
const PLATFORMS = ['darwin', 'win32', 'linux'];

/** Regex over the file name -> kind. Group 1 is the arch as electron-builder spells it. */
const PATTERNS = [
  { re: /^vam-.+-mac-(arm64|x64)\.zip$/, kind: 'mac-zip' },
  { re: /^vam-.+-win-(arm64|x64)-setup\.exe$/, kind: 'nsis' },
  { re: /^vam-.+-linux-(arm64|x86_64)\.AppImage$/, kind: 'appimage' },
];

/** What each platform must ship, as `kind:arch`; anything less fails the build. */
const REQUIRED = {
  darwin: ['mac-zip:arm64', 'mac-zip:x64'],
  win32: ['nsis:x64'],
  linux: ['appimage:x64'],
};

/** @returns {{arch: 'arm64'|'x64', kind: string} | null} null = not an updatable file. */
function classify(fileName) {
  for (const { re, kind } of PATTERNS) {
    const m = re.exec(fileName);
    if (m) return { arch: m[1] === 'x86_64' ? 'x64' : m[1], kind };
  }
  return null;
}

/** Base64 of the SHA-512 digest -- the same encoding electron-builder uses. */
function sha512Base64(data) {
  return createHash('sha512').update(data).digest('base64');
}

function buildManifest({ version, platform, files }) {
  return { schema: SCHEMA, version, platform, files };
}

/**
 * Generate and write the fragment for `platform` from the installers in
 * `distDir`. `version` defaults to package.json's, which is what
 * electron-builder put in the file names. Returns the path written; throws
 * (and so fails the CI step) when a required asset is missing.
 */
function main(distDir, platform, opts = {}) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`unknown platform "${platform}" (expected ${PLATFORMS.join('|')})`);
  }
  const version =
    opts.version ?? JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version;
  // Only this version's files: a stale artifact from an earlier build in the
  // same directory must not end up in the fragment.
  const marker = `-${version}-`;
  const files = [];
  for (const name of readdirSync(distDir).sort()) {
    const cls = name.includes(marker) ? classify(name) : null;
    if (cls === null) continue;
    const path = join(distDir, name);
    if (!statSync(path).isFile()) continue;
    const bytes = readFileSync(path);
    files.push({ name, arch: cls.arch, kind: cls.kind, size: bytes.length, sha512: sha512Base64(bytes) });
  }
  const have = new Set(files.map((f) => `${f.kind}:${f.arch}`));
  const missing = REQUIRED[platform].filter((r) => !have.has(r));
  if (missing.length > 0) {
    throw new Error(
      `missing required update assets for ${platform} ${version} in ${distDir}: ${missing.join(', ')}`,
    );
  }
  const out = join(distDir, `vam-update-${platform}.json`);
  writeFileSync(out, `${JSON.stringify(buildManifest({ version, platform, files }), null, 2)}\n`);
  return out;
}

if (require.main === module) {
  const [distDir, platform] = process.argv.slice(2);
  try {
    console.log(`wrote ${main(distDir, platform)}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

module.exports = { classify, sha512Base64, buildManifest, main };
