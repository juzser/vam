import { describe, expect, it } from 'vitest';
import { isAllowedDownloadUrl } from '../../src/shared/update-manifest.js';

describe('isAllowedDownloadUrl', () => {
  it.each([
    'https://github.com/juzser/vam/releases/download/v0.2.0/vam-0.2.0-mac-arm64.zip',
    'https://api.github.com/repos/juzser/vam/releases/assets/1',
    'https://objects.githubusercontent.com/github-production-release-asset/1',
    'https://release-assets.githubusercontent.com/x',
    'https://github-releases.githubusercontent.com/x?y=1',
    'https://GitHub.com/x',
  ])('allows %s', (url) => {
    expect(isAllowedDownloadUrl(url)).toBe(true);
  });

  it.each([
    'http://github.com/x',
    'file:///etc/passwd',
    'ftp://github.com/x',
    'https://evil.com/x',
    'https://github.com.evil.com/x',
    'https://evilgithub.com/x',
    'https://sub.github.com/x',
    'https://foo.objects.githubusercontent.com/x',
    'https://user@github.com/x',
    'https://user:pw@github.com/x',
    'https://github.com:8443/x',
    'https://127.0.0.1/x',
    'https://[::1]/x',
    'https://[::ffff:140.82.112.3]/x',
    'https://140.82.112.3/x',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(isAllowedDownloadUrl(url)).toBe(false);
  });

  it('accepts an explicit default port', () => {
    expect(isAllowedDownloadUrl('https://github.com:443/x')).toBe(true);
  });
});
