import { describe, expect, it } from 'vitest';
import { isSameOrigin } from '../../src/main/origin.js';

const DEV = 'http://localhost:5173';
const FILE = 'file:///app/out/renderer/index.html';

describe('isSameOrigin (main-process navigation guard)', () => {
  it('accepts the dev origin and its paths', () => {
    expect(isSameOrigin(DEV, DEV, true)).toBe(true);
    expect(isSameOrigin(`${DEV}/canvas`, DEV, true)).toBe(true);
  });

  it('REFUSES a host that merely starts with the dev origin', () => {
    // The bug this exists for: `startsWith` accepts every one of these.
    expect(isSameOrigin('http://localhost:5173.attacker.example/', DEV, true)).toBe(false);
    expect(isSameOrigin('http://localhost:51730/', DEV, true)).toBe(false);
    expect(isSameOrigin('http://localhost:5173@evil.example/', DEV, true)).toBe(false);
  });

  it('refuses an unrelated origin, and a scheme change on the same host', () => {
    expect(isSameOrigin('https://example.invalid/', DEV, true)).toBe(false);
    expect(isSameOrigin('https://localhost:5173/', DEV, true)).toBe(false);
  });

  it('refuses anything unparseable rather than throwing', () => {
    expect(isSameOrigin('not a url', DEV, true)).toBe(false);
    expect(isSameOrigin('', DEV, true)).toBe(false);
  });

  it('is exact equality outside dev, where there is no origin to widen to', () => {
    expect(isSameOrigin(FILE, FILE, false)).toBe(true);
    expect(isSameOrigin(`${FILE}#x`, FILE, false)).toBe(false);
  });
});
