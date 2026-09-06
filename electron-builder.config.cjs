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
  files: ['out/**/*', 'dist-web/**/*', 'package.json', '!node_modules/**/*'],
  asar: true,
  npmRebuild: false,
  // Icons come from `buildResources` (build/icon.png), which electron-builder
  // converts per platform.
  linux: {
    target: ['AppImage'],
    category: 'Development',
  },
  mac: {
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    category: 'public.app-category.developer-tools',
    // Explicitly unsigned. Left unset, electron-builder signs with whatever
    // identity happens to be in the building machine's keychain, so the same
    // commit produces a different artifact on a different machine. There is
    // no project certificate; saying so here is honest and reproducible.
    // Gatekeeper consequences are documented in the release notes.
    identity: null,
  },
  win: {
    target: ['nsis', 'zip'],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
};
