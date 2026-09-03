import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../../src/main/csp.js';

describe('contentSecurityPolicy (main-process response header)', () => {
  it('is exactly the production policy with no dev server URL', () => {
    expect(contentSecurityPolicy(undefined)).toBe(
      "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    );
  });

  it('adds unsafe-inline to script-src when a dev server URL is present, for the react-refresh preamble', () => {
    const policy = contentSecurityPolicy('http://localhost:5173');
    const scriptSrc = policy.split(';').find((clause) => clause.trim().startsWith('script-src'));
    expect(scriptSrc).toContain("'unsafe-inline'");
  });

  it('does not widen style-src, img-src or connect-src in dev -- only script-src changes', () => {
    const dev = contentSecurityPolicy('http://localhost:5173');
    const prod = contentSecurityPolicy(undefined);
    const clauseOf = (policy: string, directive: string) =>
      policy.split(';').find((clause) => clause.trim().startsWith(directive));
    expect(clauseOf(dev, 'style-src')).toBe(clauseOf(prod, 'style-src'));
    expect(clauseOf(dev, 'img-src')).toBe(clauseOf(prod, 'img-src'));
    expect(clauseOf(dev, 'connect-src')).toBe(clauseOf(prod, 'connect-src'));
  });

  it('is unreachable in the packaged app: calling it the way index.ts does (devServerUrl undefined) yields the strict policy', () => {
    // `process.env.ELECTRON_RENDERER_URL` is unset in a build -- see src/main/index.ts.
    const packagedDevServerUrl = process.env.ELECTRON_RENDERER_URL;
    expect(contentSecurityPolicy(packagedDevServerUrl)).toBe(
      "script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    );
  });
});
