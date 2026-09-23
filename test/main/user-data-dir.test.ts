/** `src/main/env/user-data-dir.ts` -- the throwaway `userData` a test/fixture launch gets. */

import { describe, expect, it } from 'vitest';
import { resolveUserDataOverride } from '../../src/main/env/user-data-dir.js';

describe('resolveUserDataOverride', () => {
  it('is undefined when VAM_USER_DATA_DIR is not set -- a production launch is unaffected', () => {
    expect(resolveUserDataOverride({})).toBeUndefined();
  });

  it('is undefined for an empty or blank value, never an empty-string setPath call', () => {
    expect(resolveUserDataOverride({ VAM_USER_DATA_DIR: '' })).toBeUndefined();
    expect(resolveUserDataOverride({ VAM_USER_DATA_DIR: '   ' })).toBeUndefined();
  });

  it('returns the trimmed directory when set', () => {
    expect(resolveUserDataOverride({ VAM_USER_DATA_DIR: '/tmp/vam-test-userdata ' })).toBe(
      '/tmp/vam-test-userdata',
    );
  });
});
