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

The update check is already pointed at GitHub releases
(`src/main/update/check.ts` asks `/repos/juzser/vam/releases/latest`, once, at
launch, with Settings → Update as the way to ask again). That endpoint answers
404 today, which is not an error: it is "no releases have been published yet",
and the section says exactly that. Cutting the first release is what turns it
on — vam downloads nothing either way, it opens the release page in your own
browser.
