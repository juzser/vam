/**
 * The release workflow is what puts the update fragments on the release, and
 * nothing else exercises it: a static text test, like `packaged-files.test.ts`.
 * If the fragment is not generated and uploaded, every installed build sees
 * "incomplete" and never updates -- quietly.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync(
  fileURLToPath(new URL('../../.github/workflows/release.yml', import.meta.url)),
  'utf8',
);

describe('release.yml', () => {
  it('generates the update fragment after packaging, with a runner.os to platform map', () => {
    const pkg = WORKFLOW.indexOf('run: pnpm run dist');
    const gen = WORKFLOW.indexOf('node scripts/update-manifest.cjs dist-app');
    expect(pkg).toBeGreaterThan(-1);
    expect(gen).toBeGreaterThan(pkg);
    for (const word of ['macOS', 'darwin', 'Windows', 'win32', 'Linux', 'linux']) {
      expect(WORKFLOW).toContain(word);
    }
  });

  it('uploads the fragments', () => {
    expect(WORKFLOW).toContain('dist-app/vam-update-*.json');
  });

  it('tells users installed builds update themselves and macOS must stay in /Applications', () => {
    expect(WORKFLOW).toMatch(/update themselves/);
    expect(WORKFLOW).toContain('/Applications');
  });

  it('hints the new artifact names, not the old ones', () => {
    expect(WORKFLOW).not.toContain('*-Setup-*.exe');
    expect(WORKFLOW).toContain('*-mac-arm64.dmg');
    expect(WORKFLOW).toContain('*-mac-x64.dmg');
    expect(WORKFLOW).toContain('*-win-x64-setup.exe');
    expect(WORKFLOW).toContain('*-linux-x86_64.AppImage');
  });
});
