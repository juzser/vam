/** `src/main/env/utf8-ctype.ts` -- the locale a GUI launch does not have. */

import { describe, expect, it } from 'vitest';
import { applyUtf8Ctype, UTF8_CTYPE } from '../../src/main/env/utf8-ctype.js';

describe('applyUtf8Ctype', () => {
  it('gives a bare environment a UTF-8 LC_CTYPE', () => {
    const env: NodeJS.ProcessEnv = { HOME: '/home/op', PATH: '/usr/bin:/bin' };
    applyUtf8Ctype(env, 'darwin');
    expect(env.LC_CTYPE).toBe(UTF8_CTYPE);
    expect(env.LANG).toBeUndefined();
    expect(env.LC_ALL).toBeUndefined();
  });

  it('treats an empty value as unset -- setlocale does', () => {
    const env: NodeJS.ProcessEnv = { LANG: '', LC_CTYPE: '', LC_ALL: '' };
    applyUtf8Ctype(env, 'linux');
    expect(env.LC_CTYPE).toBe(UTF8_CTYPE);
  });

  it.each([
    ['LANG', 'en_US.UTF-8'],
    ['LANG', 'C'],
    ['LC_CTYPE', 'ja_JP.UTF-8'],
    ['LC_CTYPE', 'POSIX'],
    ['LC_ALL', 'fr_FR.UTF-8'],
    ['LC_ALL', 'C'],
  ])(
    "leaves an environment that set %s=%s alone -- the operator's choice, right or wrong",
    (name, value) => {
      const env: NodeJS.ProcessEnv = { [name]: value };
      applyUtf8Ctype(env, 'darwin');
      expect(env).toEqual({ [name]: value });
    },
  );

  it('does nothing on Windows, where locale is not an environment variable', () => {
    const env: NodeJS.ProcessEnv = {};
    applyUtf8Ctype(env, 'win32');
    expect(env).toEqual({});
  });
});
