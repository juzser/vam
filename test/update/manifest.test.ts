import { describe, expect, it } from 'vitest';
import {
  fragmentName,
  MAX_UPDATE_BYTES,
  type Manifest,
  parseManifest,
} from '../../src/shared/update-manifest.js';

const SHA = `${'A'.repeat(86)}==`;
const file = (over: Record<string, unknown> = {}) => ({
  name: 'vam-0.2.0-mac-arm64.zip',
  arch: 'arm64',
  kind: 'mac-zip',
  size: 123,
  sha512: SHA,
  ...over,
});
const doc = (over: Record<string, unknown> = {}) => ({
  schema: 1,
  version: '0.2.0',
  platform: 'darwin',
  files: [file()],
  ...over,
});
const expected = { version: '0.2.0', platform: 'darwin' } as const;

function isError(r: Manifest | { error: string }): r is { error: string } {
  return 'error' in r;
}

describe('parseManifest', () => {
  it('accepts a well-formed fragment', () => {
    const r = parseManifest(doc(), expected);
    expect(isError(r)).toBe(false);
    expect(r).toEqual(doc());
  });

  it('accepts the v-prefixed tag as the expected version', () => {
    expect(isError(parseManifest(doc(), { ...expected, version: 'v0.2.0' }))).toBe(false);
  });

  it.each([
    ['not an object', null],
    ['an array', []],
    ['wrong schema', doc({ schema: 2 })],
    ['missing schema', doc({ schema: undefined })],
    ['platform mismatch', doc({ platform: 'win32' })],
    ['version mismatch', doc({ version: '0.3.0' })],
    ['no files', doc({ files: [] })],
    ['files not an array', doc({ files: 'x' })],
    ['file not an object', doc({ files: [null] })],
    ['name with slash', doc({ files: [file({ name: 'a/b.zip' })] })],
    ['name with backslash', doc({ files: [file({ name: 'a\\b.zip' })] })],
    ['name with ..', doc({ files: [file({ name: 'a..zip' })] })],
    ['name dot-dot exact', doc({ files: [file({ name: '..' })] })],
    ['empty name', doc({ files: [file({ name: '' })] })],
    ['bad arch', doc({ files: [file({ arch: 'ia32' })] })],
    ['bad kind', doc({ files: [file({ kind: 'exe' })] })],
    ['zero size', doc({ files: [file({ size: 0 })] })],
    ['negative size', doc({ files: [file({ size: -1 })] })],
    ['fractional size', doc({ files: [file({ size: 1.5 })] })],
    ['string size', doc({ files: [file({ size: '5' })] })],
    ['oversize', doc({ files: [file({ size: MAX_UPDATE_BYTES + 1 })] })],
    ['short sha', doc({ files: [file({ sha512: 'abc' })] })],
    ['hex sha', doc({ files: [file({ sha512: 'a'.repeat(128) })] })],
    ['sha with bad chars', doc({ files: [file({ sha512: `${'A'.repeat(86)}!!` })] })],
  ])('rejects %s', (_label, input) => {
    expect(isError(parseManifest(input, expected))).toBe(true);
  });

  it('accepts a size of exactly MAX_UPDATE_BYTES', () => {
    expect(
      isError(parseManifest(doc({ files: [file({ size: MAX_UPDATE_BYTES })] }), expected)),
    ).toBe(false);
  });

  it('caps MAX_UPDATE_BYTES at 600 MB', () => {
    expect(MAX_UPDATE_BYTES).toBe(600 * 1024 * 1024);
  });

  it('drops unknown extra fields rather than passing them on', () => {
    const r = parseManifest(doc({ files: [file({ url: 'https://evil.com/x' })] }), expected);
    expect(isError(r)).toBe(false);
    expect((r as Manifest).files[0]).not.toHaveProperty('url');
  });
});

describe('fragmentName', () => {
  it('names the per-platform fragment', () => {
    expect(fragmentName('darwin')).toBe('vam-update-darwin.json');
    expect(fragmentName('win32')).toBe('vam-update-win32.json');
    expect(fragmentName('linux')).toBe('vam-update-linux.json');
  });
});
