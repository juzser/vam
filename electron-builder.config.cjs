/**
 * electron-builder configuration.
 *
 * All paths here are repo-relative. Do not add absolute home paths,
 * usernames, or hostnames — this config ships in a public repo and
 * produces a binary that must build reproducibly on any machine.
 */
module.exports = {
  appId: 'com.vam.app',
  productName: 'vam',
  directories: {
    output: 'dist-app',
    buildResources: 'build',
  },
  // `out` is the desktop app itself (main, preload, renderer). `dist-web` is
  // the page a paired phone loads, and it is NOT optional: the remote server
  // resolves it as `join(app.getAppPath(), 'dist-web')`, so leaving it out
  // does not disable pairing -- it ships a build whose every remote request
  // answers 404. It is built by a separate script, so `dist` runs both.
  // `node_modules` is excluded because NOTHING LOADS IT. electron-vite bundles
  // all three targets: the renderer's dependencies are inside
  // out/renderer/assets (emoji-picker-react is the EmojiGrid chunk), the
  // preload's only require is `electron`, and main's requires are `electron`
  // plus node: builtins -- audited, not assumed, including the one dynamic
  // import, which resolves to `node:fs/promises`. electron-builder ships
  // production dependencies by default, which here meant 66 MB of dead weight:
  // the asar was 69 MB against 2.4 MB of actual application code.
  //
  // If a future main-process import is ever externalised rather than bundled,
  // this line is what will break it -- and it will break at runtime in a
  // packaged build, not in `pnpm run dev:app`. Re-audit the requires in
  // out/main/index.cjs before adding a main-process dependency.
  //
  // `resources/skills/**/*` IS THE ADHD SKILL'S PINNED, BUNDLED COPY -- a
  // `SKILL.md` and a `LICENSE`, verbatim from `ayghri/i-have-adhd` at the
  // commit `src/shared/adhd-skill.ts` pins, plus a `NOTICE.md` this repo
  // wrote for provenance. Read at runtime by
  // `src/main/skills/adhd-skill.ts` via `app.getAppPath()` -- the SAME call
  // `webRoot` above makes for `dist-web`, which is why this glob is
  // repo-root-relative rather than routed through electron-vite: neither
  // `dist-web` nor this directory is TypeScript for electron-vite to bundle,
  // both are static files this app ships and reads back. Packed straight
  // into the asar rather than as an unpacked `extraResources` entry: main
  // only ever `readFile`s these two files as plain text, never executes or
  // spawns them, and asar's read-only patch on `fs` handles that
  // transparently -- see `test/main/electron-builder.adhd-skill.test.ts` for
  // the static assertion this glob is present, and the PR's own gate run for
  // the built app actually listing it (`npx asar list ... | grep skills`).
  files: ['out/**/*', 'dist-web/**/*', 'resources/skills/**/*', 'package.json', '!node_modules/**/*'],
  asar: true,
  npmRebuild: false,
  // Icons come from `buildResources` (build/icon.png), which electron-builder
  // converts per platform.
  //
  // ARTIFACT NAMES ARE A CONTRACT, so each target states its own. The
  // self-updater's CI step (`scripts/update-manifest.cjs`) classifies files by
  // name -- os, arch, and (for Windows) installer vs zip -- and the release
  // notes point users at the same names. electron-builder's defaults do not
  // hold that line: some contain spaces, and the arch is dropped for the
  // default architecture. It drops it ONLY when the pattern is not
  // user-specified (`platformPackager.expandArtifactNamePattern`:
  // `isUserForced`), so an explicit pattern is also what keeps `${arch}` in
  // every name.
  //
  // Lookup order there is target options -> platform options -> top level, so
  // `mac.artifactName` covers dmg and zip; `nsis.artifactName` must be set
  // separately or the NSIS installer would inherit `win.artifactName` and be
  // indistinguishable from the zip. `${arch}` is the builder's own spelling per
  // extension: `x64` almost everywhere, but `x86_64` for an AppImage
  // (`builder-util/out/arch.js`), which the script maps back.
  //
  // There is deliberately NO `publish` block: the updater reads GitHub
  // Releases itself and CI uploads the files; electron-builder must not try.
  linux: {
    target: ['AppImage'],
    category: 'Development',
    artifactName: '${productName}-${version}-linux-${arch}.${ext}',
  },
  mac: {
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    category: 'public.app-category.developer-tools',
    artifactName: '${productName}-${version}-mac-${arch}.${ext}',
    // No certificate. Left unset, electron-builder signs with whatever
    // identity happens to be in the building machine's keychain, so the same
    // commit produces a different artifact on a different machine. There is
    // no project certificate; saying so here is honest and reproducible.
    // Gatekeeper consequences are documented in the release notes.
    //
    // NOT "unsigned", though: `afterPack` below gives the bundle a real
    // AD-HOC signature under its own identifier, which is what lets macOS
    // tell it apart from every other Electron app (notifications need that).
    // Still not notarised, so the first launch is still interrupted.
    identity: null,
  },
  // Ad-hoc signs the macOS bundle; a no-op on every other platform. HERE and
  // not `afterSign`: this runs BEFORE electron-builder's own signing pass, so
  // a real identity configured later still lands on top of it. See the script.
  afterPack: require('./scripts/adhoc-sign-mac.cjs').afterPack,
  win: {
    target: ['nsis', 'zip'],
    // Applies to the zip (nsis has its own below).
    artifactName: '${productName}-${version}-win-${arch}.${ext}',
  },
  nsis: {
    artifactName: '${productName}-${version}-win-${arch}-setup.${ext}',
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
};
