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
  files: ['out/**/*', 'dist-web/**/*', 'package.json'],
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
