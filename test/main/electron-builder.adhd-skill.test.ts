/**
 * TWO CHEAP, STATIC ASSERTIONS that stand in for a full `electron-builder`
 * pack on every test run: that the config actually ships the bundled skill
 * resource, and that the resource on disk is what the app expects to find at
 * runtime. A real pack is the stronger proof and this PR's own gate run does
 * one (`npx asar list … | grep skills`); this file is what stops a future
 * edit to either side from drifting unnoticed between those manual checks.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADHD_SKILL_LICENSE,
  ADHD_SKILL_NAME,
  ADHD_SKILL_PINNED_SHA,
} from '../../src/shared/adhd-skill.js';

const repoRoot = join(__dirname, '..', '..');

describe('electron-builder.config.cjs ships the bundled ADHD skill', () => {
  it('lists resources/skills in its files glob', () => {
    // Imported structurally (rather than parsing its source as text), which
    // is what proves electron-builder itself would read the same array this
    // asserts on. The config has no types of its own; this is the one shape
    // this test reads off it.
    const config = require(join(repoRoot, 'electron-builder.config.cjs')) as {
      readonly files: readonly string[];
    };
    expect(config.files).toContain('resources/skills/**/*');
  });

  it('the bundled files exist, at the path main resolves in dev', () => {
    // `defaultAdhdSkillDeps(app.getAppPath())` in dev IS the repo root --
    // see its own header -- so this is the exact path a dev launch reads.
    const dir = join(repoRoot, 'resources', 'skills', ADHD_SKILL_NAME);
    const skillMd = readFileSync(join(dir, 'SKILL.md'), 'utf8');
    const license = readFileSync(join(dir, 'LICENSE'), 'utf8');
    expect(skillMd).toContain(`name: ${ADHD_SKILL_NAME}`);
    expect(license).toContain(ADHD_SKILL_LICENSE);
    // Pinned commit sanity: NOTICE.md is the one file that names it in the
    // bundle itself, for a reader of the tree rather than of this test.
    const notice = readFileSync(join(dir, 'NOTICE.md'), 'utf8');
    expect(notice).toContain(ADHD_SKILL_PINNED_SHA);
  });
});
