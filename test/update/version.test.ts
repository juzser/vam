import { describe, expect, it } from 'vitest';
import { compareVersions, parseVersion } from '../../src/shared/update.js';

describe('parseVersion', () => {
  it('accepts a bare release version', () => {
    expect(parseVersion('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 });
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('accepts the `v` prefix GitHub tags conventionally carry', () => {
    expect(parseVersion('v0.1.0')).toEqual({ major: 0, minor: 1, patch: 0 });
  });

  it('rejects a prerelease, so it can never be offered as an upgrade', () => {
    expect(parseVersion('1.0.0-beta.1')).toBeNull();
    expect(parseVersion('v2.0.0-rc1')).toBeNull();
  });

  it('rejects build metadata, junk and empty input', () => {
    for (const raw of ['1.0.0+build.5', 'nightly', '1.2', '1.2.3.4', '', 'v', 'v1.x.0']) {
      expect(parseVersion(raw), raw).toBeNull();
    }
  });
});

describe('compareVersions', () => {
  const table: ReadonlyArray<readonly [string, string, number]> = [
    ['0.0.0', '0.0.0', 0],
    ['0.0.0', 'v0.1.0', -1],
    // Semver ordering is not string ordering: '0.10.0' < '0.9.0' as text.
    ['0.10.0', '0.9.0', 1],
    ['0.9.0', '0.10.0', -1],
    ['1.0.0', '0.99.99', 1],
    ['v1.2.3', '1.2.4', -1],
    ['1.2.4', 'v1.2.3', 1],
    ['2.0.0', '10.0.0', -1],
    ['v1.0.0', '1.0.0', 0],
  ];

  for (const [a, b, expected] of table) {
    it(`${a} vs ${b} -> ${expected}`, () => {
      const left = parseVersion(a);
      const right = parseVersion(b);
      expect(left).not.toBeNull();
      expect(right).not.toBeNull();
      expect(compareVersions(left as never, right as never)).toBe(expected);
    });
  }
});
