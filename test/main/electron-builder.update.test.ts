/**
 * THE ARTIFACT NAMES THE SELF-UPDATER DEPENDS ON.
 *
 * The updater never trusts a URL from the update fragment: it resolves the
 * fragment's `name` against the release's own asset list, and
 * `scripts/update-manifest.cjs` classifies files into arch/kind BY THEIR NAME.
 * So the names electron-builder emits are a contract, and electron-builder's
 * defaults break it: some default names carry a space, and the arch is
 * OMITTED for the builder's default architecture, so an x64 build would be
 * indistinguishable from "no arch". An explicit `artifactName` per target is
 * what makes the arch always present (electron-builder only elides `${arch}`
 * when the pattern is NOT user-specified --
 * `platformPackager.expandArtifactNamePattern`).
 *
 * Static, like `electron-builder.adhd-skill.test.ts`: the real names are
 * observed from a real `pnpm run dist`, which is a build step, not a unit test.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..');

type Config = {
  readonly artifactName?: string;
  readonly publish?: unknown;
  readonly mac: { readonly artifactName?: string };
  readonly dmg?: { readonly artifactName?: string };
  readonly win: { readonly artifactName?: string };
  readonly nsis: { readonly artifactName?: string };
  readonly linux: { readonly artifactName?: string };
  readonly appImage?: { readonly artifactName?: string };
};

const config = require(join(repoRoot, 'electron-builder.config.cjs')) as Config;

describe('electron-builder.config.cjs artifact names', () => {
  it('names mac artifacts (zip and dmg) with the arch, no spaces', () => {
    expect(config.mac.artifactName).toBe('${productName}-${version}-mac-${arch}.${ext}');
    // dmg falls back to mac.artifactName; an override here would fork the two.
    expect(config.dmg?.artifactName ?? config.mac.artifactName).toBe(config.mac.artifactName);
  });

  it('names the NSIS installer with -setup and the win zip without it', () => {
    expect(config.nsis.artifactName).toBe('${productName}-${version}-win-${arch}-setup.${ext}');
    expect(config.win.artifactName).toBe('${productName}-${version}-win-${arch}.${ext}');
  });

  it('names the AppImage with the arch', () => {
    expect(config.linux.artifactName).toBe('${productName}-${version}-linux-${arch}.${ext}');
    expect(config.appImage?.artifactName ?? config.linux.artifactName).toBe(
      config.linux.artifactName,
    );
  });

  it('has no space in any pattern and no top-level override that would leak across targets', () => {
    expect(config.artifactName).toBeUndefined();
    for (const p of [
      config.mac.artifactName,
      config.win.artifactName,
      config.nsis.artifactName,
      config.linux.artifactName,
    ]) {
      expect(p).not.toMatch(/\s/);
      expect(p).toContain('${arch}');
    }
  });

  it('does not add a publish block (the updater reads GitHub itself; CI uploads)', () => {
    expect(config.publish).toBeUndefined();
  });
});
