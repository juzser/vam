# Signing a vam build

vam's builds carry no Developer ID and are not notarised, and this is what
changing that would take. It is the shape of the work, not a recipe that has
been run: there is no certificate in this repo to test any of it with.

What the macOS bundle *does* carry is an **ad-hoc signature** under the app's
own identifier, applied by `scripts/adhoc-sign-mac.cjs` as electron-builder's
`afterPack` hook (`codesign --force --deep --sign - --identifier com.vam.app`).
Without it the bundle ships with Electron's linker signature —
`Identifier=Electron`, no sealed resources — and macOS's notification centre,
which identifies an app by its signature rather than its `Info.plist`, has no
identity to grant anything to. Ad-hoc signing is free and needs no account. It
changes nothing about Gatekeeper: the first launch is interrupted exactly as
described below. Whether notifications are then delivered is measured by the
app itself — a refusal lands in the error log, verbatim.

**This is the GitHub-release path, not the App Store one**, and they are
different pieces of work that are easy to confuse. Shipping a `.dmg` from a
GitHub release needs a **Developer ID Application** certificate and
**notarisation** — Apple checks the binary automatically, there is no review,
nobody looks at the app, and it never appears in the store. The App Store is a
different certificate (*Apple Distribution*), a sandbox vam could not run
under anyway (it spawns `tmux` and `claude`), and a human review. None of that
is needed here.

What signing buys, concretely: a notarised download opens on a double click.
An unsigned one makes every person who downloads it right-click → Open, or run
`xattr -cr`, and it is the same binary either way. Nothing about an unsigned
build is untrusted in some deeper sense — it means nobody has paid a
certificate authority yet.

`electron-builder.config.cjs` sets `mac.identity: null` on purpose: left
unset, electron-builder signs with whatever identity happens to be in the
building machine's keychain, so the same commit produces a different artifact
on a different machine. Signing is therefore an explicit, local change rather
than something that happens by accident. The ad-hoc hook runs in `afterPack`,
*before* electron-builder's own signing pass, so a real identity configured
later lands on top of it and wins — nothing needs removing.

## macOS

Two separate things, and only having both stops the warning:

1. **A Developer ID Application certificate** — an Apple Developer Program
   membership (99 USD/year), then *Certificates → Developer ID Application* in
   the developer portal, downloaded into the login keychain. `security
   find-identity -v -p codesigning` should list it.
2. **Notarisation** — Apple must see the signed app before Gatekeeper stops
   warning about it. A signed but un-notarised app still gets stopped.

In the config: drop `identity: null` (or set it to the certificate's common
name), and add `hardenedRuntime: true` with an entitlements file —
notarisation requires the hardened runtime, and an Electron app under it needs
`com.apple.security.cs.allow-jit` and
`com.apple.security.cs.allow-unsigned-executable-memory` for V8, plus
`com.apple.security.inherit` in the *child* entitlements, because vam spawns
`tmux`, `claude` and `gh`. Then `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and
`APPLE_TEAM_ID` in the environment, and `notarize: true` under `mac`;
electron-builder submits and staples the ticket itself.

## Windows

A code-signing certificate from a CA — an OV certificate now ships on a
hardware token, so CI signing means a cloud service (Azure Trusted Signing,
SSL.com eSigner) rather than a file on disk. SmartScreen additionally warms up
by reputation, so the first signed builds may still warn.

## Linux

AppImages have no equivalent step; there is nothing to sign.

## Releases

Installed builds update themselves, and they do it **without an updater
library**. Squirrel.Mac and `electron-updater` both refuse to install a bundle
that is not code-signed, and vam is not, so the update path is written by hand
in `src/main/update/`: check, download, verify, install. It is the reason this
file's threat model, below, is short.

### What a release has to carry

Each CI matrix job builds one platform, then runs `scripts/update-manifest.cjs`
to write a **fragment** next to the installers: `vam-update-darwin.json`,
`vam-update-win32.json` or `vam-update-linux.json`.

```json
{
  "schema": 1,
  "version": "1.4.0",
  "platform": "darwin",
  "files": [
    { "name": "vam-1.4.0-mac-arm64.zip", "arch": "arm64", "kind": "mac-zip",
      "size": 123456789, "sha512": "<base64 of the SHA-512, 88 chars>" }
  ]
}
```

`kind` is `mac-zip`, `nsis` or `appimage`; `arch` is `arm64` or `x64`. The
fragment **names files, it never supplies a URL**: the client looks each `name`
up in the release's own asset list, so a tampered fragment cannot aim a
download somewhere else. The artifact names are a contract with
`electron-builder.config.cjs` (an explicit `artifactName` per target):

| Platform | Updatable file                          | Also shipped (not used by the updater) |
| -------- | --------------------------------------- | -------------------------------------- |
| macOS    | `vam-<v>-mac-arm64.zip`, `…-mac-x64.zip` | `vam-<v>-mac-<arch>.dmg`               |
| Windows  | `vam-<v>-win-x64-setup.exe`             | `vam-<v>-win-x64.zip`                  |
| Linux    | `vam-<v>-linux-x86_64.AppImage`         |                                        |

The manifest script fails the CI job when a required file is missing (both mac
zips, the NSIS installer, the AppImage). An AppImage's x64 arch is spelled
`x86_64` in the file name and `x64` in the fragment.

### Draft, then publish

`.github/workflows/release.yml` creates the release as a **draft** and each
platform uploads into it, so a release fills in over several minutes. Nothing is
offered until a person publishes it. The client asks `releases/latest`, which
GitHub answers only for the newest **published, non-prerelease** release; a
draft, a prerelease, or a tag with a prerelease suffix is never offered. A
`404` means "no releases yet" and is quiet.

Publishing before every job has finished is safe, and that is what
**`incomplete`** is for. If the release lacks this platform's fragment, the
fragment names a file that is not attached (or attached with a different
size), or this architecture has no file, the check reports `incomplete`. That
is not an error: nothing is shown as failed, and the next check tries again.
Settings → Update says the release is still being published.

### What an install does

The Update button downloads the file for this OS and architecture into
`<userData>/updates/`, verifies its size and SHA-512 against the fragment, and
then installs when vam quits (a normal `app.quit()`, so the unsaved-edits guard
still gets its say; cancelling it keeps the verified download for the next
press).

- **macOS.** The zip is extracted with `ditto` (it keeps symlinks, modes and
  xattrs, which `unzip` does not) into a staging directory. A detached
  `/bin/sh` script waits for vam's pid to exit, moves the old `.app` aside to a
  backup, moves the new one in, clears quarantine with `xattr -cr`, deletes the
  backup and relaunches. If either move fails the script **rolls back**: it
  restores the backup and relaunches the old app. Its output goes to
  `<userData>/updates/install.log`, the one file kept when the updates
  directory is cleaned at each startup.
- **Linux.** Only an AppImage launch (`$APPIMAGE` set) is updatable. The new
  file is copied beside the old one, made executable, and renamed over it; the
  running process keeps the old inode until it exits. The directory must be
  writable.
- **Windows.** The NSIS installer is run as `setup.exe /S --updated
  --force-run`: silent, reusing the existing install directory, and starting
  vam again afterwards. Installed per machine, Windows may still raise a UAC
  prompt, and `--force-run` has not been exercised against a real install.

An install that cannot be updated in place (a `.deb`, an unpacked build, a
non-AppImage Linux launch) still learns a newer version exists, but Update
answers "This install of vam cannot update itself"; the Release notes link
(opened in your own browser) is the way to a manual download.

### Keep vam in /Applications (macOS)

The swap renames the bundle inside its parent folder, so that folder must be
writable, and the app must be running from where it lives. vam refuses, before
downloading anything, when it runs **translocated** (a quarantined app opened
from Downloads runs from a randomised read-only mount, so replacing that path
replaces nothing you launch), from a **read-only** volume such as the disk
image, or from a folder it cannot write to. The message is "Move vam to
/Applications and try again". Any folder you own works; `/Applications` is the
one to use.

### Allowed download hosts

Every URL the updater touches, and every redirect hop, must be `https`, carry no
credentials or port, and have one of these exact hosts: `github.com`,
`api.github.com`, `objects.githubusercontent.com`,
`release-assets.githubusercontent.com`, `github-releases.githubusercontent.com`.
Anything else is refused. Downloads are capped at 600 MB whatever the fragment
claims.

### When it checks

Only a **packaged** build checks on its own: 5 seconds after the first window is
shown, then every 24 hours, and when the machine wakes from sleep if a check is
due (never more often than hourly). The last attempt is persisted, so a
restart does not re-check early. The check is one unauthenticated GET, with no
token, query string or cookie; the fragment is fetched only when the release is
newer.

*Settings → Update* has the **automatically check for updates** switch, which
turns the scheduled checks off, and a button to check now. **Check for
Updates…** in the app menu (macOS) or the Help menu (elsewhere) does the same
from anywhere. A manual check works whether or not the switch is on.

### Threat model

The SHA-512 in the fragment comes from the same release as the installer. It
protects the bytes **in transit and on disk**: a truncated, corrupted or
swapped download is rejected. It does **not** protect against a compromised
GitHub account or release, which could replace the fragment and the installer
together. That is the same trust an unsigned download already asks for, and it
is exactly the gap a Developer ID (macOS) or code-signing certificate
(Windows) would close: with one, the OS would check a signature that the
release page cannot forge.
