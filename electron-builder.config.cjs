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
  files: ['out/**/*', 'package.json'],
  asar: true,
  npmRebuild: false,
  linux: {
    target: 'dir',
  },
  mac: {
    target: 'dir',
  },
  win: {
    target: 'dir',
  },
};
